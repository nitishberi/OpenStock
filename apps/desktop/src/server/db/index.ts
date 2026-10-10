import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from './schema.js';
import type { DesktopConfig } from '../config.js';

let db: Database.Database | null = null;

export function getDb(cfg?: DesktopConfig): Database.Database {
  if (db) return db;
  if (!cfg) throw new Error('Database not initialized');
  fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true, mode: 0o700 });
  db = new Database(cfg.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  try {
    fs.chmodSync(cfg.dbPath, 0o600);
  } catch {
    /* ignore */
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function newId(prefix = ''): string {
  return prefix ? `${prefix}_${randomUUID().replace(/-/g, '')}` : randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/* ---------- typed helpers ---------- */

export type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
  role: string;
  createdAt: string;
  updatedAt: string;
};

export function getUserById(id: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM user WHERE id = ?').get(id) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return getDb()
    .prepare('SELECT * FROM user WHERE email = ? COLLATE NOCASE')
    .get(email) as UserRow | undefined;
}

export function setUserRole(userId: string, role: 'user' | 'admin'): void {
  getDb().prepare('UPDATE user SET role = ?, updatedAt = ? WHERE id = ?').run(role, nowIso(), userId);
}
