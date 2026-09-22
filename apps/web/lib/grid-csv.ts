import { monthLabel } from '@oceanpick/shared';

export interface GridRow {
  key: string;
  label: string;
  sublabel?: string;
  values: (number | null)[]; // length === horizon
  group?: string; // optional grouping (e.g. program status) for client-side filtering
  /**
   * Pre-formatted values for the grid's optional extra descriptive columns
   * (see OutputGrid's `extraCols`). Positional — one entry per declared column.
   */
  extra?: string[];
  /**
   * Per-month weights for a RATE row ($/kg), where totalling means a weighted
   * average, not a sum. Twelve months of $6.40/kg do not total $76.80/kg — they
   * average, weighted by the kilos each month actually moved, which is what
   * this array carries. Ignored unless the grid aggregates as 'ratio'.
   */
  weights?: (number | null)[];
}

/**
 * How a row's values combine into a total: added up, or averaged over their
 * weights. A rate can only be totalled the second way.
 */
export type Aggregate = 'sum' | 'ratio';

/**
 * Σ(value × weight) ÷ Σweight over the given months.
 *
 * Null when there is no positive weight to average over — a rate with nothing
 * behind it has no value, and reporting $0.00 would be a claim rather than a
 * blank.
 */
export function weightedTotal(r: GridRow, months: number[]): number | null {
  let num = 0;
  let den = 0;
  for (const mo of months) {
    const w = r.weights?.[mo - 1] ?? 0;
    if (!w) continue;
    num += (r.values[mo - 1] ?? 0) * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * Convert grid rows to a CSV matrix (header + rows), matching the on-screen grid.
 *
 * Lives here rather than in output-grid.tsx because the output pages call it on
 * the server to build their export — and output-grid is a client module, whose
 * exports can't be invoked during a server render.
 */
export function gridCsvRows(
  firstCol: string,
  planStartDate: string,
  horizon: number,
  rows: GridRow[],
  includeTotal = true,
  /** Headers for the grid's extra descriptive columns, in the same order as `row.extra`. */
  extraCols: string[] = [],
  /** Match the grid: a rate column's Total is a weighted average, not a sum. */
  aggregate: Aggregate = 'sum',
  /**
   * The months on screen (1-based, inclusive). The export then carries only
   * those columns, and Total covers only them — the same figures the grid's own
   * Total shows. Omitted means the whole horizon.
   */
  range?: { from: number; to: number }
): (string | number | null)[][] {
  const from = Math.max(1, range?.from ?? 1);
  const to = Math.min(horizon, range?.to ?? horizon);
  const months = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  const header = [
    firstCol,
    ...extraCols,
    ...months.map((mo) => monthLabel(planStartDate, mo)),
    ...(includeTotal ? ['Total'] : []),
  ];
  const body = rows.map((r) => {
    const label = r.sublabel ? `${r.label} — ${r.sublabel}` : r.label;
    const extra = extraCols.map((_, i) => r.extra?.[i] ?? '');
    const values = months.map((mo) => r.values[mo - 1] ?? null);
    const total =
      aggregate === 'ratio' ? weightedTotal(r, months) : values.reduce((s: number, v) => s + (v ?? 0), 0);
    return [label, ...extra, ...values, ...(includeTotal ? [total] : [])];
  });
  return [header, ...body];
}
