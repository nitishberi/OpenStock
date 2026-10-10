import { getDb, nowIso } from '../db/index.js';
import type { DesktopConfig } from '../config.js';
import { ensureActiveWeights, writeWeightsToDisk, type WeightsPayload } from './weights-store.js';
import { notifyForecastRefresh } from './notify.js';
import { importForecast } from '../libpath.js';

/**
 * Desktop forecast orchestration.
 * Reuses OpenStock pure forecast modules when resolvable; falls back to baseline-only.
 */

type ForecastRow = {
  symbol: string;
  asOf: string;
  horizon: string;
  lastClose: number;
  yHat: number;
  lo80: number;
  hi80: number;
  direction: string;
  confidence: number;
  rationale: string;
  evidenceUrls: string[];
  modelVersion: string;
  status?: string;
};

async function loadForecastLib(): Promise<{
  createSwingBaselineV1: () => WeightsPayload;
  createSwingBaselineV3?: () => WeightsPayload;
  toUtcDateString: (d: Date) => string;
  previousTradingDayOnOrBefore: (d: Date) => Date;
  getForecastUniverse: () => { symbols: Array<{ symbol: string }>; count: number };
  getSectorMap: () => Map<string, string>;
  sectorEtfSymbol: (sector: string) => string | undefined;
  fetchDailyBars: (symbol: string) => Promise<Array<{ date: string; close: number }>>;
  assembleFeatureSnapshot: (input: Record<string, unknown>) => {
    features: Record<string, unknown>;
    lastClose: number;
  };
  forecastHorizons: (input: Record<string, unknown>) => ForecastRow[];
  collectMediaFeatures?: (symbol: string, opts?: Record<string, unknown>) => Promise<{
    news: unknown;
    social: unknown;
    press: unknown;
    evidenceUrls: string[];
  }>;
  collectInsiderFeatures?: (
    symbol: string,
    asOf: string,
    opts?: Record<string, unknown>
  ) => Promise<{ features: Record<string, unknown>; evidenceUrls: string[] }>;
  emptyInsiderFeatures: () => Record<string, number>;
} | null> {
  try {
    const weights = await importForecast('weights');
    const calendar = await importForecast('calendar');
    const universe = await importForecast('universe');
    const bars = await importForecast('bars');
    const features = await importForecast('features');
    const baseline = await importForecast('baseline');
    const insider = await importForecast('insider');
    let media: Record<string, unknown> = {};
    try {
      media = await importForecast('media');
    } catch {
      /* media optional without mongo */
    }
    return {
      createSwingBaselineV1: weights.createSwingBaselineV1 as () => WeightsPayload,
      createSwingBaselineV3: weights.createSwingBaselineV3 as (() => WeightsPayload) | undefined,
      toUtcDateString: calendar.toUtcDateString as (d: Date) => string,
      previousTradingDayOnOrBefore: calendar.previousTradingDayOnOrBefore as (d: Date) => Date,
      getForecastUniverse: universe.getForecastUniverse as () => {
        symbols: Array<{ symbol: string }>;
        count: number;
      },
      getSectorMap: universe.getSectorMap as () => Map<string, string>,
      sectorEtfSymbol: universe.sectorEtfSymbol as (sector: string) => string | undefined,
      fetchDailyBars: bars.fetchDailyBars as (
        symbol: string
      ) => Promise<Array<{ date: string; close: number }>>,
      assembleFeatureSnapshot: features.assembleFeatureSnapshot as (input: Record<string, unknown>) => {
        features: Record<string, unknown>;
        lastClose: number;
      },
      forecastHorizons: baseline.forecastHorizons as (input: Record<string, unknown>) => ForecastRow[],
      collectMediaFeatures: media.collectMediaFeatures as
        | ((symbol: string, opts?: Record<string, unknown>) => Promise<{
            news: unknown;
            social: unknown;
            press: unknown;
            evidenceUrls: string[];
          }>)
        | undefined,
      collectInsiderFeatures: insider.collectInsiderFeatures as
        | ((
            symbol: string,
            asOf: string,
            opts?: Record<string, unknown>
          ) => Promise<{ features: Record<string, unknown>; evidenceUrls: string[] }>)
        | undefined,
      emptyInsiderFeatures: insider.emptyInsiderFeatures as () => Record<string, number>,
    };
  } catch (e) {
    console.warn('[forecasts] OpenStock lib unavailable, using stub', e);
    return null;
  }
}

