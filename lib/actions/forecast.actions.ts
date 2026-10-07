'use server';

import { connectToDatabase } from '@/database/mongoose';
import { FeatureSnapshot } from '@/database/models/feature-snapshot.model';
import { PriceForecast } from '@/database/models/price-forecast.model';
import { ModelWeights } from '@/database/models/model-weights.model';
import { EvalRun } from '@/database/models/eval-run.model';
import { FactorAttribution } from '@/database/models/factor-attribution.model';
import { getSession } from '@/lib/better-auth/auth';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import {
  assembleFeatureSnapshot,
  collectInsiderFeatures,
  collectMediaFeatures,
  computeFactorAttribution,
  createSwingBaselineV1,
  explainAndClampForecasts,
  fetchDailyBars,
  forecastHorizons,
  getForecastUniverse,
  getSectorMap,
  narrateAttribution,
  nextModelVersion,
  runStrategyTest,
  toUtcDateString,
  trainFromRows,
  previousTradingDayOnOrBefore,
  addTradingDays,
  closeOnDate,
  HORIZON_DAYS,
  type ModelWeightsPayload,
  type PriceForecastValues,
} from '@/lib/forecast';

async function ensureActiveWeights(): Promise<ModelWeightsPayload> {
  await connectToDatabase();
  const { normalizeWeights } = await import('@/lib/forecast/weights');
  const active = await ModelWeights.findOne({ active: true }).lean();
  if (active?.payload) return normalizeWeights(active.payload as ModelWeightsPayload);

  const v1 = createSwingBaselineV1();
  await ModelWeights.findOneAndUpdate(
    { version: v1.version },
    { version: v1.version, payload: v1, active: true },
    { upsert: true }
  );
  return v1;
}

export async function getActiveModelVersionAction(): Promise<{
  version: string;
  weights: ModelWeightsPayload;
}> {
  const weights = await ensureActiveWeights();
  return { version: weights.version, weights };
}

/** Live D1–D5 forecasts for watchlist (or provided symbols). */
export async function runWatchlistForecastsAction(symbols?: string[]): Promise<{
  forecasts: PriceForecastValues[];
  modelVersion: string;
  asOf: string;
}> {
  const session = await getSession();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const weights = await ensureActiveWeights();
  const asOf = toUtcDateString(previousTradingDayOnOrBefore(new Date()));
  const sectorMap = getSectorMap();

  let syms: string[] = symbols?.map((s) => s.toUpperCase()) ?? [];
  if (!syms.length) {
    const wl = await getUserWatchlist();
    syms = wl.map((w: { symbol: string }) => w.symbol.toUpperCase());
  }
  if (!syms.length) {
    syms = getForecastUniverse()
      .symbols.slice(0, 8)
      .map((s) => s.symbol);
  }

  let spyBars: Awaited<ReturnType<typeof fetchDailyBars>> = [];
  try {
    spyBars = await fetchDailyBars('SPY');
  } catch {
    spyBars = [];
  }

  const forecasts: PriceForecastValues[] = [];

  for (const symbol of syms.slice(0, 20)) {
    try {
      const bars = await fetchDailyBars(symbol);
      const media = await collectMediaFeatures(symbol, { persist: true, enrichBodies: false });
      const insider = await collectInsiderFeatures(symbol, asOf, { refreshTicker: false });
      const evidenceUrls = [...media.evidenceUrls, ...insider.evidenceUrls];
      const { features, lastClose } = assembleFeatureSnapshot({
        symbol,
        asOf,
        sector: sectorMap.get(symbol) || 'Unknown',
        bars,
        spyBars,
        news: media.news,
        social: media.social,
        press: media.press,
        insider: insider.features,
      });

      await FeatureSnapshot.findOneAndUpdate(
        { symbol, asOf },
        { $set: features },
        { upsert: true }
      );
      const snap = await FeatureSnapshot.findOne({ symbol, asOf }).lean();

      let preds = forecastHorizons({
        features,
        lastClose,
        weights,
        evidenceUrls,
        rationale: insider.evidenceLine
          ? `Insider: ${insider.evidenceLine}. Baseline ${weights.version}.`
          : undefined,
      });
      preds = await explainAndClampForecasts({
        features,
        forecasts: preds,
        evidenceUrls,
      });

      for (const p of preds) {
        const doc = await PriceForecast.findOneAndUpdate(
          { symbol, asOf, horizon: p.horizon, modelVersion: weights.version },
          {
            $set: {
              ...p,
              featureVectorId: snap ? String(snap._id) : undefined,
              status: 'active',
            },
          },
          { upsert: true, new: true }
        );
        forecasts.push({
          ...p,
          featureVectorId: doc.featureVectorId,
        });
      }
    } catch (e) {
      console.warn(`forecast failed for ${symbol}`, e);
    }
  }

  return { forecasts, modelVersion: weights.version, asOf };
}

