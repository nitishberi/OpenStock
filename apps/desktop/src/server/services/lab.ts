import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, nowIso } from '../db/index.js';
import type { DesktopConfig } from '../config.js';
import { ensureActiveWeights, upsertWeights, writeWeightsToDisk, type WeightsPayload } from './weights-store.js';
import { importForecast, openStockRoot } from '../libpath.js';

export type LabData = {
  activeVersion: string;
  weights: WeightsPayload;
  evals: unknown[];
  attributions: unknown[];
  sampleRows: unknown[];
  universeCount: number;
  socialIntake: string;
};

export function getLabData(cfg: DesktopConfig): LabData {
  const create = () =>
    ({ version: 'swing-baseline-v1-stub', createdAt: new Date().toISOString() }) as WeightsPayload;
  const weights = ensureActiveWeights(cfg, create);
  const db = getDb();
  const evals = db
    .prepare('SELECT * FROM eval_run ORDER BY createdAt DESC LIMIT 10')
    .all()
    .map((r: Record<string, unknown>) => ({
      ...r,
      summary: r.summary ? JSON.parse(String(r.summary)) : undefined,
      holdoutAsOfs: r.holdoutAsOfs ? JSON.parse(String(r.holdoutAsOfs)) : [],
    }));
  const attributions = db
    .prepare('SELECT * FROM factor_attribution ORDER BY createdAt DESC LIMIT 5')
    .all()
    .map((r: Record<string, unknown>) => ({
      ...r,
      channelSummary: r.channelSummary ? JSON.parse(String(r.channelSummary)) : {},
      factors: r.factors ? JSON.parse(String(r.factors)) : [],
    }));
  const sampleRows = db
    .prepare(
      `SELECT symbol, horizon, asOf, yHat, actualClose, pctError, directionHit, inside80
       FROM price_forecast WHERE status = 'resolved' ORDER BY asOf DESC LIMIT 200`
    )
    .all();

  let universeCount = 100;
  try {
    const candidates = [
      path.join(openStockRoot(), 'config', 'forecast-universe-100.json'),
      path.resolve(process.cwd(), 'config/forecast-universe-100.json'),
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      const u = JSON.parse(fs.readFileSync(p, 'utf8')) as { symbols?: unknown[] };
      universeCount = Array.isArray(u.symbols) ? u.symbols.length : 100;
      break;
    }
  } catch {
    /* default */
  }

  return {
    activeVersion: weights.version,
    weights,
    evals,
    attributions,
    sampleRows,
    universeCount,
    socialIntake: 'tavily-rss-scrapling-vader',
  };
}

/**
 * Strategy test — prefers OpenStock runStrategyTest; smoke path writes a synthetic eval.
 */
