/**
 * Desktop background jobs: OpenInsider scan + volume uptick monitor.
 * Replaces Inngest for the DMG (no cloud cron).
 */

import type { DesktopConfig } from '../config.js';
import { getDb } from '../db/index.js';
import { getSecrets } from '../secrets/index.js';
import { notifyInsiderScan, notifyVolumeUptick } from './notify.js';
import { getNotifyPref } from './notify-prefs.js';
import { importForecast } from '../libpath.js';

let timers: NodeJS.Timeout[] = [];
let runningScan = false;
let runningVolume = false;

function workerBase(): string {
  return (process.env.SCRAPLING_WORKER_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
}

function workerToken(cfg: DesktopConfig): string {
  return cfg.scraplingWorkerToken || getSecrets().get('SCRAPLING_WORKER_TOKEN') || '';
}

/** Trigger Scrapling OpenInsider scan → posts into /api/insider/ingest. */
export async function runOpenInsiderScan(
  cfg: DesktopConfig,
  opts?: { lists?: string[] }
): Promise<{ ok: boolean; upserted?: number; error?: string; status?: number }> {
  const lists = opts?.lists || ['cluster-buys', 'purchases-25k'];
  const token = workerToken(cfg);
  try {
    const res = await fetch(`${workerBase()}/openinsider/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Worker-Token': token, Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ lists }),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      upserted?: number;
      ingested?: number;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || res.statusText, status: res.status };
    }
    const upserted = data.upserted ?? data.ingested ?? 0;
    void notifyInsiderScan({ upserted, lists });
    return { ok: true, upserted, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runVolumeUptickScan(cfg: DesktopConfig): Promise<{ checked: number; alerts: number }> {
  const pref = getNotifyPref('volume_uptick');
  if (!pref.enabled) return { checked: 0, alerts: 0 };
  const minRatio = pref.threshold ?? 2.5;

  let symbols: string[] = [];
  try {
    const universe = await importForecast('universe');
    const getForecastUniverse = universe.getForecastUniverse as () => {
      symbols: Array<{ symbol: string }>;
    };
    symbols = getForecastUniverse().symbols.map((s) => s.symbol);
  } catch {
    /* fall through */
  }
  // Prefer union of all watchlists + universe sample
  const wl = getDb()
    .prepare(`SELECT DISTINCT symbol FROM watchlist LIMIT 200`)
    .all() as Array<{ symbol: string }>;
  for (const w of wl) {
    if (!symbols.includes(w.symbol)) symbols.push(w.symbol);
  }
  symbols = symbols.slice(0, 80);

  let barsMod: {
    fetchDailyBars: (s: string) => Promise<Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>>;
  };
  try {
    barsMod = (await importForecast('bars')) as typeof barsMod;
  } catch {
    return { checked: 0, alerts: 0 };
  }

  let alerts = 0;
  let checked = 0;
  for (const symbol of symbols) {
    try {
      const bars = await barsMod.fetchDailyBars(symbol);
      if (bars.length < 25) continue;
      checked++;
      const last = bars[bars.length - 1];
      const window = bars.slice(-21, -1);
      const avg20 = window.reduce((s, b) => s + (b.v || 0), 0) / Math.max(1, window.length);
      if (avg20 <= 0 || !last.v) continue;
      const ratio = last.v / avg20;
      if (ratio < minRatio) continue;
      const asOf = new Date(last.t < 1e12 ? last.t * 1000 : last.t).toISOString().slice(0, 10);
      const sent = await notifyVolumeUptick({
        symbol,
        ratio,
        volume: last.v,
        avg20,
        asOf,
      });
      if (sent) alerts++;
    } catch (e) {
      console.warn('[volume] failed', symbol, e);
    }
  }
  return { checked, alerts };
}

export function startDesktopScheduler(cfg: DesktopConfig) {
  stopDesktopScheduler();
  // OpenInsider: every 6 hours + once shortly after boot
  const scanOnce = () => {
    if (runningScan) return;
    runningScan = true;
    void runOpenInsiderScan(cfg)
      .then((r) => console.log('[scheduler] openinsider scan', r))
      .finally(() => {
        runningScan = false;
      });
  };
  setTimeout(scanOnce, 45_000);
  timers.push(setInterval(scanOnce, 6 * 60 * 60 * 1000));

  // Volume: every 30 minutes during "session-ish" hours (always on; fingerprint dedupes)
  const volOnce = () => {
    if (runningVolume) return;
    runningVolume = true;
    void runVolumeUptickScan(cfg)
      .then((r) => console.log('[scheduler] volume scan', r))
      .finally(() => {
        runningVolume = false;
      });
  };
  setTimeout(volOnce, 90_000);
  timers.push(setInterval(volOnce, 30 * 60 * 1000));

  console.log('[scheduler] OpenInsider (6h) + volume uptick (30m) started');
}

export function stopDesktopScheduler() {
  for (const t of timers) clearInterval(t);
  timers = [];
}