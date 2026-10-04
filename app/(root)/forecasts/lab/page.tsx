import { getSession } from '@/lib/better-auth/auth';
import { redirect } from 'next/navigation';
import { getForecastLabDataAction } from '@/lib/actions/forecast.actions';
import ForecastLabClient from '@/components/forecast/ForecastLabClient';

export const dynamic = 'force-dynamic';

export default async function ForecastLabPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect('/sign-in');

  const data = await getForecastLabDataAction();
  return <ForecastLabClient data={data} />;
}
