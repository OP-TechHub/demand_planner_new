import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile } from '@/lib/plan';
import { canEditSection, type Bucket, type HarvestCell, type UserRole } from '@oceanpick/shared';
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
  const [{ data: buckets }, { data: rows }, profile] = await Promise.all([
    supabase.from('buckets').select('*').eq('is_archived', false).order('sort_order'),
    supabase.from('harvest_plan').select('*').eq('plan_id', plan.id),
    getProfile(),
  ]);

  const canEdit = canEditSection((profile?.role ?? 'viewer') as UserRole, profile?.edit_sections, 'harvest_plan');

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
