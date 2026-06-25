export interface CacheEntry {
  value: string;
  expiry: number | null; // Epoch ms when key expires
  timestamp: number;     // Epoch ms when key was written (for LWW conflict resolution)
  version: number;       // Version counter for the key
}

export class InMemoryStore {
  private data: Map<string, CacheEntry> = new Map();
  private ttlInterval: NodeJS.Timeout | null = null;
  private maxMemoryBytes: number = Infinity;
  private evictionPolicy: 'LRU' | 'LFU' | 'NONE' = 'NONE';
  
  // Track metadata for evictions
  private accessTimes: Map<string, number> = new Map(); // key -> last accessed timestamp (LRU)
  private accessCounts: Map<string, number> = new Map(); // key -> access count (LFU)

  constructor(options?: { maxMemoryBytes?: number; evictionPolicy?: 'LRU' | 'LFU' | 'NONE'; ttlScanIntervalMs?: number }) {
    if (options?.maxMemoryBytes !== undefined) {
      this.maxMemoryBytes = options.maxMemoryBytes;
    }
    if (options?.evictionPolicy) {
      this.evictionPolicy = options.evictionPolicy;
    }
    // Start active background TTL scanner
    const scanInterval = options?.ttlScanIntervalMs || 1000;
    this.ttlInterval = setInterval(() => this.scanTTL(), scanInterval);
  }

  /**
   * Set a key-value pair in the store with optional TTL and write timestamp.
   */
  public set(key: string, value: string, ttlSeconds?: number, timestamp?: number): void {
    const now = Date.now();
    const expiry = ttlSeconds ? now + ttlSeconds * 1000 : null;
    const writeTimestamp = timestamp !== undefined ? timestamp : now;
    
    const existing = this.data.get(key);
    const version = existing ? existing.version + 1 : 1;

    // Put data
    this.data.set(key, {
      value,
      expiry,
      timestamp: writeTimestamp,
      version,
    });

    // Update access metadata
    this.accessTimes.set(key, now);
    this.accessCounts.set(key, (this.accessCounts.get(key) || 0) + 1);

    // Enforce memory limits if exceeded
    this.enforceMemoryLimit();
  }

  /**
   * Get an entry from the store. Updates access metadata for eviction policies.
   */
  public get(key: string): CacheEntry | null {
    const entry = this.data.get(key);
    if (!entry) return null;

    // Check if expired (lazy deletion)
    if (entry.expiry !== null && entry.expiry < Date.now()) {
      this.delete(key);
      return null;
    }

    // Update access metadata
    this.accessTimes.set(key, Date.now());
    this.accessCounts.set(key, (this.accessCounts.get(key) || 0) + 1);

    return entry;
  }

  /**
   * Delete a key from the store.
   */
  public delete(key: string): boolean {
    this.accessTimes.delete(key);
    this.accessCounts.delete(key);
    return this.data.delete(key);
  }

  /**
   * Returns list of all active non-expired keys.
   */
  public keys(): string[] {
    const now = Date.now();
    const activeKeys: string[] = [];
    for (const [key, entry] of this.data.entries()) {
      if (entry.expiry === null || entry.expiry >= now) {
        activeKeys.push(key);
      } else {
        // Lazy cleanup
        this.delete(key);
      }
    }
    return activeKeys;
  }

  /**
   * Gets direct access to the data map (read-only style recommended).
   */
  public getRawData(): Map<string, CacheEntry> {
    return this.data;
  }

  /**
   * Calculate memory usage dynamically based on sizes of keys and values.
   */
  public getMemoryUsage(): number {
    let totalBytes = 0;
    for (const [key, entry] of this.data.entries()) {
      totalBytes += key.length * 2; // Node.js strings are roughly 2 bytes per character
      totalBytes += entry.value.length * 2;
      totalBytes += 8; // expiry (number/null)
      totalBytes += 8; // timestamp (number)
      totalBytes += 8; // version (number)
    }
    return totalBytes;
  }

  /**
   * Set a dynamic memory limit in bytes.
   */
  public setMaxMemory(limitBytes: number): void {
    this.maxMemoryBytes = limitBytes;
    this.enforceMemoryLimit();
  }

  /**
   * Set eviction policy dynamically.
   */
  public setEvictionPolicy(policy: 'LRU' | 'LFU' | 'NONE'): void {
    this.evictionPolicy = policy;
    this.enforceMemoryLimit();
  }

  /**
   * Evicts keys if the memory usage exceeds the max limit.
   */
  private enforceMemoryLimit(): void {
    while (this.getMemoryUsage() > this.maxMemoryBytes && this.data.size > 0) {
      const keyToEvict = this.selectKeyToEvict();
      if (keyToEvict) {
        this.delete(keyToEvict);
      } else {
        break; // Guard against infinite loop
      }
    }
  }

  /**
   * Selects a key to evict based on the active eviction policy.
   */
  private selectKeyToEvict(): string | null {
    if (this.data.size === 0) return null;

    if (this.evictionPolicy === 'LRU') {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const key of this.data.keys()) {
        const time = this.accessTimes.get(key) || 0;
        if (time < oldestTime) {
          oldestTime = time;
          oldestKey = key;
        }
      }
      return oldestKey;
    } else if (this.evictionPolicy === 'LFU') {
      let leastFrequentKey: string | null = null;
      let lowestCount = Infinity;
      for (const key of this.data.keys()) {
        const count = this.accessCounts.get(key) || 0;
        if (count < lowestCount) {
          lowestCount = count;
          leastFrequentKey = key;
        }
      }
      return leastFrequentKey;
    } else {
      // Default to FIFO if policy is NONE but we hit limit constraints
      return this.data.keys().next().value || null;
    }
  }

  /**
   * Scan and purge expired keys.
   */
  private scanTTL(): void {
    const now = Date.now();
    for (const [key, entry] of this.data.entries()) {
      if (entry.expiry !== null && entry.expiry < now) {
        this.delete(key);
      }
    }
  }

  /**
   * Stop background timers.
   */
  public close(): void {
    if (this.ttlInterval) {
      clearInterval(this.ttlInterval);
      this.ttlInterval = null;
    }
  }
}
