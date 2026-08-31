'use client';

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toCsv, downloadCsv } from '@/lib/csv';
import { gridCsvRows } from '@/lib/grid-csv';
import { OutputGrid, type FmtKey, type GridRow } from '@/components/output-grid';
import type { CompareMetric, CompareSeries, MonthlyCompare as Data } from '@/lib/plan-compare';

/** What the grid shows: each plan on its own, or the movement between them. */
const VIEWS = [
  { key: 'change', label: 'Change' },
  { key: 'changePct', label: 'Change %' },
  { key: 'a', label: 'Plan A' },
  { key: 'b', label: 'Plan B' },
] as const;
type View = (typeof VIEWS)[number]['key'];

/** Sentinel for "show the whole cost, not one component". */
const ALL_PARTS = '__all__';

/**
 * A month either plan doesn't cover has no value on that side. Treating it as 0
 * would report the whole of the other plan's figure as a "change", when the
 * truth is that there was never a plan there to change from.
 */
function buildRows(rows: CompareSeries[], view: View): GridRow[] {
  return rows.map((r) => {
    const values: (number | null)[] = [];
    const weights: number[] = [];
    for (let i = 0; i < r.a.length; i++) {
      const a = r.a[i] ?? null;
      const b = r.b[i] ?? null;
      if (view === 'a') { values.push(a); weights.push(0); continue; }
      if (view === 'b') { values.push(b); weights.push(0); continue; }
      if (a == null && b == null) { values.push(null); weights.push(0); continue; }
      // Where one side is absent, the honest baseline is the other plan's 0 — a
      // program that ran in A and not in B really did drop to nothing.
      const av = a ?? 0;
      const bv = b ?? 0;
      if (view === 'change') { values.push(bv - av); weights.push(0); continue; }
      // A percentage against a zero baseline is undefined, not infinite.
      values.push(av === 0 ? null : (bv - av) / av);
      weights.push(av);
    }
    return { key: r.key, label: r.label, sublabel: r.sublabel, values, weights };
  });
}

/** One cost component's monthly figure: the program's volume × its rate in that plan. */
function componentSeries(volume: CompareSeries[], rates: Record<string, { a: number; b: number }>): CompareSeries[] {
  return volume.map((r) => {
    const rate = rates[r.key] ?? { a: 0, b: 0 };
    return {
      ...r,
      a: r.a.map((v) => (v == null ? null : v * rate.a)),
      b: r.b.map((v) => (v == null ? null : v * rate.b)),
    };
  });
}

export function MonthlyCompare({ data, aName, bName }: { data: Data; aName: string; bName: string }) {
  const [metricKey, setMetricKey] = useState(data.metrics[0]?.key ?? '');
  const [view, setView] = useState<View>('change');
  const [part, setPart] = useState(ALL_PARTS);

  const metric: CompareMetric | undefined = data.metrics.find((m) => m.key === metricKey) ?? data.metrics[0];
  const volume = data.metrics.find((m) => m.key === 'volume');
  const showParts = metric?.key === 'cost' && data.costComponents.length > 0 && !!volume;
  const activePart = showParts && part !== ALL_PARTS ? data.costComponents.find((c) => c.key === part) : undefined;

  const series = useMemo(() => {
    if (!metric) return [];
    if (activePart && volume) return componentSeries(volume.rows, activePart.rates);
    return metric.rows;
  }, [metric, activePart, volume]);

  const rows = useMemo(() => buildRows(series, view), [series, view]);

  if (!metric) return null;

  const pctView = view === 'changePct';
  const format: FmtKey = pctView ? 'pct' : metric.format;
  const title = `${metric.label}${activePart ? ` — ${activePart.label}` : ''}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-md border border-border bg-card p-0.5">
          {data.metrics.map((m) => (
            <button
              key={m.key}
              onClick={() => { setMetricKey(m.key); setPart(ALL_PARTS); }}
              className={cn(
                'rounded px-3 py-1 text-sm font-medium transition-colors',
                m.key === metric.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {showParts && (
          <select
            value={part}
            onChange={(e) => setPart(e.target.value)}
            aria-label="Cost component"
            className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            <option value={ALL_PARTS}>All cost components</option>
            {data.costComponents.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        )}

        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'rounded px-3 py-1 text-sm font-medium transition-colors',
                v.key === view ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
              title={v.key === 'a' ? aName : v.key === 'b' ? bName : `${bName} − ${aName}`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() =>
            downloadCsv(
              `compare-${metric.key}${activePart ? `-${activePart.key}` : ''}-${view}.csv`,
              toCsv(gridCsvRows(metric.rowLabel, data.startDate, data.horizon, rows, true, [], pctView ? 'ratio' : 'sum'))
            )
          }
        >
          <Download />
          Export CSV
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        <b>{title}</b> ·{' '}
        {view === 'a' ? (
          aName
        ) : view === 'b' ? (
          bName
        ) : (
          <>
            <b>{bName}</b> against <b>{aName}</b> — a positive figure means {bName} is higher
          </>
        )}
      </p>

      <OutputGrid
        planStartDate={data.startDate}
        horizon={data.horizon}
        rows={rows}
        format={format}
        // A percentage can't be summed: its totals are re-derived from the
        // underlying figures (total change ÷ total baseline).
        aggregate={pctView ? 'ratio' : 'sum'}
        rightLabel="Total"
        firstColLabel={metric.rowLabel}
      />

      <p className="text-xs text-muted-foreground">{metric.note}</p>
    </div>
  );
}
