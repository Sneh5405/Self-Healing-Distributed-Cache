import express, { Request, Response } from 'express';
import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import * as crypto from 'crypto';
import { InMemoryStore } from '../core/store';
import { ConsistentHashRing } from '../core/hashRing';
import { ReplicationManager } from '../core/replication';
import { GossipManager } from '../cluster/gossip';

export interface NodeInfo {
  id: string;
  host: string;
  port: number;
  status: 'ALIVE' | 'SUSPECT' | 'DEAD' | 'LEAVING';
  heartbeat: number;
  lastUpdated: number;
}

export class CacheNodeServer {
  public id: string;
  public host: string;
  public port: number;
  public store: InMemoryStore;
  
  private app: express.Application;
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();

  // Cluster components
  public hashRing: ConsistentHashRing | null = null;
  public gossipManager: GossipManager | null = null;
  public replicationManager: ReplicationManager | null = null;

  // Metrics tracking
  private requestCount = 0;
  private rps = 0;
  private lastRpsUpdate = Date.now();
  private maxMemoryBytes: number;
  private rpsTimer: NodeJS.Timeout | null = null;

  constructor(port: number, host: string = 'localhost', maxMemoryBytes: number = 50 * 1024 * 1024) { // Default 50MB
    this.port = port;
    this.host = host;
    this.id = `node-${host}-${port}`;
    this.maxMemoryBytes = maxMemoryBytes;
    this.store = new InMemoryStore({ maxMemoryBytes, evictionPolicy: 'NONE' });

    this.app = express();
    this.app.use(express.json());
    
    this.setupRoutes();
    
    this.httpServer = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupWebSockets();

    // Start periodic RPS calculation
    this.rpsTimer = setInterval(() => {
      const now = Date.now();
      const delta = (now - this.lastRpsUpdate) / 1000;
      this.rps = this.requestCount / (delta || 1);
      this.requestCount = 0;
      this.lastRpsUpdate = now;
    }, 1000);
  }

  /**
   * Initialize all cluster services on this node.
   */
  public initializeCluster(seeds: string[], replicationFactor: number = 2): void {
    const localUrl = `http://${this.host}:${this.port}`;

    // 1. Initialize Hash Ring with this node
    this.hashRing = new ConsistentHashRing(40);
    this.hashRing.addNode(localUrl);

    // 2. Initialize Replication Manager
    this.replicationManager = new ReplicationManager(this, replicationFactor);

    // 3. Initialize Gossip Manager
    this.gossipManager = new GossipManager(this);

    // Add seed nodes to Gossip Manager
    for (const seed of seeds) {
      if (seed !== localUrl) {
        try {
          const urlObj = new URL(seed);
          const seedPort = parseInt(urlObj.port) || 80;
          const seedHost = urlObj.hostname || 'localhost';
          this.gossipManager.addSeedNode(seed, seedPort, seedHost);
        } catch (err) {
          // If URL parsing fails, default to port/host splitting
          const parts = seed.replace('http://', '').split(':');
          const seedHost = parts[0];
          const seedPort = parseInt(parts[1]) || 80;
          this.gossipManager.addSeedNode(seed, seedPort, seedHost);
        }
      }
    }

    // 4. Start Gossip process
    this.gossipManager.start();
  }

