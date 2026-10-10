/**
 * Server-side password complexity (checklist Fail on Next.js port — fixed here).
 * Mirrors client PASSWORD_RULES: upper + lower + digit, length 8–128.
 */

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

export function validatePasswordComplexity(password: string): PasswordCheck {
  if (typeof password !== 'string') return { ok: false, reason: 'Invalid password' };
  if (password.length < 8) return { ok: false, reason: 'Password must be at least 8 characters' };
  if (password.length > 128) return { ok: false, reason: 'Password must be at most 128 characters' };
  if (!/[a-z]/.test(password)) return { ok: false, reason: 'Password needs a lowercase letter' };
  if (!/[A-Z]/.test(password)) return { ok: false, reason: 'Password needs an uppercase letter' };
  if (!/[0-9]/.test(password)) return { ok: false, reason: 'Password needs a digit' };
  return { ok: true };
}
