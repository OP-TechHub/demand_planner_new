'use server';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

export type PoFormState = { error: string | null; ok: boolean };
export type PoResult = { error: string | null };

/** Map a raw RLS rejection to a clear message about section access. */
function permError(message: string): string {
  return /row-level security|violates row-level/i.test(message)
    ? 'Can’t record POs here — this plan may be a read-only snapshot, or you may not have edit access to the Demand Plan.'
    : message;
}

/**
 * Re-derive `demand_plan` for one program over the given months from its POs.
 *
 * This is the only place the PO tab writes demand, and it is called after every
 * save and delete. For each month:
 *
 *   • at least one PO  ->  demand_fp = Σ of that month's PO quantities. Before
 *     the FIRST PO overwrites anything, what was there is stashed in
 *     po_demand_baseline (null when there was no override at all).
 *   • no POs left      ->  the stash is put back: the original override is
 *     restored, or the row is deleted so the month falls back to the program
 *     baseline. Either way the stash row goes.
 *
 * Written as set operations over the whole month list rather than a loop of
 * round-trips: a 24-month PO would otherwise cost ~100 queries.
 */
async function syncDemand(
  supabase: any,
  planId: string,
  programId: string,
  months: number[],
  userId: string
): Promise<string | null> {
  const uniq = [...new Set(months)].sort((a, b) => a - b);
  if (uniq.length === 0) return null;

  const [{ data: poRows }, { data: baseRows }, { data: demRows }] = await Promise.all([
    supabase.from('po_updates').select('month_index, quantity_fp').eq('program_id', programId).in('month_index', uniq),
    supabase.from('po_demand_baseline').select('month_index, prev_demand_fp').eq('program_id', programId).in('month_index', uniq),
    supabase.from('demand_plan').select('month_index, demand_fp').eq('program_id', programId).in('month_index', uniq),
  ]);

  const sums = new Map<number, number>();
  for (const r of (poRows ?? []) as { month_index: number; quantity_fp: number }[]) {
    sums.set(r.month_index, (sums.get(r.month_index) ?? 0) + Number(r.quantity_fp));
  }
  // `null` is meaningful here (no override existed), so membership is tested with
  // .has() throughout rather than by truthiness.
  const stash = new Map<number, number | null>(
    (baseRows ?? []).map((r: { month_index: number; prev_demand_fp: number | null }) => [
      r.month_index,
      r.prev_demand_fp === null ? null : Number(r.prev_demand_fp),
    ])
  );
  const demand = new Map<number, number>(
    (demRows ?? []).map((r: { month_index: number; demand_fp: number }) => [r.month_index, Number(r.demand_fp)])
  );

  const demandUpserts: Record<string, unknown>[] = [];
  const demandDeletes: number[] = [];
  const stashInserts: Record<string, unknown>[] = [];
  const stashDeletes: number[] = [];

  const cell = (month: number, demandFp: number) => ({
    plan_id: planId, program_id: programId, month_index: month,
    demand_fp: demandFp, created_by: userId, updated_by: userId,
  });

  for (const m of uniq) {
    const sum = sums.get(m);
    if (sum !== undefined) {
      // Only the first PO to claim the month records what it displaced.
      if (!stash.has(m)) {
        stashInserts.push({
          plan_id: planId, program_id: programId, month_index: m,
          prev_demand_fp: demand.has(m) ? demand.get(m)! : null,
        });
      }
      demandUpserts.push(cell(m, sum));
    } else if (stash.has(m)) {
      const prev = stash.get(m)!;
      if (prev === null) demandDeletes.push(m);
      else demandUpserts.push(cell(m, prev));
      stashDeletes.push(m);
    }
  }

  // Stash first: if the demand write then fails, we have recorded a restore point
  // for a month we never overwrote, which is harmless. The reverse order could
  // overwrite a forecast with no way back.
  if (stashInserts.length) {
    const { error } = await supabase.from('po_demand_baseline').insert(stashInserts);
    if (error) return permError(error.message);
  }
  if (demandUpserts.length) {
    const { error } = await supabase.from('demand_plan').upsert(demandUpserts, { onConflict: 'program_id,month_index' });
    if (error) return permError(error.message);
  }
  if (demandDeletes.length) {
    const { error } = await supabase.from('demand_plan').delete().eq('program_id', programId).in('month_index', demandDeletes);
    if (error) return permError(error.message);
  }
  if (stashDeletes.length) {
    const { error } = await supabase.from('po_demand_baseline').delete().eq('program_id', programId).in('month_index', stashDeletes);
    if (error) return permError(error.message);
  }
  return null;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function refresh() {
  revalidatePath('/po-update');
  // The demand it just rewrote is on another tab.
  revalidatePath('/demand-plan');
}

/**
 * Create or update one PO.
 *
 * A PO is identified by (program, po_ref) and stored as one row per month it
 * covers, so an edit replaces the whole group: the old lines go, the new range is
 * written, and demand is re-derived over the union of both — otherwise a PO moved
 * from Apr–Jun to May–Jul would leave April's demand stuck at the old figure.
 */
export async function savePo(_prev: PoFormState, fd: FormData): Promise<PoFormState> {
  const planId = String(fd.get('plan_id') ?? '').trim();
  const programId = String(fd.get('program_id') ?? '').trim();
  const poRef = String(fd.get('po_ref') ?? '').trim();
  const monthFrom = Number(String(fd.get('month_from') ?? '').trim());
  const monthTo = Number(String(fd.get('month_to') ?? '').trim());
  const quantity = Number(String(fd.get('quantity_fp') ?? '').trim());
  const receivedOn = String(fd.get('received_on') ?? '').trim();
  const notes = String(fd.get('notes') ?? '').trim();
  // Present only when editing — the PO being replaced.
  const origProgramId = String(fd.get('orig_program_id') ?? '').trim();
  const origPoRef = String(fd.get('orig_po_ref') ?? '').trim();

  if (!planId) return { error: 'Missing plan.', ok: false };
  if (!programId) return { error: 'Pick the program this PO is for.', ok: false };
  if (!poRef) return { error: 'PO number is required.', ok: false };
  if (!Number.isInteger(monthFrom) || !Number.isInteger(monthTo)) return { error: 'Pick the months this PO covers.', ok: false };
  if (monthTo < monthFrom) return { error: 'The last month can’t be before the first.', ok: false };
  if (!Number.isFinite(quantity) || quantity < 0) return { error: 'Quantity must be zero or greater.', ok: false };
  if (receivedOn && !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) return { error: 'Received date isn’t a valid date.', ok: false };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', ok: false };

  const { data: plan } = await supabase.from('plans').select('horizon_months').eq('id', planId).maybeSingle();
  const horizon = Number(plan?.horizon_months ?? 0);
  if (!horizon) return { error: 'Plan not found.', ok: false };
  if (monthFrom < 1 || monthTo > horizon) return { error: `Months must fall inside the plan’s ${horizon}-month window.`, ok: false };

  const months = range(monthFrom, monthTo);
  const editing = Boolean(origPoRef && origProgramId);

  // Months the old version of this PO occupied — they need re-deriving too.
  let oldMonths: number[] = [];
  if (editing) {
    const { data: oldRows } = await supabase
      .from('po_updates').select('month_index')
      .eq('program_id', origProgramId).eq('po_ref', origPoRef);
    oldMonths = (oldRows ?? []).map((r: { month_index: number }) => r.month_index);

    const { error } = await supabase
      .from('po_updates').delete()
      .eq('program_id', origProgramId).eq('po_ref', origPoRef);
    if (error) return { error: permError(error.message), ok: false };
  }

  const rows = months.map((m) => ({
    plan_id: planId, program_id: programId, month_index: m,
    quantity_fp: quantity, po_ref: poRef,
    received_on: receivedOn || null, notes: notes || null,
    created_by: user.id, updated_by: user.id,
  }));
  const { error: insErr } = await supabase.from('po_updates').insert(rows);
  if (insErr) {
    const m = insErr.message.toLowerCase();
    if (m.includes('duplicate') || m.includes('unique')) {
      return { error: `PO ${poRef} is already recorded against this program for one of those months.`, ok: false };
    }
    return { error: permError(insErr.message), ok: false };
  }

  // Re-derive. When the PO stayed on the same program, its old and new months are
  // one list; when it was moved to a different program, each side re-derives on
  // its own so the months the PO vacated get their demand back.
  const movedProgram = editing && origProgramId !== programId;
  const mine = movedProgram ? months : [...months, ...oldMonths];
  const syncErr = await syncDemand(supabase, planId, programId, mine, user.id);
  if (syncErr) return { error: syncErr, ok: false };
  if (movedProgram) {
    const vacatedErr = await syncDemand(supabase, planId, origProgramId, oldMonths, user.id);
    if (vacatedErr) return { error: vacatedErr, ok: false };
  }

  await logAudit(supabase, {
    planId, entityType: 'po_updates', entityId: programId, action: editing ? 'update' : 'insert',
    changes: { po_ref: poRef, months: months.length, month_from: monthFrom, month_to: monthTo, quantity_fp: quantity },
  });
  refresh();
  return { error: null, ok: true };
}

/** Remove a PO entirely, restoring the demand each of its months displaced. */
export async function deletePo(planId: string, programId: string, poRef: string): Promise<PoResult> {
  if (!planId || !programId || !poRef) return { error: 'Missing PO.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const { data: rows } = await supabase
    .from('po_updates').select('month_index').eq('program_id', programId).eq('po_ref', poRef);
  const months = (rows ?? []).map((r: { month_index: number }) => r.month_index);
  if (months.length === 0) return { error: 'That PO no longer exists.' };

  const { error } = await supabase.from('po_updates').delete().eq('program_id', programId).eq('po_ref', poRef);
  if (error) return { error: permError(error.message) };

  const syncErr = await syncDemand(supabase, planId, programId, months, user.id);
  if (syncErr) return { error: syncErr };

  await logAudit(supabase, {
    planId, entityType: 'po_updates', entityId: programId, action: 'delete',
    changes: { po_ref: poRef, months: months.length },
  });
  refresh();
  return { error: null };
}
