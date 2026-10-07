import { describe, expect, it } from 'vitest';
import {
  clampYHatToBand,
  createSwingBaselineV1,
  forecastHorizons,
  assembleFeatureSnapshot,
  synthesizeBars,
  fitRidge,
  trainFromRows,
  nextModelVersion,
  computeFactorAttribution,
  runStrategyTest,
  classifyPressHeuristic,
} from '@/lib/forecast';

describe('swing baseline forecaster', () => {
  it('emits D1–D5 inside vol-scaled bands', () => {
    const bars = synthesizeBars(100, 80, 2);
    const { features, lastClose } = assembleFeatureSnapshot({
      symbol: 'TEST',
      asOf: '2024-04-15',
      sector: 'Technology',
      bars,
    });
    const weights = createSwingBaselineV1();
    const preds = forecastHorizons({ features, lastClose, weights });
    expect(preds.map((p) => p.horizon)).toEqual(['D1', 'D2', 'D3', 'D5']);
    for (const p of preds) {
      expect(p.yHat).toBeGreaterThan(p.lo80);
      expect(p.yHat).toBeLessThan(p.hi80);
      expect(p.lastClose).toBeGreaterThan(0);
      expect(p.modelVersion).toBe('swing-baseline-v1');
    }
  });

  it('clamps Gemini nudges into bands', () => {
    expect(clampYHatToBand(50, 90, 110)).toBe(90);
    expect(clampYHatToBand(200, 90, 110)).toBe(110);
    expect(clampYHatToBand(100, 90, 110)).toBe(100);
  });
});

describe('press classify', () => {
  it('detects PR Newswire-style releases', () => {
    const r = classifyPressHeuristic({
      title: 'Acme Announces Record Quarterly Earnings',
      url: 'https://www.prnewswire.com/news-releases/acme-123.html',
    });
    expect(r.isPress).toBe(true);
    expect(r.eventType).toBe('earnings');
  });
});

describe('ridge train', () => {
  it('fits ridge and versions next model', () => {
    const { coef, intercept } = fitRidge(
      [
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
      ],
      [1.1, 2.0, 2.9, 4.1],
      0.01
    );
    expect(coef.length).toBe(2);
    expect(Number.isFinite(intercept)).toBe(true);
    expect(nextModelVersion('swing-baseline-v1')).toBe('swing-baseline-v2');
  });

  it('runs synthetic strategy test + attribution + train gate', async () => {
    const barsBySymbol = new Map([
      ['AAPL', synthesizeBars(180, 200, 1)],
      ['MSFT', synthesizeBars(320, 200, 2)],
      ['JPM', synthesizeBars(140, 200, 3)],
    ]);
    // Inject SPY
    barsBySymbol.set('SPY', synthesizeBars(400, 200, 4));
    const endDate = new Date(barsBySymbol.get('AAPL')!.at(-1)!.t).toISOString().slice(0, 10);

    const weights = createSwingBaselineV1();
    const result = await runStrategyTest({
      weights,
      symbolLimit: 3,
      windowDays: 40,
      endDate,
      barsBySymbol,
      liveMedia: false,
    });
    expect(result.rows.length).toBeGreaterThan(20);
    expect(result.summary.byHorizon.D1.n).toBeGreaterThan(0);

    const attr = computeFactorAttribution({
      rows: result.rows,
      weights,
      evalRunId: 'test-eval',
    });
    expect(attr.factors.length).toBeGreaterThan(5);
    expect(attr.channelSummary.price).toBeDefined();
    expect(attr.channelSummary.news).toBeDefined();
    expect(attr.channelSummary.social).toBeDefined();
    expect(attr.channelSummary.press).toBeDefined();
    expect(attr.channelSummary.insider).toBeDefined();

    const trained = trainFromRows({
      rows: result.trainRows,
      parent: weights,
      holdoutAsOfs: new Set(result.holdoutAsOfs),
      nextVersion: 'swing-baseline-v2',
    });
    expect(trained.candidate.version).toBe('swing-baseline-v2');
    expect(trained.holdoutMetrics.D1).toBeDefined();
  });
});
