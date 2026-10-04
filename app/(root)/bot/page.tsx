import { redirect } from 'next/navigation';
import { tradingUiEnabled } from '@/lib/forecast/flags';
import { getSession } from '@/lib/better-auth/auth';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { getBotDashboardData } from '@/lib/actions/daytrader.actions';
import { getAlpacaAccountAction } from '@/lib/actions/trading.actions';
import BotDashboardClient from '@/components/bot/BotDashboardClient';

export const dynamic = 'force-dynamic';

/** Legacy /bot route — redirects to /forecasts unless trading UI is explicitly enabled. */
export default async function BotPage() {
  if (!tradingUiEnabled) {
    redirect('/forecasts');
  }

  const session = await getSession();
  if (!session?.user?.id) redirect('/sign-in');

  const [data, watchlist, alpaca] = await Promise.all([
    getBotDashboardData(session.user.id),
    getUserWatchlist(),
    getAlpacaAccountAction(),
  ]);

  return (
    <BotDashboardClient
      reports={JSON.parse(JSON.stringify(data.reports))}
      proposals={JSON.parse(JSON.stringify(data.proposals))}
      pending={JSON.parse(JSON.stringify(data.pending))}
      review={data.review ? JSON.parse(JSON.stringify(data.review)) : null}
      settings={data.settings}
      watchlist={watchlist.map(({ symbol, company }: { symbol: string; company: string }) => ({
        symbol,
        company,
      }))}
      alpaca={alpaca}
    />
  );
}
