import { describe, expect, it } from 'vitest';
import {
  buildPricingSnapshot,
  computeAtr,
  computeVwap,
  computeOpeningRange,
  clampToBand,
  sanitizeStop,
  type OhlcvBar,
} from '@/lib/pricing/engine';

const bar = (t: number, o: number, h: number, l: number, c: number, v: number): OhlcvBar => ({
  t, o, h, l, c, v,
});

describe('pricing engine', () => {
  it('computes VWAP', () => {
    const vwap = computeVwap([
      bar(1, 10, 11, 9, 10.5, 100),
      bar(2, 10.5, 11.5, 10, 11, 100),
    ]);
    expect(vwap).toBeCloseTo(10.5, 5);
  });

  it('computes ATR when enough bars', () => {
    const bars: OhlcvBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push(bar(i, 100 + i * 0.1, 101 + i * 0.1, 99 + i * 0.1, 100.5 + i * 0.1, 1000));
    }
    const atr = computeAtr(bars, 14);
    expect(atr).toBeGreaterThan(0);
  });

  it('opening range uses first 15 1m bars', () => {
    const bars = Array.from({ length: 20 }, (_, i) =>
      bar(i, 100, 100 + i, 100 - i, 100, 10)
    );
    const or = computeOpeningRange(bars, 15);
    expect(or?.high).toBe(100 + 14);
    expect(or?.low).toBe(100 - 14);
  });

  it('builds snapshot with deterministic bands', () => {
    const daily: OhlcvBar[] = [];
    for (let i = 0; i < 25; i++) {
      daily.push(bar(i * 86400000, 100, 102, 98, 100 + (i % 3) * 0.2, 1_000_000 + i * 1000));
    }
    const bars1m = Array.from({ length: 30 }, (_, i) =>
      bar(i * 60_000, 100.2, 100.5, 100.0, 100.3, 5000)
    );

    const snap = buildPricingSnapshot({
      symbol: 'aapl',
      quote: { last: 100.4, bid: 100.35, ask: 100.45, prevClose: 99.8, volume: 2_000_000 },
      barsDaily: daily,
      bars1m,
      relative: { stockChangePct: 0.6, spyChangePct: 0.2, beta: 1.1 },
      event: { hasCatalyst: true, eventPremiumMultiplier: 1.2 },
    });

    expect(snap.symbol).toBe('AAPL');
    expect(snap.entryZone.low).toBeLessThanOrEqual(snap.entryZone.mid);
    expect(snap.entryZone.mid).toBeLessThanOrEqual(snap.entryZone.high);
    expect(snap.stop).toBeGreaterThan(0);
    expect(snap.targets.t1).toBeGreaterThan(0);
    expect(snap.confidence).toBeGreaterThan(0);
    expect(snap.expectedMove).toBeGreaterThan(0);
    expect(snap.eventPremium).toBeCloseTo(0.2, 5);
  });

  it('clamps prices into band and sanitizes stops', () => {
    expect(clampToBand(50, { low: 40, mid: 45, high: 48 })).toBe(48);
    expect(sanitizeStop('buy', 100, 105, 2)).toBeLessThan(100);
    expect(sanitizeStop('sell', 100, 95, 2)).toBeGreaterThan(100);
  });

  it('does not invent last price — throws on invalid', () => {
    expect(() =>
      buildPricingSnapshot({ symbol: 'X', quote: { last: 0 } })
    ).toThrow();
  });
});
