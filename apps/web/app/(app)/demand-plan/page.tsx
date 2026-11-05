import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile, getMyPlanGrants } from '@/lib/plan';
import { canEditPlanSection, canExportData, type DemandCell, type Program, type UserRole } from '@oceanpick/shared';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { MAX_LOOKBACK } from '@oceanpick/engine';
import { DemandClient, type AllocLine, type AllocPath } from './demand-client';

/** rolling_results borrow columns → (months back, sourcing path). */
const BORROW_CHANNELS: { col: string; offset: number; path: AllocPath }[] =
  Array.from({ length: MAX_LOOKBACK }, (_, i) => i + 1).flatMap((offset) =>
    ([['prim', 'primary'], ['alt', 'secondary'], ['tert', 'tertiary']] as const).map(([suffix, path]) => ({
      col: `borrow_m${offset}_${suffix}_wr`,
      offset,
      path,
    }))
  );
const BORROW_COLS = BORROW_CHANNELS.map((c) => c.col);

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
  const [{ data: programs }, rows, profile, grants, fulfil, allocs, { data: buckets }] = await Promise.all([
    supabase.from('programs').select('*').eq('plan_id', plan.id).is('deleted_at', null).order('sort_order'),
    fetchAllByPlan(supabase, 'demand_plan', '*', plan.id),
    getProfile(),
    getMyPlanGrants(plan.id),
    // Last recompute's per-program-month demand vs fulfilled (cell colouring),
    // plus the borrow channels for the whole-round breakdown in the tooltip.
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, demand_fp, rolling_fp, ' + BORROW_COLS.join(', '), plan.id),
    // Own-month whole round taken per sourcing path.
    fetchAllByPlan(supabase, 'allocations', 'program_id, month_index, path, allocated_wr', plan.id),
    supabase.from('buckets').select('id, name'),
  ]);
  const fulfilment = fulfil.map((r) => ({ program_id: r.program_id as string, month_index: r.month_index as number, demand_fp: Number(r.demand_fp), rolling_fp: Number(r.rolling_fp) }));

  // Whole round behind each program-month: own-month WR per path, then every
  // borrow channel (offset months back, same path). Only non-zero lines travel.
  const wrLines: AllocLine[] = [];
  for (const a of allocs) {
    const wr = Number(a.allocated_wr);
    if (wr > 1e-6) wrLines.push({ program_id: a.program_id as string, month_index: a.month_index as number, path: a.path as AllocPath, offset: 0, wr });
  }
  for (const r of fulfil) {
    for (const ch of BORROW_CHANNELS) {
      const wr = Number(r[ch.col] ?? 0);
      if (wr > 1e-6) wrLines.push({ program_id: r.program_id as string, month_index: r.month_index as number, path: ch.path, offset: ch.offset, wr });
    }
  }
  const bucketNames = Object.fromEntries((buckets ?? []).map((b) => [b.id as string, b.name as string]));

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
      wrLines={wrLines}
      bucketNames={bucketNames}
      canEdit={canEdit}
      canExport={canExportData((profile?.role ?? 'viewer') as UserRole, profile?.edit_sections)}
    />
  );
}
