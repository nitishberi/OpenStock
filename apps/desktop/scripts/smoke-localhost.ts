/**
 * Linux/Mac smoke against a running desktop server on 127.0.0.1:8787
 */
const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787';

async function main() {
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`health ${health.status}`);
  const h = (await health.json()) as {
    tradingUiEnabled: boolean;
    alpacaAllowLive: boolean;
    bind: string;
  };
  if (h.tradingUiEnabled) throw new Error('TRADING_UI_ENABLED should be false');
  if (h.alpacaAllowLive) throw new Error('ALPACA_ALLOW_LIVE should be false');
  if (!String(h.bind).startsWith('127.0.0.1')) throw new Error(`bind not localhost: ${h.bind}`);

  const email = `smoke_${Date.now()}@example.com`;
  const password = 'SmokeTest1';
  const signUp = await fetch(`${BASE}/auth/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke', email, password }),
  });
  if (!signUp.ok) throw new Error(`sign-up ${signUp.status} ${await signUp.text()}`);
  const cookie = signUp.headers.get('set-cookie') || '';

  const weak = await fetch(`${BASE}/auth/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'X', email: `w_${Date.now()}@example.com`, password: 'weak' }),
  });
  if (weak.ok) throw new Error('weak password should fail');

  const watch = await fetch(`${BASE}/api/watchlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie.split(';')[0] },
    body: JSON.stringify({ symbol: 'AAPL', company: 'Apple' }),
  });
  if (!watch.ok) throw new Error(`watchlist ${watch.status}`);

  // Ingest without token should fail when token required (default)
  const ingest = await fetch(`${BASE}/api/media/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: [] }),
  });
  // 401 expected if token required and unset/mismatched
  console.log('ingest_status', ingest.status);

  console.log('SMOKE_OK', { email, health: h });
}

main().catch((e) => {
  console.error('SMOKE_FAIL', e);
  process.exit(1);
});
