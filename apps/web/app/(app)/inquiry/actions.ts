'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

/** Map an RLS rejection to a message that names the real cause. */
function permError(message: string): string {
  return /row-level security|violates row-level/i.test(message)
    ? "Can't save here — this plan may be a read-only snapshot, or you may not have edit access to programs and the demand plan."
    : message;
}

/** One of a program's sourcing paths, with the spare WR in its bucket that month. */
export type InquiryPath = {
  path: 'primary' | 'secondary' | 'tertiary';
  bucket_id: string;
  bucket_name: string;
  yield: number;
  unallocated_wr: number;
};

/** The program's picture for one month in the inquiry range. */
export type InquiryMonth = {
  month_index: number;
  current_demand_fp: number;
  paths: InquiryPath[];
};

export type InquiryOtherProgram = {
  item_code: string;
  item_description: string;
  /** Total demand across the inquiry range. */
  demand_fp: number;
};

export type InquiryContext =
  | {
      ok: true;
      /** false when the plan has no computed results yet (needs a recompute). */
      computed: boolean;
      program: {
        id: string;
        item_code: string;
        item_description: string;
        customer: string;
        price_per_fp: number;
        status: string;
      };
      months: InquiryMonth[];
      otherActive: InquiryOtherProgram[];
    }
  | { ok: false; error: string };

/**
 * Gather everything the inquiry screen needs for one program across a set of
 * months (a contiguous range or hand-picked months — the caller decides and
 * passes the resolved list): per month, the program's sourcing paths with each
 * bucket's spare whole-round (unallocated_wr) and the currently-planned demand
 * (so each month can be overridden). Months are independent — each draws from
 * its own month's spare capacity — so the client cascades each one on its own.
 */
