import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ForecastRow } from '../api';

type Mode = 'watchlist' | 'custom' | 'random' | 'universe';

export default function ForecastsPage() {
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [modelVersion, setModelVersion] = useState('');
  const [asOf, setAsOf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<Mode>('watchlist');
  const [customSymbols, setCustomSymbols] = useState('');
  const [randomCount, setRandomCount] = useState(20);

  useEffect(() => {
    api
      .forecasts()
      .then((r) => {
        setRows(r.forecasts);
        if (r.forecasts[0]) {
          setModelVersion(r.forecasts[0].modelVersion);
          setAsOf(r.forecasts[0].asOf);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  const refresh = async () => {
    setPending(true);
    setError(null);
    setMsg(null);
    try {
      const symbols =
        mode === 'custom'
          ? customSymbols
              .split(/[\s,]+/)
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
          : undefined;
      const res = await api.runForecasts({
        mode,
        symbols,
        count: mode === 'random' ? randomCount : undefined,
        maxSymbols: 100,
      });
      setRows(res.forecasts);
      setModelVersion(res.modelVersion);
      setAsOf(res.asOf);
      setMsg(`Ran ${res.symbolCount ?? '—'} symbols (${res.mode || mode})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const exportXlsx = () => {
    window.location.href = '/api/forecasts/export.xlsx';
  };

  const importXlsx = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setMsg(null);
    try {
      const r = await api.importForecasts(file);
      setMsg(`Import: updated ${r.updated}, skipped ${r.skipped}`);
      if (r.errors?.length) setError(r.errors.join('; '));
      const fres = await api.forecasts();
      setRows(fres.forecasts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const bySymbol = new Map<string, ForecastRow[]>();
  for (const r of rows) {
    const list = bySymbol.get(r.symbol) || [];
    list.push(r);
    bySymbol.set(r.symbol, list);
  }

  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div>
          <h1>Price forecasts</h1>
          <p className="lead">
            D1–D5 predicted closes with 80% bands. Model{' '}
            <span className="mono">{modelVersion || '—'}</span>
            {asOf ? <> · asOf {asOf}</> : null}
          </p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/lab">
            Forecast Lab
          </Link>
          <button className="btn ghost" type="button" onClick={exportXlsx}>
            Export Excel
          </button>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            Import Excel
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => void importXlsx(e.target.files?.[0] || null)}
            />
          </label>
          <button className="btn" type="button" onClick={refresh} disabled={pending}>
            {pending ? 'Forecasting…' : 'Run forecasts'}
          </button>
        </div>
      </div>

      <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <label>
          Universe{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="watchlist">Watchlist</option>
            <option value="custom">User-entered symbols</option>
            <option value="random">Random from 100</option>
            <option value="universe">Full 100 universe</option>
          </select>
        </label>
        {mode === 'custom' ? (
          <input
            style={{ flex: 1, minWidth: '12rem' }}
            placeholder="AAPL, MSFT, NVDA…"
            value={customSymbols}
            onChange={(e) => setCustomSymbols(e.target.value)}
          />
        ) : null}
        {mode === 'random' ? (
          <label>
            Count{' '}
            <input
              type="number"
              min={1}
              max={100}
              value={randomCount}
              onChange={(e) => setRandomCount(Number(e.target.value) || 20)}
              style={{ width: '4rem' }}
            />
          </label>
        ) : null}
      </div>

      {error ? <p className="err">{error}</p> : null}
      {msg ? <p className="lead">{msg}</p> : null}
      {!rows.length ? (
        <p className="lead">No forecasts yet. Pick a universe mode, then run forecasts.</p>
      ) : (
        [...bySymbol.entries()].map(([symbol, list]) => (
          <div key={symbol} style={{ marginTop: '1.25rem' }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{symbol}</h2>
            <table>
              <thead>
                <tr>
                  <th>Horizon</th>
                  <th>Last</th>
                  <th>ŷ</th>
                  <th>80% band</th>
                  <th>Dir</th>
                  <th>Conf</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={`${r.symbol}-${r.horizon}-${r.asOf}`}>
                    <td className="mono">{r.horizon}</td>
                    <td className="mono">{r.lastClose.toFixed(2)}</td>
                    <td className="mono">{r.yHat.toFixed(2)}</td>
                    <td className="mono">
                      {r.lo80.toFixed(2)} – {r.hi80.toFixed(2)}
                    </td>
                    <td>{r.direction}</td>
                    <td className="mono">{(r.confidence * 100).toFixed(0)}%</td>
                    <td className="mono">{r.actualClose != null ? r.actualClose.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list[0]?.rationale ? (
              <p className="lead" style={{ marginTop: '0.35rem' }}>
                {list[0].rationale.startsWith('Insider:') ? (
                  <>
                    <strong>Insider</strong> · {list[0].rationale.replace(/^Insider:\s*/, '')}{' '}
                    {list[0].evidenceUrls?.some((u) => u.includes('openinsider')) ? (
                      <a href="https://openinsider.com/" target="_blank" rel="noreferrer">
                        OpenInsider
                      </a>
                    ) : null}
                  </>
                ) : (
                  list[0].rationale
                )}
              </p>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}