function persistForecasts(rows: ForecastRow[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO price_forecast (
      symbol, asOf, horizon, modelVersion, lastClose, yHat, lo80, hi80,
      direction, confidence, rationale, evidenceUrls, status, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT(symbol, asOf, horizon, modelVersion) DO UPDATE SET
      lastClose=excluded.lastClose, yHat=excluded.yHat, lo80=excluded.lo80, hi80=excluded.hi80,
      direction=excluded.direction, confidence=excluded.confidence, rationale=excluded.rationale,
      evidenceUrls=excluded.evidenceUrls, status='active'`
  );
  const ts = nowIso();
  const tx = db.transaction((list: ForecastRow[]) => {
    for (const r of list) {
      stmt.run(
        r.symbol,
        r.asOf,
        r.horizon,
        r.modelVersion,
        r.lastClose,
        r.yHat,
        r.lo80,
        r.hi80,
        r.direction,
        r.confidence,
        r.rationale || '',
        JSON.stringify(r.evidenceUrls || []),
        ts
      );
    }
  });
  tx(rows);
}

export function listLatestForecasts(symbols?: string[]): ForecastRow[] {
  const db = getDb();
  let rows: Array<Record<string, unknown>>;
  if (symbols?.length) {
    const placeholders = symbols.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT * FROM price_forecast
         WHERE status IN ('active','resolved') AND symbol IN (${placeholders})
         ORDER BY asOf DESC, createdAt DESC LIMIT 200`
      )
      .all(...symbols.map((s) => s.toUpperCase())) as Array<Record<string, unknown>>;
  } else {
    rows = db
      .prepare(
        `SELECT * FROM price_forecast
         WHERE status IN ('active','resolved')
         ORDER BY asOf DESC, createdAt DESC LIMIT 200`
      )
      .all() as Array<Record<string, unknown>>;
  }
  return rows.map((r) => ({
    symbol: String(r.symbol),
    asOf: String(r.asOf),
    horizon: String(r.horizon),
    lastClose: Number(r.lastClose),
    yHat: Number(r.yHat),
    lo80: Number(r.lo80),
    hi80: Number(r.hi80),
    direction: String(r.direction),
    confidence: Number(r.confidence),
    rationale: String(r.rationale || ''),
    evidenceUrls: JSON.parse(String(r.evidenceUrls || '[]')),
    modelVersion: String(r.modelVersion),
    status: String(r.status),
  }));
}

export async function getActiveModel(cfg: DesktopConfig): Promise<{
  version: string;
  weights: WeightsPayload;
}> {
  const lib = await loadForecastLib();
  const create =
    lib?.createSwingBaselineV3 ||
    lib?.createSwingBaselineV1 ||
    (() =>
      ({
        version: 'swing-baseline-v1-stub',
        createdAt: new Date().toISOString(),
      }) as WeightsPayload);
  const weights = ensureActiveWeights(cfg, create);
  return { version: weights.version, weights };
}

export async function runWatchlistForecasts(
  cfg: DesktopConfig,
  symbols: string[]
): Promise<{ forecasts: ForecastRow[]; modelVersion: string; asOf: string }> {
  const lib = await loadForecastLib();
  const { version, weights } = await getActiveModel(cfg);

  if (!lib) {
    const asOf = new Date().toISOString().slice(0, 10);
    const forecasts: ForecastRow[] = symbols.slice(0, 20).flatMap((symbol) =>
      (['D1', 'D2', 'D3', 'D5'] as const).map((horizon) => ({
        symbol: symbol.toUpperCase(),
        asOf,
        horizon,
        lastClose: 100,
        yHat: 100,
        lo80: 98,
        hi80: 102,
        direction: 'flat',
        confidence: 0.3,
        rationale: 'Stub forecast — OpenStock lib not loaded; configure Finnhub keys.',
        evidenceUrls: [],
        modelVersion: version,
      }))
    );
    persistForecasts(forecasts);
    return { forecasts, modelVersion: version, asOf };
  }

  const asOf = lib.toUtcDateString(lib.previousTradingDayOnOrBefore(new Date()));
  const sectorMap = lib.getSectorMap();
  let syms = symbols.map((s) => s.toUpperCase()).filter(Boolean);
  if (!syms.length) {
    syms = lib
      .getForecastUniverse()
      .symbols.slice(0, 8)
      .map((s) => s.symbol);
  }

  let spyBars: Array<{ date: string; close: number }> = [];
  try {
    spyBars = await lib.fetchDailyBars('SPY');
  } catch {
    spyBars = [];
  }

  const forecasts: ForecastRow[] = [];
  const sectorBarsCache = new Map<string, Array<{ date: string; close: number }>>();

  for (const symbol of syms.slice(0, 20)) {
    try {
      const bars = await lib.fetchDailyBars(symbol);
      const sector = sectorMap.get(symbol) || 'Unknown';
      const etf = lib.sectorEtfSymbol(sector);
      let sectorBars: Array<{ date: string; close: number }> | undefined;
      if (etf) {
        if (!sectorBarsCache.has(etf)) {
          try {
            sectorBarsCache.set(etf, await lib.fetchDailyBars(etf));
          } catch {
            sectorBarsCache.set(etf, []);
          }
        }
        sectorBars = sectorBarsCache.get(etf);
      }

      let news = {};
      let social = {};
      let press = {};
      let evidenceUrls: string[] = [];
      if (lib.collectMediaFeatures) {
        try {
          const media = await lib.collectMediaFeatures(symbol, {
            persist: false,
            enrichBodies: false,
          });
          news = media.news;
          social = media.social;
          press = media.press;
          evidenceUrls = media.evidenceUrls || [];
        } catch (e) {
          console.warn('media features failed', symbol, e);
        }
      }

      let insiderFeatures = lib.emptyInsiderFeatures();
      if (lib.collectInsiderFeatures) {
        try {
          // Prefer SQLite filings
          const local = loadInsiderFromSqlite(symbol, asOf);
          if (local.count) {
            insiderFeatures = local.features;
            evidenceUrls = [...evidenceUrls, ...local.evidenceUrls];
          } else {
            const insider = await lib.collectInsiderFeatures(symbol, asOf, {
              refreshTicker: false,
            });
            insiderFeatures = insider.features;
            evidenceUrls = [...evidenceUrls, ...(insider.evidenceUrls || [])];
          }
        } catch (e) {
          console.warn('insider features failed', symbol, e);
        }
      }

      const { features, lastClose } = lib.assembleFeatureSnapshot({
        symbol,
        asOf,
        sector,
        bars,
        spyBars,
        sectorBars,
        news,
        social,
        press,
        insider: insiderFeatures,
      });

      const rows = lib.forecastHorizons({
        features,
        lastClose,
        weights,
        evidenceUrls,
      });
      for (const r of rows) {
        forecasts.push({ ...r, modelVersion: version });
      }

      getDb()
        .prepare(
          `INSERT INTO feature_snapshot (symbol, asOf, payload, createdAt)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(symbol, asOf) DO UPDATE SET payload = excluded.payload`
        )
        .run(symbol, asOf, JSON.stringify(features), nowIso());
    } catch (e) {
      console.warn('forecast failed', symbol, e);
    }
  }

  persistForecasts(forecasts);
  writeWeightsToDisk(cfg, weights);
  void notifyForecastRefresh({
    symbolCount: new Set(forecasts.map((f) => f.symbol)).size,
    modelVersion: version,
    asOf,
  });

  return { forecasts, modelVersion: version, asOf };
}