export async function getInquiryContext(
  planId: string,
  programId: string,
  monthIndices: number[]
): Promise<InquiryContext> {
  if (!planId || !programId) return { ok: false, error: 'Missing selection.' };
  const monthsSel = [...new Set(monthIndices)]
    .filter((m) => Number.isInteger(m) && m >= 1)
    .sort((a, b) => a - b);
  if (monthsSel.length === 0) return { ok: false, error: 'Pick at least one month.' };

  const supabase = await createClient();
  const { data: progData } = await supabase
    .from('programs')
    .select(
      'id, item_code, item_description, customer, status, price_per_fp, max_monthly_demand_fp, ' +
        'primary_bucket_id, secondary_bucket_id, tertiary_bucket_id, ' +
        'primary_yield, secondary_yield, tertiary_yield'
    )
    .eq('id', programId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!progData) return { ok: false, error: 'Program not found.' };
  // The concatenated select defeats Supabase's row-type inference, so name the shape.
  const prog = progData as unknown as {
    id: string; item_code: string; item_description: string; customer: string; status: string;
    price_per_fp: number; max_monthly_demand_fp: number;
    primary_bucket_id: string; secondary_bucket_id: string | null; tertiary_bucket_id: string | null;
    primary_yield: number; secondary_yield: number | null; tertiary_yield: number | null;
  };
  const baseline = Number(prog.max_monthly_demand_fp);

  const rawPaths = [
    { path: 'primary' as const, bucket_id: prog.primary_bucket_id, yield: Number(prog.primary_yield) },
    prog.secondary_bucket_id
      ? { path: 'secondary' as const, bucket_id: prog.secondary_bucket_id, yield: Number(prog.secondary_yield) }
      : null,
    prog.tertiary_bucket_id
      ? { path: 'tertiary' as const, bucket_id: prog.tertiary_bucket_id, yield: Number(prog.tertiary_yield) }
      : null,
  ].filter((p): p is { path: 'primary' | 'secondary' | 'tertiary'; bucket_id: string; yield: number } => p !== null);

  const bucketIds = [...new Set(rawPaths.map((p) => p.bucket_id))];

  const [{ data: buckets }, { data: unalloc }, { data: anyResult }, { data: ownDemand }] = await Promise.all([
    supabase.from('buckets').select('id, name').in('id', bucketIds),
    supabase
      .from('unallocated_wr')
      .select('bucket_id, month_index, unallocated_wr')
      .eq('plan_id', planId)
      .in('bucket_id', bucketIds)
      .in('month_index', monthsSel),
    supabase.from('unallocated_wr').select('bucket_id').eq('plan_id', planId).limit(1),
    supabase
      .from('demand_plan')
      .select('month_index, demand_fp')
      .eq('program_id', programId)
      .in('month_index', monthsSel),
  ]);

  const nameById = new Map((buckets ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));
  const unallocByKey = new Map(
    (unalloc ?? []).map((u: { bucket_id: string; month_index: number; unallocated_wr: number }) => [
      `${u.bucket_id}:${u.month_index}`,
      Number(u.unallocated_wr),
    ])
  );
  const demandByMonth = new Map(
    (ownDemand ?? []).map((d: { month_index: number; demand_fp: number }) => [d.month_index, Number(d.demand_fp)])
  );
  const computed = (anyResult ?? []).length > 0;

  const months: InquiryMonth[] = monthsSel.map((m) => ({
    month_index: m,
    current_demand_fp: demandByMonth.get(m) ?? baseline,
    paths: rawPaths.map((p) => ({
      ...p,
      bucket_name: nameById.get(p.bucket_id) ?? 'Unknown bucket',
      unallocated_wr: unallocByKey.get(`${p.bucket_id}:${m}`) ?? 0,
    })),
  }));

  // Other active programs for the same customer, with total demand across the range.
  const { data: others } = await supabase
    .from('programs')
    .select('id, item_code, item_description, max_monthly_demand_fp')
    .eq('plan_id', planId)
    .eq('customer', prog.customer)
    .eq('status', 'active')
    .neq('id', programId)
    .is('deleted_at', null)
    .order('sort_order');
  const otherRows = (others ?? []) as {
    id: string; item_code: string; item_description: string; max_monthly_demand_fp: number;
  }[];
  const overridesByProg = new Map<string, Map<number, number>>();
  if (otherRows.length) {
    const { data: drows } = await supabase
      .from('demand_plan')
      .select('program_id, month_index, demand_fp')
      .in('program_id', otherRows.map((o) => o.id))
      .in('month_index', monthsSel);
    for (const d of (drows ?? []) as { program_id: string; month_index: number; demand_fp: number }[]) {
      const map = overridesByProg.get(d.program_id) ?? new Map<number, number>();
      map.set(d.month_index, Number(d.demand_fp));
      overridesByProg.set(d.program_id, map);
    }
  }
  const otherActive: InquiryOtherProgram[] = otherRows.map((o) => {
    const ovr = overridesByProg.get(o.id);
    const base = Number(o.max_monthly_demand_fp);
    let total = 0;
    for (const m of monthsSel) total += ovr?.get(m) ?? base;
    return { item_code: o.item_code, item_description: o.item_description, demand_fp: total };
  });

  return {
    ok: true,
    computed,
    program: {
      id: prog.id,
      item_code: prog.item_code,
      item_description: prog.item_description,
      customer: prog.customer,
      price_per_fp: Number(prog.price_per_fp),
      status: prog.status,
    },
    months,
    otherActive,
  };
}

export type NewInquiryData =
  | {
      ok: true;
      computed: boolean;
      /** Spare whole-round per chosen bucket per month, keyed `${bucketId}:${month}`. */
      unallocated: Record<string, number>;
      otherActive: InquiryOtherProgram[];
    }
  | { ok: false; error: string };

/**
 * For a NEW-program inquiry, the caller defines the sourcing (which buckets, at
 * what yields) and the customer. We supply the spare whole-round capacity of
 * those buckets across the chosen months, plus the customer's existing active
 * programs — the FP↔WR arithmetic is then the same client-side cascade.
 */
