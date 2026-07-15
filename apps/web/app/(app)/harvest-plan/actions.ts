'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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
