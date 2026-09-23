'use client';

import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { ProgramLabel } from '@/components/program-label';
import { useResizableColumn } from '@/components/resizable-column';

/** One horizon month of a program, as the engine and the demand plan see it. */
export interface MonthCell {
  /** Demand FP for the month: the demand-plan override, else the program's max monthly demand. */
  demand: number;
  /** From the last Recalculate; null when the engine produced nothing for this program-month. */
  fulfilled: number | null;
  revenue: number | null;
  margin: number | null;
}

export interface RankRow {
  id: string;
  /** The engine's allocation priority; null when the program is outside the plan's scope. */
  engineRank: number | null;
  customer: string;
  item: string;
  status: string;
  locked: boolean;
  bucket: string;
  /** Per kg of finished product, primary path. */
  price: number;
  costFp: number;
  marginFp: number;
  marginWr: number;
  /** One entry per horizon month, index 0 = M1. The page totals these over the chosen date range. */
  monthly: MonthCell[];
}

/** A row with its month-based figures totalled over the selected range. */
type Totalled = RankRow & {
  demand: number;
  fulfilled: number | null;
  revenue: number | null;
  margin: number | null;
};

/**
 * Sum a program's months from..to (1-based, inclusive). A result figure stays
 * null only when the engine produced nothing for any month in the range, so a
 * program allocated in some months and not others still gets a total.
 */
function totalOver(r: RankRow, from: number, to: number): Totalled {
  let demand = 0;
  let fulfilled: number | null = null;
  let revenue: number | null = null;
  let margin: number | null = null;
  for (const c of r.monthly.slice(from - 1, to)) {
    demand += c.demand;
    if (c.fulfilled != null) fulfilled = (fulfilled ?? 0) + c.fulfilled;
    if (c.revenue != null) revenue = (revenue ?? 0) + c.revenue;
    if (c.margin != null) margin = (margin ?? 0) + c.margin;
  }
  return { ...r, demand, fulfilled, revenue, margin };
}

type Basis =
  | 'marginFp' | 'marginPct' | 'marginWr' | 'contribution' | 'price'
  | 'margin' | 'gpPct' | 'revenue' | 'engine';

/** Each option ranks highest-first, except plan priority, where 1 is first. */
const BASES: { key: Basis; label: string; group: string }[] = [
  { key: 'marginFp', label: 'Margin per kg FP', group: 'Profitability per kg' },
  { key: 'marginPct', label: 'Margin %', group: 'Profitability per kg' },
  { key: 'marginWr', label: 'Margin per kg WR', group: 'Profitability per kg' },
  { key: 'price', label: 'Price per kg FP', group: 'Profitability per kg' },
  { key: 'contribution', label: 'Total contribution (margin/kg × demand)', group: 'Over the date range' },
  { key: 'margin', label: 'Plan margin $', group: 'Over the date range' },
  { key: 'revenue', label: 'Plan revenue $', group: 'Over the date range' },
  { key: 'gpPct', label: 'Plan GP %', group: 'Over the date range' },
  { key: 'engine', label: 'Plan priority (allocation order)', group: 'Engine' },
];

// The plan's margin metric, as the matching dropdown option — the page opens on it.
const METRIC_BASIS: Record<string, Basis> = { margin_fp: 'marginFp', margin_wr: 'marginWr', total_contribution: 'contribution' };

const STATUSES = ['all', 'active', 'pipeline', 'inactive'] as const;

/** The number a row is ranked on; null sorts to the bottom (no value to rank). */
function score(r: Totalled, b: Basis): number | null {
  switch (b) {
    case 'marginFp': return r.marginFp;
    case 'marginPct': return r.price > 0 ? r.marginFp / r.price : null;
    case 'marginWr': return r.marginWr;
    case 'price': return r.price;
    case 'contribution': return r.marginFp * r.demand;
    case 'margin': return r.margin;
    case 'revenue': return r.revenue;
    case 'gpPct': return r.revenue ? (r.margin ?? 0) / r.revenue : null;
    case 'engine': return r.engineRank;
  }
}

const usd = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (v: number) => Math.round(v).toLocaleString();
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : '—');
const dash = (v: number | null, f: (v: number) => string) => (v == null ? '—' : f(v));

