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
  const [m, setM] = useState(firstActive);

  const rows = programs.filter((p) => (p.demand[m] ?? 0) > 0);
  const totalDemand = programs.reduce((s, p) => s + (p.demand[m] ?? 0), 0);
  const totalFulfilled = programs.reduce((s, p) => s + (p.rolling[m] ?? 0), 0);
  const totalMargin = programs.reduce((s, p) => s + (p.margin[m] ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Fulfilment Optimizer</h1>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            Month
            <select value={m} onChange={(e) => setM(Number(e.target.value))} className="rounded-md border px-2 py-1 outline-none focus:ring-2 focus:ring-primary">
              {Array.from({ length: months }, (_, i) => <option key={i} value={i}>{monthLabel(planStartDate, i + 1)}</option>)}
            </select>
          </label>
          <span className="text-muted-foreground">Scope: {scope.replace(/_/g, ' ')}</span>
        </div>
      </div>

      <Section title="This month’s harvest (kg WR)">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-1">Bucket</th><th className="py-1 text-right">Capacity</th><th className="py-1 text-right">Used</th><th className="py-1 text-right">Left</th><th className="py-1 text-right">Util</th></tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.name} className="border-t">
                <td className="py-1 font-medium">{b.name}</td>
                <td className="py-1 text-right tabular-nums">{num(b.capacity[m] ?? 0)}</td>
                <td className="py-1 text-right tabular-nums">{num(b.used[m] ?? 0)}</td>
                <td className="py-1 text-right tabular-nums">{num(b.left[m] ?? 0)}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">{pctOf(b.used[m] ?? 0, b.capacity[m] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="This month’s demand fulfilment">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No in-scope demand this month.</p>
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
                  const dem = p.demand[m] ?? 0, own = p.own[m] ?? 0, roll = p.rolling[m] ?? 0;
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
