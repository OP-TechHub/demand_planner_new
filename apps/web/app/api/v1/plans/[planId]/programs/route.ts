import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadOrgPlan, planMeta } from '@/lib/api-plan';

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

  const { data } = await svc
    .from('programs')
    .select('item_code, item_description, customer, status, max_monthly_demand_fp, price_per_fp')
    .eq('plan_id', plan.id)
    .is('deleted_at', null)
    .order('sort_order');

  const programs = (data ?? []).map((p: {
    item_code: string; item_description: string; customer: string; status: string;
    max_monthly_demand_fp: number; price_per_fp: number;
  }) => ({
    item_code: p.item_code,
    item_description: p.item_description,
    customer: p.customer,
    status: p.status,
    baseline_monthly_demand_fp: Number(p.max_monthly_demand_fp),
    price_per_fp: Number(p.price_per_fp),
  }));

  return jsonOk(programs, planMeta(plan));
}
