import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import type { GridRow } from '@/lib/grid-csv';
import { StalePlanNotice } from '../stale-banner';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder, gridRowsFor } from '@/lib/outputs';

export default async function RevenueCostPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Revenue &amp; Cost</h1>;
  const supabase = await createClient();
  const m = plan.horizon_months;

  const [order, rr, { data: progs }] = await Promise.all([
    programOrder(supabase, plan.id),
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, rolling_fp, revenue, cost, rolling_margin', plan.id),
    supabase.from('programs')
      .select('id, status, primary_yield, barra_cost_wr, packing_cost_fp, processing_cost_fp, storage_cost_fp, freight_cost_fp, other_costs_fp')
      .eq('plan_id', plan.id).is('deleted_at', null),
  ]);
  type CostProg = {
    id: string; status: string; primary_yield: number; barra_cost_wr: number;
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

  const metrics: Metric[] = [
    { key: 'revenue', label: 'Revenue', format: 'usd', rows: tag(gridRowsFor(order, rr, m, 'revenue')) },
    { key: 'cost', label: 'Cost', format: 'usd', rows: tag(gridRowsFor(order, rr, m, 'cost')), breakdown: costBreakdown },
    { key: 'margin', label: 'Margin', format: 'usd', rows: tag(gridRowsFor(order, rr, m, 'rolling_margin')) },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Revenue &amp; Cost</h1>
      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
      <p className="text-xs text-muted-foreground">Uses flat price/cost (time-varying overrides deferred), so dollar figures differ slightly for a few programs. Volumes are exact. Filter by status to see active or pipeline (inquiry) programs only. On <b>Cost</b>, the dropdown splits the total into its components — barra, packing, processing, storage, freight and other — which sum back to the total.</p>
      {order.length === 0 ? <NotComputed /> : (
        <MetricGrid planStartDate={plan.plan_start_date} horizon={m} metrics={metrics} filenameBase="revenue-cost" statusFilter />
      )}
    </div>
  );
}
