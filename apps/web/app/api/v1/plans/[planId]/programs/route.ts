import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadOrgPlan, planMeta } from '@/lib/api-plan';
import { getPrograms } from '@/lib/queries/plan-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/plans/{planId}/programs — the item master for a plan: item_code
 * (the join key for a PO line), description, customer, price, and buckets.
 * Quantities everywhere in the API are kg of finished product (FP).
 */
export async function GET(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const auth = await authenticateApiRequest(req);
  if ('error' in auth) return auth.error;
  const { planId } = await params;

  const svc = createServiceClient();
  const plan = await loadOrgPlan(svc, auth.caller.orgId, planId);
  if (!plan) return jsonError(404, 'plan_not_found', 'No such plan in this organisation.');

  return jsonOk(await getPrograms(svc, plan), planMeta(plan));
}
