'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { refreshAnalysisAction } from '@/lib/actions/daytrader.actions';
import {
  setKillSwitchAction,
  updateTradingSettingsAction,
} from '@/lib/actions/trading.actions';
import { ApprovalModal, type ProposalCard } from '@/components/bot/ApprovalModal';
import { Button } from '@/components/ui/button';
import Panel from '@/components/Panel';

type Report = {
  _id: string;
  symbol: string;
  action: 'buy' | 'watch' | 'sell';
  score: number;
  trend: string;
  summary: string;
  bias: string;
  confidence: number;
  catalysts?: string[];
  risks?: string[];
  checklist?: string[];
  evidenceUrls?: string[];
  asOf: string;
};

type Review = {
  summary?: string;
  sectorLeaders?: string[];
  sectorLaggards?: string[];
  indices?: { symbol: string; name: string; last: number; changePct: number }[];
  asOf?: string;
  session?: string;
} | null;

type Settings = {
  killSwitch: boolean;
  paperTrading: boolean;
  maxPositionPct: number;
  maxDailyProposals: number;
  notifyEmail: boolean;
  notifyTelegram: boolean;
  notifyDiscord: boolean;
};

const actionTone = (action: string) => {
  if (action === 'buy') return 'text-emerald-400';
  if (action === 'sell') return 'text-rose-400';
  return 'text-amber-300';
};

