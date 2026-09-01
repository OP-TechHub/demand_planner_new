/**
 * The Annual Summary table's shape — periods, metric rows and how each cell is
 * derived — in one place, so the standalone page and the plan comparison show
 * the identical set of rows in the identical order. Client-safe: no server
 * imports, so the comparison grid can be a client component.
 */
import { kg, usd, pct } from '@/lib/format';

export const SUMMARY_PERIODS = [
  ['fy1', 'FY1'], ['fy2', 'FY2'], ['fy3', 'FY3'], ['fy4', 'FY4'], ['fy5', 'FY5'], ['total_60mo', 'Total'],
] as const;

/** One `plan_summary` row, or nothing where the plan has no figures for a period. */
export type SummaryRow = Record<string, number> | undefined;
/** period -> that period's row, keyed as `plan_summary` stores it. */
export type SummaryByPeriod = Record<string, Record<string, number>>;

type Fmt = (n: number | null) => string;

export interface SummaryMetric {
  label: string;
  key: string;
  fmt: Fmt;
  /** Starts a new banded group above this row. */
  group?: string;
  /** Derived rows (the totals) compute from the stored columns instead of reading one. */
  value?: (r: SummaryRow) => number | null;
  /** Totals, set apart from the components they add up. */
  strong?: boolean;
  /** A ratio, not an amount: it can't be summed, and a % change on it would be a % of a %. */
  ratio?: boolean;
}

const sum = (keys: string[]) => (r: SummaryRow) =>
  r ? keys.reduce((t, k) => t + Number(r[k] ?? 0), 0) : null;

export const SUMMARY_METRICS: SummaryMetric[] = [
  { label: 'Demand FP', key: 'demand_fp', fmt: kg, group: 'Volume (kg)' },
  { label: 'Allocated FP', key: 'allocated_fp', fmt: kg },
  { label: 'Unallocated FP', key: 'unallocated_fp', fmt: kg },
  { label: 'Total FP', key: 'total_fp', fmt: kg, value: sum(['allocated_fp', 'unallocated_fp']), strong: true },
  { label: 'Allocated WR', key: 'allocated_wr', fmt: kg },
  { label: 'Unallocated WR', key: 'unallocated_wr', fmt: kg },
  { label: 'Total WR', key: 'total_wr', fmt: kg, value: sum(['allocated_wr', 'unallocated_wr']), strong: true },
  { label: 'Revenue', key: 'revenue', fmt: usd, group: 'Financials ($)' },
  { label: 'Cost', key: 'cost', fmt: usd },
  { label: 'Gross Margin', key: 'margin', fmt: usd },
  { label: 'GP %', key: 'gp_pct', fmt: pct, ratio: true },
  { label: 'Revenue Opportunity', key: 'revenue_opportunity', fmt: usd, group: 'If fully fulfilled' },
  { label: 'Cost Opportunity', key: 'cost_opportunity', fmt: usd },
  { label: 'Margin Opportunity', key: 'margin_opportunity', fmt: usd },
  { label: 'Margin Gap', key: 'margin_gap', fmt: usd },
];

/** This metric's figure for one period, `null` where the plan has nothing there. */
export function summaryCell(m: SummaryMetric, by: SummaryByPeriod, period: string): number | null {
  const row = by[period];
  if (m.value) return m.value(row);
  const v = row?.[m.key];
  return v == null ? null : Number(v);
}

/** period -> row, from the raw `plan_summary` rows of a single plan. */
export function bySummaryPeriod(rows: { period: string }[] | null | undefined): SummaryByPeriod {
  const by: SummaryByPeriod = {};
  for (const r of rows ?? []) by[r.period] = r as unknown as Record<string, number>;
  return by;
}
