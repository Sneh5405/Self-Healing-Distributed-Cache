export {};

const PROXY_URL = 'http://localhost:8000';
const NUM_KEYS = 2000;
const TTL_SECONDS = 300; // 5 minutes
const CONCURRENCY_LIMIT = 50; // number of parallel requests

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createKeys() {
  console.log(`[Stress Test Seeder] Preparing to write ${NUM_KEYS} keys to cluster at ${PROXY_URL}...`);
  console.log(`[Stress Test Seeder] Key TTL: ${TTL_SECONDS}s (5 minutes), Concurrency limit: ${CONCURRENCY_LIMIT}`);
  
  const startTime = Date.now();
  let successCount = 0;
  let failureCount = 0;

  // Generate key list
  const keys = Array.from({ length: NUM_KEYS }, (_, i) => `stress_key_${i + 1}`);

  // Helper to execute request with retry
  async function writeKey(key: string, attempt = 1): Promise<boolean> {
    try {
      const response = await fetch(`${PROXY_URL}/keys/${key}?consistency=QUORUM`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: `stress_val_${key}_${Math.random().toString(36).substring(2, 8)}`,
          ttlSeconds: TTL_SECONDS
        }),
        signal: AbortSignal.timeout(2000)
      });

      if (response.ok) {
        return true;
      } else {
        const errorText = await response.text().catch(() => '');
        console.warn(`[Warning] Failed to write ${key} (status ${response.status}): ${errorText}`);
        return false;
      }
    } catch (err: any) {
      if (attempt < 3) {
        // Wait a bit and retry
        await wait(100 * attempt);
        return writeKey(key, attempt + 1);
      }
      console.error(`[Error] Failed to write ${key} after 3 attempts: ${err.message}`);
      return false;
    }
  }

  // Process keys in batches or pool
  const pool: Promise<void>[] = [];
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < keys.length) {
      const keyIndex = currentIndex++;
      const key = keys[keyIndex];
      
      const success = await writeKey(key);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }

      if ((successCount + failureCount) % 100 === 0) {
        const progress = (((successCount + failureCount) / NUM_KEYS) * 100).toFixed(0);
        console.log(`[Stress Test Seeder] Progress: ${successCount + failureCount}/${NUM_KEYS} (${progress}%) - Success: ${successCount}, Failures: ${failureCount}`);
      }
    }
  }

  // Start workers
  const workers = Array.from({ length: CONCURRENCY_LIMIT }, () => worker());
  await Promise.all(workers);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n=============================================================');
  console.log('              SEEDING COMPLETE                               ');
  console.log('=============================================================');
  console.log(`  Total Keys Target:   ${NUM_KEYS}`);
  console.log(`  Successfully Seeded: ${successCount}`);
  console.log(`  Failed to Seed:      ${failureCount}`);
  console.log(`  Total Duration:      ${duration} seconds`);
  console.log(`  Seeding Rate:        ${(successCount / parseFloat(duration)).toFixed(2)} keys/sec`);
  console.log('=============================================================\n');

  if (failureCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

createKeys().catch((err) => {
  console.error('[Stress Test Seeder] Critical error during seeding:', err);
  process.exit(1);
});
