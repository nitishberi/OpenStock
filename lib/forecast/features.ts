import { computeAtr, type OhlcvBar } from '@/lib/pricing';
import { barsOnOrBefore, closeOnDate } from './bars';
import type {
  FeatureSnapshotValues,
  InsiderFeatures,
  NewsFeatures,
  PressEventType,
  PressFeatures,
  SocialFeatures,
} from './types';
import { emptyInsiderFeatures } from './insider';

function sma(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function logRet(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return Math.log(b / a);
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function emptyNewsFeatures(): NewsFeatures {
  return { newsCount48h: 0, newsSentiment: 0, newsNovelty: 0 };
}

export function emptySocialFeatures(): SocialFeatures {
  return {
    socialSentiment: 0,
    socialVolume: 0,
    socialBullBearSkew: 0,
    polymarketTilt: 0,
  };
}

export function emptyPressFeatures(): PressFeatures {
  return {
    pressCount7d: 0,
    pressSentiment: 0,
    pressEventType: 'none',
    pressEventScore: 0,
    /** Capped / normalized days (0–30) so ridge priors cannot explode. */
    daysSinceLastPress: 30,
  };
}

export function pressEventScore(t: PressEventType): number {
  switch (t) {
    case 'earnings':
      return 1;
    case 'guidance':
      return 0.85;
    case 'product':
      return 0.55;
    case 'legal':
      return -0.4;
    case 'other':
      return 0.2;
    default:
      return 0;
  }
}

/**
 * Build market features from daily bars ≤ asOf (no lookahead).
 * spyBars / sectorBars optional for relative returns.
 */
export function buildMarketFeatures(
  barsAll: OhlcvBar[],
  asOfIso: string,
  opts?: { spyBars?: OhlcvBar[]; sectorBars?: OhlcvBar[] }
): Omit<
  FeatureSnapshotValues,
  | keyof NewsFeatures
  | keyof SocialFeatures
  | keyof PressFeatures
  | keyof InsiderFeatures
  | 'symbol'
  | 'asOf'
  | 'sector'
> & {
  lastClose: number;
} {
  const bars = barsOnOrBefore(barsAll, asOfIso);
  if (bars.length < 30) {
    throw new Error(`Need ≥30 daily bars on or before ${asOfIso} (got ${bars.length})`);
  }
  const closes = bars.map((b) => b.c);
  const last = closes[closes.length - 1];
  const n = closes.length;

  const ret1d = n >= 2 ? logRet(closes[n - 2], last) : 0;
  const ret5d = n >= 6 ? logRet(closes[n - 6], last) : 0;
  const ret21d = n >= 22 ? logRet(closes[n - 22], last) : 0;

  const rets21: number[] = [];
  for (let i = Math.max(1, n - 21); i < n; i++) {
    rets21.push(logRet(closes[i - 1], closes[i]));
  }
  const vol21d = stdev(rets21) * Math.sqrt(252);

  const atr = computeAtr(bars, 14);
  const atrPct = atr && last > 0 ? atr / last : 0;

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const sma20Dist = s20 ? (last - s20) / s20 : 0;
  const sma50Dist = s50 ? (last - s50) / s50 : 0;

  let spyRel5d = 0;
  if (opts?.spyBars?.length) {
    const spy = barsOnOrBefore(opts.spyBars, asOfIso);
    if (spy.length >= 6) {
      const spyRet = logRet(spy[spy.length - 6].c, spy[spy.length - 1].c);
      spyRel5d = ret5d - spyRet;
    }
  }

  let sectorRel5d = 0;
  if (opts?.sectorBars?.length) {
    const sec = barsOnOrBefore(opts.sectorBars, asOfIso);
    if (sec.length >= 6) {
      const secRet = logRet(sec[sec.length - 6].c, sec[sec.length - 1].c);
      sectorRel5d = ret5d - secRet;
    }
  }

  const last20 = bars.slice(-20);
  const dollarVolume20d =
    last20.reduce((a, b) => a + b.c * b.v, 0) / Math.max(1, last20.length) / 1e9; // $B/day proxy

  const highVolRegime = vol21d > 0.35 ? 1 : vol21d > 0.25 ? 0.5 : 0;

  return {
    ret1d,
    ret5d,
    ret21d,
    vol21d,
    atrPct,
    sma20Dist,
    sma50Dist,
    spyRel5d,
    sectorRel5d,
    dollarVolume20d,
    highVolRegime,
    lastClose: last,
  };
}

export function assembleFeatureSnapshot(input: {
  symbol: string;
  asOf: string;
  sector: string;
  bars: OhlcvBar[];
  spyBars?: OhlcvBar[];
  sectorBars?: OhlcvBar[];
  news?: NewsFeatures;
  social?: SocialFeatures;
  press?: PressFeatures;
  insider?: InsiderFeatures;
}): { features: FeatureSnapshotValues; lastClose: number } {
  const market = buildMarketFeatures(input.bars, input.asOf, {
    spyBars: input.spyBars,
    sectorBars: input.sectorBars,
  });
  const { lastClose, ...m } = market;
  const features: FeatureSnapshotValues = {
    symbol: input.symbol.toUpperCase(),
    asOf: input.asOf,
    sector: input.sector,
    ...m,
    ...(input.news ?? emptyNewsFeatures()),
    ...(input.social ?? emptySocialFeatures()),
    ...(input.press ?? emptyPressFeatures()),
    ...(input.insider ?? emptyInsiderFeatures()),
  };
  return { features, lastClose };
}

/** Realized forward log-return from asOf close to horizon close (for training). */
export function realizedForwardLogReturn(
  bars: OhlcvBar[],
  asOfIso: string,
  horizonIso: string
): number | undefined {
  const a = closeOnDate(bars, asOfIso) ?? barsOnOrBefore(bars, asOfIso).at(-1)?.c;
  const b = closeOnDate(bars, horizonIso);
  if (a == null || b == null || a <= 0 || b <= 0) return undefined;
  return Math.log(b / a);
}
