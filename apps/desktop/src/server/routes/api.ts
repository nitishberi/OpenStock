import { Hono } from 'hono';
import type { DesktopConfig } from '../config.js';
import { parseSessionCookie, sessionFromToken } from '../auth/session.js';
import { AuthnError, AuthzError, requireAdmin, isAdmin } from '../auth/rbac.js';
import { getSecrets, SECRET_KEYS, type SecretKey } from '../secrets/index.js';
import {
  addWatchlistItem,
  getActiveModel,
  getWatchlist,
  listLatestForecasts,
  removeWatchlistItem,
  runWatchlistForecasts,
} from '../services/forecasts.js';
import { getLabData, runStrategyTest, trainAndPromote } from '../services/lab.js';
import { dispatchNotification, notifyMaterialInsider } from '../services/notify.js';
import { getDb, nowIso } from '../db/index.js';
import { isAllowedDiscordWebhook, isAllowedTelegramChatId } from '../services/allowlists.js';

function requireUser(c: { req: { header: (n: string) => string | undefined } }) {
  const token = parseSessionCookie(c.req.header('cookie'));
  const session = sessionFromToken(token);
  if (!session) throw new AuthnError();
  return session;
}

function workerAuthorized(c: { req: { header: (n: string) => string | undefined } }, cfg: DesktopConfig): boolean {
  const expected = cfg.scraplingWorkerToken || getSecrets().get('SCRAPLING_WORKER_TOKEN') || '';
  if (!expected) {
    // Fail closed when required
    return !cfg.workerTokenRequired;
  }
  const header =
    c.req.header('x-worker-token') ||
    c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  return header === expected;
}

