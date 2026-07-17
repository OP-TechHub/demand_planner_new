import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile } from '@/lib/plan';
import { canEditPlanSection, type DemandCell, type Program, type UserRole } from '@oceanpick/shared';
import { DemandClient } from './demand-client';

export default async function DemandPlanPage() {
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
  const [{ data: programs }, { data: rows }, profile] = await Promise.all([
    supabase.from('programs').select('*').eq('plan_id', plan.id).is('deleted_at', null).order('sort_order'),
    supabase.from('demand_plan').select('*').eq('plan_id', plan.id),
    getProfile(),
  ]);

  const canEdit = canEditPlanSection(
    plan,
    { id: profile?.id ?? '', role: (profile?.role ?? 'viewer') as UserRole, edit_sections: profile?.edit_sections },
    'demand_plan'
  );

  return (
    <DemandClient
      planId={plan.id}
      planStartDate={plan.plan_start_date}
      horizon={plan.horizon_months}
      programs={(programs ?? []) as Program[]}
      demandRows={(rows ?? []) as DemandCell[]}
      canEdit={canEdit}
    />
  );
}
