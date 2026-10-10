import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ForecastRow } from '../api';

export default function ForecastsPage() {
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [modelVersion, setModelVersion] = useState('');
  const [asOf, setAsOf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    try {
      const res = await api.runForecasts();
      setRows(res.forecasts);
      setModelVersion(res.modelVersion);
      setAsOf(res.asOf);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
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
          <button className="btn" type="button" onClick={refresh} disabled={pending}>
            {pending ? 'Forecasting…' : 'Run forecasts'}
          </button>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      {!rows.length ? (
        <p className="lead">No forecasts yet. Add a watchlist, then run forecasts.</p>
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
                  </tr>
                ))}
              </tbody>
            </table>
            {list[0]?.rationale ? (
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                {list[0].rationale}
              </p>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}
