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
  
  // Autoscaler state variables and thresholds
  private minNodes = 3;
  private maxNodes = 10;
  
  // Cooldown tracking
  private lastScaleUpTime = 0;
  private lastScaleDownTime = 0;
  private scaleUpCooldownMs = 30000;    // 30 seconds
  private scaleDownCooldownMs = 120000; // 2 minutes

  // Thresholds
  private scaleUpCpuThreshold = 75;
  private scaleUpMemoryThreshold = 80;
  private scaleUpRpsThreshold = 5000;
  
  private scaleDownCpuThreshold = 30;
  private scaleDownMemoryThreshold = 40;
  private scaleDownRpsThreshold = 2000;

  private autoscalerInterval = 5000;
  private autoscaleTimer: NodeJS.Timeout | null = null;
  private isScalingInProgress = false;

  constructor(options: {
    port: number;
    seedUrls: string[];
    replicationFactor?: number;
    maxRetries?: number;
    minNodes?: number;
    maxNodes?: number;
    scaleUpThreshold?: { cpu?: number; memory?: number; rps?: number };
    scaleDownThreshold?: { cpu?: number; memory?: number; rps?: number };
    cooldown?: { scaleUp?: number; scaleDown?: number };
  }) {
    this.port = options.port;
    this.seedUrls = options.seedUrls;
    this.replicationFactor = options.replicationFactor || 2;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 1;
    this.hashRing = new ConsistentHashRing();

    // Bounds configuration
    this.minNodes = options.minNodes !== undefined ? options.minNodes : 3;
    this.maxNodes = options.maxNodes !== undefined ? options.maxNodes : 10;

    // Thresholds configuration
    if (options.scaleUpThreshold) {
      if (options.scaleUpThreshold.cpu !== undefined) this.scaleUpCpuThreshold = options.scaleUpThreshold.cpu;
      if (options.scaleUpThreshold.memory !== undefined) this.scaleUpMemoryThreshold = options.scaleUpThreshold.memory;
      if (options.scaleUpThreshold.rps !== undefined) this.scaleUpRpsThreshold = options.scaleUpThreshold.rps;
    }
    if (options.scaleDownThreshold) {
      if (options.scaleDownThreshold.cpu !== undefined) this.scaleDownCpuThreshold = options.scaleDownThreshold.cpu;
      if (options.scaleDownThreshold.memory !== undefined) this.scaleDownMemoryThreshold = options.scaleDownThreshold.memory;
      if (options.scaleDownThreshold.rps !== undefined) this.scaleDownRpsThreshold = options.scaleDownThreshold.rps;
    }

    // Cooldown configuration
    if (options.cooldown) {
      if (options.cooldown.scaleUp !== undefined) this.scaleUpCooldownMs = options.cooldown.scaleUp * 1000;
      if (options.cooldown.scaleDown !== undefined) this.scaleDownCooldownMs = options.cooldown.scaleDown * 1000;
    }

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

    // Start background autoscaling monitor
    this.autoscaleTimer = setInterval(() => this.checkAutoscaling(), this.autoscalerInterval);

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

    if (this.autoscaleTimer) {
      clearInterval(this.autoscaleTimer);
      this.autoscaleTimer = null;
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

    let startPort = 8001;
    if (activePorts.size > 0) {
      startPort = Math.max(...Array.from(activePorts)) + 1;
    }

    let port = startPort;
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
   * Monitor cluster load and dynamically adjust cluster size.
   */
  private async checkAutoscaling(): Promise<void> {
    if (this.isScalingInProgress) return;

    const now = Date.now();
    // Check cooldowns
    if (now - this.lastScaleUpTime < this.scaleUpCooldownMs) {
      return;
    }
    if (now - this.lastScaleDownTime < this.scaleDownCooldownMs) {
      return;
    }

    // Gather status reports from all active nodes
    const healthyNodes: Array<{ url: string; keysCount: number; port: number; cpu: number; memoryPercent: number; rps: number }> = [];
    
    const promises = Array.from(this.activeNodes).map(async (url) => {
      try {
        const resp = await fetch(`${url}/status`, { signal: AbortSignal.timeout(1000) });
        if (resp.ok) {
          const status = await resp.json();
          if (status.status === 'ALIVE' || status.status === 'SUSPECT') {
            healthyNodes.push({
              url,
              keysCount: status.keysCount || 0,
              port: status.port,
              cpu: status.cpu !== undefined ? status.cpu : 0,
              memoryPercent: status.memoryPercent !== undefined ? status.memoryPercent : 0,
              rps: status.rps !== undefined ? status.rps : 0
            });
          }
        }
      } catch (err) {
        // Node is offline or errored
      }
    });

    await Promise.all(promises);

    const totalActiveNodes = healthyNodes.length;
    if (totalActiveNodes === 0) return;

    // Calculate averages
    const totalKeys = healthyNodes.reduce((sum, n) => sum + n.keysCount, 0);
    const avgKeys = totalKeys / totalActiveNodes;
    
    const avgCpu = healthyNodes.reduce((sum, n) => sum + n.cpu, 0) / totalActiveNodes;
    const avgMemory = healthyNodes.reduce((sum, n) => sum + n.memoryPercent, 0) / totalActiveNodes;
    const avgRps = healthyNodes.reduce((sum, n) => sum + n.rps, 0) / totalActiveNodes;

    // Check skew threshold: > 120% of average keys
    let hasSkewedNode = false;
    let maxSkewNodeUrl = '';
    let maxSkewValue = 0;
    if (totalKeys > 10) {
      const skewThreshold = avgKeys * 1.2;
      for (const node of healthyNodes) {
        if (node.keysCount > skewThreshold) {
          hasSkewedNode = true;
          if (node.keysCount > maxSkewValue) {
            maxSkewValue = node.keysCount;
            maxSkewNodeUrl = node.url;
          }
        }
      }
    }

    console.log(`[Autoscaler] Monitoring load:`);
    console.log(`  - Nodes count: ${totalActiveNodes} (min: ${this.minNodes}, max: ${this.maxNodes})`);
    console.log(`  - Keys count:  ${totalKeys} (Avg: ${avgKeys.toFixed(1)} keys/node)`);
    console.log(`  - Avg CPU:     ${avgCpu.toFixed(1)}% (Threshold: ScaleUp > ${this.scaleUpCpuThreshold}%, ScaleDown < ${this.scaleDownCpuThreshold}%)`);
    console.log(`  - Avg Memory:  ${avgMemory.toFixed(1)}% (Threshold: ScaleUp > ${this.scaleUpMemoryThreshold}%, ScaleDown < ${this.scaleDownMemoryThreshold}%)`);
    console.log(`  - Avg RPS:     ${avgRps.toFixed(1)}/node (Threshold: ScaleUp > ${this.scaleUpRpsThreshold}, ScaleDown < ${this.scaleDownRpsThreshold})`);
    if (totalKeys > 10) {
      console.log(`  - Key Skew:    ${hasSkewedNode ? `YES (Max: ${maxSkewValue} keys vs threshold ${(avgKeys * 1.2).toFixed(1)} keys)` : 'NO'}`);
    }

    // Scale Up decision: CPU > 75% OR Memory > 80% OR RPS > 5000 OR KeySkew > 120% of average
    const shouldScaleUp = avgCpu > this.scaleUpCpuThreshold || 
                          avgMemory > this.scaleUpMemoryThreshold || 
                          avgRps > this.scaleUpRpsThreshold || 
                          hasSkewedNode;

    if (shouldScaleUp && totalActiveNodes < this.maxNodes) {
      this.isScalingInProgress = true;
      console.log(`[Autoscaler] SCALE UP TRIGGERED:`);
      if (avgCpu > this.scaleUpCpuThreshold) console.log(`  - CPU exceeded: ${avgCpu.toFixed(1)}% > ${this.scaleUpCpuThreshold}%`);
      if (avgMemory > this.scaleUpMemoryThreshold) console.log(`  - Memory exceeded: ${avgMemory.toFixed(1)}% > ${this.scaleUpMemoryThreshold}%`);
      if (avgRps > this.scaleUpRpsThreshold) console.log(`  - RPS exceeded: ${avgRps.toFixed(1)} > ${this.scaleUpRpsThreshold}`);
      if (hasSkewedNode) console.log(`  - Key skew detected: Node ${maxSkewNodeUrl} has ${maxSkewValue} keys (threshold: ${(avgKeys * 1.2).toFixed(1)})`);

      try {
        const nextPort = this.getNextAvailablePort();
        this.spawningPorts.add(nextPort);
        
        console.log(`[Proxy Gateway] [Autoscaler] Dynamically spawning new node on port ${nextPort}...`);
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
        this.lastScaleUpTime = Date.now();
        console.log(`[Autoscaler] Scale-up Success: Node spawned on Port ${nextPort} and joined cluster.`);
      } catch (err: any) {
        console.error(`[Autoscaler] Scale-up Failed:`, err.message);
      } finally {
        this.isScalingInProgress = false;
      }
    }
    // Scale Down decision: CPU < 30% AND Memory < 40% AND RPS < 2000 AND no KeySkew
    else {
      const shouldScaleDown = avgCpu < this.scaleDownCpuThreshold && 
                            avgMemory < this.scaleDownMemoryThreshold && 
                            avgRps < this.scaleDownRpsThreshold && 
                            !hasSkewedNode;

      if (shouldScaleDown && totalActiveNodes > this.minNodes && this.spawnedNodes.length > 0) {
        this.isScalingInProgress = true;
        const lastNode = this.spawnedNodes[this.spawnedNodes.length - 1];
        console.log(`[Autoscaler] SCALE DOWN TRIGGERED: CPU ${avgCpu.toFixed(1)}%, Mem ${avgMemory.toFixed(1)}%, RPS ${avgRps.toFixed(1)}/node. Removing node on port ${lastNode.port}...`);
        try {
          const targetUrl = `http://${lastNode.host}:${lastNode.port}`;
          
          // Remove from proxy activeNodes and hashRing immediately so no new traffic is routed to it
          this.activeNodes.delete(targetUrl);
          this.hashRing.removeNode(targetUrl);
          
          // Call graceful /leave on the node itself to migrate its keys
          await fetch(`${targetUrl}/leave`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {});
          
          // Remove from spawned list
          this.spawnedNodes.pop();
          this.lastScaleDownTime = Date.now();
          console.log(`[Autoscaler] Scale-down Success: Node on Port ${lastNode.port} gracefully left and was shut down.`);
        } catch (err: any) {
          console.error(`[Autoscaler] Scale-down Failed:`, err.message);
        } finally {
          this.isScalingInProgress = false;
        }
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
