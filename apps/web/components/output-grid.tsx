'use client';

import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { kg, usd, usd0, num0, pct } from '@/lib/format';
import { ScrollX } from '@/components/ui/scroll-x';
import type { GridRow } from '@/lib/grid-csv';

export type { GridRow };

/**
 * Formatters and colour scales are resolved HERE, from a serializable key —
 * this is a client component, and functions can't cross the server→client
 * boundary (the output pages are server components).
 */
const FMT = { kg, usd, usd0, num0, pct } as const;
export type FmtKey = keyof typeof FMT;

const COLOR = {
  // Fulfilment heatmap: deliberate data-viz colours, not theme tokens.
  fulfilment: (v: number | null): string =>
    v == null
      ? 'text-muted-foreground/40'
      : v >= 0.95
        ? 'bg-green-100 text-green-800'
        : v >= 0.8
          ? 'bg-amber-100 text-amber-800'
          : 'bg-red-100 text-red-800',
} as const;
export type ColorKey = keyof typeof COLOR;

/**
 * Read-only wide grid used by the output pages: frozen first column, one column
 * per month, an optional total column, and optional column totals. The
 * month-range filter narrows which columns render (view-only — the page's
 * Export CSV still covers the full horizon).
 */
export function OutputGrid({
  planStartDate,
  horizon,
  rows,
  format,
  colorFor,
  rightLabel = '60mo total',
  showColumnTotals = true,
  hideTotals = false,
  firstColLabel = 'Program',
  cellTitle,
  cellBg,
}: {
  planStartDate: string;
  horizon: number;
  rows: GridRow[];
  format: FmtKey;
  colorFor?: ColorKey;
  rightLabel?: string;
  showColumnTotals?: boolean;
  hideTotals?: boolean;
  firstColLabel?: string;
  /** Optional per-cell hover text, keyed `${rowKey}:${month}` (e.g. an inquiry breakdown). */
  cellTitle?: Map<string, string>;
  /** Optional per-cell CSS `background` (e.g. a fulfilment gradient), keyed `${rowKey}:${month}`. */
  cellBg?: Map<string, string>;
}) {
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(horizon);

  const months = Array.from({ length: horizon }, (_, i) => i + 1);
  const visibleMonths = months.filter((m) => m >= fromMonth && m <= toMonth);
  const fullRange = fromMonth === 1 && toMonth === horizon;

  // Keep the range coherent: dragging one end past the other pushes the other end.
  const onFrom = (v: number) => { setFromMonth(v); if (v > toMonth) setToMonth(v); };
  const onTo = (v: number) => { setToMonth(v); if (v < fromMonth) setFromMonth(v); };

  const fmt = FMT[format];
  const color = colorFor ? COLOR[colorFor] : undefined;

  // Totals cover the visible range, so a row total always matches the cells beside it.
  const rowTotal = (r: GridRow) => visibleMonths.reduce((s: number, mo) => s + (r.values[mo - 1] ?? 0), 0);
  const colTotal = (mo: number) => rows.reduce((s: number, r) => s + (r.values[mo - 1] ?? 0), 0);
  // A vertical divider at each fiscal-year boundary (M13, M25, …) to orient the eye.
  const yearStart = (mo: number) => mo > 1 && (mo - 1) % 12 === 0;
  const stickyCol =
    'sticky left-0 z-10 transition-shadow group-data-[scrolled=true]/scrollx:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)]';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Months</span>
        <select value={fromMonth} onChange={(e) => onFrom(Number(e.target.value))} className={filterCls} aria-label="From month">
          {months.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">to</span>
        <select value={toMonth} onChange={(e) => onTo(Number(e.target.value))} className={filterCls} aria-label="To month">
          {months.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
        </select>
        {!fullRange && (
          <>
            <button
              type="button"
              onClick={() => { setFromMonth(1); setToMonth(horizon); }}
              className="text-xs font-medium text-primary hover:underline"
            >
              Reset
            </button>
            <span className="text-xs text-muted-foreground">Showing {visibleMonths.length} of {horizon} months.</span>
          </>
        )}
      </div>

      <ScrollX className="rounded-lg border border-border">
        <table className="w-max text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className={cn(stickyCol, 'min-w-[15rem] max-w-[15rem] bg-muted/50 px-3 py-2 text-left font-semibold')}>{firstColLabel}</th>
              {visibleMonths.map((mo) => (
                <th key={mo} className={cn('min-w-[4.5rem] px-2 py-2 text-right font-medium', yearStart(mo) && 'border-l border-border')}>{monthLabel(planStartDate, mo)}</th>
              ))}
              {!hideTotals && (
                <th className="min-w-[6rem] border-l bg-muted/50 px-3 py-2 text-right font-semibold">
                  {fullRange ? rightLabel : 'Range total'}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t hover:bg-muted/30">
                <td className={cn(stickyCol, 'min-w-[15rem] max-w-[15rem] truncate border-r bg-card px-3 py-1.5')} title={`${r.label}${r.sublabel ? ' — ' + r.sublabel : ''}`}>
                  <span className="font-medium">{r.label}</span>
                  {r.sublabel && <span className="ml-1 text-muted-foreground">{r.sublabel}</span>}
                </td>
                {visibleMonths.map((mo) => {
                  const key = `${r.key}:${mo}`;
                  const tip = cellTitle?.get(key);
                  const bg = cellBg?.get(key);
                  return (
                    <td
                      key={mo}
                      title={tip}
                      style={bg ? { background: bg, color: '#1e293b' } : undefined}
                      className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60', color?.(r.values[mo - 1] ?? null), tip && 'cursor-help', tip && !bg && 'underline decoration-dotted decoration-muted-foreground/40 underline-offset-2')}
                    >
                      {fmt(r.values[mo - 1] ?? null)}
                    </td>
                  );
                })}
                {!hideTotals && <td className="border-l px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(rowTotal(r))}</td>}
              </tr>
            ))}
            {!hideTotals && showColumnTotals && rows.length > 0 && (
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className={cn(stickyCol, 'bg-muted/40 px-3 py-1.5')}>TOTAL</td>
                {visibleMonths.map((mo) => (
                  <td key={mo} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60')}>{fmt(colTotal(mo))}</td>
                ))}
                <td className="border-l px-3 py-1.5 text-right tabular-nums">{fmt(rows.reduce((s: number, r) => s + rowTotal(r), 0))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}

const filterCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';

/** Shared empty state when a plan hasn't been computed yet. */
export function NotComputed() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <BarChart3 className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium">No computed results yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Set your inputs, then click <b className="text-foreground">Recalculate</b> (top bar) to generate this view.
      </p>
    </div>
  );
}
