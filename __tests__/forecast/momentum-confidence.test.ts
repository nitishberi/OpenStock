import { describe, expect, it } from 'vitest';
import {
  assembleFeatureSnapshot,
  calibrateBandK,
  confidenceFrom,
  confidenceFromResiduals,
  createSwingBaselineV1,
  directionFromReturn,
  FEATURE_KEYS,
  fitConfidenceCalib,
  predictLogReturn,
  synthesizeBars,
  trainFromRows,
  type FeatureSnapshotValues,
  type ModelWeightsPayload,
  type TrainRow,
} from '@/lib/forecast';

function makeFeatures(partial: Partial<FeatureSnapshotValues> = {}): FeatureSnapshotValues {
  const bars = synthesizeBars(100, 80, 2);
  const { features } = assembleFeatureSnapshot({
    symbol: 'TEST',
    asOf: '2024-04-15',
    sector: 'Technology',
    bars,
  });
  return { ...features, ...partial };
}

describe('spy/sector momentum features', () => {
  it('includes spyRet5d and spyRet10d in FEATURE_KEYS', () => {
    expect(FEATURE_KEYS).toContain('spyRet5d');
    expect(FEATURE_KEYS).toContain('spyRet10d');
    expect(FEATURE_KEYS).toContain('spyRel5d');
  });

  it('computes absolute SPY returns and non-zero sectorRel5d when sector bars provided', () => {
    const stock = synthesizeBars(100, 90, 1);
    // SPY trending up harder than stock
    const spy = synthesizeBars(400, 90, 7).map((b, i) => ({
      ...b,
      c: 400 * Math.pow(1.004, i),
    }));
    const sector = synthesizeBars(80, 90, 3).map((b, i) => ({
      ...b,
      c: 80 * Math.pow(1.003, i),
    }));
    const asOf = new Date(stock.at(-1)!.t).toISOString().slice(0, 10);
    const { features } = assembleFeatureSnapshot({
      symbol: 'TEST',
      asOf,
      sector: 'Technology',
      bars: stock,
      spyBars: spy,
      sectorBars: sector,
    });
    expect(features.spyRet5d).not.toBe(0);
    expect(features.spyRet10d).not.toBe(0);
    expect(features.sectorRel5d).not.toBe(0);
    expect(Number.isFinite(features.spyRel5d)).toBe(true);
  });

  it('applies stronger D3/D5 SPY momentum tilt than D1', () => {
    const weights = createSwingBaselineV1();
    const features = makeFeatures({
      spyRet5d: 0.04,
      spyRet10d: 0.06,
      sectorRel5d: 0.02,
      ret1d: 0,
      ret5d: 0,
      sma20Dist: 0,
    });
    const d1 = predictLogReturn(features, weights, 'D1').mu;
    const d5 = predictLogReturn(features, weights, 'D5').mu;
    expect(d5).toBeGreaterThan(d1);
  });
});

describe('direction deadband + spy bias', () => {
  it('returns flat for tiny mu when spy is near zero', () => {
    expect(directionFromReturn(0.0001, { vol21d: 0.2, spyRet5d: 0 })).toBe('flat');
  });

  it('biases toward spyRet5d sign when |mu| inside vol-scaled deadband', () => {
    expect(directionFromReturn(0.0002, { vol21d: 0.25, spyRet5d: 0.03 })).toBe('up');
    expect(directionFromReturn(-0.0002, { vol21d: 0.25, spyRet5d: -0.03 })).toBe('down');
  });

  it('widens deadband when vol is high', () => {
    // mu that would be "up" under fixed 0.0015 eps but flat under high-vol deadband
    const dir = directionFromReturn(0.002, { vol21d: 0.8, spyRet5d: 0 });
    expect(dir).toBe('flat');
  });
});

describe('residual confidence calibration', () => {
  it('falls back to heuristic when weights lack confidenceCalib', () => {
    const features = makeFeatures({ vol21d: 0.2 });
    const weights = createSwingBaselineV1();
    const a = confidenceFromResiduals(features, 'D1', weights, 0.05);
    const b = confidenceFrom(features, 0.05);
    expect(a).toBe(b);
  });

  it('is monotonic: larger residual σ → lower confidence', () => {
    const features = makeFeatures({ vol21d: 0.2 });
    const base = createSwingBaselineV1();
    const lowSigma: ModelWeightsPayload = {
      ...base,
      confidenceCalib: {
        residualSigma: { D1: 0.005, D2: 0.005, D3: 0.005, D5: 0.005 },
      },
    };
    const highSigma: ModelWeightsPayload = {
      ...base,
      confidenceCalib: {
        residualSigma: { D1: 0.05, D2: 0.05, D3: 0.05, D5: 0.05 },
      },
    };
    const cLow = confidenceFromResiduals(features, 'D5', lowSigma, 0.04);
    const cHigh = confidenceFromResiduals(features, 'D5', highSigma, 0.04);
    expect(cLow).toBeGreaterThan(cHigh);
  });

  it('persists confidenceCalib + widens D5 bandK on train', () => {
    const parent = createSwingBaselineV1();
    const features = makeFeatures({ vol21d: 0.3 });
    const rows: TrainRow[] = [];
    // Enough rows for ridge + calibrate (≥30 per horizon, holdout set)
    const asOfs: string[] = [];
    for (let i = 0; i < 50; i++) {
      const asOf = `2024-0${Math.floor(i / 28) + 1}-${String((i % 28) + 1).padStart(2, '0')}`;
      asOfs.push(asOf);
      for (const horizon of ['D1', 'D2', 'D3', 'D5'] as const) {
        rows.push({
          features: { ...features, asOf, symbol: `S${i % 5}` },
          horizon,
          y: (Math.sin(i) + (horizon === 'D5' ? 0.02 : 0)) * 0.01,
          asOf,
        });
      }
    }
    const holdout = new Set(asOfs.slice(-20));
    const trained = trainFromRows({
      rows,
      parent,
      holdoutAsOfs: holdout,
      nextVersion: 'swing-baseline-v3',
    });
    expect(trained.candidate.confidenceCalib?.residualSigma.D5).toBeGreaterThan(0);
    expect(trained.candidate.bandK.D5).toBeGreaterThanOrEqual(1.35);
  });

  it('calibrateBandK applies D5 floor above v2-like 1.23', () => {
    const weights = createSwingBaselineV1();
    weights.bandK.D5 = 1.23;
    const features = makeFeatures({ vol21d: 0.25 });
    const rows: TrainRow[] = [];
    for (let i = 0; i < 40; i++) {
      rows.push({
        features: { ...features, asOf: `2024-03-${String((i % 28) + 1).padStart(2, '0')}` },
        horizon: 'D5',
        y: 0.001 * i,
        asOf: `2024-03-${String((i % 28) + 1).padStart(2, '0')}`,
      });
    }
    const k = calibrateBandK(rows, weights);
    expect(k.D5).toBeGreaterThanOrEqual(1.35);
    const calib = fitConfidenceCalib(rows, weights);
    expect(calib.residualSigma.D5).toBeGreaterThan(0);
  });
});
