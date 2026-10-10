import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { getSecrets } from '../secrets/index.js';
import { isAllowedDiscordWebhook, isAllowedTelegramChatId, isPrivateHostname } from './allowlists.js';

const execFileAsync = promisify(execFile);

export type NotifyChannel = 'macos' | 'email' | 'telegram' | 'discord';

export type NotifyPayload = {
  title: string;
  body: string;
  channels?: NotifyChannel[];
};

export type NotifyResult = Record<NotifyChannel, 'sent' | 'skipped' | 'failed'>;

async function notifyMacOS(title: string, body: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    try {
      const script = `display notification ${JSON.stringify(body.slice(0, 200))} with title ${JSON.stringify(title.slice(0, 80))}`;
      await execFileAsync('osascript', ['-e', script], { timeout: 10_000 });
      return true;
    } catch {
      /* try node-notifier */
    }
  }
  try {
    const notifier = await import('node-notifier');
    await new Promise<void>((resolve, reject) => {
      notifier.default.notify({ title, message: body.slice(0, 200) }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return true;
  } catch {
    return false;
  }
}

async function notifyEmail(title: string, body: string): Promise<boolean> {
  const secrets = getSecrets();
  const email = secrets.get('NODEMAILER_EMAIL');
  const password = secrets.get('NODEMAILER_PASSWORD');
  if (!email || !password) return false;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: email, pass: password },
  });
  await transporter.sendMail({
    from: `"AutoDayTrader" <${email}>`,
    to: email,
    subject: title,
    text: body,
  });
  return true;
}

async function notifyTelegram(title: string, body: string): Promise<boolean> {
  const secrets = getSecrets();
  const token = secrets.get('TELEGRAM_BOT_TOKEN');
  const chatId = secrets.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId || !isAllowedTelegramChatId(chatId)) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(body.slice(0, 3500))}`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}

async function notifyDiscord(title: string, body: string): Promise<boolean> {
  const secrets = getSecrets();
  const url = secrets.get('DISCORD_WEBHOOK_URL');
  if (!url || !isAllowedDiscordWebhook(url)) return false;
  try {
    const host = new URL(url).hostname;
    if (isPrivateHostname(host)) return false;
  } catch {
    return false;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `**${title}**\n${body}`.slice(0, 1900) }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function dispatchNotification(payload: NotifyPayload): Promise<NotifyResult> {
  const channels = payload.channels || (['macos', 'email', 'telegram', 'discord'] as NotifyChannel[]);
  const results: NotifyResult = {
    macos: 'skipped',
    email: 'skipped',
    telegram: 'skipped',
    discord: 'skipped',
  };

  const runners: Array<[NotifyChannel, () => Promise<boolean>]> = [
    ['macos', () => notifyMacOS(payload.title, payload.body)],
    ['email', () => notifyEmail(payload.title, payload.body)],
    ['telegram', () => notifyTelegram(payload.title, payload.body)],
    ['discord', () => notifyDiscord(payload.title, payload.body)],
  ];

  for (const [ch, run] of runners) {
    if (!channels.includes(ch)) continue;
    try {
      const ok = await run();
      results[ch] = ok ? 'sent' : 'skipped';
    } catch (e) {
      console.warn(`[notify] ${ch} failed`, e);
      results[ch] = 'failed';
    }
  }
  return results;
}

export async function notifyForecastRefresh(opts: {
  symbolCount: number;
  modelVersion: string;
  asOf: string;
}): Promise<NotifyResult> {
  return dispatchNotification({
    title: 'AutoDayTrader forecasts refreshed',
    body: `${opts.symbolCount} symbols · model ${opts.modelVersion} · asOf ${opts.asOf}`,
  });
}

export async function notifyMaterialInsider(opts: {
  ticker: string;
  summary: string;
}): Promise<NotifyResult> {
  return dispatchNotification({
    title: `Insider Form 4 — ${opts.ticker}`,
    body: opts.summary.slice(0, 500),
  });
}
