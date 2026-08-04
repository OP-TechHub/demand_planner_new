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
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, revenue, cost, rolling_margin', plan.id),
    supabase.from('programs').select('id, status').eq('plan_id', plan.id).is('deleted_at', null),
  ]);
  const statusById = new Map<string, string>((progs ?? []).map((p: { id: string; status: string }) => [p.id, p.status]));
  // Tag each program row with its status, so the grid can filter by it.
  const tag = (rows: GridRow[]): GridRow[] => rows.map((r) => ({ ...r, group: statusById.get(r.key) ?? 'active' }));

  const metrics: Metric[] = [
    { key: 'revenue', label: 'Revenue', format: 'usd', rows: tag(gridRowsFor(order, rr, m, 'revenue')) },
    { key: 'cost', label: 'Cost', format: 'usd', rows: tag(gridRowsFor(order, rr, m, 'cost')) },
    { key: 'margin', label: 'Margin', format: 'usd', rows: tag(gridRowsFor(order, rr, m, 'rolling_margin')) },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Revenue &amp; Cost</h1>
      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
      <p className="text-xs text-muted-foreground">Uses flat price/cost (time-varying overrides deferred), so dollar figures differ slightly for a few programs. Volumes are exact. Filter by status to see active or pipeline (inquiry) programs only.</p>
      {order.length === 0 ? <NotComputed /> : (
        <MetricGrid planStartDate={plan.plan_start_date} horizon={m} metrics={metrics} filenameBase="revenue-cost" statusFilter />
      )}
    </div>
  );
}
