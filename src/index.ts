import { CacheNodeServer } from './network/server';

function parseArgs() {
  const args = process.argv.slice(2);
  let port = 8006;
  let seeds: string[] = ['http://localhost:8001'];

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
    }
    if ((args[i] === '--seeds' || args[i] === '-s') && args[i + 1]) {
      seeds = args[i + 1].split(',');
    }
  }

  return { port, seeds };
}

async function start() {
  const { port, seeds } = parseArgs();
  
  console.log(`[CLI] Launching dynamic cache node on port ${port}...`);
  const server = new CacheNodeServer(port, 'localhost');
  
  await server.start();
  
  // Register node to the cluster using seed nodes
  server.initializeCluster(seeds, 2);
  
  const handleShutdown = async () => {
    console.log(`[CLI] Stopping cache node on port ${port}...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

start().catch((err) => {
  console.error('[CLI] Failed to start cache node:', err);
});
