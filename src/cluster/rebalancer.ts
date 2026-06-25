import { CacheNodeServer } from '../network/server';

export class ClusterRebalancer {
  private server: CacheNodeServer;
  private isRebalancing: boolean = false;

  constructor(server: CacheNodeServer) {
    this.server = server;
  }

  /**
   * Triggers a background rebalancing process.
   * Scans all keys, checks if they are still owned by this node,
   * and migrates them if they have shifted due to ring changes.
   */
  public async triggerRebalance(): Promise<void> {
    if (this.isRebalancing) {
      console.log(`[Node ${this.server.id}] Rebalance already in progress. Skipping.`);
      return;
    }

    const ring = this.server.hashRing;
    const repManager = this.server.replicationManager;
    
    if (!ring || !repManager) {
      return;
    }

    this.isRebalancing = true;
    this.server.broadcast({ type: 'rebalance_start', nodeId: this.server.id });
    console.log(`[Node ${this.server.id}] Starting cluster rebalance...`);

    try {
      const keys = this.server.store.keys();
      const localUrl = `http://${this.server.host}:${this.server.port}`;
      const replicationFactor = 2; // Default replication factor

      // Group keys by their destination target
      const migrationGroups: Map<string, string[]> = new Map();
      const keysToDelete: string[] = [];

      for (const key of keys) {
        const targets = ring.getNodesForKey(key, replicationFactor);
        
        // If local node is not in the top N targets for this key, it means
        // this node is no longer responsible for it (it has been pushed out).
        const isLocalResponsible = targets.includes(localUrl);

        if (!isLocalResponsible) {
          // Find the new primary node for this key
          const newPrimary = targets[0];
          if (newPrimary) {
            if (!migrationGroups.has(newPrimary)) {
              migrationGroups.set(newPrimary, []);
            }
            migrationGroups.get(newPrimary)!.push(key);
          }
          keysToDelete.push(key);
        } else {
          // If we ARE responsible, but there are other replicas in the targets that
          // might not have this key yet (e.g. a new node joined and became a replica),
          // we should push it to them.
          for (const target of targets) {
            if (target !== localUrl) {
              if (!migrationGroups.has(target)) {
                migrationGroups.set(target, []);
              }
              // Add key if not already there
              if (!migrationGroups.get(target)!.includes(key)) {
                migrationGroups.get(target)!.push(key);
              }
            }
          }
        }
      }

      // Execute migrations sequentially in batches to prevent network congestion
      for (const [targetUrl, keysToMove] of migrationGroups.entries()) {
        if (keysToMove.length === 0) continue;

        console.log(`[Node ${this.server.id}] Migrating ${keysToMove.length} keys to ${targetUrl}...`);
        
        // Migrate in batches of 50
        const batchSize = 50;
        for (let i = 0; i < keysToMove.length; i += batchSize) {
          const batch = keysToMove.slice(i, i + batchSize);
          try {
            await repManager.migrateKeys(targetUrl, batch);
            await new Promise((resolve) => setTimeout(resolve, 50)); // Small yield between batches
          } catch (err: any) {
            console.error(`[Node ${this.server.id}] Failed to migrate batch to ${targetUrl}:`, err.message);
          }
        }
      }

      // Clean up local keys that we no longer own
      let deletedCount = 0;
      for (const key of keysToDelete) {
        const targets = ring.getNodesForKey(key, replicationFactor);
        if (!targets.includes(localUrl)) {
          this.server.store.delete(key);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        console.log(`[Node ${this.server.id}] Cleared ${deletedCount} local keys after successful migration`);
      }

      console.log(`[Node ${this.server.id}] Cluster rebalance finished successfully.`);
      this.server.broadcast({ type: 'rebalance_success', nodeId: this.server.id, migratedCount: deletedCount });
    } catch (err: any) {
      console.error(`[Node ${this.server.id}] Rebalance error:`, err.message);
      this.server.broadcast({ type: 'rebalance_failed', nodeId: this.server.id, error: err.message });
    } finally {
      this.isRebalancing = false;
    }
  }
}
