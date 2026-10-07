import { describe, expect, it } from 'vitest';
import {
  assembleFeatureSnapshot,
  computeFactorAttribution,
  createSwingBaselineV1,
  emptyInsiderFeatures,
  featuresFromInsiderFilings,
  forecastHorizons,
  formatInsiderEvidenceLine,
  insiderRawEventTilt,
  predictLogReturn,
  runStrategyTest,
  synthesizeBars,
  type InsiderFilingLike,
} from '@/lib/forecast';

function sampleFilings(): InsiderFilingLike[] {
  return [
    {
      filingDate: '2024-04-12',
      tradeDate: '2024-04-11',
      ticker: 'AAPL',
      insiderName: 'Cook Timothy D',
      title: 'CEO',
      tradeType: 'P',
      valueUsd: 250_000,
      flags: { ceoCfo: true, cluster: false },
      sourceUrl: 'http://www.openinsider.com/AAPL',
      sourceList: 'purchases-25k',
    },
    {
      filingDate: '2024-04-13',
      tradeDate: '2024-04-12',
      ticker: 'AAPL',
      insiderName: 'Maestri Luca',
      title: 'CFO',
      tradeType: 'P',
      valueUsd: 180_000,
      flags: { ceoCfo: true, cluster: true },
      insCount: 3,
      sourceUrl: 'http://www.openinsider.com/AAPL',
      sourceList: 'cluster-buys',
    },
    {
      filingDate: '2024-03-20',
      tradeDate: '2024-03-19',
      ticker: 'AAPL',
      insiderName: 'Someone',
      title: 'Officer',
      tradeType: 'S',
      valueUsd: 50_000,
      sourceList: 'ticker',
    },
  ];
}

describe('insider features', () => {
  it('builds non-zero FeatureSnapshot insider fields from filings', () => {
    const feats = featuresFromInsiderFilings(sampleFilings(), '2024-04-15');
    expect(feats.insiderBuyCount7d).toBe(2);
    expect(feats.insiderBuyValue7d).toBeGreaterThan(0);
    expect(feats.insiderClusterBuy).toBeGreaterThanOrEqual(2);
    expect(feats.insiderCeoCfoBuy).toBe(1);
    expect(feats.insiderNetValue30d).toBeGreaterThan(0);
    expect(feats.daysSinceLastInsiderBuy).toBeLessThan(30);

    const bars = synthesizeBars(100, 80, 2);
    const { features } = assembleFeatureSnapshot({
      symbol: 'AAPL',
      asOf: '2024-04-15',
      sector: 'Technology',
      bars,
      insider: feats,
    });
    expect(features.insiderBuyCount7d).toBe(2);
    expect(features.insiderCeoCfoBuy).toBe(1);
  });

  it('returns empty defaults when no filings', () => {
    expect(featuresFromInsiderFilings([], '2024-04-15')).toEqual(emptyInsiderFeatures());
  });

  it('formats evidence line for cluster buys', () => {
    const line = formatInsiderEvidenceLine(sampleFilings(), '2024-04-15');
    expect(line).toMatch(/Cluster buy/i);
    expect(line).toMatch(/\$/);
  });

  it('applies capped positive event tilt for material CEO/cluster buys', () => {
    const bars = synthesizeBars(100, 80, 2);
    const insider = featuresFromInsiderFilings(sampleFilings(), '2024-04-15');
    const { features, lastClose } = assembleFeatureSnapshot({
      symbol: 'AAPL',
      asOf: '2024-04-15',
      sector: 'Technology',
      bars,
      insider,
    });
    const weights = createSwingBaselineV1();
    const withInsider = predictLogReturn(features, weights, 'D1');
    const zeroed = predictLogReturn(
      { ...features, ...emptyInsiderFeatures() },
      weights,
      'D1'
    );
    expect(insiderRawEventTilt(insider, { multiplier: weights.insiderTiltMultiplier })).toBeGreaterThan(
      0
    );
    expect(withInsider.eventTilt).toBeGreaterThanOrEqual(zeroed.eventTilt);
    expect(Math.abs(withInsider.eventTilt)).toBeLessThanOrEqual(weights.eventTiltCap + 1e-9);

    const preds = forecastHorizons({ features, lastClose, weights });
    expect(preds[0].yHat).toBeGreaterThan(0);
  });
});

describe('insider attribution channel', () => {
  it('reports insider channelSummary when filings injected', async () => {
    const barsBySymbol = new Map([
      ['AAPL', synthesizeBars(180, 200, 1)],
      ['MSFT', synthesizeBars(320, 200, 2)],
      ['JPM', synthesizeBars(140, 200, 3)],
      ['SPY', synthesizeBars(400, 200, 4)],
    ]);
    const endDate = new Date(barsBySymbol.get('AAPL')!.at(-1)!.t).toISOString().slice(0, 10);
    // Filing must fall inside walk-forward asOfs (window ends ~5 trading days before endDate).
    const filingAsOf = new Date(`${endDate}T00:00:00.000Z`);
    filingAsOf.setUTCDate(filingAsOf.getUTCDate() - 12);
    const filingDate = filingAsOf.toISOString().slice(0, 10);
    const insiderBySymbol = new Map<string, InsiderFilingLike[]>([
      [
        'AAPL',
        [
          {
            filingDate,
            tradeDate: filingDate,
            ticker: 'AAPL',
            insiderName: 'CLUSTER:3',
            tradeType: 'P',
            valueUsd: 2_000_000,
            flags: { cluster: true },
            insCount: 3,
            sourceList: 'cluster-buys',
            sourceUrl: 'http://www.openinsider.com/AAPL',
          },
        ],
      ],
    ]);

    const weights = createSwingBaselineV1();
    const result = await runStrategyTest({
      weights,
      symbolLimit: 3,
      windowDays: 40,
      endDate,
      barsBySymbol,
      liveMedia: false,
      insiderBySymbol,
    });
    const attr = computeFactorAttribution({
      rows: result.rows,
      weights,
      evalRunId: 'insider-eval',
    });
    expect(attr.channelSummary.insider).toBeDefined();
    expect(typeof attr.channelSummary.insider.mapeDelta).toBe('number');
    const aaplRows = result.rows.filter((r) => r.symbol === 'AAPL');
    expect(aaplRows.some((r) => r.features.insiderClusterBuy >= 2)).toBe(true);
  });
});
