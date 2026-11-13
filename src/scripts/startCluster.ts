import * as os from 'os';
import { CacheNodeServer } from '../network/server';
import { ClientProxy } from '../network/proxy';

function getLocalIp(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

async function main() {
  const proxyPort = parseInt(process.env.PORT || '8000', 10);
  const baseNodePort = proxyPort === 8000 ? 8001 : 18001;
  const ports = [baseNodePort, baseNodePort + 1, baseNodePort + 2];
  const host = 'localhost';
  const seeds = ports.map((port) => `http://${host}:${port}`);
  
  console.log(`[Cluster Bootstrap] Starting 3 cache nodes (ports ${ports.join(', ')})...`);
  const nodes: CacheNodeServer[] = [];
  
  for (const port of ports) {
    const node = new CacheNodeServer(port, host);
    await node.start();
    
    // Initialize cluster with seed nodes configuration
    node.initializeCluster(seeds, 2); // Replication factor N = 2
    nodes.push(node);
  }

  console.log(`[Cluster Bootstrap] Starting Client Proxy Gateway on port ${proxyPort}...`);
  const proxy = new ClientProxy({
    port: proxyPort,
    seedUrls: seeds,
    replicationFactor: 2,
    maxRetries: 1, // Allow 1 retry on replica if primary fails
    minNodes: 3,
    maxNodes: 10,
    scaleUpThreshold: {
      cpu: 75,
      memory: 80,
      rps: 5000
    },
    scaleDownThreshold: {
      cpu: 30,
      memory: 40,
      rps: 2000
    },
    cooldown: {
      scaleUp: 30,
      scaleDown: 120
    }
  });
  
  await proxy.start();

  const localIp = getLocalIp();

  console.log('\n=============================================================');
  console.log('  CLUSTER IS FULLY RUNNING AND OPERATIONAL!                  ');
  console.log(`  - Local Access:   http://localhost:${proxyPort}/dashboard          `);
  console.log(`  - Network Access: http://${localIp}:${proxyPort}/dashboard         `);
  console.log('    (Share this link with your professor on the same Wi-Fi!) ');
  console.log(`  - Cache Nodes:    Ports ${ports[0]} to ${ports[ports.length - 1] + 5} (Listening on 0.0.0.0)`);
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
