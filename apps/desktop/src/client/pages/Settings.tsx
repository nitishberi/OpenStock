import { useEffect, useState } from 'react';
import { api, type NotifyPref, type SettingsData } from '../api';

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

const CHANNELS = ['macos', 'email', 'telegram', 'discord'] as const;

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [prefs, setPrefs] = useState<NotifyPref[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.settings(), api.notifyPrefs()])
      .then(([s, p]) => {
        setData(s);
        setPrefs(p.prefs);
      })
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

  const volumeScan = async () => {
    try {
      const r = await api.volumeScan();
      setMsg(`Volume scan: checked ${r.checked}, alerts ${r.alerts}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const savePref = async (pref: NotifyPref) => {
    try {
      const r = await api.saveNotifyPref(pref);
      setPrefs((prev) => prev.map((p) => (p.type === r.pref.type ? r.pref : p)));
      setMsg(`Saved notify pref ${r.pref.type}`);
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
        <button className="btn ghost" type="button" onClick={volumeScan}>
          Run volume scan now
        </button>
      </div>

      <h2 style={{ marginTop: '2rem', fontSize: '1.15rem' }}>Notification types</h2>
      <p className="lead">
        Custom alerts: Form 4 material/heavy buys, volume upticks, forecast refresh, OpenInsider scan.
      </p>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>On</th>
            <th>Channels</th>
            <th>Threshold</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {prefs.map((p) => (
            <tr key={p.type}>
              <td className="mono">{p.type}</td>
              <td>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) =>
                    setPrefs((prev) =>
                      prev.map((x) => (x.type === p.type ? { ...x, enabled: e.target.checked } : x))
                    )
                  }
                />
              </td>
              <td>
                {CHANNELS.map((ch) => (
                  <label key={ch} style={{ marginRight: '0.5rem', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={p.channels.includes(ch)}
                      onChange={(e) => {
                        const channels = e.target.checked
                          ? [...p.channels, ch]
                          : p.channels.filter((c) => c !== ch);
                        setPrefs((prev) =>
                          prev.map((x) => (x.type === p.type ? { ...x, channels } : x))
                        );
                      }}
                    />{' '}
                    {ch}
                  </label>
                ))}
              </td>
              <td>
                <input
                  type="number"
                  className="mono"
                  style={{ width: '7rem' }}
                  value={p.threshold ?? ''}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    setPrefs((prev) =>
                      prev.map((x) => (x.type === p.type ? { ...x, threshold: v } : x))
                    );
                  }}
                />
              </td>
              <td>
                <button className="btn ghost" type="button" onClick={() => void savePref(p)}>
                  Save
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lead" style={{ marginTop: '0.5rem' }}>
        Thresholds: form4_* = USD value; volume_uptick = multiple of 20-day average volume (e.g. 2.5).
      </p>

      {msg ? <p className="ok">{msg}</p> : null}
      {error ? <p className="err">{error}</p> : null}
    </section>
  );
}