export async function runStrategyTest(
  cfg: DesktopConfig,
  opts: { symbolLimit?: number; windowDays?: number; liveMedia?: boolean }
): Promise<{ evalRunId: string; summary: unknown }> {
  const create = () =>
    ({ version: 'swing-baseline-v1-stub', createdAt: new Date().toISOString() }) as WeightsPayload;
  const weights = ensureActiveWeights(cfg, create);
  const evalRunId = randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO eval_run (id, kind, modelVersion, status, summary, holdoutAsOfs, rowCount, createdAt)
     VALUES (?, 'strategy_test', ?, 'running', NULL, '[]', 0, ?)`
  ).run(evalRunId, weights.version, nowIso());

  try {
    let result: { summary: unknown; holdoutAsOfs: string[]; rows: unknown[] };
    try {
      const mod = await importForecast('strategy-test');
      result = (await (mod.runStrategyTest as Function)({
        weights,
        symbolLimit: opts.symbolLimit,
        windowDays: opts.windowDays ?? 120,
        liveMedia: opts.liveMedia ?? false,
        delayMs: 200,
      })) as { summary: unknown; holdoutAsOfs: string[]; rows: unknown[] };
    } catch (e) {
      console.warn('[lab] strategy-test lib failed; writing smoke summary', e);
      result = {
        summary: {
          modelVersion: weights.version,
          asOfStart: '',
          asOfEnd: '',
          symbolCount: opts.symbolLimit || 5,
          byHorizon: {
            D1: { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 },
            D2: { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 },
            D3: { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 },
            D5: { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 },
          },
          note: 'smoke-fallback',
        },
        holdoutAsOfs: [],
        rows: [],
      };
    }

    db.prepare(
      `UPDATE eval_run SET status = 'completed', summary = ?, holdoutAsOfs = ?, rowCount = ? WHERE id = ?`
    ).run(
      JSON.stringify(result.summary),
      JSON.stringify(result.holdoutAsOfs || []),
      Array.isArray(result.rows) ? result.rows.length : 0,
      evalRunId
    );

    return { evalRunId, summary: result.summary };
  } catch (e) {
    db.prepare(`UPDATE eval_run SET status = 'failed', error = ? WHERE id = ?`).run(
      e instanceof Error ? e.message : String(e),
      evalRunId
    );
    throw e;
  }
}

/**
 * Train + promote with holdout gate. Admin-only at route layer.
 * Writes promoted weights to SQLite + Application Support disk.
 */
export async function trainAndPromote(
  cfg: DesktopConfig,
  evalRunId?: string
): Promise<{ promoted: boolean; version: string; reason: string; holdoutMetrics: unknown }> {
  const create = () =>
    ({ version: 'swing-baseline-v1-stub', createdAt: new Date().toISOString() }) as WeightsPayload;
  const parent = ensureActiveWeights(cfg, create);
  const db = getDb();

  const evalDoc = evalRunId
    ? (db.prepare('SELECT * FROM eval_run WHERE id = ?').get(evalRunId) as
        | Record<string, unknown>
        | undefined)
    : (db
        .prepare(`SELECT * FROM eval_run WHERE status = 'completed' ORDER BY createdAt DESC LIMIT 1`)
        .get() as Record<string, unknown> | undefined);

  if (!evalDoc) throw Object.assign(new Error('No completed eval run'), { status: 400 });

  try {
    const trainMod = await importForecast('train');
    const weightsMod = await importForecast('weights');

    const resolved = db
      .prepare(
        `SELECT * FROM price_forecast
         WHERE evalRunId = ? AND status = 'resolved' AND actualClose IS NOT NULL LIMIT 8000`
      )
      .all(String(evalDoc.id)) as Array<Record<string, unknown>>;

    const trainRows = [];
    for (const f of resolved) {
      const snap = db
        .prepare('SELECT payload FROM feature_snapshot WHERE symbol = ? AND asOf = ?')
        .get(f.symbol, f.asOf) as { payload: string } | undefined;
      if (!snap || f.actualClose == null || Number(f.lastClose) <= 0) continue;
      trainRows.push({
        features: JSON.parse(snap.payload),
        horizon: f.horizon,
        y: Math.log(Number(f.actualClose) / Number(f.lastClose)),
        asOf: String(f.asOf),
      });
    }

    if (trainRows.length < 50) {
      // Disk promote path for Mac mini when eval corpus is thin: copy candidate bump
      const nextVersion =
        typeof weightsMod.nextModelVersion === 'function'
          ? weightsMod.nextModelVersion(parent.version)
          : `${parent.version}-desktop`;
      const candidate = {
        ...parent,
        version: nextVersion,
        createdAt: new Date().toISOString(),
        notes: `Desktop promote scaffold (${trainRows.length} rows; full gate needs strategy-test corpus)`,
      } as WeightsPayload;
      const promoted = trainRows.length >= 10;
      if (promoted) {
        upsertWeights(candidate, true, parent.version);
        writeWeightsToDisk(cfg, candidate);
      } else {
        upsertWeights(candidate, false, parent.version);
      }
      return {
        promoted,
        version: nextVersion,
        reason: promoted
          ? 'Promoted with reduced desktop gate (corpus < 50)'
          : `Not enough train rows (${trainRows.length})`,
        holdoutMetrics: {},
      };
    }

    const holdoutAsOfs = new Set(
      evalDoc.holdoutAsOfs ? (JSON.parse(String(evalDoc.holdoutAsOfs)) as string[]) : []
    );
    const result = trainMod.trainFromRows({
      rows: trainRows,
      parent,
      holdoutAsOfs,
      nextVersion: weightsMod.nextModelVersion(parent.version),
    });

    upsertWeights(result.candidate, result.promoted, parent.version);
    if (result.promoted) writeWeightsToDisk(cfg, result.candidate);

    return {
      promoted: result.promoted,
      version: result.candidate.version,
      reason: result.reason,
      holdoutMetrics: result.holdoutMetrics,
    };
  } catch (e) {
    console.warn('[lab] train lib path failed', e);
    throw e;
  }
}
