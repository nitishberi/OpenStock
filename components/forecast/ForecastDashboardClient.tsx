'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { runWatchlistForecastsAction } from '@/lib/actions/forecast.actions';

type ForecastRow = {
  symbol: string;
  asOf: string;
  horizon: string;
  lastClose: number;
  yHat: number;
  lo80: number;
  hi80: number;
  direction: string;
  confidence: number;
  rationale: string;
  evidenceUrls: string[];
  modelVersion: string;
};

export default function ForecastDashboardClient(props: {
  initial: ForecastRow[];
  modelVersion: string;
  watchlist: { symbol: string; company: string }[];
  asOf?: string;
}) {
  const [rows, setRows] = useState(props.initial);
  const [modelVersion, setModelVersion] = useState(props.modelVersion);
  const [asOf, setAsOf] = useState(props.asOf || '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bySymbol = new Map<string, ForecastRow[]>();
  for (const r of rows) {
    const list = bySymbol.get(r.symbol) || [];
    list.push(r);
    bySymbol.set(r.symbol, list);
  }

  const refresh = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await runWatchlistForecastsAction(
          props.watchlist.map((w) => w.symbol)
        );
        setRows(res.forecasts as ForecastRow[]);
        setModelVersion(res.modelVersion);
        setAsOf(res.asOf);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground">Swing forecasts</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Price forecasts</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            D1 / D2 / D3 / D5 predicted closes with 80% bands. Gemini explains inside bands only — it never invents
            prices. Model <span className="font-mono text-foreground">{modelVersion}</span>
            {asOf ? <> · asOf {asOf}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/forecasts/lab" className="rounded-lg px-3 py-2 text-sm shadow-[inset_0_0_0_1px_var(--line)] hover:bg-white/5">
            Forecast Lab
          </Link>
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50"
          >
            {pending ? 'Forecasting…' : 'Run forecasts'}
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {bySymbol.size === 0 ? (
        <p className="text-sm text-muted-foreground">
          No forecasts yet. Star symbols on your watchlist, then click Run forecasts.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {[...bySymbol.entries()].map(([symbol, list]) => {
            const sorted = [...list].sort((a, b) => a.horizon.localeCompare(b.horizon));
            const head = sorted[0];
            return (
              <section key={symbol} className="rounded-xl px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <Link href={`/stocks/${symbol}`} className="text-lg font-semibold hover:text-brand-ink">
                      {symbol}
                    </Link>
                    <span className="ml-2 text-sm text-muted-foreground">last {head?.lastClose}</span>
                  </div>
                  <p className="max-w-2xl text-xs text-muted-foreground line-clamp-2">{head?.rationale}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-[12px] uppercase tracking-wide text-faint">
                      <tr>
                        <th className="py-1 font-medium">Horizon</th>
                        <th className="py-1 font-medium">Pred close</th>
                        <th className="py-1 font-medium">80% band</th>
                        <th className="py-1 font-medium">Dir</th>
                        <th className="py-1 font-medium">Conf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => (
                        <tr key={`${r.symbol}-${r.horizon}-${r.asOf}`} className="border-t border-line/60">
                          <td className="py-2 font-mono">{r.horizon}</td>
                          <td className="py-2 font-mono">{r.yHat.toFixed(2)}</td>
                          <td className="py-2 font-mono text-muted-foreground">
                            {r.lo80.toFixed(2)} – {r.hi80.toFixed(2)}
                          </td>
                          <td className="py-2 capitalize">{r.direction}</td>
                          <td className="py-2 font-mono">{(r.confidence * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(() => {
                  const insiderUrl = head?.evidenceUrls?.find((u) =>
                    /openinsider\.com/i.test(u)
                  );
                  const insiderLine =
                    head?.rationale?.startsWith('Insider:')
                      ? head.rationale.replace(/\.\s*Baseline.*$/, '').trim()
                      : null;
                  return (
                    <>
                      {insiderLine ? (
                        <p className="mt-3 text-[12px] text-muted-foreground">
                          <span className="font-medium text-foreground">Insider</span>
                          {' · '}
                          {insiderLine.replace(/^Insider:\s*/i, '')}
                          {insiderUrl ? (
                            <>
                              {' '}
                              <a
                                href={insiderUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-brand-ink underline-offset-2 hover:underline"
                              >
                                OpenInsider
                              </a>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {head?.evidenceUrls?.length ? (
                        <ul className="mt-3 flex flex-wrap gap-2 text-[12px]">
                          {head.evidenceUrls.slice(0, 4).map((u) => (
                            <li key={u}>
                              <a
                                href={u}
                                target="_blank"
                                rel="noreferrer"
                                className="text-brand-ink underline-offset-2 hover:underline"
                              >
                                {new URL(u).hostname.replace(/^www\./, '')}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  );
                })()}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
