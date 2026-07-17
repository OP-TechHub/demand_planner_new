'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { logAudit } from '@/lib/audit';
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

/**
 * Create a fresh plan for a financial year: a new user-owned plan seeded with a
 * chosen subset of the master's programs, starting on the given month. Optionally
 * copies the demand overrides (for the chosen programs) and harvest from master;
 * otherwise the new plan starts from program baselines with empty harvest.
 */
export async function createPlan(input: {
  name: string;
  planStartDate: string; // 'YYYY-MM-DD' (start month, day always 01)
  horizonMonths: number; // plan length in months (1–60)
  programIds: string[];
  copyData: boolean;
}): Promise<ScenarioResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };
  if (!input.name?.trim()) return { error: 'Name is required.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.planStartDate ?? '')) return { error: 'Pick a start month.' };
  const horizon = Math.trunc(input.horizonMonths);
  if (!Number.isFinite(horizon) || horizon < 1 || horizon > 60) {
    return { error: 'Plan length must be between 1 and 60 months. Check the end month.' };
  }
  if (!input.programIds?.length) return { error: 'Select at least one program to include.' };

  const { data: master } = await supabase.from('plans').select('*').eq('type', 'master').is('deleted_at', null).maybeSingle();
  if (!master) return { error: 'No master plan to base this on.' };

  const { data: plan, error: se } = await supabase.from('plans').insert({
    org_id: master.org_id, type: 'scenario', parent_plan_id: master.id,
    name: input.name.trim(), description: '', owner_user_id: user.id, is_locked: false,
    plan_start_date: input.planStartDate, horizon_months: horizon,
    settings_margin_metric: master.settings_margin_metric, settings_allocation_mode: master.settings_allocation_mode,
    settings_scope: master.settings_scope, settings_lookback_months: master.settings_lookback_months,
    forked_at: new Date().toISOString(), created_by: user.id, updated_by: user.id,
  }).select('id').maybeSingle();
  if (se || !plan) {
    const m = (se?.message ?? '').toLowerCase();
    if (m.includes('scenario') || m.includes('limit')) return { error: 'You have reached the 20-plan limit.' };
    return { error: se?.message ?? 'Could not create the plan.' };
  }
  const pid = plan.id as string;
  const fail = async (msg: string): Promise<ScenarioResult> => {
    await supabase.from('plans').delete().eq('id', pid);
    return { error: msg };
  };

  const idSet = new Set(input.programIds);
  const { data: masterProgs } = await supabase.from('programs').select('*').eq('plan_id', master.id).is('deleted_at', null);
  const selected = (masterProgs ?? []).filter((p: any) => idSet.has(p.id));
  if (!selected.length) return fail('None of the selected programs were found.');

  const progRows = selected.map((p: any) => {
    const row: any = { plan_id: pid, created_by: user.id, updated_by: user.id };
    for (const c of PROGRAM_COLS) row[c] = p[c];
    return row;
  });
  const { error: pe } = await supabase.from('programs').insert(progRows);
  if (pe) return fail(`adding programs: ${pe.message}`);

  if (input.copyData) {
    const { data: newProgs } = await supabase.from('programs').select('id, item_code').eq('plan_id', pid);
    const newIdByCode = new Map((newProgs ?? []).map((p: any) => [p.item_code, p.id]));
    const codeByOldId = new Map(selected.map((p: any) => [p.id, p.item_code]));

    const demand = await fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', master.id);
    const demandRows = demand
      .filter((d: any) => idSet.has(d.program_id) && d.month_index <= horizon)
      .map((d: any) => ({ plan_id: pid, program_id: newIdByCode.get(codeByOldId.get(d.program_id)), month_index: d.month_index, demand_fp: d.demand_fp, created_by: user.id, updated_by: user.id }))
      .filter((d) => d.program_id);
    for (let i = 0; i < demandRows.length; i += 800) {
      const { error } = await supabase.from('demand_plan').insert(demandRows.slice(i, i + 800));
      if (error) return fail(`copying demand: ${error.message}`);
    }

    const harvest = await fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, month_index, capacity_kg_wr', master.id);
    const harvestRows = harvest
      .filter((h: any) => h.month_index <= horizon)
      .map((h: any) => ({ plan_id: pid, bucket_id: h.bucket_id, month_index: h.month_index, capacity_kg_wr: h.capacity_kg_wr, created_by: user.id, updated_by: user.id }));
    for (let i = 0; i < harvestRows.length; i += 800) {
      const { error } = await supabase.from('harvest_plan').insert(harvestRows.slice(i, i + 800));
      if (error) return fail(`copying harvest: ${error.message}`);
    }
  }

  setActiveCookie(await cookies(), pid);
  revalidatePath('/', 'layout');
  return { error: null, scenarioId: pid };
}

