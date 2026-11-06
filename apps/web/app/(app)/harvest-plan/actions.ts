'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { createServiceClient } from '@/lib/supabase/service';
import { notifyPlanChanges, type NotifyTrigger } from '@/lib/notify-changes';
import { runInBackground } from '@/lib/background';
import type { WideRow, WideImportResult } from '@/components/wide-grid-import';
import { monthIndexOfDate, type HarvestRequestMode } from '@oceanpick/shared';

export type SaveResult = { error: string | null };

/**
 * Email the users an admin subscribed to this tab (Admin → Users). The request
 * plan and actual harvest are not engine inputs, so no recalculation will ever
 * report them — the save does, after the response goes out. Never blocks or
 * fails the save.
 */
async function notifyAfterSave(planId: string, section: 'harvest_request' | 'harvest_actual'): Promise<void> {
  const trigger: NotifyTrigger = 'save';
  await runInBackground(
    (async () => notifyPlanChanges(createServiceClient(), { planId, trigger, sections: [section] }))(),
    `${section} change notification`
  );
}

/** Map a raw RLS rejection to a clear message about section access. */
function permError(message: string): string {
  return /row-level security|violates row-level/i.test(message)
    ? 'Can’t edit the harvest plan here — this plan may be a read-only snapshot, or you may not have edit access to this section.'
    : message;
}

/**
 * Persist per-month harvest capacity for one bucket.
 *
 * Harvest cells have no baseline — every cell is a direct input that defaults
 * to 0 when no row exists (data-model.md §4). So a cleared/zero cell is stored
 * as a delete (sparse), and a positive value is upserted.
 */
