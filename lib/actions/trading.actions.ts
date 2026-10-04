'use server';

import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/database/mongoose';
import { TradeProposal } from '@/database/models/trade-proposal.model';
import { OrderAudit } from '@/database/models/order-audit.model';
import { TradingSettings } from '@/database/models/trading-settings.model';
import { getSession } from '@/lib/better-auth/auth';
import { checkApproveGuards, getOrCreateTradingSettings } from '@/lib/trading/risk';
import {
  getAccount,
  getAlpacaMode,
  isAlpacaConfigured,
  submitOrder,
  type AlpacaMode,
} from '@/lib/trading/alpaca';

async function requireUser() {
  const session = await getSession();
  if (!session?.user?.id) throw new Error('Unauthorized');
  return session.user as { id: string; email: string; name: string };
}

export async function listProposalsAction(status?: string) {
  const user = await requireUser();
  await connectToDatabase();
  const q: Record<string, unknown> = { userId: user.id };
  if (status) q.status = status;
  const rows = await TradeProposal.find(q).sort({ createdAt: -1 }).limit(50).lean();
  return JSON.parse(JSON.stringify(rows));
}

export async function rejectProposalAction(proposalId: string, reason?: string) {
  const user = await requireUser();
  await connectToDatabase();
  const proposal = await TradeProposal.findOne({ _id: proposalId, userId: user.id });
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'proposed') throw new Error('Proposal is not open');

  proposal.status = 'rejected';
  proposal.rejectionReason = reason || 'User rejected';
  await proposal.save();

  await OrderAudit.create({
    userId: user.id,
    proposalId,
    symbol: proposal.symbol,
    event: 'proposal_rejected',
    paper: proposal.paper,
    detail: reason || 'User rejected',
  });

  revalidatePath('/bot');
  return { ok: true };
}

export async function editProposalAction(
  proposalId: string,
  edits: { entry?: number; stop?: number; target?: number; qty?: number; notional?: number }
) {
  const user = await requireUser();
  await connectToDatabase();
  const proposal = await TradeProposal.findOne({ _id: proposalId, userId: user.id });
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'proposed') throw new Error('Proposal is not open');

  if (edits.entry !== undefined) proposal.entry = edits.entry;
  if (edits.stop !== undefined) proposal.stop = edits.stop;
  if (edits.target !== undefined) proposal.target = edits.target;
  if (edits.qty !== undefined) proposal.qty = edits.qty;
  if (edits.notional !== undefined) proposal.notional = edits.notional;
  proposal.editedByUser = true;
  const risk = Math.abs(proposal.entry - proposal.stop) || 1;
  proposal.rMultiple = Math.abs(proposal.target - proposal.entry) / risk;
  await proposal.save();

  await OrderAudit.create({
    userId: user.id,
    proposalId,
    symbol: proposal.symbol,
    event: 'proposal_edited',
    paper: proposal.paper,
    detail: 'User edited levels/size',
    payload: edits,
  });

  revalidatePath('/bot');
  return JSON.parse(JSON.stringify(proposal));
}

/**
 * Explicit user Approve → submit to Alpaca.
 * NEVER call from cron without a prior approved proposal document.
 */
