'use server';

import { connectToDatabase } from '@/database/mongoose';
import { MediaDocument } from '@/database/models/media-document.model';
import { PricingSnapshot } from '@/database/models/pricing-snapshot.model';
import { AnalysisReport } from '@/database/models/analysis-report.model';
import { TradeProposal } from '@/database/models/trade-proposal.model';
import { MarketReview } from '@/database/models/market-review.model';
import { OrderAudit } from '@/database/models/order-audit.model';
import { discoverNewsForSymbol, isNewsDiscoveryConfigured } from '@/lib/news/discover';
import { ingestArticlesWithScrapling, isScraplingConfigured } from '@/lib/news/scrapling-client';
import { buildPricingSnapshot, type OhlcvBar } from '@/lib/pricing';
import { generateAnalysisReport } from '@/lib/analysis/decision';
import {
  checkProposalCreationGuards,
  getOrCreateTradingSettings,
} from '@/lib/trading/risk';
import { notifyProposalNeedsApproval } from '@/lib/alerts/notify';
import {
  getStockBars,
  getLatestQuote,
  isAlpacaConfigured,
} from '@/lib/trading/alpaca';
import { getSession } from '@/lib/better-auth/auth';

const FINNHUB_BASE = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1';

function finnhubKey(): string | undefined {
  return (
    process.env.FINNHUB_API_KEYS?.split(',')[0]?.trim() ||
    process.env.NEXT_PUBLIC_FINNHUB_API_KEY ||
    process.env.FINNHUB_API_KEY
  );
}

