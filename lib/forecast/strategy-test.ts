/**
 * Walk-forward strategy test: predict D1–D5 vs real closes on the 100-stock universe.
 * No lookahead — features use only data ≤ asOf.
 */

import type { OhlcvBar } from '@/lib/pricing';
import { addTradingDays, lastTradingDays, toUtcDateString } from './calendar';
import { barsOnOrBefore, closeOnDate, fetchDailyBars, fetchUniverseDailyBars } from './bars';
import {
  assembleFeatureSnapshot,
  emptyNewsFeatures,
  emptyPressFeatures,
  emptySocialFeatures,
} from './features';
import { emptyInsiderFeatures, featuresFromInsiderFilings, type InsiderFilingLike } from './insider';
import { forecastHorizons } from './baseline';
import { getForecastUniverse, getSectorMap, sectorEtfSymbol, sectorEtfsForSectors } from './universe';
import type {
  FeatureSnapshotValues,
  ForecastHorizon,
  HorizonMetrics,
  ModelWeightsPayload,
  PriceForecastValues,
  StrategyTestSummary,
} from './types';
import { FORECAST_HORIZONS, HORIZON_DAYS } from './types';
import type { TrainRow } from './train';

export interface StrategyTestOptions {
  weights: ModelWeightsPayload;
  /** Trading days in walk-forward window (default 120). */
  windowDays?: number;
  /** End date ISO; default last weekday. */
  endDate?: string;
  /** Limit symbols (for smoke tests). */
  symbolLimit?: number;
  /** Delay between Finnhub symbol fetches. */
  delayMs?: number;
  /** Optional preloaded bars map. */
  barsBySymbol?: Map<string, OhlcvBar[]>;
  /** When false, skip live media (use zeros) — offline replay. */
  liveMedia?: boolean;
  /** Optional preloaded insider filings by ticker (for tests / offline). */
  insiderBySymbol?: Map<string, InsiderFilingLike[]>;
  onProgress?: (msg: string) => void;
}

export interface ResolvedForecastRow extends PriceForecastValues {
  sector: string;
  features: FeatureSnapshotValues;
}

export interface StrategyTestResult {
  summary: StrategyTestSummary;
  rows: ResolvedForecastRow[];
  trainRows: TrainRow[];
  holdoutAsOfs: string[];
}

function emptyMetrics(): HorizonMetrics {
  return { n: 0, mae: 0, mape: 0, rmse: 0, directionHitRate: 0, coverage80: 0 };
}

function finalizeMetrics(
  acc: Record<ForecastHorizon, { abs: number[]; pct: number[]; sq: number[]; dir: number[]; inside: number[] }>
): Record<ForecastHorizon, HorizonMetrics> {
  const out = {} as Record<ForecastHorizon, HorizonMetrics>;
  for (const h of FORECAST_HORIZONS) {
    const a = acc[h];
    const n = a.abs.length;
    if (!n) {
      out[h] = emptyMetrics();
      continue;
    }
    out[h] = {
      n,
      mae: a.abs.reduce((x, y) => x + y, 0) / n,
      mape: a.pct.reduce((x, y) => x + y, 0) / n,
      rmse: Math.sqrt(a.sq.reduce((x, y) => x + y, 0) / n),
      directionHitRate: a.dir.reduce((x, y) => x + y, 0) / n,
      coverage80: a.inside.reduce((x, y) => x + y, 0) / n,
    };
  }
  return out;
}

