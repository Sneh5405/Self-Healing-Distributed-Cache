import express, { Request, Response } from 'express';
import * as http from 'http';
import * as path from 'path';
import { ConsistentHashRing } from '../core/hashRing';
import { CacheNodeServer } from './server';

class HTTPError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HTTPError';
  }
}

export class ClientProxy {
  private port: number;
  private seedUrls: string[];
  private hashRing: ConsistentHashRing;
  private activeNodes: Set<string> = new Set();
  private replicationFactor: number;
  private maxRetries: number;
  private app: express.Application;
  private server: http.Server | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private spawnedNodes: CacheNodeServer[] = [];
  private spawningPorts: Set<number> = new Set();

  constructor(options: {
    port: number;
    seedUrls: string[];
    replicationFactor?: number;
    maxRetries?: number;
  }) {
    this.port = options.port;
    this.seedUrls = options.seedUrls;
    this.replicationFactor = options.replicationFactor || 2;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 1;
    this.hashRing = new ConsistentHashRing();

    // Add seeds initially
    for (const url of this.seedUrls) {
      this.hashRing.addNode(url);
      this.activeNodes.add(url);
    }

    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  /**
   * Start the proxy gateway.
   */
  public async start(): Promise<void> {
    // Attempt first synchronization of the ring configuration from seeds
    await this.synchronizeClusterView();
    
    // Periodically update cluster topology
    this.syncInterval = setInterval(() => this.synchronizeClusterView(), 3000);

    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`[Proxy Gateway] Listening on http://localhost:${this.port}`);
        console.log(`[Proxy Gateway] Routing keys with replication factor ${this.replicationFactor} and max retries ${this.maxRetries}`);
        resolve();
      });
    });
  }

  /**
   * Stop the proxy gateway.
   */
  public async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    // Stop all dynamically spawned nodes
    for (const node of this.spawnedNodes) {
      try {
        await node.stop();
      } catch (err: any) {
        console.error(`[Proxy Gateway] Error stopping spawned node on port ${node.port}:`, err.message);
      }
    }
    
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Proxy Gateway] Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private getPortFromUrl(url: string): number | null {
    try {
      const portStr = new URL(url).port;
      return portStr ? parseInt(portStr, 10) : null;
    } catch {
      const parts = url.split(':');
      const port = parseInt(parts[parts.length - 1], 10);
      return isNaN(port) ? null : port;
    }
  }

  private getNextAvailablePort(): number {
    const activePorts = new Set<number>(this.spawningPorts);
    
    for (const url of this.seedUrls) {
      const port = this.getPortFromUrl(url);
      if (port !== null) activePorts.add(port);
    }
    for (const url of this.activeNodes) {
      const port = this.getPortFromUrl(url);
      if (port !== null) activePorts.add(port);
    }
    for (const node of this.spawnedNodes) {
      activePorts.add(node.port);
    }

    let port = 8001;
    while (activePorts.has(port)) {
      port++;
    }
    return port;
  }

  /**
   * Synchronizes membership status of the cluster using seed nodes or known active nodes.
   */
  private async synchronizeClusterView(): Promise<void> {
    const spawnedUrls = this.spawnedNodes.map(node => `http://${node.host}:${node.port}`);
    const nodesToTry = Array.from(new Set([...this.activeNodes, ...this.seedUrls, ...spawnedUrls]));
    
    for (const url of nodesToTry) {
      try {
        // Fetch status from a node
        const response = await fetch(`${url}/status`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          const statusReport = await response.json();
          const members = statusReport.members || [];
          
          if (members.length > 0) {
            const currentActive = new Set<string>();
            
            for (const member of members) {
              const peerUrl = `http://${member.host}:${member.port}`;
              if (member.status === 'ALIVE' || member.status === 'SUSPECT') {
                currentActive.add(peerUrl);
                
                // Add to hash ring if not already present
                if (!this.activeNodes.has(peerUrl)) {
                  this.hashRing.addNode(peerUrl);
                  this.activeNodes.add(peerUrl);
                }
              } else {
                // If marked DEAD or LEAVING, remove from our active nodes and ring
                if (this.activeNodes.has(peerUrl)) {
                  this.hashRing.removeNode(peerUrl);
                  this.activeNodes.delete(peerUrl);
                }
              }
            }

            // Cleanup any nodes no longer reported by the cluster
            for (const activeUrl of this.activeNodes) {
              const matchedMember = members.find((m: any) => `http://${m.host}:${m.port}` === activeUrl);
              const isSpawnedAndAlive = this.spawnedNodes.some(node => {
                const spawnedNodeUrl = `http://${node.host}:${node.port}`;
                return spawnedNodeUrl === activeUrl && node.gossipManager?.getLocalStatus() === 'ALIVE';
              });
              if (!matchedMember && !this.seedUrls.includes(activeUrl) && !isSpawnedAndAlive) {
                this.hashRing.removeNode(activeUrl);
                this.activeNodes.delete(activeUrl);
              }
            }
            
            return; // Successfully synced, exit loop
          }
        }
      } catch (err) {
        // Suppress errors and try next node
      }
    }
  }

  /**
   * Forward HTTP request to one of the responsible nodes, with retries on failure.
   */
  private async forwardRequest(
    key: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: any,
    consistency?: string
  ): Promise<any> {
    // Get target nodes for key (primary and replicas)
    const targetNodes = this.hashRing.getNodesForKey(key, this.replicationFactor);
    
    if (targetNodes.length === 0) {
      throw new Error('No active cache nodes found in the hash ring');
    }

    let lastError: Error = new Error('Request routing failed');
    
    // Attempt request up to (maxRetries + 1) times, using primary first, then replicas
    const attempts = Math.min(targetNodes.length, this.maxRetries + 1);

    for (let attempt = 0; attempt < attempts; attempt++) {
      const nodeUrl = targetNodes[attempt];
      const url = `${nodeUrl}${path}${consistency ? `?consistency=${consistency}` : ''}`;
      
      try {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(1500) // 1.5s timeout per request
        });

        if (response.ok) {
          return await response.json();
        } else {
          const errData = await response.json().catch(() => ({}));
          const errorMsg = errData.error || `HTTP error ${response.status}`;
          
          if (response.status >= 400 && response.status < 500) {
            throw new HTTPError(response.status, errorMsg);
          }
          
          throw new Error(errorMsg);
        }
      } catch (err: any) {
        if (err instanceof HTTPError) {
          throw err;
        }
        
        console.warn(`[Proxy Gateway] Request ${method} ${path} failed on ${nodeUrl} (Attempt ${attempt + 1}/${attempts}): ${err.message}`);
        lastError = err;
        
        // Mark node as temporarily inactive in proxy's view (will be verified on next sync)
        this.activeNodes.delete(nodeUrl);
        // Note: do not remove from ring entirely yet, let the sync cycle handle it
      }
    }

    throw lastError;
  }

  private setupRoutes(): void {
    // Serve Static Dashboard
    this.app.get('/dashboard', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, '../dashboard/dashboard.html'));
    });

    // Proxy GET key
    this.app.get('/keys/:key', async (req: Request, res: Response) => {
      const { key } = req.params;
      const consistency = req.query.consistency as string; // ONE, QUORUM, ALL
      
      try {
        const data = await this.forwardRequest(key, 'GET', `/keys/${key}`, undefined, consistency);
        res.json(data);
      } catch (err: any) {
        const status = err.status || 503;
        res.status(status).json({ error: err.message || 'Proxy read failed' });
      }
    });

    // Proxy SET key
    this.app.post('/keys/:key', async (req: Request, res: Response) => {
      const { key } = req.params;
      const { value, ttlSeconds, timestamp } = req.body;
      const consistency = req.query.consistency as string; // ONE, QUORUM, ALL

      try {
        const data = await this.forwardRequest(key, 'POST', `/keys/${key}`, { value, ttlSeconds, timestamp }, consistency);
        res.json(data);
      } catch (err: any) {
        const status = err.status || 503;
        res.status(status).json({ error: err.message || 'Proxy write failed' });
      }
    });

    // Proxy DELETE key
    this.app.delete('/keys/:key', async (req: Request, res: Response) => {
      const { key } = req.params;
      
      try {
        const data = await this.forwardRequest(key, 'DELETE', `/keys/${key}`);
        res.json(data);
      } catch (err: any) {
        const status = err.status || 503;
        res.status(status).json({ error: err.message || 'Proxy delete failed' });
      }
    });

    // Proxy Cluster Status
    this.app.get('/status', async (req: Request, res: Response) => {
      // Gather statuses from all active nodes
      const report: Record<string, any> = {};
      const promises = Array.from(this.activeNodes).map(async (url) => {
        try {
          const resp = await fetch(`${url}/status`, { signal: AbortSignal.timeout(1000) });
          if (resp.ok) {
            report[url] = await resp.json();
          } else {
            report[url] = { status: 'ERROR', code: resp.status };
          }
        } catch (err: any) {
          report[url] = { status: 'OFFLINE', error: err.message };
        }
      });

      await Promise.all(promises);
      res.json({
        proxyStatus: 'RUNNING',
        activeNodes: Array.from(this.activeNodes),
        nodes: report
      });
    });

    // Dynamic scale-up: spawn a new cluster node
    this.app.post('/nodes', async (req: Request, res: Response) => {
      let nextPort: number | null = null;
      try {
        nextPort = this.getNextAvailablePort();
        this.spawningPorts.add(nextPort);
        
        console.log(`[Proxy Gateway] Dynamically scaling up: spawning new node on port ${nextPort}...`);
        const node = new CacheNodeServer(nextPort, 'localhost');
        await node.start();
        
        // Initialize cluster with seeds
        node.initializeCluster(this.seedUrls, this.replicationFactor);
        
        // Add new node URL to activeNodes and hashRing immediately
        const nodeUrl = `http://${node.host}:${node.port}`;
        this.activeNodes.add(nodeUrl);
        this.hashRing.addNode(nodeUrl);
        
        this.spawnedNodes.push(node);
        this.spawningPorts.delete(nextPort);
        
        res.json({
          success: true,
          nodeId: node.id,
          port: nextPort,
          message: `Node ${node.id} successfully started and joined the cluster.`
        });
      } catch (err: any) {
        if (nextPort !== null) {
          this.spawningPorts.delete(nextPort);
        }
        console.error(`[Proxy Gateway] Failed to scale up node:`, err);
        res.status(500).json({ error: `Failed to spawn node: ${err.message}` });
      }
    });
  }
}
