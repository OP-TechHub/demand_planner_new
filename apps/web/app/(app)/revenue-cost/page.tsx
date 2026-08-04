import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import type { GridRow } from '@/lib/grid-csv';
import { StalePlanNotice } from '../stale-banner';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder, gridRowsFor } from '@/lib/outputs';

/** Three rows — Active, Pipeline, Combined — summing one rolling_results field per month. */
function statusSplitRows(
  rr: { program_id: string; month_index: number; [k: string]: number | string }[],
  statusById: Map<string, string>,
  months: number,
  valueKey: string
): GridRow[] {
  const active = new Array<number>(months).fill(0);
  const pipeline = new Array<number>(months).fill(0);
  for (const r of rr) {
    const i = r.month_index - 1;
    if (i < 0 || i >= months) continue;
    const v = Number(r[valueKey] ?? 0);
    const s = statusById.get(r.program_id);
    if (s === 'active') active[i] += v;
    else if (s === 'pipeline') pipeline[i] += v;
  }
  const combined = active.map((a, i) => a + pipeline[i]);
  return [
    { key: 'active', label: 'Active', values: active },
    { key: 'pipeline', label: 'Pipeline', values: pipeline },
    { key: 'combined', label: 'Combined', values: combined },
  ];
}

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

  const byStatus: Metric[] = [
    { key: 'revenue', label: 'Revenue', format: 'usd', rows: statusSplitRows(rr, statusById, m, 'revenue') },
    { key: 'cost', label: 'Cost', format: 'usd', rows: statusSplitRows(rr, statusById, m, 'cost') },
    { key: 'margin', label: 'Margin', format: 'usd', rows: statusSplitRows(rr, statusById, m, 'rolling_margin') },
  ];
  const byProgram: Metric[] = [
    { key: 'revenue', label: 'Revenue', format: 'usd', rows: gridRowsFor(order, rr, m, 'revenue') },
    { key: 'cost', label: 'Cost', format: 'usd', rows: gridRowsFor(order, rr, m, 'cost') },
    { key: 'margin', label: 'Margin', format: 'usd', rows: gridRowsFor(order, rr, m, 'rolling_margin') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Revenue &amp; Cost</h1>
        <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
        <p className="mt-1 text-xs text-muted-foreground">Uses flat price/cost (time-varying overrides deferred), so dollar figures differ slightly for a few programs. Volumes are exact.</p>
      </div>

      {order.length === 0 && rr.length === 0 ? (
        <NotComputed />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">By status</h2>
            <p className="text-xs text-muted-foreground">Active vs pipeline (inquiry) demand, and the two combined. Pipeline appears only where it's in the plan&apos;s scope.</p>
            <MetricGrid planStartDate={plan.plan_start_date} horizon={m} metrics={byStatus} firstColLabel="Group" filenameBase="revenue-cost-by-status" />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">By program</h2>
            <MetricGrid planStartDate={plan.plan_start_date} horizon={m} metrics={byProgram} filenameBase="revenue-cost" />
          </section>
        </>
      )}
    </div>
  );
}
