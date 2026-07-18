import { authenticateApiRequest, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/plans — the org's plans (master first, then scenarios), with the
 * start date and horizon a caller needs to map a delivery date to a month.
 */
export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ('error' in auth) return auth.error;

  const svc = createServiceClient();
  const { data } = await svc
    .from('plans')
    .select('id, name, type, plan_start_date, horizon_months, is_locked')
    .eq('org_id', auth.caller.orgId)
    .is('deleted_at', null)
    .order('type', { ascending: true })
    .order('forked_at', { ascending: true });

  const plans = (data ?? []).map((p: {
    id: string; name: string; type: string; plan_start_date: string; horizon_months: number; is_locked: boolean;
  }) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    start_date: p.plan_start_date,
    horizon_months: p.horizon_months,
    is_locked: p.is_locked,
  }));

  return jsonOk(plans);
}
