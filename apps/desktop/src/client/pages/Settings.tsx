import { useEffect, useState } from 'react';
import { api, type SettingsData } from '../api';

const EDITABLE = [
  'FINNHUB_API_KEY',
  'FINNHUB_API_KEYS',
  'GEMINI_API_KEY',
  'TAVILY_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DISCORD_WEBHOOK_URL',
  'NODEMAILER_EMAIL',
  'NODEMAILER_PASSWORD',
  'SCRAPLING_WORKER_TOKEN',
] as const;

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .settings()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    setError(null);
    setMsg(null);
    try {
      const secrets: Record<string, string> = {};
      for (const [k, v] of Object.entries(drafts)) {
        if (v.trim() !== '') secrets[k] = v.trim();
      }
      await api.saveSecrets(secrets);
      setDrafts({});
      setData(await api.settings());
      setMsg('Secrets saved (Keychain or file backend). Values never shown again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const testNotify = async () => {
    try {
      const r = await api.testNotify();
      setMsg(`Notify test: ${JSON.stringify(r.result)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!data) {
    return (
      <section className="panel">
        <h1>Settings</h1>
        <p className="lead">{error || 'Loading…'}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h1>Settings</h1>
      <p className="lead">
        Secrets backend: <span className="mono">{data.secretsBackend}</span> · data{' '}
        <span className="mono">{data.dataDir}</span>
      </p>
      <p className="lead">
        TRADING_UI_ENABLED={String(data.tradingUiEnabled)} · ALPACA_ALLOW_LIVE=
        {String(data.alpacaAllowLive)} · Sparkle feed{' '}
        <span className="mono">{data.sparkleFeedUrl}</span>
      </p>
      <div className="form" style={{ maxWidth: '36rem' }}>
        {EDITABLE.map((key) => (
          <label key={key}>
            {key} {data.secrets[key]?.set ? '(set)' : '(missing)'}
            <input
              type="password"
              placeholder={data.secrets[key]?.set ? '••••••••' : 'paste value'}
              value={drafts[key] || ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
              autoComplete="off"
            />
          </label>
        ))}
      </div>
      <div className="row" style={{ marginTop: '1rem' }}>
        <button className="btn" type="button" onClick={save}>
          Save secrets
        </button>
        <button className="btn ghost" type="button" onClick={testNotify}>
          Test notifications
        </button>
      </div>
      {msg ? <p className="ok">{msg}</p> : null}
      {error ? <p className="err">{error}</p> : null}
    </section>
  );
}
