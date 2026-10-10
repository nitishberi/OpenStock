import type { DesktopConfig } from '../config.js';
import { FileSecretBackend } from './file-backend.js';
import { KeychainSecretBackend, keychainAvailable } from './keychain.js';

export const SECRET_KEYS = [
  'FINNHUB_API_KEY',
  'FINNHUB_API_KEYS',
  'GEMINI_API_KEY',
  'TAVILY_API_KEY',
  'TAVILY_API_KEYS',
  'BRAVE_API_KEY',
  'SERPAPI_API_KEY',
  'ALPACA_API_KEY_ID',
  'ALPACA_API_SECRET_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DISCORD_WEBHOOK_URL',
  'NODEMAILER_EMAIL',
  'NODEMAILER_PASSWORD',
  'SCRAPLING_WORKER_TOKEN',
  'BETTER_AUTH_SECRET',
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

type Backend = {
  set(service: string, account: string, value: string): void;
  get(service: string, account: string): string | null;
  delete(service: string, account: string): void;
};

let store: SecretsStore | null = null;

export class SecretsStore {
  readonly backendName: 'keychain' | 'file';
  private backend: Backend;

  constructor(cfg: DesktopConfig) {
    if (keychainAvailable() && process.env.AUTODAYTRADER_SECRETS_BACKEND !== 'file') {
      this.backend = new KeychainSecretBackend();
      this.backendName = 'keychain';
    } else {
      this.backend = new FileSecretBackend(cfg.secretsDir);
      this.backendName = 'file';
    }
  }

  set(key: SecretKey | string, value: string): void {
    this.backend.set('api', key, value);
    // Mirror into process.env for shared lib/forecast code paths
    process.env[key] = value;
  }

  get(key: SecretKey | string): string | null {
    const fromStore = this.backend.get('api', key);
    if (fromStore != null) return fromStore;
    const fromEnv = process.env[key];
    return fromEnv && fromEnv.length ? fromEnv : null;
  }

  delete(key: SecretKey | string): void {
    this.backend.delete('api', key);
    delete process.env[key];
  }

  /** Load known keys into process.env at boot. */
  hydrateEnv(keys: readonly string[] = SECRET_KEYS): void {
    for (const key of keys) {
      const v = this.backend.get('api', key);
      if (v) process.env[key] = v;
    }
  }

  /** Redacted status for Settings UI — never returns values. */
  status(): Record<string, { set: boolean }> {
    const out: Record<string, { set: boolean }> = {};
    for (const key of SECRET_KEYS) {
      out[key] = { set: Boolean(this.get(key)) };
    }
    return out;
  }
}

export function initSecrets(cfg: DesktopConfig): SecretsStore {
  store = new SecretsStore(cfg);
  store.hydrateEnv();
  return store;
}

export function getSecrets(): SecretsStore {
  if (!store) throw new Error('SecretsStore not initialized');
  return store;
}
