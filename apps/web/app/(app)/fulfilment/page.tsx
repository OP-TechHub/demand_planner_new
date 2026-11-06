import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { type GridRow } from '@/lib/grid-csv';
import { StalePlanNotice } from '../stale-banner';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder } from '@/lib/outputs';
import { OfflineCopy } from '@/components/pwa/offline-copy';
import { FulfilmentView } from './fulfilment-view';

export default async function FulfilmentPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Program Fulfilment</h1>;
  const supabase = await createClient();

  const [order, rr] = await Promise.all([
    programOrder(supabase, plan.id),
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, fulfilment_pct', plan.id),
  ]);
  const byPM = new Map<string, number | null>();
  for (const r of rr) byPM.set(`${r.program_id}:${r.month_index}`, r.fulfilment_pct);
  const months = Array.from({ length: plan.horizon_months }, (_, i) => i + 1);

  const rows: GridRow[] = order.map((p) => ({
    key: p.id, label: p.label, sublabel: p.sublabel,
    values: months.map((m) => byPM.get(`${p.id}:${m}`) ?? null),
  }));

  const props = {
    planStartDate: plan.plan_start_date,
    horizon: plan.horizon_months,
    planName: plan.name,
    rows,
  };
  const view = (
    <FulfilmentView {...props} staleNotice={<StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />} />
  );
  // Not computed yet → nothing worth copying to the device.
  if (rows.length === 0) return view;
  return (
    <OfflineCopy route="fulfilment" props={props}>
      {view}
    </OfflineCopy>
  );
}
