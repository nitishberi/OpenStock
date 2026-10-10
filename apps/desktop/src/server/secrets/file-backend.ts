import fs from 'node:fs';
import path from 'node:path';

/**
 * File-backed secret store for Linux CI / non-macOS.
 * Files are mode 600 under Application Support secrets dir.
 */
export class FileSecretBackend {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* ignore */
    }
  }

  private fileFor(service: string, account: string): string {
    const safe = `${service}__${account}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.dir, `${safe}.secret`);
  }

  set(service: string, account: string, value: string): void {
    const file = this.fileFor(service, account);
    fs.writeFileSync(file, value, { mode: 0o600, encoding: 'utf8' });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* ignore */
    }
  }

  get(service: string, account: string): string | null {
    const file = this.fileFor(service, account);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
  }

  delete(service: string, account: string): void {
    const file = this.fileFor(service, account);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  listAccounts(service: string): string[] {
    if (!fs.existsSync(this.dir)) return [];
    const prefix = `${service}__`;
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.secret'))
      .map((f) => f.slice(prefix.length, -'.secret'.length));
  }
}
