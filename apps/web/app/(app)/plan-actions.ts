'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { ACTIVE_PLAN_COOKIE } from '@/lib/plan';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROGRAM_COLS = [
  'status', 'item_code', 'item_description', 'customer', 'max_monthly_demand_fp',
  'primary_bucket_id', 'secondary_bucket_id', 'tertiary_bucket_id',
  'primary_yield', 'secondary_yield', 'tertiary_yield',
  'price_per_fp', 'barra_cost_wr', 'packing_cost_fp', 'processing_cost_fp',
  'storage_cost_fp', 'freight_cost_fp', 'other_costs_fp', 'locked', 'sort_order',
] as const;

function setActiveCookie(store: Awaited<ReturnType<typeof cookies>>, planId: string) {
  store.set(ACTIVE_PLAN_COOKIE, planId, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
}

/** Switch the active plan (master or a scenario). Verified by RLS visibility. */
export async function setActivePlan(planId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.from('plans').select('id').eq('id', planId).is('deleted_at', null).maybeSingle();
  if (!data) return; // not accessible — ignore
  setActiveCookie(await cookies(), planId);
  revalidatePath('/', 'layout');
}

export type ScenarioResult = { error: string | null; scenarioId?: string };

/** Fork the master plan into a new scenario (Option A full clone) and switch to it. */
export async function createScenario(name: string, description: string): Promise<ScenarioResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };
  if (!name?.trim()) return { error: 'Name is required.' };

  const { data: master } = await supabase.from('plans').select('*').eq('type', 'master').is('deleted_at', null).maybeSingle();
  if (!master) return { error: 'No master plan to fork.' };

  const { data: scenario, error: se } = await supabase.from('plans').insert({
    org_id: master.org_id, type: 'scenario', parent_plan_id: master.id,
    name: name.trim(), description: (description ?? '').trim(), owner_user_id: user.id, is_locked: false,
    plan_start_date: master.plan_start_date, horizon_months: master.horizon_months,
    settings_margin_metric: master.settings_margin_metric, settings_allocation_mode: master.settings_allocation_mode,
    settings_scope: master.settings_scope, settings_lookback_months: master.settings_lookback_months,
    forked_at: new Date().toISOString(), created_by: user.id, updated_by: user.id,
  }).select('id').maybeSingle();
  if (se || !scenario) {
    const m = (se?.message ?? '').toLowerCase();
    if (m.includes('scenario') || m.includes('limit')) return { error: 'You have reached the 20-scenario limit.' };
    return { error: se?.message ?? 'Could not create the scenario.' };
  }
  const sid = scenario.id as string;

  const fail = async (msg: string): Promise<ScenarioResult> => {
    await supabase.from('plans').delete().eq('id', sid); // cascade-cleans partial clone
    return { error: msg };
  };

  // Clone programs, then map old→new by item_code (unique per plan).
  const { data: masterProgs } = await supabase.from('programs').select('*').eq('plan_id', master.id).is('deleted_at', null);
  const progRows = (masterProgs ?? []).map((p: any) => {
    const row: any = { plan_id: sid, created_by: user.id, updated_by: user.id };
    for (const c of PROGRAM_COLS) row[c] = p[c];
    return row;
  });
  if (progRows.length) {
    const { error } = await supabase.from('programs').insert(progRows);
    if (error) return fail(`cloning programs: ${error.message}`);
  }
  const { data: newProgs } = await supabase.from('programs').select('id, item_code').eq('plan_id', sid);
  const newIdByCode = new Map((newProgs ?? []).map((p: any) => [p.item_code, p.id]));
  const codeByOldId = new Map((masterProgs ?? []).map((p: any) => [p.id, p.item_code]));

  // Clone demand overrides (remap program_id).
  const demand = await fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', master.id);
  const demandRows = demand
    .map((d: any) => ({ plan_id: sid, program_id: newIdByCode.get(codeByOldId.get(d.program_id)), month_index: d.month_index, demand_fp: d.demand_fp, created_by: user.id, updated_by: user.id }))
    .filter((d) => d.program_id);
  for (let i = 0; i < demandRows.length; i += 800) {
    const { error } = await supabase.from('demand_plan').insert(demandRows.slice(i, i + 800));
    if (error) return fail(`cloning demand: ${error.message}`);
  }

  // Clone harvest (buckets are org-scoped — same bucket_id).
  const harvest = await fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, month_index, capacity_kg_wr', master.id);
  const harvestRows = harvest.map((h: any) => ({ plan_id: sid, bucket_id: h.bucket_id, month_index: h.month_index, capacity_kg_wr: h.capacity_kg_wr, created_by: user.id, updated_by: user.id }));
  for (let i = 0; i < harvestRows.length; i += 800) {
    const { error } = await supabase.from('harvest_plan').insert(harvestRows.slice(i, i + 800));
    if (error) return fail(`cloning harvest: ${error.message}`);
  }

  setActiveCookie(await cookies(), sid);
  revalidatePath('/', 'layout');
  return { error: null, scenarioId: sid };
}

export async function renameScenario(id: string, name: string): Promise<void> {
  if (!name?.trim()) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('plans').update({ name: name.trim(), updated_by: user?.id }).eq('id', id).eq('type', 'scenario');
  revalidatePath('/', 'layout');
}

export async function deleteScenario(id: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('plans').update({ deleted_at: new Date().toISOString(), updated_by: user?.id }).eq('id', id).eq('type', 'scenario');
  const store = await cookies();
  if (store.get(ACTIVE_PLAN_COOKIE)?.value === id) store.delete(ACTIVE_PLAN_COOKIE);
  revalidatePath('/', 'layout');
}
