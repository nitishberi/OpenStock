import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type DesktopConfig = {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  secretsDir: string;
  weightsDir: string;
  bindLocalhostOnly: boolean;
  tradingUiEnabled: boolean;
  alpacaAllowLive: boolean;
  workerTokenRequired: boolean;
  scraplingWorkerUrl: string;
  scraplingWorkerToken: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  appUrl: string;
  adminEmails: Set<string>;
  sparkleFeedUrl: string;
};

function defaultDataDir(): string {
  if (process.env.AUTODAYTRADER_DATA_DIR) {
    return path.resolve(process.env.AUTODAYTRADER_DATA_DIR);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AutoDayTrader');
  }
  return path.join(os.homedir(), '.autodaytrader');
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(): DesktopConfig {
  const dataDir = defaultDataDir();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8787);
  const secret =
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTODAYTRADER_AUTH_SECRET ||
    'dev-only-change-me-autodaytrader-desktop';

  const adminEmails = new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  return {
    host,
    port,
    dataDir,
    dbPath: path.join(dataDir, 'autodaytrader.sqlite'),
    secretsDir: path.join(dataDir, 'secrets'),
    weightsDir: path.join(dataDir, 'weights'),
    bindLocalhostOnly: envBool('BIND_LOCALHOST_ONLY', true),
    tradingUiEnabled: envBool('TRADING_UI_ENABLED', false),
    alpacaAllowLive: envBool('ALPACA_ALLOW_LIVE', false),
    workerTokenRequired: envBool('SCRAPLING_WORKER_TOKEN_REQUIRED', true),
    scraplingWorkerUrl: (process.env.SCRAPLING_WORKER_URL || 'http://127.0.0.1:8091').replace(
      /\/$/,
      ''
    ),
    scraplingWorkerToken: process.env.SCRAPLING_WORKER_TOKEN || '',
    betterAuthSecret: secret,
    betterAuthUrl: process.env.BETTER_AUTH_URL || `http://${host}:${port}`,
    appUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || `http://${host}:${port}`,
    adminEmails,
    sparkleFeedUrl:
      process.env.SPARKLE_FEED_URL || 'https://updates.example.invalid/autodaytrader/appcast.xml',
  };
}

export function ensureDataDirs(cfg: DesktopConfig): void {
  for (const dir of [cfg.dataDir, cfg.secretsDir, cfg.weightsDir, path.join(cfg.dataDir, 'logs')]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* best-effort on non-POSIX */
    }
  }
}

/** Hard safety defaults — never enable live trading or LAN bind by accident. */
export function assertSafeDefaults(cfg: DesktopConfig): void {
  if (cfg.alpacaAllowLive) {
    console.warn('[security] ALPACA_ALLOW_LIVE=true — live orders still require explicit Approve UI');
  }
  if (cfg.bindLocalhostOnly && cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
    throw new Error(
      `BIND_LOCALHOST_ONLY=true but HOST=${cfg.host}. Refusing to bind non-loopback.`
    );
  }
  if (!cfg.tradingUiEnabled) {
    process.env.TRADING_UI_ENABLED = 'false';
  }
  process.env.ALPACA_ALLOW_LIVE = cfg.alpacaAllowLive ? 'true' : 'false';
}