/** Inclusive month distance between two 'YYYY-MM' values (b - a). */
function monthsBetweenYM(a: string, b: string): number {
  const m1 = /^(\d{4})-(\d{2})$/.exec(a);
  const m2 = /^(\d{4})-(\d{2})$/.exec(b);
  if (!m1 || !m2) return NaN;
  return (Number(m2[1]) - Number(m1[1])) * 12 + (Number(m2[2]) - Number(m1[2]));
}

/** Copy a plan (programs + demand + harvest) into a locked, read-only snapshot. */
async function snapshotPlan(svc: any, plan: any, userId: string, name: string, description: string): Promise<string> {
  const { data: archive, error: ae } = await svc.from('plans').insert({
    org_id: plan.org_id,
    type: 'scenario',
    // A scenario must hang off the master: if we're archiving the master itself
    // it becomes the parent; otherwise reuse the source's parent.
    parent_plan_id: plan.type === 'master' ? plan.id : plan.parent_plan_id,
    name, description,
    owner_user_id: userId,
    is_locked: true, // read-only — can_write_section() requires `not is_locked`
    plan_start_date: plan.plan_start_date,
    horizon_months: plan.horizon_months,
    settings_margin_metric: plan.settings_margin_metric,
    settings_allocation_mode: plan.settings_allocation_mode,
    settings_scope: plan.settings_scope,
    settings_lookback_months: plan.settings_lookback_months,
    forked_at: new Date().toISOString(),
    created_by: userId, updated_by: userId,
  }).select('id').maybeSingle();
  if (ae || !archive) throw new Error(ae?.message ?? 'Could not create the snapshot.');
  const aid = archive.id as string;

  const { data: srcProgs } = await svc.from('programs').select('*').eq('plan_id', plan.id).is('deleted_at', null);
  const progRows = (srcProgs ?? []).map((p: any) => {
    const row: any = { plan_id: aid, created_by: userId, updated_by: userId };
    for (const c of PROGRAM_COLS) row[c] = p[c];
    return row;
  });
  if (progRows.length) {
    const { error } = await svc.from('programs').insert(progRows);
    if (error) throw new Error(`snapshot programs: ${error.message}`);
  }

  const { data: newProgs } = await svc.from('programs').select('id, item_code').eq('plan_id', aid);
  const newIdByCode = new Map((newProgs ?? []).map((p: any) => [p.item_code, p.id]));
  const codeByOldId = new Map((srcProgs ?? []).map((p: any) => [p.id, p.item_code]));

  const demand = await fetchAllByPlan(svc, 'demand_plan', 'program_id, month_index, demand_fp', plan.id);
  const demandRows = demand
    .map((d: any) => ({ plan_id: aid, program_id: newIdByCode.get(codeByOldId.get(d.program_id)), month_index: d.month_index, demand_fp: d.demand_fp, created_by: userId, updated_by: userId }))
    .filter((d) => d.program_id);
  for (let i = 0; i < demandRows.length; i += 800) {
    const { error } = await svc.from('demand_plan').insert(demandRows.slice(i, i + 800));
    if (error) throw new Error(`snapshot demand: ${error.message}`);
  }

  const harvest = await fetchAllByPlan(svc, 'harvest_plan', 'bucket_id, month_index, capacity_kg_wr', plan.id);
  const harvestRows = harvest.map((h: any) => ({ plan_id: aid, bucket_id: h.bucket_id, month_index: h.month_index, capacity_kg_wr: h.capacity_kg_wr, created_by: userId, updated_by: userId }));
  for (let i = 0; i < harvestRows.length; i += 800) {
    const { error } = await svc.from('harvest_plan').insert(harvestRows.slice(i, i + 800));
    if (error) throw new Error(`snapshot harvest: ${error.message}`);
  }

  return aid;
}

