import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder, gridRowsFor } from '@/lib/outputs';

export default async function SixtyMonthPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">60-Month Summary</h1>;
  const supabase = await createClient();
  const order = await programOrder(supabase, plan.id);
  const rr = await fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, rolling_fp, rolling_wr, rolling_margin', plan.id);
  const m = plan.horizon_months;

  const metrics: Metric[] = [
    { key: 'fp', label: 'Allocated FP', format: 'kg', rows: gridRowsFor(order, rr, m, 'rolling_fp') },
    { key: 'wr', label: 'Allocated WR', format: 'kg', rows: gridRowsFor(order, rr, m, 'rolling_wr') },
    { key: 'margin', label: 'Margin $', format: 'usd', rows: gridRowsFor(order, rr, m, 'rolling_margin') },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">60-Month Summary</h1>
      {order.length === 0 ? <NotComputed /> : (
        <MetricGrid planStartDate={plan.plan_start_date} horizon={m} metrics={metrics} filenameBase="60-month" />
      )}
    </div>
  );
}
