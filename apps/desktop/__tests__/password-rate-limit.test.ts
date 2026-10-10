import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validatePasswordComplexity } from '../src/server/auth/password';
import { getDb, closeDb } from '../src/server/db/index';
import { isLoginRateLimited, recordLoginAttempt } from '../src/server/auth/rate-limit';
import { isAllowedDiscordWebhook, isAllowedTelegramChatId, domainAllowed } from '../src/server/services/allowlists';
import type { DesktopConfig } from '../src/server/config';

describe('password complexity', () => {
  it('requires upper lower digit', () => {
    expect(validatePasswordComplexity('short').ok).toBe(false);
    expect(validatePasswordComplexity('alllowercase1').ok).toBe(false);
    expect(validatePasswordComplexity('ALLUPPERCASE1').ok).toBe(false);
    expect(validatePasswordComplexity('NoDigitsHere').ok).toBe(false);
    expect(validatePasswordComplexity('GoodPass1').ok).toBe(true);
  });
});

describe('allowlists', () => {
  it('allows discord webhooks only', () => {
    expect(isAllowedDiscordWebhook('https://discord.com/api/webhooks/1/abc')).toBe(true);
    expect(isAllowedDiscordWebhook('https://evil.example/api/webhooks/1/abc')).toBe(false);
    expect(isAllowedDiscordWebhook('http://discord.com/api/webhooks/1/abc')).toBe(false);
  });
  it('validates telegram chat ids', () => {
    expect(isAllowedTelegramChatId('123456789')).toBe(true);
    expect(isAllowedTelegramChatId('-100123')).toBe(true);
    expect(isAllowedTelegramChatId('not-a-chat')).toBe(false);
  });
  it('checks scrapling domains', () => {
    expect(domainAllowed('https://www.openinsider.com/screener')).toBe(true);
    expect(domainAllowed('https://evil.example/x')).toBe(false);
  });
});

describe('login rate limit', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adt-test-'));
    const cfg = {
      dbPath: path.join(tmp, 't.sqlite'),
    } as DesktopConfig;
    closeDb();
    getDb(cfg);
  });
  afterEach(() => {
    closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('trips after repeated failures', () => {
    for (let i = 0; i < 8; i++) recordLoginAttempt('a@b.com', '127.0.0.1', false);
    expect(isLoginRateLimited('a@b.com', '127.0.0.1')).toBe(true);
  });
});
