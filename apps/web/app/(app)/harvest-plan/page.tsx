import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { can, type Bucket, type HarvestCell, type UserRole } from '@oceanpick/shared';
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
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: buckets }, { data: rows }, { data: me }] = await Promise.all([
    supabase.from('buckets').select('*').eq('is_archived', false).order('sort_order'),
    supabase.from('harvest_plan').select('*').eq('plan_id', plan.id),
    supabase.from('users').select('role').eq('id', user!.id).maybeSingle(),
  ]);

  const canEdit = can.editMaster((me?.role ?? 'viewer') as UserRole);

  return (
    <HarvestClient
      planId={plan.id}
      planStartDate={plan.plan_start_date}
      horizon={plan.horizon_months}
      buckets={(buckets ?? []) as Bucket[]}
      harvestRows={(rows ?? []) as HarvestCell[]}
      canEdit={canEdit}
    />
  );
}
