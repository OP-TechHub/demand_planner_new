/**
 * Secondary (by-product) and other-product money, aggregated onto the Annual
 * Summary's periods.
 *
 * The engine's `plan_summary` covers programs only — it is the V30 parity
 * figure and knows nothing about either of these tables, both of which are
 * ORG-scoped rather than plan-scoped. So the same read-time arithmetic the
 * Revenue & Cost page and the home dashboard already do is done here once, and
 * folded into the summary rows the table renders:
 *
 *   secondary revenue = feedstock WR x yield_pct x price_per_kg   (no cost)
 *   other revenue     = quantity x unit_revenue
 *   other cost        = quantity x unit_cost
 *
 * Feedstock is `rolling_results.rolling_wr` — the whole round the engine really
 * allocated — matched on `item_code`, which survives a scenario fork.
 */
import { fetchAllByPlan, fetchAllPaged } from '@/lib/fetch-all';

/** The Annual Summary's periods as 1-based `month_index` ranges (M1 = first month). */
const PERIODS: { period: string; start: number; end: number }[] = [
  { period: 'fy1', start: 1, end: 12 },
  { period: 'fy2', start: 13, end: 24 },
  { period: 'fy3', start: 25, end: 36 },
  { period: 'fy4', start: 37, end: 48 },
  { period: 'fy5', start: 49, end: 60 },
  { period: 'total_60mo', start: 1, end: 60 },
];

/**
 * The columns this module adds to a `plan_summary` row. Indexed as well as
 * named, so it merges into a summary row like any other stored column.
 */
export interface SidePeriodTotals {
  [column: string]: number;
  secondary_revenue: number;
  other_revenue: number;
  other_cost: number;
}
export type SideByPeriod = Record<string, SidePeriodTotals>;

type SecDef = { basis: string; source_item_code: string | null; yield_pct: number; price_per_kg: number };
type OtherDef = { id: string; unit_cost: number; unit_revenue: number };

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Per-period secondary and other-product money for one plan. Both are read
 * fresh rather than from stored results, so they are right without a
 * recalculate — nothing in the compute pipeline produces them.
 */
export async function sideProductTotals(
  supabase: any,
  planId: string,
  horizon: number
): Promise<SideByPeriod> {
  const [rr, { data: progs }, { data: secDefs }, { data: others }, otherMonths] = await Promise.all([
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, rolling_wr', planId),
    supabase.from('programs').select('id, item_code').eq('plan_id', planId).is('deleted_at', null),
    supabase.from('secondary_products')
      .select('basis, source_item_code, yield_pct, price_per_kg')
      .eq('is_archived', false),
    supabase.from('other_products').select('id, unit_cost, unit_revenue').eq('is_archived', false),
    // Tolerated rather than thrown: `other_products` is a newer table than this
    // page, so on a database whose migration hasn't been applied yet the Annual
    // Summary still renders — without the other-product rows, which are empty
    // there anyway — instead of failing outright.
    fetchAllPaged(
      (from: number, to: number) =>
        supabase.from('other_product_months').select('product_id, month_index, quantity').range(from, to),
      'other_product_months'
    ).catch(() => [] as any[]),
  ]);

  const zeros = () => new Array<number>(horizon).fill(0);
  const secRev = zeros();
  const othRev = zeros();
  const othCost = zeros();

  // --- Secondary products: feedstock WR, per source item code and in total ---
  const secRows = (secDefs ?? []) as SecDef[];
  if (secRows.length > 0) {
    const codeById = new Map<string, string>(
      ((progs ?? []) as { id: string; item_code: string }[]).map((p) => [p.id, p.item_code])
    );
    const totalWr = zeros();
    const wrByCode = new Map<string, number[]>();
    for (const r of rr as { program_id: string; month_index: number; rolling_wr: number }[]) {
      const i = r.month_index - 1;
      if (i < 0 || i >= horizon) continue;
      const wr = Number(r.rolling_wr) || 0;
      totalWr[i] += wr;
      const code = codeById.get(r.program_id);
      if (!code) continue;
      let arr = wrByCode.get(code);
      if (!arr) { arr = zeros(); wrByCode.set(code, arr); }
      arr[i] += wr;
    }
    for (const d of secRows) {
      // An unpriced by-product earns nothing — the Secondary products page warns about those.
      const rate = Number(d.yield_pct) * Number(d.price_per_kg);
      if (!(rate > 0)) continue;
      const feed = d.basis === 'total_wr' ? totalWr : wrByCode.get(d.source_item_code ?? '');
      if (!feed) continue;
      for (let i = 0; i < horizon; i++) secRev[i] += (feed[i] ?? 0) * rate;
    }
  }

  // --- Other products: quantity typed in per month, at flat per-unit rates ---
  const rateById = new Map<string, OtherDef>(
    ((others ?? []) as OtherDef[]).map((p) => [p.id, p])
  );
  for (const m of otherMonths as { product_id: string; month_index: number; quantity: number }[]) {
    const p = rateById.get(m.product_id);
    const i = m.month_index - 1;
    if (!p || i < 0 || i >= horizon) continue;
    const q = Number(m.quantity) || 0;
    othRev[i] += q * Number(p.unit_revenue);
    othCost[i] += q * Number(p.unit_cost);
  }

  const by: SideByPeriod = {};
  for (const { period, start, end } of PERIODS) {
    const t: SidePeriodTotals = { secondary_revenue: 0, other_revenue: 0, other_cost: 0 };
    for (let mi = start; mi <= Math.min(end, horizon); mi++) {
      const i = mi - 1;
      t.secondary_revenue += secRev[i] ?? 0;
      t.other_revenue += othRev[i] ?? 0;
      t.other_cost += othCost[i] ?? 0;
    }
    by[period] = t;
  }
  return by;
}
