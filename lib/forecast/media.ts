/**
 * Triple media intake: news (Tavily+Scrapling), social (Tavily/RSS → Scrapling → VADER),
 * press (discover/classify). No Adanos / paid social APIs. No login-wall scrapes.
 * Each channel writes normalized MediaDocuments and contributes FeatureSnapshot fields.
 */

import { discoverNewsForSymbol, type DiscoveredArticle } from '@/lib/news/discover';
import { ingestArticlesWithScrapling, isScraplingConfigured } from '@/lib/news/scrapling-client';
import {
  emptyNewsFeatures,
  emptyPressFeatures,
  emptySocialFeatures,
  pressEventScore,
} from './features';
import { bullBearSkew, scorePolarity } from './sentiment';
import { discoverSocialForSymbol, isPublicSocialUrl } from './social-discover';
import type { MediaChannel, NewsFeatures, PressEventType, PressFeatures, SocialFeatures } from './types';

const PRESS_DOMAIN_HINTS = [
  'prnewswire.com',
  'businesswire.com',
  'globenewswire.com',
  'accesswire.com',
  'investor.',
  'ir.',
];

const PRESS_TITLE_RE =
  /\b(press release|pr newswire|business wire|announces|announced|reports (first|second|third|fourth)?\s*quarter|guidance|earnings)\b/i;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function classifyPressHeuristic(input: {
  title: string;
  url: string;
  source?: string;
}): { isPress: boolean; eventType: PressEventType } {
  const domain = domainOf(input.url);
  const blob = `${input.title} ${input.source || ''} ${domain}`;
  const domainHit = PRESS_DOMAIN_HINTS.some((d) => domain.includes(d) || blob.includes(d));
  const titleHit = PRESS_TITLE_RE.test(input.title);
  const isPress = domainHit || titleHit;

  let eventType: PressEventType = 'other';
  const title = input.title.toLowerCase();
  if (/\bearnings\b|\bquarter\b|\bq[1-4]\b|\beps\b/.test(title)) eventType = 'earnings';
  else if (/\bguidance\b|\boutlook\b|\bforecast\b/.test(title)) eventType = 'guidance';
  else if (/\blaunch\b|\bproduct\b|\bunveil\b|\brelease[sd]?\b/.test(title)) eventType = 'product';
  else if (/\blawsuit\b|\bsec\b|\binvestigat|\blegal\b|\bsettle/.test(title)) eventType = 'legal';

  return { isPress, eventType: isPress ? eventType : 'none' };
}

/** Gemini assist for press vs news — falls back to heuristic on failure. */
export async function classifyPressWithGemini(input: {
  title: string;
  url: string;
  excerpt?: string;
}): Promise<{ isPress: boolean; eventType: PressEventType }> {
  const heuristic = classifyPressHeuristic(input);
  if (!process.env.GEMINI_API_KEY) return heuristic;
  try {
    const { callAIProviderWithFallback } = await import('@/lib/ai-provider');
    const text = await callAIProviderWithFallback(
      `Classify this item as company press release or general news.
Title: ${input.title}
URL: ${input.url}
Excerpt: ${(input.excerpt || '').slice(0, 400)}
Return ONLY JSON: {"isPress":boolean,"eventType":"earnings"|"product"|"guidance"|"legal"|"other"|"none"}`
    );
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return heuristic;
    const parsed = JSON.parse(m[0]) as { isPress?: boolean; eventType?: PressEventType };
    return {
      isPress: Boolean(parsed.isPress),
      eventType: parsed.eventType || (parsed.isPress ? 'other' : 'none'),
    };
  } catch {
    return heuristic;
  }
}

