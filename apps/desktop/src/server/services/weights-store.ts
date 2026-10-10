import fs from 'node:fs';
import path from 'node:path';
import { getDb, nowIso } from '../db/index.js';
import type { DesktopConfig } from '../config.js';

/** Minimal shape — full payload lives in lib/forecast types. */
export type WeightsPayload = {
  version: string;
  createdAt?: string;
  [key: string]: unknown;
};

export function ensureActiveWeights(cfg: DesktopConfig, createBaseline: () => WeightsPayload): WeightsPayload {
  const db = getDb();
  const active = db.prepare('SELECT payload FROM model_weights WHERE active = 1 LIMIT 1').get() as
    | { payload: string }
    | undefined;
  if (active?.payload) {
    return JSON.parse(active.payload) as WeightsPayload;
  }

  // Prefer bundled / disk weights (v3) if present
  const candidates = [
    path.join(cfg.weightsDir, 'active.weights.json'),
    path.resolve(
      process.cwd(),
      '../../artifacts/swing-baseline-v3.weights.json'
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const payload = JSON.parse(fs.readFileSync(p, 'utf8')) as WeightsPayload;
        upsertWeights(payload, true);
        return payload;
      } catch {
        /* continue */
      }
    }
  }

  const baseline = createBaseline();
  upsertWeights(baseline, true);
  return baseline;
}

export function upsertWeights(payload: WeightsPayload, active: boolean, promotedFrom?: string): void {
  const db = getDb();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO model_weights (version, payload, active, promotedFrom, createdAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(version) DO UPDATE SET
       payload = excluded.payload,
       active = excluded.active,
       promotedFrom = COALESCE(excluded.promotedFrom, model_weights.promotedFrom)`
  ).run(payload.version, JSON.stringify(payload), active ? 1 : 0, promotedFrom || null, ts);

  if (active) {
    db.prepare('UPDATE model_weights SET active = 0 WHERE version != ?').run(payload.version);
  }
}

export function writeWeightsToDisk(cfg: DesktopConfig, payload: WeightsPayload): void {
  fs.mkdirSync(cfg.weightsDir, { recursive: true, mode: 0o700 });
  const file = path.join(cfg.weightsDir, 'active.weights.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  // Also versioned copy
  const verFile = path.join(cfg.weightsDir, `${payload.version}.weights.json`);
  fs.writeFileSync(verFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
}