function loadInsiderFromSqlite(
  symbol: string,
  asOf: string
): { count: number; features: Record<string, number>; evidenceUrls: string[] } {
  const rows = getDb()
    .prepare(
      `SELECT * FROM insider_filing WHERE ticker = ? AND tradeDate <= ? ORDER BY tradeDate DESC LIMIT 200`
    )
    .all(symbol.toUpperCase(), asOf) as Array<Record<string, unknown>>;

  // Lightweight tilt: count buys in 7d / 30d by value
  const asOfMs = Date.parse(asOf + 'T00:00:00Z');
  let buyValue7d = 0;
  let buyCount7d = 0;
  let netValue30d = 0;
  let ceoCfo = 0;
  const urls: string[] = [];
  for (const r of rows) {
    const tradeMs = Date.parse(String(r.tradeDate) + 'T00:00:00Z');
    const age = (asOfMs - tradeMs) / 864e5;
    const value = Number(r.valueUsd) || 0;
    const type = String(r.tradeType || '').toLowerCase();
    const isBuy = type.includes('buy') || type.includes('purchase') || value > 0;
    if (age <= 30) netValue30d += isBuy ? value : -Math.abs(value);
    if (age <= 7 && isBuy) {
      buyValue7d += Math.abs(value);
      buyCount7d += 1;
    }
    const title = String(r.title || '').toLowerCase();
    if (isBuy && age <= 7 && (title.includes('ceo') || title.includes('cfo'))) ceoCfo = 1;
    if (r.sourceUrl) urls.push(String(r.sourceUrl));
  }

  return {
    count: rows.length,
    features: {
      insiderBuyValue7d: buyValue7d,
      insiderBuyCount7d: buyCount7d,
      insiderClusterBuy: buyCount7d >= 3 ? 1 : 0,
      insiderCeoCfoBuy: ceoCfo,
      insiderNetValue30d: netValue30d,
      daysSinceLastInsiderBuy: buyCount7d ? 0 : 30,
    },
    evidenceUrls: urls.slice(0, 5),
  };
}

export function getWatchlist(userId: string): Array<{ symbol: string; company: string }> {
  return getDb()
    .prepare('SELECT symbol, company FROM watchlist WHERE userId = ? ORDER BY addedAt DESC')
    .all(userId) as Array<{ symbol: string; company: string }>;
}

export function addWatchlistItem(userId: string, symbol: string, company: string): void {
  getDb()
    .prepare(
      `INSERT INTO watchlist (userId, symbol, company, addedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, symbol) DO UPDATE SET company = excluded.company`
    )
    .run(userId, symbol.toUpperCase(), company, nowIso());
}

export function removeWatchlistItem(userId: string, symbol: string): void {
  getDb()
    .prepare('DELETE FROM watchlist WHERE userId = ? AND symbol = ?')
    .run(userId, symbol.toUpperCase());
}
