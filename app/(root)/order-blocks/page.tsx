import { getSession } from '@/lib/better-auth/auth';
import { redirect } from 'next/navigation';
import { getOrderBlockBoardAction } from '@/lib/actions/orderblock.actions';
import OrderBlockBoardClient from '@/components/orderblock/OrderBlockBoardClient';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Props = { searchParams?: Promise<{ symbol?: string }> };

export default async function OrderBlocksPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect('/sign-in');

  const sp = searchParams ? await searchParams : {};
  const res = await getOrderBlockBoardAction({ limitSymbols: 100 });

  return (
    <OrderBlockBoardClient
      initial={res.ok ? res.board : null}
      initialError={res.ok ? undefined : res.error}
      focusSymbol={sp.symbol?.toUpperCase()}
    />
  );
}
