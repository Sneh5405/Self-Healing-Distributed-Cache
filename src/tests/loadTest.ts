import { CacheNodeServer } from '../network/server';
import { ClientProxy } from '../network/proxy';

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoadTest() {
  const ports = [9001, 9002, 9003, 9004, 9005];
  const host = 'localhost';
  const seeds = ports.map((port) => `http://${host}:${port}`);
  
  console.log('[Resilience Test] Initializing 5 cache nodes on ports 9001-9005...');
  const nodes: CacheNodeServer[] = [];
  for (const port of ports) {
    const node = new CacheNodeServer(port, host);
    await node.start();
    node.initializeCluster(seeds, 2); // Replication factor 2
    nodes.push(node);
  }

  console.log('[Resilience Test] Initializing Proxy Gateway on port 9000...');
  const proxy = new ClientProxy({
    port: 9000,
    seedUrls: seeds,
    replicationFactor: 2,
    maxRetries: 1 // Crucial for zero-failed client requests: 1 retry on replica
  });
  await proxy.start();

  // Wait a moment for gossip to establish initial membership
  console.log('[Resilience Test] Waiting 2 seconds for gossip convergence...');
  await wait(2000);

  // State variables for traffic simulation
  let totalRequests = 0;
  let successRequests = 0;
  let failedRequests = 0;
  let isTrafficRunning = true;
  const activeKeys = new Set<string>();

  // Start continuous read/write traffic stream in background
  const trafficPromise = (async () => {
    while (isTrafficRunning) {
      totalRequests++;
      const opType = Math.random() > 0.5 ? 'WRITE' : 'READ';
      const keyId = Math.floor(Math.random() * 50);
      const key = `load_test_key_${keyId}`;

      try {
        if (opType === 'WRITE') {
          const value = `val_${Math.random().toString(36).substring(2, 6)}`;
          const response = await fetch(`http://localhost:9000/keys/${key}?consistency=QUORUM`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value, ttlSeconds: 30 }),
            signal: AbortSignal.timeout(1000)
          });
          
          if (response.ok) {
            successRequests++;
            activeKeys.add(key);
          } else {
            failedRequests++;
            console.error(`[Resilience Test] Client write returned error: ${response.status}`);
          }
        } else {
          // READ operation
          const response = await fetch(`http://localhost:9000/keys/${key}?consistency=ONE`, {
            signal: AbortSignal.timeout(1000)
          });
          
          // It is acceptable if key is not found (404) during initial writes,
          // but the request itself must succeed (HTTP status 200 or 404).
          // An HTTP 5xx error or connection drop constitutes a failure.
          if (response.ok || response.status === 404) {
            successRequests++;
          } else {
            failedRequests++;
            console.error(`[Resilience Test] Client read returned error status: ${response.status}`);
          }
        }
      } catch (err: any) {
        failedRequests++;
        console.error(`[Resilience Test] Client connection error: ${err.message}`);
      }

      await wait(50); // Fire operations every 50ms (20 ops/sec)
    }
  })();

  // 1. Let load test run normally for 4 seconds
  console.log('[Resilience Test] Injecting read/write traffic...');
  await wait(4000);
  console.log(`[Resilience Test] Stats mid-run: Sent ${totalRequests} operations, Success: ${successRequests}, Failures: ${failedRequests}`);

  // 2. Mid-traffic, kill a random node
  const nodeIndexToKill = Math.floor(Math.random() * nodes.length);
  const targetNode = nodes[nodeIndexToKill];
  const targetPort = targetNode.port;
  console.log(`\n💥💥💥 [Resilience Test] FAULT INJECTION: Killing Node on port ${targetPort} mid-traffic! 💥💥💥\n`);
  
  // Call internal stop to simulate hard exit
  await targetNode.stop();

  // 3. Keep traffic running for another 6 seconds to verify failover routing
  console.log('[Resilience Test] Traffic continuing. Verifying cluster handles failover routing...');
  await wait(6000);

  // Stop traffic
  isTrafficRunning = false;
  await trafficPromise;

  console.log('\n=============================================================');
  console.log('              CHAOS RESILIENCE TEST REPORT                   ');
  console.log('=============================================================');
  console.log(`  Total Client Requests Sent:  ${totalRequests}`);
  console.log(`  Successful Client Requests:  ${successRequests}`);
  console.log(`  Failed Client Requests:      ${failedRequests}`);
  console.log('-------------------------------------------------------------');
  
  if (failedRequests === 0) {
    console.log('  RESULT: SUCCESS 🟢 (Survived random node crash with 0 failed requests!)');
  } else {
    console.log(`  RESULT: FAILURE 🔴 (${failedRequests} requests failed during crash window)`);
  }
  console.log('=============================================================\n');

  // Tear down remaining nodes and proxy
  console.log('[Resilience Test] Shutting down cluster...');
  await proxy.stop();
  for (let i = 0; i < nodes.length; i++) {
    if (i !== nodeIndexToKill) {
      await nodes[i].stop();
    }
  }

  if (failedRequests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runLoadTest().catch((err) => {
  console.error('[Resilience Test] Test crashed with error:', err);
  process.exit(1);
});
