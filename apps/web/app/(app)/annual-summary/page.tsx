import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { StalePlanNotice } from '../stale-banner';
import { bySummaryPeriod, withSideProducts } from '@/lib/annual-summary';
import { sideProductTotals } from '@/lib/side-products';
import { OfflineCopy } from '@/components/pwa/offline-copy';
import { AnnualSummaryView } from './annual-summary-view';

export default async function AnnualSummaryPage() {
  const plan = await getActivePlan();
  if (!plan) return <NoPlan />;
  const supabase = await createClient();
  // Secondary and other products sit outside `plan_summary` — the engine only
  // knows about programs — so they are added on read.
  const [{ data: rows }, side] = await Promise.all([
    supabase.from('plan_summary').select('*').eq('plan_id', plan.id),
    sideProductTotals(supabase, plan.id, plan.horizon_months),
  ]);
  const byPeriod = withSideProducts(bySummaryPeriod(rows), side);

  const props = {
    byPeriod,
    hasRows: !!rows && rows.length > 0,
  };
  const view = (
    <AnnualSummaryView {...props} staleNotice={<StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />} />
  );
  // Not computed yet → nothing worth copying to the device.
  if (!props.hasRows) return view;
  return (
    <OfflineCopy route="annual-summary" props={props}>
      {view}
    </OfflineCopy>
  );
}

function NoPlan() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
      <p className="font-semibold text-warning">No master plan found</p>
    </div>
  );
}
