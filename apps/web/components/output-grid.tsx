import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';

export interface GridRow {
  key: string;
  label: string;
  sublabel?: string;
  values: (number | null)[]; // length === horizon
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

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-max text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-10 min-w-[15rem] max-w-[15rem] bg-muted/50 px-3 py-2 text-left font-semibold">{firstColLabel}</th>
            {months.map((mo) => (
              <th key={mo} className="min-w-[4.5rem] px-2 py-2 text-right font-medium">{monthLabel(planStartDate, mo)}</th>
            ))}
            {!hideTotals && <th className="min-w-[6rem] border-l bg-muted/50 px-3 py-2 text-right font-semibold">{rightLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t hover:bg-muted/30">
              <td className="sticky left-0 z-10 min-w-[15rem] max-w-[15rem] truncate border-r bg-card px-3 py-1.5" title={`${r.label}${r.sublabel ? ' — ' + r.sublabel : ''}`}>
                <span className="font-medium">{r.label}</span>
                {r.sublabel && <span className="ml-1 text-muted-foreground">{r.sublabel}</span>}
              </td>
              {months.map((mo, i) => (
                <td key={mo} className={cn('px-2 py-1.5 text-right tabular-nums', colorFor?.(r.values[i] ?? null))}>
                  {format(r.values[i] ?? null)}
                </td>
              ))}
              {!hideTotals && <td className="border-l px-3 py-1.5 text-right font-semibold tabular-nums">{format(rowTotal(r))}</td>}
            </tr>
          ))}
          {!hideTotals && showColumnTotals && rows.length > 0 && (
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className="sticky left-0 z-10 bg-muted/40 px-3 py-1.5">TOTAL</td>
              {months.map((_, i) => (
                <td key={i} className="px-2 py-1.5 text-right tabular-nums">{format(colTotal(i))}</td>
              ))}
              <td className="border-l px-3 py-1.5 text-right tabular-nums">{format(rows.reduce((s: number, r) => s + rowTotal(r), 0))}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Shared empty state when a plan hasn't been computed yet. */
export function NotComputed() {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-sm text-muted-foreground">
      No computed results yet. Go to <b>Home</b> and click <b>Recalculate now</b>, then come back.
    </div>
  );
}
