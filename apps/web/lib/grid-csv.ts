import { monthLabel } from '@oceanpick/shared';

export interface GridRow {
  key: string;
  label: string;
  sublabel?: string;
  values: (number | null)[]; // length === horizon
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
  includeTotal = true
): (string | number | null)[][] {
  const header = [
    firstCol,
    ...Array.from({ length: horizon }, (_, i) => monthLabel(planStartDate, i + 1)),
    ...(includeTotal ? ['Total'] : []),
  ];
  const body = rows.map((r) => {
    const label = r.sublabel ? `${r.label} — ${r.sublabel}` : r.label;
    const total = r.values.reduce((s: number, v) => s + (v ?? 0), 0);
    return [label, ...r.values, ...(includeTotal ? [total] : [])];
  });
  return [header, ...body];
}
