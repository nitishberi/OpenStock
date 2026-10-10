import { getDb, nowIso } from '../db/index.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

/**
 * Login rate limit: max failed attempts per email (and optionally IP) in a window.
 */
export function recordLoginAttempt(email: string, ip: string | undefined, ok: boolean): void {
  getDb()
    .prepare('INSERT INTO login_attempts (email, ip, ok, createdAt) VALUES (?, ?, ?, ?)')
    .run(email.toLowerCase(), ip || null, ok ? 1 : 0, nowIso());
}

export function isLoginRateLimited(email: string, ip?: string): boolean {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
       WHERE email = ? COLLATE NOCASE AND ok = 0 AND createdAt >= ?`
    )
    .get(email.toLowerCase(), since) as { n: number };

  if (row.n >= MAX_FAILURES) return true;

  if (ip) {
    const ipRow = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM login_attempts
         WHERE ip = ? AND ok = 0 AND createdAt >= ?`
      )
      .get(ip, since) as { n: number };
    if (ipRow.n >= MAX_FAILURES * 2) return true;
  }
  return false;
}

export function pruneOldLoginAttempts(): void {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare('DELETE FROM login_attempts WHERE createdAt < ?').run(cutoff);
}
