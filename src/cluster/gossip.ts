import { CacheNodeServer, NodeInfo } from '../network/server';
import { ClusterRebalancer } from './rebalancer';

export class GossipManager {
  private server: CacheNodeServer;
  private membership: Map<string, NodeInfo> = new Map();
  private pingIntervalMs: number;
  private suspectTimeoutMs: number;
  private rebalancer: ClusterRebalancer;
  
  private gossipTimer: NodeJS.Timeout | null = null;
  private checkFailureTimer: NodeJS.Timeout | null = null;

  constructor(
    server: CacheNodeServer,
    options?: { pingIntervalMs?: number; suspectTimeoutMs?: number }
  ) {
    this.server = server;
    this.pingIntervalMs = options?.pingIntervalMs || 1000;
    this.suspectTimeoutMs = options?.suspectTimeoutMs || 10000;
    this.rebalancer = new ClusterRebalancer(server);

    // Initialize local node info
    const localUrl = `http://${server.host}:${server.port}`;
    this.membership.set(localUrl, {
      id: server.id,
      host: server.host,
      port: server.port,
      status: 'ALIVE',
      heartbeat: 1,
      lastUpdated: Date.now()
    });
  }

  /**
   * Start background timers for gossip and failure detection.
   */
  public start(): void {
    this.gossipTimer = setInterval(() => this.gossipRound(), this.pingIntervalMs);
    this.checkFailureTimer = setInterval(() => this.checkFailures(), 1000);
    console.log(`[Node ${this.server.id}] Gossip and Failure Detection started`);
  }

  /**
   * Stop background timers.
   */
  public stop(): void {
    if (this.gossipTimer) clearInterval(this.gossipTimer);
    if (this.checkFailureTimer) clearInterval(this.checkFailureTimer);
    this.gossipTimer = null;
    this.checkFailureTimer = null;
  }

  /**
   * Return local node's health status.
   */
  public getLocalStatus(): 'ALIVE' | 'SUSPECT' | 'DEAD' | 'LEAVING' {
    const localUrl = `http://${this.server.host}:${this.server.port}`;
    return this.membership.get(localUrl)?.status || 'ALIVE';
  }

  /**
   * Sets node status to LEAVING when gracefully shutting down.
   */
  public setLeavingStatus(): void {
    const localUrl = `http://${this.server.host}:${this.server.port}`;
    const local = this.membership.get(localUrl);
    if (local) {
      local.status = 'LEAVING';
      local.heartbeat += 1;
      local.lastUpdated = Date.now();
      this.membership.set(localUrl, local);
    }
  }

  /**
   * Returns list of all known nodes.
   */
  public getMembershipList(): NodeInfo[] {
    return Array.from(this.membership.values());
  }

  /**
   * Add a node manually (e.g. a bootstrap seed node).
   */
  public addSeedNode(url: string, port: number, host: string = 'localhost'): void {
    if (url === `http://${this.server.host}:${this.server.port}`) return;
    if (!this.membership.has(url)) {
      this.membership.set(url, {
        id: `node-${host}-${port}`,
        host,
        port,
        status: 'ALIVE',
        heartbeat: 0,
        lastUpdated: Date.now()
      });
      // Add to hash ring immediately as well
      if (this.server.hashRing) {
        this.server.hashRing.addNode(url);
      }
    }
  }

  /**
   * Merges incoming gossip membership list with our local view.
   * Returns our updated local view to send back (bi-directional gossip).
   */
  public receiveGossip(senderId: string, remoteList: NodeInfo[]): NodeInfo[] {
    const now = Date.now();
    const localUrl = `http://${this.server.host}:${this.server.port}`;

    for (const remote of remoteList) {
      const remoteUrl = `http://${remote.host}:${remote.port}`;
      const local = this.membership.get(remoteUrl);

      // Refutation check: If a remote node claims we are SUSPECT or DEAD, but we are ALIVE,
      // we refute it by increasing our heartbeat and staying ALIVE.
      if (remoteUrl === localUrl) {
        if (remote.status === 'SUSPECT' || remote.status === 'DEAD') {
          const ourSelf = this.membership.get(localUrl)!;
          ourSelf.heartbeat = Math.max(ourSelf.heartbeat, remote.heartbeat) + 1;
          ourSelf.status = 'ALIVE';
          ourSelf.lastUpdated = now;
          this.membership.set(localUrl, ourSelf);
          
          this.server.broadcast({
            type: 'gossip_refute',
            nodeId: this.server.id,
            newHeartbeat: ourSelf.heartbeat
          });
        }
        continue;
      }

      if (!local) {
        // Node is brand new to us
        if (remote.status !== 'DEAD') {
          this.membership.set(remoteUrl, { ...remote, lastUpdated: now });
          // Update Hash Ring
          if (this.server.hashRing) {
            this.server.hashRing.addNode(remoteUrl);
          }
          this.server.broadcast({ type: 'gossip_node_discovered', nodeId: remote.id, url: remoteUrl });
          this.rebalancer.triggerRebalance();
        }
      } else {
        // Node is known, compare heartbeats
        const isHeartbeatHigher = remote.heartbeat > local.heartbeat;
        
        if (isHeartbeatHigher) {
          // Update details
          const oldStatus = local.status;
          local.heartbeat = remote.heartbeat;
          local.status = remote.status;
          local.lastUpdated = now;
          this.membership.set(remoteUrl, local);

          // Update Hash Ring based on status transitions
          if (oldStatus !== remote.status) {
            this.handleStatusTransition(remoteUrl, remote.id, oldStatus, remote.status);
          }
        }
      }
    }

    return this.getMembershipList();
  }

