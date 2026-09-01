'use client';

import { Fragment, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toCsv, downloadCsv } from '@/lib/csv';
import { pct } from '@/lib/format';
import {
  SUMMARY_METRICS, SUMMARY_PERIODS, summaryCell,
  type SummaryByPeriod, type SummaryMetric,
} from '@/lib/annual-summary';

/** How much sits beside each plan's figures: nothing, the movement, or the movement as a %. */
const VIEWS = [
  { key: 'change', label: 'Change' },
  { key: 'changePct', label: 'Change %' },
  { key: 'values', label: 'Values only' },
] as const;
type View = (typeof VIEWS)[number]['key'];

/** B − A, where a period neither plan reaches has no movement to report. */
function delta(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (b ?? 0) - (a ?? 0);
}

/** A percentage against a zero (or absent) baseline is undefined, not infinite. */
function deltaPct(m: SummaryMetric, a: number | null, b: number | null): number | null {
  if (m.ratio || a == null || a === 0) return null;
  return ((b ?? 0) - a) / a;
}

/** A movement reads as a movement: always signed, and never as `$-1,234`. */
function signed(m: SummaryMetric, n: number | null): string {
  if (n == null) return '—';
  if (n === 0) return m.fmt(0);
  return (n < 0 ? '−' : '+') + m.fmt(Math.abs(n));
}

export function AnnualCompare({
  a, b, aName, bName,
}: { a: SummaryByPeriod; b: SummaryByPeriod; aName: string; bName: string }) {
  const [view, setView] = useState<View>('change');
  const showDelta = view !== 'values';
  const cols = showDelta ? 3 : 2;

  const csv = () => {
    const head: string[] = ['Metric'];
    for (const [, label] of SUMMARY_PERIODS) {
      head.push(`${label} ${aName}`, `${label} ${bName}`);
      if (showDelta) head.push(`${label} ${view === 'changePct' ? 'Change %' : 'Change'}`);
    }
    const rows: (string | number | null)[][] = [head];
    for (const m of SUMMARY_METRICS) {
      const row: (string | number | null)[] = [m.label];
      for (const [p] of SUMMARY_PERIODS) {
        const av = summaryCell(m, a, p);
        const bv = summaryCell(m, b, p);
        row.push(av, bv);
        if (showDelta) row.push(view === 'changePct' ? deltaPct(m, av, bv) : delta(av, bv));
      }
      rows.push(row);
    }
    downloadCsv('annual-summary-compare.csv', toCsv(rows));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'rounded px-3 py-1 text-sm font-medium transition-colors',
                v.key === view ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
              title={v.key === 'values' ? 'Both plans, side by side' : `${bName} − ${aName}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={csv}>
          <Download />
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th rowSpan={2} className="px-3 py-2 text-left align-bottom">Metric</th>
              {SUMMARY_PERIODS.map(([p, label]) => (
                <th key={p} colSpan={cols} className="border-l px-3 py-2 text-center">{label}</th>
              ))}
            </tr>
            <tr>
              {SUMMARY_PERIODS.map(([p]) => (
                <Fragment key={p}>
                  <th className="border-l px-3 py-1 text-right font-normal normal-case" title={aName}>A</th>
                  <th className="px-3 py-1 text-right font-normal normal-case" title={bName}>B</th>
                  {showDelta && (
                    <th className="px-3 py-1 text-right font-normal normal-case" title={`${bName} − ${aName}`}>
                      {view === 'changePct' ? 'Δ %' : 'Δ'}
                    </th>
                  )}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUMMARY_METRICS.map((m) => {
              return (
                <Fragment key={m.key}>
                  {m.group && (
                    <tr className="border-t bg-muted/30">
                      <td colSpan={1 + SUMMARY_PERIODS.length * cols} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {m.group}
                      </td>
                    </tr>
                  )}
                  <tr className={m.strong ? 'border-t font-medium' : 'border-t'}>
                    <td className="whitespace-nowrap px-3 py-1.5">{m.label}</td>
                    {SUMMARY_PERIODS.map(([p]) => {
                      const av = summaryCell(m, a, p);
                      const bv = summaryCell(m, b, p);
                      return (
                        <Fragment key={p}>
                          <td className="border-l px-3 py-1.5 text-right tabular-nums text-muted-foreground">{m.fmt(av)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{m.fmt(bv)}</td>
                          {showDelta && (
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {view === 'changePct'
                                ? (() => { const d = deltaPct(m, av, bv); return d == null ? '—' : (d < 0 ? '−' : '+') + pct(Math.abs(d)); })()
                                : signed(m, delta(av, bv))}
                            </td>
                          )}
                        </Fragment>
                      );
                    })}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
