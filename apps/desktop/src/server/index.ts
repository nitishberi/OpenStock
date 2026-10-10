import { serve } from '@hono/node-server';
import { loadConfig, ensureDataDirs, assertSafeDefaults } from './config.js';
import { getDb } from './db/index.js';
import { initSecrets } from './secrets/index.js';
import { createApp } from './app.js';
import { startScraplingWorker, stopScraplingWorker } from './worker/spawn.js';
import { pruneOldLoginAttempts } from './auth/rate-limit.js';
import { setUserRole, getUserByEmail } from './db/index.js';

async function main() {
  const cfg = loadConfig();
  assertSafeDefaults(cfg);
  ensureDataDirs(cfg);
  getDb(cfg);
  const secrets = initSecrets(cfg);

  // Prefer Keychain/file token over empty env
  const token = secrets.get('SCRAPLING_WORKER_TOKEN');
  if (token) cfg.scraplingWorkerToken = token;

  // Bootstrap admin from ADMIN_EMAILS once users exist
  for (const email of cfg.adminEmails) {
    const u = getUserByEmail(email);
    if (u && u.role !== 'admin') setUserRole(u.id, 'admin');
  }

  pruneOldLoginAttempts();

  const app = createApp(cfg);

  if (process.env.AUTODAYTRADER_SPAWN_WORKER === '1') {
    const resources = process.env.AUTODAYTRADER_RESOURCES;
    startScraplingWorker(cfg, resources);
  }

  console.log(
    `[AutoDayTrader] listening http://${cfg.host}:${cfg.port} data=${cfg.dataDir} secrets=${secrets.backendName}`
  );
  console.log(
    `[AutoDayTrader] TRADING_UI_ENABLED=${cfg.tradingUiEnabled} ALPACA_ALLOW_LIVE=${cfg.alpacaAllowLive}`
  );

  serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port });

  const shutdown = () => {
    stopScraplingWorker();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
