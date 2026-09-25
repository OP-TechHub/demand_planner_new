'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Package, Target, DollarSign, TrendingUp, ChevronDown, type LucideIcon } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, LabelList, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { MonthlyLineChart } from '@/components/charts/monthly-line-chart';
import { FulfilmentStackChart, type FulfilmentStackRow } from '@/components/charts/fulfilment-stack-chart';

/** Borrowed WR/FP fulfilled in a month, by the (source month, size bucket) it was harvested from. */
export type BorrowSource = { srcMonth: number; bucket: string; wr: number; fp: number };
/** One month of already-aggregated dashboard figures, for one program status. */
export type MonthPoint = {
  demand: number; fulfilled: number; wrUsed: number; wrNeeded: number; ownFp: number; ownWr: number;
  revenue: number; cost: number; secondaryRevenue: number; borrowSources: BorrowSource[];
};
/** Per-customer unfulfilled FP, one entry per month — ranked client-side within the range. */
export type ShortfallRow = { customer: string; months: number[] };
/** Per-product revenue (secondary or other product), one entry per month. */
export type ProductRow = { name: string; months: number[] };
export type StatusKey = 'active' | 'pipeline';
/** Everything the overview needs for one program status, over the whole horizon. */
export type StatusData = { monthly: MonthPoint[]; shortfall: ShortfallRow[]; secondaryProducts: ProductRow[] };
/** Other products sit outside the harvest plan and belong to no status. */
export type OtherData = { monthly: { revenue: number; cost: number }[]; products: ProductRow[] };

type ProgramFilter = 'all' | StatusKey;
const FILTERS: { key: ProgramFilter; label: string }[] = [
  { key: 'all', label: 'Combined' },
  { key: 'active', label: 'Active' },
  { key: 'pipeline', label: 'Pipeline' },
];

// Status colours (reserved): active = green, pipeline = amber.
const C_ACTIVE = '#16a34a';
const C_PIPELINE = '#d97706';

function kg(n: number) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n));
}
function usd(n: number) {
  return n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n).toLocaleString();
}
const usdExact = (n: number) => '$' + Math.round(n).toLocaleString();
/**
 * A breakdown-row amount: two decimals in the millions (the headline keeps one)
 * so the rows visibly reconcile to the headline, with the exact figure on hover.
 * Every part is rounded on its own, so at one decimal the parts can read $0.1M
 * off the total even though the underlying sum is exact.
 */
function Money({ n }: { n: number }) {
  const text = n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : usdExact(n);
  return <span title={usdExact(n)}>{text}</span>;
}

/** Sum the selected statuses into one dataset — combined = active + pipeline. */
function mergeStatuses(parts: StatusData[], horizon: number): StatusData {
  if (parts.length === 1) return parts[0]!;
  const monthly: MonthPoint[] = Array.from({ length: horizon }, (_, i) => {
    const srcs = new Map<string, BorrowSource>();
    const m: MonthPoint = { demand: 0, fulfilled: 0, wrUsed: 0, wrNeeded: 0, ownFp: 0, ownWr: 0, revenue: 0, cost: 0, secondaryRevenue: 0, borrowSources: [] };
    for (const p of parts) {
      const x = p.monthly[i];
      if (!x) continue;
      m.demand += x.demand; m.fulfilled += x.fulfilled; m.wrUsed += x.wrUsed; m.wrNeeded += x.wrNeeded;
      m.ownFp += x.ownFp; m.ownWr += x.ownWr; m.revenue += x.revenue; m.cost += x.cost; m.secondaryRevenue += x.secondaryRevenue;
      for (const s of x.borrowSources) {
        const key = `${s.srcMonth}:${s.bucket}`;
        const cur = srcs.get(key) ?? { srcMonth: s.srcMonth, bucket: s.bucket, wr: 0, fp: 0 };
        cur.wr += s.wr; cur.fp += s.fp;
        srcs.set(key, cur);
      }
    }
    m.borrowSources = [...srcs.values()].sort((a, b) => b.wr - a.wr);
    return m;
  });
  const mergeRows = <T extends { months: number[] }>(rows: T[][], keyOf: (r: T) => string, make: (key: string, months: number[]) => T): T[] => {
    const out = new Map<string, number[]>();
    for (const list of rows) for (const r of list) {
      const key = keyOf(r);
      let arr = out.get(key);
      if (!arr) { arr = new Array<number>(horizon).fill(0); out.set(key, arr); }
      for (let i = 0; i < horizon; i++) arr[i] += r.months[i] ?? 0;
    }
    return [...out.entries()].map(([k, m]) => make(k, m));
  };
  return {
    monthly,
    shortfall: mergeRows(parts.map((p) => p.shortfall), (r) => r.customer, (customer, months) => ({ customer, months })),
    secondaryProducts: mergeRows(parts.map((p) => p.secondaryProducts), (r) => r.name, (name, months) => ({ name, months })),
  };
}

