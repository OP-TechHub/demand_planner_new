import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadOrgPlan, planMeta } from '@/lib/api-plan';
import { clampWindow, getResults } from '@/lib/queries/plan-data';

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

  const svc = createServiceClient();
  const plan = await loadOrgPlan(svc, auth.caller.orgId, planId);
  if (!plan) return jsonError(404, 'plan_not_found', 'No such plan in this organisation.');

  const win = clampWindow(plan, Number(url.searchParams.get('from_month')), Number(url.searchParams.get('to_month')));
  const data = await getResults(svc, plan, win, url.searchParams.get('item_code'));
  return jsonOk(data, { ...planMeta(plan), note: 'Results reflect the last recompute; edits since then are not included.' });
}
