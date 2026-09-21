import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile, getMyPlanGrants } from '@/lib/plan';
import {
  canEditPlanSection,
  canExportData,
  type Bucket,
  type HarvestCell,
  type HarvestRequestCell,
  type HarvestActualCell,
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
  const [{ data: buckets }, rows, { data: requestRows }, { data: actualRows }, profile, grants, { data: progs }, demand, poLines] = await Promise.all([
    supabase.from('buckets').select('*').eq('is_archived', false).order('sort_order'),
    fetchAllByPlan(supabase, 'harvest_plan', '*', plan.id),
    // buckets x 60 stays well under PostgREST's 1000-row cap, unlike capacity,
    // because a request is stated for the months the plant is actually asking about.
    supabase
      .from('harvest_request')
      .select('plan_id, bucket_id, month_index, quantity_kg_wr')
      .eq('plan_id', plan.id),
    // Same size as the request — a month only has a row once something is recorded.
    supabase
      .from('harvest_actual')
      .select('plan_id, bucket_id, month_index, quantity_kg_wr')
      .eq('plan_id', plan.id),
    getProfile(),
    getMyPlanGrants(plan.id),
    supabase
      .from('programs')
      .select('id, status, primary_yield, max_monthly_demand_fp')
      .eq('plan_id', plan.id).is('deleted_at', null),
    fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', plan.id),
    fetchAllByPlan(supabase, 'po_updates', 'program_id, month_index', plan.id),
  ]);

  // Required harvest: the whole round the demand book needs, demand_fp /
  // primary_yield (spec §2.2), split by how firm the demand is — the same three
  // groups the Order Book colours. Read straight from the demand plan, so it
  // doesn't wait on a recalculation. Pipeline counts its full ask: this is what
  // it would take to fulfil it, not what supply can cover.
  const horizon = plan.horizon_months;
  const required = {
    po: new Array<number>(horizon).fill(0),
    active: new Array<number>(horizon).fill(0),
    pipeline: new Array<number>(horizon).fill(0),
  };
  const overrides = new Map<string, number>();
  for (const d of demand as { program_id: string; month_index: number; demand_fp: number }[]) {
    overrides.set(`${d.program_id}:${d.month_index}`, Number(d.demand_fp));
  }
  const hasPo = new Set(
    (poLines as { program_id: string; month_index: number }[]).map((l) => `${l.program_id}:${l.month_index}`)
  );
  type Prog = { id: string; status: string; primary_yield: number; max_monthly_demand_fp: number };
  for (const p of (progs ?? []) as Prog[]) {
    const y = Number(p.primary_yield);
    if (!(y > 0)) continue;
    for (let m = 1; m <= horizon; m++) {
      const k = `${p.id}:${m}`;
      const dem = overrides.get(k) ?? Number(p.max_monthly_demand_fp);
      if (!(dem > 0)) continue;
      const wr = dem / y;
      if (p.status === 'pipeline') required.pipeline[m - 1] += wr;
      // A PO is firm whatever the program's status, as on the Order Book.
      else if (hasPo.has(k)) required.po[m - 1] += wr;
      else if (p.status === 'active') required.active[m - 1] += wr;
    }
  }

  const me = { id: profile?.id ?? '', role: (profile?.role ?? 'viewer') as UserRole };
  const canEdit = canEditPlanSection(plan, me, grants.has('harvest_plan'));
  // The request plan is the processing plant's, on its own grant — holding
  // harvest_plan does not confer it.
  const canEditRequest = canEditPlanSection(plan, me, grants.has('harvest_request'));
  // Recording what was landed is the farm's job — its own grant again, so holding
  // neither capacity nor the request confers it.
  const canEditActual = canEditPlanSection(plan, me, grants.has('harvest_actual'));

  // Passed as rows rather than a keyed object: the grid needs the size too, and
  // a null bucket has to survive the trip intact rather than collapsing into a
  // month key that cannot tell "no size stated" from a bucket named nothing.
  const request = ((requestRows ?? []) as HarvestRequestCell[]).map((r) => ({
    ...r,
    quantity_kg_wr: Number(r.quantity_kg_wr),
  }));
  const actual = ((actualRows ?? []) as HarvestActualCell[]).map((r) => ({
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
      canExport={canExportData(me.role, profile?.edit_sections)}
      request={request}
      canEditRequest={canEditRequest}
      actual={actual}
      canEditActual={canEditActual}
      required={required}
    />
  );
}
