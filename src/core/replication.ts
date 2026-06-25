import { CacheNodeServer } from '../network/server';
import { CacheEntry } from './store';
import { ConsistentHashRing } from './hashRing';

export class ReplicationManager {
  private server: CacheNodeServer;
  private N: number; // Replication factor

  constructor(server: CacheNodeServer, replicationFactor: number = 2) {
    this.server = server;
    this.N = replicationFactor;
  }

  /**
   * Writes a key to the responsible nodes on the consistent hash ring.
   * Respects consistency levels: ONE, QUORUM, ALL.
   */
  public async writeKey(
    key: string,
    value: string,
    ttlSeconds?: number,
    consistency: string = 'QUORUM',
    timestamp?: number
  ): Promise<{ success: boolean; writtenNodes: string[] }> {
    const writeTimestamp = timestamp !== undefined ? timestamp : Date.now();
    const ring = this.server.hashRing;
    
    if (!ring) {
      throw new Error('Hash ring is not initialized');
    }

    // Identify target physical nodes from the ring
    const targets = ring.getNodesForKey(key, this.N);
    if (targets.length === 0) {
      throw new Error('No target nodes found in hash ring');
    }

    // Determine required number of successful writes
    let requiredAcks = 1;
    if (consistency === 'QUORUM') {
      requiredAcks = Math.floor(targets.length / 2) + 1;
    } else if (consistency === 'ALL') {
      requiredAcks = targets.length;
    }

    const promises = targets.map(async (nodeUrl) => {
      const isLocal = nodeUrl === `http://${this.server.host}:${this.server.port}`;
      
      if (isLocal) {
        try {
          this.server.store.set(key, value, ttlSeconds, writeTimestamp);
          return { nodeUrl, success: true };
        } catch (err) {
          return { nodeUrl, success: false };
        }
      }

      // Remote write
      try {
        const response = await fetch(`${nodeUrl}/local/keys/${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value, ttlSeconds, timestamp: writeTimestamp }),
          signal: AbortSignal.timeout(1000)
        });
        return { nodeUrl, success: response.ok };
      } catch (err) {
        return { nodeUrl, success: false };
      }
    });

    const results = await Promise.all(promises);
    const successfulNodes = results.filter((r) => r.success).map((r) => r.nodeUrl);

    if (successfulNodes.length < requiredAcks) {
      throw {
        status: 503,
        message: `Write quorum failed. Required ${requiredAcks} acks, but only got ${successfulNodes.length}.`
      };
    }

    return {
      success: true,
      writtenNodes: successfulNodes
    };
  }

  /**
   * Reads a key from the responsible nodes.
   * Implements failover routing and quorum reads with Last-Write-Wins (LWW) conflict resolution.
   */
  public async readKey(key: string, consistency: string = 'ONE'): Promise<{ key: string; value: string; timestamp: number }> {
    const ring = this.server.hashRing;
    if (!ring) {
      throw new Error('Hash ring is not initialized');
    }

    const targets = ring.getNodesForKey(key, this.N);
    if (targets.length === 0) {
      throw new Error('No target nodes found in hash ring');
    }

    // Determine consistency requirement
    let requiredReads = 1;
    if (consistency === 'QUORUM') {
      requiredReads = Math.floor(targets.length / 2) + 1;
    } else if (consistency === 'ALL') {
      requiredReads = targets.length;
    }

    // If consistency is ONE, we can optimize by trying replicas sequentially (Failover Routing)
    if (consistency === 'ONE') {
      for (const nodeUrl of targets) {
        const isLocal = nodeUrl === `http://${this.server.host}:${this.server.port}`;
        
        try {
          if (isLocal) {
            const entry = this.server.store.get(key);
            if (entry) {
              return { key, value: entry.value, timestamp: entry.timestamp };
            }
          } else {
            const response = await fetch(`${nodeUrl}/local/keys/${key}`, {
              signal: AbortSignal.timeout(1000)
            });
            if (response.ok) {
              const entry = await response.json() as CacheEntry;
              return { key, value: entry.value, timestamp: entry.timestamp };
            }
          }
        } catch (err) {
          // Attempt failover to next node in the list
          console.warn(`[Node ${this.server.id}] Failover: failed to read from ${nodeUrl}, trying next replica...`);
        }
      }
      
      throw { status: 404, message: `Key "${key}" not found on any replica` };
    }

    // For QUORUM or ALL: Query multiple replicas concurrently
    const readPromises = targets.map(async (nodeUrl) => {
      const isLocal = nodeUrl === `http://${this.server.host}:${this.server.port}`;
      try {
        if (isLocal) {
          const entry = this.server.store.get(key);
          return { nodeUrl, entry, success: true };
        } else {
          const response = await fetch(`${nodeUrl}/local/keys/${key}`, {
            signal: AbortSignal.timeout(1000)
          });
          if (response.status === 404) {
            return { nodeUrl, entry: null, success: true }; // node responded, key doesn't exist
          }
          if (response.ok) {
            const entry = await response.json() as CacheEntry;
            return { nodeUrl, entry, success: true };
          }
        }
      } catch (err) {}
      return { nodeUrl, entry: null, success: false };
    });

    const readResults = await Promise.all(readPromises);
    const successfulResponses = readResults.filter((r) => r.success);

    if (successfulResponses.length < requiredReads) {
      throw {
        status: 503,
        message: `Read quorum failed. Required ${requiredReads} successful responses, got ${successfulResponses.length}.`
      };
    }

    // Resolve conflicts using Last-Write-Wins (LWW) based on physical timestamps
    let newestEntry: CacheEntry | null = null;
    let newestNodeUrl: string | null = null;

    for (const res of successfulResponses) {
      if (res.entry) {
        if (!newestEntry || res.entry.timestamp > newestEntry.timestamp) {
          newestEntry = res.entry;
          newestNodeUrl = res.nodeUrl;
        }
      }
    }

    if (!newestEntry) {
      throw { status: 404, message: `Key "${key}" not found` };
    }

    // Read Repair: update any replica that had an outdated value or was missing the key
    this.triggerReadRepair(key, newestEntry, successfulResponses);

    return {
      key,
      value: newestEntry.value,
      timestamp: newestEntry.timestamp
    };
  }

  /**
   * Triggers a background write to update replicas with outdated/missing entries.
   */
  private triggerReadRepair(key: string, correctEntry: CacheEntry, readResponses: Array<{ nodeUrl: string, entry: CacheEntry | null, success: boolean }>): void {
    const ttlSeconds = correctEntry.expiry ? Math.max(0, Math.ceil((correctEntry.expiry - Date.now()) / 1000)) : undefined;

    readResponses.forEach(async (res) => {
      // If the node responded successfully, but had no entry OR an older timestamp
      if (res.success && (!res.entry || res.entry.timestamp < correctEntry.timestamp)) {
        const isLocal = res.nodeUrl === `http://${this.server.host}:${this.server.port}`;
        
        try {
          if (isLocal) {
            this.server.store.set(key, correctEntry.value, ttlSeconds, correctEntry.timestamp);
          } else {
            await fetch(`${res.nodeUrl}/local/keys/${key}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: correctEntry.value, ttlSeconds, timestamp: correctEntry.timestamp }),
              signal: AbortSignal.timeout(1000)
            });
          }
          console.log(`[Node ${this.server.id}] Read-repair completed for key "${key}" on replica ${res.nodeUrl}`);
        } catch (err) {
          console.warn(`[Node ${this.server.id}] Read-repair failed on replica ${res.nodeUrl}:`, err);
        }
      }
    });
  }

  /**
   * Deletes a key from all responsible nodes.
   */
  public async deleteKey(key: string): Promise<{ success: boolean; deletedNodes: string[] }> {
    const ring = this.server.hashRing;
    if (!ring) {
      throw new Error('Hash ring is not initialized');
    }

    const targets = ring.getNodesForKey(key, this.N);
    const promises = targets.map(async (nodeUrl) => {
      const isLocal = nodeUrl === `http://${this.server.host}:${this.server.port}`;
      
      if (isLocal) {
        const deleted = this.server.store.delete(key);
        return { nodeUrl, success: deleted };
      }

      try {
        const response = await fetch(`${nodeUrl}/local/keys/${key}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(1000)
        });
        const data = await response.json();
        return { nodeUrl, success: data.success };
      } catch (err) {
        return { nodeUrl, success: false };
      }
    });

    const results = await Promise.all(promises);
    const successfulNodes = results.filter((r) => r.success).map((r) => r.nodeUrl);

    return {
      success: successfulNodes.length > 0,
      deletedNodes: successfulNodes
    };
  }

  /**
   * Migrates a set of keys to a target node.
   */
  public async migrateKeys(targetNodeUrl: string, keysToMigrate: string[]): Promise<void> {
    const batch: Array<{ key: string; entry: CacheEntry }> = [];
    
    for (const key of keysToMigrate) {
      const entry = this.server.store.get(key);
      if (entry) {
        batch.push({ key, entry });
      }
    }

    if (batch.length === 0) return;

    const response = await fetch(`${targetNodeUrl}/rebalance/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: batch }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Migration target HTTP error ${response.status}`);
    }

    console.log(`[Node ${this.server.id}] Successfully migrated ${batch.length} keys to ${targetNodeUrl}`);
  }

  /**
   * Flushes all keys currently held locally that will not be owned by this node
   * after leaving the cluster. (Used during graceful node departure).
   */
  public async handleGracefulLeave(): Promise<void> {
    const ring = this.server.hashRing;
    const gossip = this.server.gossipManager;
    if (!ring || !gossip) return;

    // Get all keys currently stored locally
    const keys = this.server.store.keys();
    if (keys.length === 0) return;

    const localUrl = `http://${this.server.host}:${this.server.port}`;

    // Get active nodes from gossip (excluding this leaving node)
    const activePeers = gossip.getMembershipList()
      .filter((m) => m.status === 'ALIVE' && `http://${m.host}:${m.port}` !== localUrl)
      .map((m) => `http://${m.host}:${m.port}`);

    if (activePeers.length === 0) {
      console.log(`[Node ${this.server.id}] No active peers to migrate keys to. Graceful leave complete.`);
      return;
    }

    // Build a temporary ring representing the cluster after this node leaves
    const tempRing = new ConsistentHashRing(40);
    for (const peerUrl of activePeers) {
      tempRing.addNode(peerUrl);
    }

    // Group keys by their new target nodes in the new ring configuration
    const migrationGroups: Map<string, string[]> = new Map();

    for (const key of keys) {
      // Find where this key should be placed now that this node is leaving
      const newTargets = tempRing.getNodesForKey(key, this.N);
      if (newTargets.length > 0) {
        const primaryTarget = newTargets[0];
        if (!migrationGroups.has(primaryTarget)) {
          migrationGroups.set(primaryTarget, []);
        }
        migrationGroups.get(primaryTarget)!.push(key);
      }
    }

    // Migrate keys to their new destinations
    const migrationPromises = Array.from(migrationGroups.entries()).map(async ([targetUrl, keysToMigrate]) => {
      try {
        console.log(`[Node ${this.server.id}] Leaving: Handing off ${keysToMigrate.length} keys to ${targetUrl}...`);
        await this.migrateKeys(targetUrl, keysToMigrate);
      } catch (err: any) {
        console.error(`[Node ${this.server.id}] Leaving: Failed to hand off keys to ${targetUrl}:`, err.message);
      }
    });

    await Promise.all(migrationPromises);
    console.log(`[Node ${this.server.id}] All handoffs completed for graceful leave.`);
  }
}
