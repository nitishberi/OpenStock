import { getSession } from '@/lib/better-auth/auth';
import { redirect } from 'next/navigation';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { getBotDashboardData } from '@/lib/actions/daytrader.actions';
import { getAlpacaAccountAction } from '@/lib/actions/trading.actions';
import BotDashboardClient from '@/components/bot/BotDashboardClient';

export default async function BotPage() {
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
