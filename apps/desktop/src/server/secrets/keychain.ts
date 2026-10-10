import { execFileSync } from 'node:child_process';

const SERVICE = 'AutoDayTrader';

/**
 * macOS Keychain wrapper via `security` CLI.
 * Falls back to throwing — callers should use SecretsStore which picks backend.
 */
export class KeychainSecretBackend {
  set(service: string, account: string, value: string): void {
    const svc = `${SERVICE}.${service}`;
    try {
      // delete existing quietly
      execFileSync('security', ['delete-generic-password', '-s', svc, '-a', account], {
        stdio: 'ignore',
      });
    } catch {
      /* none */
    }
    execFileSync(
      'security',
      ['add-generic-password', '-U', '-s', svc, '-a', account, '-w', value],
      { stdio: 'pipe' }
    );
  }

  get(service: string, account: string): string | null {
    const svc = `${SERVICE}.${service}`;
    try {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-s', svc, '-a', account, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  delete(service: string, account: string): void {
    const svc = `${SERVICE}.${service}`;
    try {
      execFileSync('security', ['delete-generic-password', '-s', svc, '-a', account], {
        stdio: 'ignore',
      });
    } catch {
      /* ignore */
    }
  }

  listAccounts(_service: string): string[] {
    // Keychain dump parsing is fragile; Settings UI tracks known keys.
    return [];
  }
}

export function keychainAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('security', ['help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
