import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile, getMyPlanGrants } from '@/lib/plan';
import {
  canEditPlanSection,
  type Bucket,
  type HarvestCell,
  type HarvestRequestCell,
  type UserRole,
} from '@oceanpick/shared';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { HarvestClient } from './harvest-client';

export default async function HarvestPlanPage() {
  const plan = await getActivePlan();
  if (!plan) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
        <p className="font-semibold text-warning">No master plan found</p>
        <p className="mt-1 text-warning">
          Run <code className="rounded bg-warning/15 px-1">supabase/seed.sql</code> first.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  // harvest_plan can exceed PostgREST's 1000-row cap (buckets × 60), so page it.
  const [{ data: buckets }, rows, { data: requestRows }, profile, grants] = await Promise.all([
    supabase.from('buckets').select('*').eq('is_archived', false).order('sort_order'),
    fetchAllByPlan(supabase, 'harvest_plan', '*', plan.id),
    // buckets x 60 stays well under PostgREST's 1000-row cap, unlike capacity,
    // because a request is stated for the months the plant is actually asking about.
    supabase
      .from('harvest_request')
      .select('plan_id, bucket_id, month_index, quantity_kg_wr')
      .eq('plan_id', plan.id),
    getProfile(),
    getMyPlanGrants(plan.id),
  ]);

  const me = { id: profile?.id ?? '', role: (profile?.role ?? 'viewer') as UserRole };
  const canEdit = canEditPlanSection(plan, me, grants.has('harvest_plan'));
  // The request plan is the processing plant's, on its own grant — holding
  // harvest_plan does not confer it.
  const canEditRequest = canEditPlanSection(plan, me, grants.has('harvest_request'));

  // Passed as rows rather than a keyed object: the grid needs the size too, and
  // a null bucket has to survive the trip intact rather than collapsing into a
  // month key that cannot tell "no size stated" from a bucket named nothing.
  const request = ((requestRows ?? []) as HarvestRequestCell[]).map((r) => ({
    ...r,
    quantity_kg_wr: Number(r.quantity_kg_wr),
  }));

  return (
    <HarvestClient
      planId={plan.id}
      planStartDate={plan.plan_start_date}
      horizon={plan.horizon_months}
      buckets={(buckets ?? []) as Bucket[]}
      harvestRows={rows as HarvestCell[]}
      canEdit={canEdit}
      request={request}
      canEditRequest={canEditRequest}
    />
  );
}