/**
 * Roll a plan's window forward to a later start month, keeping the same plan.
 *
 * Month data is stored relative to the plan start, so the surviving months must
 * shift down as the start advances — otherwise every cell silently re-labels
 * itself. A read-only snapshot of the plan is taken first, so the rolled-off
 * period is never lost. The freed tail is left empty, and computed results are
 * cleared (a recompute is required).
 */
export async function rollPlanForward(
  planId: string,
  newStartMonth: string // 'YYYY-MM'
): Promise<{ error: string | null; months?: number; archiveId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const { data: plan } = await supabase.from('plans').select('*').eq('id', planId).is('deleted_at', null).maybeSingle();
  if (!plan) return { error: 'Plan not found.' };

  const { data: me } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
  const isAdmin = me?.role === 'admin';
  const isOwner = plan.owner_user_id === user.id;
  if (!isAdmin && !isOwner) return { error: 'Only an admin (or the plan’s owner) can roll a plan forward.' };
  if (plan.is_locked) return { error: 'This plan is locked (read-only) and can’t be rolled forward.' };

  if (!/^\d{4}-\d{2}$/.test(newStartMonth ?? '')) return { error: 'Pick a new start month.' };
  const months = monthsBetweenYM(plan.plan_start_date.slice(0, 7), newStartMonth);
  if (!Number.isFinite(months) || months < 1) return { error: 'The new start must be later than the current start.' };
  if (months >= plan.horizon_months) {
    return { error: `You can roll forward at most ${plan.horizon_months - 1} months — beyond that nothing of the plan would remain.` };
  }

  const svc = createServiceClient();

  let archiveId: string;
  try {
    archiveId = await snapshotPlan(
      svc, plan, user.id,
      `${plan.name} — archive (${plan.plan_start_date.slice(0, 7)} start)`,
      `Read-only snapshot taken before rolling “${plan.name}” forward ${months} month${months === 1 ? '' : 's'}.`
    );
  } catch (e) {
    return { error: `Snapshot failed, so the plan was not rolled: ${e instanceof Error ? e.message : 'unknown error'}` };
  }

  const { error } = await svc.rpc('roll_plan_forward', { p_plan_id: planId, p_months: months });
  if (error) {
    // The snapshot exists but the roll didn't happen — leave the plan untouched.
    await svc.from('plans').delete().eq('id', archiveId);
    return { error: error.message };
  }

  await logAudit(supabase, {
    planId, entityType: 'plans', entityId: planId, action: 'update',
    changes: { plan_start_date: { old: plan.plan_start_date.slice(0, 7), new: newStartMonth }, rolled_forward_months: months },
  });

  revalidatePath('/', 'layout');
  return { error: null, months, archiveId };
}

/**
 * Restore a plan's start date, demand and harvest from a snapshot — the inverse
 * of rollPlanForward, and the way to undo a roll.
 *
 * The plan's CURRENT state is snapshotted first, so the restore is itself
 * reversible: you can flip back and forth between windows. Programs aren't
 * replaced (a roll never touches them); demand is remapped onto the target's
 * own programs by item_code inside the SQL function.
 */