export async function saveHarvestCapacity(
  planId: string,
  bucketId: string,
  upserts: { month_index: number; capacity_kg_wr: number }[],
  deletes: number[]
): Promise<SaveResult> {
  if (!planId || !bucketId) return { error: 'Missing plan or bucket.' };

  for (const c of upserts) {
    if (!Number.isInteger(c.month_index) || c.month_index < 1 || c.month_index > 60) {
      return { error: `Invalid month ${c.month_index}.` };
    }
    if (!Number.isFinite(c.capacity_kg_wr) || c.capacity_kg_wr < 0) {
      return { error: `Capacity for month ${c.month_index} must be zero or greater.` };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  // Snapshot current capacity BEFORE writing, so the audit can show old → new.
  // A cleared cell reverts to 0 (no capacity).
  const { data: existingRows } = await supabase
    .from('harvest_plan')
    .select('month_index, capacity_kg_wr')
    .eq('plan_id', planId)
    .eq('bucket_id', bucketId);
  const existing = new Map<number, number>(
    (existingRows ?? []).map((r: { month_index: number; capacity_kg_wr: number }) => [r.month_index, Number(r.capacity_kg_wr)])
  );

  if (upserts.length) {
    const rows = upserts.map((c) => ({
      plan_id: planId,
      bucket_id: bucketId,
      month_index: c.month_index,
      capacity_kg_wr: c.capacity_kg_wr,
      created_by: user.id,
      updated_by: user.id,
    }));
    const { error } = await supabase
      .from('harvest_plan')
      .upsert(rows, { onConflict: 'plan_id,bucket_id,month_index' });
    if (error) return { error: permError(error.message) };
  }

  if (deletes.length) {
    const { error } = await supabase
      .from('harvest_plan')
      .delete()
      .eq('plan_id', planId)
      .eq('bucket_id', bucketId)
      .in('month_index', deletes);
    if (error) return { error: permError(error.message) };
  }

  const edits: { m: number; old: number; new: number }[] = [];
  for (const c of upserts) {
    const old = existing.get(c.month_index) ?? 0;
    if (old !== c.capacity_kg_wr) edits.push({ m: c.month_index, old, new: c.capacity_kg_wr });
  }
  for (const m of deletes) {
    const old = existing.get(m) ?? 0;
    if (old !== 0) edits.push({ m, old, new: 0 });
  }
  edits.sort((a, b) => a.m - b.m);
  const CAP = 40;
  await logAudit(supabase, {
    planId, entityType: 'harvest_plan', entityId: bucketId, action: 'update',
    changes: { set: upserts.length, cleared: deletes.length, edits: edits.slice(0, CAP), more: Math.max(0, edits.length - CAP) },
  });
  revalidatePath('/harvest-plan');
  return { error: null };
}

/**
 * Save capacity cells edited on the grid itself — pasted from Excel or cleared
 * with Delete — across any number of buckets in one go. Kept sparse like the
 * single-bucket editor: a positive value is upserted in whole kg WR, and null
 * or zero deletes the row, which reads as no capacity.
 */
export async function saveHarvestCells(
  planId: string,
  cells: { bucket_id: string; month_index: number; capacity_kg_wr: number | null }[]
): Promise<SaveResult & { count: number }> {
  if (!planId) return { error: 'Missing plan.', count: 0 };
  for (const c of cells) {
    if (!c.bucket_id) return { error: 'Missing bucket.', count: 0 };
    if (!Number.isInteger(c.month_index) || c.month_index < 1 || c.month_index > 60) {
      return { error: `Invalid month ${c.month_index}.`, count: 0 };
    }
    if (c.capacity_kg_wr !== null && (!Number.isFinite(c.capacity_kg_wr) || c.capacity_kg_wr < 0)) {
      return { error: `Capacity for month ${c.month_index} must be zero or greater.`, count: 0 };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', count: 0 };

  const rounded = cells.map((c) => ({ ...c, capacity_kg_wr: Math.round(c.capacity_kg_wr ?? 0) }));
  const upserts = rounded.filter((c) => c.capacity_kg_wr > 0).map((c) => ({
    plan_id: planId, bucket_id: c.bucket_id, month_index: c.month_index,
    capacity_kg_wr: c.capacity_kg_wr, created_by: user.id, updated_by: user.id,
  }));
  if (upserts.length) {
    const { error } = await supabase.from('harvest_plan').upsert(upserts, { onConflict: 'plan_id,bucket_id,month_index' });
    if (error) return { error: permError(error.message), count: 0 };
  }

  // One delete per bucket, for the same reason as the request plan below.
  const clears = new Map<string, number[]>();
  for (const c of rounded) if (c.capacity_kg_wr === 0) clears.set(c.bucket_id, [...(clears.get(c.bucket_id) ?? []), c.month_index]);
  for (const [bucketId, monthList] of clears) {
    const { error } = await supabase.from('harvest_plan').delete()
      .eq('plan_id', planId).eq('bucket_id', bucketId).in('month_index', monthList);
    if (error) return { error: permError(error.message), count: 0 };
  }

  const cleared = [...clears.values()].reduce((n, l) => n + l.length, 0);
  await logAudit(supabase, {
    planId, entityType: 'harvest_plan', entityId: planId, action: 'update',
    changes: { grid_set: upserts.length, grid_cleared: cleared },
  });
  revalidatePath('/harvest-plan');
  return { error: null, count: upserts.length + cleared };
}

/**
 * Save the processing plant's requested whole round per month.
 *
 * Sparse like the harvest plan itself: a zero or cleared month is stored as a
 * delete, so a missing row means "nothing requested". RLS enforces the separate
 * 'harvest_request' grant — this deliberately does NOT accept the harvest_plan
 * permission. Not an engine input, so it never marks the plan stale.
 */
/**
 * Replace the plant's request for this plan, cell by cell.
 *
 * Every month in the horizon is sent for every bucket, so a cleared cell is
 * deleted rather than left behind at its old value — the same contract the
 * single-row version had, now two-dimensional.
 *
 * A null `bucket_id` is a request with no size stated, which is what the rows
 * entered before the breakdown existed are. They can be cleared but not typed
 * afresh, so the only null entries this accepts are ones that zero an existing
 * row: the plant states a size from now on.
 */
export async function saveHarvestRequest(
  planId: string,
  entries: { bucket_id: string | null; month_index: number; quantity_kg_wr: number }[]
): Promise<SaveResult> {
  if (!planId) return { error: 'Missing plan.' };

  for (const e of entries) {
    if (!Number.isInteger(e.month_index) || e.month_index < 1 || e.month_index > 60) {
      return { error: `Invalid month ${e.month_index}.` };
    }
    if (!Number.isFinite(e.quantity_kg_wr) || e.quantity_kg_wr < 0) {
      return { error: `Quantity for month ${e.month_index} must be zero or greater.` };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  // A month with daily figures reads as their sum, so its monthly figure is not
  // the plant's to edit any more — those entries are left out, never written.
  const { data: dailyRows } = await supabase
    .from('harvest_request_daily').select('harvest_date').eq('plan_id', planId).gt('quantity_kg_wr', 0);
  const { data: planRow } = await supabase
    .from('plans').select('plan_start_date, horizon_months').eq('id', planId).maybeSingle();
  const dailyMonths = new Set<number>();
  if (planRow) {
    for (const d of (dailyRows ?? []) as { harvest_date: string }[]) {
      const mo = monthIndexOfDate(planRow.plan_start_date, d.harvest_date, planRow.horizon_months);
      if (mo !== null) dailyMonths.add(mo);
    }
  }

  // Whole kg WR, matching how harvest capacity is kept.
  const rounded = entries
    .filter((e) => !dailyMonths.has(e.month_index))
    .map((e) => ({ ...e, quantity_kg_wr: Math.round(e.quantity_kg_wr) }));
  // A sizeless row is legacy data: it may be cleared, never created.
  const upserts = rounded.filter((e) => e.quantity_kg_wr > 0 && e.bucket_id);
  const clears = rounded.filter((e) => e.quantity_kg_wr === 0);

  const { data: existingRows } = await supabase
    .from('harvest_request')
    .select('bucket_id, month_index, quantity_kg_wr')
    .eq('plan_id', planId);
  const key = (bucketId: string | null, month: number) => `${bucketId ?? ''}:${month}`;
  const existing = new Map<string, number>(
    (existingRows ?? []).map((r: { bucket_id: string | null; month_index: number; quantity_kg_wr: number }) => [
      key(r.bucket_id, r.month_index),
      Number(r.quantity_kg_wr),
    ])
  );

  if (upserts.length) {
    const { error } = await supabase.from('harvest_request').upsert(
      upserts.map((e) => ({
        plan_id: planId, bucket_id: e.bucket_id, month_index: e.month_index,
        quantity_kg_wr: e.quantity_kg_wr, created_by: user.id, updated_by: user.id,
      })),
      { onConflict: 'plan_id,month_index,bucket_id' }
    );
    if (error) return { error: requestPermError(error.message) };
  }

  // Deleted one bucket at a time. A single `in` over months would take out every
  // bucket in those months, including ones this save is not touching.
  const byBucket = new Map<string | null, number[]>();
  for (const c of clears) {
    // Only delete what is actually there — clearing 3,000 empty cells otherwise
    // sends 3,000 pointless deletes on every save.
    if (!existing.has(key(c.bucket_id, c.month_index))) continue;
    const list = byBucket.get(c.bucket_id) ?? [];
    list.push(c.month_index);
    byBucket.set(c.bucket_id, list);
  }
  for (const [bucketId, monthList] of byBucket) {
    const q = supabase.from('harvest_request').delete().eq('plan_id', planId).in('month_index', monthList);
    const { error } = await (bucketId === null ? q.is('bucket_id', null) : q.eq('bucket_id', bucketId));
    if (error) return { error: requestPermError(error.message) };
  }

  const edits: { b: string | null; m: number; old: number; new: number }[] = [];
  for (const e of rounded) {
    const old = existing.get(key(e.bucket_id, e.month_index)) ?? 0;
    if (old !== e.quantity_kg_wr) edits.push({ b: e.bucket_id, m: e.month_index, old, new: e.quantity_kg_wr });
  }
  edits.sort((a, b) => a.m - b.m);
  const CAP = 40;
  await logAudit(supabase, {
    planId, entityType: 'harvest_request', entityId: planId, action: 'update',
    changes: {
      set: upserts.length,
      cleared: [...byBucket.values()].reduce((n, l) => n + l.length, 0),
      edits: edits.slice(0, CAP),
      more: Math.max(0, edits.length - CAP),
    },
  });
  await notifyAfterSave(planId, 'harvest_request');
  revalidatePath('/harvest-plan');
  return { error: null };
}

/**
 * How the plant states its daily request, and which weekdays the farm harvests
 * on. Held under the same 'harvest_request' grant as the request itself.
 */
export async function saveHarvestRequestSettings(
  planId: string,
  settings: { mode: HarvestRequestMode; harvest_weekdays: number[] }
): Promise<SaveResult> {
  if (!planId) return { error: 'Missing plan.' };
  if (settings.mode !== 'by_date' && settings.mode !== 'by_date_size') return { error: 'Unknown request mode.' };
  const weekdays = [...new Set(settings.harvest_weekdays)].sort((a, b) => a - b);
  if (!weekdays.length) return { error: 'Pick at least one harvest day.' };
  if (weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return { error: 'Invalid harvest day.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const { data: before } = await supabase
    .from('harvest_request_settings').select('mode, harvest_weekdays').eq('plan_id', planId).maybeSingle();
  const { error } = await supabase.from('harvest_request_settings').upsert(
    { plan_id: planId, mode: settings.mode, harvest_weekdays: weekdays, created_by: user.id, updated_by: user.id },
    { onConflict: 'plan_id' }
  );
  if (error) return { error: requestPermError(error.message) };

  const MODE_LABEL: Record<string, string> = { by_date: 'By date', by_date_size: 'By date & size' };
  const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const days = (list: number[] | null | undefined) => (list ? list.map((d) => DAY[d]).join(', ') : null);
  const changes: Record<string, { old: string | null; new: string | null }> = {};
  if (before?.mode !== settings.mode) {
    changes.request_mode = { old: before ? MODE_LABEL[before.mode] : null, new: MODE_LABEL[settings.mode] };
  }
  if (days(before?.harvest_weekdays) !== days(weekdays)) {
    changes.harvest_days = { old: days(before?.harvest_weekdays), new: days(weekdays) };
  }
  if (Object.keys(changes).length) {
    await logAudit(supabase, { planId, entityType: 'harvest_request', entityId: planId, action: 'update', changes });
    await notifyAfterSave(planId, 'harvest_request');
  }
  revalidatePath('/harvest-plan');
  return { error: null };
}

/**
 * Save the plant's request for the harvest days on screen.
 *
 * The same sparse contract as the monthly request: every cell shown is sent, a
 * positive figure is upserted in whole kg WR, and a zero or cleared one deletes
 * the row — so a cleared day is gone rather than left at its old value. A null
 * bucket is the day's total with no size stated.
 */
export async function saveHarvestRequestDaily(
  planId: string,
  entries: { harvest_date: string; bucket_id: string | null; quantity_kg_wr: number }[]
): Promise<SaveResult> {
  if (!planId) return { error: 'Missing plan.' };
  for (const e of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.harvest_date)) return { error: `Invalid date ${e.harvest_date}.` };
    if (!Number.isFinite(e.quantity_kg_wr) || e.quantity_kg_wr < 0) {
      return { error: `Quantity for ${e.harvest_date} must be zero or greater.` };
    }
  }
  if (!entries.length) return { error: null };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const dates = [...new Set(entries.map((e) => e.harvest_date))].sort();
  const key = (bucketId: string | null, date: string) => `${bucketId ?? ''}:${date}`;
  const { data: existingRows } = await supabase
    .from('harvest_request_daily')
    .select('bucket_id, harvest_date, quantity_kg_wr')
    .eq('plan_id', planId)
    .gte('harvest_date', dates[0])
    .lte('harvest_date', dates[dates.length - 1]);
  const existing = new Map<string, number>(
    (existingRows ?? []).map((r: { bucket_id: string | null; harvest_date: string; quantity_kg_wr: number }) => [
      key(r.bucket_id, r.harvest_date),
      Number(r.quantity_kg_wr),
    ])
  );

  const rounded = entries.map((e) => ({ ...e, quantity_kg_wr: Math.round(e.quantity_kg_wr) }));
  const upserts = rounded.filter(
    (e) => e.quantity_kg_wr > 0 && existing.get(key(e.bucket_id, e.harvest_date)) !== e.quantity_kg_wr
  );
  if (upserts.length) {
    const { error } = await supabase.from('harvest_request_daily').upsert(
      upserts.map((e) => ({
        plan_id: planId, harvest_date: e.harvest_date, bucket_id: e.bucket_id,
        quantity_kg_wr: e.quantity_kg_wr, created_by: user.id, updated_by: user.id,
      })),
      { onConflict: 'plan_id,harvest_date,bucket_id' }
    );
    if (error) return { error: requestPermError(error.message) };
  }

  // One delete per bucket, so clearing a day for one size leaves the others.
  const byBucket = new Map<string | null, string[]>();
  for (const e of rounded) {
    if (e.quantity_kg_wr !== 0 || !existing.has(key(e.bucket_id, e.harvest_date))) continue;
    byBucket.set(e.bucket_id, [...(byBucket.get(e.bucket_id) ?? []), e.harvest_date]);
  }
  for (const [bucketId, dateList] of byBucket) {
    const q = supabase.from('harvest_request_daily').delete().eq('plan_id', planId).in('harvest_date', dateList);
    const { error } = await (bucketId === null ? q.is('bucket_id', null) : q.eq('bucket_id', bucketId));
    if (error) return { error: requestPermError(error.message) };
  }

  const edits: { b: string | null; d: string; old: number; new: number }[] = [];
  for (const e of rounded) {
    const old = existing.get(key(e.bucket_id, e.harvest_date)) ?? 0;
    if (old !== e.quantity_kg_wr) edits.push({ b: e.bucket_id, d: e.harvest_date, old, new: e.quantity_kg_wr });
  }
  if (edits.length) {
    edits.sort((a, b) => a.d.localeCompare(b.d));
    const CAP = 40;
    await logAudit(supabase, {
      planId, entityType: 'harvest_request', entityId: planId, action: 'update',
      changes: {
        daily: true,
        set: upserts.length,
        cleared: [...byBucket.values()].reduce((n, l) => n + l.length, 0),
        edits: edits.slice(0, CAP),
        more: Math.max(0, edits.length - CAP),
      },
    });
    await notifyAfterSave(planId, 'harvest_request');
  }
  revalidatePath('/harvest-plan');
  return { error: null };
}

/**
 * Record what was actually harvested, cell by cell.
 *
 * Same contract as the request plan: every bucket-month on screen is sent, a
 * zero or cleared cell is deleted so a missing row means "nothing recorded",
 * and RLS enforces the separate 'harvest_actual' grant. Never an engine input,
 * so saving here never marks the plan stale.
 *
 * Buckets are the actual-harvest list (harvest_actual_buckets), not the
 * planning one. A null `bucket_id` is the "No size stated" line: a month's
 * landed total the farm did not break down by size, entered like any other.
 */
export async function saveHarvestActual(
  planId: string,
  entries: { bucket_id: string | null; month_index: number; quantity_kg_wr: number }[]
): Promise<SaveResult> {
  if (!planId) return { error: 'Missing plan.' };

  for (const e of entries) {
    if (!Number.isInteger(e.month_index) || e.month_index < 1 || e.month_index > 60) {
      return { error: `Invalid month ${e.month_index}.` };
    }
    if (!Number.isFinite(e.quantity_kg_wr) || e.quantity_kg_wr < 0) {
      return { error: `Quantity for month ${e.month_index} must be zero or greater.` };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  // Whole kg WR, matching capacity and the request plan.
  const rounded = entries.map((e) => ({ ...e, quantity_kg_wr: Math.round(e.quantity_kg_wr) }));
  const upserts = rounded.filter((e) => e.quantity_kg_wr > 0);
  const clears = rounded.filter((e) => e.quantity_kg_wr === 0);

  const { data: existingRows } = await supabase
    .from('harvest_actual')
    .select('bucket_id, month_index, quantity_kg_wr')
    .eq('plan_id', planId);
  const key = (bucketId: string | null, month: number) => `${bucketId ?? ''}:${month}`;
  const existing = new Map<string, number>(
    (existingRows ?? []).map((r: { bucket_id: string | null; month_index: number; quantity_kg_wr: number }) => [
      key(r.bucket_id, r.month_index),
      Number(r.quantity_kg_wr),
    ])
  );

  if (upserts.length) {
    const { error } = await supabase.from('harvest_actual').upsert(
      upserts.map((e) => ({
        plan_id: planId, bucket_id: e.bucket_id, month_index: e.month_index,
        quantity_kg_wr: e.quantity_kg_wr, created_by: user.id, updated_by: user.id,
      })),
      { onConflict: 'plan_id,bucket_id,month_index' }
    );
    if (error) return { error: actualPermError(error.message) };
  }

  // One delete per bucket: a single `in` over months would take out every
  // bucket in those months, including ones this save is not touching.
  const byBucket = new Map<string | null, number[]>();
  for (const c of clears) {
    // Only delete what is actually there, so an empty grid doesn't send
    // thousands of pointless deletes on every save.
    if (!existing.has(key(c.bucket_id, c.month_index))) continue;
    const list = byBucket.get(c.bucket_id) ?? [];
    list.push(c.month_index);
    byBucket.set(c.bucket_id, list);
  }
  for (const [bucketId, monthList] of byBucket) {
    const q = supabase.from('harvest_actual').delete().eq('plan_id', planId).in('month_index', monthList);
    const { error } = await (bucketId === null ? q.is('bucket_id', null) : q.eq('bucket_id', bucketId));
    if (error) return { error: actualPermError(error.message) };
  }

  const edits: { b: string | null; m: number; old: number; new: number }[] = [];
  for (const e of rounded) {
    const old = existing.get(key(e.bucket_id, e.month_index)) ?? 0;
    if (old !== e.quantity_kg_wr) edits.push({ b: e.bucket_id, m: e.month_index, old, new: e.quantity_kg_wr });
  }
  edits.sort((a, b) => a.m - b.m);
  const CAP = 40;
  await logAudit(supabase, {
    planId, entityType: 'harvest_actual', entityId: planId, action: 'update',
    changes: {
      set: upserts.length,
      cleared: [...byBucket.values()].reduce((n, l) => n + l.length, 0),
      edits: edits.slice(0, CAP),
      more: Math.max(0, edits.length - CAP),
    },
  });
  await notifyAfterSave(planId, 'harvest_actual');
  revalidatePath('/harvest-plan');
  return { error: null };
}

/**
 * Add or rename a size on the Actual Harvest list. Its own list: nothing here
 * touches the planning buckets, the capacity grid or the request plan. RLS lets
 * it through only for whoever records actuals (or an admin) — not for Buckets.
 */
export async function saveActualBucket(input: {
  id?: string | null;
  orgId: string;
  name: string;
  sortOrder: number;
}): Promise<SaveResult> {
  const name = (input.name ?? '').trim();
  if (!name) return { error: 'Name is required.' };
  if (!Number.isInteger(input.sortOrder)) return { error: 'Order must be a whole number.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const { error } = input.id
    ? await supabase.from('harvest_actual_buckets')
        .update({ name, sort_order: input.sortOrder, updated_by: user.id }).eq('id', input.id)
    : await supabase.from('harvest_actual_buckets')
        .insert({ org_id: input.orgId, name, sort_order: input.sortOrder, created_by: user.id, updated_by: user.id });
  if (error) return { error: actualBucketError(error.message) };
  revalidatePath('/harvest-plan');
  return { error: null };
}

/**
 * Remove a size from the Actual Harvest list. One that still holds figures in
 * any plan (snapshots included) is archived instead — hidden from the grid,
 * its history kept — since deleting it would orphan them.
 */
export async function removeActualBucket(id: string): Promise<SaveResult & { archived?: boolean }> {
  if (!id) return { error: 'Missing bucket.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const { error } = await supabase.from('harvest_actual_buckets').delete().eq('id', id);
  if (!error) { revalidatePath('/harvest-plan'); return { error: null }; }
  if (!/foreign key|violates/i.test(error.message)) return { error: actualBucketError(error.message) };

  const { error: ae } = await supabase.from('harvest_actual_buckets')
    .update({ is_archived: true, updated_by: user.id }).eq('id', id);
  if (ae) return { error: actualBucketError(ae.message) };
  revalidatePath('/harvest-plan');
  return { error: null, archived: true };
}

function actualBucketError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('duplicate') || m.includes('unique')) return 'There is already an actual-harvest bucket with that name.';
  if (/row-level security|violates row-level/.test(m)) {
    return 'Can’t change the actual-harvest buckets — it needs the Actual Harvest permission.';
  }
  return message;
}

function actualPermError(message: string): string {
  return /row-level security|violates row-level/i.test(message)
    ? 'Can’t record actual harvest — it needs the Actual Harvest permission on this plan, and the plan must be unlocked.'
    : message;
}

function requestPermError(message: string): string {
  return /row-level security|violates row-level/i.test(message)
    ? 'Can’t edit the request plan — it needs the Harvest Request Plan permission on this plan, and the plan must be unlocked.'
    : message;
}

/**
 * Bulk import harvest capacity from a wide CSV (bucket × M1..M60). Keys resolve
 * to bucket ids; non-blank cells upsert into harvest_plan. Unknown bucket names
 * are skipped and reported.
 */
export async function importHarvest(planId: string, rows: WideRow[]): Promise<WideImportResult> {
  if (!planId) return { error: 'Missing plan.', count: 0, unknown: [] };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', count: 0, unknown: [] };

  const { data: buckets } = await supabase.from('buckets').select('id, name').eq('is_archived', false);
  const idByName = new Map((buckets ?? []).map((b: { id: string; name: string }) => [b.name, b.id]));

  const upserts: Record<string, unknown>[] = [];
  const unknown = new Set<string>();
  for (const row of rows) {
    const bid = idByName.get(row.key);
    if (!bid) { unknown.add(row.key); continue; }
    for (const c of row.cells) {
      if (c.month < 1 || c.month > 60 || !Number.isFinite(c.value) || c.value < 0) continue;
      // Capacity is kept in whole kg WR, same as the editor.
      upserts.push({ plan_id: planId, bucket_id: bid, month_index: c.month, capacity_kg_wr: Math.round(c.value), created_by: user.id, updated_by: user.id });
    }
  }

  if (upserts.length) {
    const { error } = await supabase.from('harvest_plan').upsert(upserts, { onConflict: 'plan_id,bucket_id,month_index' });
    if (error) return { error: permError(error.message), count: 0, unknown: [...unknown] };
    await logAudit(supabase, { planId, entityType: 'harvest_plan', entityId: planId, action: 'update', changes: { imported_cells: upserts.length } });
  }
  revalidatePath('/harvest-plan');
  return { error: null, count: upserts.length, unknown: [...unknown] };
}