export default function BotDashboardClient({
  reports,
  proposals,
  pending,
  review,
  settings: initialSettings,
  watchlist,
  alpaca,
}: {
  reports: Report[];
  proposals: ProposalCard[];
  pending: ProposalCard[];
  review: Review;
  settings: Settings;
  watchlist: { symbol: string; company: string }[];
  alpaca: { configured: boolean; mode?: string; error?: string; account?: { portfolio_value?: string; cash?: string; status?: string } };
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [selected, setSelected] = useState<ProposalCard | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingUi, startTransition] = useTransition();

  const openApprove = (p: ProposalCard) => {
    setSelected(p);
    setOpen(true);
  };

  const runAnalysis = (symbol: string, company?: string) => {
    startTransition(async () => {
      try {
        await refreshAnalysisAction(symbol, company);
        toast.success(`Analyzed ${symbol}`);
        window.location.reload();
      } catch (e) {
        toast.error(String(e));
      }
    });
  };

  const toggleKill = () => {
    startTransition(async () => {
      try {
        const next = await setKillSwitchAction(!settings.killSwitch);
        setSettings((s) => ({ ...s, killSwitch: next.killSwitch }));
        toast.message(next.killSwitch ? 'Kill switch ON' : 'Kill switch OFF');
      } catch (e) {
        toast.error(String(e));
      }
    });
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="kicker text-brand-ink">Auto Day Trader</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Decision dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            DSA-shaped scores and actions. PricingEngine sets levels; Gemini explains inside those bands.
            Alpaca orders require an explicit Approve — never auto-submitted from cron.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={pendingUi} onClick={toggleKill}>
            {settings.killSwitch ? 'Disable kill switch' : 'Enable kill switch'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pendingUi}
            onClick={() =>
              startTransition(async () => {
                const next = await updateTradingSettingsAction({ paperTrading: true });
                setSettings((s) => ({ ...s, paperTrading: next.paperTrading }));
                toast.message('Paper trading forced on');
              })
            }
          >
            Paper: {settings.paperTrading ? 'ON' : 'OFF'}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Market review" className="lg:col-span-2">
          {review?.summary ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{review.summary}</p>
              <div className="flex flex-wrap gap-3">
                {(review.indices || []).map((i) => (
                  <span key={i.symbol} className="mono text-xs">
                    {i.symbol}{' '}
                    <span className={i.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {i.changePct >= 0 ? '+' : ''}
                      {i.changePct.toFixed(2)}%
                    </span>
                  </span>
                ))}
              </div>
              <p className="text-xs text-faint">
                Leaders: {(review.sectorLeaders || []).join(', ') || '—'} · Laggards:{' '}
                {(review.sectorLaggards || []).join(', ') || '—'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No market review yet. It runs on the day-trader cron.</p>
          )}
        </Panel>

        <Panel title="Broker / risk">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Alpaca</dt>
              <dd>{alpaca.configured ? alpaca.mode || 'paper' : 'not configured'}</dd>
            </div>
            {alpaca.account && (
              <>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Equity</dt>
                  <dd className="mono">${Number(alpaca.account.portfolio_value || 0).toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Cash</dt>
                  <dd className="mono">${Number(alpaca.account.cash || 0).toLocaleString()}</dd>
                </div>
              </>
            )}
            {alpaca.error && <p className="text-xs text-rose-400">{alpaca.error}</p>}
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Kill switch</dt>
              <dd className={settings.killSwitch ? 'text-rose-400' : 'text-emerald-400'}>
                {settings.killSwitch ? 'ON' : 'OFF'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Max position</dt>
              <dd>{settings.maxPositionPct}%</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Max daily proposals</dt>
              <dd>{settings.maxDailyProposals}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel title={`Needs approval (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open proposals. Run analysis on watchlist symbols.</p>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((p) => (
              <li key={p._id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">
                    <span className={actionTone(p.side)}>{p.side.toUpperCase()}</span>{' '}
                    <Link href={`/stocks/${p.symbol}`} className="mono hover:underline">
                      {p.symbol}
                    </Link>{' '}
                    <span className="text-xs text-faint">{p.paper ? 'PAPER' : 'LIVE'}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Entry {p.entry} · Stop {p.stop} · Target {p.target}
                    {p.rMultiple !== undefined ? ` · ${p.rMultiple.toFixed(2)}R` : ''}
                  </p>
                </div>
                <Button type="button" onClick={() => openApprove(p)}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Watchlist scores">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-faint">
              <tr>
                <th className="py-2 pr-3">Symbol</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2 pr-3">Trend</th>
                <th className="py-2 pr-3">Bias</th>
                <th className="py-2">Run</th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map((w) => {
                const r = reports.find((x) => x.symbol === w.symbol);
                return (
                  <tr key={w.symbol} className="border-t border-line">
                    <td className="py-2.5 pr-3">
                      <Link href={`/stocks/${w.symbol}`} className="mono font-semibold hover:underline">
                        {w.symbol}
                      </Link>
                      <span className="ml-2 text-xs text-faint">{w.company}</span>
                    </td>
                    <td className={`py-2.5 pr-3 font-medium ${actionTone(r?.action || 'watch')}`}>
                      {(r?.action || '—').toUpperCase()}
                    </td>
                    <td className="py-2.5 pr-3 mono">{r?.score ?? '—'}</td>
                    <td className="py-2.5 pr-3">{r?.trend ?? '—'}</td>
                    <td className="py-2.5 pr-3">{r?.bias ?? '—'}</td>
                    <td className="py-2.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pendingUi}
                        onClick={() => runAnalysis(w.symbol, w.company)}
                      >
                        Analyze
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {watchlist.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-muted-foreground">
                    Star stocks on the watchlist to populate the bot.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {reports.slice(0, 6).map((r) => (
          <Panel key={r._id} title={`${r.symbol} · ${r.action.toUpperCase()} · ${r.score}`}>
            <p className="mb-3 text-sm text-muted-foreground">{r.summary}</p>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="kicker mb-1">Catalysts</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {(r.catalysts || []).slice(0, 4).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="kicker mb-1">Risks</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {(r.risks || []).slice(0, 4).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="kicker mb-1">Checklist</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {(r.checklist || []).slice(0, 4).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
            {(r.evidenceUrls || []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(r.evidenceUrls || []).slice(0, 5).map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="text-xs text-brand-ink underline">
                    evidence
                  </a>
                ))}
              </div>
            )}
          </Panel>
        ))}
      </div>

      <Panel title="Recent proposals">
        <ul className="divide-y divide-line text-sm">
          {proposals.slice(0, 15).map((p) => (
            <li key={p._id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="mono font-medium">{p.symbol}</span> {p.side} @ {p.entry} —{' '}
                <span className="text-muted-foreground">{p.status}</span>
              </span>
              {p.status === 'proposed' && (
                <Button type="button" size="sm" variant="outline" onClick={() => openApprove(p)}>
                  Review
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <ApprovalModal proposal={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
