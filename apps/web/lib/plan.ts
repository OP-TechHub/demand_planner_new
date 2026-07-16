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
  const { data } = await supabase.from('plans').select('*').eq('type', 'master').is('deleted_at', null).maybeSingle();
  return (data as Plan) ?? null;
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
