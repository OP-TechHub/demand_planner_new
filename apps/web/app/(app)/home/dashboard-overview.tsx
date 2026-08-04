'use client';

import { useMemo, useState } from 'react';
import { Package, Target, DollarSign, TrendingUp, type LucideIcon } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { MonthlyLineChart } from '@/components/charts/monthly-line-chart';

/** One month of already-aggregated dashboard figures (across all programs). */
export type MonthPoint = { demand: number; fulfilled: number; revenue: number; cost: number };

function kg(n: number) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n));
}
function usd(n: number) {
  return n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n).toLocaleString();
}

/**
 * The headline stats + monthly chart, filtered to a month range. The server
 * passes every month's totals; this narrows them to [from, to] and re-derives
 * the four stats and the chart so the whole overview reflects the range.
 */
export function DashboardOverview({
  monthly,
  planStartDate,
  horizon,
}: {
  monthly: MonthPoint[];
  planStartDate: string;
  horizon: number;
}) {
  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(horizon);
  const onFrom = (v: number) => { setFrom(v); if (v > to) setTo(v); };
  const onTo = (v: number) => { setTo(v); if (v < from) setFrom(v); };
  const full = from === 1 && to === horizon;

  const slice = useMemo(() => monthly.slice(from - 1, to), [monthly, from, to]);
  const t = useMemo(() => {
    const demand = slice.reduce((s, m) => s + m.demand, 0);
    const fulfilled = slice.reduce((s, m) => s + m.fulfilled, 0);
    const revenue = slice.reduce((s, m) => s + m.revenue, 0);
    const cost = slice.reduce((s, m) => s + m.cost, 0);
    const margin = revenue - cost;
    return { demand, fulfilled, revenue, margin, fulPct: demand > 0 ? fulfilled / demand : 0, gp: revenue > 0 ? margin / revenue : 0 };
  }, [slice]);

  const chart = useMemo(
    () => slice.map((m, i) => ({ label: monthLabel(planStartDate, from + i), demand: m.demand, fulfilled: m.fulfilled })),
    [slice, planStartDate, from]
  );
  const rangeText = `${monthLabel(planStartDate, from)} – ${monthLabel(planStartDate, to)}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Time range</span>
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
        <span className="text-xs text-muted-foreground">{slice.length} of {horizon} months</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Package} tone="primary" label="Total Demand" value={`${kg(t.demand)} kg`} sub={`${full ? `${horizon} months` : rangeText}, FP`} />
        <Stat icon={Target} tone="accent" label="Fulfilled" value={`${(t.fulPct * 100).toFixed(0)}%`} sub={`${kg(t.fulfilled)} kg FP`} />
        <Stat icon={DollarSign} tone="success" label="Revenue" value={usd(t.revenue)} sub="allocated" />
        <Stat icon={TrendingUp} tone="primary" label="Margin" value={usd(t.margin)} sub={`GP ${(t.gp * 100).toFixed(1)}%`} />
      </div>

      {chart.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Monthly demand vs. fulfilled (kg FP)</h2>
            <span className="text-xs text-muted-foreground">{rangeText}</span>
          </div>
          <MonthlyLineChart
            data={chart}
            series={[
              { key: 'demand', name: 'Demand', color: '#2a78d6', dashed: true },
              { key: 'fulfilled', name: 'Fulfilled', color: '#eb6834' },
            ]}
            format="kg"
          />
        </Card>
      )}
    </>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  tone: 'primary' | 'accent' | 'success';
  label: string;
  value: string;
  sub?: string;
}) {
  const tones = {
    primary: 'bg-primary/10 text-primary',
    accent: 'bg-accent/10 text-accent',
    success: 'bg-success/12 text-success',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-md', tones[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

const selectCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
