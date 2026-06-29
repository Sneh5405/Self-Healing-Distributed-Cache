import { CacheNodeServer } from '../network/server';
import { ClientProxy } from '../network/proxy';

export {};

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAutoscaleTest() {
  const ports = [9001, 9002, 9003];
  const host = 'localhost';
  const seeds = ports.map((port) => `http://${host}:${port}`);
  
  console.log('[Autoscale Test] Bootstrapping test cluster with 3 nodes (ports 9001-9003)...');
  const nodes: CacheNodeServer[] = [];
  for (const port of ports) {
    const node = new CacheNodeServer(port, host);
    await node.start();
    node.initializeCluster(seeds, 2);
    nodes.push(node);
  }

  console.log('[Autoscale Test] Starting Client Proxy on port 9000 with sensitive thresholds...');
  // Configure client proxy with low thresholds and short cooldowns for testing
  const proxy = new ClientProxy({
    port: 9000,
    seedUrls: seeds,
    replicationFactor: 2,
    maxRetries: 1,
    minNodes: 3,
    maxNodes: 5,
    scaleUpThreshold: {
      cpu: 15,          // 15% CPU
      memory: 0.1,      // 0.1% Memory
      rps: 50           // 50 RPS
    },
    scaleDownThreshold: {
      cpu: 12,          // 12% CPU
      memory: 0.05,     // 0.05% Memory
      rps: 20           // 20 RPS
    },
    cooldown: {
      scaleUp: 5,       // 5 seconds scale up cooldown
      scaleDown: 10     // 10 seconds scale down cooldown
    }
  });
  await proxy.start();

  console.log('[Autoscale Test] Waiting 3 seconds for gossip convergence...');
  await wait(3000);

  // Helper to fetch proxy status
  async function getProxyStatus() {
    const resp = await fetch('http://localhost:9000/status');
    return resp.json();
  }

  const initialStatus = await getProxyStatus();
  const initialNodesCount = initialStatus.activeNodes.length;
  console.log(`[Autoscale Test] Initial nodes count: ${initialNodesCount}`);
  
  if (initialNodesCount !== 3) {
    throw new Error(`Expected 3 initial nodes, but found ${initialNodesCount}`);
  }

  // 1. Inject high traffic to trigger Scale Up
  console.log('\n🚀 [Autoscale Test] Step 1: Injecting high-volume traffic to trigger scale-up...');
  let isTrafficRunning = true;
  let requestCount = 0;
  
  const trafficPromise = (async () => {
    const workers = Array.from({ length: 15 }, async () => {
      while (isTrafficRunning) {
        requestCount++;
        const key = `test_key_${Math.floor(Math.random() * 100)}`;
        try {
          await fetch(`http://localhost:9000/keys/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: 'test_val', ttlSeconds: 60 }),
            signal: AbortSignal.timeout(1000)
          });
        } catch (err) {}
        await wait(5); // Sleep 5ms between requests per worker
      }
    });
    await Promise.all(workers);
  })();

  // Run traffic for 8 seconds and check if a new node is spawned
  console.log('[Autoscale Test] Traffic started. Monitoring cluster scale-up...');
  let scaledUp = false;
  for (let i = 0; i < 8; i++) {
    await wait(1000);
    const status = await getProxyStatus();
    console.log(`  - Node count at t=${i + 1}s: ${status.activeNodes.length} active nodes (RPS per node: ${(requestCount / (i + 1)).toFixed(1)})`);
    if (status.activeNodes.length > 3) {
      scaledUp = true;
      console.log(`🟢 [Autoscale Test] Scale-up detected! Spawned new node on port ${status.activeNodes[status.activeNodes.length - 1].split(':').pop()}`);
      break;
    }
  }

  // Stop traffic
  console.log('\n🛑 [Autoscale Test] Step 2: Stopping traffic stream...');
  isTrafficRunning = false;
  await trafficPromise;

  if (!scaledUp) {
    console.log('🔴 [Autoscale Test] FAILURE: Cluster did not scale up within 8 seconds!');
  }

  // 2. Wait for traffic to cool down and scale down to trigger
  console.log('\n⏳ [Autoscale Test] Step 3: Waiting for scale-down cooldown and inactivity trigger...');
  let scaledDown = false;
  // We need to wait at least 10 seconds for scaleDown cooldown, and let the system detect low RPS
  for (let i = 0; i < 15; i++) {
    await wait(1000);
    const status = await getProxyStatus();
    console.log(`  - Node count after t=${i + 1}s: ${status.activeNodes.length} active nodes`);
    if (status.activeNodes.length === 3 && scaledUp) {
      scaledDown = true;
      console.log('🟢 [Autoscale Test] Scale-down detected! Returned to baseline of 3 nodes.');
      break;
    }
  }

  console.log('\n[Autoscale Test] Shutting down cluster...');
  await proxy.stop();
  for (const node of nodes) {
    await node.stop();
  }

  console.log('\n=============================================================');
  console.log('              AUTOSCALE TEST REPORT                          ');
  console.log('=============================================================');
  console.log(`  Initial Nodes: ${initialNodesCount} (Expected: 3)`);
  console.log(`  Scale-up Successful: ${scaledUp ? 'YES 🟢' : 'NO 🔴'}`);
  console.log(`  Scale-down Successful: ${scaledDown ? 'YES 🟢' : 'NO 🔴'}`);
  console.log('-------------------------------------------------------------');
  if (scaledUp && scaledDown) {
    console.log('  VERDICT: SUCCESS 🌟 (Autoscaling working as specified!)');
    console.log('=============================================================\n');
    process.exit(0);
  } else {
    console.log('  VERDICT: FAILURE ❌ (Autoscaling behavior failed requirements)');
    console.log('=============================================================\n');
    process.exit(1);
  }
}

runAutoscaleTest().catch((err) => {
  console.error('[Autoscale Test] Critical error:', err);
  process.exit(1);
});
