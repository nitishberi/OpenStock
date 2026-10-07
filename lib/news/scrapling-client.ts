/**
 * Client for the Scrapling Python worker.
 */

export interface ScraplingMediaDoc {
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
  tags?: string[];
}

function workerBase(): string {
  return (process.env.SCRAPLING_WORKER_URL || 'http://localhost:8091').replace(/\/$/, '');
}

function workerHeaders(): HeadersInit {
  const token = process.env.SCRAPLING_WORKER_TOKEN;
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) {
    (h as Record<string, string>)['X-Worker-Token'] = token;
    (h as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  return h;
}

export function isScraplingConfigured(): boolean {
  return Boolean(process.env.SCRAPLING_WORKER_URL);
}

export async function scraplingHealth(): Promise<{ ok: boolean; detail?: unknown }> {
  try {
    const res = await fetch(`${workerBase()}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { ok: false };
    return { ok: true, detail: await res.json() };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

export async function ingestArticlesWithScrapling(params: {
  symbol: string;
  company?: string;
  articles: Array<{
    title: string;
    url: string;
    snippet?: string;
    provider?: string;
    score?: number;
    publishedAt?: string;
  }>;
}): Promise<ScraplingMediaDoc[]> {
  const res = await fetch(`${workerBase()}/ingest`, {
    method: 'POST',
    headers: workerHeaders(),
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Scrapling ingest failed ${res.status}: ${text}`);
  }
  return (await res.json()) as ScraplingMediaDoc[];
}

export interface OpenInsiderScanResult {
  ok: boolean;
  count: number;
  meta?: unknown[];
  persist?: unknown;
  filings: Array<Record<string, unknown>>;
}

/** Scrape OpenInsider cluster / $25k lists (and optional tickers) via Scrapling worker. */
export async function scrapeOpenInsiderLists(opts?: {
  lists?: Array<'cluster-buys' | 'purchases-25k'>;
  tickers?: string[];
  persist?: boolean;
  force?: boolean;
}): Promise<OpenInsiderScanResult> {
  const res = await fetch(`${workerBase()}/openinsider/scan`, {
    method: 'POST',
    headers: workerHeaders(),
    body: JSON.stringify({
      lists: opts?.lists ?? ['cluster-buys', 'purchases-25k'],
      tickers: opts?.tickers ?? [],
      persist: opts?.persist ?? true,
      force: opts?.force ?? false,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenInsider scan failed ${res.status}: ${text}`);
  }
  return (await res.json()) as OpenInsiderScanResult;
}

export async function scrapeOpenInsiderTicker(
  ticker: string,
  opts?: { persist?: boolean }
): Promise<OpenInsiderScanResult> {
  return scrapeOpenInsiderLists({
    lists: [],
    tickers: [ticker.toUpperCase()],
    persist: opts?.persist ?? true,
    force: true,
  });
}
