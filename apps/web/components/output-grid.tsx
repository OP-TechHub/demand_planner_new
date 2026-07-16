import { BarChart3 } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { ScrollX } from '@/components/ui/scroll-x';

export interface GridRow {
  key: string;
  label: string;
  sublabel?: string;
  values: (number | null)[]; // length === horizon
}

/** Convert grid rows to a CSV matrix (header + rows), matching the on-screen grid. */
export function gridCsvRows(firstCol: string, planStartDate: string, horizon: number, rows: GridRow[], includeTotal = true): (string | number | null)[][] {
  const header = [firstCol, ...Array.from({ length: horizon }, (_, i) => monthLabel(planStartDate, i + 1)), ...(includeTotal ? ['Total'] : [])];
  const body = rows.map((r) => {
    const label = r.sublabel ? `${r.label} — ${r.sublabel}` : r.label;
    const total = r.values.reduce((s: number, v) => s + (v ?? 0), 0);
    return [label, ...r.values, ...(includeTotal ? [total] : [])];
  });
  return [header, ...body];
}

/**
 * Read-only wide grid used by the output pages: frozen first column, one column
 * per month, an optional 60-month total column, and optional column totals.
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
}: {
  planStartDate: string;
  horizon: number;
  rows: GridRow[];
  format: (v: number | null) => string;
  colorFor?: (v: number | null) => string;
  rightLabel?: string;
  showColumnTotals?: boolean;
  hideTotals?: boolean;
  firstColLabel?: string;
}) {
  const months = Array.from({ length: horizon }, (_, i) => i + 1);
  const rowTotal = (r: GridRow) => r.values.reduce((s: number, v) => s + (v ?? 0), 0);
  const colTotal = (m: number) => rows.reduce((s: number, r) => s + (r.values[m] ?? 0), 0);
  // A vertical divider at each fiscal-year boundary (M13, M25, …) to orient the eye.
  const yearStart = (mo: number) => mo > 1 && (mo - 1) % 12 === 0;
  const stickyCol =
    'sticky left-0 z-10 transition-shadow group-data-[scrolled=true]/scrollx:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)]';

  return (
    <ScrollX className="rounded-lg border border-border">
      <table className="w-max text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className={cn(stickyCol, 'min-w-[15rem] max-w-[15rem] bg-muted/50 px-3 py-2 text-left font-semibold')}>{firstColLabel}</th>
            {months.map((mo) => (
              <th key={mo} className={cn('min-w-[4.5rem] px-2 py-2 text-right font-medium', yearStart(mo) && 'border-l border-border')}>{monthLabel(planStartDate, mo)}</th>
            ))}
            {!hideTotals && <th className="min-w-[6rem] border-l bg-muted/50 px-3 py-2 text-right font-semibold">{rightLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t hover:bg-muted/30">
              <td className={cn(stickyCol, 'min-w-[15rem] max-w-[15rem] truncate border-r bg-card px-3 py-1.5')} title={`${r.label}${r.sublabel ? ' — ' + r.sublabel : ''}`}>
                <span className="font-medium">{r.label}</span>
                {r.sublabel && <span className="ml-1 text-muted-foreground">{r.sublabel}</span>}
              </td>
              {months.map((mo, i) => (
                <td key={mo} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60', colorFor?.(r.values[i] ?? null))}>
                  {format(r.values[i] ?? null)}
                </td>
              ))}
              {!hideTotals && <td className="border-l px-3 py-1.5 text-right font-semibold tabular-nums">{format(rowTotal(r))}</td>}
            </tr>
          ))}
          {!hideTotals && showColumnTotals && rows.length > 0 && (
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className={cn(stickyCol, 'bg-muted/40 px-3 py-1.5')}>TOTAL</td>
              {months.map((_, i) => (
                <td key={i} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(i + 1) && 'border-l border-border/60')}>{format(colTotal(i))}</td>
              ))}
              <td className="border-l px-3 py-1.5 text-right tabular-nums">{format(rows.reduce((s: number, r) => s + rowTotal(r), 0))}</td>
            </tr>
          )}
        </tbody>
      </table>
    </ScrollX>
  );
}

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
