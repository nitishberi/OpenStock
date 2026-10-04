/**
 * Multi-source news discovery (DSA-style): Tavily primary, Brave/SerpAPI fallback.
 * Full page bodies are fetched by the Scrapling worker — not here.
 */

export type DiscoveryProvider = 'tavily' | 'brave' | 'serpapi';

export interface DiscoveredArticle {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  publishedAt?: string;
  score?: number;
  provider: DiscoveryProvider;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

async function discoverTavily(query: string, max = 8): Promise<DiscoveredArticle[]> {
  const key = process.env.TAVILY_API_KEY || process.env.TAVILY_API_KEYS?.split(',')[0]?.trim();
  if (!key) return [];
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
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r: { title?: string; url?: string; content?: string; score?: number }) => ({
    title: r.title || 'Untitled',
    url: r.url || '',
    snippet: r.content,
    source: domainOf(r.url || ''),
    score: r.score,
    provider: 'tavily' as const,
  })).filter((a: DiscoveredArticle) => a.url);
}

async function discoverBrave(query: string, max = 8): Promise<DiscoveredArticle[]> {
  const key = process.env.BRAVE_API_KEY || process.env.BRAVE_API_KEYS?.split(',')[0]?.trim();
  if (!key) return [];
  const sp = new URLSearchParams({ q: query, count: String(max) });
  const res = await fetch(`https://api.search.brave.com/res/v1/news/search?${sp}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r: { title?: string; url?: string; description?: string; age?: string }) => ({
    title: r.title || 'Untitled',
    url: r.url || '',
    snippet: r.description,
    source: domainOf(r.url || ''),
    publishedAt: r.age,
    provider: 'brave' as const,
  })).filter((a: DiscoveredArticle) => a.url);
}

async function discoverSerpApi(query: string, max = 8): Promise<DiscoveredArticle[]> {
  const key = process.env.SERPAPI_API_KEY || process.env.SERPAPI_API_KEYS?.split(',')[0]?.trim();
  if (!key) return [];
  const sp = new URLSearchParams({
    engine: 'google_news',
    q: query,
    api_key: key,
    num: String(max),
  });
  const res = await fetch(`https://serpapi.com/search.json?${sp}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = await res.json();
  return (data.news_results || []).slice(0, max).map((r: { title?: string; link?: string; snippet?: string; source?: string; date?: string }) => ({
    title: r.title || 'Untitled',
    url: r.link || '',
    snippet: r.snippet,
    source: r.source || domainOf(r.link || ''),
    publishedAt: r.date,
    provider: 'serpapi' as const,
  })).filter((a: DiscoveredArticle) => a.url);
}

export function isNewsDiscoveryConfigured(): boolean {
  return Boolean(
    process.env.TAVILY_API_KEY ||
      process.env.TAVILY_API_KEYS ||
      process.env.BRAVE_API_KEY ||
      process.env.BRAVE_API_KEYS ||
      process.env.SERPAPI_API_KEY ||
      process.env.SERPAPI_API_KEYS
  );
}

/** Discover news URLs for a symbol; tries Tavily → Brave → SerpAPI until results exist. */
export async function discoverNewsForSymbol(
  symbol: string,
  opts?: { company?: string; max?: number }
): Promise<DiscoveredArticle[]> {
  const max = opts?.max ?? 8;
  const company = opts?.company ? ` ${opts.company}` : '';
  const query = `${symbol}${company} stock news earnings`;

  const providers: Array<() => Promise<DiscoveredArticle[]>> = [
    () => discoverTavily(query, max),
    () => discoverBrave(query, max),
    () => discoverSerpApi(query, max),
  ];

  const seen = new Set<string>();
  const out: DiscoveredArticle[] = [];

  for (const run of providers) {
    try {
      const batch = await run();
      for (const a of batch) {
        const key = a.url.split('#')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a);
      }
      if (out.length >= max) break;
    } catch (e) {
      console.warn('News discovery provider failed:', e);
    }
  }

  return out.slice(0, max);
}