export async function restorePlanFromSnapshot(
  targetPlanId: string,
  snapshotPlanId: string
): Promise<{ error: string | null; archiveId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const { data: target } = await supabase.from('plans').select('*').eq('id', targetPlanId).is('deleted_at', null).maybeSingle();
  if (!target) return { error: 'Plan not found.' };
  const { data: snapshot } = await supabase.from('plans').select('*').eq('id', snapshotPlanId).is('deleted_at', null).maybeSingle();
  if (!snapshot) return { error: 'Snapshot not found, or you can’t access it.' };

  const { data: me } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
  const isAdmin = me?.role === 'admin';
  const isOwner = target.owner_user_id === user.id;
  if (!isAdmin && !isOwner) return { error: 'Only an admin (or the plan’s owner) can restore a plan.' };
  if (target.is_locked) return { error: 'This plan is locked (read-only) and can’t be restored into.' };
  if (target.id === snapshot.id) return { error: 'Pick a different snapshot.' };
  if (target.horizon_months !== snapshot.horizon_months) {
    return { error: `That snapshot is ${snapshot.horizon_months} months long but this plan is ${target.horizon_months} — the month slots wouldn’t line up.` };
  }

  const svc = createServiceClient();

  // Snapshot where we are now, so this restore can itself be undone.
  let archiveId: string;
  try {
    archiveId = await snapshotPlan(
      svc, target, user.id,
      `${target.name} — archive (${target.plan_start_date.slice(0, 7)} start)`,
      `Read-only snapshot taken before restoring “${target.name}” from “${snapshot.name}”.`
    );
  } catch (e) {
    return { error: `Snapshot failed, so nothing was restored: ${e instanceof Error ? e.message : 'unknown error'}` };
  }

  const { error } = await svc.rpc('restore_plan_from_snapshot', { p_target: targetPlanId, p_source: snapshotPlanId });
  if (error) {
    await svc.from('plans').delete().eq('id', archiveId);
    return { error: error.message };
  }

  await logAudit(supabase, {
    planId: targetPlanId, entityType: 'plans', entityId: targetPlanId, action: 'update',
    changes: {
      plan_start_date: { old: target.plan_start_date.slice(0, 7), new: snapshot.plan_start_date.slice(0, 7) },
      restored_from: snapshot.name,
    },
  });

  revalidatePath('/', 'layout');
  return { error: null, archiveId };
}

export async function renameScenario(id: string, name: string): Promise<{ error: string | null }> {
  if (!name?.trim()) return { error: 'Name is required.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };
  const { error } = await supabase
    .from('plans')
    .update({ name: name.trim(), updated_by: user.id })
    .eq('id', id)
    .eq('type', 'scenario');
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return { error: null };
}

export async function deleteScenario(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  // Authorize in app code (mirrors the plans_delete policy: owner or org admin).
  const { data: me } = await supabase.from('users').select('role, org_id').eq('id', user.id).maybeSingle();
  const { data: target } = await supabase
    .from('plans')
    .select('id, owner_user_id, org_id')
    .eq('id', id)
    .eq('type', 'scenario')
    .is('deleted_at', null)
    .maybeSingle();
  if (!target) return { error: 'Scenario not found, or already deleted.' };

  const isOwner = target.owner_user_id === user.id;
  const isOrgAdmin = me?.role === 'admin' && me?.org_id === target.org_id;
  if (!isOwner && !isOrgAdmin) return { error: 'You don’t have permission to delete this scenario.' };

  // Soft-delete with the service-role client. The live plans UPDATE policy's
  // WITH CHECK rejects setting deleted_at under the user's own RLS, so we
  // authorize above and write privileged — same pattern as recompute.
  const svc = createServiceClient();
  const { error } = await svc
    .from('plans')
    .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', id)
    .eq('type', 'scenario');
  if (error) return { error: error.message };

  const store = await cookies();
  if (store.get(ACTIVE_PLAN_COOKIE)?.value === id) store.delete(ACTIVE_PLAN_COOKIE);
  revalidatePath('/', 'layout');
  return { error: null };
}
