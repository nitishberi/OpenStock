import { getSession } from '@/lib/better-auth/auth';
import { redirect } from 'next/navigation';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import {
  getActiveModelVersionAction,
  getLatestForecastsAction,
} from '@/lib/actions/forecast.actions';
import ForecastDashboardClient from '@/components/forecast/ForecastDashboardClient';

export const dynamic = 'force-dynamic';

export default async function ForecastsPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect('/sign-in');

  const watchlist = await getUserWatchlist();
  const symbols = watchlist.map((w: { symbol: string }) => w.symbol);
  const [{ version }, latest] = await Promise.all([
    getActiveModelVersionAction(),
    getLatestForecastsAction(symbols.length ? symbols : undefined),
  ]);

  return (
    <ForecastDashboardClient
      initial={latest}
      modelVersion={version}
      watchlist={watchlist.map(({ symbol, company }: { symbol: string; company: string }) => ({
        symbol,
        company,
      }))}
      asOf={latest[0]?.asOf}
    />
  );
}
