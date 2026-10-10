'use client';

import { useMemo, useState, useTransition } from 'react';
import { getOrderBlockBoardAction } from '@/lib/actions/orderblock.actions';
import type { OrderBlockBoard, OrderBlockRow } from '@/lib/orderblock/types';
import { cn } from '@/lib/utils';

type Props = {
  initial: OrderBlockBoard | null;
  initialError?: string;
  focusSymbol?: string;
};

function ZoneStack({ row }: { row: OrderBlockRow }) {
  const z = row.zones;
  if (!z) return <p className="text-[12.5px] text-faint">No clear order block in the recent daily window.</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
      <div className="flex justify-between gap-2"><dt className="text-faint">Resistance</dt><dd className="mono font-semibold">{z.resistance.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-faint">Order Block</dt><dd className="mono font-semibold text-brand-ink">{z.orderBlockLow.toFixed(2)}–{z.orderBlockHigh.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-faint">Zone Z</dt><dd className="mono font-semibold">{z.zoneZ.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-faint">{row.side === 'bullish' ? 'S1 (invalid)' : 'R1 (invalid)'}</dt><dd className="mono font-semibold">{z.invalidation.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-faint">Support</dt><dd className="mono font-semibold">{z.support.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-faint">Liquidity</dt><dd className="mono font-semibold">{z.liquidity.toFixed(2)}</dd></div>
    </dl>
  );
}

function BoardColumn({
  title,
  rows,
  selected,
  onSelect,
  tone,
}: {
  title: string;
  rows: OrderBlockRow[];
  selected: string | null;
  onSelect: (s: string) => void;
  tone: 'up' | 'down';
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-[14px] bg-card shadow-[inset_0_0_0_1px_var(--line)]">
      <header className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <h2 className={cn('text-[14px] font-semibold', tone === 'up' ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
          {title}
        </h2>
        <span className="num text-[12px] text-faint">{rows.length}</span>
      </header>
      <ul className="scrollbar-hide-default flex max-h-[28rem] flex-col overflow-y-auto">
        {rows.length === 0 ? (
          <li className="px-3.5 py-6 text-[13px] text-faint">No names scored on this side for the latest session.</li>
        ) : (
          rows.map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onClick={() => onSelect(r.symbol)}
                className={cn(
                  'flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-white/5',
                  selected === r.symbol && 'bg-white/5',
                  r.isPick && 'shadow-[inset_3px_0_0_var(--brand)]'
                )}
              >
                <span className="num w-6 text-[11px] text-faint">{String(r.rank).padStart(2, '0')}</span>
                <span className="mono w-16 text-[13px] font-semibold">{r.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{r.sector}</span>
                <span className={cn('num text-[12.5px] font-semibold', r.pctChange >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
                  {r.pctChange >= 0 ? '+' : ''}
                  {r.pctChange.toFixed(2)}%
                </span>
                <span className="num w-12 text-right text-[12px] text-muted-foreground">{Math.abs(r.strength).toFixed(2)}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

export default function OrderBlockBoardClient({ initial, initialError, focusSymbol }: Props) {
  const [board, setBoard] = useState<OrderBlockBoard | null>(initial);
  const [error, setError] = useState<string | undefined>(initialError);
  const [selected, setSelected] = useState<string | null>(focusSymbol || initial?.bullish[0]?.symbol || initial?.bearish[0]?.symbol || null);
  const [pending, startTransition] = useTransition();

  const selectedRow = useMemo(() => {
    if (!board || !selected) return null;
    return (
      board.bullish.find((r) => r.symbol === selected) ||
      board.bearish.find((r) => r.symbol === selected) ||
      null
    );
  }, [board, selected]);

  const refresh = (force = true) => {
    startTransition(async () => {
      const res = await getOrderBlockBoardAction({ force });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(undefined);
      setBoard(res.board);
      if (!selected) {
        setSelected(res.board.bullish[0]?.symbol || res.board.bearish[0]?.symbol || null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker text-brand-ink">Structure scan</p>
          <h1 className="text-[1.55rem] font-semibold tracking-tight text-foreground">Order Blocks</h1>
          <p className="mt-1 max-w-xl text-[13.5px] text-muted-foreground">
            Rank the forecast universe by one-directional daily strength, then inspect order-block and liquidity zones.
            Data — not tips.
          </p>
        </div>
        <button type="button" className="side-cta w-auto px-3" disabled={pending} onClick={() => refresh(true)}>
          {pending ? 'Scanning…' : 'Refresh board'}
        </button>
      </header>

      {error && (
        <p className="rounded-[12px] bg-[var(--down-soft)] px-3 py-2 text-[13px] text-[var(--down)]">{error}</p>
      )}

      {board && (
        <>
          <div className="grid gap-3 rounded-[14px] bg-card p-3.5 shadow-[inset_0_0_0_1px_var(--line)] sm:grid-cols-4">
            <div>
              <p className="kicker">As of</p>
              <p className="mono text-[15px] font-semibold">{board.asOf}</p>
            </div>
            <div>
              <p className="kicker">Breadth</p>
              <p className="text-[15px] font-semibold">
                <span className="text-[var(--up)]">▲ {board.bullishCount}</span>
                <span className="mx-2 text-faint">/</span>
                <span className="text-[var(--down)]">▼ {board.bearishCount}</span>
              </p>
            </div>
            <div>
              <p className="kicker">Lead sector</p>
              <p className="truncate text-[15px] font-semibold">{board.leadSector || '—'}</p>
            </div>
            <div>
              <p className="kicker">Lag sector</p>
              <p className="truncate text-[15px] font-semibold">{board.lagSector || '—'}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row">
            <BoardColumn title="Bullish" rows={board.bullish} selected={selected} onSelect={setSelected} tone="up" />
            <BoardColumn title="Bearish" rows={board.bearish} selected={selected} onSelect={setSelected} tone="down" />
          </div>

          <section className="rounded-[14px] bg-card p-4 shadow-[inset_0_0_0_1px_var(--line)]">
            {selectedRow ? (
              <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                <div>
                  <p className="kicker">{selectedRow.side === 'bullish' ? 'Bullish setup' : 'Bearish setup'}</p>
                  <h2 className="mt-0.5 text-[1.25rem] font-semibold">
                    <span className="mono">{selectedRow.symbol}</span>
                    <span className="ml-2 text-[15px] font-medium text-muted-foreground">${selectedRow.last.toFixed(2)}</span>
                    <span className={cn('ml-2 text-[14px]', selectedRow.pctChange >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
                      {selectedRow.pctChange >= 0 ? '+' : ''}
                      {selectedRow.pctChange.toFixed(2)}%
                    </span>
                  </h2>
                  <p className="mt-1 text-[13px] text-faint">{selectedRow.ruleNote}</p>
                  <p className="mt-3 text-[12.5px] text-muted-foreground">
                    Strength {selectedRow.strength.toFixed(2)} · {selectedRow.sector} · Rank #{selectedRow.rank}
                    {selectedRow.isPick ? ' · Pick' : ''}
                  </p>
                </div>
                <div>
                  <p className="kicker mb-2">Zones</p>
                  <ZoneStack row={selectedRow} />
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-faint">Select a symbol from either board.</p>
            )}
          </section>

          {board.sectors.length > 0 && (
            <section className="rounded-[14px] bg-card p-4 shadow-[inset_0_0_0_1px_var(--line)]">
              <p className="kicker mb-2">Sector flow</p>
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {board.sectors.slice(0, 12).map((s) => (
                  <li key={s.sector} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate text-muted-foreground">{s.sector}</span>
                    <span className={cn('mono font-semibold', s.avgStrength >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
                      {s.avgStrength >= 0 ? '+' : ''}
                      {s.avgStrength.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-[12px] leading-relaxed text-faint">{board.disclaimer}</p>
        </>
      )}

      {!board && !error && (
        <p className="text-[13px] text-faint">Board not loaded yet. Click Refresh board.</p>
      )}
    </div>
  );
}
