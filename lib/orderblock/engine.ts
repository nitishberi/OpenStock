/**
 * Clean-room order-block + strength scoring from daily OHLCV.
 *
 * Strength (disclosed pattern from OrderBlock about page, rebuilt):
 *   one-directional move from the session open ÷ normal daily range (ATR%).
 * Choppy two-way days score ~0.
 *
 * Order block (public ICT definition):
 *   bullish = last bearish candle before a bullish impulse that breaks structure;
 *   bearish = last bullish candle before a bearish impulse.
 */

import type { OhlcvBar } from '@/lib/pricing';
import type { OrderBlockSide, OrderBlockZones } from './types';

export function trueRange(prevClose: number, bar: OhlcvBar): number {
  return Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
}

export function atr(bars: OhlcvBar[], period = 20): number {
  if (bars.length < 2) return 0;
  const start = Math.max(1, bars.length - period);
  let sum = 0;
  let n = 0;
  for (let i = start; i < bars.length; i++) {
    sum += trueRange(bars[i - 1].c, bars[i]);
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * One-directional strength for the latest bar.
 * Retrace fraction of the open→extreme move kills the score (choppy filter).
 */
export function sessionStrength(bars: OhlcvBar[]): number {
  if (bars.length < 25) return 0;
  const bar = bars[bars.length - 1];
  const range = atr(bars, 20);
  if (range <= 0 || !Number.isFinite(bar.o) || bar.o <= 0) return 0;

  const upMove = Math.max(0, bar.h - bar.o);
  const downMove = Math.max(0, bar.o - bar.l);
  const closeFromOpen = bar.c - bar.o;

  // Prefer the dominant excursion; penalize if close gave most of it back.
  if (upMove >= downMove && upMove > 0) {
    const retained = Math.max(0, closeFromOpen) / upMove;
    if (retained < 0.35) return 0;
    return (closeFromOpen / range) * retained;
  }
  if (downMove > 0) {
    const retained = Math.max(0, -closeFromOpen) / downMove;
    if (retained < 0.35) return 0;
    return (closeFromOpen / range) * retained;
  }
  return 0;
}

function isBearishCandle(b: OhlcvBar): boolean {
  return b.c < b.o;
}
function isBullishCandle(b: OhlcvBar): boolean {
  return b.c > b.o;
}

/** Find last opposite candle before a structure-breaking impulse in `bars`. */
export function detectOrderBlock(bars: OhlcvBar[], side: OrderBlockSide): OrderBlockZones | null {
  if (bars.length < 8) return null;
  const end = bars.length - 1;
  // Search recent window for impulse + prior opposite candle
  for (let i = end; i >= Math.max(3, end - 40); i--) {
    const impulse = bars[i];
    const prev = bars[i - 1];
    if (side === 'bullish') {
      if (!isBullishCandle(impulse)) continue;
      // Impulse closes above prior high (structure break)
      if (impulse.c <= prev.h) continue;
      // Walk back for last bearish candle
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        if (!isBearishCandle(bars[j])) continue;
        const ob = bars[j];
        const swingLow = minLow(bars, Math.max(0, j - 8), j);
        const swingHigh = maxHigh(bars, j, Math.min(end, i + 2));
        return {
          orderBlockLow: roundPx(ob.l),
          orderBlockHigh: roundPx(ob.h),
          zoneZ: roundPx((ob.l + ob.h) / 2),
          invalidation: roundPx(ob.l), // S1
          liquidity: roundPx(swingLow),
          support: roundPx(Math.min(ob.l, swingLow)),
          resistance: roundPx(Math.max(ob.h, swingHigh)),
        };
      }
    } else {
      if (!isBearishCandle(impulse)) continue;
      if (impulse.c >= prev.l) continue;
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        if (!isBullishCandle(bars[j])) continue;
        const ob = bars[j];
        const swingHigh = maxHigh(bars, Math.max(0, j - 8), j);
        const swingLow = minLow(bars, j, Math.min(end, i + 2));
        return {
          orderBlockLow: roundPx(ob.l),
          orderBlockHigh: roundPx(ob.h),
          zoneZ: roundPx((ob.l + ob.h) / 2),
          invalidation: roundPx(ob.h), // R1
          liquidity: roundPx(swingHigh),
          support: roundPx(Math.min(ob.l, swingLow)),
          resistance: roundPx(Math.max(ob.h, swingHigh)),
        };
      }
    }
  }
  return null;
}

function minLow(bars: OhlcvBar[], from: number, to: number): number {
  let m = bars[from].l;
  for (let i = from; i <= to; i++) m = Math.min(m, bars[i].l);
  return m;
}

function maxHigh(bars: OhlcvBar[], from: number, to: number): number {
  let m = bars[from].h;
  for (let i = from; i <= to; i++) m = Math.max(m, bars[i].h);
  return m;
}

function roundPx(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n >= 100) return Math.round(n * 100) / 100;
  if (n >= 10) return Math.round(n * 1000) / 1000;
  return Math.round(n * 10000) / 10000;
}

export function pctChangeFromOpen(bar: OhlcvBar): number {
  if (!bar.o) return 0;
  return ((bar.c - bar.o) / bar.o) * 100;
}
