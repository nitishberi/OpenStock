/**
 * Offline walk-forward strategy test on the 100-stock universe.
 *
 * Usage:
 *   npx tsx scripts/strategy-test-swing.ts [--smoke] [--live-media] [--limit=10] [--window=60]
 *     [--parent=swing-baseline-v2] [--promote] [--include-cohort]
 *
 * Requires Finnhub keys in env (or project secrets). Does not place orders.
 * `--live-media` fetches news/social/press (Tavily/RSS → optional Scrapling → VADER)
 * on latest asOf AND every 5th historical asOf so Lab channel attribution can be non-zero.
 * `--promote` trains next version from parent + walk-forward rows (and optional ingested cohort).
 */

import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

const WEIGHTS_CACHE =
  '/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/artifacts/swing-baseline-v2.weights.json';
const V3_CACHE =
  '/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/artifacts/swing-baseline-v3.weights.json';

function loadCachedWeights(path: string) {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.version && parsed?.coefficients && parsed?.blend) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

async function loadParentWeights(preferVersion?: string) {
  const { createSwingBaselineV1, normalizeWeights } = await import('../lib/forecast');

  // Prefer Mongo active / named version
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      const mongoose = (await import('mongoose')).default;
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500, connectTimeoutMS: 2500 });
      const { ModelWeights } = await import('../database/models/model-weights.model');
      if (preferVersion) {
        const named = await ModelWeights.findOne({ version: preferVersion }).lean();
        if (named?.payload) {
          const w = normalizeWeights(named.payload as import('../lib/forecast').ModelWeightsPayload);
          await mongoose.disconnect();
          return { weights: w, source: `mongodb:${preferVersion}` };
        }
      }
      const active = await ModelWeights.findOne({ active: true }).lean();
      if (active?.payload) {
        const w = normalizeWeights(active.payload as import('../lib/forecast').ModelWeightsPayload);
        await mongoose.disconnect();
        return { weights: w, source: 'mongodb-active' };
      }
      await mongoose.disconnect();
    } catch (e) {
      console.warn('Mongo parent load skipped:', e instanceof Error ? e.message : e);
      try {
        const mongoose = (await import('mongoose')).default;
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  const cached = loadCachedWeights(WEIGHTS_CACHE);
  if (cached) {
    const { normalizeWeights: nw } = await import('../lib/forecast');
    return { weights: nw(cached), source: 'project-store-cache-v2' };
  }

  return { weights: createSwingBaselineV1(), source: 'builtin-v1' };
}

async function loadCohortTrainRows() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return [];
  try {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
    }
    const { PriceForecast } = await import('../database/models/price-forecast.model');
    const { FeatureSnapshot } = await import('../database/models/feature-snapshot.model');
    const resolved = await PriceForecast.find({
      status: 'resolved',
      actualClose: { $ne: null },
      // Prefer the filled cohort asOf; include any resolved without evalRunId from ingest
      $or: [{ evalRunId: { $exists: false } }, { evalRunId: null }, { asOf: '2026-10-02' }],
    })
      .limit(2000)
      .lean();

    const trainRows: import('../lib/forecast').TrainRow[] = [];
    for (const f of resolved) {
      if (f.actualClose == null || !(f.lastClose > 0)) continue;
      const snap = await FeatureSnapshot.findOne({ symbol: f.symbol, asOf: f.asOf }).lean();
      if (!snap) continue;
      trainRows.push({
        features: snap as unknown as import('../lib/forecast').FeatureSnapshotValues,
        horizon: f.horizon,
        y: Math.log(f.actualClose / f.lastClose),
        asOf: f.asOf,
      });
    }
    return trainRows;
  } catch (e) {
    console.warn('Cohort train rows unavailable:', e instanceof Error ? e.message : e);
    return [];
  }
}

