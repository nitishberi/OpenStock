import { useEffect, useState } from 'react';
import { api, type InsiderFiling } from '../api';

export default function OpenInsiderPage() {
  const [filings, setFilings] = useState<InsiderFiling[]>([]);
  const [ticker, setTicker] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = async (t?: string) => {
    setError(null);
    try {
      const r = await api.insiderFilings(t || undefined);
      setFilings(r.filings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const scan = async () => {
    setPending(true);
    setMsg(null);
    setError(null);
    try {
      const r = await api.insiderScan();
      setMsg(`Scan ok — upserted ${r.upserted ?? 0}`);
      await load(ticker || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div>
          <h1>OpenInsider</h1>
          <p className="lead">
            Form 4 filings from OpenInsider (Scrapling). Scheduled every 6h; scan now anytime.
          </p>
        </div>
        <button className="btn" type="button" onClick={scan} disabled={pending}>
          {pending ? 'Scanning…' : 'Scan now'}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
      {msg ? <p className="lead">{msg}</p> : null}
      <div className="row" style={{ marginBottom: '1rem', gap: '0.5rem' }}>
        <input
          className="mono"
          placeholder="Filter ticker"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          style={{ maxWidth: '8rem' }}
        />
        <button className="btn ghost" type="button" onClick={() => load(ticker || undefined)}>
          Filter
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            setTicker('');
            void load();
          }}
        >
          Clear
        </button>
      </div>
      {!filings.length ? (
        <p className="lead">No filings yet. Ensure Scrapling worker is running, then Scan now.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Filed</th>
              <th>Trade</th>
              <th>Ticker</th>
              <th>Insider</th>
              <th>Type</th>
              <th>Value</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {filings.map((f) => (
              <tr key={f.id}>
                <td className="mono">{f.filingDate}</td>
                <td className="mono">{f.tradeDate}</td>
                <td className="mono">{f.ticker}</td>
                <td>
                  {f.insiderName}
                  {f.title ? <span style={{ color: 'var(--muted)' }}> · {f.title}</span> : null}
                </td>
                <td>{f.tradeType || '—'}</td>
                <td className="mono">
                  {f.valueUsd != null ? `$${Math.round(Math.abs(f.valueUsd)).toLocaleString()}` : '—'}
                </td>
                <td>
                  {f.sourceUrl ? (
                    <a href={f.sourceUrl} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
