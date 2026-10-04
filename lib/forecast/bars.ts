/**
 * Daily bar cache helpers for the 100-stock universe.
 * Prefer Finnhub candles; fall back to Alpaca market data, then Yahoo chart API
 * (free Finnhub keys often 403 `/stock/candle`).
 */

import type { OhlcvBar } from '@/lib/pricing';
import { barDateString } from './calendar';

const FINNHUB_BASE = (process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1').replace(/\/$/, '');
const KEYS = (process.env.FINNHUB_API_KEYS || process.env.NEXT_PUBLIC_FINNHUB_API_KEY || process.env.FINNHUB_API_KEY || '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

let keyIdx = 0;
const barCache = new Map<string, { bars: OhlcvBar[]; until: number }>();
const BAR_TTL_MS = 6 * 60 * 60 * 1000;

function nextKey(): string {
  if (!KEYS.length) throw new Error('No Finnhub API key configured');
  return KEYS[keyIdx++ % KEYS.length];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFinnhubDaily(sym: string, from: number, to: number): Promise<OhlcvBar[] | null> {
  if (!KEYS.length) return null;
  const fhSym = sym.replace('.', '-');
  const url = `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(fhSym)}&resolution=D&from=${from}&to=${to}`;
  for (let attempt = 0; attempt < Math.max(1, KEYS.length); attempt++) {
    const key = nextKey();
    const res = await fetch(url, {
      headers: { 'X-Finnhub-Token': key },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    if (res.status === 429) {
      await sleep(1100);
      continue;
    }
    if (res.status === 403 || res.status === 401) return null;
    if (!res.ok) throw new Error(`Finnhub candle ${res.status}`);
    const data = (await res.json()) as {
      s?: string;
      c?: number[];
      h?: number[];
      l?: number[];
      o?: number[];
      v?: number[];
      t?: number[];
    };
    if (data.s !== 'ok' || !data.t?.length) return [];
    return data.t.map((t, i) => ({
      t: t * 1000,
      o: data.o![i],
      h: data.h![i],
      l: data.l![i],
      c: data.c![i],
      v: data.v?.[i] ?? 0,
    }));
  }
  return null;
}

async function fetchAlpacaDaily(sym: string, from: number, to: number): Promise<OhlcvBar[] | null> {
  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!key || !secret) return null;
  const alpacaSym = sym.replace('.', '/');
  const start = new Date(from * 1000).toISOString().slice(0, 10);
  const end = new Date(to * 1000).toISOString().slice(0, 10);
  const base = (process.env.ALPACA_DATA_BASE_URL || 'https://data.alpaca.markets').replace(/\/$/, '');
  const url = `${base}/v2/stocks/${encodeURIComponent(alpacaSym)}/bars?timeframe=1Day&start=${start}&end=${end}&adjustment=split&feed=${process.env.ALPACA_DATA_FEED || 'iex'}&limit=10000`;
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
    },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { bars?: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> };
  return (data.bars || []).map((b) => ({
    t: new Date(b.t).getTime(),
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    v: b.v,
  }));
}

/** Public Yahoo chart API — research fallback only (no auth). */
async function fetchYahooDaily(sym: string, from: number, to: number): Promise<OhlcvBar[] | null> {
  const yahooSym = sym.replace('.', '-');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?period1=${from}&period2=${to}&interval=1d&events=div%7Csplit`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'OpenStockForecast/0.3' },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }> };
      }>;
    };
  };
  const result = data.chart?.result?.[0];
  const ts = result?.timestamp;
  const q = result?.indicators?.quote?.[0];
  if (!ts?.length || !q?.close) return [];
  const bars: OhlcvBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close[i];
    if (c == null) continue;
    bars.push({
      t: ts[i] * 1000,
      o: q.open?.[i] ?? c,
      h: q.high?.[i] ?? c,
      l: q.low?.[i] ?? c,
      c,
      v: q.volume?.[i] ?? 0,
    });
  }
  return bars;
}

export async function fetchDailyBars(
  symbol: string,
  opts?: { fromUnix?: number; toUnix?: number; minBars?: number }
): Promise<OhlcvBar[]> {
  const sym = symbol.toUpperCase();
  const to = opts?.toUnix ?? Math.floor(Date.now() / 1000);
  const from = opts?.fromUnix ?? to - 400 * 86400;
  const cacheKey = `${sym}:${from}:${to}`;
  const hit = barCache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.bars;

  let lastErr: unknown;
  try {
    const fh = await fetchFinnhubDaily(sym, from, to);
    if (fh && fh.length) {
      barCache.set(cacheKey, { bars: fh, until: Date.now() + BAR_TTL_MS });
      return fh;
    }
  } catch (e) {
    lastErr = e;
  }

  try {
    const alpaca = await fetchAlpacaDaily(sym, from, to);
    if (alpaca && alpaca.length) {
      barCache.set(cacheKey, { bars: alpaca, until: Date.now() + BAR_TTL_MS });
      return alpaca;
    }
  } catch (e) {
    lastErr = e;
  }

  try {
    const yahoo = await fetchYahooDaily(sym, from, to);
    if (yahoo && yahoo.length) {
      barCache.set(cacheKey, { bars: yahoo, until: Date.now() + BAR_TTL_MS });
      return yahoo;
    }
  } catch (e) {
    lastErr = e;
  }

  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  barCache.set(cacheKey, { bars: [], until: Date.now() + 60_000 });
  return [];
}

/** Bars with t ≤ asOf end-of-day (no lookahead). */
export function barsOnOrBefore(bars: OhlcvBar[], asOfIso: string): OhlcvBar[] {
  return bars.filter((b) => barDateString(b.t) <= asOfIso).sort((a, b) => a.t - b.t);
}

export function closeOnDate(bars: OhlcvBar[], iso: string): number | undefined {
  const bar = bars.find((b) => barDateString(b.t) === iso);
  return bar?.c;
}

/** Batch fetch with spacing to respect free-tier rate limits. */
export async function fetchUniverseDailyBars(
  symbols: string[],
  opts?: { delayMs?: number; fromUnix?: number; toUnix?: number }
): Promise<Map<string, OhlcvBar[]>> {
  const delay = opts?.delayMs ?? 350;
  const out = new Map<string, OhlcvBar[]>();
  for (const symbol of symbols) {
    try {
      const bars = await fetchDailyBars(symbol, opts);
      out.set(symbol.toUpperCase(), bars);
    } catch (e) {
      console.warn(`daily bars failed for ${symbol}`, e);
      out.set(symbol.toUpperCase(), []);
    }
    if (delay > 0) await sleep(delay);
  }
  return out;
}

export function clearBarCache() {
  barCache.clear();
}
