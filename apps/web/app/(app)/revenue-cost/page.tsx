import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import type { GridRow } from '@/lib/grid-csv';
import { StalePlanNotice } from '../stale-banner';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder, gridRowsFor, unitGridRowsFor } from '@/lib/outputs';

export default async function RevenueCostPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Revenue &amp; Cost</h1>;
  const supabase = await createClient();
  const m = plan.horizon_months;

  const [order, rr, { data: progs }, { data: secDefs }] = await Promise.all([
    programOrder(supabase, plan.id),
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, rolling_fp, rolling_wr, revenue, cost, rolling_margin, rolling_margin_per_path', plan.id),
    supabase.from('programs')
      .select('id, status, item_code, primary_yield, barra_cost_wr, packing_cost_fp, processing_cost_fp, storage_cost_fp, freight_cost_fp, other_costs_fp')
      .eq('plan_id', plan.id).is('deleted_at', null),
    // By-product definitions are org-scoped, not plan-scoped, and keyed by item_code.
    supabase.from('secondary_products')
      .select('basis, source_item_code, yield_pct, price_per_kg')
      .eq('is_archived', false).order('sort_order'),
  ]);
  type CostProg = {
    id: string; status: string; item_code: string; primary_yield: number; barra_cost_wr: number;
    packing_cost_fp: number; processing_cost_fp: number; storage_cost_fp: number;
    freight_cost_fp: number; other_costs_fp: number;
  };
  const progRows = (progs ?? []) as CostProg[];
  const statusById = new Map<string, string>(progRows.map((p) => [p.id, p.status]));
  // Tag each program row with its status, so the grid can filter by it.
  const tag = (rows: GridRow[]): GridRow[] => rows.map((r) => ({ ...r, group: statusById.get(r.key) ?? 'active' }));

  // Cost components (spec §2.1): total $/kg FP = barra_cost_wr / primary_yield
  // + packing + processing + storage + freight + other. `cost` in rolling_results is
  // rolling_fp × that total, so these six rows sum back to the Cost total exactly.
  const COST_PARTS: { key: string; label: string; perFp: (p: CostProg) => number }[] = [
    { key: 'barra', label: 'Barra cost ($/kg WR)', perFp: (p) => (Number(p.primary_yield) > 0 ? Number(p.barra_cost_wr) / Number(p.primary_yield) : 0) },
    { key: 'packing', label: 'Packing', perFp: (p) => Number(p.packing_cost_fp) },
    { key: 'processing', label: 'Processing', perFp: (p) => Number(p.processing_cost_fp) },
    { key: 'storage', label: 'Storage', perFp: (p) => Number(p.storage_cost_fp) },
    { key: 'freight', label: 'Freight', perFp: (p) => Number(p.freight_cost_fp) },
    { key: 'other', label: 'Other costs', perFp: (p) => Number(p.other_costs_fp) },
  ];
  const progById = new Map(progRows.map((p) => [p.id, p]));
  const fpByPM = new Map<string, number>();
  for (const r of rr as { program_id: string; month_index: number; rolling_fp: number }[]) {
    fpByPM.set(`${r.program_id}:${r.month_index}`, Number(r.rolling_fp));
  }
  const costBreakdown = COST_PARTS.map(({ key, label, perFp }) => {
    const rows: GridRow[] = order.map((p) => {
      const prog = progById.get(p.id);
      const rate = prog ? perFp(prog) : 0;
      return {
        key: p.id, label: p.label, sublabel: p.sublabel,
        group: statusById.get(p.id) ?? 'active',
        values: Array.from({ length: m }, (_, i) => (fpByPM.get(`${p.id}:${i + 1}`) ?? 0) * rate),
      };
    });
    return { key, label, rows };
  });

  /**
   * The same six components per kilo, for the Unit cost tab. These rates are what
   * the program was set up with, so they sit flat across the months a program
   * ships in — and read 0 in a month it ships nothing, because there is no kilo
   * to charge. The weights keep those empty months out of the averages.
   */
  const unitCostBreakdown = COST_PARTS.map(({ key, label, perFp }) => {
    const rows: GridRow[] = order.map((p) => {
      const prog = progById.get(p.id);
      const rate = prog ? perFp(prog) : 0;
      const fp = Array.from({ length: m }, (_, i) => fpByPM.get(`${p.id}:${i + 1}`) ?? 0);
      return {
        key: p.id, label: p.label, sublabel: p.sublabel,
        group: statusById.get(p.id) ?? 'active',
        values: fp.map((v) => (v > 0 ? rate : 0)),
        weights: fp,
      };
    });
    return { key, label, rows };
  });

  // Secondary (by-product) revenue, folded into Revenue and Margin so both totals
  // cover the whole plan. Same arithmetic as the Secondary products page: quantity =
  // the whole round the engine actually allocated to the source product x the
  // recovery rate, revenue = quantity x price. Definitions are org-scoped and
  // matched on item_code, which survives scenario forks (they renumber program ids).
  // Feedstock is attributed to the status of the program that supplied it, so the
  // Active / Pipeline filters stay honest.
  type SecDef = { basis: 'program' | 'total_wr'; source_item_code: string | null; yield_pct: number; price_per_kg: number };
  const bump = (map: Map<string, number[]>, key: string, i: number, v: number) => {
    let arr = map.get(key);
    if (!arr) { arr = new Array<number>(m).fill(0); map.set(key, arr); }
    arr[i] += v;
  };
  let secByStatus: [string, number[]][] = [];
  const secDefRows = (secDefs ?? []) as SecDef[];
  if (secDefRows.length > 0) {
    const wrByStatus = new Map<string, number[]>();               // total-WR basis
    const wrByCode = new Map<string, Map<string, number[]>>();    // item_code -> status -> months
    for (const r of rr as { program_id: string; month_index: number; rolling_wr: number }[]) {
      const i = r.month_index - 1;
      const prog = progById.get(r.program_id);
      if (!prog || i < 0 || i >= m) continue;
      const wr = Number(r.rolling_wr) || 0;
      const st = prog.status ?? 'active';
      bump(wrByStatus, st, i, wr);
      let byStatus = wrByCode.get(prog.item_code);
      if (!byStatus) { byStatus = new Map<string, number[]>(); wrByCode.set(prog.item_code, byStatus); }
      bump(byStatus, st, i, wr);
    }
    const revByStatus = new Map<string, number[]>();
    for (const d of secDefRows) {
      // An unpriced by-product earns nothing — the Secondary products page warns about those.
      const rate = Number(d.yield_pct) * Number(d.price_per_kg);
      if (!(rate > 0)) continue;
      const feed = d.basis === 'total_wr' ? wrByStatus : wrByCode.get(d.source_item_code ?? '');
      if (!feed) continue;
      for (const [st, arr] of feed) for (let i = 0; i < m; i++) bump(revByStatus, st, i, arr[i] * rate);
    }
    secByStatus = [...revByStatus.entries()]
      .filter(([, v]) => v.some((x) => x !== 0))
      .sort(([a], [b]) => a.localeCompare(b));
  }

  /**
   * Secondary products carry no cost of their own in the model, so every dollar
   * of their revenue is also a dollar of margin — one set of values serves both
   * the Revenue and Margin tabs. Appended after the program rows, so the grid's
   * TOTAL is the plan's whole figure while the per-program rows above it stay
   * exactly the V30-parity numbers.
   */
  const secRows: GridRow[] = secByStatus.map(([st, values]) => ({
    key: `__secondary__${st}`,
    label: 'Secondary products',
    // Only worth naming the status when both contribute; otherwise it's noise.
    sublabel: secByStatus.length > 1 ? st : undefined,
    group: st,
    values,
  }));

  const metrics: Metric[] = [
    { key: 'revenue', label: 'Revenue', format: 'usd', rows: [...tag(gridRowsFor(order, rr, m, 'revenue')), ...secRows] },
    // Cost is the only tab without a Secondary products row — there is no secondary
    // cost to add, which is exactly why their revenue carries straight into margin.
    { key: 'cost', label: 'Cost', format: 'usd', rows: tag(gridRowsFor(order, rr, m, 'cost')), breakdown: costBreakdown },
    { key: 'margin', label: 'Margin', format: 'usd', rows: [...tag(gridRowsFor(order, rr, m, 'rolling_margin')), ...secRows] },
    // Same volume, costed at the path that actually supplied each kilo (spec §5.5)
    // rather than the primary path throughout. Excel does the latter, so `Margin`
    // stays the parity figure and this sits beside it.
    { key: 'margin_path', label: 'Margin (per-path)', format: 'usd', rows: [...tag(gridRowsFor(order, rr, m, 'rolling_margin_per_path')), ...secRows] },
    // Per kilo of finished product. Program rows only: secondary products are
    // recovered from round weight, so their revenue has no kg of finished
    // product behind it and cannot share this denominator.
    { key: 'unit_revenue', label: 'Unit revenue', format: 'usd2', aggregate: 'ratio', rows: tag(unitGridRowsFor(order, rr, m, 'revenue')) },
    { key: 'unit_cost', label: 'Unit cost', format: 'usd2', aggregate: 'ratio', rows: tag(unitGridRowsFor(order, rr, m, 'cost')), breakdown: unitCostBreakdown },
    { key: 'unit_margin', label: 'Unit margin', format: 'usd2', aggregate: 'ratio', rows: tag(unitGridRowsFor(order, rr, m, 'rolling_margin')) },
  ];

  // The column only has values after a recompute; existing rows default to 0.
  const perPathReady = (rr as { rolling_margin: number; rolling_margin_per_path: number }[])
    .some((r) => Number(r.rolling_margin_per_path) !== 0);
  const hasMargin = (rr as { rolling_margin: number }[]).some((r) => Number(r.rolling_margin) !== 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Revenue &amp; Cost</h1>
      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
      <p className="text-xs text-muted-foreground">
        The per-program rows of revenue, cost and margin reproduce the V30 workbook to the dollar (parity-tested to ±$1). Cost charges every kilo
        at the program&apos;s <b>primary-path</b> rate, exactly as Excel does; <b>Margin (per-path)</b> re-costs each kilo at
        the path that actually supplied it, which on the V30 baseline shifts the plan total by about 0.1% and individual
        programs by more. Filter by status to see active or pipeline (inquiry) programs only. On <b>Cost</b>, the dropdown
        splits the total into its components — barra, packing, processing, storage, freight and other — which sum back to
        the total. <b>Revenue</b> and both <b>Margin</b> tabs carry a <b>Secondary products</b> row beneath the programs,
        taken from the Secondary products page. Secondary products carry no cost of their own, so every dollar they
        earn is also a dollar of margin — which makes the <b>TOTAL</b> row on Margin the plan&apos;s total margin,
        programs and secondary products together. The program rows above it are untouched, so the parity figures are
        still there to read.
      </p>
      <p className="text-xs text-muted-foreground">
        <b>Unit revenue</b>, <b>Unit cost</b> and <b>Unit margin</b> are the same three figures divided by the kilos of
        finished product behind them — the realised price per kg, the loaded cost per kg, and the difference. A rate
        can&apos;t be added up, so on these three tabs the total column and the bottom row are a{' '}
        <b>weighted average</b>: total dollars ÷ total kilos, which lets a large program pull the average its way
        instead of counting equally with a small one. A month a program ships nothing has no rate, so it reads $0.00 and
        is left out of the averages rather than dragging them down. <b>Unit cost</b> splits into the same six components
        through the dropdown. These three tabs carry <b>no Secondary products row</b>: by-products are recovered from
        round weight, so their revenue has no kilo of finished product behind it and can&apos;t share this denominator —
        read them on the dollar tabs above.
      </p>
      {hasMargin && !perPathReady && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <b>Margin (per-path)</b> reads zero until the next Recalculate — it&apos;s a new figure and existing results
          predate it.
        </p>
      )}
      {order.length === 0 ? <NotComputed /> : (
        <MetricGrid planStartDate={plan.plan_start_date} horizon={m} metrics={metrics} filenameBase="revenue-cost" statusFilter rowFilter />
      )}
    </div>
  );
}
