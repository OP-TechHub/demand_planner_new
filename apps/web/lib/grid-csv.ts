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
  extraCols: string[] = []
): (string | number | null)[][] {
  const header = [
    firstCol,
    ...extraCols,
    ...Array.from({ length: horizon }, (_, i) => monthLabel(planStartDate, i + 1)),
    ...(includeTotal ? ['Total'] : []),
  ];
  const body = rows.map((r) => {
    const label = r.sublabel ? `${r.label} — ${r.sublabel}` : r.label;
    const extra = extraCols.map((_, i) => r.extra?.[i] ?? '');
    const total = r.values.reduce((s: number, v) => s + (v ?? 0), 0);
    return [label, ...extra, ...r.values, ...(includeTotal ? [total] : [])];
  });
  return [header, ...body];
}
