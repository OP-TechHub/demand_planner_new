import { createClient } from '@/lib/supabase/server';
import type { Plan } from '@oceanpick/shared';

/**
 * The plan the app is currently operating on.
 *
 * Session 2 always operates on the org's master plan; the plan selector and
 * scenario switching land in a later session. Returns null if the master plan
 * is missing (i.e. the seed never ran).
 */
export async function getActivePlan(): Promise<Plan | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plans')
    .select('*')
    .eq('type', 'master')
    .is('deleted_at', null)
    .maybeSingle();
  return (data as Plan) ?? null;
}
