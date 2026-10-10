import { useEffect, useState } from 'react';
import { api, type LabData } from '../api';

export default function LabPage({ isAdmin }: { isAdmin: boolean }) {
  const [lab, setLab] = useState<LabData | null>(null);
  const [smoke, setSmoke] = useState(true);
  const [liveMedia, setLiveMedia] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = () =>
    api
      .lab()
      .then(setLab)
      .catch((e) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  const runTest = async () => {
    setPending(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.strategyTest({ smoke, liveMedia });
      setMsg(`Strategy test complete. evalRunId=${res.evalRunId}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const train = async () => {
    setPending(true);
    setError(null);
    setMsg(null);
    try {
      const latest = lab?.evals[0];
      const res = await api.trainPromote(latest?.id || latest?._id);
      setMsg(
        res.promoted ? `Promoted ${res.version}. ${res.reason}` : `Not promoted: ${res.reason}`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  if (!lab) {
    return (
      <section className="panel">
        <h1>Forecast Lab</h1>
        <p className="lead">{error || 'Loading…'}</p>
      </section>
    );
  }

  const latest = lab.evals[0];
  const attr = lab.attributions[0];

  return (
    <section className="panel">
      <h1>Forecast Lab</h1>
      <p className="lead">
        Active model <span className="mono">{lab.activeVersion}</span> · universe {lab.universeCount}{' '}
        · intake {lab.socialIntake != null ? String(lab.socialIntake) : '—'}
      </p>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <label className="row" style={{ color: 'var(--muted)' }}>
          <input type="checkbox" checked={smoke} onChange={(e) => setSmoke(e.target.checked)} />
          Smoke (5×40)
        </label>
        <label className="row" style={{ color: 'var(--muted)' }}>
          <input
            type="checkbox"
            checked={liveMedia}
            onChange={(e) => setLiveMedia(e.target.checked)}
          />
          Live media
        </label>
        <button className="btn" type="button" disabled={pending} onClick={runTest}>
          Run strategy test
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={pending || !isAdmin}
          onClick={train}
          title={isAdmin ? 'Admin train/promote' : 'Admin only'}
        >
          Train / promote
        </button>
      </div>
      {!isAdmin ? (
        <p className="lead">Train/promote requires admin (ADMIN_EMAILS or role=admin).</p>
      ) : null}
      {msg ? <p className="ok">{msg}</p> : null}
      {error ? <p className="err">{error}</p> : null}
      {latest ? (
        <div style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1rem' }}>Latest eval</h2>
          <p className="mono" style={{ color: 'var(--muted)' }}>
            {latest.modelVersion} · {latest.status} · rows {latest.rowCount}
          </p>
          {latest.summary?.byHorizon ? (
            <table>
              <thead>
                <tr>
                  <th>H</th>
                  <th>n</th>
                  <th>MAPE</th>
                  <th>Dir</th>
                  <th>Cov80</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(latest.summary.byHorizon).map(([h, m]) => (
                  <tr key={h}>
                    <td className="mono">{h}</td>
                    <td>{m.n}</td>
                    <td className="mono">{(m.mape * 100).toFixed(2)}%</td>
                    <td className="mono">{(m.directionHitRate * 100).toFixed(1)}%</td>
                    <td className="mono">{(m.coverage80 * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : (
        <p className="lead">No eval runs yet.</p>
      )}
      {attr?.narrative ? (
        <p style={{ marginTop: '1rem', color: 'var(--muted)' }}>{attr.narrative}</p>
      ) : null}
    </section>
  );
}