export async function discoverPressForSymbol(
  symbol: string,
  opts?: { company?: string; max?: number }
): Promise<DiscoveredArticle[]> {
  const max = opts?.max ?? 6;
  const company = opts?.company || symbol;
  const query = `"${company}" OR ${symbol} (press release OR "PR Newswire" OR "Business Wire")`;
  // Reuse Tavily via discoverNewsForSymbol-style query through discover module internals
  const { isNewsDiscoveryConfigured } = await import('@/lib/news/discover');
  if (!isNewsDiscoveryConfigured()) return [];

  // Direct Tavily call for PR-scoped query
  const key = process.env.TAVILY_API_KEY || process.env.TAVILY_API_KEYS?.split(',')[0]?.trim();
  if (!key) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        include_answer: false,
        max_results: max,
        topic: 'news',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .map((r: { title?: string; url?: string; content?: string; score?: number }) => ({
        title: r.title || 'Untitled',
        url: r.url || '',
        snippet: r.content,
        source: domainOf(r.url || ''),
        score: r.score,
        provider: 'tavily' as const,
      }))
      .filter((a: DiscoveredArticle) => a.url);
  } catch (e) {
    console.warn('press discovery failed', e);
    return [];
  }
}

export interface MediaIntakeResult {
  news: NewsFeatures;
  social: SocialFeatures;
  press: PressFeatures;
  evidenceUrls: string[];
  documents: Array<{
    channel: MediaChannel;
    title: string;
    url: string;
    source: string;
    sourceKind: string;
    excerpt?: string;
    domain: string;
    tags?: string[];
    score?: number;
  }>;
}

function noveltyScore(articles: DiscoveredArticle[]): number {
  if (articles.length <= 1) return articles.length ? 0.5 : 0;
  const domains = new Set(articles.map((a) => domainOf(a.url)));
  return Math.min(1, domains.size / articles.length + 0.2);
}

/**
 * Social channel (locked): Tavily + public RSS discovery → Scrapling on allowlisted
 * public URLs → local VADER (finance-lexicon blend) → socialSentiment / socialVolume /
 * socialBullBearSkew. Never uses Adanos or login-walled hosts.
 */
export async function collectSocialFeatures(
  symbol: string,
  opts?: { enrichBodies?: boolean }
): Promise<{
  features: SocialFeatures;
  evidenceUrls: string[];
  documents: MediaIntakeResult['documents'];
}> {
  const sym = symbol.toUpperCase();
  let articles: DiscoveredArticle[] = [];
  try {
    articles = await discoverSocialForSymbol(sym, { max: 8 });
  } catch (e) {
    console.warn('social discovery failed', e);
  }
  articles = articles.filter((a) => isPublicSocialUrl(a.url));

  const bodyByUrl = new Map<string, string>();
  if (opts?.enrichBodies && isScraplingConfigured() && articles.length > 0) {
    try {
      const scraped = await ingestArticlesWithScrapling({
        symbol: sym,
        articles: articles.slice(0, 6).map((a) => ({
          title: a.title,
          url: a.url,
          snippet: a.snippet,
          provider: a.provider,
          score: a.score,
        })),
      });
      for (const s of scraped) {
        if (s.body) bodyByUrl.set(s.url, s.body);
      }
    } catch (e) {
      console.warn('social scrapling enrich skipped', e);
    }
  }

  if (articles.length === 0) {
    return { features: emptySocialFeatures(), evidenceUrls: [], documents: [] };
  }

  const scores: number[] = [];
  const evidenceUrls: string[] = [];
  const documents: MediaIntakeResult['documents'] = [];

  for (const a of articles) {
    const body = bodyByUrl.get(a.url);
    const text = `${a.title} ${body?.slice(0, 2000) || a.snippet || ''}`;
    scores.push(scorePolarity(text));
    evidenceUrls.push(a.url);
    documents.push({
      channel: 'social',
      title: a.title,
      url: a.url,
      source: a.source || domainOf(a.url),
      sourceKind: a.provider,
      excerpt: body?.slice(0, 1200) || a.snippet,
      domain: domainOf(a.url),
      tags: ['social', body ? 'scrapling' : 'snippet'],
      score: a.score,
    });
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    features: {
      socialSentiment: mean,
      socialVolume: Math.min(1, articles.length / 10),
      socialBullBearSkew: bullBearSkew(scores),
      polymarketTilt: 0,
    },
    evidenceUrls: evidenceUrls.slice(0, 6),
    documents,
  };
}

/**
 * Full triple-channel intake for a symbol.
 * When `persist` is true and Mongo is available, upserts MediaDocuments.
 */