export async function getNewInquiryData(
  planId: string,
  bucketIds: string[],
  monthIndices: number[],
  customer: string
): Promise<NewInquiryData> {
  if (!planId) return { ok: false, error: 'Missing plan.' };
  const buckets = [...new Set(bucketIds)].filter(Boolean);
  const monthsSel = [...new Set(monthIndices)].filter((m) => Number.isInteger(m) && m >= 1).sort((a, b) => a - b);

  const supabase = await createClient();

  // Whether the plan has any computed results at all (drives the recalc notice).
  const { data: anyResult } = await supabase.from('unallocated_wr').select('bucket_id').eq('plan_id', planId).limit(1);
  const computed = (anyResult ?? []).length > 0;

  const unallocated: Record<string, number> = {};
  if (buckets.length && monthsSel.length) {
    const { data: rows } = await supabase
      .from('unallocated_wr')
      .select('bucket_id, month_index, unallocated_wr')
      .eq('plan_id', planId)
      .in('bucket_id', buckets)
      .in('month_index', monthsSel);
    for (const u of (rows ?? []) as { bucket_id: string; month_index: number; unallocated_wr: number }[]) {
      unallocated[`${u.bucket_id}:${u.month_index}`] = Number(u.unallocated_wr);
    }
  }

  const otherActive: InquiryOtherProgram[] = [];
  const customerName = customer.trim();
  if (customerName && monthsSel.length) {
    const { data: others } = await supabase
      .from('programs')
      .select('id, item_code, item_description, max_monthly_demand_fp')
      .eq('plan_id', planId)
      .eq('customer', customerName)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('sort_order');
    const otherRows = (others ?? []) as {
      id: string; item_code: string; item_description: string; max_monthly_demand_fp: number;
    }[];
    const overridesByProg = new Map<string, Map<number, number>>();
    if (otherRows.length) {
      const { data: drows } = await supabase
        .from('demand_plan')
        .select('program_id, month_index, demand_fp')
        .in('program_id', otherRows.map((o) => o.id))
        .in('month_index', monthsSel);
      for (const d of (drows ?? []) as { program_id: string; month_index: number; demand_fp: number }[]) {
        const map = overridesByProg.get(d.program_id) ?? new Map<number, number>();
        map.set(d.month_index, Number(d.demand_fp));
        overridesByProg.set(d.program_id, map);
      }
    }
    for (const o of otherRows) {
      const ovr = overridesByProg.get(o.id);
      const base = Number(o.max_monthly_demand_fp);
      let total = 0;
      for (const m of monthsSel) total += ovr?.get(m) ?? base;
      otherActive.push({ item_code: o.item_code, item_description: o.item_description, demand_fp: total });
    }
  }

  return { ok: true, computed, unallocated, otherActive };
}

// ---------------------------------------------------------------------------
// Saving an inquiry into the plan's pipeline
// ---------------------------------------------------------------------------

export type SaveResult = { ok: boolean; error?: string };
export type InquiryEntry = { month_index: number; demand_fp: number };

function cleanEntries(entries: InquiryEntry[]): InquiryEntry[] {
  return entries.filter(
    (e) => Number.isInteger(e.month_index) && e.month_index >= 1 && e.month_index <= 120 && Number.isFinite(e.demand_fp) && e.demand_fp >= 0
  );
}

export type SaveToPipelineResult = SaveResult & {
  /** Present when a new pipeline twin must be created and needs item code + price. */
  needsDetails?: { suggestedItemCode: string; price: number };
};

/** Add `entries` (additional volume) onto a program's existing demand for those months. */
async function accumulateDemand(
  supabase: Awaited<ReturnType<typeof createClient>>,
  planId: string,
  programId: string,
  userId: string,
  entries: InquiryEntry[]
): Promise<string | null> {
  const months = entries.map((e) => e.month_index);
  const { data: existing } = await supabase
    .from('demand_plan')
    .select('month_index, demand_fp')
    .eq('program_id', programId)
    .in('month_index', months);
  const cur = new Map((existing ?? []).map((r: { month_index: number; demand_fp: number }) => [r.month_index, Number(r.demand_fp)]));
  const rows = entries.map((e) => ({
    plan_id: planId, program_id: programId, month_index: e.month_index,
    demand_fp: (cur.get(e.month_index) ?? 0) + e.demand_fp,
    created_by: userId, updated_by: userId,
  }));
  const { error } = await supabase.from('demand_plan').upsert(rows, { onConflict: 'program_id,month_index' });
  return error ? error.message : null;
}

