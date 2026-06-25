import { CacheNodeServer } from '../network/server';
import { ClientProxy } from '../network/proxy';

async function main() {
  const ports = [8001, 8002, 8003, 8004, 8005];
  const host = 'localhost';
  const seeds = ports.map((port) => `http://${host}:${port}`);
  
  console.log('[Cluster Bootstrap] Starting 5 cache nodes...');
  const nodes: CacheNodeServer[] = [];
  
  for (const port of ports) {
    const node = new CacheNodeServer(port, host);
    await node.start();
    
    // Initialize cluster with seed nodes configuration
    node.initializeCluster(seeds, 2); // Replication factor N = 2
    nodes.push(node);
  }

  console.log('[Cluster Bootstrap] Starting Client Proxy Gateway on port 8000...');
  const proxy = new ClientProxy({
    port: 8000,
    seedUrls: seeds,
    replicationFactor: 2,
    maxRetries: 1 // Allow 1 retry on replica if primary fails
  });
  
  await proxy.start();

  console.log('\n=============================================================');
  console.log('  CLUSTER IS FULLY RUNNING AND OPERATIONAL!                  ');
  console.log('  - Gateway Proxy: http://localhost:8000                     ');
  console.log('  - Dashboard:     http://localhost:8000/dashboard           ');
  console.log('  - Cache Nodes:   http://localhost:8001 to 8005            ');
  console.log('=============================================================\n');
  
  // Clean shutdown
  const handleExit = async () => {
    console.log('\n[Cluster Bootstrap] Shutting down cluster...');
    await proxy.stop();
    for (const node of nodes) {
      await node.stop();
    }
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
}

main().catch((err) => {
  console.error('[Cluster Bootstrap] Critical initialization error:', err);
});
