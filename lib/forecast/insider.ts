/**
 * OpenInsider Form 4 → InsiderFeatures for FeatureSnapshot + evidence lines.
 * Prediction-only; never places orders.
 */

import type { InsiderFeatures } from './types';

export const INSIDER_CEO_CFO_VALUE_THRESHOLD = 100_000;
export const INSIDER_MATERIAL_VALUE_THRESHOLD = 25_000;

export interface InsiderFilingLike {
  filingDate: string;
  tradeDate?: string;
  ticker: string;
  companyName?: string;
  insiderName?: string;
  title?: string;
  tradeType: string;
  price?: number;
  qty?: number;
  valueUsd?: number;
  flags?: {
    amended?: boolean;
    multiDay?: boolean;
    cluster?: boolean;
    ceoCfo?: boolean;
  };
  insCount?: number;
  sourceUrl?: string;
  sourceList?: string;
}

export function emptyInsiderFeatures(): InsiderFeatures {
  return {
    insiderBuyValue7d: 0,
    insiderBuyCount7d: 0,
    insiderClusterBuy: 0,
    insiderCeoCfoBuy: 0,
    insiderNetValue30d: 0,
    daysSinceLastInsiderBuy: 30,
  };
}

function isBuy(tradeType: string): boolean {
  return String(tradeType || '')
    .trim()
    .toUpperCase()
    .startsWith('P');
}

function isSale(tradeType: string): boolean {
  return String(tradeType || '')
    .trim()
    .toUpperCase()
    .startsWith('S');
}

function titleLooksCeoCfo(title?: string): boolean {
  return /\b(CEO|CFO|CHIEF EXECUTIVE|CHIEF FINANCIAL)\b/i.test(title || '');
}

function daysBetween(asOfIso: string, filingIso: string): number {
  const a = Date.parse(`${asOfIso}T00:00:00.000Z`);
  const b = Date.parse(`${filingIso}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.floor((a - b) / 86_400_000);
}

function inWindow(asOfIso: string, filingIso: string, days: number): boolean {
  const d = daysBetween(asOfIso, filingIso);
  return d >= 0 && d <= days;
}

/**
 * Build frozen insider features from filings with filingDate ≤ asOf.
 */
export function featuresFromInsiderFilings(
  filings: InsiderFilingLike[],
  asOfIso: string
): InsiderFeatures {
  const asOfFilings = filings.filter((f) => f.filingDate && f.filingDate <= asOfIso);
  if (!asOfFilings.length) return emptyInsiderFeatures();

  const buys7 = asOfFilings.filter((f) => isBuy(f.tradeType) && inWindow(asOfIso, f.filingDate, 7));
  const window30 = asOfFilings.filter((f) => inWindow(asOfIso, f.filingDate, 30));

  let buyValue7d = 0;
  const buyerNames = new Set<string>();
  for (const f of buys7) {
    buyValue7d += Math.abs(f.valueUsd ?? 0);
    if (f.insiderName) buyerNames.add(f.insiderName);
  }

  let clusterScore = 0;
  for (const f of buys7) {
    if (f.flags?.cluster || (f.insCount != null && f.insCount >= 2) || f.sourceList === 'cluster-buys') {
      clusterScore = Math.max(clusterScore, f.insCount ?? buyerNames.size, 2);
    }
  }
  if (clusterScore === 0 && buyerNames.size >= 2) {
    clusterScore = buyerNames.size;
  }

  let ceoCfo = 0;
  for (const f of buys7) {
    const ceo = Boolean(f.flags?.ceoCfo || titleLooksCeoCfo(f.title));
    if (!ceo) continue;
    // Prefer material CEO/CFO buys (≥ $100k); still flag smaller ones.
    ceoCfo = 1;
    if (Math.abs(f.valueUsd ?? 0) >= INSIDER_CEO_CFO_VALUE_THRESHOLD) break;
  }

  let net30 = 0;
  for (const f of window30) {
    const v = Math.abs(f.valueUsd ?? 0);
    if (isBuy(f.tradeType)) net30 += v;
    else if (isSale(f.tradeType)) net30 -= v;
  }

  let daysSince = 30;
  const buyDates = asOfFilings
    .filter((f) => isBuy(f.tradeType))
    .map((f) => f.filingDate)
    .sort();
  if (buyDates.length) {
    const last = buyDates[buyDates.length - 1];
    daysSince = Math.min(30, Math.max(0, daysBetween(asOfIso, last)));
  }

  return {
    insiderBuyValue7d: buyValue7d / 1e6, // $M for ridge scale
    insiderBuyCount7d: buys7.length,
    insiderClusterBuy: clusterScore,
    insiderCeoCfoBuy: ceoCfo,
    insiderNetValue30d: net30 / 1e6,
    daysSinceLastInsiderBuy: daysSince,
  };
}

/** Short evidence line for forecast cards. */
export function formatInsiderEvidenceLine(filings: InsiderFilingLike[], asOfIso: string): string | null {
  const feats = featuresFromInsiderFilings(filings, asOfIso);
  const recent = filings
    .filter((f) => isBuy(f.tradeType) && f.filingDate <= asOfIso && inWindow(asOfIso, f.filingDate, 14))
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  if (!recent.length && feats.insiderBuyCount7d === 0) return null;

  const top = recent[0];
  const valueM = feats.insiderBuyValue7d;
  if (feats.insiderClusterBuy >= 2) {
    return `Cluster buy: ${feats.insiderClusterBuy} insiders, +$${valueM.toFixed(2)}M, filed ${top?.filingDate || asOfIso}`;
  }
  if (feats.insiderCeoCfoBuy) {
    return `CEO/CFO buy: +$${valueM.toFixed(2)}M (7d), filed ${top?.filingDate || asOfIso}`;
  }
  if (feats.insiderBuyCount7d > 0) {
    return `Insider buys: ${feats.insiderBuyCount7d} filings, +$${valueM.toFixed(2)}M (7d)`;
  }
  return null;
}

export function insiderEvidenceUrls(filings: InsiderFilingLike[], asOfIso: string): string[] {
  const urls: string[] = [];
  for (const f of filings) {
    if (!isBuy(f.tradeType) || f.filingDate > asOfIso) continue;
    if (!inWindow(asOfIso, f.filingDate, 14)) continue;
    if (f.sourceUrl) urls.push(f.sourceUrl);
  }
  const tickers = new Set(
    filings.filter((f) => f.filingDate <= asOfIso).map((f) => f.ticker.toUpperCase())
  );
  for (const t of tickers) {
    urls.push(`http://www.openinsider.com/${t}`);
  }
  return [...new Set(urls)].slice(0, 6);
}