async function persistPromotion(
  candidate: import('../lib/forecast').ModelWeightsPayload,
  promoted: boolean,
  parentVersion: string
) {
  mkdirSync(dirname(V3_CACHE), { recursive: true });
  writeFileSync(V3_CACHE, JSON.stringify(candidate, null, 2), 'utf8');
  console.log(`Wrote candidate weights → ${V3_CACHE}`);

  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  try {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
    }
    const { ModelWeights } = await import('../database/models/model-weights.model');
    await ModelWeights.findOneAndUpdate(
      { version: candidate.version },
      {
        version: candidate.version,
        payload: candidate,
        active: promoted,
        promotedFrom: parentVersion,
      },
      { upsert: true }
    );
    if (promoted) {
      await ModelWeights.updateMany(
        { version: { $ne: candidate.version } },
        { $set: { active: false } }
      );
      console.log(`Promoted ${candidate.version} to active in Mongo`);
    } else {
      console.log(`Stored ${candidate.version} in Mongo as inactive (gate failed)`);
    }
  } catch (e) {
    console.warn('Mongo promote persist failed:', e instanceof Error ? e.message : e);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const liveMedia = args.includes('--live-media');
  const doPromote = args.includes('--promote') || (!smoke && !liveMedia);
  const includeCohort = args.includes('--include-cohort') || doPromote;
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const windowArg = args.find((a) => a.startsWith('--window='));
  const parentArg = args.find((a) => a.startsWith('--parent='));
  const preferParent = parentArg ? parentArg.split('=')[1] : 'swing-baseline-v2';
  const symbolLimit = limitArg ? Number(limitArg.split('=')[1]) : smoke ? 5 : 100;
  const windowDays = windowArg ? Number(windowArg.split('=')[1]) : smoke ? 40 : 120;

  const { runStrategyTest, computeFactorAttribution, trainFromRows, nextModelVersion } =
    await import('../lib/forecast');

  const { weights, source } = await loadParentWeights(preferParent);
  console.log(
    `Running strategy test model=${weights.version} source=${source} symbols=${symbolLimit} window=${windowDays} liveMedia=${liveMedia}`
  );

  const result = await runStrategyTest({
    weights,
    symbolLimit,
    windowDays,
    liveMedia,
    delayMs: 400,
    onProgress: (m) => console.log(m),
  });

  console.log(JSON.stringify(result.summary, null, 2));

  const attr = computeFactorAttribution({
    rows: result.rows,
    weights,
    evalRunId: 'cli',
  });
  console.log('Top factors:', attr.factors.slice(0, 8));
  console.log('Channels:', attr.channelSummary);

  if (liveMedia) {
    const mediaRows = result.rows.filter(
      (r) =>
        r.features.newsCount48h > 0 ||
        r.features.socialVolume > 0 ||
        r.features.pressCount7d > 0 ||
        r.features.newsSentiment !== 0 ||
        r.features.socialSentiment !== 0 ||
        r.features.pressSentiment !== 0 ||
        r.features.insiderBuyCount7d > 0
    );
    const bySym = new Map<string, (typeof result.rows)[0]['features']>();
    for (const r of mediaRows) {
      if (!bySym.has(r.symbol)) bySym.set(r.symbol, r.features);
    }
    console.log(
      'Live media feature snapshot (one asOf per symbol with non-zero media):',
      Object.fromEntries(
        [...bySym.entries()].map(([sym, f]) => [
          sym,
          {
            newsCount48h: f.newsCount48h,
            newsSentiment: Number(f.newsSentiment.toFixed(4)),
            socialVolume: f.socialVolume,
            socialSentiment: Number(f.socialSentiment.toFixed(4)),
            pressCount7d: f.pressCount7d,
            pressSentiment: Number(f.pressSentiment.toFixed(4)),
            pressEventScore: f.pressEventScore,
            insiderBuyCount7d: f.insiderBuyCount7d,
          },
        ])
      )
    );
    console.log(`Rows with non-zero media/insider features: ${mediaRows.length}/${result.rows.length}`);
  }

  if (!doPromote) {
    console.log('Skipping train/promote (smoke or --live-media without --promote)');
    return;
  }

  let cohortRows: import('../lib/forecast').TrainRow[] = [];
  if (includeCohort) {
    cohortRows = await loadCohortTrainRows();
    console.log(`Including ${cohortRows.length} ingested cohort train rows`);
  }

  const allRows = [...result.trainRows, ...cohortRows];
  const nextVersion = nextModelVersion(weights.version);
  const trained = trainFromRows({
    rows: allRows,
    parent: weights,
    holdoutAsOfs: new Set(result.holdoutAsOfs),
    nextVersion,
  });
  console.log('Train gate:', {
    promoted: trained.promoted,
    version: trained.candidate.version,
    reason: trained.reason,
    bandK: trained.candidate.bandK,
    confidenceCalib: trained.candidate.confidenceCalib,
    holdout: trained.holdoutMetrics,
    parentHoldoutHint: result.summary.byHorizon,
  });

  await persistPromotion(trained.candidate, trained.promoted, weights.version);

  // Machine-readable promote summary for the worker report
  const summaryPath =
    '/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/artifacts/forecast-v3-train-gate.json';
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        parentVersion: weights.version,
        parentSource: source,
        candidateVersion: trained.candidate.version,
        promoted: trained.promoted,
        reason: trained.reason,
        bandK: trained.candidate.bandK,
        confidenceCalib: trained.candidate.confidenceCalib,
        holdoutMetrics: trained.holdoutMetrics,
        trainMetrics: trained.trainMetrics,
        walkForwardRows: result.trainRows.length,
        cohortRows: cohortRows.length,
        holdoutAsOfs: result.holdoutAsOfs,
        strategySummary: result.summary,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`Wrote train gate summary → ${summaryPath}`);

  try {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
