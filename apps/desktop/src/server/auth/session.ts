import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb, newId, nowIso, getUserByEmail, type UserRow } from '../db/index.js';
import { validatePasswordComplexity } from './password.js';
import { isLoginRateLimited, recordLoginAttempt } from './rate-limit.js';

const SESSION_DAYS = 14;

function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || randomBytes(16).toString('hex');
  const hash = scryptSync(password, s, 64).toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 64);
  const prev = Buffer.from(hash, 'hex');
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type SessionInfo = {
  token: string;
  user: UserRow;
  expiresAt: string;
};

export function signUp(input: {
  email: string;
  password: string;
  name: string;
  role?: 'user' | 'admin';
}): { user: UserRow } {
  const email = input.email.trim().toLowerCase();
  const check = validatePasswordComplexity(input.password);
  if (!check.ok) throw Object.assign(new Error(check.reason), { status: 400 });

  if (getUserByEmail(email)) {
    throw Object.assign(new Error('Unable to create account'), { status: 400 });
  }

  const { hash, salt } = hashPassword(input.password);
  const id = newId('user');
  const ts = nowIso();
  const db = getDb();
  db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role)
     VALUES (?, ?, ?, 0, ?, ?, ?)`
  ).run(id, input.name.trim() || email, email, ts, ts, input.role || 'user');

  db.prepare(
    `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
     VALUES (?, ?, 'credential', ?, ?, ?, ?)`
  ).run(newId('acc'), email, id, `${salt}:${hash}`, ts, ts);

  const user = getUserByEmail(email)!;
  return { user };
}

export function signIn(input: {
  email: string;
  password: string;
  ip?: string;
}): SessionInfo {
  const email = input.email.trim().toLowerCase();
  if (isLoginRateLimited(email, input.ip)) {
    throw Object.assign(new Error('Too many login attempts. Try again later.'), { status: 429 });
  }

  const user = getUserByEmail(email);
  const acct = user
    ? (getDb()
        .prepare(`SELECT password FROM account WHERE userId = ? AND providerId = 'credential'`)
        .get(user.id) as { password?: string } | undefined)
    : undefined;

  const ok = Boolean(user && acct?.password && verifyPassword(input.password, acct.password));
  recordLoginAttempt(email, input.ip, ok);
  if (!ok || !user) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(newId('sess'), expiresAt, tokenHash, ts, ts, input.ip || null, user.id);

  return { token: rawToken, user, expiresAt };
}

export function signOut(token: string | undefined): void {
  if (!token) return;
  getDb().prepare('DELETE FROM session WHERE token = ?').run(hashToken(token));
}

export function sessionFromToken(token: string | undefined | null): SessionInfo | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT s.expiresAt, s.token, u.*
       FROM session s JOIN user u ON u.id = s.userId
       WHERE s.token = ?`
    )
    .get(hashToken(token)) as (UserRow & { expiresAt: string; token: string }) | undefined;

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    getDb().prepare('DELETE FROM session WHERE token = ?').run(row.token);
    return null;
  }
  const { expiresAt, token: _t, ...user } = row;
  return { token, user: user as UserRow, expiresAt };
}

export function cookieName(): string {
  return 'adt_session';
}

export function parseSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(`${cookieName()}=`)) {
      return decodeURIComponent(p.slice(cookieName().length + 1));
    }
  }
  return null;
}

export function sessionCookieHeader(token: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `${cookieName()}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader(): string {
  return `${cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
