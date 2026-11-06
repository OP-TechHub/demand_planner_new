import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { StalePlanNotice } from '../stale-banner';
import { type Metric } from '@/components/metric-grid';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder, gridRowsFor } from '@/lib/outputs';
import { OfflineCopy } from '@/components/pwa/offline-copy';
import { SixtyMonthView } from './sixty-month-view';

export default async function SixtyMonthPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">60-Month Summary</h1>;
  const supabase = await createClient();
  const [order, rr] = await Promise.all([
    programOrder(supabase, plan.id),
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, rolling_fp, rolling_wr, rolling_margin', plan.id),
  ]);
  const m = plan.horizon_months;

  // Full figures, not the abbreviated `kg`/`usd` scales — this grid is read
  // cell by cell, where "5k" hides the difference between 4,600 and 5,400.
  const metrics: Metric[] = [
    { key: 'fp', label: 'Allocated FP', unit: 'kg FP', format: 'num0', rows: gridRowsFor(order, rr, m, 'rolling_fp') },
    { key: 'wr', label: 'Allocated WR', unit: 'kg WR', format: 'num0', rows: gridRowsFor(order, rr, m, 'rolling_wr') },
    { key: 'margin', label: 'Margin', unit: '$', format: 'usd0', rows: gridRowsFor(order, rr, m, 'rolling_margin') },
  ];

  const props = {
    planStartDate: plan.plan_start_date,
    horizon: m,
    metrics,
    notComputed: order.length === 0,
  };
  const view = (
    <SixtyMonthView {...props} staleNotice={<StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />} />
  );
  // Not computed yet → nothing worth copying to the device.
  if (props.notComputed) return view;
  return (
    <OfflineCopy route="sixty-month" props={props}>
      {view}
    </OfflineCopy>
  );
}