export async function getLatestForecastsAction(symbols?: string[]) {
  await connectToDatabase();
  const q: Record<string, unknown> = { status: { $in: ['active', 'resolved'] } };
  if (symbols?.length) q.symbol = { $in: symbols.map((s) => s.toUpperCase()) };
  const rows = await PriceForecast.find(q).sort({ asOf: -1, createdAt: -1 }).limit(200).lean();
  return JSON.parse(JSON.stringify(rows));
}

export async function resolveDueForecastsAction(): Promise<{ resolved: number }> {
  await connectToDatabase();
  const active = await PriceForecast.find({ status: 'active' }).limit(500).lean();
  let resolved = 0;
  for (const f of active) {
    const horizonDate = toUtcDateString(addTradingDays(f.asOf, HORIZON_DAYS[f.horizon]));
    const today = toUtcDateString(previousTradingDayOnOrBefore(new Date()));
    if (horizonDate > today) continue;
    try {
      const bars = await fetchDailyBars(f.symbol);
      const actual = closeOnDate(bars, horizonDate);
      if (actual == null) continue;
      const absError = Math.abs(f.yHat - actual);
      await PriceForecast.updateOne(
        { _id: f._id },
        {
          $set: {
            status: 'resolved',
            actualClose: actual,
            absError,
            pctError: absError / actual,
            signedError: f.yHat - actual,
            directionHit:
              f.direction ===
              (actual > f.lastClose * 1.0015 ? 'up' : actual < f.lastClose * 0.9985 ? 'down' : 'flat'),
            inside80: actual >= f.lo80 && actual <= f.hi80,
          },
        }
      );
      resolved++;
    } catch (e) {
      console.warn('resolve failed', f.symbol, e);
    }
  }
  return { resolved };
}

/** Run 100-stock strategy test; persist rows + attribution. */
export async function runStrategyTestAction(opts?: {
  symbolLimit?: number;
  windowDays?: number;
  liveMedia?: boolean;
}): Promise<{
  evalRunId: string;
  summary: unknown;
  attributionId?: string;
}> {
  const session = await getSession();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const weights = await ensureActiveWeights();
  await connectToDatabase();

  const evalDoc = await EvalRun.create({
    kind: 'strategy_test',
    modelVersion: weights.version,
    summary: {
      modelVersion: weights.version,
      asOfStart: '',
      asOfEnd: '',
      symbolCount: 0,
      byHorizon: {
        D1: { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 },
        D2: { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 },
        D3: { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 },
        D5: { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 },
      },
    },
    holdoutAsOfs: [],
    rowCount: 0,
    status: 'running',
  });

  try {
    const result = await runStrategyTest({
      weights,
      symbolLimit: opts?.symbolLimit,
      windowDays: opts?.windowDays ?? 120,
      liveMedia: opts?.liveMedia ?? false,
      delayMs: 400,
    });

    // Persist a sample of resolved rows (cap to keep Mongo sane)
    const sample = result.rows.slice(0, 4000);
    for (const row of sample) {
      const { features, sector: _s, ...forecast } = row;
      await FeatureSnapshot.findOneAndUpdate(
        { symbol: features.symbol, asOf: features.asOf },
        { $set: features },
        { upsert: true }
      );
      await PriceForecast.findOneAndUpdate(
        {
          symbol: forecast.symbol,
          asOf: forecast.asOf,
          horizon: forecast.horizon,
          modelVersion: weights.version,
        },
        { $set: { ...forecast, evalRunId: String(evalDoc._id), status: 'resolved' } },
        { upsert: true }
      );
    }

    const attrBase = computeFactorAttribution({
      rows: result.rows,
      weights,
      evalRunId: String(evalDoc._id),
    });
    const narrative = await narrateAttribution(attrBase);
    const attrDoc = await FactorAttribution.create({ ...attrBase, narrative });

    await EvalRun.updateOne(
      { _id: evalDoc._id },
      {
        $set: {
          status: 'completed',
          summary: result.summary,
          holdoutAsOfs: result.holdoutAsOfs,
          rowCount: result.rows.length,
        },
      }
    );

    // Stash train rows on the eval summary via a side collection field isn't available —
    // train action re-runs a lighter path or reads resolved forecasts.
    return {
      evalRunId: String(evalDoc._id),
      summary: result.summary,
      attributionId: String(attrDoc._id),
    };
  } catch (e) {
    await EvalRun.updateOne(
      { _id: evalDoc._id },
      { $set: { status: 'failed', error: e instanceof Error ? e.message : String(e) } }
    );
    throw e;
  }
}

