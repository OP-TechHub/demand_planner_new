import type { createServiceClient } from '@/lib/supabase/service';
import { monthLabel } from '@oceanpick/shared';

/** The service client, with its `demand_planner` schema typing preserved. */
type Svc = ReturnType<typeof createServiceClient>;

export type ApiPlan = {
  id: string;
  name: string;
  type: string;
  plan_start_date: string;
  horizon_months: number;
  is_locked: boolean;
};

/**
 * Resolve the plan an API request targets, always within the caller's org.
 * With no id, defaults to the org's master plan (the live one) — which is what
 * the PO matcher wants nearly always. A deleted plan resolves to null.
 */
export async function loadOrgPlan(
  svc: Svc,
  orgId: string,
  planId?: string | null
): Promise<ApiPlan | null> {
  let q = svc
    .from('plans')
    .select('id, name, type, plan_start_date, horizon_months, is_locked')
    .eq('org_id', orgId)
    .is('deleted_at', null);
  q = planId ? q.eq('id', planId) : q.eq('type', 'master');
  const { data } = await q.maybeSingle();
  return (data as ApiPlan) ?? null;
}

/** The plan-context block echoed in every response's `meta`. */
export function planMeta(plan: ApiPlan) {
  return {
    plan_id: plan.id,
    plan_name: plan.name,
    plan_type: plan.type,
    start_date: plan.plan_start_date,
    horizon_months: plan.horizon_months,
  };
}

/** A month index paired with its calendar label, e.g. { month_index: 10, month: "Jan 27" }. */
export function monthCol(plan: ApiPlan, monthIndex: number) {
  return { month_index: monthIndex, month: monthLabel(plan.plan_start_date, monthIndex) };
}
