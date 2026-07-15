'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { WideRow, WideImportResult } from '@/components/wide-grid-import';

export type SaveResult = { error: string | null };

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
    if (error) return { error: error.message };
  }

  if (deletes.length) {
    const { error } = await supabase
      .from('harvest_plan')
      .delete()
      .eq('plan_id', planId)
      .eq('bucket_id', bucketId)
      .in('month_index', deletes);
    if (error) return { error: error.message };
  }

  revalidatePath('/harvest-plan');
  return { error: null };
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
      upserts.push({ plan_id: planId, bucket_id: bid, month_index: c.month, capacity_kg_wr: c.value, created_by: user.id, updated_by: user.id });
    }
  }

  if (upserts.length) {
    const { error } = await supabase.from('harvest_plan').upsert(upserts, { onConflict: 'plan_id,bucket_id,month_index' });
    if (error) return { error: error.message, count: 0, unknown: [...unknown] };
  }
  revalidatePath('/harvest-plan');
  return { error: null, count: upserts.length, unknown: [...unknown] };
}
