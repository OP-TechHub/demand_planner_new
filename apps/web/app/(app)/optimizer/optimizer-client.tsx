'use client';

import { useMemo, useState } from 'react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';

export interface OptProgram { rank: number; label: string; sublabel: string; demand: number[]; own: number[]; rolling: number[]; margin: number[] }
export interface OptBucket { name: string; capacity: number[]; used: number[]; left: number[] }

const num = (v: number) => Math.round(v).toLocaleString();
const pctOf = (a: number, b: number) => (b > 0 ? (100 * a / b).toFixed(0) + '%' : '—');

export function OptimizerClient({
  months,
  planStartDate,
  scope,
  programs,
  buckets,
}: {
  months: number;
  planStartDate: string;
  scope: string;
  programs: OptProgram[];
  buckets: OptBucket[];
}) {
  const firstActive = useMemo(() => {
    for (let i = 0; i < months; i++) if (programs.some((p) => p.demand[i]! > 0)) return i;
    return 0;
  }, [months, programs]);

  // Month INDEXES (0-based), inclusive at both ends. Opens on the first month
  // with demand, as it always has — one month is still the view that shows a
  // constraint most plainly, and the range is there to widen it.
  const [from, setFrom] = useState(firstActive);
  const [to, setTo] = useState(firstActive);

  // Keep the range coherent: pushing one end past the other carries the other with it.
  const onFrom = (v: number) => { setFrom(v); if (v > to) setTo(v); };
  const onTo = (v: number) => { setTo(v); if (v < from) setFrom(v); };

  const span = to - from + 1;
  const oneMonth = span === 1;
  const fullRange = from === 0 && to === months - 1;
  /** Every figure on this page is its monthly series added up over the range. */
  const over = (arr: number[]) => {
    let s = 0;
    for (let i = from; i <= to; i++) s += arr[i] ?? 0;
    return s;
  };
  const periodLabel = oneMonth
    ? monthLabel(planStartDate, from + 1)
    : `${monthLabel(planStartDate, from + 1)} – ${monthLabel(planStartDate, to + 1)}`;

  const rows = programs.filter((p) => over(p.demand) > 0);
  const totalDemand = programs.reduce((s, p) => s + over(p.demand), 0);
  const totalFulfilled = programs.reduce((s, p) => s + over(p.rolling), 0);
  const totalMargin = programs.reduce((s, p) => s + over(p.margin), 0);
  const totalCapacity = buckets.reduce((s, b) => s + over(b.capacity), 0);
  const totalUsed = buckets.reduce((s, b) => s + over(b.used), 0);
  const totalLeft = buckets.reduce((s, b) => s + over(b.left), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Fulfilment Optimizer</h1>
        <span className="text-sm text-muted-foreground">Scope: {scope.replace(/_/g, ' ')}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Months</span>
        <select value={from} onChange={(e) => onFrom(Number(e.target.value))} aria-label="From month" className={selectCls}>
          {Array.from({ length: months }, (_, i) => <option key={i} value={i}>{monthLabel(planStartDate, i + 1)}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">to</span>
        <select value={to} onChange={(e) => onTo(Number(e.target.value))} aria-label="To month" className={selectCls}>
          {Array.from({ length: months }, (_, i) => <option key={i} value={i}>{monthLabel(planStartDate, i + 1)}</option>)}
        </select>
        {!fullRange && (
          <button type="button" onClick={() => { setFrom(0); setTo(months - 1); }} className="text-xs font-medium text-primary hover:underline">
            Full horizon
          </button>
        )}
        {!oneMonth && (
          <button type="button" onClick={() => setTo(from)} className="text-xs font-medium text-primary hover:underline">
            Single month
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {oneMonth ? periodLabel : `${periodLabel} · ${span} of ${months} months`}
        </span>
      </div>

      <Section title={`Harvest — ${periodLabel} (kg WR)`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-1">Bucket</th><th className="py-1 text-right">Capacity</th><th className="py-1 text-right">Used</th><th className="py-1 text-right">Left</th><th className="py-1 text-right">Util</th></tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              const cap = over(b.capacity), used = over(b.used), left = over(b.left);
              return (
                <tr key={b.name} className="border-t">
                  <td className="py-1 font-medium">{b.name}</td>
                  <td className="py-1 text-right tabular-nums">{num(cap)}</td>
                  <td className="py-1 text-right tabular-nums">{num(used)}</td>
                  <td className="py-1 text-right tabular-nums">{num(left)}</td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">{pctOf(used, cap)}</td>
                </tr>
              );
            })}
          </tbody>
          {buckets.length > 0 && (
            <tfoot className="border-t-2 font-medium">
              <tr>
                <td className="py-1">Total</td>
                <td className="py-1 text-right tabular-nums">{num(totalCapacity)}</td>
                <td className="py-1 text-right tabular-nums">{num(totalUsed)}</td>
                <td className="py-1 text-right tabular-nums">{num(totalLeft)}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">{pctOf(totalUsed, totalCapacity)}</td>
              </tr>
            </tfoot>
          )}
        </table>
        {!oneMonth && (
          <p className="mt-2 text-xs text-muted-foreground">
            Capacity, use and spare added up across the {span} months — a bucket that is tight in one month and idle the
            next reads as comfortable here, so narrow the range to find the pinch.
          </p>
        )}
      </Section>

      <Section title={`Demand fulfilment — ${periodLabel}`}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No in-scope demand in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1">Rank</th><th className="py-1">Program</th>
                  <th className="py-1 text-right">Demand FP</th><th className="py-1 text-right">Own FP</th>
                  <th className="py-1 text-right">Borrowed</th><th className="py-1 text-right">Fulfilled</th><th className="py-1 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const dem = over(p.demand), own = over(p.own), roll = over(p.rolling);
                  const borrowed = Math.max(0, roll - own);
                  const full = dem > 0 ? roll / dem : 0;
                  return (
                    <tr key={p.rank + p.label} className="border-t">
                      <td className="py-1 text-muted-foreground">{p.rank}</td>
                      <td className="max-w-[16rem] truncate py-1" title={`${p.label} — ${p.sublabel}`}><span className="font-medium">{p.label}</span> <span className="text-muted-foreground">{p.sublabel}</span></td>
                      <td className="py-1 text-right tabular-nums">{num(dem)}</td>
                      <td className="py-1 text-right tabular-nums">{num(own)}</td>
                      <td className="py-1 text-right tabular-nums">{num(borrowed)}</td>
                      <td className="py-1 text-right tabular-nums">{num(roll)}</td>
                      <td className={cn('py-1 text-right tabular-nums', full >= 0.999 ? 'text-green-700' : full < 0.8 ? 'text-red-700' : 'text-amber-700')}>{pctOf(roll, dem)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total demand FP" value={`${num(totalDemand)} kg`} />
        <Stat label="Total fulfilled" value={`${num(totalFulfilled)} kg`} sub={pctOf(totalFulfilled, totalDemand)} />
        <Stat label="Total margin" value={`$${num(totalMargin)}`} />
      </div>
    </div>
  );
}

const selectCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}{sub && <span className="ml-1 text-sm font-normal text-muted-foreground">({sub})</span>}</div>
    </div>
  );
}
