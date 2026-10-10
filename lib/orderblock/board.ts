import type { OhlcvBar } from '@/lib/pricing';
import { barDateString } from '@/lib/forecast/calendar';
import { getForecastUniverse, getSectorMap } from '@/lib/forecast/universe';
import { fetchUniverseDailyBars } from '@/lib/forecast/bars';
import { detectOrderBlock, pctChangeFromOpen, sessionStrength } from './engine';
import type { OrderBlockBoard, OrderBlockRow, OrderBlockSide, SectorFlow } from './types';

const DISCLAIMER =
  'Order Blocks is a clean-room analytics view for research. It is not investment advice and does not place trades. Zones are inferred from daily OHLC, not a copy of any third-party product.';

const boardCache = new Map<string, { board: OrderBlockBoard; until: number }>();
const BOARD_TTL_MS = 15 * 60 * 1000;

export function clearOrderBlockBoardCache() {
  boardCache.clear();
}

function pickRows(rows: OrderBlockRow[], side: OrderBlockSide): OrderBlockRow[] {
  const sectorCount = new Map<string, number>();
  let picks = 0;
  return rows.map((r, idx) => {
    const rank = idx + 1;
    let isPick = false;
    let ruleNote = `${side} rank #${rank}`;
    if (picks < 3) {
      const used = sectorCount.get(r.sector) || 0;
      if (used < 2) {
        isPick = true;
        picks++;
        sectorCount.set(r.sector, used + 1);
        ruleNote = `Pick: top strength, sector cap ok (${r.sector})`;
      } else {
        ruleNote = `Not a pick: sector cap (${r.sector} already has 2)`;
      }
    }
    return { ...r, rank, isPick, ruleNote };
  });
}

export function scoreSymbol(
  symbol: string,
  bars: OhlcvBar[],
  sector: string
): Omit<OrderBlockRow, 'rank' | 'isPick' | 'ruleNote'> | null {
  if (bars.length < 25) return null;
  const strength = sessionStrength(bars);
  if (Math.abs(strength) < 0.15) return null; // choppy / flat
  const last = bars[bars.length - 1];
  const side: OrderBlockSide = strength >= 0 ? 'bullish' : 'bearish';
  return {
    symbol,
    sector,
    side,
    strength,
    pctChange: pctChangeFromOpen(last),
    last: last.c,
    zones: detectOrderBlock(bars, side),
  };
}

export function buildBoardFromBars(
  barMap: Map<string, OhlcvBar[]>,
  opts?: { asOf?: string; limitPerSide?: number }
): OrderBlockBoard {
  const sectorMap = getSectorMap();
  const limit = opts?.limitPerSide ?? 20;
  const scored: OrderBlockRow[] = [];

  for (const [symbol, bars] of barMap) {
    const row = scoreSymbol(symbol, bars, sectorMap.get(symbol) || 'Unknown');
    if (!row) continue;
    scored.push({
      ...row,
      rank: 0,
      isPick: false,
      ruleNote: '',
    });
  }

  const bullishRaw = scored
    .filter((r) => r.side === 'bullish')
    .sort((a, b) => b.strength - a.strength);
  const bearishRaw = scored
    .filter((r) => r.side === 'bearish')
    .sort((a, b) => a.strength - b.strength); // most negative first

  const bullish = pickRows(bullishRaw.slice(0, limit), 'bullish');
  const bearish = pickRows(bearishRaw.slice(0, limit), 'bearish');

  const sectorAgg = new Map<string, { sum: number; count: number }>();
  for (const r of scored) {
    const cur = sectorAgg.get(r.sector) || { sum: 0, count: 0 };
    cur.sum += r.strength;
    cur.count += 1;
    sectorAgg.set(r.sector, cur);
  }
  const sectors: SectorFlow[] = [...sectorAgg.entries()]
    .map(([sector, v]) => ({
      sector,
      avgStrength: v.sum / v.count,
      count: v.count,
    }))
    .sort((a, b) => b.avgStrength - a.avgStrength);

  let asOf = opts?.asOf;
  if (!asOf) {
    for (const bars of barMap.values()) {
      if (bars.length) {
        asOf = barDateString(bars[bars.length - 1].t);
        break;
      }
    }
  }

  return {
    asOf: asOf || new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    universeSize: barMap.size,
    scored: scored.length,
    bullishCount: bullishRaw.length,
    bearishCount: bearishRaw.length,
    leadSector: sectors[0]?.sector ?? null,
    lagSector: sectors.length ? sectors[sectors.length - 1].sector : null,
    bullish,
    bearish,
    sectors,
    disclaimer: DISCLAIMER,
  };
}

export async function getOrderBlockBoard(opts?: {
  limitSymbols?: number;
  delayMs?: number;
  force?: boolean;
}): Promise<OrderBlockBoard> {
  const universe = getForecastUniverse();
  const symbols = universe.symbols
    .map((s) => s.symbol)
    .slice(0, opts?.limitSymbols ?? 100);
  const cacheKey = `board:${symbols.length}`;
  if (!opts?.force) {
    const hit = boardCache.get(cacheKey);
    if (hit && hit.until > Date.now()) return hit.board;
  }

  const barMap = await fetchUniverseDailyBars(symbols, {
    delayMs: opts?.delayMs ?? 120,
  });
  const board = buildBoardFromBars(barMap);
  boardCache.set(cacheKey, { board, until: Date.now() + BOARD_TTL_MS });
  return board;
}
