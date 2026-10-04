import { inngest } from '@/lib/inngest/client';
import { isUsEquitySessionOpen } from '@/lib/trading/market-hours';

/**
 * Market-hours day-trader loop:
 * market review → watchlist intake → price → analyze → propose → notify
 * NEVER submits Alpaca orders — only creates proposals for user Approve/Reject.
 */
export const dayTraderMarketLoop = inngest.createFunction(
  {
    id: 'daytrader-market-loop',
    concurrency: 1,
    triggers: [{ cron: '*/15 * * * 1-5' }, { event: 'app/daytrader.run' }],
  },
  async ({ step, event }) => {
    const force = Boolean((event as { data?: { force?: boolean } })?.data?.force);
    const open = await step.run('check-market-hours', async () => isUsEquitySessionOpen());
    if (!open && !force) {
      return { skipped: true, reason: 'US equity session closed (use force for manual runs)' };
    }

    const review = await step.run('market-review', async () => {
      const { runMarketReview } = await import('@/lib/actions/daytrader.actions');
      const hour = new Date().getUTCHours();
      const session = hour < 14 ? 'pre_open' : hour >= 20 ? 'post_close' : 'intraday';
      return runMarketReview(session);
    });

    const watchSymbols = await step.run('load-watchlists', async () => {
      const { connectToDatabase } = await import('@/database/mongoose');
      const { Watchlist } = await import('@/database/models/watchlist.model');
      await connectToDatabase();
      const rows = await Watchlist.find({}).limit(200).lean();
      // Group by user
      const byUser = new Map<string, { symbol: string; company: string }[]>();
      for (const r of rows) {
        const list = byUser.get(r.userId) || [];
        list.push({ symbol: r.symbol, company: r.company });
        byUser.set(r.userId, list);
      }
      return Array.from(byUser.entries()).map(([userId, symbols]) => ({ userId, symbols }));
    });

    const userEmails = await step.run('load-user-emails', async () => {
      const { connectToDatabase } = await import('@/database/mongoose');
      const mongoose = await connectToDatabase();
      const db = mongoose.connection.db;
      if (!db) return {} as Record<string, string>;
      const ids = watchSymbols.map((w) => w.userId);
      const map: Record<string, string> = {};
      for (const id of ids) {
        const user = await db.collection('user').findOne(
          mongoose.isValidObjectId(id)
            ? { $or: [{ id }, { _id: new mongoose.Types.ObjectId(id) }] }
            : { id },
          { projection: { email: 1, id: 1 } }
        );
        if (user?.email) map[id] = user.email as string;
      }
      return map;
    });

    const results: Array<{ userId: string; symbol: string; action?: string; proposal?: boolean }> = [];

    for (const { userId, symbols } of watchSymbols) {
      // Cap per run
      for (const { symbol, company } of symbols.slice(0, 8)) {
        const outcome = await step.run(`analyze-${userId}-${symbol}`, async () => {
          const { analyzeSymbolForUser } = await import('@/lib/actions/daytrader.actions');
          try {
            const res = await analyzeSymbolForUser({
              userId,
              symbol,
              company,
              email: userEmails[userId],
              createProposal: true,
              notify: true,
            });
            return {
              userId,
              symbol,
              action: res.report?.action,
              proposal: Boolean(res.proposal),
            };
          } catch (e) {
            console.error(`Daytrader analyze failed ${symbol}`, e);
            return { userId, symbol, action: 'error', proposal: false };
          }
        });
        results.push(outcome);
      }
    }

    // Expire stale proposals
    await step.run('expire-proposals', async () => {
      const { connectToDatabase } = await import('@/database/mongoose');
      const { TradeProposal } = await import('@/database/models/trade-proposal.model');
      await connectToDatabase();
      await TradeProposal.updateMany(
        { status: 'proposed', expiresAt: { $lt: new Date() } },
        { $set: { status: 'expired' } }
      );
    });

    return {
      reviewId: review?._id,
      analyzed: results.length,
      proposals: results.filter((r) => r.proposal).length,
      results,
    };
  }
);

export const dayTraderPrePostReview = inngest.createFunction(
  {
    id: 'daytrader-pre-post-review',
    triggers: [
      { cron: '0 13 * * 1-5' }, // ~9:00 ET pre-open-ish depending on DST
      { cron: '30 20 * * 1-5' }, // ~16:30 ET post-close-ish
      { event: 'app/daytrader.market-review' },
    ],
  },
  async ({ step }) => {
    return step.run('market-review', async () => {
      const { runMarketReview } = await import('@/lib/actions/daytrader.actions');
      const hour = new Date().getUTCHours();
      const session = hour < 16 ? 'pre_open' : 'post_close';
      return runMarketReview(session);
    });
  }
);