export function RankingClient({
  rows,
  metric,
  planStartDate,
  horizon,
}: {
  rows: RankRow[];
  metric: string;
  planStartDate: string;
  horizon: number;
}) {
  const [basis, setBasis] = useState<Basis>(METRIC_BASIS[metric] ?? 'marginFp');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const nameCol = useResizableColumn('ranking-program', 288);

  // Date range, as on the dashboard: picking a start month proposes the twelve
  // months from it; the end month can be moved after, and Reset restores the
  // whole horizon. Per-kg figures and the engine priority don't depend on it.
  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(horizon);
  const onFrom = (v: number) => { setFrom(v); setTo(Math.min(v + 11, horizon)); };
  const onTo = (v: number) => { setTo(v); if (v < from) setFrom(v); };
  const full = from === 1 && to === horizon;
  const span = to - from + 1;
  const rangeText = `${monthLabel(planStartDate, from)} – ${monthLabel(planStartDate, to)}`;

  const ranked = useMemo(() => {
    const dir = basis === 'engine' ? 1 : -1;
    return rows
      .filter((r) => status === 'all' || r.status === status)
      .map((r) => totalOver(r, from, to))
      .map((r) => ({ r, s: score(r, basis) }))
      .sort((a, b) => {
        if (a.s == null || b.s == null) return a.s == null ? (b.s == null ? 0 : 1) : -1;
        return dir * (a.s - b.s) || a.r.customer.localeCompare(b.r.customer);
      })
      .map(({ r, s }, i) => ({ ...r, pos: s == null ? null : i + 1 }));
  }, [rows, basis, status, from, to]);

  const shown = ranked.length;
  const totalRevenue = ranked.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const totalMargin = ranked.reduce((s, r) => s + (r.margin ?? 0), 0);
  const unranked = ranked.filter((r) => r.pos == null).length;

  // Shade the column the list is currently ranked on.
  const on = (b: Basis) => (b === basis ? 'bg-primary/10 font-semibold' : undefined);
  const num = (b: Basis, extra?: string) => cn('px-2 py-1.5 text-right tabular-nums', on(b), extra);
  const hd = (b: Basis) => cn('whitespace-nowrap px-2 py-2 text-right', b === basis && 'bg-primary/10 text-foreground');
  const neg = (v: number | null) => (v != null && v < 0 ? 'text-red-700' : undefined);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Program Ranking</h1>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Rank by</span>
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} className={selectCls}>
            {[...new Set(BASES.map((b) => b.group))].map((g) => (
              <optgroup key={g} label={g}>
                {BASES.filter((b) => b.group === g).map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selectCls}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All programs' : s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Date range</span>
          <select value={from} onChange={(e) => onFrom(Number(e.target.value))} className={selectCls} aria-label="From month">
            {months.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">to</span>
          <select value={to} onChange={(e) => onTo(Number(e.target.value))} className={selectCls} aria-label="To month">
            {months.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
          </select>
          {!full && (
            <button type="button" onClick={() => { setFrom(1); setTo(horizon); }} className="text-xs font-medium text-primary hover:underline">
              Reset
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            {full ? `All ${horizon} months` : `${rangeText} · ${span} of ${horizon} months`}
          </span>
        </div>
      </div>

      <p className="max-w-4xl text-xs text-muted-foreground">
        Every program in the plan, ranked 1…{shown} on the measure you pick, best first. The <b>per-kg</b> figures are
        each program&apos;s primary-path price and loaded cost. The <b>plan</b> figures are totals for{' '}
        {full ? 'the whole horizon' : <b>{rangeText}</b>} from the last Recalculate, excluding secondary products. They
        read “—” for programs the engine didn&apos;t allocate in that range, which drop to the bottom when you rank on
        them. <b>Plan priority</b> is the order the engine actually hands out supply in: locked programs first, then by
        the plan&apos;s margin setting within each bucket.
        {unranked > 0 && <> {unranked} program{unranked === 1 ? ' has' : 's have'} no value on this measure and {unranked === 1 ? 'is' : 'are'} listed last, unranked.</>}
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Programs listed" value={String(shown)} />
        <Stat label={full ? 'Plan revenue' : `Revenue · ${rangeText}`} value={usd(totalRevenue)} />
        <Stat label={full ? 'Plan margin' : `Margin · ${rangeText}`} value={usd(totalMargin)} sub={pct(totalMargin, totalRevenue)} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-2">Rank</th>
              <th style={nameCol.style} className="relative px-2 py-2">Program{nameCol.handle}</th>
              <th className="px-2 py-2">Bucket</th>
              <th className={hd('price')}>Price /kg</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">Cost /kg</th>
              <th className={hd('marginFp')}>Margin /kg FP</th>
              <th className={hd('marginPct')}>Margin %</th>
              <th className={hd('marginWr')}>Margin /kg WR</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">Demand kg</th>
              <th className={hd('contribution')}>Contribution</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">Fulfilled</th>
              <th className={hd('revenue')}>Plan revenue</th>
              <th className={hd('margin')}>Plan margin</th>
              <th className={hd('gpPct')}>GP %</th>
              <th className={hd('engine')}>Priority</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.id} className={cn('border-t', r.status === 'inactive' && 'text-muted-foreground')}>
                <td className="px-2 py-1.5 font-semibold tabular-nums">{r.pos ?? '—'}</td>
                <td style={nameCol.style} className="px-2 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <ProgramLabel name={r.customer} detail={r.item} className="min-w-0" />
                    {r.status !== 'active' && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{r.status}</span>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{r.bucket}</td>
                <td className={num('price')}>{usd2(r.price)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{usd2(r.costFp)}</td>
                <td className={num('marginFp', neg(r.marginFp))}>{usd2(r.marginFp)}</td>
                <td className={num('marginPct', neg(r.marginFp))}>{pct(r.marginFp, r.price)}</td>
                <td className={num('marginWr', neg(r.marginWr))}>{usd2(r.marginWr)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{kg(r.demand)}</td>
                <td className={num('contribution', neg(r.marginFp))}>{usd(r.marginFp * r.demand)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.fulfilled == null ? '—' : pct(r.fulfilled, r.demand)}</td>
                <td className={num('revenue')}>{dash(r.revenue, usd)}</td>
                <td className={num('margin', neg(r.margin))}>{dash(r.margin, usd)}</td>
                <td className={num('gpPct', neg(r.margin))}>{r.revenue ? pct(r.margin ?? 0, r.revenue) : '—'}</td>
                <td className={num('engine')}>
                  <span className="inline-flex items-center gap-1">
                    {r.locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Locked" />}
                    {r.engineRank ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const selectCls = 'rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}{sub && <span className="ml-1 text-sm font-normal text-muted-foreground">({sub})</span>}</div>
    </div>
  );
}
