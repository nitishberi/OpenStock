/**
 * Social discovery: Tavily discussion queries + public RSS (no login walls).
 * Bodies are fetched later via Scrapling on allowlisted public URLs only.
 */

import type { DiscoveredArticle } from '@/lib/news/discover';

/** Public discussion / finance domains safe for Scrapling (no credential bypass). */
export const SOCIAL_PUBLIC_ALLOWLIST = [
  'reddit.com',
  'stocktwits.com',
  'seekingalpha.com',
  'benzinga.com',
  'fool.com',
  'finance.yahoo.com',
  'marketwatch.com',
  'cnbc.com',
  'investing.com',
  'thestreet.com',
  'barrons.com',
  'nasdaq.com',
];

/** Domains / path patterns that commonly require login — skip entirely. */
const LOGIN_WALL_HOSTS = new Set([
  'x.com',
  'twitter.com',
  'mobile.twitter.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
]);

const LOGIN_PATH_RE = /\/(login|signin|sign-in|signup|register|auth)\b/i;

/** Public subreddit / market RSS feeds (no auth). */
export const SOCIAL_RSS_FEEDS: Array<{ name: string; url: string }> = [
  { name: 'r/stocks', url: 'https://www.reddit.com/r/stocks/.rss' },
  { name: 'r/investing', url: 'https://www.reddit.com/r/investing/.rss' },
  { name: 'r/StockMarket', url: 'https://www.reddit.com/r/StockMarket/.rss' },
  { name: 'r/wallstreetbets', url: 'https://www.reddit.com/r/wallstreetbets/.rss' },
];

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'unknown';
  }
}

export function isLoginWalledUrl(url: string): boolean {
  const host = domainOf(url);
  if (LOGIN_WALL_HOSTS.has(host)) return true;
  try {
    const path = new URL(url).pathname || '';
    return LOGIN_PATH_RE.test(path);
  } catch {
    return true;
  }
}

export function isPublicSocialUrl(url: string): boolean {
  if (!url || isLoginWalledUrl(url)) return false;
  const host = domainOf(url);
  return SOCIAL_PUBLIC_ALLOWLIST.some((d) => host === d || host.endsWith('.' + d));
}

function tickerMention(text: string, symbol: string): boolean {
  const sym = symbol.toUpperCase();
  const word = new RegExp(`\\b${sym}\\b`, 'i');
  const dollar = new RegExp(`\\$${sym}\\b`, 'i');
  return dollar.test(text) || word.test(text);
}

async function discoverSocialTavily(symbol: string, max = 8): Promise<DiscoveredArticle[]> {
  const key = process.env.TAVILY_API_KEY || process.env.TAVILY_API_KEYS?.split(',')[0]?.trim();
  if (!key) return [];

  const queries = [
    `${symbol} stock (site:reddit.com OR site:stocktwits.com) discussion`,
    `"$${symbol}" OR ${symbol} stock discussion OR wallstreetbets OR stocktwits`,
  ];

  const seen = new Set<string>();
  const out: DiscoveredArticle[] = [];

  for (const query of queries) {
    if (out.length >= max) break;
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          query,
          search_depth: 'basic',
          include_answer: false,
          max_results: Math.min(8, max),
          topic: 'general',
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of (data.results || []) as Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
      }>) {
        const url = r.url || '';
        if (!url || seen.has(url) || !isPublicSocialUrl(url)) continue;
        seen.add(url);
        out.push({
          title: r.title || `${symbol} discussion`,
          url,
          snippet: r.content,
          source: domainOf(url),
          score: r.score,
          provider: 'tavily',
        });
        if (out.length >= max) break;
      }
    } catch (e) {
      console.warn('social Tavily discovery failed', e);
    }
  }

  return out;
}

/** Lightweight public RSS parse — titles/links only; no login. */
async function discoverSocialRss(symbol: string, max = 6): Promise<DiscoveredArticle[]> {
  const sym = symbol.toUpperCase();
  const out: DiscoveredArticle[] = [];
  const seen = new Set<string>();

  for (const feed of SOCIAL_RSS_FEEDS) {
    if (out.length >= max) break;
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'AutoDayTraderBot/0.1 (+research; public RSS)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      // Prefer <entry> (Atom, Reddit) then <item> (RSS)
      const chunks =
        xml.match(/<entry[\s\S]*?<\/entry>/gi) ||
        xml.match(/<item[\s\S]*?<\/item>/gi) ||
        [];
      for (const chunk of chunks) {
        const title =
          chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ||
          '';
        const linkHref =
          chunk.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ||
          chunk.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim() ||
          '';
        const summary =
          chunk.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i)?.[1] ||
          chunk.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i)?.[1] ||
          chunk.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] ||
          '';
        const plain = `${title} ${summary}`.replace(/<[^>]+>/g, ' ');
        if (!tickerMention(plain, sym)) continue;
        const url = linkHref.trim();
        if (!url.startsWith('http') || seen.has(url) || !isPublicSocialUrl(url)) continue;
        seen.add(url);
        out.push({
          title: title.replace(/<[^>]+>/g, '').slice(0, 300) || `${sym} social`,
          url,
          snippet: plain.replace(/\s+/g, ' ').trim().slice(0, 400),
          source: domainOf(url),
          provider: 'rss',
        });
        if (out.length >= max) break;
      }
    } catch (e) {
      console.warn('social RSS failed', feed.name, e);
    }
  }

  return out;
}

/**
 * Discover public social discussion URLs for a symbol.
 * Does not scrape login walls; Scrapling fetch is a separate step.
 */
export async function discoverSocialForSymbol(
  symbol: string,
  opts?: { max?: number }
): Promise<DiscoveredArticle[]> {
  const max = opts?.max ?? 8;
  const sym = symbol.toUpperCase();
  const seen = new Set<string>();
  const out: DiscoveredArticle[] = [];

  const batches = await Promise.all([
    discoverSocialTavily(sym, max),
    discoverSocialRss(sym, Math.min(6, max)),
  ]);

  for (const batch of batches) {
    for (const a of batch) {
      const key = a.url.split('#')[0];
      if (seen.has(key) || !isPublicSocialUrl(a.url)) continue;
      seen.add(key);
      out.push(a);
      if (out.length >= max) return out;
    }
  }

  return out;
}
