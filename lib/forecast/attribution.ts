/**
 * Factor attribution after strategy tests: Spearman correlations + grouped ablation.
 * Gemini only narrates quantitative results — never invents numbers.
 */

import { forecastHorizons } from './baseline';
import { FEATURE_GROUP_OF, FEATURE_KEYS, type FeatureKey } from './weights';
import type {
  FactorAttributionReportValues,
  FactorScore,
  FeatureGroup,
  FeatureSnapshotValues,
  ModelWeightsPayload,
} from './types';
import type { ResolvedForecastRow } from './strategy-test';

function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 5) return 0;
  const rank = (arr: number[]) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = Array(arr.length).fill(0);
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j < sorted.length && sorted[j].v === sorted[i].v) j++;
      const avg = (i + j - 1) / 2 + 1;
      for (let k = i; k < j; k++) ranks[sorted[k].i] = avg;
      i = j;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

function mapeOf(rows: ResolvedForecastRow[], weights: ModelWeightsPayload, zeroGroup?: FeatureGroup): number {
  if (!rows.length) return 0;
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    const features = { ...row.features };
    if (zeroGroup) {
      for (const k of FEATURE_KEYS) {
        if (FEATURE_GROUP_OF[k] === zeroGroup) {
          (features as unknown as Record<string, number>)[k] =
            k === 'daysSinceLastPress' || k === 'daysSinceLastInsiderBuy' ? 30 : 0;
        }
      }
    }
    const preds = forecastHorizons({
      features,
      lastClose: row.lastClose,
      weights,
    });
    const pred = preds.find((p) => p.horizon === row.horizon);
    if (!pred || row.actualClose == null) continue;
    sum += Math.abs(pred.yHat - row.actualClose) / row.actualClose;
    n++;
  }
  return n ? sum / n : 0;
}

function directionRate(rows: ResolvedForecastRow[], weights: ModelWeightsPayload, zeroGroup?: FeatureGroup): number {
  if (!rows.length) return 0;
  let hits = 0;
  let n = 0;
  for (const row of rows) {
    const features = { ...row.features };
    if (zeroGroup) {
      for (const k of FEATURE_KEYS) {
        if (FEATURE_GROUP_OF[k] === zeroGroup) {
          (features as unknown as Record<string, number>)[k] =
            k === 'daysSinceLastPress' || k === 'daysSinceLastInsiderBuy' ? 30 : 0;
        }
      }
    }
    const preds = forecastHorizons({
      features: features as FeatureSnapshotValues,
      lastClose: row.lastClose,
      weights,
    });
    const pred = preds.find((p) => p.horizon === row.horizon);
    if (!pred || row.actualClose == null) continue;
    const actDir =
      row.actualClose > row.lastClose * 1.0015
        ? 'up'
        : row.actualClose < row.lastClose * 0.9985
          ? 'down'
          : 'flat';
    if (pred.direction === actDir) hits++;
    n++;
  }
  return n ? hits / n : 0;
}

export function computeFactorAttribution(input: {
  rows: ResolvedForecastRow[];
  weights: ModelWeightsPayload;
  evalRunId: string;
}): Omit<FactorAttributionReportValues, 'narrative'> {
  const { rows, weights } = input;
  const baseMape = mapeOf(rows, weights);
  const baseDir = directionRate(rows, weights);

  const factors: FactorScore[] = [];
  for (const key of FEATURE_KEYS) {
    const xs = rows.map((r) => Number(r.features[key as keyof FeatureSnapshotValues] ?? 0));
    const signed = rows.map((r) => r.signedError ?? 0);
    const dir = rows.map((r) => (r.directionHit ? 1 : 0));
    const spearmanSignedError = spearman(xs, signed);
    const spearmanDirectionHit = spearman(xs, dir);

    // Single-feature ablation: zero that feature
    let ablMape = baseMape;
    {
      let sum = 0;
      let n = 0;
      for (const row of rows) {
        const features = { ...row.features } as FeatureSnapshotValues & Record<string, number>;
        features[key] = key === 'daysSinceLastPress' || key === 'daysSinceLastInsiderBuy' ? 30 : 0;
        const preds = forecastHorizons({ features, lastClose: row.lastClose, weights });
        const pred = preds.find((p) => p.horizon === row.horizon);
        if (!pred || row.actualClose == null) continue;
        sum += Math.abs(pred.yHat - row.actualClose) / row.actualClose;
        n++;
      }
      ablMape = n ? sum / n : baseMape;
    }

    const ablationMapeDelta = ablMape - baseMape; // positive => feature helped (removing hurts)
    factors.push({
      feature: key,
      group: FEATURE_GROUP_OF[key as FeatureKey],
      spearmanSignedError,
      spearmanDirectionHit,
      ablationMapeDelta,
      helpful: ablationMapeDelta > 0,
    });
  }

  factors.sort((a, b) => Math.abs(b.ablationMapeDelta) - Math.abs(a.ablationMapeDelta));

  const channelSummary = {} as FactorAttributionReportValues['channelSummary'];
  for (const g of ['price', 'news', 'social', 'press', 'insider'] as FeatureGroup[]) {
    const mapeDelta = mapeOf(rows, weights, g) - baseMape;
    const directionLift = baseDir - directionRate(rows, weights, g);
    channelSummary[g] = { mapeDelta, directionLift };
  }

  return {
    evalRunId: input.evalRunId,
    modelVersion: weights.version,
    createdAt: new Date().toISOString(),
    factors,
    channelSummary,
  };
}

export async function narrateAttribution(
  report: Omit<FactorAttributionReportValues, 'narrative'>
): Promise<string> {
  const top = report.factors.slice(0, 8);
  const fallback = `Top factors by ablation MAPE delta: ${top
    .map((f) => `${f.feature} (${f.group}: ${f.ablationMapeDelta.toFixed(4)})`)
    .join('; ')}. Channels: ${Object.entries(report.channelSummary)
    .map(([k, v]) => `${k} mapeΔ=${v.mapeDelta.toFixed(4)}`)
    .join(', ')}.`;

  if (!process.env.GEMINI_API_KEY) return fallback;

  try {
    const { callAIProviderWithFallback } = await import('@/lib/ai-provider');
    const text = await callAIProviderWithFallback(
      `Summarize this quantitative factor attribution in 3-5 sentences.
Do NOT invent numbers — only restate these facts:
${JSON.stringify({ top, channelSummary: report.channelSummary, modelVersion: report.modelVersion })}`
    );
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}