  /**
   * Processes a status transition and updates the Hash Ring.
   */
  private handleStatusTransition(url: string, id: string, from: string, to: string): void {
    console.log(`[Node ${this.server.id}] Node ${id} status transition: ${from} -> ${to}`);
    this.server.broadcast({
      type: 'node_status_change',
      nodeId: id,
      url,
      from,
      to
    });

    if (!this.server.hashRing) return;

    if (to === 'ALIVE') {
      this.server.hashRing.addNode(url);
    } else if (to === 'DEAD' || to === 'LEAVING') {
      this.server.hashRing.removeNode(url);
    }

    // Trigger dynamic rebalancing (Phase 12) after ring configuration changes
    this.rebalancer.triggerRebalance();
  }

  /**
   * Background task: Pick a random node and exchange gossip lists.
   */
  private async gossipRound(): Promise<void> {
    const localUrl = `http://${this.server.host}:${this.server.port}`;
    
    // 1. Tick our own heartbeat
    const local = this.membership.get(localUrl);
    if (local) {
      local.heartbeat += 1;
      local.lastUpdated = Date.now();
      this.membership.set(localUrl, local);
    }

    // 2. Select eligible peers (active and not ourselves)
    const peers = Array.from(this.membership.entries()).filter(([url, info]) => {
      return url !== localUrl && info.status !== 'DEAD' && info.status !== 'LEAVING';
    });

    if (peers.length === 0) return;

    // Pick a random peer
    const randomIndex = Math.floor(Math.random() * peers.length);
    const [targetUrl, targetInfo] = peers[randomIndex];

    try {
      // 3. Send our membership list and merge returned list
      const response = await fetch(`${targetUrl}/gossip/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: this.server.id,
          membershipList: this.getMembershipList()
        }),
        signal: AbortSignal.timeout(this.pingIntervalMs - 100) // Ensure timeout is shorter than interval
      });

      if (response.ok) {
        const data = await response.json();
        if (data.membershipList) {
          this.receiveGossip(targetInfo.id, data.membershipList);
        }
      } else {
        // Direct ping HTTP failed, initiate suspicion path
        this.suspectNode(targetUrl);
      }
    } catch (err) {
      // Network timeout / unreachability, initiate suspicion path
      this.suspectNode(targetUrl);
    }
  }

  /**
   * Marks a node as SUSPECT and triggers indirect probes.
   */
  private suspectNode(url: string): void {
    const member = this.membership.get(url);
    if (!member || member.status === 'SUSPECT' || member.status === 'DEAD' || member.status === 'LEAVING') return;

    const oldStatus = member.status;
    member.status = 'SUSPECT';
    member.lastUpdated = Date.now();
    this.membership.set(url, member);

    this.handleStatusTransition(url, member.id, oldStatus, 'SUSPECT');

    // SWIM indirect probe implementation:
    // Request other active nodes to check if they can reach the suspect node.
    // In our simplified yet robust version: the suspicion will propagate via gossip.
    // If the suspect node does not increment its heartbeat and refute within suspectTimeoutMs,
    // the node will be transitioned to DEAD.
  }

  /**
   * Monitor peer updates and transition SUSPECT nodes to DEAD if they timeout.
   */
  private checkFailures(): void {
    const now = Date.now();
    
    for (const [url, info] of this.membership.entries()) {
      const localUrl = `http://${this.server.host}:${this.server.port}`;
      if (url === localUrl) continue;

      if (info.status === 'SUSPECT') {
        const timeSinceUpdated = now - info.lastUpdated;
        if (timeSinceUpdated > this.suspectTimeoutMs) {
          // Suspect period expired without refutation (heartbeat update), mark DEAD!
          const oldStatus = info.status;
          info.status = 'DEAD';
          info.lastUpdated = now;
          this.membership.set(url, info);

          this.handleStatusTransition(url, info.id, oldStatus, 'DEAD');
        }
      }
    }
  }
}
