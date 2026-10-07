import { inngest } from '@/lib/inngest/client';

/**
 * Daily / midday OpenInsider Form 4 scan:
 * 1) Refresh cluster buys + $25k purchases via Scrapling
 * 2) Upsert InsiderFiling docs
 * 3) Refresh forecasts for watchlist / universe tickers with new material buys
 *
 * Alerts only — never places orders.
 */

const MATERIAL_USD = 25_000;

export const insiderScanDaily = inngest.createFunction(
  {
    id: 'insider-scan-daily',
    concurrency: 1,
    triggers: [
      { cron: '45 21 * * 1-5' }, // after US close (with forecast post-close)
      { event: 'app/insider.scan' },
    ],
  },
  async ({ step }) => {
    const scan = await step.run('scrape-openinsider-lists', async () => {
      const { isScraplingConfigured, scrapeOpenInsiderLists } = await import(
        '@/lib/news/scrapling-client'
      );
      if (!isScraplingConfigured()) {
        return {
          ok: false,
          skipped: true,
          reason: 'SCRAPLING_WORKER_URL unset',
          count: 0,
        };
      }
      const result = await scrapeOpenInsiderLists({
        lists: ['cluster-buys', 'purchases-25k'],
        persist: true,
        force: true,
      });
      return {
        ok: result.ok,
        skipped: false,
        count: result.count,
        persist: result.persist,
        meta: result.meta,
      };
    });

    const material = await step.run('diff-material-buys', async () => diffMaterialBuys());

    let refreshed: { symbols: string[]; forecastCount: number } = {
      symbols: [],
      forecastCount: 0,
    };
    if (material.tickers.length) {
      refreshed = await step.run('refresh-forecasts', async () =>
        refreshForecastsForTickers(material.tickers)
      );
    }

    return { scan, material, refreshed };
  }
);

export const insiderScanMidday = inngest.createFunction(
  {
    id: 'insider-scan-midday',
    concurrency: 1,
    triggers: [{ cron: '0 17 * * 1-5' }, { event: 'app/insider.scanMidday' }],
  },
  async ({ step }) => {
    const scan = await step.run('scrape-openinsider-lists', async () => {
      const { isScraplingConfigured, scrapeOpenInsiderLists } = await import(
        '@/lib/news/scrapling-client'
      );
      if (!isScraplingConfigured()) {
        return {
          ok: false,
          skipped: true,
          reason: 'SCRAPLING_WORKER_URL unset',
          count: 0,
        };
      }
      const result = await scrapeOpenInsiderLists({
        lists: ['cluster-buys', 'purchases-25k'],
        persist: true,
        force: false,
      });
      return {
        ok: result.ok,
        skipped: false,
        count: result.count,
        persist: result.persist,
        meta: result.meta,
      };
    });

    const material = await step.run('diff-material-buys', async () => diffMaterialBuys());

    let refreshed: { symbols: string[]; forecastCount: number } = {
      symbols: [],
      forecastCount: 0,
    };
    if (material.tickers.length) {
      refreshed = await step.run('refresh-forecasts', async () =>
        refreshForecastsForTickers(material.tickers)
      );
    }

    return { scan, material, refreshed };
  }
);

async function diffMaterialBuys() {
  const { connectToDatabase } = await import('@/database/mongoose');
  const { InsiderFiling } = await import('@/database/models/insider-filing.model');
  await connectToDatabase();
  const since = new Date(Date.now() - 36 * 3600_000);
  const rows = await InsiderFiling.find({
    tradeType: 'P',
    ingestedAt: { $gte: since },
    $or: [
      { valueUsd: { $gte: MATERIAL_USD } },
      { 'flags.cluster': true },
      { sourceList: 'cluster-buys' },
    ],
  })
    .sort({ ingestedAt: -1 })
    .limit(200)
    .lean();

  const byTicker = new Map<string, number>();
  for (const r of rows) {
    byTicker.set(r.ticker, (byTicker.get(r.ticker) || 0) + 1);
  }
  return {
    filingCount: rows.length,
    tickers: [...byTicker.keys()],
    sample: rows.slice(0, 10).map((r) => ({
      ticker: r.ticker,
      valueUsd: r.valueUsd,
      insiderName: r.insiderName,
      filingDate: r.filingDate,
      sourceList: r.sourceList,
    })),
  };
}

async function refreshForecastsForTickers(tickers: string[]) {
  const { getForecastUniverse } = await import('@/lib/forecast/universe');
  const universe = new Set(getForecastUniverse().symbols.map((s) => s.symbol));
  const targets = tickers.filter((t) => universe.has(t)).slice(0, 20);
  if (!targets.length) return { symbols: [] as string[], forecastCount: 0 };

  const { runWatchlistForecastsForCron } = await import('@/lib/forecast/cron-runner');
  const res = await runWatchlistForecastsForCron(targets);
  return { symbols: targets, forecastCount: res.forecastCount };
}
