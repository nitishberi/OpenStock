/**
 * Offline walk-forward strategy test on the 100-stock universe.
 *
 * Usage:
 *   npx tsx scripts/strategy-test-swing.ts [--smoke] [--live-media] [--limit=10] [--window=60]
 *
 * Requires Finnhub keys in env (or project secrets). Does not place orders.
 * `--live-media` fetches news/social/press (Tavily/RSS → optional Scrapling → VADER)
 * for the latest asOf per symbol so Lab channel attribution can be non-zero.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const liveMedia = args.includes('--live-media');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const windowArg = args.find((a) => a.startsWith('--window='));
  const symbolLimit = limitArg ? Number(limitArg.split('=')[1]) : smoke ? 5 : 100;
  const windowDays = windowArg ? Number(windowArg.split('=')[1]) : smoke ? 40 : 120;

  const { createSwingBaselineV1, runStrategyTest, computeFactorAttribution, trainFromRows, nextModelVersion } =
    await import('../lib/forecast');

  const weights = createSwingBaselineV1();
  console.log(
    `Running strategy test model=${weights.version} symbols=${symbolLimit} window=${windowDays} liveMedia=${liveMedia}`
  );

  const result = await runStrategyTest({
    weights,
    symbolLimit,
    windowDays,
    liveMedia,
    delayMs: 400,
    onProgress: (m) => console.log(m),
  });

  console.log(JSON.stringify(result.summary, null, 2));

  const attr = computeFactorAttribution({
    rows: result.rows,
    weights,
    evalRunId: 'cli',
  });
  console.log('Top factors:', attr.factors.slice(0, 8));
  console.log('Channels:', attr.channelSummary);

  if (liveMedia) {
    const mediaRows = result.rows.filter(
      (r) =>
        r.features.newsCount48h > 0 ||
        r.features.socialVolume > 0 ||
        r.features.pressCount7d > 0 ||
        r.features.newsSentiment !== 0 ||
        r.features.socialSentiment !== 0 ||
        r.features.pressSentiment !== 0
    );
    const bySym = new Map<string, (typeof result.rows)[0]['features']>();
    for (const r of mediaRows) {
      if (!bySym.has(r.symbol)) bySym.set(r.symbol, r.features);
    }
    console.log(
      'Live media feature snapshot (one asOf per symbol with non-zero media):',
      Object.fromEntries(
        [...bySym.entries()].map(([sym, f]) => [
          sym,
          {
            newsCount48h: f.newsCount48h,
            newsSentiment: Number(f.newsSentiment.toFixed(4)),
            socialVolume: f.socialVolume,
            socialSentiment: Number(f.socialSentiment.toFixed(4)),
            pressCount7d: f.pressCount7d,
            pressSentiment: Number(f.pressSentiment.toFixed(4)),
            pressEventScore: f.pressEventScore,
          },
        ])
      )
    );
    console.log(`Rows with non-zero media features: ${mediaRows.length}/${result.rows.length}`);
  }

  const trained = trainFromRows({
    rows: result.trainRows,
    parent: weights,
    holdoutAsOfs: new Set(result.holdoutAsOfs),
    nextVersion: nextModelVersion(weights.version),
  });
  console.log('Train gate:', {
    promoted: trained.promoted,
    version: trained.candidate.version,
    reason: trained.reason,
    holdout: trained.holdoutMetrics,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
