/**
 * URL / webhook allowlists (security checklist).
 */

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com']);

export function isAllowedDiscordWebhook(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (!DISCORD_HOSTS.has(u.hostname)) return false;
    return u.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

export function isAllowedTelegramChatId(chatId: string): boolean {
  return /^-?\d{5,20}$/.test(chatId.trim());
}

/** Block obvious private / link-local targets for outbound notify. */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

/** Default Scrapling domain allowlist — mirrored from services/scrapling-worker/sources.yaml */
export const DEFAULT_SCRAPLING_DOMAINS = [
  'reuters.com',
  'bloomberg.com',
  'cnbc.com',
  'finance.yahoo.com',
  'marketwatch.com',
  'seekingalpha.com',
  'barrons.com',
  'wsj.com',
  'ft.com',
  'investing.com',
  'benzinga.com',
  'thestreet.com',
  'fool.com',
  'morningstar.com',
  'nasdaq.com',
  'nyse.com',
  'sec.gov',
  'federalreserve.gov',
  'apnews.com',
  'bbc.com',
  'npr.org',
  'prnewswire.com',
  'businesswire.com',
  'globenewswire.com',
  'accesswire.com',
  'reddit.com',
  'stocktwits.com',
  'openinsider.com',
] as const;

export function domainAllowed(url: string, allowlist: readonly string[] = DEFAULT_SCRAPLING_DOMAINS): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return allowlist.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
