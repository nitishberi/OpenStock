/**
 * Deterministic PricingEngine.
 * Gemini must explain / refine within these bands — never invent fill prices from text alone.
 */

export type PricingRegime = 'trend_breakout' | 'mean_reversion' | 'neutral';

export interface OhlcvBar {
  t: number; // unix ms or seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface QuoteSnapshot {
  last: number;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  quoteTs?: number;
  dayHigh?: number;
  dayLow?: number;
  prevClose?: number;
  volume?: number;
}

export interface RelativeContext {
  spyChangePct?: number;
  stockChangePct?: number;
  sectorEtfChangePct?: number;
  beta?: number;
}

export interface EventContext {
  hasCatalyst?: boolean;
  eventPremiumMultiplier?: number; // e.g. 1.0–1.5 from Adanos/Polymarket
  headlineCount?: number;
}

export interface PricingEngineInput {
  symbol: string;
  quote: QuoteSnapshot;
  bars1m?: OhlcvBar[];
  bars5m?: OhlcvBar[];
  barsDaily?: OhlcvBar[];
  relative?: RelativeContext;
  event?: EventContext;
  asOf?: Date;
  spreadBlockThresholdBps?: number;
}

export interface PriceBand {
  low: number;
  mid: number;
  high: number;
}

export interface PricingSnapshotResult {
  symbol: string;
  asOf: Date;
  last: number;
  mid?: number;
  fairValueBand: PriceBand;
  entryZone: PriceBand;
  stop: number;
  targets: { t1: number; t2: number };
  expectedMove: number;
  spreadCost: number;
  maxSlippageBps: number;
  confidence: number;
  regime: PricingRegime;
  atr14?: number;
  vwap?: number;
  openingRange?: { high: number; low: number };
  relativeStrength?: { vsSpy: number; vsSector?: number };
  microstructure?: {
    spreadBps?: number;
    quoteAgeMs?: number;
    relativeVolume?: number;
    blockMarketOrders?: boolean;
  };
  eventPremium?: number;
  notes: string[];
  sideHint: 'buy' | 'sell' | 'flat';
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function trueRange(h: number, l: number, prevClose: number): number {
  return Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
}

/** Wilder ATR(14) from daily (or higher TF) bars. */
export function computeAtr(bars: OhlcvBar[], period = 14): number | undefined {
  if (bars.length < period + 1) return undefined;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const trs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    trs.push(trueRange(sorted[i].h, sorted[i].l, sorted[i - 1].c));
  }
  if (trs.length < period) return undefined;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/** Session VWAP from intraday bars. */
export function computeVwap(bars: OhlcvBar[]): number | undefined {
  if (!bars.length) return undefined;
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
  }
  if (vol <= 0) return undefined;
  return pv / vol;
}

/** First N minutes opening range (default 15 bars of 1m). */
export function computeOpeningRange(
  bars1m: OhlcvBar[],
  minutes = 15
): { high: number; low: number } | undefined {
  if (!bars1m.length) return undefined;
  const sorted = [...bars1m].sort((a, b) => a.t - b.t).slice(0, minutes);
  if (!sorted.length) return undefined;
  return {
    high: Math.max(...sorted.map((b) => b.h)),
    low: Math.min(...sorted.map((b) => b.l)),
  };
}