export async function trainFromLastEvalAction(evalRunId?: string): Promise<{
  promoted: boolean;
  version: string;
  reason: string;
  holdoutMetrics: unknown;
}> {
  const session = await getSession();
  if (!session?.user?.id) throw new Error('Unauthorized');

  await connectToDatabase();
  const weights = await ensureActiveWeights();

  const evalDoc = evalRunId
    ? await EvalRun.findById(evalRunId)
    : await EvalRun.findOne({ status: 'completed' }).sort({ createdAt: -1 });
  if (!evalDoc) throw new Error('No completed eval run');

  const resolved = await PriceForecast.find({
    evalRunId: String(evalDoc._id),
    status: 'resolved',
    actualClose: { $ne: null },
  })
    .limit(8000)
    .lean();

  const trainRows = [];
  for (const f of resolved) {
    const snap = await FeatureSnapshot.findOne({ symbol: f.symbol, asOf: f.asOf }).lean();
    if (!snap || f.actualClose == null || f.lastClose <= 0) continue;
    trainRows.push({
      features: snap as unknown as import('@/lib/forecast').FeatureSnapshotValues,
      horizon: f.horizon,
      y: Math.log(f.actualClose / f.lastClose),
      asOf: f.asOf,
    });
  }

  if (trainRows.length < 50) {
    throw new Error(`Not enough train rows (${trainRows.length}); run strategy test first.`);
  }

  const holdoutAsOfs = new Set(evalDoc.holdoutAsOfs || []);
  const result = trainFromRows({
    rows: trainRows,
    parent: weights,
    holdoutAsOfs,
    nextVersion: nextModelVersion(weights.version),
  });

  await ModelWeights.findOneAndUpdate(
    { version: result.candidate.version },
    {
      version: result.candidate.version,
      payload: result.candidate,
      active: result.promoted,
      promotedFrom: weights.version,
    },
    { upsert: true }
  );

  if (result.promoted) {
    await ModelWeights.updateMany(
      { version: { $ne: result.candidate.version } },
      { $set: { active: false } }
    );
  }

  return {
    promoted: result.promoted,
    version: result.candidate.version,
    reason: result.reason,
    holdoutMetrics: result.holdoutMetrics,
  };
}

export async function getForecastLabDataAction() {
  await connectToDatabase();
  const [weights, evals, attributions, sampleRows] = await Promise.all([
    ensureActiveWeights(),
    EvalRun.find({}).sort({ createdAt: -1 }).limit(10).lean(),
    FactorAttribution.find({}).sort({ createdAt: -1 }).limit(5).lean(),
    PriceForecast.find({ status: 'resolved' }).sort({ asOf: -1 }).limit(200).lean(),
  ]);

  return JSON.parse(
    JSON.stringify({
      activeVersion: weights.version,
      weights,
      evals,
      attributions,
      sampleRows,
      universeCount: getForecastUniverse().count,
      socialIntake: 'tavily-rss-scrapling-vader',
    })
  );
}
