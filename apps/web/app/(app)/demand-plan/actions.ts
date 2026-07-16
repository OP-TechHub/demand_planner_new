'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import type { WideRow, WideImportResult } from '@/components/wide-grid-import';

export type SaveResult = { error: string | null };

/** Map a raw RLS rejection to a clear message about section access. */
function permError(message: string): string {
  return /row-level security|violates row-level/i.test(message)
    ? 'You don’t have permission to edit the demand plan. Ask an admin for access.'
    : message;
}

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

  // Snapshot current values BEFORE writing, so the audit can show old → new.
  // A cleared override reverts to the program baseline.
  const { data: prog } = await supabase.from('programs').select('max_monthly_demand_fp').eq('id', programId).maybeSingle();
  const baseline = Number(prog?.max_monthly_demand_fp ?? 0);
  const { data: existingRows } = await supabase.from('demand_plan').select('month_index, demand_fp').eq('program_id', programId);
  const existing = new Map<number, number>(
    (existingRows ?? []).map((r: { month_index: number; demand_fp: number }) => [r.month_index, Number(r.demand_fp)])
  );

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
    if (error) return { error: permError(error.message) };
  }

  if (deletes.length) {
    const { error } = await supabase
      .from('demand_plan')
      .delete()
      .eq('program_id', programId)
      .in('month_index', deletes);
    if (error) return { error: permError(error.message) };
  }

  const edits: { m: number; old: number; new: number }[] = [];
  for (const c of upserts) {
    const old = existing.has(c.month_index) ? existing.get(c.month_index)! : baseline;
    if (old !== c.demand_fp) edits.push({ m: c.month_index, old, new: c.demand_fp });
  }
  for (const m of deletes) {
    const old = existing.has(m) ? existing.get(m)! : baseline;
    if (old !== baseline) edits.push({ m, old, new: baseline });
  }
  edits.sort((a, b) => a.m - b.m);
  const CAP = 40;
  await logAudit(supabase, {
    planId, entityType: 'demand_plan', entityId: programId, action: 'update',
    changes: { set: upserts.length, cleared: deletes.length, edits: edits.slice(0, CAP), more: Math.max(0, edits.length - CAP) },
  });
  revalidatePath('/demand-plan');
  return { error: null };
}

/**
 * Bulk import demand overrides from a wide CSV (item_code × M1..M60). Keys
 * resolve to program ids; non-blank cells upsert into demand_plan. Unknown
 * item_codes are skipped and reported.
 */
export async function importDemand(planId: string, rows: WideRow[]): Promise<WideImportResult> {
  if (!planId) return { error: 'Missing plan.', count: 0, unknown: [] };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', count: 0, unknown: [] };

  const { data: progs } = await supabase
    .from('programs')
    .select('id, item_code')
    .eq('plan_id', planId)
    .is('deleted_at', null);
  const idByCode = new Map((progs ?? []).map((p: { id: string; item_code: string }) => [p.item_code, p.id]));

  const upserts: Record<string, unknown>[] = [];
  const unknown = new Set<string>();
  for (const row of rows) {
    const pid = idByCode.get(row.key);
    if (!pid) { unknown.add(row.key); continue; }
    for (const c of row.cells) {
      if (c.month < 1 || c.month > 60 || !Number.isFinite(c.value) || c.value < 0) continue;
      upserts.push({ plan_id: planId, program_id: pid, month_index: c.month, demand_fp: c.value, created_by: user.id, updated_by: user.id });
    }
  }

  if (upserts.length) {
    const { error } = await supabase.from('demand_plan').upsert(upserts, { onConflict: 'program_id,month_index' });
    if (error) return { error: permError(error.message), count: 0, unknown: [...unknown] };
    await logAudit(supabase, { planId, entityType: 'demand_plan', entityId: planId, action: 'update', changes: { imported_cells: upserts.length } });
  }
  revalidatePath('/demand-plan');
  return { error: null, count: upserts.length, unknown: [...unknown] };
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
