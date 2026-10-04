/**
 * Alpaca Trading API client.
 * Defaults to paper trading. Never auto-submits without an approved TradeProposal.
 */

export type AlpacaMode = 'paper' | 'live';

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  trade_suspended_by_user: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: string;
  market_value: string;
  avg_entry_price: string;
  unrealized_pl: string;
  current_price: string;
}

export interface AlpacaOrderRequest {
  symbol: string;
  qty?: number;
  notional?: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  client_order_id?: string;
  extended_hours?: boolean;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  status: string;
  filled_avg_price?: string | null;
  submitted_at?: string;
}

export interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
}

function tradingBaseUrl(mode: AlpacaMode): string {
  if (mode === 'live') {
    return process.env.ALPACA_LIVE_BASE_URL || 'https://api.alpaca.markets';
  }
  return process.env.ALPACA_PAPER_BASE_URL || 'https://paper-api.alpaca.markets';
}

function dataBaseUrl(): string {
  return process.env.ALPACA_DATA_BASE_URL || 'https://data.alpaca.markets';
}

export function getAlpacaMode(): AlpacaMode {
  const raw = (process.env.ALPACA_MODE || 'paper').toLowerCase();
  return raw === 'live' ? 'live' : 'paper';
}

export function isAlpacaConfigured(): boolean {
  return Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY);
}

function headers(): HeadersInit {
  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!key || !secret) {
    throw new Error('ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY are not set');
  }
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    'Content-Type': 'application/json',
  };
}

async function alpacaFetch<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Alpaca ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function getAccount(mode: AlpacaMode = getAlpacaMode()): Promise<AlpacaAccount> {
  return alpacaFetch<AlpacaAccount>(`${tradingBaseUrl(mode)}/v2/account`);
}

export async function getPositions(mode: AlpacaMode = getAlpacaMode()): Promise<AlpacaPosition[]> {
  return alpacaFetch<AlpacaPosition[]>(`${tradingBaseUrl(mode)}/v2/positions`);
}

export async function getPosition(
  symbol: string,
  mode: AlpacaMode = getAlpacaMode()
): Promise<AlpacaPosition | null> {
  try {
    return await alpacaFetch<AlpacaPosition>(
      `${tradingBaseUrl(mode)}/v2/positions/${encodeURIComponent(symbol.toUpperCase())}`
    );
  } catch (e) {
    if (String(e).includes('404')) return null;
    throw e;
  }
}

/**
 * Submit an order. Caller MUST only invoke after explicit user Approve on a TradeProposal.
 */
export async function submitOrder(
  order: AlpacaOrderRequest,
  mode: AlpacaMode = getAlpacaMode()
): Promise<AlpacaOrder> {
  if (mode === 'live' && process.env.ALPACA_ALLOW_LIVE !== 'true') {
    throw new Error('Live trading blocked: set ALPACA_ALLOW_LIVE=true to enable');
  }
  return alpacaFetch<AlpacaOrder>(`${tradingBaseUrl(mode)}/v2/orders`, {
    method: 'POST',
    body: JSON.stringify({
      symbol: order.symbol.toUpperCase(),
      qty: order.qty?.toString(),
      notional: order.notional?.toString(),
      side: order.side,
      type: order.type,
      time_in_force: order.time_in_force,
      limit_price: order.limit_price?.toString(),
      stop_price: order.stop_price?.toString(),
      client_order_id: order.client_order_id,
      extended_hours: order.extended_hours,
    }),
  });
}

export async function getOrder(
  orderId: string,
  mode: AlpacaMode = getAlpacaMode()
): Promise<AlpacaOrder> {
  return alpacaFetch<AlpacaOrder>(`${tradingBaseUrl(mode)}/v2/orders/${orderId}`);
}

export async function getStockBars(params: {
  symbol: string;
  timeframe?: string;
  start?: string;
  end?: string;
  limit?: number;
}): Promise<AlpacaBar[]> {
  const sp = new URLSearchParams({
    timeframe: params.timeframe || '5Min',
    limit: String(params.limit ?? 100),
    adjustment: 'raw',
    feed: process.env.ALPACA_DATA_FEED || 'iex',
  });
  if (params.start) sp.set('start', params.start);
  if (params.end) sp.set('end', params.end);
  const url = `${dataBaseUrl()}/v2/stocks/${encodeURIComponent(params.symbol.toUpperCase())}/bars?${sp}`;
  const data = await alpacaFetch<{ bars: AlpacaBar[] | null }>(url);
  return data.bars ?? [];
}

export async function getLatestQuote(symbol: string): Promise<{
  ask_price: number;
  bid_price: number;
  ask_size: number;
  bid_size: number;
  timestamp: string;
} | null> {
  try {
    const url = `${dataBaseUrl()}/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/quotes/latest?feed=${process.env.ALPACA_DATA_FEED || 'iex'}`;
    const data = await alpacaFetch<{ quote: {
      ap: number; bp: number; as: number; bs: number; t: string;
    } }>(url);
    return {
      ask_price: data.quote.ap,
      bid_price: data.quote.bp,
      ask_size: data.quote.as,
      bid_size: data.quote.bs,
      timestamp: data.quote.t,
    };
  } catch {
    return null;
  }
}