/**
 * Capped event tilt contribution from insider features (log-return units before blend).
 * Large cluster buy or CEO/CFO purchase ≥ threshold → positive tilt, same clamp as press.
 */
export function insiderRawEventTilt(
  features: InsiderFeatures,
  opts?: { valueThresholdUsd?: number; multiplier?: number }
): number {
  const mult = opts?.multiplier ?? 1.25;
  const clusterBoost = features.insiderClusterBuy >= 2 ? 0.55 : 0;
  const ceoBoost = features.insiderCeoCfoBuy > 0 ? 0.45 : 0;
  // insiderBuyValue7d is in $M; ≥0.1 ⇒ $100k
  const material =
    features.insiderBuyValue7d >= 0.1 || features.insiderBuyCount7d > 0
      ? Math.min(0.5, features.insiderBuyValue7d * 0.35 + features.insiderBuyCount7d * 0.05)
      : 0;
  const raw = (clusterBoost + ceoBoost + material) * mult;
  // Normalize to similar scale as news/press sentiment tilts (~order 1 before *0.01)
  return raw;
}

/** Load filings for a symbol from Mongo (≤ asOf optional filter applied by caller). */
export async function loadInsiderFilingsForSymbol(
  symbol: string,
  opts?: { sinceIso?: string; limit?: number }
): Promise<InsiderFilingLike[]> {
  try {
    const { connectToDatabase } = await import('@/database/mongoose');
    const { InsiderFiling } = await import('@/database/models/insider-filing.model');
    await connectToDatabase();
    const q: Record<string, unknown> = { ticker: symbol.toUpperCase() };
    if (opts?.sinceIso) q.filingDate = { $gte: opts.sinceIso };
    const rows = await InsiderFiling.find(q)
      .sort({ filingDate: -1 })
      .limit(opts?.limit ?? 200)
      .lean();
    return rows.map((r) => ({
      filingDate: r.filingDate,
      tradeDate: r.tradeDate,
      ticker: r.ticker,
      companyName: r.companyName,
      insiderName: r.insiderName,
      title: r.title,
      tradeType: r.tradeType,
      price: r.price,
      qty: r.qty,
      valueUsd: r.valueUsd,
      flags: r.flags,
      insCount: r.insCount,
      sourceUrl: r.sourceUrl,
      sourceList: r.sourceList,
    }));
  } catch (e) {
    console.warn('loadInsiderFilingsForSymbol failed', e);
    return [];
  }
}

export async function collectInsiderFeatures(
  symbol: string,
  asOfIso: string,
  opts?: { refreshTicker?: boolean }
): Promise<{
  features: InsiderFeatures;
  evidenceUrls: string[];
  evidenceLine: string | null;
  filings: InsiderFilingLike[];
}> {
  if (opts?.refreshTicker) {
    try {
      const { scrapeOpenInsiderTicker } = await import('@/lib/news/scrapling-client');
      await scrapeOpenInsiderTicker(symbol);
    } catch (e) {
      console.warn('openinsider ticker refresh skipped', e);
    }
  }

  const since = new Date(`${asOfIso}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - 45);
  const sinceIso = since.toISOString().slice(0, 10);
  const filings = await loadInsiderFilingsForSymbol(symbol, { sinceIso });
  const features = featuresFromInsiderFilings(filings, asOfIso);
  return {
    features,
    evidenceUrls: insiderEvidenceUrls(filings, asOfIso),
    evidenceLine: formatInsiderEvidenceLine(filings, asOfIso),
    filings,
  };
}
