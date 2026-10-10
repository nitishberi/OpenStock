import { getDb, nowIso } from '../db/index.js';
import type { NotifyChannel } from './notify.js';

/** Custom notification kinds users can enable/configure in the DMG. */
export const NOTIFY_TYPES = [
  'forecast_refresh',
  'form4_material',
  'form4_heavy',
  'volume_uptick',
  'insider_scan',
  'test',
] as const;

export type NotifyType = (typeof NOTIFY_TYPES)[number];

export type NotifyPref = {
  type: NotifyType;
  enabled: boolean;
  channels: NotifyChannel[];
  /** form4_heavy: min |valueUsd|; volume_uptick: min volume / avg20 ratio */
  threshold: number | null;
};

const DEFAULTS: Record<NotifyType, { enabled: boolean; channels: NotifyChannel[]; threshold: number | null }> = {
  forecast_refresh: { enabled: true, channels: ['macos'], threshold: null },
  form4_material: { enabled: true, channels: ['macos', 'email'], threshold: 100_000 },
  form4_heavy: { enabled: true, channels: ['macos', 'email', 'telegram'], threshold: 250_000 },
  volume_uptick: { enabled: true, channels: ['macos'], threshold: 2.5 },
  insider_scan: { enabled: true, channels: ['macos'], threshold: null },
  test: { enabled: true, channels: ['macos'], threshold: null },
};

function ensureDefaults() {
  const db = getDb();
  const now = nowIso();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO notify_pref (type, enabled, channels, threshold, updatedAt) VALUES (?, ?, ?, ?, ?)`
  );
  for (const type of NOTIFY_TYPES) {
    const d = DEFAULTS[type];
    stmt.run(type, d.enabled ? 1 : 0, JSON.stringify(d.channels), d.threshold, now);
  }
}

export function listNotifyPrefs(): NotifyPref[] {
  ensureDefaults();
  const rows = getDb()
    .prepare(`SELECT type, enabled, channels, threshold FROM notify_pref ORDER BY type`)
    .all() as Array<{ type: string; enabled: number; channels: string; threshold: number | null }>;
  return rows.map((r) => ({
    type: r.type as NotifyType,
    enabled: Boolean(r.enabled),
    channels: JSON.parse(r.channels || '["macos"]') as NotifyChannel[],
    threshold: r.threshold,
  }));
}

export function getNotifyPref(type: NotifyType): NotifyPref {
  ensureDefaults();
  const row = getDb()
    .prepare(`SELECT type, enabled, channels, threshold FROM notify_pref WHERE type = ?`)
    .get(type) as { type: string; enabled: number; channels: string; threshold: number | null } | undefined;
  if (!row) {
    const d = DEFAULTS[type];
    return { type, enabled: d.enabled, channels: d.channels, threshold: d.threshold };
  }
  return {
    type,
    enabled: Boolean(row.enabled),
    channels: JSON.parse(row.channels || '["macos"]') as NotifyChannel[],
    threshold: row.threshold,
  };
}

export function upsertNotifyPref(pref: Partial<NotifyPref> & { type: NotifyType }): NotifyPref {
  ensureDefaults();
  const cur = getNotifyPref(pref.type);
  const next: NotifyPref = {
    type: pref.type,
    enabled: pref.enabled ?? cur.enabled,
    channels: pref.channels ?? cur.channels,
    threshold: pref.threshold !== undefined ? pref.threshold : cur.threshold,
  };
  getDb()
    .prepare(
      `INSERT INTO notify_pref (type, enabled, channels, threshold, updatedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(type) DO UPDATE SET
         enabled=excluded.enabled, channels=excluded.channels, threshold=excluded.threshold, updatedAt=excluded.updatedAt`
    )
    .run(next.type, next.enabled ? 1 : 0, JSON.stringify(next.channels), next.threshold, nowIso());
  return next;
}

/** Dedup alert fingerprints (e.g. volume SYMBOL:date). Returns false if already sent. */
export function recordAlertOnce(opts: {
  type: NotifyType;
  symbol?: string;
  fingerprint: string;
  title: string;
  body: string;
}): boolean {
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO alert_event (type, symbol, fingerprint, title, body, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(opts.type, opts.symbol || null, opts.fingerprint, opts.title, opts.body, nowIso());
    return true;
  } catch {
    return false;
  }
}
