/**
 * Offline walk-forward strategy test on the 100-stock universe.
 *
 * Usage:
 *   npx tsx scripts/strategy-test-swing.ts [--smoke] [--limit=10] [--window=60]
 *
 * Requires Finnhub keys in env (or project secrets). Does not place orders.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const windowArg = args.find((a) => a.startsWith('--window='));
  const symbolLimit = limitArg ? Number(limitArg.split('=')[1]) : smoke ? 5 : 100;
  const windowDays = windowArg ? Number(windowArg.split('=')[1]) : smoke ? 40 : 120;

  const { createSwingBaselineV1, runStrategyTest, computeFactorAttribution, trainFromRows, nextModelVersion } =
    await import('../lib/forecast');

  const weights = createSwingBaselineV1();
  console.log(`Running strategy test model=${weights.version} symbols=${symbolLimit} window=${windowDays}`);

  const result = await runStrategyTest({
    weights,
    symbolLimit,
    windowDays,
    liveMedia: false,
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