async function finnhubGet<T>(path: string): Promise<T | null> {
  const key = finnhubKey();
  if (!key) return null;
  try {
    const res = await fetch(`${FINNHUB_BASE}${path}${path.includes('?') ? '&' : '?'}token=${key}`, {
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function alpacaBarsToOhlcv(bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>): OhlcvBar[] {
  return bars.map((b) => ({
    t: new Date(b.t).getTime(),
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    v: b.v,
  }));
}

export async function runMarketReview(session: 'pre_open' | 'intraday' | 'post_close' = 'intraday') {
  await connectToDatabase();
  const indices = [
    { symbol: 'SPY', name: 'S&P 500 (SPY)' },
    { symbol: 'QQQ', name: 'Nasdaq 100 (QQQ)' },
    { symbol: 'IWM', name: 'Russell 2000 (IWM)' },
    { symbol: 'DIA', name: 'Dow (DIA)' },
  ];

  const snapshots = [];
  for (const idx of indices) {
    const q = await finnhubGet<{ c?: number; dp?: number }>(`/quote?symbol=${idx.symbol}`);
    if (q?.c) {
      snapshots.push({
        symbol: idx.symbol,
        name: idx.name,
        last: q.c,
        changePct: q.dp ?? 0,
      });
    }
  }

  const sectors = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC'];
  const sectorMoves: { symbol: string; changePct: number }[] = [];
  for (const s of sectors) {
    const q = await finnhubGet<{ dp?: number }>(`/quote?symbol=${s}`);
    if (q?.dp !== undefined) sectorMoves.push({ symbol: s, changePct: q.dp });
  }
  sectorMoves.sort((a, b) => b.changePct - a.changePct);
  const leaders = sectorMoves.slice(0, 3).map((s) => s.symbol);
  const laggards = sectorMoves.slice(-3).reverse().map((s) => s.symbol);

  const advancing = snapshots.filter((s) => s.changePct > 0).length;
  const declining = snapshots.filter((s) => s.changePct < 0).length;

  const summary = `Indices: ${snapshots.map((s) => `${s.symbol} ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`).join(', ')}. Leaders: ${leaders.join(', ') || 'n/a'}; Laggards: ${laggards.join(', ') || 'n/a'}.`;

  const doc = await MarketReview.create({
    asOf: new Date(),
    session,
    indices: snapshots,
    breadthProxy: { advancing, declining, unchanged: snapshots.length - advancing - declining },
    sectorLeaders: leaders,
    sectorLaggards: laggards,
    summary,
    notes: ['Breadth proxy uses index ETF direction counts, not full tape.'],
  });

  return JSON.parse(JSON.stringify(doc));
}

export async function ingestMediaForSymbol(symbol: string, company?: string) {
  await connectToDatabase();
  const sym = symbol.toUpperCase();
  let discovered: Array<{
    title: string;
    url: string;
    snippet?: string;
    source?: string;
    provider?: string;
    score?: number;
    publishedAt?: string;
  }> = isNewsDiscoveryConfigured()
    ? await discoverNewsForSymbol(sym, { company, max: 6 })
    : [];

  // Finnhub company news fallback
  if (discovered.length === 0) {
    const to = new Date();
    const from = new Date(Date.now() - 3 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const news = await finnhubGet<Array<{ headline?: string; url?: string; summary?: string; source?: string; datetime?: number }>>(
      `/company-news?symbol=${sym}&from=${fmt(from)}&to=${fmt(to)}`
    );
    discovered = (news || []).slice(0, 6).map((n) => ({
      title: n.headline || 'Untitled',
      url: n.url || '',
      snippet: n.summary,
      source: n.source,
      provider: 'finnhub',
      publishedAt: n.datetime ? new Date(n.datetime * 1000).toISOString() : undefined,
    })).filter((a) => a.url);
  }

  let bodies: Array<{
    symbol?: string;
    title: string;
    url: string;
    source: string;
    sourceKind: string;
    excerpt?: string;
    body?: string;
    publishedAt?: string;
    fetchedAt: string;
    domain: string;
    score?: number;
  }> = [];

  if (isScraplingConfigured() && discovered.length) {
    try {
      bodies = await ingestArticlesWithScrapling({
        symbol: sym,
        company,
        articles: discovered.map((d) => ({
          title: d.title,
          url: d.url,
          snippet: d.snippet,
          provider: d.provider,
          score: d.score,
          publishedAt: d.publishedAt,
        })),
      });
    } catch (e) {
      console.warn('Scrapling ingest failed, storing discovery metadata only', e);
    }
  }

  if (!bodies.length) {
    bodies = discovered.map((d) => {
      let domain = 'unknown';
      try {
        domain = new URL(d.url).hostname.replace(/^www\./, '');
      } catch { /* ignore */ }
      return {
        symbol: sym,
        title: d.title,
        url: d.url,
        source: d.source || domain,
        sourceKind: d.provider || 'finnhub',
        excerpt: d.snippet,
        fetchedAt: new Date().toISOString(),
        domain,
        score: d.score,
      };
    });
  }

  const saved = [];
  for (const doc of bodies) {
    try {
      const upserted = await MediaDocument.findOneAndUpdate(
        { url: doc.url },
        {
          $set: {
            symbol: sym,
            title: doc.title,
            source: doc.source,
            sourceKind: doc.sourceKind,
            excerpt: doc.excerpt,
            body: doc.body,
            publishedAt: doc.publishedAt ? new Date(doc.publishedAt) : undefined,
            fetchedAt: new Date(doc.fetchedAt || Date.now()),
            domain: doc.domain,
            score: doc.score,
            tags: ['intake'],
          },
        },
        { upsert: true, new: true }
      );
      saved.push(upserted);
    } catch (e) {
      console.warn('Media upsert failed', doc.url, e);
    }
  }

  return JSON.parse(JSON.stringify(saved));
}

export async function buildAndStorePricing(symbol: string, mediaCount = 0) {
  await connectToDatabase();
  const sym = symbol.toUpperCase();

  const fhQuote = await finnhubGet<{ c?: number; h?: number; l?: number; o?: number; pc?: number; t?: number }>(
    `/quote?symbol=${sym}`
  );
  const spyQuote = await finnhubGet<{ dp?: number }>(`/quote?symbol=SPY`);

  let bars5m: OhlcvBar[] = [];
  let bars1m: OhlcvBar[] = [];
  let barsDaily: OhlcvBar[] = [];
  let bid: number | undefined;
  let ask: number | undefined;
  let quoteTs: number | undefined;

  if (isAlpacaConfigured()) {
    try {
      const [b5, b1, bd, lq] = await Promise.all([
        getStockBars({ symbol: sym, timeframe: '5Min', limit: 80 }),
        getStockBars({ symbol: sym, timeframe: '1Min', limit: 60 }),
        getStockBars({ symbol: sym, timeframe: '1Day', limit: 30 }),
        getLatestQuote(sym),
      ]);
      bars5m = alpacaBarsToOhlcv(b5);
      bars1m = alpacaBarsToOhlcv(b1);
      barsDaily = alpacaBarsToOhlcv(bd);
      if (lq) {
        bid = lq.bid_price;
        ask = lq.ask_price;
        quoteTs = new Date(lq.timestamp).getTime();
      }
    } catch (e) {
      console.warn('Alpaca bars unavailable', e);
    }
  }

  // Finnhub candle fallback for daily ATR
  if (barsDaily.length < 15) {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 40 * 86400;
    const candles = await finnhubGet<{
      c?: number[];
      h?: number[];
      l?: number[];
      o?: number[];
      v?: number[];
      t?: number[];
      s?: string;
    }>(`/stock/candle?symbol=${sym}&resolution=D&from=${from}&to=${to}`);
    if (candles?.s === 'ok' && candles.c) {
      barsDaily = (candles.t || []).map((t, i) => ({
        t: t * 1000,
        o: candles.o![i],
        h: candles.h![i],
        l: candles.l![i],
        c: candles.c![i],
        v: candles.v?.[i] ?? 0,
      }));
    }
  }

  const last = fhQuote?.c;
  if (!last) throw new Error(`No quote for ${sym}`);

  const stockChangePct =
    fhQuote.pc && fhQuote.pc > 0 ? ((last - fhQuote.pc) / fhQuote.pc) * 100 : undefined;

  const pricing = buildPricingSnapshot({
    symbol: sym,
    quote: {
      last,
      bid,
      ask,
      quoteTs,
      dayHigh: fhQuote.h,
      dayLow: fhQuote.l,
      prevClose: fhQuote.pc,
    },
    bars1m,
    bars5m,
    barsDaily,
    relative: {
      stockChangePct,
      spyChangePct: spyQuote?.dp,
    },
    event: {
      hasCatalyst: mediaCount > 0,
      eventPremiumMultiplier: mediaCount >= 3 ? 1.2 : mediaCount > 0 ? 1.1 : 1,
      headlineCount: mediaCount,
    },
  });

  const doc = await PricingSnapshot.create(pricing);
  return { pricing, id: String(doc._id) };
}

export async function analyzeSymbolForUser(params: {
  userId: string;
  symbol: string;
  company?: string;
  email?: string;
  createProposal?: boolean;
  notify?: boolean;
}) {
  await connectToDatabase();
  const sym = params.symbol.toUpperCase();
  const createProposal = params.createProposal !== false;

  const media = await ingestMediaForSymbol(sym, params.company);
  const { pricing, id: pricingId } = await buildAndStorePricing(sym, media.length);

  const latestReview = await MarketReview.findOne().sort({ asOf: -1 }).lean();
  const mediaSummaries = media.map(
    (m: { title: string; url: string; excerpt?: string; body?: string }) =>
      `${m.title}\n${m.url}\n${(m.excerpt || m.body || '').slice(0, 500)}`
  );

  const { draft, raw, clamped } = await generateAnalysisReport({
    symbol: sym,
    pricing,
    quoteSummary: `last=${pricing.last} vwap=${pricing.vwap} atr=${pricing.atr14} regime=${pricing.regime}`,
    mediaSummaries,
    marketReviewSummary: latestReview?.summary,
  });

  const report = await AnalysisReport.create({
    userId: params.userId,
    symbol: sym,
    asOf: new Date(),
    action: clamped.action,
    score: draft.score,
    trend: draft.trend,
    summary: draft.summary,
    catalysts: draft.catalysts,
    risks: draft.risks,
    checklist: draft.checklist,
    bias: draft.bias,
    confidence: draft.confidence,
    evidenceUrls: [
      ...draft.evidenceUrls,
      ...media.map((m: { url: string }) => m.url),
    ].slice(0, 20),
    strategyLenses: draft.strategyLenses,
    pricingSnapshotId: pricingId,
    marketReviewId: latestReview?._id?.toString(),
    rawModelText: raw.slice(0, 20_000),
  });

  let proposal = null;
  if (createProposal && clamped.action !== 'watch') {
    const guards = await checkProposalCreationGuards({ userId: params.userId, symbol: sym });
    if (guards.ok) {
      const risk = Math.abs(clamped.entry - clamped.stop) || 1;
      const reward = Math.abs(clamped.target - clamped.entry);
      const settings = await getOrCreateTradingSettings(params.userId);
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
      proposal = await TradeProposal.create({
        userId: params.userId,
        symbol: sym,
        side: clamped.side,
        qty: 1,
        entry: clamped.entry,
        stop: clamped.stop,
        target: clamped.target,
        targets: pricing.targets,
        maxSlippageBps: pricing.maxSlippageBps,
        orderType: pricing.microstructure?.blockMarketOrders ? 'limit' : 'limit',
        rationale: draft.rationale || draft.summary,
        status: 'proposed',
        pricingSnapshotId: pricingId,
        analysisReportId: String(report._id),
        expiresAt,
        paper: settings.paperTrading !== false && (process.env.ALPACA_MODE || 'paper') !== 'live',
        riskNotes: draft.risks.slice(0, 5),
        rMultiple: reward / risk,
      });

      await OrderAudit.create({
        userId: params.userId,
        proposalId: String(proposal._id),
        symbol: sym,
        event: 'proposal_created',
        paper: proposal.paper,
        detail: `${clamped.side} ${sym} @ ${clamped.entry}`,
      });

      if (params.notify !== false) {
        await notifyProposalNeedsApproval({
          email: params.email,
          symbol: sym,
          side: clamped.side,
          entry: clamped.entry,
          stop: clamped.stop,
          target: clamped.target,
          score: draft.score,
          action: clamped.action,
          rationale: draft.rationale || draft.summary,
          proposalId: String(proposal._id),
          paper: proposal.paper,
          telegramChatId: settings.telegramChatId,
          discordWebhookUrl: settings.discordWebhookUrl,
          notifyEmail: settings.notifyEmail,
          notifyTelegram: settings.notifyTelegram,
          notifyDiscord: settings.notifyDiscord,
        });
      }
    }
  }

  return {
    pricing,
    pricingId,
    report: JSON.parse(JSON.stringify(report)),
    proposal: proposal ? JSON.parse(JSON.stringify(proposal)) : null,
  };
}

/** Authenticated helper for UI refresh. */
export async function refreshAnalysisAction(symbol: string, company?: string) {
  const session = await getSession();
  if (!session?.user?.id) throw new Error('Unauthorized');
  return analyzeSymbolForUser({
    userId: session.user.id,
    symbol,
    company,
    email: session.user.email,
    createProposal: true,
    notify: true,
  });
}

export async function getBotDashboardData(userId: string) {
  await connectToDatabase();
  const [reports, proposals, review, settings] = await Promise.all([
    AnalysisReport.find({ userId }).sort({ asOf: -1 }).limit(40).lean(),
    TradeProposal.find({ userId }).sort({ createdAt: -1 }).limit(40).lean(),
    MarketReview.findOne().sort({ asOf: -1 }).lean(),
    getOrCreateTradingSettings(userId),
  ]);

  // Latest report per symbol
  const latestBySymbol = new Map<string, (typeof reports)[0]>();
  for (const r of reports) {
    if (!latestBySymbol.has(r.symbol)) latestBySymbol.set(r.symbol, r);
  }

  return {
    reports: Array.from(latestBySymbol.values()),
    allReports: reports,
    proposals,
    pending: proposals.filter((p) => p.status === 'proposed'),
    review,
    settings: JSON.parse(JSON.stringify(settings)),
  };
}
