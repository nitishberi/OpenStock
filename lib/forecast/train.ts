/**
 * Constrained ridge / blend refit from frozen features × realized forward log-returns.
 * Holdout last 20 trading days; promote only if MAPE ≤ previous or direction improves
 * without coverage collapse.
 */

import type {
  ConfidenceCalib,
  FeatureSnapshotValues,
  ForecastHorizon,
  HorizonMetrics,
  ModelWeightsPayload,
} from './types';
import { FORECAST_HORIZONS } from './types';
import { FEATURE_KEYS, createSwingBaselineV1, scaleHorizonDays } from './weights';
import { predictLogReturn } from './baseline';

export interface TrainRow {
  features: FeatureSnapshotValues;
  horizon: ForecastHorizon;
  y: number; // realized forward log-return
  asOf: string;
}

export interface TrainResult {
  candidate: ModelWeightsPayload;
  trainMetrics: Record<ForecastHorizon, HorizonMetrics>;
  holdoutMetrics: Record<ForecastHorizon, HorizonMetrics>;
  promoted: boolean;
  reason: string;
}

function emptyMetrics(): HorizonMetrics {
  return { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 };
}

function metricsFromErrors(
  abs: number[],
  pct: number[],
  sq: number[],
  dirHits: number[],
  inside: number[]
): HorizonMetrics {
  const n = abs.length;
  if (!n) return emptyMetrics();
  return {
    n,
    mae: abs.reduce((a, b) => a + b, 0) / n,
    mape: pct.reduce((a, b) => a + b, 0) / n,
    rmse: Math.sqrt(sq.reduce((a, b) => a + b, 0) / n),
    directionHitRate: dirHits.reduce((a, b) => a + b, 0) / n,
    coverage80: inside.reduce((a, b) => a + b, 0) / n,
  };
}

function sampleStdev(values: number[]): number {
  if (values.length < 2) return values.length === 1 ? Math.abs(values[0]) : 0.01;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, v));
}

