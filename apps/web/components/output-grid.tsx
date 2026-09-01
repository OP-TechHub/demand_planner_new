'use client';

import { useEffect, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { kg, usd, usd0, usd2, num0, pct } from '@/lib/format';
import { ScrollX } from '@/components/ui/scroll-x';
import { useMonthRange } from '@/components/month-range';
import { weightedTotal, type Aggregate, type GridRow } from '@/lib/grid-csv';

export type { GridRow, Aggregate };

/**
 * Formatters and colour scales are resolved HERE, from a serializable key —
 * this is a client component, and functions can't cross the server→client
 * boundary (the output pages are server components).
 */
const FMT = { kg, usd, usd0, usd2, num0, pct } as const;
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
  aggregate = 'sum',
  colorFor,
  rightLabel = '60mo total',
  showColumnTotals = true,
  hideTotals = false,
  firstColLabel = 'Program',
  extraCols,
  onRangeChange,
  cellTitle,
  cellBg,
}: {
  planStartDate: string;
  horizon: number;
  rows: GridRow[];
  format: FmtKey;
  /**
   * How the total column and TOTAL row are arrived at. 'sum' adds; 'ratio'
   * takes a weighted average over each row's `weights`, which is the only
   * honest way to total a $/kg rate.
   */
  aggregate?: Aggregate;
  colorFor?: ColorKey;
  rightLabel?: string;
  showColumnTotals?: boolean;
  hideTotals?: boolean;
  firstColLabel?: string;
  /**
   * Extra descriptive columns between the frozen label and the months, filled
   * from each row's `extra` array (positional). Deliberately NOT frozen — the
   * label column is what you need while scrolling right, and pinning several
   * more would eat the width the months need.
   */
  extraCols?: { label: string; align?: 'left' | 'right'; width?: string }[];
  /**
   * Reports the visible month range, so a page's own headline figures can total
   * the same window the grid is showing instead of the whole horizon.
   */
  onRangeChange?: (fromMonth: number, toMonth: number) => void;
  /** Optional per-cell hover text, keyed `${rowKey}:${month}` (e.g. an inquiry breakdown). */
  cellTitle?: Map<string, string>;
  /** Optional per-cell CSS `background` (e.g. a fulfilment gradient), keyed `${rowKey}:${month}`. */
  cellBg?: Map<string, string>;
}) {
  // A page-level MonthRangeProvider, where there is one, filters every grid on
  // the page at once; this grid's own selector then has nothing left to do and
  // is dropped rather than shown as a second, contradictory control.
  const shared = useMonthRange();
  const [ownFrom, setOwnFrom] = useState(1);
  const [ownTo, setOwnTo] = useState(horizon);
  const fromMonth = shared ? Math.min(shared.from, horizon) : ownFrom;
  const toMonth = shared ? Math.min(shared.to, horizon) : ownTo;

  // Held in a ref so an inline callback from the parent can't re-fire this on
  // every render.
  const onRangeRef = useRef(onRangeChange);
  onRangeRef.current = onRangeChange;
  useEffect(() => { onRangeRef.current?.(fromMonth, toMonth); }, [fromMonth, toMonth]);

  const months = Array.from({ length: horizon }, (_, i) => i + 1);
  const visibleMonths = months.filter((m) => m >= fromMonth && m <= toMonth);
  const fullRange = fromMonth === 1 && toMonth === horizon;

  // Picking a start month proposes the twelve months from it — a year is how
  // these grids are read. Only a proposal: the end month can be moved after,
  // and Reset puts the whole horizon back.
  const onFrom = (v: number) => { setOwnFrom(v); setOwnTo(Math.min(v + 11, horizon)); };
  const onTo = (v: number) => { setOwnTo(v); if (v < fromMonth) setOwnFrom(v); };

  const fmt = FMT[format];
  const color = colorFor ? COLOR[colorFor] : undefined;

  // Totals cover the visible range, so a row total always matches the cells beside it.
  const ratio = aggregate === 'ratio';
  const rowTotal = (r: GridRow) =>
    ratio ? weightedTotal(r, visibleMonths) : visibleMonths.reduce((s: number, mo) => s + (r.values[mo - 1] ?? 0), 0);

  /**
   * A month's figure across every row. Summing is right for dollars and kilos;
   * for a rate it is nonsense, so those re-derive the rate from the underlying
   * quantities — Σ(rate × kg) ÷ Σkg, i.e. total dollars over total kilos. A
   * heavy program therefore pulls the average its way, as it should.
   */
  const colTotal = (mo: number): number | null => {
    if (!ratio) return rows.reduce((s: number, r) => s + (r.values[mo - 1] ?? 0), 0);
    let num = 0;
    let den = 0;
    for (const r of rows) {
      const w = r.weights?.[mo - 1] ?? 0;
      if (!w) continue;
      num += (r.values[mo - 1] ?? 0) * w;
      den += w;
    }
    return den > 0 ? num / den : null;
  };

  /** The bottom-right cell: every row over every visible month, aggregated once. */
  const grandTotal = (): number | null => {
    if (!ratio) return rows.reduce((s: number, r) => s + ((rowTotal(r) as number) ?? 0), 0);
    let num = 0;
    let den = 0;
    for (const r of rows) {
      for (const mo of visibleMonths) {
        const w = r.weights?.[mo - 1] ?? 0;
        if (!w) continue;
        num += (r.values[mo - 1] ?? 0) * w;
        den += w;
      }
    }
    return den > 0 ? num / den : null;
  };
  // A vertical divider at each fiscal-year boundary (M13, M25, …) to orient the eye.
  const yearStart = (mo: number) => mo > 1 && (mo - 1) % 12 === 0;
  const stickyCol =
    'sticky left-0 z-10 transition-shadow group-data-[scrolled=true]/scrollx:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)]';

  return (
    <div className="space-y-2">
      {!shared && (
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
              onClick={() => { setOwnFrom(1); setOwnTo(horizon); }}
              className="text-xs font-medium text-primary hover:underline"
            >
              Reset
            </button>
            <span className="text-xs text-muted-foreground">Showing {visibleMonths.length} of {horizon} months.</span>
          </>
        )}
      </div>
      )}

      <ScrollX className="max-h-[70vh] rounded-lg border border-border">
        <table className="w-max text-xs">
          {/*
            The month row stays put while you scroll. Sticky goes on the cells,
            not <thead>, and their background must be OPAQUE or rows show through
            underneath. The frozen first column's header sits at z-30 so it wins
            over both the sticky row and the sticky column.
          */}
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className={cn(stickyCol, 'sticky top-0 z-30 min-w-[15rem] max-w-[15rem] border-b border-border bg-muted px-3 py-2 text-left font-semibold')}>{firstColLabel}</th>
              {extraCols?.map((c) => (
                <th
                  key={c.label}
                  className={cn(
                    'sticky top-0 z-20 whitespace-nowrap border-b border-r border-border bg-muted px-3 py-2 font-semibold',
                    c.align === 'right' ? 'text-right' : 'text-left',
                    c.width
                  )}
                >
                  {c.label}
                </th>
              ))}
              {visibleMonths.map((mo) => (
                <th key={mo} className={cn('sticky top-0 z-20 min-w-[4.5rem] border-b border-border bg-muted px-2 py-2 text-right font-medium', yearStart(mo) && 'border-l border-border')}>{monthLabel(planStartDate, mo)}</th>
              ))}
              {!hideTotals && (
                <th className="sticky top-0 z-20 min-w-[6rem] border-b border-l border-border bg-muted px-3 py-2 text-right font-semibold">
                  {fullRange ? (ratio ? 'Weighted avg' : rightLabel) : ratio ? 'Range avg' : 'Range total'}
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
                {extraCols?.map((c, i) => (
                  <td
                    key={c.label}
                    className={cn(
                      'whitespace-nowrap border-r px-3 py-1.5 text-muted-foreground',
                      c.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                    )}
                  >
                    {r.extra?.[i] ?? ''}
                  </td>
                ))}
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
                <td className={cn(stickyCol, 'bg-muted/40 px-3 py-1.5')} title={ratio ? 'Total dollars ÷ total kilos — not the average of the rows' : undefined}>
                  {ratio ? 'WEIGHTED AVG' : 'TOTAL'}
                </td>
                {extraCols?.map((c) => <td key={c.label} className="border-r px-3 py-1.5" />)}
                {visibleMonths.map((mo) => (
                  <td key={mo} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60')}>{fmt(colTotal(mo))}</td>
                ))}
                <td className="border-l px-3 py-1.5 text-right tabular-nums">{fmt(grandTotal())}</td>
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
