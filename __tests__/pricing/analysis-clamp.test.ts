import { describe, expect, it } from 'vitest';
import { clampProposalToPricing, parseAnalysisDraft } from '@/lib/analysis/decision';
import type { PricingSnapshotResult } from '@/lib/pricing';

const pricing: PricingSnapshotResult = {
  symbol: 'MSFT',
  asOf: new Date(),
  last: 400,
  fairValueBand: { low: 395, mid: 400, high: 405 },
  entryZone: { low: 399, mid: 400.5, high: 402 },
  stop: 396,
  targets: { t1: 406, t2: 410 },
  expectedMove: 4,
  spreadCost: 0.04,
  maxSlippageBps: 8,
  confidence: 0.7,
  regime: 'trend_breakout',
  atr14: 5,
  notes: [],
  sideHint: 'buy',
};

describe('analysis clamp', () => {
  it('parses JSON draft', () => {
    const draft = parseAnalysisDraft(
      JSON.stringify({
        action: 'buy',
        score: 72,
        trend: 'up',
        summary: 'ok',
        catalysts: ['c1'],
        risks: ['r1'],
        checklist: ['check'],
        bias: 'bullish',
        confidence: 0.8,
        evidenceUrls: [],
        strategyLenses: ['trend'],
        proposedEntry: 400.2,
        proposedStop: 396,
        proposedTarget: 407,
        rationale: 'band ok',
      })
    );
    expect(draft.action).toBe('buy');
    expect(draft.score).toBe(72);
  });

  it('clamps hallucinated entry into entryZone', () => {
    const draft = parseAnalysisDraft(
      JSON.stringify({
        action: 'buy',
        score: 80,
        trend: 'up',
        summary: 'x',
        catalysts: [],
        risks: [],
        checklist: [],
        bias: 'bullish',
        confidence: 0.9,
        evidenceUrls: [],
        strategyLenses: ['trend'],
        proposedEntry: 450,
        proposedStop: 390,
        proposedTarget: 500,
        rationale: 'hallucinated',
      })
    );
    const clamped = clampProposalToPricing(draft, pricing);
    expect(clamped.entry).toBeLessThanOrEqual(pricing.entryZone.high);
    expect(clamped.entry).toBeGreaterThanOrEqual(pricing.entryZone.low);
    expect(clamped.stop).toBeLessThan(clamped.entry);
  });
});
