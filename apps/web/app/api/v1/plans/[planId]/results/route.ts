import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadOrgPlan, planMeta, monthCol } from '@/lib/api-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/plans/{planId}/results — the computed engine output per item per
 * month: what's demanded, what the plan can actually supply (rolling FP/WR),
 * the fulfilment %, and the shortfall. This is the "can we supply it?" data.
 *
 * These come from the last recompute; if the plan was edited since, they're
 * stale until the next run. Optional `item_code`, `from_month`, `to_month`.
 * FP = finished product kg, WR = whole-round kg.
 */
export async function GET(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const auth = await authenticateApiRequest(req);
  if ('error' in auth) return auth.error;
  const { planId } = await params;
  const url = new URL(req.url);
  const itemCode = url.searchParams.get('item_code');
  const from = Number(url.searchParams.get('from_month')) || 1;
  const to = Number(url.searchParams.get('to_month')) || Infinity;

  const svc = createServiceClient();
  const plan = await loadOrgPlan(svc, auth.caller.orgId, planId);
  if (!plan) return jsonError(404, 'plan_not_found', 'No such plan in this organisation.');

  const lo = Math.max(1, Math.trunc(from));
  const hi = Math.min(plan.horizon_months, to === Infinity ? plan.horizon_months : Math.trunc(to));

  let progQ = svc
    .from('programs')
    .select('id, item_code')
    .eq('plan_id', plan.id)
    .is('deleted_at', null)
    .order('sort_order');
  if (itemCode) progQ = progQ.eq('item_code', itemCode);
  const { data: progs } = await progQ;
  const programs = (progs ?? []) as { id: string; item_code: string }[];
  const codeById = new Map(programs.map((p) => [p.id, p.item_code]));
  const ids = programs.map((p) => p.id);

  const rowsByCode = new Map<string, ResultMonth[]>();
  if (ids.length) {
    const { data: results } = await svc
      .from('rolling_results')
      .select('program_id, month_index, demand_fp, rolling_fp, rolling_wr, fulfilment_pct, unfulfilled_wr, revenue, cost')
      .eq('plan_id', plan.id)
      .in('program_id', ids)
      .gte('month_index', lo)
      .lte('month_index', hi)
      .order('month_index');
    for (const r of (results ?? []) as RawResult[]) {
      const code = codeById.get(r.program_id);
      if (!code) continue;
      const list = rowsByCode.get(code) ?? [];
      list.push({
        ...monthCol(plan, r.month_index),
        demand_fp: Number(r.demand_fp),
        available_fp: Number(r.rolling_fp),
        available_wr: Number(r.rolling_wr),
        fulfilment_pct: r.fulfilment_pct == null ? null : Number(r.fulfilment_pct),
        unfulfilled_wr: Number(r.unfulfilled_wr),
        revenue: Number(r.revenue),
        cost: Number(r.cost),
      });
      rowsByCode.set(code, list);
    }
  }

  const data = programs.map((p) => ({ item_code: p.item_code, months: rowsByCode.get(p.item_code) ?? [] }));
  return jsonOk(data, { ...planMeta(plan), note: 'Results reflect the last recompute; edits since then are not included.' });
}

type RawResult = {
  program_id: string; month_index: number; demand_fp: number; rolling_fp: number;
  rolling_wr: number; fulfilment_pct: number | null; unfulfilled_wr: number; revenue: number; cost: number;
};
type ResultMonth = {
  month_index: number; month: string; demand_fp: number; available_fp: number; available_wr: number;
  fulfilment_pct: number | null; unfulfilled_wr: number; revenue: number; cost: number;
};
