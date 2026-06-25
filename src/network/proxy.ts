import express, { Request, Response } from 'express';
import * as http from 'http';
import * as path from 'path';
import { ConsistentHashRing } from '../core/hashRing';

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

  /**
   * Synchronizes membership status of the cluster using seed nodes or known active nodes.
   */
  private async synchronizeClusterView(): Promise<void> {
    const nodesToTry = [...this.activeNodes, ...this.seedUrls];
    
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
              if (!matchedMember && !this.seedUrls.includes(activeUrl)) {
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
          throw new Error(errData.error || `HTTP error ${response.status}`);
        }
      } catch (err: any) {
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
        res.status(503).json({ error: `Proxy read failed: ${err.message}` });
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
        res.status(503).json({ error: `Proxy write failed: ${err.message}` });
      }
    });

    // Proxy DELETE key
    this.app.delete('/keys/:key', async (req: Request, res: Response) => {
      const { key } = req.params;
      
      try {
        const data = await this.forwardRequest(key, 'DELETE', `/keys/${key}`);
        res.json(data);
      } catch (err: any) {
        res.status(503).json({ error: `Proxy delete failed: ${err.message}` });
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
  }
}