export async function runStrategyTest(opts: StrategyTestOptions): Promise<StrategyTestResult> {
  const universe = getForecastUniverse();
  const sectorMap = getSectorMap();
  const symbols = universe.symbols
    .map((s) => s.symbol)
    .slice(0, opts.symbolLimit ?? 100);
  const windowDays = opts.windowDays ?? 120;

  opts.onProgress?.(`Loading daily bars for ${symbols.length} symbols…`);
  const barsBySymbol =
    opts.barsBySymbol ??
    (await fetchUniverseDailyBars(symbols, { delayMs: opts.delayMs ?? 350 }));

  opts.onProgress?.('Loading SPY for relative features…');
  let spyBars = barsBySymbol.get('SPY');
  if (!spyBars?.length) {
    try {
      spyBars = await fetchDailyBars('SPY');
    } catch {
      spyBars = [];
    }
  }

  // Prefetch sector ETFs so sectorRel5d is non-zero
  const neededSectors = symbols.map((s) => sectorMap.get(s) || 'Unknown');
  const etfTickers = sectorEtfsForSectors(neededSectors);
  const sectorBarsByEtf = new Map<string, OhlcvBar[]>();
  opts.onProgress?.(`Loading ${etfTickers.length} sector ETFs for relative features…`);
  for (const etf of etfTickers) {
    let bars = barsBySymbol.get(etf);
    if (!bars?.length) {
      try {
        bars = await fetchDailyBars(etf);
        if (opts.delayMs) await new Promise((r) => setTimeout(r, Math.min(200, opts.delayMs)));
      } catch {
        bars = [];
      }
    }
    sectorBarsByEtf.set(etf, bars || []);
  }

  // Align walk-forward end to last available market bar (VM clocks can be ahead of real tape).
  let end = opts.endDate || toUtcDateString(new Date());
  if (!opts.endDate) {
    let maxT = 0;
    for (const bars of barsBySymbol.values()) {
      const last = bars.at(-1)?.t ?? 0;
      if (last > maxT) maxT = last;
    }
    if (spyBars?.length) {
      const last = spyBars.at(-1)!.t;
      if (last > maxT) maxT = last;
    }
    if (maxT > 0) {
      const barEnd = toUtcDateString(new Date(maxT < 1e12 ? maxT * 1000 : maxT));
      if (barEnd < end) end = barEnd;
    }
  }
  const asOfList = lastTradingDays(end, windowDays);
  // Need room after asOf for D5 resolution — stop asOf early enough.
  const asOfUsable = asOfList.slice(0, Math.max(1, asOfList.length - 5));
  const holdoutAsOfs = asOfUsable.slice(-20);

  const rows: ResolvedForecastRow[] = [];
  const trainRows: TrainRow[] = [];
  const acc: Record<ForecastHorizon, { abs: number[]; pct: number[]; sq: number[]; dir: number[]; inside: number[] }> = {
    D1: { abs: [], pct: [], sq: [], dir: [], inside: [] },
    D2: { abs: [], pct: [], sq: [], dir: [], inside: [] },
    D3: { abs: [], pct: [], sq: [], dir: [], inside: [] },
    D5: { abs: [], pct: [], sq: [], dir: [], inside: [] },
  };

  // Live media: latest asOf AND every 5th historical asOf (bounded cost).
  const mediaCache = new Map<string, Awaited<ReturnType<typeof import('./media').collectMediaFeatures>>>();

  for (const symbol of symbols) {
    const bars = barsBySymbol.get(symbol) || [];
    if (bars.length < 60) {
      opts.onProgress?.(`Skip ${symbol}: insufficient bars (${bars.length})`);
      continue;
    }
    const sector = sectorMap.get(symbol) || 'Unknown';
    const etf = sectorEtfSymbol(sector);
    const sectorBars = etf ? sectorBarsByEtf.get(etf) : undefined;

    for (let asOfIdx = 0; asOfIdx < asOfUsable.length; asOfIdx++) {
      const asOf = asOfUsable[asOfIdx];
      const hist = barsOnOrBefore(bars, asOf);
      if (hist.length < 30) continue;

      let news = emptyNewsFeatures();
      let social = emptySocialFeatures();
      let press = emptyPressFeatures();
      let insider = emptyInsiderFeatures();
      let evidenceUrls: string[] = [];

      if (opts.insiderBySymbol?.has(symbol)) {
        insider = featuresFromInsiderFilings(opts.insiderBySymbol.get(symbol) || [], asOf);
      }

      const isLatestAsOf = asOfIdx === asOfUsable.length - 1;
      const isEveryFifth = asOfIdx % 5 === 0;
      const sampleLiveMedia = Boolean(opts.liveMedia && (isLatestAsOf || isEveryFifth));

      if (sampleLiveMedia) {
        const mediaKey = `${symbol}:${asOf}`;
        try {
          if (!mediaCache.has(mediaKey)) {
            const { collectMediaFeatures } = await import('./media');
            mediaCache.set(mediaKey, await collectMediaFeatures(symbol, { persist: false }));
          }
          const m = mediaCache.get(mediaKey)!;
          news = m.news;
          social = m.social;
          press = m.press;
          evidenceUrls = m.evidenceUrls;
        } catch {
          /* zeros */
        }
        try {
          const { collectInsiderFeatures } = await import('./insider');
          const pack = await collectInsiderFeatures(symbol, asOf, {
            refreshTicker: Boolean(opts.liveMedia && isLatestAsOf),
          });
          insider = pack.features;
          evidenceUrls = [...evidenceUrls, ...pack.evidenceUrls];
        } catch {
          /* keep prior insider zeros / map */
        }
      }

      let assembled: { features: FeatureSnapshotValues; lastClose: number };
      try {
        assembled = assembleFeatureSnapshot({
          symbol,
          asOf,
          sector,
          bars,
          spyBars,
          sectorBars,
          news,
          social,
          press,
          insider,
        });
      } catch {
        continue;
      }

      const forecasts = forecastHorizons({
        features: assembled.features,
        lastClose: assembled.lastClose,
        weights: opts.weights,
        evidenceUrls,
      });

      for (const f of forecasts) {
        const horizonDate = toUtcDateString(addTradingDays(asOf, HORIZON_DAYS[f.horizon]));
        const actual = closeOnDate(bars, horizonDate);
        if (actual == null) continue;

        const absError = Math.abs(f.yHat - actual);
        const pctError = absError / actual;
        const signedError = f.yHat - actual;
        const actDir = actual > f.lastClose * 1.0015 ? 'up' : actual < f.lastClose * 0.9985 ? 'down' : 'flat';
        const directionHit = f.direction === actDir;
        const inside80 = actual >= f.lo80 && actual <= f.hi80;

        const resolved: ResolvedForecastRow = {
          ...f,
          status: 'resolved',
          actualClose: actual,
          absError,
          pctError,
          signedError,
          directionHit,
          inside80,
          sector,
          features: assembled.features,
        };
        rows.push(resolved);

        const bucket = acc[f.horizon];
        bucket.abs.push(absError);
        bucket.pct.push(pctError);
        bucket.sq.push(signedError * signedError);
        bucket.dir.push(directionHit ? 1 : 0);
        bucket.inside.push(inside80 ? 1 : 0);

        const y = Math.log(actual / f.lastClose);
        trainRows.push({
          features: assembled.features,
          horizon: f.horizon,
          y,
          asOf,
        });
      }
    }
    opts.onProgress?.(`Done ${symbol}`);
  }

  const byHorizon = finalizeMetrics(acc);

  // Sector breakdown (lightweight)
  const bySector: StrategyTestSummary['bySector'] = {};
  for (const row of rows) {
    bySector[row.sector] ||= {};
  }

  return {
    summary: {
      modelVersion: opts.weights.version,
      asOfStart: asOfUsable[0] || asOfList[0],
      asOfEnd: asOfUsable[asOfUsable.length - 1] || asOfList[asOfList.length - 1],
      symbolCount: new Set(rows.map((r) => r.symbol)).size,
      byHorizon,
      bySector,
    },
    rows,
    trainRows,
    holdoutAsOfs,
  };
}

/** Smoke: synthetic bars strategy test without network. */
export function synthesizeBars(seedClose: number, days: number, seed = 1): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  let c = seedClose;
  const start = Date.UTC(2024, 0, 2);
  let t = start;
  let i = 0;
  while (bars.length < days) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const shock = Math.sin(i / 7 + seed) * 0.01 + Math.cos(i / 3 + seed) * 0.005;
      const o = c;
      c = Math.max(1, c * (1 + shock));
      const h = Math.max(o, c) * 1.005;
      const l = Math.min(o, c) * 0.995;
      bars.push({ t, o, h, l, c, v: 1_000_000 + i * 1000 });
      i++;
    }
    t += 86_400_000;
  }
  return bars;
}
