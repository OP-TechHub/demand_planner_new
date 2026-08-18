import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPaged } from '@/lib/fetch-all';
import { loadOrgPlan, planMeta, monthCol } from '@/lib/api-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/plans/{planId}/demand — planned (effective) demand per item per
 * month, in kg FP. Effective = the month's override if one is set, else the
 * program's baseline; this endpoint resolves that so a caller never has to.
 *
 * Optional query params narrow the grid: `item_code`, `from_month`, `to_month`
 * (1-based indexes). All quantities are kg FP.
 */
export async function GET(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const auth = await authenticateApiRequest(req);
  if ('error' in auth) return auth.error;
  const { planId } = await params;
  const url = new URL(req.url);
  const itemCode = url.searchParams.get('item_code');
  const from = clamp(Number(url.searchParams.get('from_month')) || 1, 1);
  const to = clamp(Number(url.searchParams.get('to_month')) || Infinity, 1);

  const svc = createServiceClient();
  const plan = await loadOrgPlan(svc, auth.caller.orgId, planId);
  if (!plan) return jsonError(404, 'plan_not_found', 'No such plan in this organisation.');

  const lo = Math.max(1, from);
  const hi = Math.min(plan.horizon_months, to);

  let progQ = svc
    .from('programs')
    .select('id, item_code, max_monthly_demand_fp')
    .eq('plan_id', plan.id)
    .is('deleted_at', null)
    .order('sort_order');
  if (itemCode) progQ = progQ.eq('item_code', itemCode);
  const { data: progs } = await progQ;

  const programs = (progs ?? []) as { id: string; item_code: string; max_monthly_demand_fp: number }[];

  // Overrides for just these programs.
  const ids = programs.map((p) => p.id);
  const overrides = new Map<string, number>();
  if (ids.length) {
    // Paged: programs × months can exceed PostgREST's 1000-row cap, and a truncated
    // page here is invisible — the missing overrides would silently fall back to
    // the baseline below and the response would look plausible but be wrong.
    // Also narrowed to the requested months, which is all the response uses.
    const rows = await fetchAllPaged(
      (f, t) => svc
        .from('demand_plan')
        .select('program_id, month_index, demand_fp')
        .eq('plan_id', plan.id)
        .in('program_id', ids)
        .gte('month_index', lo)
        .lte('month_index', hi)
        .range(f, t),
      'demand_plan'
    );
    for (const r of rows as { program_id: string; month_index: number; demand_fp: number }[]) {
      overrides.set(`${r.program_id}:${r.month_index}`, Number(r.demand_fp));
    }
  }

  const data = programs.map((p) => {
    const baseline = Number(p.max_monthly_demand_fp);
    const months = [];
    for (let m = lo; m <= hi; m++) {
      months.push({ ...monthCol(plan, m), demand_fp: overrides.get(`${p.id}:${m}`) ?? baseline });
    }
    return { item_code: p.item_code, baseline_monthly_demand_fp: baseline, months };
  });

  return jsonOk(data, planMeta(plan));
}

function clamp(n: number, min: number): number {
  return Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : (n as number);
}
