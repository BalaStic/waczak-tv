import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Channel, restorePosition } from './channel.js';
import { getConfigPath, loadConfig } from './config.js';
import { loadMediaSnapshot } from './media.js';
import { createHttpServer } from './server.js';

const applicationFolder = path.dirname(fileURLToPath(import.meta.url));
const publicFolder = path.resolve(applicationFolder, '..', 'public');
const checkpointIntervalMs = 5000;
const listenPort = Number(process.env.PORT || 4173);

export async function start() {
  const configPath = getConfigPath();
  const config = await loadConfig(configPath);

  const items = await loadMediaSnapshot(config.mediaFolder, {
    onUnavailable(filename, reason) {
      console.error(`Skipping ${filename}: ${reason}`);
    },
  });

  const checkpointPath = path.join(config.dataFolder, 'checkpoint.json');
  const restored = await restorePosition(items, checkpointPath);
  const channel = new Channel(items, {
    mediaFolder: config.mediaFolder,
    checkpointPath,
    index: restored.index,
    position: restored.position,
  });

  console.log(`Loaded ${items.length} playable MP4 file(s) from ${config.mediaFolder}.`);
  if (restored.position > 0) {
    console.log(`Resuming ${items[restored.index].filename} at ${restored.position.toFixed(1)} seconds.`);
  }

  const parsedPort = listenPort;
  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}. Use a port from 0 to 65535.`);
  }

  const server = createHttpServer({ channel, mediaFolder: config.mediaFolder, publicFolder });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(parsedPort, '127.0.0.1', resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  console.log(`waczak-tv is running at ${url}`);
  console.log('Press Ctrl+C to stop the channel.');

  const checkpointTimer = setInterval(async () => {
    await channel.tick();
    await channel.writeCheckpoint();
  }, checkpointIntervalMs);
  checkpointTimer.unref();

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(checkpointTimer);
    await channel.tick();
    await channel.writeCheckpoint();
    await new Promise((resolve) => server.close(resolve));
    console.log('waczak-tv stopped.');
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { server, channel, shutdown, url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
