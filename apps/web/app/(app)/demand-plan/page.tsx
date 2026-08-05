import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile, getMyPlanGrants } from '@/lib/plan';
import { canEditPlanSection, type DemandCell, type Program, type UserRole } from '@oceanpick/shared';
import { fetchAllByPlan } from '@/lib/fetch-all';
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
  // demand_plan can exceed PostgREST's 1000-row cap (programs × 60), so page
  // through it — otherwise recently-added rows silently render as baseline.
  const [{ data: programs }, rows, profile, grants, fulfil] = await Promise.all([
    supabase.from('programs').select('*').eq('plan_id', plan.id).is('deleted_at', null).order('sort_order'),
    fetchAllByPlan(supabase, 'demand_plan', '*', plan.id),
    getProfile(),
    getMyPlanGrants(plan.id),
    // Last recompute's per-program-month demand vs fulfilled, for the cell colouring.
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, demand_fp, rolling_fp', plan.id),
  ]);
  const fulfilment = fulfil.map((r) => ({ program_id: r.program_id as string, month_index: r.month_index as number, demand_fp: Number(r.demand_fp), rolling_fp: Number(r.rolling_fp) }));

  const canEdit = canEditPlanSection(
    plan,
    { id: profile?.id ?? '', role: (profile?.role ?? 'viewer') as UserRole },
    grants.has('demand_plan')
  );

  return (
    <DemandClient
      planId={plan.id}
      planStartDate={plan.plan_start_date}
      horizon={plan.horizon_months}
      programs={(programs ?? []) as Program[]}
      demandRows={rows as DemandCell[]}
      fulfilment={fulfilment}
      canEdit={canEdit}
    />
  );
}