/** Simple ridge: (X'X + λI)^{-1} X'y with intercept in last column. */
export function fitRidge(
  X: number[][],
  y: number[],
  lambda = 1e-2
): { coef: number[]; intercept: number } {
  const n = X.length;
  if (!n) return { coef: [], intercept: 0 };
  const p = X[0].length;
  // Augment with intercept
  const dim = p + 1;
  const XtX: number[][] = Array.from({ length: dim }, () => Array(dim).fill(0));
  const Xty: number[] = Array(dim).fill(0);

  for (let i = 0; i < n; i++) {
    const row = [...X[i], 1];
    for (let a = 0; a < dim; a++) {
      Xty[a] += row[a] * y[i];
      for (let b = 0; b < dim; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < p; a++) XtX[a][a] += lambda; // don't regularize intercept

  const beta = solveLinearSystem(XtX, Xty);
  return { coef: beta.slice(0, p), intercept: beta[p] ?? 0 };
}

/** Gaussian elimination with partial pivoting. */
function solveLinearSystem(Ain: number[][], bin: number[]): number[] {
  const n = bin.length;
  const A = Ain.map((row, i) => [...row, bin[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    [A[col], A[pivot]] = [A[pivot], A[col]];
    const div = A[col][col] || 1e-12;
    for (let c = col; c <= n; c++) A[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row[n]);
}

function evalWeights(
  rows: TrainRow[],
  weights: ModelWeightsPayload,
  lastCloseFn: (f: FeatureSnapshotValues) => number
): Record<ForecastHorizon, HorizonMetrics> {
  const buckets: Record<ForecastHorizon, { abs: number[]; pct: number[]; sq: number[]; dir: number[]; inside: number[] }> =
    {
      D1: { abs: [], pct: [], sq: [], dir: [], inside: [] },
      D2: { abs: [], pct: [], sq: [], dir: [], inside: [] },
      D3: { abs: [], pct: [], sq: [], dir: [], inside: [] },
      D5: { abs: [], pct: [], sq: [], dir: [], inside: [] },
    };

  for (const row of rows) {
    const { mu } = predictLogReturn(row.features, weights, row.horizon);
    const last = lastCloseFn(row.features);
    const yHat = last * Math.exp(mu);
    const actual = last * Math.exp(row.y);
    const err = yHat - actual;
    const abs = Math.abs(err);
    const pct = last > 0 ? abs / last : 0;
    const predDir = mu > 0.0015 ? 1 : mu < -0.0015 ? -1 : 0;
    const actDir = row.y > 0.0015 ? 1 : row.y < -0.0015 ? -1 : 0;
    const dailyVol = Math.max(0.005, row.features.vol21d / Math.sqrt(252));
    const days = scaleHorizonDays(row.horizon);
    const half = weights.bandK[row.horizon] * dailyVol * Math.sqrt(days);
    const lo = last * Math.exp(mu - half);
    const hi = last * Math.exp(mu + half);
    const b = buckets[row.horizon];
    b.abs.push(abs);
    b.pct.push(pct);
    b.sq.push(err * err);
    b.dir.push(predDir === actDir || (predDir === 0 && Math.abs(row.y) < 0.0015) ? 1 : 0);
    b.inside.push(actual >= lo && actual <= hi ? 1 : 0);
  }

  const out = {} as Record<ForecastHorizon, HorizonMetrics>;
  for (const h of FORECAST_HORIZONS) {
    const b = buckets[h];
    out[h] = metricsFromErrors(b.abs, b.pct, b.sq, b.dir, b.inside);
  }
  return out;
}

/** Per-horizon target coverage for band k (~80%; D5 slightly higher to widen vs v2). */
const BAND_TARGET_COVERAGE: Record<ForecastHorizon, number> = {
  D1: 0.8,
  D2: 0.8,
  D3: 0.8,
  D5: 0.82,
};

/** Floors — D5 floor widens vs historical v2 ≈1.23. */
const BAND_K_FLOOR: Record<ForecastHorizon, number> = {
  D1: 0.9,
  D2: 0.95,
  D3: 1.0,
  D5: 1.35,
};

/** Recalibrate band k so train residual coverage ≈ 80% per horizon. */
export function calibrateBandK(
  rows: TrainRow[],
  weights: ModelWeightsPayload
): Record<ForecastHorizon, number> {
  const k = { ...weights.bandK };
  for (const h of FORECAST_HORIZONS) {
    const subset = rows.filter((r) => r.horizon === h);
    if (subset.length < 20) {
      // Still apply D5 floor even with sparse data
      k[h] = Math.max(BAND_K_FLOOR[h], k[h]);
      continue;
    }
    const absZ: number[] = [];
    for (const row of subset) {
      const { mu } = predictLogReturn(row.features, weights, h);
      const dailyVol = Math.max(0.005, row.features.vol21d / Math.sqrt(252));
      const days = scaleHorizonDays(h);
      const z = Math.abs(row.y - mu) / (dailyVol * Math.sqrt(days));
      absZ.push(z);
    }
    absZ.sort((a, b) => a - b);
    const target = BAND_TARGET_COVERAGE[h];
    const idx = Math.min(absZ.length - 1, Math.max(0, Math.floor(target * (absZ.length - 1))));
    const raw = absZ[idx] || weights.bandK[h];
    k[h] = Math.min(2.8, Math.max(BAND_K_FLOOR[h], raw));
  }
  return k;
}

/** Fit residual-σ confidence calibration from train residuals. */
export function fitConfidenceCalib(
  rows: TrainRow[],
  weights: ModelWeightsPayload
): ConfidenceCalib {
  const residualSigma = {} as Record<ForecastHorizon, number>;
  for (const h of FORECAST_HORIZONS) {
    const subset = rows.filter((r) => r.horizon === h);
    const residuals = subset.map((r) => {
      const { mu } = predictLogReturn(r.features, weights, h);
      return r.y - mu;
    });
    residualSigma[h] = Math.max(1e-4, sampleStdev(residuals));
  }
  return { residualSigma };
}

export function trainFromRows(input: {
  rows: TrainRow[];
  parent: ModelWeightsPayload;
  holdoutAsOfs: Set<string>;
  nextVersion: string;
}): TrainResult {
  const trainRows = input.rows.filter((r) => !input.holdoutAsOfs.has(r.asOf));
  const holdoutRows = input.rows.filter((r) => input.holdoutAsOfs.has(r.asOf));

  const candidate: ModelWeightsPayload = {
    ...structuredClone(input.parent),
    version: input.nextVersion,
    parentVersion: input.parent.version,
    createdAt: new Date().toISOString(),
    coefficients: { ...input.parent.coefficients },
    notes: `Ridge refit from ${trainRows.length} train rows; holdout ${holdoutRows.length}.`,
  };

  for (const h of FORECAST_HORIZONS) {
    const subset = trainRows.filter((r) => r.horizon === h);
    if (subset.length < 30) continue;
    const X = subset.map((r) => FEATURE_KEYS.map((k) => Number(r.features[k as keyof FeatureSnapshotValues] ?? 0)));
    const y = subset.map((r) => r.y);
    const { coef, intercept } = fitRidge(X, y, 5e-2);
    const next: Record<string, number> = { ...candidate.coefficients[h] };
    FEATURE_KEYS.forEach((k, i) => {
      // Shrink toward prior
      next[k] = 0.6 * (coef[i] ?? 0) + 0.4 * (candidate.coefficients[h][k] ?? 0);
    });
    candidate.coefficients[h] = next;
    candidate.blend[h] = {
      ...candidate.blend[h],
      intercept: 0.6 * intercept + 0.4 * (candidate.blend[h].intercept || 0),
    };
  }

  candidate.bandK = calibrateBandK(trainRows, candidate);
  candidate.confidenceCalib = fitConfidenceCalib(trainRows, candidate);

  const lastCloseFn = (f: FeatureSnapshotValues) => {
    // Reconstruct approximate last close from features is unavailable; use 100 placeholder
    // Metrics use relative errors via log space — use unit price
    return 100;
  };

  // Better: evaluate in log space by treating last=1
  const trainMetrics = evalWeights(trainRows, candidate, lastCloseFn);
  const holdoutMetrics = evalWeights(holdoutRows, candidate, lastCloseFn);
  const parentHoldout = evalWeights(holdoutRows, input.parent, lastCloseFn);

  const avg = (m: Record<ForecastHorizon, HorizonMetrics>, key: keyof HorizonMetrics) =>
    FORECAST_HORIZONS.reduce((a, h) => a + (m[h][key] as number), 0) / FORECAST_HORIZONS.length;

  const holdoutN = FORECAST_HORIZONS.reduce((a, h) => a + holdoutMetrics[h].n, 0);
  if (holdoutN < 20) {
    return {
      candidate,
      trainMetrics,
      holdoutMetrics,
      promoted: false,
      reason: `Holdout too small (n=${holdoutN}); not promoting ${input.nextVersion}.`,
    };
  }

  const mapeOk = avg(holdoutMetrics, 'mape') <= avg(parentHoldout, 'mape') * 1.001;
  const dirOk = avg(holdoutMetrics, 'directionHitRate') >= avg(parentHoldout, 'directionHitRate') - 0.005;
  const covOk = avg(holdoutMetrics, 'coverage80') >= Math.min(0.7, avg(parentHoldout, 'coverage80') - 0.08);
  const promoted = (mapeOk || (dirOk && avg(holdoutMetrics, 'directionHitRate') > avg(parentHoldout, 'directionHitRate'))) && covOk;

  return {
    candidate,
    trainMetrics,
    holdoutMetrics,
    promoted,
    reason: promoted
      ? `Holdout gate passed (mapeOk=${mapeOk}, dirOk=${dirOk}, covOk=${covOk}).`
      : `Holdout gate failed (mapeOk=${mapeOk}, dirOk=${dirOk}, covOk=${covOk}).`,
  };
}

export function nextModelVersion(current: string): string {
  const m = current.match(/swing-baseline-v(\d+)/);
  if (!m) return 'swing-baseline-v2';
  return `swing-baseline-v${Number(m[1]) + 1}`;
}

export function ensureV1(): ModelWeightsPayload {
  return createSwingBaselineV1();
}
