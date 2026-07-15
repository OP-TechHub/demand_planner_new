'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type SaveResult = { error: string | null };

/**
 * Persist per-month demand overrides for one program.
 *
 * `upserts` are cells that differ from baseline (written to demand_plan).
 * `deletes` are month indexes whose override was cleared — deleting the row
 * makes the cell fall back to programs.max_monthly_demand_fp (data-model.md §4).
 */
export async function saveDemandOverrides(
  planId: string,
  programId: string,
  upserts: { month_index: number; demand_fp: number }[],
  deletes: number[]
): Promise<SaveResult> {
  if (!planId || !programId) return { error: 'Missing plan or program.' };

  for (const c of upserts) {
    if (!Number.isInteger(c.month_index) || c.month_index < 1 || c.month_index > 60) {
      return { error: `Invalid month ${c.month_index}.` };
    }
    if (!Number.isFinite(c.demand_fp) || c.demand_fp < 0) {
      return { error: `Demand for month ${c.month_index} must be zero or greater.` };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  if (upserts.length) {
    const rows = upserts.map((c) => ({
      plan_id: planId,
      program_id: programId,
      month_index: c.month_index,
      demand_fp: c.demand_fp,
      created_by: user.id,
      updated_by: user.id,
    }));
    const { error } = await supabase
      .from('demand_plan')
      .upsert(rows, { onConflict: 'program_id,month_index' });
    if (error) return { error: error.message };
  }

  if (deletes.length) {
    const { error } = await supabase
      .from('demand_plan')
      .delete()
      .eq('program_id', programId)
      .in('month_index', deletes);
    if (error) return { error: error.message };
  }

  revalidatePath('/demand-plan');
  return { error: null };
}

/** Clear every override for a program (revert all months to baseline). */
export async function resetDemandProgram(programId: string): Promise<SaveResult> {
  if (!programId) return { error: 'Missing program.' };
  const supabase = await createClient();
  const { error } = await supabase.from('demand_plan').delete().eq('program_id', programId);
  if (error) return { error: error.message };
  revalidatePath('/demand-plan');
  return { error: null };
}
