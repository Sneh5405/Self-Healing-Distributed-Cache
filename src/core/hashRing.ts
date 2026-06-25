import * as crypto from 'crypto';

/**
 * Computes a 32-bit unsigned integer hash of a string using SHA-256.
 */
export function hashSHA256(value: string): number {
  const hexHash = crypto.createHash('sha256').update(value).digest('hex');
  // Take the first 8 hex characters (32 bits) and convert to a number
  return parseInt(hexHash.substring(0, 8), 16);
}

export class ConsistentHashRing {
  private vnodesCount: number;
  private ring: number[] = []; // Sorted array of virtual node hashes
  private vnodeToNodeMap: Map<number, string> = new Map(); // hash -> physicalNodeUrl
  private physicalNodes: Set<string> = new Set(); // List of unique physical nodes (e.g. "http://localhost:8001")

  constructor(vnodesCount: number = 40) {
    this.vnodesCount = vnodesCount;
  }

  /**
   * Adds a physical node to the ring.
   * Generates virtual nodes to ensure even distribution.
   */
  public addNode(nodeUrl: string): void {
    if (this.physicalNodes.has(nodeUrl)) return;
    this.physicalNodes.add(nodeUrl);

    for (let i = 0; i < this.vnodesCount; i++) {
      // Create a unique identifier for each virtual node
      const vnodeId = `${nodeUrl}-vnode-${i}`;
      const hash = hashSHA256(vnodeId);
      
      this.ring.push(hash);
      this.vnodeToNodeMap.set(hash, nodeUrl);
    }

    // Sort the ring in ascending order
    this.ring.sort((a, b) => a - b);
  }

  /**
   * Removes a physical node from the ring.
   */
  public removeNode(nodeUrl: string): void {
    if (!this.physicalNodes.has(nodeUrl)) return;
    this.physicalNodes.delete(nodeUrl);

    for (let i = 0; i < this.vnodesCount; i++) {
      const vnodeId = `${nodeUrl}-vnode-${i}`;
      const hash = hashSHA256(vnodeId);
      
      // Remove hash from the ring array
      const index = this.ring.indexOf(hash);
      if (index > -1) {
        this.ring.splice(index, 1);
      }
      this.vnodeToNodeMap.delete(hash);
    }
  }

  /**
   * Finds the primary node responsible for the given key.
   */
  public getNodeForKey(key: string): string | null {
    if (this.ring.length === 0) return null;

    const hash = hashSHA256(key);
    const index = this.bisectRight(hash);
    
    // If index matches ring length, we wrap around to 0
    const targetHash = this.ring[index % this.ring.length];
    return this.vnodeToNodeMap.get(targetHash) || null;
  }

  /**
   * Finds the primary node and the successive replica nodes for the given key.
   * Ensures that we return up to `count` unique physical nodes.
   */
  public getNodesForKey(key: string, count: number): string[] {
    if (this.ring.length === 0 || count <= 0) return [];

    const hash = hashSHA256(key);
    const startIndex = this.bisectRight(hash);
    const resultNodes: string[] = [];
    const seenNodes = new Set<string>();

    const totalVnodes = this.ring.length;
    // Iterate clockwise through the ring to find unique physical nodes
    for (let i = 0; i < totalVnodes; i++) {
      const targetHash = this.ring[(startIndex + i) % totalVnodes];
      const physicalNode = this.vnodeToNodeMap.get(targetHash);
      
      if (physicalNode && !seenNodes.has(physicalNode)) {
        seenNodes.add(physicalNode);
        resultNodes.push(physicalNode);
        
        // Break early if we've collected enough unique replicas
        if (resultNodes.length === count) {
          break;
        }
      }
    }

    return resultNodes;
  }

  /**
   * Returns list of all active physical nodes in the ring.
   */
  public getPhysicalNodes(): string[] {
    return Array.from(this.physicalNodes);
  }

  /**
   * Helper function: binary search to find insertion point (equivalent to Python's bisect_right)
   */
  private bisectRight(hash: number): number {
    let low = 0;
    let high = this.ring.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (hash < this.ring[mid]) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    return low;
  }
}
