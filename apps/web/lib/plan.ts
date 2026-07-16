import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import type { Plan } from '@oceanpick/shared';

export const ACTIVE_PLAN_COOKIE = 'op_active_plan';

/**
 * The plan the app is currently operating on. Defaults to the org's master
 * plan, but if a scenario is selected (cookie) and the caller can read it under
 * RLS, that scenario becomes active — switching every page to its data.
 */
export async function getActivePlan(): Promise<Plan | null> {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const selected = cookieStore.get(ACTIVE_PLAN_COOKIE)?.value;

  if (selected) {
    const { data } = await supabase.from('plans').select('*').eq('id', selected).is('deleted_at', null).maybeSingle();
    if (data) return data as Plan; // RLS guarantees the caller may read it
  }
  const { data } = await supabase.from('plans').select('*').eq('type', 'master').is('deleted_at', null).maybeSingle();
  return (data as Plan) ?? null;
}

/** The org master plus the caller's own scenarios, for the plan selector. */
export async function getSelectablePlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plans')
    .select('*')
    .is('deleted_at', null)
    .order('type', { ascending: true }) // master before scenario
    .order('forked_at', { ascending: true });
  return (data ?? []) as Plan[];
}
