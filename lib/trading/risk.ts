/**
 * Risk guards before Approve is enabled / before order submit.
 */

import { connectToDatabase } from '@/database/mongoose';
import { TradeProposal } from '@/database/models/trade-proposal.model';
import { TradingSettings } from '@/database/models/trading-settings.model';
import { OrderAudit } from '@/database/models/order-audit.model';

export async function getOrCreateTradingSettings(userId: string) {
  await connectToDatabase();
  // Upsert avoids E11000 when /bot loads dashboard + Alpaca settings in parallel.
  const settings = await TradingSettings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!settings) {
    throw new Error('Failed to load trading settings');
  }
  return settings;
}

export async function countTodaysProposals(userId: string): Promise<number> {
  await connectToDatabase();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return TradeProposal.countDocuments({ userId, createdAt: { $gte: start } });
}

export async function hasOpenProposal(userId: string, symbol: string): Promise<boolean> {
  await connectToDatabase();
  const existing = await TradeProposal.findOne({
    userId,
    symbol: symbol.toUpperCase(),
    status: { $in: ['proposed', 'approved'] },
  }).lean();
  return Boolean(existing);
}

export interface RiskCheckResult {
  ok: boolean;
  reasons: string[];
}

export async function checkProposalCreationGuards(params: {
  userId: string;
  symbol: string;
}): Promise<RiskCheckResult> {
  const settings = await getOrCreateTradingSettings(params.userId);
  const reasons: string[] = [];

  if (settings.killSwitch) reasons.push('Kill switch is ON — trading disabled');
  const daily = await countTodaysProposals(params.userId);
  if (daily >= settings.maxDailyProposals) {
    reasons.push(`Max daily proposals reached (${settings.maxDailyProposals})`);
  }
  if (await hasOpenProposal(params.userId, params.symbol)) {
    reasons.push(`Open proposal already exists for ${params.symbol.toUpperCase()}`);
  }

  return { ok: reasons.length === 0, reasons };
}

export async function checkApproveGuards(params: {
  userId: string;
  symbol: string;
  notional: number;
  equity?: number;
  paper: boolean;
  liveConfirmPhrase?: string;
}): Promise<RiskCheckResult> {
  const settings = await getOrCreateTradingSettings(params.userId);
  const reasons: string[] = [];

  if (settings.killSwitch) reasons.push('Kill switch is ON');
  if (!params.paper && settings.paperTrading) {
    reasons.push('Account is set to paper-only; disable paper in settings for live');
  }
  if (!params.paper && settings.requireLiveConfirmPhrase) {
    const expected = process.env.ALPACA_LIVE_CONFIRM_PHRASE || 'LIVE';
    if (params.liveConfirmPhrase !== expected) {
      reasons.push(`Live confirm phrase required (type ${expected})`);
    }
  }
  if (params.equity && params.equity > 0) {
    const pct = (params.notional / params.equity) * 100;
    if (pct > settings.maxPositionPct) {
      reasons.push(`Position ${pct.toFixed(1)}% exceeds max ${settings.maxPositionPct}%`);
    }
  }

  if (reasons.length) {
    await OrderAudit.create({
      userId: params.userId,
      symbol: params.symbol,
      event: 'risk_blocked',
      paper: params.paper,
      detail: reasons.join('; '),
    });
  }

  return { ok: reasons.length === 0, reasons };
}
