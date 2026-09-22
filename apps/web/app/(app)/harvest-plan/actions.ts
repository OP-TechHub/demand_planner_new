'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import type { WideRow, WideImportResult } from '@/components/wide-grid-import';

export type SaveResult = { error: string | null };

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

  // Whole kg WR, matching how harvest capacity is kept.
  const rounded = entries.map((e) => ({ ...e, quantity_kg_wr: Math.round(e.quantity_kg_wr) }));
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
 * Unlike the request, there is no sizeless row to tolerate — this table has
 * always been per bucket, so an entry without one is a bug, not history.
 */
export async function saveHarvestActual(
  planId: string,
  entries: { bucket_id: string; month_index: number; quantity_kg_wr: number }[]
): Promise<SaveResult> {
  if (!planId) return { error: 'Missing plan.' };

  for (const e of entries) {
    if (!e.bucket_id) return { error: 'Missing bucket.' };
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
  const key = (bucketId: string, month: number) => `${bucketId}:${month}`;
  const existing = new Map<string, number>(
    (existingRows ?? []).map((r: { bucket_id: string; month_index: number; quantity_kg_wr: number }) => [
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
  const byBucket = new Map<string, number[]>();
  for (const c of clears) {
    // Only delete what is actually there, so an empty grid doesn't send
    // thousands of pointless deletes on every save.
    if (!existing.has(key(c.bucket_id, c.month_index))) continue;
    const list = byBucket.get(c.bucket_id) ?? [];
    list.push(c.month_index);
    byBucket.set(c.bucket_id, list);
  }
  for (const [bucketId, monthList] of byBucket) {
    const { error } = await supabase
      .from('harvest_actual').delete()
      .eq('plan_id', planId).eq('bucket_id', bucketId).in('month_index', monthList);
    if (error) return { error: actualPermError(error.message) };
  }

  const edits: { b: string; m: number; old: number; new: number }[] = [];
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
  revalidatePath('/harvest-plan');
  return { error: null };
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