export async function approveProposalAction(
  proposalId: string,
  opts?: { liveConfirmPhrase?: string; qty?: number; notional?: number }
) {
  const user = await requireUser();
  await connectToDatabase();

  const proposal = await TradeProposal.findOne({ _id: proposalId, userId: user.id });
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'proposed') throw new Error('Proposal is not open for approval');
  if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) {
    proposal.status = 'expired';
    await proposal.save();
    throw new Error('Proposal expired');
  }

  if (opts?.qty !== undefined) proposal.qty = opts.qty;
  if (opts?.notional !== undefined) proposal.notional = opts.notional;

  const settings = await getOrCreateTradingSettings(user.id);
  if (settings.killSwitch) throw new Error('Kill switch is ON');

  const paper = settings.paperTrading !== false && getAlpacaMode() !== 'live'
    ? true
    : proposal.paper && getAlpacaMode() !== 'live';

  const notional =
    proposal.notional ??
    (proposal.qty ? proposal.qty * proposal.entry : proposal.entry);

  let equity: number | undefined;
  if (isAlpacaConfigured()) {
    try {
      const acct = await getAccount(paper ? 'paper' : 'live');
      equity = parseFloat(acct.portfolio_value);
    } catch {
      /* offline / no keys in test */
    }
  }

  const guards = await checkApproveGuards({
    userId: user.id,
    symbol: proposal.symbol,
    notional,
    equity,
    paper: Boolean(paper),
    liveConfirmPhrase: opts?.liveConfirmPhrase,
  });
  if (!guards.ok) {
    throw new Error(guards.reasons.join('; '));
  }

  // Mark approved first (audit), then submit — never auto from cron into submitOrder
  proposal.status = 'approved';
  proposal.approvedAt = new Date();
  proposal.paper = Boolean(paper);
  await proposal.save();

  await OrderAudit.create({
    userId: user.id,
    proposalId,
    symbol: proposal.symbol,
    event: 'proposal_approved',
    paper: proposal.paper,
    detail: 'User explicitly approved',
  });

  if (!isAlpacaConfigured()) {
    proposal.status = 'failed';
    await proposal.save();
    await OrderAudit.create({
      userId: user.id,
      proposalId,
      symbol: proposal.symbol,
      event: 'order_failed',
      paper: proposal.paper,
      detail: 'Alpaca credentials not configured',
    });
    revalidatePath('/bot');
    return { ok: false, error: 'Alpaca not configured — proposal approved but not submitted' };
  }

  try {
    const mode: AlpacaMode = proposal.paper ? 'paper' : 'live';
    const clientOrderId = `adt-${proposal.id}`.slice(0, 48);
    const order = await submitOrder(
      {
        symbol: proposal.symbol,
        qty: proposal.qty,
        notional: proposal.qty ? undefined : proposal.notional,
        side: proposal.side,
        type: proposal.orderType === 'market' ? 'market' : 'limit',
        time_in_force: 'day',
        limit_price: proposal.orderType === 'market' ? undefined : proposal.entry,
        client_order_id: clientOrderId,
      },
      mode
    );

    proposal.status = 'submitted';
    proposal.submittedAt = new Date();
    proposal.alpacaOrderId = order.id;
    proposal.alpacaClientOrderId = order.client_order_id;
    await proposal.save();

    await OrderAudit.create({
      userId: user.id,
      proposalId,
      symbol: proposal.symbol,
      event: 'order_submitted',
      paper: proposal.paper,
      detail: `Alpaca order ${order.id}`,
      payload: { order },
    });

    revalidatePath('/bot');
    return { ok: true, order: JSON.parse(JSON.stringify(order)), proposal: JSON.parse(JSON.stringify(proposal)) };
  } catch (e) {
    proposal.status = 'failed';
    await proposal.save();
    await OrderAudit.create({
      userId: user.id,
      proposalId,
      symbol: proposal.symbol,
      event: 'order_failed',
      paper: proposal.paper,
      detail: String(e),
    });
    revalidatePath('/bot');
    throw e;
  }
}

export async function setKillSwitchAction(enabled: boolean) {
  const user = await requireUser();
  await connectToDatabase();
  const settings = await getOrCreateTradingSettings(user.id);
  settings.killSwitch = enabled;
  await settings.save();
  await OrderAudit.create({
    userId: user.id,
    event: 'kill_switch',
    paper: settings.paperTrading,
    detail: enabled ? 'Kill switch enabled' : 'Kill switch disabled',
  });
  revalidatePath('/bot');
  return JSON.parse(JSON.stringify(settings));
}

export async function updateTradingSettingsAction(patch: {
  paperTrading?: boolean;
  maxPositionPct?: number;
  maxDailyProposals?: number;
  notifyEmail?: boolean;
  notifyTelegram?: boolean;
  notifyDiscord?: boolean;
  telegramChatId?: string;
  discordWebhookUrl?: string;
}) {
  const user = await requireUser();
  await connectToDatabase();
  const settings = await getOrCreateTradingSettings(user.id);
  Object.assign(settings, patch);
  // Force paper unless live explicitly allowed
  if (process.env.ALPACA_ALLOW_LIVE !== 'true') {
    settings.paperTrading = true;
  }
  await settings.save();
  revalidatePath('/bot');
  return JSON.parse(JSON.stringify(settings));
}

export async function getTradingSettingsAction() {
  const user = await requireUser();
  return JSON.parse(JSON.stringify(await getOrCreateTradingSettings(user.id)));
}

export async function getAlpacaAccountAction() {
  const user = await requireUser();
  if (!isAlpacaConfigured()) return { configured: false };
  const settings = await getOrCreateTradingSettings(user.id);
  const mode = settings.paperTrading ? 'paper' : getAlpacaMode();
  try {
    const account = await getAccount(mode === 'live' ? 'live' : 'paper');
    return { configured: true, mode, account: JSON.parse(JSON.stringify(account)) };
  } catch (e) {
    return { configured: true, mode, error: String(e) };
  }
}
