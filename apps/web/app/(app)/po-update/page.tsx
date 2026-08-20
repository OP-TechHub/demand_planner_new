import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile, getMyPlanGrants } from '@/lib/plan';
import { canEditPlanSection, type UserRole } from '@oceanpick/shared';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { StalePlanNotice } from '../stale-banner';
import { PoUpdateClient, type PoLine, type DemandCell, type ProgramRow } from './po-update-client';

/**
 * PO Update — customer purchase orders as they come in.
 *
 * Organised program-first: every program in the plan is listed, active and
 * pipeline apart, and you pick the one a PO arrived for. A received PO is a firm
 * order, so it supersedes the forecast — for any month a PO names, that month's
 * Demand Plan quantity becomes the SUM of the POs held against it, and removing
 * the last PO puts back whatever the first one displaced. All of that lives in
 * ./actions.ts; this page only reads.
 *
 * Rows are stored one per (program, month); a PO spanning several months is a
 * group of lines sharing one `po_ref`, which the client folds back into one PO.
 */
export default async function PoUpdatePage() {
  const plan = await getActivePlan();
  if (!plan) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
        <p className="font-semibold text-warning">No plan selected</p>
        <p className="mt-1 text-warning">Pick a plan in the top bar before recording POs.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: progs }, lines, demand, profile, grants] = await Promise.all([
    supabase
      .from('programs')
      .select('id, item_code, item_description, customer, status, max_monthly_demand_fp')
      .eq('plan_id', plan.id).is('deleted_at', null).order('sort_order'),
    // One row per program-month, so a year of POs across many programs can pass
    // PostgREST's 1000-row cap — page through it like the other month grids.
    fetchAllByPlan(supabase, 'po_updates', 'id, program_id, month_index, quantity_fp, po_ref, received_on, notes', plan.id),
    // The demand each program is carrying, so the list can show what the POs are
    // being received against. Sparse: a missing month falls back to the program's
    // baseline (data-model.md §4), which the client applies.
    fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', plan.id),
    getProfile(),
    getMyPlanGrants(plan.id),
  ]);

  // Recording a PO rewrites the demand plan, so it is gated on that same grant
  // rather than one of its own (see the migration's PERMISSION note).
  const canEdit = canEditPlanSection(
    plan,
    { id: profile?.id ?? '', role: (profile?.role ?? 'viewer') as UserRole },
    grants.has('demand_plan')
  );

  const programs = ((progs ?? []) as ProgramRow[]).map((p) => ({
    id: p.id, item_code: p.item_code, item_description: p.item_description,
    customer: p.customer, status: p.status,
    max_monthly_demand_fp: Number(p.max_monthly_demand_fp),
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">PO Update</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the program a purchase order arrived for and record it. The quantity you enter becomes that
          month&apos;s Demand Plan figure.
        </p>
      </div>

      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />

      <PoUpdateClient
        planId={plan.id}
        planStartDate={plan.plan_start_date}
        horizon={plan.horizon_months}
        programs={programs}
        lines={lines as PoLine[]}
        demand={demand as DemandCell[]}
        canEdit={canEdit}
      />
    </div>
  );
}
