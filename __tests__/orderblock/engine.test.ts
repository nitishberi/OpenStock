import { describe, expect, it } from 'vitest';
import type { OhlcvBar } from '@/lib/pricing';
import { atr, detectOrderBlock, sessionStrength } from '@/lib/orderblock/engine';
import { buildBoardFromBars } from '@/lib/orderblock/board';

function bar(t: number, o: number, h: number, l: number, c: number, v = 1e6): OhlcvBar {
  return { t, o, h, l, c, v };
}

/** ~28 quiet bars, bearish OB, bullish impulse that retains the move. */
function bullishSetup(): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  let t = Date.UTC(2026, 8, 1);
  let px = 100;
  for (let i = 0; i < 28; i++) {
    bars.push(bar(t, px, px + 1.2, px - 1.2, px + 0.15, 2e6));
    px += 0.05;
    t += 86400_000;
  }
  bars.push(bar(t, 103, 103.4, 101.2, 101.5, 3e6)); // bearish OB
  t += 86400_000;
  bars.push(bar(t, 101.8, 107, 101.6, 106.2, 5e6)); // bullish impulse
  return bars;
}

/** Quiet bars then bullish candle and strong bearish impulse. */
function bearishSetup(): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  let t = Date.UTC(2026, 8, 1);
  let px = 100;
  for (let i = 0; i < 28; i++) {
    bars.push(bar(t, px, px + 1.2, px - 1.2, px - 0.1, 2e6));
    px -= 0.05;
    t += 86400_000;
  }
  bars.push(bar(t, 98, 99.5, 97.8, 99.2, 3e6)); // bullish OB
  t += 86400_000;
  bars.push(bar(t, 99, 99.2, 93.5, 94.0, 5e6)); // bearish impulse
  return bars;
}

describe('orderblock engine', () => {
  it('computes positive ATR', () => {
    expect(atr(bullishSetup(), 20)).toBeGreaterThan(0);
  });

  it('scores bullish one-directional sessions', () => {
    expect(sessionStrength(bullishSetup())).toBeGreaterThan(0.15);
  });

  it('scores bearish one-directional sessions', () => {
    expect(sessionStrength(bearishSetup())).toBeLessThan(-0.15);
  });

  it('detects bullish and bearish order blocks', () => {
    const bull = detectOrderBlock(bullishSetup(), 'bullish');
    const bear = detectOrderBlock(bearishSetup(), 'bearish');
    expect(bull).not.toBeNull();
    expect(bear).not.toBeNull();
    expect(bull!.orderBlockLow).toBeLessThan(bull!.orderBlockHigh);
    expect(bear!.invalidation).toBe(bear!.orderBlockHigh);
  });

  it('builds a board with picks and breadth', () => {
    const map = new Map<string, OhlcvBar[]>([
      ['AAA', bullishSetup()],
      ['BBB', bearishSetup()],
    ]);
    const board = buildBoardFromBars(map, { asOf: '2026-10-01' });
    expect(board.bullishCount + board.bearishCount).toBeGreaterThanOrEqual(1);
    expect(board.disclaimer).toMatch(/clean-room/i);
    const picks = [...board.bullish, ...board.bearish].filter((r) => r.isPick);
    expect(picks.length).toBeGreaterThanOrEqual(1);
  });
});