/**
 * The headline stats + monthly charts, filtered to a month range and to a
 * program status. The server passes every month's totals per status; this
 * merges the statuses the filter selects, narrows to [from, to], and re-derives
 * every figure so the whole overview reflects both filters.
 */
export function DashboardOverview({
  active,
  pipeline,
  other,
  planStartDate,
  horizon,
}: {
  active: StatusData;
  pipeline: StatusData;
  other: OtherData;
  planStartDate: string;
  horizon: number;
}) {
  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(horizon);
  const [filter, setFilter] = useState<ProgramFilter>('all');
  const [sourceView, setSourceView] = useState<'chart' | 'table'>('chart');
  // Revenue card: the per-product lines under Secondary / Other products are
  // folded away until asked for.
  const [openSecondary, setOpenSecondary] = useState(false);
  const [openOther, setOpenOther] = useState(false);
  // 1-based month whose borrowings are drilled into (by source month × bucket).
  const [detailMonth, setDetailMonth] = useState<number | null>(null);
  const toggleDetail = (m: number) => setDetailMonth((cur) => (cur === m ? null : m));
  // Picking a start month proposes the twelve months from it, as the grids and
  // the Open to buy filter do. Only a proposal: the end month can be moved
  // after, and Reset puts the whole horizon back.
  const onFrom = (v: number) => { setFrom(v); setTo(Math.min(v + 11, horizon)); };
  const onTo = (v: number) => { setTo(v); if (v < from) setFrom(v); };
  const full = from === 1 && to === horizon;
  const combined = filter === 'all';

  // The dataset the whole overview reads: one status, or both summed.
  const data = useMemo(
    () => mergeStatuses(filter === 'active' ? [active] : filter === 'pipeline' ? [pipeline] : [active, pipeline], horizon),
    [filter, active, pipeline, horizon]
  );
  const { monthly, shortfall, secondaryProducts } = data;

  const slice = useMemo(() => monthly.slice(from - 1, to), [monthly, from, to]);
  const otherSlice = useMemo(() => other.monthly.slice(from - 1, to), [other, from, to]);
  const sumOver = (rows: MonthPoint[], f: (m: MonthPoint) => number) => rows.reduce((s, m) => s + f(m), 0);
  // Per-status totals over the range, for the Active / Pipeline rows on the cards.
  const statusTotals = useMemo(() => {
    const tot = (d: StatusData) => {
      const s = d.monthly.slice(from - 1, to);
      const revenue = sumOver(s, (m) => m.revenue);
      const cost = sumOver(s, (m) => m.cost);
      return { demand: sumOver(s, (m) => m.demand), wrNeeded: sumOver(s, (m) => m.wrNeeded), revenue, margin: revenue - cost };
    };
    return { active: tot(active), pipeline: tot(pipeline) };
  }, [active, pipeline, from, to]);

  const t = useMemo(() => {
    const demand = sumOver(slice, (m) => m.demand);
    const fulfilled = sumOver(slice, (m) => m.fulfilled);
    const wrUsed = sumOver(slice, (m) => m.wrUsed);
    const wrNeeded = sumOver(slice, (m) => m.wrNeeded);
    const ownFp = sumOver(slice, (m) => m.ownFp);
    const ownWr = sumOver(slice, (m) => m.ownWr);
    const primary = sumOver(slice, (m) => m.revenue);
    const programCost = sumOver(slice, (m) => m.cost);
    const secondary = sumOver(slice, (m) => m.secondaryRevenue);
    const otherRevenue = otherSlice.reduce((s, m) => s + m.revenue, 0);
    const otherCost = otherSlice.reduce((s, m) => s + m.cost, 0);
    // By-products carry no extra cost — the fish they come off is already costed
    // to the primary product — so secondary revenue drops straight into margin.
    // Other products are traded lines with their own per-unit cost.
    const revenue = primary + secondary + otherRevenue;
    const cost = programCost + otherCost;
    const margin = revenue - cost;
    return {
      demand, fulfilled, wrUsed, wrNeeded, revenue, primary, secondary, margin,
      otherRevenue, otherCost, programMargin: primary - programCost, otherMargin: otherRevenue - otherCost,
      ownFp, ownWr, borrowedFp: fulfilled - ownFp, borrowedWr: wrUsed - ownWr,
      fulPct: demand > 0 ? fulfilled / demand : 0,
      gp: revenue > 0 ? margin / revenue : 0,
    };
  }, [slice, otherSlice]);

  const chart = useMemo(
    () => slice.map((m, i) => ({ label: monthLabel(planStartDate, from + i), demand: m.demand, fulfilled: m.fulfilled })),
    [slice, planStartDate, from]
  );
  // How each month's demand was met: own-month harvest, borrowed from earlier
  // months, or not at all. Stacks to demand.
  const sourceRows = useMemo<FulfilmentStackRow[]>(
    () =>
      slice.map((m, i) => ({
        month: from + i,
        label: monthLabel(planStartDate, from + i),
        demand: m.demand,
        own: m.ownFp,
        borrowed: Math.max(0, m.fulfilled - m.ownFp),
        unfulfilled: Math.max(0, m.demand - m.fulfilled),
      })),
    [slice, planStartDate, from]
  );
  // Revenue vs. margin over the same range ($ axis).
  // Revenue here matches the KPI above — programs plus secondary and other products.
  const finChart = useMemo(
    () =>
      slice.map((m, i) => {
        const o = otherSlice[i] ?? { revenue: 0, cost: 0 };
        return {
          label: monthLabel(planStartDate, from + i),
          revenue: m.revenue + m.secondaryRevenue + o.revenue,
          margin: m.revenue + m.secondaryRevenue + o.revenue - m.cost - o.cost,
        };
      }),
    [slice, otherSlice, planStartDate, from]
  );
  // Active vs. pipeline demand over the range, for the pie — always both
  // statuses, so the split stays visible whichever one the filter shows.
  const pieData = [
    { name: 'Active', value: statusTotals.active.demand, color: C_ACTIVE },
    { name: 'Pipeline', value: statusTotals.pipeline.demand, color: C_PIPELINE },
  ];
  const pieTotal = statusTotals.active.demand + statusTotals.pipeline.demand;
  // Secondary and other products by name over the range, largest first, zeros dropped.
  const byName = (rows: ProductRow[]) =>
    rows
      .map((r) => ({ name: r.name, revenue: r.months.slice(from - 1, to).reduce((s, v) => s + v, 0) }))
      .filter((r) => r.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  const secondaryByName = useMemo(() => byName(secondaryProducts), [secondaryProducts, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const otherByName = useMemo(() => byName(other.products), [other, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const filterText = combined ? 'active + pipeline programs' : `${filter} programs only`;

  const statusDot = (color: string) => <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Programs</span>
          <div className="flex rounded-md border text-xs" role="radiogroup" aria-label="Programs shown">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5',
                  filter === f.key ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {f.key === 'active' && statusDot(C_ACTIVE)}
                {f.key === 'pipeline' && statusDot(C_PIPELINE)}
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {full ? `All ${horizon} months` : `${rangeText} · ${slice.length} of ${horizon} months`} · {filterText}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Package}
          tone="primary"
          label="Total Demand"
          value={`${kg(t.demand)} kg`}
          sub={`${full ? `${horizon} months` : rangeText}, FP`}
          foot={
            <>
              <div>{kg(t.wrNeeded)} kg WR needed to fulfil it</div>
              {combined && (
                <div className="mt-1.5 grid grid-cols-[auto_1fr_1fr] gap-x-3 text-[11px] font-normal text-muted-foreground">
                  <span />
                  <span className="text-right">kg FP</span>
                  <span className="text-right">kg WR</span>
                  <span className="flex items-center gap-1.5">{statusDot(C_ACTIVE)}Active</span>
                  <span className="text-right font-medium text-foreground">{kg(statusTotals.active.demand)}</span>
                  <span className="text-right font-medium text-foreground">{kg(statusTotals.active.wrNeeded)}</span>
                  <span className="flex items-center gap-1.5">{statusDot(C_PIPELINE)}Pipeline</span>
                  <span className="text-right font-medium text-foreground">{kg(statusTotals.pipeline.demand)}</span>
                  <span className="text-right font-medium text-foreground">{kg(statusTotals.pipeline.wrNeeded)}</span>
                </div>
              )}
            </>
          }
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
          foot={
            <>
              <div>{kg(t.wrUsed)} kg WR used to fulfil</div>
              <div className="mt-1.5 grid grid-cols-[auto_1fr_1fr] gap-x-3 text-[11px] font-normal text-muted-foreground">
                <span />
                <span className="text-right">kg FP</span>
                <span className="text-right">kg WR</span>
                <span>Own month</span>
                <span className="text-right font-medium text-foreground">{kg(t.ownFp)}</span>
                <span className="text-right font-medium text-foreground">{kg(t.ownWr)}</span>
                <span>Borrowed</span>
                <span className="text-right font-medium text-foreground">{kg(t.borrowedFp)}</span>
                <span className="text-right font-medium text-foreground">{kg(t.borrowedWr)}</span>
              </div>
            </>
          }
        />
        <Stat
          icon={DollarSign}
          tone="success"
          label="Revenue"
          value={usd(t.revenue)}
          valueTitle={usdExact(t.revenue)}
          sub="allocated — fulfilled volume × price"
          foot={
            <div className="grid grid-cols-[auto_1fr] gap-x-3 text-[11px] font-normal text-muted-foreground">
              {combined ? (
                <>
                  <span className="flex items-center gap-1.5">{statusDot(C_ACTIVE)}Active</span>
                  <span className="text-right font-medium text-foreground"><Money n={statusTotals.active.revenue} /></span>
                  <span className="flex items-center gap-1.5">{statusDot(C_PIPELINE)}Pipeline</span>
                  <span className="text-right font-medium text-foreground"><Money n={statusTotals.pipeline.revenue} /></span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5">{statusDot(filter === 'active' ? C_ACTIVE : C_PIPELINE)}Programs</span>
                  <span className="text-right font-medium text-foreground"><Money n={t.primary} /></span>
                </>
              )}
              <ProductGroup label="Secondary products" total={t.secondary} items={secondaryByName} open={openSecondary} onToggle={() => setOpenSecondary((v) => !v)} />
              <ProductGroup label="Other products" total={t.otherRevenue} items={otherByName} open={openOther} onToggle={() => setOpenOther((v) => !v)} />
            </div>
          }
        />
        <Stat
          icon={TrendingUp}
          tone="primary"
          label="Margin"
          value={usd(t.margin)}
          valueTitle={usdExact(t.margin)}
          sub={`GP ${(t.gp * 100).toFixed(1)}%`}
          // Secondary products carry no cost of their own, so every dollar they
          // earn is margin. Other products carry their own per-unit cost.
          foot={
            <div className="grid grid-cols-[auto_1fr] gap-x-3 text-[11px] font-normal text-muted-foreground">
              <span>Programs</span>
              <span className="text-right font-medium text-foreground"><Money n={t.programMargin} /></span>
              {combined && (
                <>
                  <span className="flex items-center gap-1.5 pl-3.5">{statusDot(C_ACTIVE)}Active</span>
                  <span className="text-right"><Money n={statusTotals.active.margin} /></span>
                  <span className="flex items-center gap-1.5 pl-3.5">{statusDot(C_PIPELINE)}Pipeline</span>
                  <span className="text-right"><Money n={statusTotals.pipeline.margin} /></span>
                </>
              )}
              <span>Secondary products</span>
              <span className="text-right font-medium text-foreground"><Money n={t.secondary} /></span>
              <span>Other products</span>
              <span className="text-right font-medium text-foreground"><Money n={t.otherMargin} /></span>
            </div>
          }
        />
      </div>

      {chart.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Monthly demand vs. fulfilled (kg FP)</h2>
            <span className="text-xs text-muted-foreground">{rangeText} · {filterText}</span>
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

      {sourceRows.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Where each month&apos;s fulfilment came from (kg FP)</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{rangeText} · {filterText}</span>
              <div className="flex rounded-md border text-xs" role="tablist" aria-label="View">
                {(['chart', 'table'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={sourceView === v}
                    onClick={() => setSourceView(v)}
                    className={cn('px-2.5 py-1 capitalize', sourceView === v ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {sourceView === 'chart' ? (
            <>
              <FulfilmentStackChart data={sourceRows} selected={detailMonth} onSelect={toggleDetail} />
              {detailMonth != null && detailMonth >= from && detailMonth <= to ? (
                <BorrowDetail
                  label={monthLabel(planStartDate, detailMonth)}
                  sources={monthly[detailMonth - 1]?.borrowSources ?? []}
                  planStartDate={planStartDate}
                  onClose={() => setDetailMonth(null)}
                />
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">Click a bar to see which months and size buckets the borrowed fish came from.</p>
              )}
            </>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-2 text-left font-medium">Month</th>
                    <th className="py-1.5 px-2 text-right font-medium">Demand</th>
                    <th className="py-1.5 px-2 text-right font-medium">Own month</th>
                    <th className="py-1.5 px-2 text-right font-medium">Borrowed</th>
                    <th className="py-1.5 px-2 text-right font-medium">Unfulfilled</th>
                    <th className="py-1.5 px-2 text-right font-medium">Fulfilled %</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Borrowed %</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((r) => {
                    const ful = r.own + r.borrowed;
                    const open = detailMonth === r.month;
                    return (
                      <Fragment key={r.month}>
                      <tr
                        className={cn('border-b last:border-0', r.borrowed > 0 && 'cursor-pointer hover:bg-muted/40', open && 'bg-muted/40')}
                        onClick={r.borrowed > 0 ? () => toggleDetail(r.month) : undefined}
                        title={r.borrowed > 0 ? 'Click to see where the borrowed fish came from' : undefined}
                      >
                        <td className="py-1 pr-2 text-left">
                          {r.borrowed > 0 && <span className="mr-1 inline-block w-3 text-muted-foreground">{open ? '▾' : '▸'}</span>}
                          {r.label}
                        </td>
                        <td className="py-1 px-2 text-right">{Math.round(r.demand).toLocaleString()}</td>
                        <td className="py-1 px-2 text-right">{Math.round(r.own).toLocaleString()}</td>
                        <td className="py-1 px-2 text-right">{Math.round(r.borrowed).toLocaleString()}</td>
                        <td className="py-1 px-2 text-right">{Math.round(r.unfulfilled).toLocaleString()}</td>
                        <td className="py-1 px-2 text-right">{r.demand > 0 ? Math.round((ful / r.demand) * 100) + '%' : '—'}</td>
                        <td className="py-1 pl-2 text-right">{ful > 0 ? Math.round((r.borrowed / ful) * 100) + '%' : '—'}</td>
                      </tr>
                      {open && (
                        <tr className="border-b bg-muted/20">
                          <td colSpan={7} className="px-2 py-2">
                            <BorrowDetail label={r.label} sources={monthly[r.month - 1]?.borrowSources ?? []} planStartDate={planStartDate} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="font-medium">
                  <tr className="border-t">
                    <td className="py-1.5 pr-2 text-left">Total</td>
                    <td className="py-1.5 px-2 text-right">{Math.round(t.demand).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right">{Math.round(t.ownFp).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right">{Math.round(t.borrowedFp).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right">{Math.round(Math.max(0, t.demand - t.fulfilled)).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right">{Math.round(t.fulPct * 100)}%</td>
                    <td className="py-1.5 pl-2 text-right">{t.fulfilled > 0 ? Math.round((t.borrowedFp / t.fulfilled) * 100) + '%' : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {finChart.length > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Revenue &amp; margin ($)</h2>
              <span className="text-xs text-muted-foreground">{rangeText} · {filterText}</span>
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
            <span className="text-xs text-muted-foreground">kg FP · all programs</span>
          </div>
          {pieTotal > 0 ? (
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
                  {pieData.map((d) => <Cell key={d.name} fill={d.color} fillOpacity={combined || d.name.toLowerCase() === filter ? 1 : 0.35} />)}
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
            <span className="text-xs text-muted-foreground">unfulfilled kg FP · {full ? `${horizon} months` : rangeText} · {filterText}</span>
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

/**
 * A collapsible row inside a card's breakdown grid: the group's label and total,
 * with a chevron that reveals one line per product beneath it. Renders as plain
 * grid cells (a Fragment) so it sits inside the two-column grid like the fixed rows.
 */
function ProductGroup({
  label,
  total,
  items,
  open,
  onToggle,
}: {
  label: string;
  total: number;
  items: { name: string; revenue: number }[];
  open: boolean;
  onToggle: () => void;
}) {
  const expandable = items.length > 0;
  return (
    <>
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className={cn('flex items-center gap-1.5 text-left', expandable ? 'hover:text-foreground' : 'cursor-default')}
        title={expandable ? (open ? 'Hide products' : `Show ${items.length} product${items.length === 1 ? '' : 's'}`) : undefined}
      >
        <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
        {label}
        {expandable && <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />}
      </button>
      <span className="text-right font-medium text-foreground"><Money n={total} /></span>
      {open && items.map((r) => (
        <Fragment key={r.name}>
          <span className="truncate pl-3.5" title={r.name}>{r.name}</span>
          <span className="text-right"><Money n={r.revenue} /></span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Where a month's borrowed fish came from: one row per (source month, size
 * bucket), largest WR first. FP is at the yield of the path the fish went
 * through, so the FP column sums to the month's Borrowed figure.
 */
function BorrowDetail({
  label,
  sources,
  planStartDate,
  onClose,
}: {
  label: string;
  sources: BorrowSource[];
  planStartDate: string;
  onClose?: () => void;
}) {
  const totWr = sources.reduce((s, r) => s + r.wr, 0);
  const totFp = sources.reduce((s, r) => s + r.fp, 0);
  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{label}</span>
          <span className="text-muted-foreground"> · borrowed {Math.round(totFp).toLocaleString()} kg FP from {Math.round(totWr).toLocaleString()} kg WR</span>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">✕</button>
        )}
      </div>
      {sources.length === 0 ? (
        <div className="text-muted-foreground">Nothing borrowed this month — all fulfilment came from its own harvest.</div>
      ) : (
        <table className="w-full tabular-nums">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="py-1 pr-2 text-left font-medium">From month</th>
              <th className="py-1 px-2 text-left font-medium">Size bucket</th>
              <th className="py-1 px-2 text-right font-medium">kg WR</th>
              <th className="py-1 px-2 text-right font-medium">kg FP</th>
              <th className="py-1 pl-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((r) => (
              <tr key={`${r.srcMonth}:${r.bucket}`} className="border-b last:border-0">
                <td className="py-1 pr-2 text-left">{monthLabel(planStartDate, r.srcMonth)}</td>
                <td className="py-1 px-2 text-left">{r.bucket}</td>
                <td className="py-1 px-2 text-right">{Math.round(r.wr).toLocaleString()}</td>
                <td className="py-1 px-2 text-right">{Math.round(r.fp).toLocaleString()}</td>
                <td className="py-1 pl-2 text-right">{totWr > 0 ? Math.round((r.wr / totWr) * 100) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  valueTitle,
  sub,
  foot,
}: {
  icon: LucideIcon;
  tone: 'primary' | 'accent' | 'success';
  label: string;
  value: string;
  /** Exact figure shown on hover, when the headline is rounded. */
  valueTitle?: string;
  sub?: string;
  /** Second figure in a different unit (e.g. the WR behind an FP headline). */
  foot?: ReactNode;
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
      <div className="mt-2 text-2xl font-semibold tracking-tight" title={valueTitle}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      {foot && <div className="mt-1.5 border-t pt-1.5 text-xs font-medium tabular-nums">{foot}</div>}
    </Card>
  );
}

const selectCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
