import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import type { Plan } from '@oceanpick/shared';

export const ACTIVE_PLAN_COOKIE = 'op_active_plan';

/**
 * Request-cached auth user. `getUser()` is a network call to Supabase Auth, and
 * it was being made in the middleware, the layout, and several pages on every
 * navigation — cache() collapses all the render-tree calls into one.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

/**
 * Request-cached profile row (role, grants, status). Shared by the layout and
 * every page that used to run its own `users` query.
 */
export const getProfile = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, role, is_active, last_login_at, edit_sections')
    .eq('id', user.id)
    .maybeSingle();
  return data as {
    id: string;
    full_name: string;
    email: string;
    role: string;
    is_active: boolean;
    last_login_at: string | null;
    edit_sections: string[] | null;
  } | null;
});

/**
 * The current user's per-plan edit grants for one plan: the set of input tabs
 * (programs / demand_plan / harvest_plan) they may edit on it. Admins aren't
 * special here — canEditPlanSection short-circuits them — so this only reflects
 * granted rows. Request-cached: the page and any child can share one query.
 */
export const getMyPlanGrants = cache(async (planId: string): Promise<Set<string>> => {
  const user = await getCurrentUser();
  if (!user || !planId) return new Set();
  const supabase = await createClient();
  const { data } = await supabase
    .from('plan_editor_grants')
    .select('section')
    .eq('plan_id', planId)
    .eq('user_id', user.id);
  return new Set((data ?? []).map((r: { section: string }) => r.section));
});

/**
 * Display name for another user in the org — for attributing a scenario to its
 * owner. Falls back to the email, then to null if the row is unreadable.
 */
export const getUserName = cache(async (id: string | null): Promise<string | undefined> => {
  if (!id) return undefined;
  const supabase = await createClient();
  const { data } = await supabase.from('users').select('full_name, email').eq('id', id).maybeSingle();
  if (!data) return undefined;
  const row = data as { full_name: string | null; email: string | null };
  return row.full_name || row.email || undefined;
});

/**
 * The plan the app is currently operating on. Defaults to the org's master
 * plan, but if a scenario is selected (cookie) and the caller can read it under
 * RLS, that scenario becomes active — switching every page to its data.
 *
 * cache()d: the layout, the page, and the stale-results notice all call this on
 * one render — without caching that's 2–3 duplicate `plans` queries per load.
 */
export const getActivePlan = cache(async (): Promise<Plan | null> => {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const selected = cookieStore.get(ACTIVE_PLAN_COOKIE)?.value;

  if (selected) {
    const { data } = await supabase.from('plans').select('*').eq('id', selected).is('deleted_at', null).maybeSingle();
    if (data) return data as Plan; // RLS guarantees the caller may read it
  }
  return getDefaultPlan();
});

/**
 * The org's default working plan: the one flagged `is_live`, falling back to the
 * master. This is what the app centres on when no specific plan is selected —
 * the Dashboard, the API's default, and getActivePlan's fallback all use it, so
 * an admin can point everything at a "Live plan" while the master stays frozen.
 */
export const getDefaultPlan = cache(async (): Promise<Plan | null> => {
  const supabase = await createClient();
  const { data: live } = await supabase.from('plans').select('*').eq('is_live', true).is('deleted_at', null).maybeSingle();
  if (live) return live as Plan;
  const { data: master } = await supabase.from('plans').select('*').eq('type', 'master').is('deleted_at', null).maybeSingle();
  return (master as Plan) ?? null;
});

/** The org master plus the caller's own scenarios, for the plan selector. */
export const getSelectablePlans = cache(async (): Promise<Plan[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plans')
    .select('*')
    .is('deleted_at', null)
    .order('type', { ascending: true }) // master before scenario
    .order('forked_at', { ascending: true });
  return (data ?? []) as Plan[];
});