export async function collectMediaFeatures(
  symbol: string,
  opts?: { company?: string; persist?: boolean; enrichBodies?: boolean }
): Promise<MediaIntakeResult> {
  const sym = symbol.toUpperCase();
  const docs: MediaIntakeResult['documents'] = [];
  const evidenceUrls: string[] = [];

  // 1) News
  let newsArticles: DiscoveredArticle[] = [];
  try {
    newsArticles = await discoverNewsForSymbol(sym, { company: opts?.company, max: 8 });
  } catch (e) {
    console.warn('news discovery failed', e);
  }

  const newsBodies: string[] = [];
  const bodyByUrl = new Map<string, string>();
  if (opts?.enrichBodies && isScraplingConfigured() && newsArticles.length > 0) {
    try {
      const scraped = await ingestArticlesWithScrapling({
        symbol: sym,
        company: opts?.company,
        articles: newsArticles.slice(0, 6).map((a) => ({
          title: a.title,
          url: a.url,
          snippet: a.snippet,
          provider: a.provider,
          score: a.score,
        })),
      });
      for (const s of scraped) {
        if (s.body) bodyByUrl.set(s.url, s.body);
      }
    } catch (e) {
      console.warn('scrapling enrich skipped', e);
    }
  }

  for (const a of newsArticles) {
    const cls = classifyPressHeuristic({ title: a.title, url: a.url, source: a.source });
    if (cls.isPress) continue; // press channel owns these
    const body = bodyByUrl.get(a.url);
    const excerpt = body?.slice(0, 1200) || a.snippet;
    if (body) newsBodies.push(body.slice(0, 2000));
    else if (excerpt) newsBodies.push(excerpt);
    evidenceUrls.push(a.url);
    docs.push({
      channel: 'news',
      title: a.title,
      url: a.url,
      source: a.source || domainOf(a.url),
      sourceKind: a.provider,
      excerpt,
      domain: domainOf(a.url),
      tags: ['news'],
      score: a.score,
    });
  }

  const news: NewsFeatures =
    newsBodies.length === 0
      ? emptyNewsFeatures()
      : {
          newsCount48h: newsArticles.filter((a) => !classifyPressHeuristic(a).isPress).length,
          newsSentiment:
            newsBodies.reduce((acc, t) => acc + scorePolarity(t), 0) / newsBodies.length,
          newsNovelty: noveltyScore(newsArticles),
        };

  // 2) Social — Tavily/RSS → Scrapling → VADER (no Adanos)
  const socialPack = await collectSocialFeatures(sym, { enrichBodies: opts?.enrichBodies });
  const social = socialPack.features;
  evidenceUrls.push(...socialPack.evidenceUrls);
  docs.push(...socialPack.documents);

  // 3) Press
  let pressArticles = await discoverPressForSymbol(sym, { company: opts?.company, max: 6 });
  // Also fold press-classified news
  for (const a of newsArticles) {
    if (classifyPressHeuristic(a).isPress && !pressArticles.some((p) => p.url === a.url)) {
      pressArticles.push(a);
    }
  }

  let pressCount = 0;
  let pressSentSum = 0;
  let bestEvent: PressEventType = 'none';
  let lastPressDays = 365;

  for (const a of pressArticles) {
    const cls = await classifyPressWithGemini({
      title: a.title,
      url: a.url,
      excerpt: a.snippet,
    });
    if (!cls.isPress && !classifyPressHeuristic(a).isPress) continue;
    pressCount++;
    const sent = scorePolarity(`${a.title} ${a.snippet || ''}`);
    pressSentSum += sent;
    if (pressEventScore(cls.eventType) > pressEventScore(bestEvent)) bestEvent = cls.eventType;
    lastPressDays = Math.min(lastPressDays, 1); // discovered now → recent
    evidenceUrls.push(a.url);
    docs.push({
      channel: 'press',
      title: a.title,
      url: a.url,
      source: a.source || domainOf(a.url),
      sourceKind: a.provider,
      excerpt: a.snippet,
      domain: domainOf(a.url),
      tags: ['press', cls.eventType],
      score: a.score,
    });
  }

  const press: PressFeatures =
    pressCount === 0
      ? emptyPressFeatures()
      : {
          pressCount7d: pressCount,
          pressSentiment: pressSentSum / pressCount,
          pressEventType: bestEvent,
          pressEventScore: pressEventScore(bestEvent),
          daysSinceLastPress: Math.min(30, lastPressDays),
        };

  if (opts?.persist) {
    try {
      const { connectToDatabase } = await import('@/database/mongoose');
      const { MediaDocument } = await import('@/database/models/media-document.model');
      await connectToDatabase();
      for (const d of docs) {
        await MediaDocument.findOneAndUpdate(
          { url: d.url },
          {
            $set: {
              symbol: sym,
              title: d.title,
              url: d.url,
              source: d.source,
              sourceKind: d.sourceKind,
              excerpt: d.excerpt,
              domain: d.domain,
              score: d.score,
              tags: d.tags,
              channel: d.channel,
              fetchedAt: new Date(),
            },
          },
          { upsert: true }
        );
      }
    } catch (e) {
      console.warn('media persist skipped', e);
    }
  }

  return {
    news,
    social,
    press,
    evidenceUrls: [...new Set(evidenceUrls)].slice(0, 12),
    documents: docs,
  };
}

