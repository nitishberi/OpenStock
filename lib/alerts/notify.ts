/**
 * Multi-channel alerts when a TradeProposal needs approval.
 * Email (Nodemailer) + Telegram + Discord webhook.
 */

import { transporter } from '@/lib/nodemailer';
import { escapeHtml } from '@/lib/utils';

export interface ProposalAlertPayload {
  email?: string;
  symbol: string;
  side: string;
  entry: number;
  stop: number;
  target: number;
  score?: number;
  action?: string;
  rationale: string;
  proposalId: string;
  paper: boolean;
  dashboardUrl?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  notifyEmail?: boolean;
  notifyTelegram?: boolean;
  notifyDiscord?: boolean;
}

async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}

async function sendDiscord(webhookUrl: string, content: string): Promise<boolean> {
  if (!webhookUrl) return false;
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.slice(0, 1900) }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}

export async function notifyProposalNeedsApproval(p: ProposalAlertPayload): Promise<{
  email: string;
  telegram: string;
  discord: string;
}> {
  const mode = p.paper ? 'PAPER' : 'LIVE';
  const url = p.dashboardUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const botLink = `${url.replace(/\/$/, '')}/bot?proposal=${p.proposalId}`;
  const headline = `[${mode}] ${p.side.toUpperCase()} ${p.symbol} needs approval`;

  const results = { email: 'skipped', telegram: 'skipped', discord: 'skipped' };

  if (p.notifyEmail !== false && p.email && transporter) {
    try {
      await transporter.sendMail({
        from: `"Auto Day Trader" <${process.env.NODEMAILER_EMAIL}>`,
        to: p.email,
        subject: headline,
        text: `${headline}\nEntry ${p.entry} | Stop ${p.stop} | Target ${p.target}\n${p.rationale}\nApprove: ${botLink}`,
        html: `<p><strong>${escapeHtml(headline)}</strong></p>
          <p>Entry <b>${p.entry}</b> · Stop <b>${p.stop}</b> · Target <b>${p.target}</b></p>
          <p>${escapeHtml(p.rationale)}</p>
          <p><a href="${escapeHtml(botLink)}">Open decision dashboard to Approve / Reject</a></p>
          <p style="color:#888;font-size:12px">No order is submitted until you explicitly approve.</p>`,
      });
      results.email = 'sent';
    } catch (e) {
      console.error('Proposal email failed', e);
      results.email = 'failed';
    }
  }

  const tgChat = p.telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (p.notifyTelegram && tgChat) {
    const ok = await sendTelegram(
      tgChat,
      `<b>${escapeHtml(headline)}</b>\nEntry ${p.entry} | Stop ${p.stop} | Target ${p.target}\n${escapeHtml(p.rationale.slice(0, 500))}\n<a href="${escapeHtml(botLink)}">Approve / Reject</a>`
    );
    results.telegram = ok ? 'sent' : 'failed';
  }

  const discordUrl = p.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;
  if (p.notifyDiscord && discordUrl) {
    const ok = await sendDiscord(
      discordUrl,
      `**${headline}**\nEntry ${p.entry} | Stop ${p.stop} | Target ${p.target}\n${p.rationale.slice(0, 400)}\n${botLink}`
    );
    results.discord = ok ? 'sent' : 'failed';
  }

  return results;
}
