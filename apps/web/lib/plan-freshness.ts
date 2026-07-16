import { createClient } from '@/lib/supabase/server';

export type Freshness = { computed: boolean; stale: boolean };

/**
 * Are the computed outputs out of date? True if the plan was never computed, or
 * if any input row (programs / demand / harvest) was edited after the last
 * recompute. Uses each table's updated_at (maintained by touch triggers).
 */
export async function getPlanFreshness(planId: string, lastComputedAt: string | null): Promise<Freshness> {
  if (!lastComputedAt) return { computed: false, stale: true };

  const supabase = await createClient();
  const computedMs = new Date(lastComputedAt).getTime();

  for (const table of ['programs', 'harvest_plan', 'demand_plan'] as const) {
    const { data } = await supabase
      .from(table)
      .select('updated_at')
      .eq('plan_id', planId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.updated_at && new Date(data.updated_at as string).getTime() > computedMs) {
      return { computed: true, stale: true };
    }
  }
  return { computed: true, stale: false };
}
