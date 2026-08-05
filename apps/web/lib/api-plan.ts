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
  const cols = 'id, name, type, plan_start_date, horizon_months, is_locked';
  const base = () => svc.from('plans').select(cols).eq('org_id', orgId).is('deleted_at', null);

  if (planId) {
    const { data } = await base().eq('id', planId).maybeSingle();
    return (data as ApiPlan) ?? null;
  }
  // Default to the org's live plan, falling back to the master.
  const { data: live } = await base().eq('is_live', true).maybeSingle();
  if (live) return live as ApiPlan;
  const { data: master } = await base().eq('type', 'master').maybeSingle();
  return (master as ApiPlan) ?? null;
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
