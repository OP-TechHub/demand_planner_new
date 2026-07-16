'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type SettingsFormState = { error: string | null; ok: boolean };

const MARGIN = ['margin_fp', 'margin_wr', 'total_contribution'];
const ALLOC = ['fill_what_you_can', 'all_or_nothing'];
const SCOPE = ['active', 'active_pipeline'];

/**
 * Update the plan's settings. Editable by admin/planner (RLS: plans_update →
 * is_editor). Per the wireframe this "triggers a recompute" — a no-op until the
 * calc engine lands in Phase 2, so for now it just persists.
 */
export async function updateSettings(_prev: SettingsFormState, fd: FormData): Promise<SettingsFormState> {
  const planId = String(fd.get('plan_id') ?? '').trim();
  const margin = String(fd.get('settings_margin_metric') ?? '');
  const alloc = String(fd.get('settings_allocation_mode') ?? '');
  const scope = String(fd.get('settings_scope') ?? '');
  const lookback = Number(fd.get('settings_lookback_months'));
  const startMonth = String(fd.get('plan_start_month') ?? ''); // YYYY-MM

  if (!planId) return { error: 'Missing plan.', ok: false };
  if (!MARGIN.includes(margin) || !ALLOC.includes(alloc) || !SCOPE.includes(scope)) {
    return { error: 'Invalid setting value.', ok: false };
  }
  if (![1, 2, 3].includes(lookback)) return { error: 'Lookback must be 1, 2, or 3 months.', ok: false };
  if (!/^\d{4}-\d{2}$/.test(startMonth)) return { error: 'Invalid start month.', ok: false };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', ok: false };

  const update: Record<string, unknown> = {
    settings_margin_metric: margin,
    settings_allocation_mode: alloc,
    settings_scope: scope,
    settings_lookback_months: lookback,
    plan_start_date: `${startMonth}-01`,
    updated_by: user.id,
  };

  // Only present on the master plan's settings form.
  const yearsRaw = fd.get('settings_plan_years_ahead');
  if (yearsRaw !== null && String(yearsRaw).trim() !== '') {
    const years = Number(yearsRaw);
    if (!Number.isInteger(years) || years < 1 || years > 30) {
      return { error: 'Years ahead must be a whole number between 1 and 30.', ok: false };
    }
    update.settings_plan_years_ahead = years;
  }

  let { error } = await supabase.from('plans').update(update).eq('id', planId);
  // If the years-ahead column hasn't been migrated yet, save everything else.
  if (error && /settings_plan_years_ahead/i.test(error.message)) {
    delete update.settings_plan_years_ahead;
    ({ error } = await supabase.from('plans').update(update).eq('id', planId));
  }
  if (error) return { error: error.message, ok: false };

  revalidatePath('/settings');
  revalidatePath('/home');
  return { error: null, ok: true };
}
