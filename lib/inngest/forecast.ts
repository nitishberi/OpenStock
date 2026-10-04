import { inngest } from '@/lib/inngest/client';

/**
 * Post-close: forecast watchlists D1–D5 and resolve due forecasts.
 * Weekly Sunday: full strategy test + attribution + train candidate.
 */

export const forecastPostClose = inngest.createFunction(
  {
    id: 'forecast-post-close',
    concurrency: 1,
    triggers: [{ cron: '20 21 * * 1-5' }, { event: 'app/forecast.postClose' }],
  },
  async ({ step }) => {
    const resolved = await step.run('resolve-due', async () => {
      const { resolveDueForecastsAction } = await import('@/lib/actions/forecast.actions');
      return resolveDueForecastsAction();
    });

    // Seed active weights if missing; live watchlist forecasts happen via UI / optional event
    const version = await step.run('ensure-weights', async () => {
      const { getActiveModelVersionAction } = await import('@/lib/actions/forecast.actions');
      const v = await getActiveModelVersionAction();
      return v.version;
    });

    return { resolved, modelVersion: version };
  }
);

export const forecastStrategyTestWeekly = inngest.createFunction(
  {
    id: 'forecast-strategy-test-weekly',
    concurrency: 1,
    triggers: [{ cron: '0 14 * * 0' }, { event: 'app/forecast.strategyTest' }],
  },
  async ({ step, event }) => {
    const symbolLimit = (event as { data?: { symbolLimit?: number } })?.data?.symbolLimit;

    const test = await step.run('strategy-test', async () => {
      // Bypass session gate for cron by calling core runner directly
      const { ensureCronStrategyTest } = await import('@/lib/forecast/cron-runner');
      return ensureCronStrategyTest({ symbolLimit });
    });

    const train = await step.run('train-holdout', async () => {
      const { ensureCronTrain } = await import('@/lib/forecast/cron-runner');
      return ensureCronTrain(test.evalRunId);
    });

    return { test, train };
  }
);