export function computeEma(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function detectRegime(
  last: number,
  vwap: number | undefined,
  openingRange: { high: number; low: number } | undefined,
  closes: number[]
): PricingRegime {
  const ema9 = computeEma(closes, 9);
  const ema21 = computeEma(closes, 21);
  const trendUp = ema9 !== undefined && ema21 !== undefined && ema9 > ema21 && last > (vwap ?? last);
  const trendDown = ema9 !== undefined && ema21 !== undefined && ema9 < ema21 && last < (vwap ?? last);
  const aboveOrh = openingRange && last > openingRange.high;
  const belowOrl = openingRange && last < openingRange.low;

  if ((trendUp && aboveOrh) || (trendDown && belowOrl)) return 'trend_breakout';
  if (vwap !== undefined) {
    const dist = Math.abs(last - vwap) / vwap;
    if (dist > 0.008) return 'mean_reversion';
  }
  return 'neutral';
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Build a PricingSnapshot from bars/quotes/events.
 * All entry/stop/target math is deterministic.
 */
export function buildPricingSnapshot(input: PricingEngineInput): PricingSnapshotResult {
  const notes: string[] = [];
  const asOf = input.asOf ?? new Date();
  const symbol = input.symbol.toUpperCase();
  const { quote } = input;
  const last = quote.last;
  if (!last || last <= 0) {
    throw new Error(`Invalid last price for ${symbol}`);
  }

  const mid =
    quote.bid && quote.ask && quote.ask >= quote.bid
      ? (quote.bid + quote.ask) / 2
      : undefined;

  const spread =
    quote.bid && quote.ask && quote.ask >= quote.bid ? quote.ask - quote.bid : last * 0.0005;
  const spreadBps = (spread / last) * 10_000;
  const spreadBlockThreshold = input.spreadBlockThresholdBps ?? 25;
  const blockMarketOrders = spreadBps > spreadBlockThreshold;
  if (blockMarketOrders) notes.push(`Wide spread ${spreadBps.toFixed(1)} bps — prefer limits`);

  const quoteAgeMs =
    quote.quoteTs !== undefined
      ? Math.max(0, asOf.getTime() - (quote.quoteTs < 1e12 ? quote.quoteTs * 1000 : quote.quoteTs))
      : undefined;

  const atr14 =
    computeAtr(input.barsDaily ?? []) ??
    computeAtr(input.bars5m ?? [], 14) ??
    last * 0.015;
  if (!(input.barsDaily?.length || input.bars5m?.length)) {
    notes.push('ATR fallback: 1.5% of last (insufficient bars)');
  }

  const vwap = computeVwap(input.bars1m ?? input.bars5m ?? []);
  const openingRange = computeOpeningRange(input.bars1m ?? []);
  const closes = (input.bars5m ?? input.bars1m ?? input.barsDaily ?? []).map((b) => b.c);
  const regime = detectRegime(last, vwap, openingRange, closes);

  const eventMult = input.event?.eventPremiumMultiplier ?? (input.event?.hasCatalyst ? 1.25 : 1);
  const eventPremium = eventMult - 1;
  if (eventMult > 1) notes.push(`Event premium x${eventMult.toFixed(2)}`);

  const expectedMove = atr14 * 0.55 * eventMult;
  const spreadCost = spread * 2; // round-trip friction estimate

  // Relative value
  let vsSpy = 0;
  let vsSector: number | undefined;
  if (input.relative?.stockChangePct !== undefined && input.relative.spyChangePct !== undefined) {
    const beta = input.relative.beta ?? 1;
    vsSpy = input.relative.stockChangePct - beta * input.relative.spyChangePct;
  }
  if (
    input.relative?.stockChangePct !== undefined &&
    input.relative.sectorEtfChangePct !== undefined
  ) {
    vsSector = input.relative.stockChangePct - input.relative.sectorEtfChangePct;
  }

  // Prior day structure
  const daily = [...(input.barsDaily ?? [])].sort((a, b) => a.t - b.t);
  const prior = daily.length >= 2 ? daily[daily.length - 2] : undefined;

  // Volume relative to 20-day average
  let relativeVolume: number | undefined;
  if (daily.length >= 21 && quote.volume !== undefined) {
    const avgVol =
      daily.slice(-21, -1).reduce((s, b) => s + b.v, 0) / Math.min(20, daily.length - 1);
    if (avgVol > 0) relativeVolume = quote.volume / avgVol;
  }

  // Fair value band: VWAP ± 0.5 ATR soft band, nudged by relative strength
  const anchor = vwap ?? mid ?? last;
  const rsNudge = clamp(vsSpy / 100, -0.01, 0.01) * last;
  const fairMid = anchor + rsNudge;
  const fairHalf = atr14 * 0.35;
  const fairValueBand: PriceBand = {
    low: round2(fairMid - fairHalf),
    mid: round2(fairMid),
    high: round2(fairMid + fairHalf),
  };

  // Side hint + entry/stop/targets by regime
  let sideHint: 'buy' | 'sell' | 'flat' = 'flat';
  let entryZone: PriceBand;
  let stop: number;
  let t1: number;
  let t2: number;

  const orh = openingRange?.high;
  const orl = openingRange?.low;

  if (regime === 'trend_breakout') {
    if (orh && last >= orh * 0.998 && vsSpy >= -0.2) {
      sideHint = 'buy';
      const entryMid = Math.max(last, orh);
      entryZone = {
        low: round2(entryMid - spread),
        mid: round2(entryMid),
        high: round2(entryMid + atr14 * 0.15),
      };
      stop = round2(Math.min(orl ?? last - atr14 * 0.8, entryMid - atr14 * 0.7));
      t1 = round2(entryMid + atr14 * 0.9);
      t2 = round2(entryMid + atr14 * 1.6);
      notes.push('Breakout mode: entry above ORH, stop under OR structure');
    } else if (orl && last <= orl * 1.002 && vsSpy <= 0.2) {
      sideHint = 'sell';
      const entryMid = Math.min(last, orl);
      entryZone = {
        low: round2(entryMid - atr14 * 0.15),
        mid: round2(entryMid),
        high: round2(entryMid + spread),
      };
      stop = round2(Math.max(orh ?? last + atr14 * 0.8, entryMid + atr14 * 0.7));
      t1 = round2(entryMid - atr14 * 0.9);
      t2 = round2(entryMid - atr14 * 1.6);
      notes.push('Breakdown mode: short below ORL');
    } else {
      sideHint = 'flat';
      entryZone = {
        low: round2(last - atr14 * 0.2),
        mid: round2(last),
        high: round2(last + atr14 * 0.2),
      };
      stop = round2(last - atr14);
      t1 = round2(last + atr14);
      t2 = round2(last + atr14 * 1.5);
      notes.push('Trend regime but levels not confirmed — watch');
    }
  } else if (regime === 'mean_reversion' && vwap !== undefined) {
    if (last > vwap) {
      sideHint = 'sell';
      entryZone = {
        low: round2(Math.max(vwap, last - atr14 * 0.25)),
        mid: round2(last - atr14 * 0.05),
        high: round2(last),
      };
      stop = round2(last + atr14 * 0.65);
      t1 = round2(vwap);
      t2 = round2(vwap - atr14 * 0.35);
      notes.push('Fade stretch above VWAP');
    } else {
      sideHint = 'buy';
      entryZone = {
        low: round2(last),
        mid: round2(last + atr14 * 0.05),
        high: round2(Math.min(vwap, last + atr14 * 0.25)),
      };
      stop = round2(last - atr14 * 0.65);
      t1 = round2(vwap);
      t2 = round2(vwap + atr14 * 0.35);
      notes.push('Fade stretch below VWAP');
    }
  } else {
    sideHint = 'flat';
    entryZone = {
      low: round2(fairValueBand.low),
      mid: round2(last),
      high: round2(fairValueBand.high),
    };
    stop = round2(last - atr14 * 0.9);
    t1 = round2(last + atr14 * 0.9);
    t2 = round2(last + atr14 * 1.5);
    notes.push('Neutral regime — no directional edge from structure');
  }

  // Slippage model: prefer inside spread / at VWAP; impact from relative volume
  const impactBps =
    relativeVolume && relativeVolume > 1.5
      ? Math.min(15, (relativeVolume - 1) * 4)
      : 3;
  const maxSlippageBps = round2(Math.max(5, spreadBps / 2 + impactBps));

  // Confidence: alignment of signals
  let confidence = 0.45;
  if (vwap !== undefined) confidence += 0.1;
  if (openingRange) confidence += 0.1;
  if (input.barsDaily && input.barsDaily.length >= 15) confidence += 0.1;
  if (Math.abs(vsSpy) > 0.3) confidence += 0.05;
  if (input.event?.hasCatalyst) confidence += 0.05;
  if (blockMarketOrders) confidence -= 0.1;
  if (regime === 'neutral') confidence -= 0.05;
  if (prior) confidence += 0.05;
  confidence = clamp(round4(confidence), 0.15, 0.92);

  return {
    symbol,
    asOf,
    last: round2(last),
    mid: mid !== undefined ? round2(mid) : undefined,
    fairValueBand,
    entryZone,
    stop,
    targets: { t1: round2(t1), t2: round2(t2) },
    expectedMove: round2(expectedMove),
    spreadCost: round4(spreadCost),
    maxSlippageBps,
    confidence,
    regime,
    atr14: round4(atr14),
    vwap: vwap !== undefined ? round2(vwap) : undefined,
    openingRange: openingRange
      ? { high: round2(openingRange.high), low: round2(openingRange.low) }
      : undefined,
    relativeStrength: {
      vsSpy: round4(vsSpy),
      vsSector: vsSector !== undefined ? round4(vsSector) : undefined,
    },
    microstructure: {
      spreadBps: round2(spreadBps),
      quoteAgeMs,
      relativeVolume: relativeVolume !== undefined ? round4(relativeVolume) : undefined,
      blockMarketOrders,
    },
    eventPremium: round4(eventPremium),
    notes,
    sideHint,
  };
}

/** Clamp a user/model price into a band (inclusive). */
export function clampToBand(price: number, band: PriceBand): number {
  return round2(clamp(price, band.low, band.high));
}

/** Ensure stop is on the correct side of entry for the trade side. */
export function sanitizeStop(side: 'buy' | 'sell', entry: number, stop: number, atr: number): number {
  if (side === 'buy') {
    return stop >= entry ? round2(entry - Math.max(atr * 0.5, entry * 0.005)) : round2(stop);
  }
  return stop <= entry ? round2(entry + Math.max(atr * 0.5, entry * 0.005)) : round2(stop);
}
