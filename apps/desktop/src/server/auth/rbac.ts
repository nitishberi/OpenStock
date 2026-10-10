import type { DesktopConfig } from '../config.js';
import { getUserById, type UserRow } from '../db/index.js';

export function isAdmin(user: UserRow | undefined | null, cfg: DesktopConfig): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return cfg.adminEmails.has(user.email.toLowerCase());
}

export function requireAdmin(userId: string, cfg: DesktopConfig): UserRow {
  const user = getUserById(userId);
  if (!user || !isAdmin(user, cfg)) {
    throw new AuthzError('Admin role required for Lab promote/train');
  }
  return user;
}

export class AuthzError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'AuthzError';
  }
}

export class AuthnError extends Error {
  status = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthnError';
  }
}
