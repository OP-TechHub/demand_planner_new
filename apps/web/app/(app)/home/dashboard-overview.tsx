'use client';

import { useMemo, useState } from 'react';
import { Package, Target, DollarSign, TrendingUp, type LucideIcon } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, LabelList, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { MonthlyLineChart } from '@/components/charts/monthly-line-chart';

/** One month of already-aggregated dashboard figures (across all programs). */
export type MonthPoint = { demand: number; fulfilled: number; wrUsed: number; wrNeeded: number; revenue: number; secondaryRevenue: number; cost: number; activeDemand: number; pipelineDemand: number };
/** Per-customer unfulfilled FP, one entry per month — ranked client-side within the range. */
export type ShortfallRow = { customer: string; months: number[] };

// Status colours (reserved): active = green, pipeline = amber.
const C_ACTIVE = '#16a34a';
const C_PIPELINE = '#d97706';

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
  shortfall,
  planStartDate,
  horizon,
}: {
  monthly: MonthPoint[];
  shortfall: ShortfallRow[];
  planStartDate: string;
  horizon: number;
}) {
  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(horizon);
  // Picking a start month proposes the twelve months from it, as the grids and
  // the Open to buy filter do. Only a proposal: the end month can be moved
  // after, and Reset puts the whole horizon back.
  const onFrom = (v: number) => { setFrom(v); setTo(Math.min(v + 11, horizon)); };
  const onTo = (v: number) => { setTo(v); if (v < from) setFrom(v); };
  const full = from === 1 && to === horizon;

  const slice = useMemo(() => monthly.slice(from - 1, to), [monthly, from, to]);
  const t = useMemo(() => {
    const demand = slice.reduce((s, m) => s + m.demand, 0);
    const fulfilled = slice.reduce((s, m) => s + m.fulfilled, 0);
    const wrUsed = slice.reduce((s, m) => s + m.wrUsed, 0);
    const wrNeeded = slice.reduce((s, m) => s + m.wrNeeded, 0);
    const primary = slice.reduce((s, m) => s + m.revenue, 0);
    const secondary = slice.reduce((s, m) => s + m.secondaryRevenue, 0);
    const cost = slice.reduce((s, m) => s + m.cost, 0);
    // By-products carry no extra cost — the fish they come off is already costed
    // to the primary product — so secondary revenue drops straight into margin.
    const revenue = primary + secondary;
    const margin = revenue - cost;
    return {
      demand, fulfilled, wrUsed, wrNeeded, revenue, primary, secondary, margin,
      fulPct: demand > 0 ? fulfilled / demand : 0,
      gp: revenue > 0 ? margin / revenue : 0,
    };
  }, [slice]);

  const chart = useMemo(
    () => slice.map((m, i) => ({ label: monthLabel(planStartDate, from + i), demand: m.demand, fulfilled: m.fulfilled })),
    [slice, planStartDate, from]
  );
  // Revenue vs. margin over the same range ($ axis).
  // Revenue here matches the KPI above — primary plus secondary products.
  const finChart = useMemo(
    () =>
      slice.map((m, i) => ({
        label: monthLabel(planStartDate, from + i),
        revenue: m.revenue + m.secondaryRevenue,
        margin: m.revenue + m.secondaryRevenue - m.cost,
      })),
    [slice, planStartDate, from]
  );
  // Active vs. pipeline demand over the range, for the pie.
  const split = useMemo(() => {
    const active = slice.reduce((s, m) => s + m.activeDemand, 0);
    const pipeline = slice.reduce((s, m) => s + m.pipelineDemand, 0);
    return { active, pipeline, total: active + pipeline };
  }, [slice]);
  const pieData = [
    { name: 'Active', value: split.active, color: C_ACTIVE },
    { name: 'Pipeline', value: split.pipeline, color: C_PIPELINE },
  ];
  // Shortfall is ranked *within* the range — the top 8 for Jan–Mar aren't
  // necessarily the top 8 over 60 months, so sum first, then sort and slice.
  const topShortfall = useMemo(
    () =>
      shortfall
        .map((r) => ({ customer: r.customer, shortfall: r.months.slice(from - 1, to).reduce((s, v) => s + v, 0) }))
        .filter((r) => r.shortfall > 0)
        .sort((a, b) => b.shortfall - a.shortfall)
        .slice(0, 8),
    [shortfall, from, to]
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
        <span className="text-xs text-muted-foreground">
          {full ? `All ${horizon} months` : `${rangeText} · ${slice.length} of ${horizon} months`}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Package}
          tone="primary"
          label="Total Demand"
          value={`${kg(t.demand)} kg`}
          sub={`${full ? `${horizon} months` : rangeText}, FP`}
          foot={`${kg(t.wrNeeded)} kg WR needed to fulfil it`}
        />
        {/*
          The whole round consumed is `rolling_wr` — what the engine actually
          allocated to produce the FP above it, not what the demand book would
          have needed. It belongs to Fulfilled, not Total Demand.
        */}
        <Stat
          icon={Target}
          tone="accent"
          label="Fulfilled"
          value={`${(t.fulPct * 100).toFixed(0)}%`}
          sub={`${kg(t.fulfilled)} kg FP`}
          foot={`${kg(t.wrUsed)} kg WR used to fulfil`}
        />
        <Stat
          icon={DollarSign}
          tone="success"
          label="Revenue"
          value={usd(t.revenue)}
          sub="allocated"
          foot={t.secondary > 0 ? `incl. ${usd(t.secondary)} from secondary products` : undefined}
        />
        <Stat
          icon={TrendingUp}
          tone="primary"
          label="Margin"
          value={usd(t.margin)}
          sub={`GP ${(t.gp * 100).toFixed(1)}%`}
          // Secondary products carry no cost of their own, so every dollar they
          // earn is margin — the contribution equals the secondary revenue exactly.
          foot={t.secondary > 0 ? `incl. ${usd(t.secondary)} from secondary products` : undefined}
        />
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

      <div className="grid gap-4 lg:grid-cols-2">
        {finChart.length > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Revenue &amp; margin ($)</h2>
              <span className="text-xs text-muted-foreground">{rangeText}</span>
            </div>
            <MonthlyLineChart
              data={finChart}
              series={[
                { key: 'revenue', name: 'Revenue', color: '#2a78d6' },
                { key: 'margin', name: 'Margin', color: '#eb6834' },
              ]}
              format="usd"
            />
          </Card>
        )}

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Active vs. pipeline demand</h2>
            <span className="text-xs text-muted-foreground">kg FP</span>
          </div>
          {split.total > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="#ffffff"
                  strokeWidth={2}
                  isAnimationActive={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip
                  formatter={(v: number, n) => [`${Math.round(v).toLocaleString()} kg`, n as string]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">No demand in this range.</div>
          )}
        </Card>
      </div>

      {shortfall.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Top customers by shortfall</h2>
            <span className="text-xs text-muted-foreground">unfulfilled kg FP · {full ? `${horizon} months` : rangeText}</span>
          </div>
          {topShortfall.length === 0 ? (
            <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">No shortfall in this range.</div>
          ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, topShortfall.length * 34)}>
            <BarChart data={topShortfall} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v) => kg(Number(v))} />
              <YAxis type="category" dataKey="customer" width={120} tick={{ fontSize: 11, fill: '#334155' }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: '#94a3b8', fillOpacity: 0.1 }}
                formatter={(v: number) => [`${Math.round(v).toLocaleString()} kg`, 'Shortfall']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="shortfall" fill="#dc2626" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
                <LabelList dataKey="shortfall" position="right" formatter={(v: number) => kg(Number(v))} style={{ fontSize: 10, fill: '#64748b' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          )}
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
  foot,
}: {
  icon: LucideIcon;
  tone: 'primary' | 'accent' | 'success';
  label: string;
  value: string;
  sub?: string;
  /** Second figure in a different unit (e.g. the WR behind an FP headline). */
  foot?: string;
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
      {foot && <div className="mt-1.5 border-t pt-1.5 text-xs font-medium tabular-nums">{foot}</div>}
    </Card>
  );
}

const selectCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