/**
 * Save an existing-program inquiry as ADDITIONAL pipeline volume, never touching
 * the program's active demand:
 *  - Pipeline source → add the volume straight onto it.
 *  - Active/inactive source → add onto its pipeline twin (item code `‹code›-P`).
 *    If the twin doesn't exist yet, return `needsDetails` so the caller can
 *    collect the item code + price, then call again with `create`.
 * Repeat inquiries accumulate onto the same twin, so a second additional inquiry
 * for the same program just adds to its pipeline line (no duplicate-code wall).
 *
 * RLS enforces edit access; writes fail cleanly if the caller can't.
 */
export async function saveInquiryToPipeline(
  planId: string,
  sourceProgramId: string,
  entries: InquiryEntry[],
  create?: { itemCode: string; price: number }
): Promise<SaveToPipelineResult> {
  if (!planId || !sourceProgramId) return { ok: false, error: 'Missing selection.' };
  const rows0 = cleanEntries(entries).filter((e) => e.demand_fp > 0);
  if (rows0.length === 0) return { ok: false, error: 'Enter an additional quantity for at least one month.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session expired. Sign in again.' };

  const { data: srcData } = await supabase
    .from('programs')
    .select(
      'id, item_code, item_description, customer, status, price_per_fp, ' +
        'primary_bucket_id, secondary_bucket_id, tertiary_bucket_id, primary_yield, secondary_yield, tertiary_yield'
    )
    .eq('id', sourceProgramId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!srcData) return { ok: false, error: 'Program not found.' };
  const source = srcData as unknown as {
    id: string; item_code: string; item_description: string; customer: string; status: string; price_per_fp: number;
    primary_bucket_id: string; secondary_bucket_id: string | null; tertiary_bucket_id: string | null;
    primary_yield: number; secondary_yield: number | null; tertiary_yield: number | null;
  };

  // Pipeline source: add straight onto it.
  if (source.status === 'pipeline') {
    const err = await accumulateDemand(supabase, planId, source.id, user.id, rows0);
    if (err) return { ok: false, error: permError(err) };
    await logAudit(supabase, { planId, entityType: 'demand_plan', entityId: source.id, action: 'update', changes: { saved_from: 'inquiry', months: rows0.length, additional: true } });
    revalidatePath('/demand-plan');
    revalidatePath('/programs');
    return { ok: true };
  }

  // Active/inactive source: find or create the pipeline twin.
  const twinCode = (create?.itemCode ?? `${source.item_code}-P`).trim();
  const { data: twin } = await supabase
    .from('programs')
    .select('id, status')
    .eq('plan_id', planId)
    .eq('item_code', twinCode)
    .is('deleted_at', null)
    .maybeSingle();

  let targetId: string;
  if (twin) {
    if ((twin as { status: string }).status !== 'pipeline') {
      return { ok: false, error: `Item code "${twinCode}" is already used by a non-pipeline program.` };
    }
    targetId = (twin as { id: string }).id;
  } else {
    if (!create) {
      return { ok: false, needsDetails: { suggestedItemCode: twinCode, price: Number(source.price_per_fp) } };
    }
    if (!(create.price > 0)) return { ok: false, error: 'Price must be greater than 0.' };
    const { data: last } = await supabase
      .from('programs').select('sort_order').eq('plan_id', planId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const sortOrder = ((last?.sort_order as number | undefined) ?? 0) + 10;
    const { data: createdTwin, error: ce } = await supabase
      .from('programs')
      .insert({
        plan_id: planId, status: 'pipeline', item_code: twinCode, item_description: source.item_description, customer: source.customer,
        max_monthly_demand_fp: 0,
        primary_bucket_id: source.primary_bucket_id, primary_yield: source.primary_yield,
        secondary_bucket_id: source.secondary_bucket_id, secondary_yield: source.secondary_yield,
        tertiary_bucket_id: source.tertiary_bucket_id, tertiary_yield: source.tertiary_yield,
        price_per_fp: create.price, sort_order: sortOrder, created_by: user.id, updated_by: user.id,
      })
      .select('id')
      .maybeSingle();
    if (ce) {
      const dup = /duplicate|unique|item_code/i.test(ce.message);
      return { ok: false, error: dup ? `Item code "${twinCode}" is already used in this plan.` : permError(ce.message) };
    }
    if (!createdTwin) return { ok: false, error: 'Could not create the pipeline program.' };
    targetId = createdTwin.id;
    await logAudit(supabase, { planId, entityType: 'programs', entityId: targetId, action: 'insert', changes: { item_code: twinCode, customer: source.customer, status: 'pipeline', saved_from: 'inquiry' } });
  }

  const err = await accumulateDemand(supabase, planId, targetId, user.id, rows0);
  if (err) return { ok: false, error: permError(err) };
  await logAudit(supabase, { planId, entityType: 'demand_plan', entityId: targetId, action: 'update', changes: { saved_from: 'inquiry', months: rows0.length, additional: true } });

  revalidatePath('/demand-plan');
  revalidatePath('/programs');
  return { ok: true };
}

export type SaveNewInquiryInput = {
  planId: string;
  customer: string;
  itemCode: string;
  itemDescription: string;
  pricePerFp: number;
  paths: { bucket_id: string; yield: number }[];
  entries: InquiryEntry[];
};

/**
 * Save a new-program inquiry: create a 'pipeline' program with the given
 * sourcing and price (baseline demand 0), then write the inquiry quantities as
 * per-month demand. Item code must be unique within the plan.
 */
export async function saveNewInquiry(input: SaveNewInquiryInput): Promise<SaveResult> {
  const customer = input.customer.trim();
  const itemCode = input.itemCode.trim();
  const itemDescription = input.itemDescription.trim();
  if (!input.planId) return { ok: false, error: 'Missing plan.' };
  if (!customer) return { ok: false, error: 'Customer is required.' };
  if (!itemCode) return { ok: false, error: 'Item code is required.' };
  if (!(input.pricePerFp > 0)) return { ok: false, error: 'Price must be greater than 0.' };

  const paths = input.paths.filter((p) => p.bucket_id && p.yield > 0 && p.yield <= 1);
  if (paths.length === 0) return { ok: false, error: 'Add at least one bucket with a yield between 0 and 1.' };

  const rows0 = cleanEntries(input.entries).filter((e) => e.demand_fp > 0);
  if (rows0.length === 0) return { ok: false, error: 'Enter a quantity for at least one month.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session expired. Sign in again.' };

  const { data: last } = await supabase
    .from('programs')
    .select('sort_order')
    .eq('plan_id', input.planId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((last?.sort_order as number | undefined) ?? 0) + 10;

  const { data: created, error: ce } = await supabase
    .from('programs')
    .insert({
      plan_id: input.planId,
      status: 'pipeline',
      item_code: itemCode,
      item_description: itemDescription || itemCode,
      customer,
      max_monthly_demand_fp: 0,
      primary_bucket_id: paths[0].bucket_id,
      primary_yield: paths[0].yield,
      secondary_bucket_id: paths[1]?.bucket_id ?? null,
      secondary_yield: paths[1]?.yield ?? null,
      tertiary_bucket_id: paths[2]?.bucket_id ?? null,
      tertiary_yield: paths[2]?.yield ?? null,
      price_per_fp: input.pricePerFp,
      sort_order: sortOrder,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .maybeSingle();

  if (ce) {
    const dup = /duplicate|unique|item_code/i.test(ce.message);
    return { ok: false, error: dup ? `Item code "${itemCode}" is already used in this plan.` : permError(ce.message) };
  }
  if (!created) return { ok: false, error: 'Could not create the program.' };

  const drows = rows0.map((e) => ({
    plan_id: input.planId, program_id: created.id, month_index: e.month_index, demand_fp: e.demand_fp,
    created_by: user.id, updated_by: user.id,
  }));
  const { error: de } = await supabase.from('demand_plan').upsert(drows, { onConflict: 'program_id,month_index' });
  if (de) return { ok: false, error: permError(de.message) };

  await logAudit(supabase, {
    planId: input.planId, entityType: 'programs', entityId: created.id, action: 'insert',
    changes: { item_code: itemCode, customer, status: 'pipeline', saved_from: 'inquiry' },
  });

  revalidatePath('/demand-plan');
  revalidatePath('/programs');
  return { ok: true };
}
