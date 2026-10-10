export type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  isAdmin?: boolean;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

export const api = {
  session: () => req<{ user: User | null }>('/auth/session'),
  signIn: (email: string, password: string) =>
    req<{ user: User }>('/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signUp: (name: string, email: string, password: string) =>
    req<{ user: User }>('/auth/sign-up', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  signOut: () => req<{ ok: boolean }>('/auth/sign-out', { method: 'POST' }),
  health: () => req<Record<string, unknown>>('/api/health'),
  forecasts: () => req<{ forecasts: ForecastRow[] }>('/api/forecasts'),
  runForecasts: (opts?: {
    symbols?: string[];
    mode?: 'watchlist' | 'custom' | 'random' | 'universe';
    count?: number;
    seed?: number;
    maxSymbols?: number;
  }) =>
    req<{
      forecasts: ForecastRow[];
      modelVersion: string;
      asOf: string;
      mode?: string;
      symbolCount?: number;
    }>('/api/forecasts/run', {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    }),
  importForecasts: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/forecasts/import', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
    return data as { updated: number; skipped: number; errors: string[] };
  },
  lab: () => req<LabData>('/api/lab'),
  strategyTest: (opts: { smoke?: boolean; liveMedia?: boolean }) =>
    req<{ evalRunId: string; summary: unknown }>('/api/lab/strategy-test', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  trainPromote: (evalRunId?: string) =>
    req<{ promoted: boolean; version: string; reason: string }>('/api/lab/train-promote', {
      method: 'POST',
      body: JSON.stringify({ evalRunId }),
    }),
  watchlist: () => req<{ items: Array<{ symbol: string; company: string }> }>('/api/watchlist'),
  addWatch: (symbol: string, company: string) =>
    req<{ items: Array<{ symbol: string; company: string }> }>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ symbol, company }),
    }),
  removeWatch: (symbol: string) =>
    req<{ items: Array<{ symbol: string; company: string }> }>(`/api/watchlist/${symbol}`, {
      method: 'DELETE',
    }),
  settings: () => req<SettingsData>('/api/settings'),
  saveSecrets: (secrets: Record<string, string>) =>
    req<{ ok: boolean }>('/api/settings/secrets', {
      method: 'PUT',
      body: JSON.stringify({ secrets }),
    }),
  testNotify: () =>
    req<{ result: unknown }>('/api/notify/test', {
      method: 'POST',
      body: JSON.stringify({ title: 'AutoDayTrader', body: 'Test notification' }),
    }),
  notifyPrefs: () => req<{ prefs: NotifyPref[]; types: string[] }>('/api/notify/prefs'),
  saveNotifyPref: (pref: Partial<NotifyPref> & { type: string }) =>
    req<{ pref: NotifyPref }>('/api/notify/prefs', {
      method: 'PUT',
      body: JSON.stringify(pref),
    }),
  volumeScan: () => req<{ checked: number; alerts: number }>('/api/notify/volume-scan', { method: 'POST' }),
  insiderFilings: (ticker?: string) =>
    req<{ filings: InsiderFiling[] }>(
      `/api/insider/filings${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ''}`
    ),
  insiderScan: (lists?: string[]) =>
    req<{ ok: boolean; upserted?: number; error?: string }>('/api/insider/scan', {
      method: 'POST',
      body: JSON.stringify({ lists }),
    }),
};

export type NotifyPref = {
  type: string;
  enabled: boolean;
  channels: Array<'macos' | 'email' | 'telegram' | 'discord'>;
  threshold: number | null;
};

export type InsiderFiling = {
  id: number;
  ticker: string;
  filingDate: string;
  tradeDate: string;
  insiderName: string;
  title?: string | null;
  tradeType?: string | null;
  price?: number | null;
  qty?: number | null;
  valueUsd?: number | null;
  ownedAfter?: number | null;
  sourceUrl?: string | null;
};

export type ForecastRow = {
  symbol: string;
  asOf: string;
  horizon: string;
  lastClose: number;
  yHat: number;
  lo80: number;
  hi80: number;
  direction: string;
  confidence: number;
  rationale: string;
  evidenceUrls: string[];
  modelVersion: string;
  actualClose?: number | null;
};

export type LabData = {
  activeVersion: string;
  universeCount: number;
  socialIntake?: unknown;
  evals: Array<{
    id?: string;
    _id?: string;
    modelVersion: string;
    status: string;
    rowCount: number;
    summary?: {
      byHorizon?: Record<
        string,
        { n: number; mae: number; mape: number; directionHitRate: number; coverage80: number }
      >;
      symbolCount?: number;
    };
    createdAt?: string;
  }>;
  attributions: Array<{
    narrative?: string;
    channelSummary?: Record<string, { mapeDelta: number; directionLift: number }>;
  }>;
  sampleRows: unknown[];
};

export type SettingsData = {
  secrets: Record<string, { set: boolean }>;
  secretsBackend: string;
  tradingUiEnabled: boolean;
  alpacaAllowLive: boolean;
  sparkleFeedUrl: string;
  isAdmin: boolean;
  dataDir: string;
};
