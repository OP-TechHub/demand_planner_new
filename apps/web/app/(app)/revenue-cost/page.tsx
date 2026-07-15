import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder, gridRowsFor } from '@/lib/outputs';

export default async function RevenueCostPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Revenue &amp; Cost</h1>;
  const supabase = await createClient();
  const order = await programOrder(supabase, plan.id);
  const rr = await fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, revenue, cost, rolling_margin', plan.id);
  const m = plan.horizon_months;

  const metrics: Metric[] = [
    { key: 'revenue', label: 'Revenue', format: 'usd', rows: gridRowsFor(order, rr, m, 'revenue') },
    { key: 'cost', label: 'Cost', format: 'usd', rows: gridRowsFor(order, rr, m, 'cost') },
    { key: 'margin', label: 'Margin', format: 'usd', rows: gridRowsFor(order, rr, m, 'rolling_margin') },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Revenue &amp; Cost</h1>
      <p className="text-xs text-muted-foreground">Uses flat price/cost (time-varying overrides deferred), so dollar figures differ slightly for a few programs. Volumes are exact.</p>
      {order.length === 0 ? <NotComputed /> : (
        <MetricGrid planStartDate={plan.plan_start_date} horizon={m} metrics={metrics} />
      )}
    </div>
  );
}