export function apiRoutes(cfg: DesktopConfig) {
  const app = new Hono();

  app.onError((err, c) => {
    const status = (err as { status?: number }).status || 500;
    const message =
      status >= 500 ? 'Internal error' : err.message || 'Request failed';
    if (status >= 500) console.error(err);
    return c.json({ error: message }, status as 500);
  });

  app.get('/health', (c) =>
    c.json({
      ok: true,
      app: 'AutoDayTrader',
      tradingUiEnabled: cfg.tradingUiEnabled,
      alpacaAllowLive: cfg.alpacaAllowLive,
      bind: `${cfg.host}:${cfg.port}`,
      secretsBackend: getSecrets().backendName,
      sparkleFeedUrl: cfg.sparkleFeedUrl,
    })
  );

  app.get('/forecasts', async (c) => {
    requireUser(c);
    const symbols = c.req.query('symbols')?.split(',').filter(Boolean);
    return c.json({ forecasts: listLatestForecasts(symbols) });
  });

  app.get('/forecasts/model', async (c) => {
    requireUser(c);
    const model = await getActiveModel(cfg);
    return c.json(model);
  });

  app.post('/forecasts/run', async (c) => {
    const session = requireUser(c);
    const body = await c.req.json().catch(() => ({}));
    let symbols: string[] = Array.isArray(body.symbols)
      ? body.symbols.map(String)
      : [];
    if (!symbols.length) {
      symbols = getWatchlist(session.user.id).map((w) => w.symbol);
    }
    const result = await runWatchlistForecasts(cfg, symbols);
    return c.json(result);
  });

  app.get('/lab', (c) => {
    requireUser(c);
    return c.json(getLabData(cfg));
  });

  app.post('/lab/strategy-test', async (c) => {
    const session = requireUser(c);
    // Any signed-in user may run read-ish strategy tests; promote is admin-only
    const body = await c.req.json().catch(() => ({}));
    const result = await runStrategyTest(cfg, {
      symbolLimit: body.smoke === false ? 100 : Number(body.symbolLimit || 5),
      windowDays: body.smoke === false ? 120 : Number(body.windowDays || 40),
      liveMedia: Boolean(body.liveMedia),
    });
    return c.json({ ...result, userId: session.user.id });
  });

  app.post('/lab/train-promote', async (c) => {
    const session = requireUser(c);
    requireAdmin(session.user.id, cfg);
    const body = await c.req.json().catch(() => ({}));
    const result = await trainAndPromote(cfg, body.evalRunId ? String(body.evalRunId) : undefined);
    return c.json(result);
  });

  app.get('/watchlist', (c) => {
    const session = requireUser(c);
    return c.json({ items: getWatchlist(session.user.id) });
  });

  app.post('/watchlist', async (c) => {
    const session = requireUser(c);
    const body = await c.req.json().catch(() => ({}));
    const symbol = String(body.symbol || '').toUpperCase();
    const company = String(body.company || symbol);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      return c.json({ error: 'Invalid symbol' }, 400);
    }
    addWatchlistItem(session.user.id, symbol, company);
    return c.json({ ok: true, items: getWatchlist(session.user.id) });
  });

  app.delete('/watchlist/:symbol', (c) => {
    const session = requireUser(c);
    removeWatchlistItem(session.user.id, c.req.param('symbol'));
    return c.json({ ok: true, items: getWatchlist(session.user.id) });
  });

  app.get('/settings', (c) => {
    const session = requireUser(c);
    return c.json({
      secrets: getSecrets().status(),
      secretsBackend: getSecrets().backendName,
      tradingUiEnabled: cfg.tradingUiEnabled,
      alpacaAllowLive: cfg.alpacaAllowLive,
      sparkleFeedUrl: cfg.sparkleFeedUrl,
      isAdmin: isAdmin(session.user, cfg),
      dataDir: cfg.dataDir,
    });
  });

  app.put('/settings/secrets', async (c) => {
    requireUser(c);
    const body = await c.req.json().catch(() => ({}));
    const secrets = getSecrets();
    const updates = body.secrets && typeof body.secrets === 'object' ? body.secrets : body;
    for (const [key, value] of Object.entries(updates)) {
      if (!SECRET_KEYS.includes(key as SecretKey)) continue;
      if (typeof value !== 'string') continue;
      if (key === 'DISCORD_WEBHOOK_URL' && value && !isAllowedDiscordWebhook(value)) {
        return c.json({ error: 'Discord webhook URL not allowlisted' }, 400);
      }
      if (key === 'TELEGRAM_CHAT_ID' && value && !isAllowedTelegramChatId(value)) {
        return c.json({ error: 'Invalid Telegram chat id' }, 400);
      }
      if (value === '') secrets.delete(key);
      else secrets.set(key, value);
      if (key === 'SCRAPLING_WORKER_TOKEN') {
        cfg.scraplingWorkerToken = value;
      }
    }
    return c.json({ ok: true, secrets: secrets.status() });
  });

  app.post('/notify/test', async (c) => {
    requireUser(c);
    const body = await c.req.json().catch(() => ({}));
    const result = await dispatchNotification({
      title: String(body.title || 'AutoDayTrader test'),
      body: String(body.body || 'Notification channel test'),
      channels: Array.isArray(body.channels) ? body.channels : undefined,
    });
    return c.json({ result });
  });

  // Worker ingest — token required when workerTokenRequired
  app.post('/media/ingest', async (c) => {
    if (!workerAuthorized(c, cfg)) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const documents = body?.documents;
    if (!Array.isArray(documents)) return c.json({ error: 'documents[] required' }, 400);
    const db = getDb();
    let upserted = 0;
    const stmt = db.prepare(
      `INSERT INTO media_document (url, symbol, title, source, sourceKind, excerpt, body, publishedAt, fetchedAt, domain, score, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         symbol=excluded.symbol, title=excluded.title, source=excluded.source,
         excerpt=excluded.excerpt, body=excluded.body, fetchedAt=excluded.fetchedAt`
    );
    for (const doc of documents) {
      if (!doc?.url) continue;
      // Reject $ keys / oversized
      if (typeof doc.url !== 'string' || doc.url.length > 2000) continue;
      stmt.run(
        doc.url,
        doc.symbol ? String(doc.symbol).toUpperCase() : null,
        doc.title ? String(doc.title).slice(0, 500) : null,
        doc.source ? String(doc.source).slice(0, 200) : null,
        doc.sourceKind ? String(doc.sourceKind).slice(0, 64) : 'manual',
        doc.excerpt ? String(doc.excerpt).slice(0, 4000) : null,
        doc.body ? String(doc.body).slice(0, 200_000) : null,
        doc.publishedAt || null,
        doc.fetchedAt || nowIso(),
        doc.domain ? String(doc.domain).slice(0, 200) : 'unknown',
        doc.score ?? null,
        JSON.stringify(doc.tags || ['scrapling'])
      );
      upserted++;
    }
    return c.json({ ok: true, upserted });
  });

  app.post('/insider/ingest', async (c) => {
    if (!workerAuthorized(c, cfg)) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const filings = body?.filings;
    if (!Array.isArray(filings)) return c.json({ error: 'filings[] required' }, 400);
    const db = getDb();
    let upserted = 0;
    let skipped = 0;
    const stmt = db.prepare(
      `INSERT INTO insider_filing (
         ticker, filingDate, tradeDate, insiderName, title, tradeType, price, qty, valueUsd, ownedAfter, sourceUrl, raw
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ticker, filingDate, insiderName, tradeDate, qty, valueUsd) DO UPDATE SET
         title=excluded.title, tradeType=excluded.tradeType, price=excluded.price, sourceUrl=excluded.sourceUrl`
    );
    const material: Array<{ ticker: string; summary: string }> = [];
    for (const f of filings) {
      const ticker = String(f?.ticker || '').trim().toUpperCase();
      const filingDate = String(f?.filingDate || '').slice(0, 10);
      const tradeDate = String(f?.tradeDate || '').slice(0, 10);
      const insiderName = String(f?.insiderName ?? '');
      if (!ticker || !filingDate || !tradeDate) {
        skipped++;
        continue;
      }
      const qtyNum = f?.qty == null ? NaN : Number(f.qty);
      const valueNum = f?.valueUsd == null ? NaN : Number(f.valueUsd);
      const qty = Number.isFinite(qtyNum) ? qtyNum : null;
      const valueUsd = Number.isFinite(valueNum) ? valueNum : null;
      stmt.run(
        ticker,
        filingDate,
        tradeDate,
        insiderName.slice(0, 200),
        f?.title ? String(f.title).slice(0, 200) : null,
        f?.tradeType ? String(f.tradeType).slice(0, 64) : null,
        f?.price != null && Number.isFinite(Number(f.price)) ? Number(f.price) : null,
        qty,
        valueUsd,
        f?.ownedAfter != null && Number.isFinite(Number(f.ownedAfter)) ? Number(f.ownedAfter) : null,
        f?.sourceUrl ? String(f.sourceUrl).slice(0, 1000) : null,
        JSON.stringify(f).slice(0, 50_000)
      );
      upserted++;
      if (valueUsd != null && Math.abs(valueUsd) >= 100_000) {
        material.push({
          ticker,
          summary: `${insiderName} ${f?.tradeType || 'trade'} ~$${Math.round(Math.abs(valueUsd)).toLocaleString()} on ${tradeDate}`,
        });
      }
    }
    for (const m of material.slice(0, 5)) {
      void notifyMaterialInsider(m);
    }
    return c.json({ ok: true, upserted, skipped });
  });

  return app;
}
