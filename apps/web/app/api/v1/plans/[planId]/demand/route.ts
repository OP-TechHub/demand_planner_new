import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadOrgPlan, planMeta } from '@/lib/api-plan';
import { clampWindow, getDemand } from '@/lib/queries/plan-data';

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

  const svc = createServiceClient();
  const plan = await loadOrgPlan(svc, auth.caller.orgId, planId);
  if (!plan) return jsonError(404, 'plan_not_found', 'No such plan in this organisation.');

  const win = clampWindow(plan, Number(url.searchParams.get('from_month')), Number(url.searchParams.get('to_month')));
  return jsonOk(await getDemand(svc, plan, win, url.searchParams.get('item_code')), planMeta(plan));
}