/** Offline / strategy-test: derive media features from already-stored docs ≤ asOf. */
export function featuresFromStoredMedia(
  docs: Array<{
    channel?: string;
    title?: string;
    excerpt?: string;
    body?: string;
    publishedAt?: Date | string;
    fetchedAt?: Date | string;
    url?: string;
  }>,
  asOfIso: string
): { news: NewsFeatures; social: SocialFeatures; press: PressFeatures; evidenceUrls: string[] } {
  const asOf = new Date(`${asOfIso}T23:59:59.000Z`).getTime();
  const newsDocs = docs.filter((d) => (d.channel || 'news') === 'news');
  const socialDocs = docs.filter((d) => d.channel === 'social');
  const pressDocs = docs.filter((d) => d.channel === 'press');

  const inWindow = (d: (typeof docs)[0], days: number) => {
    const t = new Date(d.publishedAt || d.fetchedAt || 0).getTime();
    return t > 0 && t <= asOf && asOf - t <= days * 86_400_000;
  };

  const n48 = newsDocs.filter((d) => inWindow(d, 2));
  const news: NewsFeatures =
    n48.length === 0
      ? emptyNewsFeatures()
      : {
          newsCount48h: n48.length,
          newsSentiment:
            n48.reduce((a, d) => a + scorePolarity(`${d.title || ''} ${d.excerpt || d.body || ''}`), 0) /
            n48.length,
          newsNovelty: Math.min(1, new Set(n48.map((d) => domainOf(d.url || ''))).size / n48.length + 0.2),
        };

  const s7 = socialDocs.filter((d) => inWindow(d, 7));
  const socialScores = s7.map((d) => scorePolarity(`${d.title || ''} ${d.excerpt || d.body || ''}`));
  const social: SocialFeatures =
    s7.length === 0
      ? emptySocialFeatures()
      : {
          socialSentiment: socialScores.reduce((a, b) => a + b, 0) / socialScores.length,
          socialVolume: Math.min(1, s7.length / 10),
          socialBullBearSkew: bullBearSkew(socialScores),
          polymarketTilt: 0,
        };

  const p7 = pressDocs.filter((d) => inWindow(d, 7));
  let best: PressEventType = 'none';
  for (const d of p7) {
    const cls = classifyPressHeuristic({ title: d.title || '', url: d.url || '' });
    if (pressEventScore(cls.eventType) > pressEventScore(best)) best = cls.eventType;
  }
  const press: PressFeatures =
    p7.length === 0
      ? emptyPressFeatures()
      : {
          pressCount7d: p7.length,
          pressSentiment:
            p7.reduce((a, d) => a + scorePolarity(`${d.title || ''} ${d.excerpt || ''}`), 0) / p7.length,
          pressEventType: best,
          pressEventScore: pressEventScore(best),
          daysSinceLastPress: 1,
        };

  return {
    news,
    social,
    press,
    evidenceUrls: [...n48, ...s7, ...p7].map((d) => d.url || '').filter(Boolean).slice(0, 12),
  };
}
