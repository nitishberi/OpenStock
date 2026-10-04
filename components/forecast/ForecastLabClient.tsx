'use client';

import { useState, useTransition } from 'react';
import {
  runStrategyTestAction,
  trainFromLastEvalAction,
} from '@/lib/actions/forecast.actions';

type LabData = {
  activeVersion: string;
  universeCount: number;
  evals: Array<{
    _id: string;
    modelVersion: string;
    status: string;
    rowCount: number;
    summary?: {
      byHorizon?: Record<
        string,
        { n: number; mae: number; mape: number; directionHitRate: number; coverage80: number }
      >;
      asOfStart?: string;
      asOfEnd?: string;
      symbolCount?: number;
    };
    createdAt?: string;
  }>;
  attributions: Array<{
    _id: string;
    modelVersion: string;
    narrative: string;
    channelSummary: Record<string, { mapeDelta: number; directionLift: number }>;
    factors: Array<{
      feature: string;
      group: string;
      ablationMapeDelta: number;
      spearmanDirectionHit: number;
      helpful: boolean;
    }>;
  }>;
  sampleRows: Array<{
    symbol: string;
    horizon: string;
    asOf: string;
    yHat: number;
    actualClose?: number;
    pctError?: number;
    directionHit?: boolean;
    inside80?: boolean;
  }>;
};

export default function ForecastLabClient({ data }: { data: LabData }) {
  const [lab, setLab] = useState(data);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [smoke, setSmoke] = useState(true);
  const [liveMedia, setLiveMedia] = useState(false);

  const latest = lab.evals[0];
  const attr = lab.attributions[0];

  const runTest = () => {
    setError(null);
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await runStrategyTestAction({
          symbolLimit: smoke ? 5 : 100,
          windowDays: smoke ? 40 : 120,
          liveMedia,
        });
        setMsg(
          `Strategy test complete. evalRunId=${res.evalRunId}, symbols≈${(res.summary as { symbolCount?: number })?.symbolCount ?? '?'}`
        );
        // Soft refresh via reload for simplicity
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const train = () => {
    setError(null);
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await trainFromLastEvalAction(latest?._id);
        setMsg(
          res.promoted
            ? `Promoted ${res.version}. ${res.reason}`
            : `Candidate ${res.version} not promoted. ${res.reason}`
        );
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground">Research</p>
          <h1 className="mt-1 text-2xl font-semibold">Forecast Lab</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Walk-forward strategy test on {lab.universeCount} stocks — predicted vs real closes, factor attribution
            (news / social / press / price), and ridge refit with holdout promotion. Active model{' '}
            <span className="font-mono text-foreground">{lab.activeVersion}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={smoke} onChange={(e) => setSmoke(e.target.checked)} />
            Smoke (5 symbols × 40 days)
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={liveMedia}
              onChange={(e) => setLiveMedia(e.target.checked)}
            />
            Live media (news/social/press on latest asOf)
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={runTest}
              className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50"
            >
              {pending ? 'Working…' : smoke ? 'Run smoke test' : 'Run strategy test on 100 stocks'}
            </button>
            <button
              type="button"
              disabled={pending || !latest}
              onClick={train}
              className="rounded-lg px-3 py-2 text-sm shadow-[inset_0_0_0_1px_var(--line)] disabled:opacity-50"
            >
              Train from last test
            </button>
          </div>
        </div>
      </header>

      <p className="text-xs text-muted-foreground">
        Social channel uses Tavily/RSS discovery → Scrapling on public allowlisted URLs → local VADER (no paid social
        API).
      </p>

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {msg && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{msg}</p>}

      {latest?.summary?.byHorizon && (
        <section className="rounded-xl px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
          <h2 className="text-sm font-semibold">Latest metrics · {latest.modelVersion}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {latest.summary.asOfStart} → {latest.summary.asOfEnd} · {latest.summary.symbolCount} symbols ·{' '}
            {latest.rowCount} rows
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-[12px] uppercase text-faint">
                <tr>
                  <th className="py-1">Horizon</th>
                  <th className="py-1">N</th>
                  <th className="py-1">MAE</th>
                  <th className="py-1">MAPE</th>
                  <th className="py-1">Dir hit</th>
                  <th className="py-1">80% cov</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(latest.summary.byHorizon).map(([h, m]) => (
                  <tr key={h} className="border-t border-line/60 font-mono">
                    <td className="py-2">{h}</td>
                    <td className="py-2">{m.n}</td>
                    <td className="py-2">{m.mae.toFixed(3)}</td>
                    <td className="py-2">{(m.mape * 100).toFixed(2)}%</td>
                    <td className="py-2">{(m.directionHitRate * 100).toFixed(1)}%</td>
                    <td className="py-2">{(m.coverage80 * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {attr && (
        <section className="rounded-xl px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
          <h2 className="text-sm font-semibold">Factor attribution · {attr.modelVersion}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{attr.narrative}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {Object.entries(attr.channelSummary || {}).map(([ch, v]) => (
              <div key={ch} className="rounded-lg px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]">
                <p className="text-[11px] uppercase tracking-wide text-faint">{ch}</p>
                <p className="mt-1 font-mono text-sm">mapeΔ {(v.mapeDelta * 100).toFixed(3)}%</p>
                <p className="font-mono text-xs text-muted-foreground">
                  dir lift {(v.directionLift * 100).toFixed(2)}pp
                </p>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-xs">
            {(attr.factors || []).slice(0, 10).map((f) => (
              <li key={f.feature} className="flex justify-between gap-4 font-mono">
                <span>
                  {f.feature} <span className="text-faint">({f.group})</span>
                </span>
                <span>{(f.ablationMapeDelta * 100).toFixed(3)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
        <h2 className="text-sm font-semibold">Predicted vs actual (sample)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[12px] uppercase text-faint">
              <tr>
                <th className="py-1">Symbol</th>
                <th className="py-1">H</th>
                <th className="py-1">asOf</th>
                <th className="py-1">Pred</th>
                <th className="py-1">Actual</th>
                <th className="py-1">Err%</th>
                <th className="py-1">Dir</th>
                <th className="py-1">In80</th>
              </tr>
            </thead>
            <tbody>
              {lab.sampleRows.slice(0, 80).map((r, i) => (
                <tr key={`${r.symbol}-${r.horizon}-${r.asOf}-${i}`} className="border-t border-line/60 font-mono">
                  <td className="py-1.5">{r.symbol}</td>
                  <td className="py-1.5">{r.horizon}</td>
                  <td className="py-1.5">{r.asOf}</td>
                  <td className="py-1.5">{r.yHat?.toFixed?.(2) ?? r.yHat}</td>
                  <td className="py-1.5">{r.actualClose?.toFixed?.(2) ?? '—'}</td>
                  <td className="py-1.5">
                    {r.pctError != null ? `${(r.pctError * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-1.5">{r.directionHit == null ? '—' : r.directionHit ? 'hit' : 'miss'}</td>
                  <td className="py-1.5">{r.inside80 == null ? '—' : r.inside80 ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
