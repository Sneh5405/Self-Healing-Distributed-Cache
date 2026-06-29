export {};

const PROXY_URL = 'http://localhost:8000';
const CONCURRENCY = 150;
const DURATION_MS = 25000; // Run for 25 seconds (enough to trigger scale up)

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoadSimulation() {
  console.log(`[Load Simulator] Starting load simulation...`);
  console.log(`[Load Simulator] Target: ${PROXY_URL}`);
  console.log(`[Load Simulator] Concurrency: ${CONCURRENCY} workers`);
  console.log(`[Load Simulator] Duration: ${DURATION_MS / 1000} seconds`);

  let requestCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let isRunning = true;

  // Track start time
  const startTime = Date.now();

  // Print progress periodically
  const progressTimer = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const currentRps = requestCount / elapsed;
    console.log(`[Load Simulator] Progress: Sent ${requestCount} requests, Success: ${successCount}, Errors: ${errorCount} (Avg RPS: ${currentRps.toFixed(1)})`);
  }, 3000);

  // Stop after duration
  setTimeout(() => {
    isRunning = false;
    clearInterval(progressTimer);
  }, DURATION_MS);

  // Worker loop
  async function worker() {
    while (isRunning) {
      const keyId = Math.floor(Math.random() * 1000);
      const key = `stress_key_${keyId}`;
      const isWrite = Math.random() > 0.8; // 20% writes, 80% reads
      
      requestCount++;
      try {
        let response: Response;
        if (isWrite) {
          response = await fetch(`${PROXY_URL}/keys/${key}?consistency=ONE`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              value: `load_val_${Math.random().toString(36).substring(2, 6)}`,
              ttlSeconds: 300
            }),
            signal: AbortSignal.timeout(1000)
          });
        } else {
          response = await fetch(`${PROXY_URL}/keys/${key}?consistency=ONE`, {
            signal: AbortSignal.timeout(1000)
          });
        }

        if (response.ok || response.status === 404) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }
    }
  }

  // Spawn parallel workers
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const duration = (Date.now() - startTime) / 1000;
  console.log('\n=============================================================');
  console.log('              LOAD SIMULATION COMPLETE                       ');
  console.log('=============================================================');
  console.log(`  Total Requests Sent: ${requestCount}`);
  console.log(`  Successful Requests: ${successCount}`);
  console.log(`  Failed Requests:     ${errorCount}`);
  console.log(`  Total Duration:      ${duration.toFixed(2)} seconds`);
  console.log(`  Final Throughput:    ${(requestCount / duration).toFixed(2)} req/sec`);
  console.log('=============================================================\n');

  console.log('[Load Simulator] Load stopped. Waiting 15 seconds to observe scale down logs...');
  await wait(15000);
  console.log('[Load Simulator] Completed.');
}

runLoadSimulation().catch((err) => {
  console.error('[Load Simulator] Critical error:', err);
});
