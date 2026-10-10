'use server';

import { getSession } from '@/lib/better-auth/auth';
import { getOrderBlockBoard } from '@/lib/orderblock/board';
import type { OrderBlockBoard } from '@/lib/orderblock/types';

export async function getOrderBlockBoardAction(opts?: {
  force?: boolean;
  /** Smoke / faster path — default full 100. */
  limitSymbols?: number;
}): Promise<{ ok: true; board: OrderBlockBoard } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.user?.id) return { ok: false, error: 'Sign in required' };

  try {
    const board = await getOrderBlockBoard({
      force: opts?.force,
      limitSymbols: opts?.limitSymbols,
      delayMs: 80,
    });
    return { ok: true, board };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
