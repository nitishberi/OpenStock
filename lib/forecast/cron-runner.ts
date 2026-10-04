/**
 * Inngest/cron entrypoints that skip the interactive session gate.
 */

import { connectToDatabase } from '@/database/mongoose';
import { FeatureSnapshot } from '@/database/models/feature-snapshot.model';
import { PriceForecast } from '@/database/models/price-forecast.model';
import { ModelWeights } from '@/database/models/model-weights.model';
import { EvalRun } from '@/database/models/eval-run.model';
import { FactorAttribution } from '@/database/models/factor-attribution.model';
import {
  computeFactorAttribution,
  createSwingBaselineV1,
  narrateAttribution,
  nextModelVersion,
  runStrategyTest,
  trainFromRows,
  type ModelWeightsPayload,
  type FeatureSnapshotValues,
} from '@/lib/forecast';

async function activeWeights(): Promise<ModelWeightsPayload> {
  await connectToDatabase();
  const active = await ModelWeights.findOne({ active: true }).lean();
  if (active?.payload) return active.payload as ModelWeightsPayload;
  const v1 = createSwingBaselineV1();
  await ModelWeights.findOneAndUpdate(
    { version: v1.version },
    { version: v1.version, payload: v1, active: true },
    { upsert: true }
  );
  return v1;
}

export async function ensureCronStrategyTest(opts?: { symbolLimit?: number }) {
  const weights = await activeWeights();
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
      symbolLimit: opts?.symbolLimit ?? 100,
      windowDays: 120,
      liveMedia: false,
      delayMs: 400,
    });

    for (const row of result.rows.slice(0, 4000)) {
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
    await FactorAttribution.create({ ...attrBase, narrative });

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

    return { evalRunId: String(evalDoc._id), summary: result.summary };
  } catch (e) {
    await EvalRun.updateOne(
      { _id: evalDoc._id },
      { $set: { status: 'failed', error: e instanceof Error ? e.message : String(e) } }
    );
    throw e;
  }
}

export async function ensureCronTrain(evalRunId: string) {
  await connectToDatabase();
  const weights = await activeWeights();
  const evalDoc = await EvalRun.findById(evalRunId);
  if (!evalDoc) throw new Error('eval run missing');

  const resolved = await PriceForecast.find({
    evalRunId,
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
      features: snap as unknown as FeatureSnapshotValues,
      horizon: f.horizon,
      y: Math.log(f.actualClose / f.lastClose),
      asOf: f.asOf,
    });
  }

  if (trainRows.length < 50) {
    return { promoted: false, reason: 'insufficient rows', version: weights.version };
  }

  const result = trainFromRows({
    rows: trainRows,
    parent: weights,
    holdoutAsOfs: new Set(evalDoc.holdoutAsOfs || []),
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