  /**
   * Start the HTTP and WebSocket servers.
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, this.host, () => {
        console.log(`[Node ${this.id}] Server started on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Graceful shutdown of the server.
   */
  public async stop(): Promise<void> {
    // Notify WebSocket clients
    this.broadcast({ type: 'node_shutdown', nodeId: this.id });
    
    if (this.rpsTimer) {
      clearInterval(this.rpsTimer);
      this.rpsTimer = null;
    }

    if (this.gossipManager) {
      this.gossipManager.stop();
    }

    this.wsClients.forEach((ws) => ws.close());
    this.store.close();
    
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.httpServer.close(() => {
          console.log(`[Node ${this.id}] Server stopped`);
          resolve();
        });
      });
    });
  }

  /**
   * Broadcast telemetry data to dashboard clients.
   */
  public broadcast(message: any): void {
    const payload = JSON.stringify(message);
    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
  }

  private setupWebSockets(): void {
    this.wss.on('connection', (ws) => {
      this.wsClients.add(ws);
      
      // Send initial state to dashboard client
      ws.send(JSON.stringify({
        type: 'init',
        nodeId: this.id,
        status: this.getStatusReport()
      }));

      ws.on('close', () => {
        this.wsClients.delete(ws);
      });
    });

    // Periodically broadcast telemetry
    setInterval(() => {
      if (this.wsClients.size > 0) {
        this.broadcast({
          type: 'telemetry',
          nodeId: this.id,
          timestamp: Date.now(),
          metrics: this.getStatusReport()
        });
      }
    }, 2000);
  }

  public recordRequest(): void {
    this.requestCount++;
  }

  public getCpuUsage(): number {
    const baseCpu = 10;
    const rpsContribution = this.rps / 60;
    const simulatedCpu = Math.min(100, baseCpu + rpsContribution + (Math.random() * 2));
    return Math.round(simulatedCpu);
  }

  public getMemoryPercentage(): number {
    if (this.maxMemoryBytes === Infinity || this.maxMemoryBytes <= 0) return 0;
    return (this.store.getMemoryUsage() / this.maxMemoryBytes) * 100;
  }

  private getStatusReport() {
    return {
      nodeId: this.id,
      host: this.host,
      port: this.port,
      memoryUsage: this.store.getMemoryUsage(),
      maxMemoryBytes: this.maxMemoryBytes,
      memoryPercent: this.getMemoryPercentage(),
      cpu: this.getCpuUsage(),
      rps: this.rps,
      keysCount: this.store.keys().length,
      keys: this.store.keys(),
      status: this.gossipManager ? this.gossipManager.getLocalStatus() : 'ALIVE',
      members: this.gossipManager ? this.gossipManager.getMembershipList() : []
    };
  }

  private setupRoutes(): void {
    // Record request middleware for key/data endpoints
    this.app.use((req, res, next) => {
      if (req.path.startsWith('/keys') || req.path.startsWith('/local/keys')) {
        this.recordRequest();
      }
      next();
    });

    // -------------------------------------------------------------
    // LOCAL ENDPOINTS: Direct memory operations on this node only
    // -------------------------------------------------------------
    
    // Get local key
    this.app.get('/local/keys/:key', (req: Request, res: Response) => {
      const { key } = req.params;
      const entry = this.store.get(key);
      if (!entry) {
        return res.status(404).json({ error: 'Key not found locally' });
      }
      this.broadcast({ type: 'op_local_get', key, success: true });
      res.json(entry);
    });

    // Set local key
    this.app.post('/local/keys/:key', (req: Request, res: Response) => {
      const { key } = req.params;
      const { value, ttlSeconds, timestamp } = req.body;
      
      if (value === undefined) {
        return res.status(400).json({ error: 'Missing value' });
      }

      this.store.set(key, String(value), ttlSeconds, timestamp);
      this.broadcast({ type: 'op_local_set', key, value: String(value), ttlSeconds });
      res.json({ success: true });
    });

    // Delete local key
    this.app.delete('/local/keys/:key', (req: Request, res: Response) => {
      const { key } = req.params;
      const deleted = this.store.delete(key);
      this.broadcast({ type: 'op_local_delete', key, success: deleted });
      res.json({ success: deleted });
    });

    // -------------------------------------------------------------
    // CLUSTER ENDPOINTS: Router-coordinated requests (Consistent Ring)
    // -------------------------------------------------------------
    
    // Cluster GET: Route/replicate query depending on hash ring
    this.app.get('/keys/:key', async (req: Request, res: Response) => {
      const { key } = req.params;
      const readConsistency = req.query.consistency as string || 'ONE'; // ONE, QUORUM, ALL

      this.broadcast({ type: 'op_cluster_get', key, consistency: readConsistency });

      if (!this.hashRing || !this.replicationManager) {
        // Standalone fallback if ring isn't initialized yet
        const entry = this.store.get(key);
        if (!entry) return res.status(404).json({ error: 'Key not found' });
        return res.json({ key, value: entry.value, timestamp: entry.timestamp });
      }

      try {
        const result = await this.replicationManager.readKey(key, readConsistency);
        res.json(result);
      } catch (err: any) {
        res.status(err.status || 500).json({ error: err.message || 'Cluster read failed' });
      }
    });

    // Cluster SET: Route/replicate query depending on hash ring
    this.app.post('/keys/:key', async (req: Request, res: Response) => {
      const { key } = req.params;
      const { value, ttlSeconds, timestamp } = req.body;
      const writeConsistency = req.query.consistency as string || 'QUORUM'; // ONE, QUORUM, ALL

      if (value === undefined) {
        return res.status(400).json({ error: 'Missing value' });
      }

      this.broadcast({ type: 'op_cluster_set', key, value: String(value), consistency: writeConsistency });

      if (!this.hashRing || !this.replicationManager) {
        // Standalone fallback
        this.store.set(key, String(value), ttlSeconds, timestamp);
        return res.json({ success: true, nodeId: this.id });
      }

      try {
        const result = await this.replicationManager.writeKey(key, String(value), ttlSeconds, writeConsistency, timestamp);
        res.json(result);
      } catch (err: any) {
        res.status(err.status || 500).json({ error: err.message || 'Cluster write failed' });
      }
    });

    // Cluster DELETE: Route/delete query
    this.app.delete('/keys/:key', async (req: Request, res: Response) => {
      const { key } = req.params;
      this.broadcast({ type: 'op_cluster_delete', key });

      if (!this.hashRing || !this.replicationManager) {
        const deleted = this.store.delete(key);
        return res.json({ success: deleted });
      }

      try {
        const result = await this.replicationManager.deleteKey(key);
        res.json(result);
      } catch (err: any) {
        res.status(err.status || 500).json({ error: err.message || 'Cluster delete failed' });
      }
    });

    // -------------------------------------------------------------
    // CLUSTER CONFIGURATION & MEMBERSHIP ENDPOINTS
    // -------------------------------------------------------------
    
    // Get status and local state
    this.app.get('/status', (req: Request, res: Response) => {
      res.json(this.getStatusReport());
    });

    // Configure memory and eviction policy dynamically
    this.app.post('/config', (req: Request, res: Response) => {
      const { maxMemoryBytes, evictionPolicy } = req.body;
      
      if (maxMemoryBytes !== undefined) {
        this.store.setMaxMemory(maxMemoryBytes);
      }
      if (evictionPolicy !== undefined) {
        if (evictionPolicy === 'LRU' || evictionPolicy === 'LFU' || evictionPolicy === 'NONE') {
          this.store.setEvictionPolicy(evictionPolicy);
        } else {
          return res.status(400).json({ error: 'Invalid eviction policy. Must be LRU, LFU, or NONE' });
        }
      }
      
      res.json({
        success: true,
        maxMemoryBytes: this.store.getMemoryUsage(), // return current status
        evictionPolicy
      });
    });

    // Gossip endpoint for node-to-node membership syncing
    this.app.post('/gossip/ping', (req: Request, res: Response) => {
      if (!this.gossipManager) {
        return res.status(501).json({ error: 'Gossip protocol not enabled' });
      }
      const { senderId, membershipList } = req.body;
      const responseList = this.gossipManager.receiveGossip(senderId, membershipList);
      res.json({ membershipList: responseList });
    });

    // Rebalance: receive keys migrated from another node
    this.app.post('/rebalance/receive', (req: Request, res: Response) => {
      const { keys } = req.body; // Array of { key, entry }
      if (!Array.isArray(keys)) {
        return res.status(400).json({ error: 'Keys must be an array' });
      }

      for (const item of keys) {
        const { key, entry } = item;
        // Keep version and write timestamp from the migrating node
        const ttlSeconds = entry.expiry ? Math.max(0, Math.ceil((entry.expiry - Date.now()) / 1000)) : undefined;
        this.store.set(key, entry.value, ttlSeconds, entry.timestamp);
      }

      this.broadcast({ type: 'rebalance_received', count: keys.length });
      res.json({ success: true });
    });

    // Rebalance: trigger migration of keys to a new target node
    this.app.post('/rebalance/migrate', async (req: Request, res: Response) => {
      const { targetNodeUrl, keysToMigrate } = req.body;
      if (!targetNodeUrl || !Array.isArray(keysToMigrate)) {
        return res.status(400).json({ error: 'Missing targetNodeUrl or keysToMigrate array' });
      }

      if (!this.replicationManager) {
        return res.status(501).json({ error: 'Replication manager not enabled' });
      }

      try {
        await this.replicationManager.migrateKeys(targetNodeUrl, keysToMigrate);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Migration failed' });
      }
    });

    // Leave the cluster gracefully or crash
    this.app.post('/leave', async (req: Request, res: Response) => {
      const isCrash = req.query.crash === 'true';

      if (isCrash) {
        console.log(`[Node ${this.id}] Simulating HARD CRASH!`);
        res.json({ success: true, message: 'Node crashed' });
        setTimeout(() => {
          this.stop();
        }, 100);
        return;
      }

      if (!this.gossipManager) {
        return res.status(501).json({ error: 'Gossip protocol not enabled' });
      }
      
      try {
        console.log(`[Node ${this.id}] Initiating graceful shutdown...`);
        // 1. Mark status as LEAVING in gossip
        this.gossipManager.setLeavingStatus();
        
        // 2. Perform key migration
        if (this.replicationManager) {
          await this.replicationManager.handleGracefulLeave();
        }

        res.json({ success: true });

        // Stop server after response has sent
        setTimeout(() => {
          this.stop();
        }, 1000);

      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to leave cluster gracefully' });
      }
    });
  }
}
