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

/** Every revenue line the business earns: programs, by-products and traded lines. */
const ALL_REVENUE = ['revenue', 'secondary_revenue', 'other_revenue'];
/** By-products carry no cost of their own — only programs and other products do. */
const ALL_COST = ['cost', 'other_cost'];
const totalRevenue = sum(ALL_REVENUE);
const totalCost = sum(ALL_COST);

export const SUMMARY_METRICS: SummaryMetric[] = [
  { label: 'Demand FP', key: 'demand_fp', fmt: kg, group: 'Volume (kg)' },
  { label: 'Allocated FP', key: 'allocated_fp', fmt: kg },
  { label: 'Unallocated FP', key: 'unallocated_fp', fmt: kg },
  { label: 'Total FP', key: 'total_fp', fmt: kg, value: sum(['allocated_fp', 'unallocated_fp']), strong: true },
  { label: 'Allocated WR', key: 'allocated_wr', fmt: kg },
  { label: 'Unallocated WR', key: 'unallocated_wr', fmt: kg },
  { label: 'Total WR', key: 'total_wr', fmt: kg, value: sum(['allocated_wr', 'unallocated_wr']), strong: true },
  // Named "programs" throughout, because that is exactly what they are: the
  // V30-parity figures, which stop at the programs and carry neither the
  // by-products nor the traded lines. The Total rows below are the whole business.
  { label: 'Revenue (programs)', key: 'revenue', fmt: usd, group: 'Financials ($) — programs only, excluding secondary & other products' },
  { label: 'Cost (programs)', key: 'cost', fmt: usd },
  { label: 'Gross Margin (programs)', key: 'margin', fmt: usd },
  { label: 'GP % (programs)', key: 'gp_pct', fmt: pct, ratio: true },
  // Secondary products carry revenue but no cost of their own — every dollar
  // they earn is a dollar of margin — so there is no cost row beside them.
  // Other products are traded lines with both, at flat per-unit rates.
  { label: 'Secondary Revenue', key: 'secondary_revenue', fmt: usd, group: 'Secondary & other products ($)' },
  { label: 'Other Products Revenue', key: 'other_revenue', fmt: usd },
  { label: 'Other Products Cost', key: 'other_cost', fmt: usd },
  {
    label: 'Other Products Margin', key: 'other_margin', fmt: usd,
    value: (r) => (r ? Number(r.other_revenue ?? 0) - Number(r.other_cost ?? 0) : null),
  },
  // The plan's whole figure. The four Financials rows above stay the untouched
  // V30-parity program numbers; these add the rest of the business on top.
  { label: 'Total Revenue', key: 'total_revenue', fmt: usd, value: totalRevenue, strong: true, group: 'Total (all products)' },
  { label: 'Total Cost', key: 'total_cost', fmt: usd, value: totalCost, strong: true },
  {
    label: 'Total Gross Margin', key: 'total_margin', fmt: usd, strong: true,
    value: (r) => (r ? Number(totalRevenue(r)) - Number(totalCost(r)) : null),
  },
  {
    label: 'Total GP %', key: 'total_gp_pct', fmt: pct, ratio: true, strong: true,
    value: (r) => {
      if (!r) return null;
      const rev = Number(totalRevenue(r));
      return rev > 0 ? (rev - Number(totalCost(r))) / rev : 0;
    },
  },
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

/**
 * Fold the secondary and other-product figures into the engine's rows, so the
 * table reads them exactly like a stored column. They are computed at read time
 * (see `lib/side-products`) because nothing in the compute pipeline produces
 * them — the engine knows only about programs — which also means they are right
 * without a recalculate. A period with no engine row still gets one, so a
 * business selling other products outside the plan's own figures still sees them.
 */
export function withSideProducts(
  by: SummaryByPeriod,
  side: Record<string, Record<string, number>> | null | undefined
): SummaryByPeriod {
  if (!side) return by;
  const out: SummaryByPeriod = { ...by };
  for (const [period, extra] of Object.entries(side)) out[period] = { ...(out[period] ?? {}), ...extra };
  return out;
}
