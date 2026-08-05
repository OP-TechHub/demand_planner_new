'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
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

/**
 * A pipeline program drawing from one of the inquiry's buckets — a candidate to
 * trim to free capacity. `demand` is the current effective demand per month.
 */
export type PipelineCandidate = {
  id: string;
  item_code: string;
  item_description: string;
  customer: string;
  primary_bucket_id: string;
  bucket_name: string;
  primary_yield: number;
  demand: Record<number, number>;
};

/**
 * Pipeline programs whose PRIMARY bucket is one the inquiry needs, over the
 * given months — the "make room" candidates. Restricted to the primary bucket
 * so the freed-WR estimate (trim ÷ primary_yield) is clean; the recompute gives
 * the exact figure.
 */
export async function getPipelineCandidates(
  planId: string,
  bucketIds: string[],
  monthIndices: number[]
): Promise<PipelineCandidate[]> {
  const buckets = [...new Set(bucketIds)].filter(Boolean);
  const months = [...new Set(monthIndices)].filter((m) => Number.isInteger(m) && m >= 1);
  if (!planId || buckets.length === 0 || months.length === 0) return [];

  const supabase = await createClient();
  const { data: progs } = await supabase
    .from('programs')
    .select('id, item_code, item_description, customer, primary_bucket_id, primary_yield, max_monthly_demand_fp')
    .eq('plan_id', planId)
    .eq('status', 'pipeline')
    .in('primary_bucket_id', buckets)
    .is('deleted_at', null)
    .order('sort_order');
  const rows = (progs ?? []) as {
    id: string; item_code: string; item_description: string; customer: string;
    primary_bucket_id: string; primary_yield: number; max_monthly_demand_fp: number;
  }[];
  if (rows.length === 0) return [];

  const [{ data: bucketRows }, { data: dem }] = await Promise.all([
    supabase.from('buckets').select('id, name').in('id', buckets),
    supabase.from('demand_plan').select('program_id, month_index, demand_fp').in('program_id', rows.map((r) => r.id)).in('month_index', months),
  ]);
  const nameById = new Map((bucketRows ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));
  const ovr = new Map<string, number>();
  for (const d of (dem ?? []) as { program_id: string; month_index: number; demand_fp: number }[]) {
    ovr.set(`${d.program_id}:${d.month_index}`, Number(d.demand_fp));
  }

  return rows.map((r) => {
    const baseline = Number(r.max_monthly_demand_fp);
    const demand: Record<number, number> = {};
    for (const m of months) demand[m] = ovr.get(`${r.id}:${m}`) ?? baseline;
    return {
      id: r.id, item_code: r.item_code, item_description: r.item_description, customer: r.customer,
      primary_bucket_id: r.primary_bucket_id, bucket_name: nameById.get(r.primary_bucket_id) ?? 'Bucket',
      primary_yield: Number(r.primary_yield), demand,
    };
  });
}

function cleanEntries(entries: InquiryEntry[]): InquiryEntry[] {
  return entries.filter(
    (e) => Number.isInteger(e.month_index) && e.month_index >= 1 && e.month_index <= 120 && Number.isFinite(e.demand_fp) && e.demand_fp >= 0
  );
}

export type SaveToPipelineResult = SaveResult & {
  /** Present when a new pipeline twin must be created and needs item code + price. */
  needsDetails?: { suggestedItemCode: string; price: number };
};

/**
 * Gate an inquiry save on the caller's INQUIRY access to the plan — separate
 * from full programs/demand editing, so a person can raise inquiries without
 * being able to edit the base plan. Allowed if: admin, the plan is their own
 * sandbox, or they hold the plan's 'inquiry' grant. Because inquiry-only users
 * won't have programs/demand grants, the actual writes then go through the
 * service role (RLS on those tables checks their own sections, not inquiry).
 */
async function assertInquiryAccess(planId: string): Promise<
  | { ok: true; rls: Awaited<ReturnType<typeof createClient>>; svc: ReturnType<typeof createServiceClient>; userId: string; orgId: string }
  | { ok: false; error: string }
> {
  const rls = await createClient();
  const { data: { user } } = await rls.auth.getUser();
  if (!user) return { ok: false, error: 'Your session expired. Sign in again.' };
  const { data: me } = await rls.from('users').select('role, org_id').eq('id', user.id).maybeSingle();
  if (!me) return { ok: false, error: 'Account not found.' };

  const svc = createServiceClient();
  const { data: plan } = await svc
    .from('plans').select('org_id, is_locked, is_sandbox, owner_user_id').eq('id', planId).is('deleted_at', null).maybeSingle();
  if (!plan || plan.org_id !== me.org_id) return { ok: false, error: 'Plan not found.' };
  if (plan.is_locked) return { ok: false, error: 'This plan is locked (read-only).' };

  let allowed = me.role === 'admin' || (plan.is_sandbox && plan.owner_user_id === user.id);
  if (!allowed) {
    const { data: g } = await svc
      .from('plan_editor_grants').select('section').eq('plan_id', planId).eq('user_id', user.id).eq('section', 'inquiry').maybeSingle();
    allowed = !!g;
  }
  if (!allowed) return { ok: false, error: 'You don’t have inquiry access to this plan.' };
  return { ok: true, rls, svc, userId: user.id, orgId: me.org_id as string };
}

/** Record a saved inquiry in the browsable register (best-effort — never blocks the save). */
async function recordInquiry(
  svc: ReturnType<typeof createServiceClient>,
  row: {
    orgId: string; planId: string; userId: string; kind: 'existing' | 'new';
    customer: string; itemCode: string; itemDescription: string;
    targetProgramId: string; entries: InquiryEntry[];
  }
): Promise<string | null> {
  try {
    const { data } = await svc.from('inquiries').insert({
      org_id: row.orgId, plan_id: row.planId, created_by: row.userId, kind: row.kind,
      customer: row.customer, item_code: row.itemCode, item_description: row.itemDescription,
      target_program_id: row.targetProgramId,
      months: row.entries.length,
      total_fp: row.entries.reduce((s, e) => s + e.demand_fp, 0),
    }).select('id').maybeSingle();
    return (data?.id as string | undefined) ?? null;
  } catch {
    // the register is a convenience log; a failure here must not fail the save
    return null;
  }
}

/** A pipeline program's reduced demand for some months, to free capacity. */
export type PipelineTrim = { programId: string; entries: InquiryEntry[] };

/** Per-program before→after detail of a trim, for the audit trail / undo. */
type TrimDetail = { programId: string; edits: { m: number; old: number; new: number }[] };

/**
 * Apply pipeline trims: SET each program's demand for the given months to the
 * reduced value, capturing the previous value per cell so the change can be shown
 * and later undone. Returns an error string (or null) plus the before→after detail.
 */
async function applyTrims(
  svc: ReturnType<typeof createServiceClient>,
  planId: string,
  userId: string,
  trims: PipelineTrim[] | undefined
): Promise<{ error: string | null; detail: TrimDetail[] }> {
  if (!trims?.length) return { error: null, detail: [] };
  const rows: Record<string, unknown>[] = [];
  const detail: TrimDetail[] = [];
  for (const t of trims) {
    if (!t.programId) continue;
    const clean = cleanEntries(t.entries);
    if (!clean.length) continue;
    const months = clean.map((e) => e.month_index);
    const { data: existing } = await svc
      .from('demand_plan')
      .select('month_index, demand_fp')
      .eq('program_id', t.programId)
      .in('month_index', months);
    const cur = new Map<number, number>((existing ?? []).map((r: { month_index: number; demand_fp: number }) => [r.month_index, Number(r.demand_fp)]));
    const edits: { m: number; old: number; new: number }[] = [];
    for (const e of clean) {
      const old = cur.get(e.month_index) ?? 0;
      if (old !== e.demand_fp) edits.push({ m: e.month_index, old, new: e.demand_fp });
      rows.push({ plan_id: planId, program_id: t.programId, month_index: e.month_index, demand_fp: e.demand_fp, created_by: userId, updated_by: userId });
    }
    if (edits.length) detail.push({ programId: t.programId, edits });
  }
  if (rows.length === 0) return { error: null, detail: [] };
  const { error } = await svc.from('demand_plan').upsert(rows, { onConflict: 'program_id,month_index' });
  return { error: error ? error.message : null, detail: error ? [] : detail };
}

/**
 * Log each pipeline trim as its own demand edit (with before→after values), so it
 * shows in the audit log per program and an admin can undo it within the window.
 * Uses the same {edits} shape as an ordinary demand edit, which the undo path
 * already recognises as reversible.
 */
async function logTrims(
  rls: unknown,
  planId: string,
  detail: TrimDetail[]
): Promise<void> {
  for (const d of detail) {
    await logAudit(rls, {
      planId, entityType: 'demand_plan', entityId: d.programId, action: 'update',
      changes: { edits: d.edits, set: d.edits.length, more: 0, trim_for_inquiry: true },
    });
  }
}

/**
 * Add `entries` (additional volume) onto a program's existing demand for those
 * months. Returns an error string (or null) plus the before→after per month, so
 * an inquiry add can be recorded as a reversible demand edit.
 */
async function accumulateDemand(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  planId: string,
  programId: string,
  userId: string,
  entries: InquiryEntry[]
): Promise<{ error: string | null; edits: { m: number; old: number; new: number }[] }> {
  const months = entries.map((e) => e.month_index);
  const { data: existing } = await supabase
    .from('demand_plan')
    .select('month_index, demand_fp')
    .eq('program_id', programId)
    .in('month_index', months);
  const cur = new Map<number, number>((existing ?? []).map((r: { month_index: number; demand_fp: number }) => [r.month_index, Number(r.demand_fp)]));
  const edits: { m: number; old: number; new: number }[] = [];
  const rows = entries.map((e) => {
    const old = cur.get(e.month_index) ?? 0;
    const next = old + e.demand_fp;
    if (next !== old) edits.push({ m: e.month_index, old, new: next });
    return { plan_id: planId, program_id: programId, month_index: e.month_index, demand_fp: next, created_by: userId, updated_by: userId };
  });
  const { error } = await supabase.from('demand_plan').upsert(rows, { onConflict: 'program_id,month_index' });
  return { error: error ? error.message : null, edits: error ? [] : edits };
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
  create?: { itemCode: string; price: number },
  trims?: PipelineTrim[]
): Promise<SaveToPipelineResult> {
  if (!planId || !sourceProgramId) return { ok: false, error: 'Missing selection.' };
  const rows0 = cleanEntries(entries).filter((e) => e.demand_fp > 0);
  if (rows0.length === 0) return { ok: false, error: 'Enter an additional quantity for at least one month.' };

  const access = await assertInquiryAccess(planId);
  if (!access.ok) return { ok: false, error: access.error };
  const { rls, svc: supabase, userId, orgId } = access;

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
    const acc = await accumulateDemand(supabase, planId, source.id, userId, rows0);
    if (acc.error) return { ok: false, error: permError(acc.error) };
    const te = await applyTrims(supabase, planId, userId, trims);
    if (te.error) return { ok: false, error: permError(te.error) };
    const inquiryId = await recordInquiry(supabase, { orgId, planId, userId, kind: 'existing', customer: source.customer, itemCode: source.item_code, itemDescription: source.item_description, targetProgramId: source.id, entries: rows0 });
    await logAudit(rls, { planId, entityType: 'demand_plan', entityId: source.id, action: 'update', changes: { saved_from: 'inquiry', additional: true, months: rows0.length, trimmed: te.detail.length, edits: acc.edits, set: acc.edits.length, more: 0, inquiry_add: true, inquiry_id: inquiryId } });
    await logTrims(rls, planId, te.detail);
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
  let createdNew = false;
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
        price_per_fp: create.price, sort_order: sortOrder, created_by: userId, updated_by: userId,
      })
      .select('id')
      .maybeSingle();
    if (ce) {
      const dup = /duplicate|unique|item_code/i.test(ce.message);
      return { ok: false, error: dup ? `Item code "${twinCode}" is already used in this plan.` : permError(ce.message) };
    }
    if (!createdTwin) return { ok: false, error: 'Could not create the pipeline program.' };
    targetId = createdTwin.id;
    createdNew = true;
  }

  const acc = await accumulateDemand(supabase, planId, targetId, userId, rows0);
  if (acc.error) return { ok: false, error: permError(acc.error) };
  const te = await applyTrims(supabase, planId, userId, trims);
  if (te.error) return { ok: false, error: permError(te.error) };
  const inquiryId = await recordInquiry(supabase, { orgId, planId, userId, kind: 'existing', customer: source.customer, itemCode: twinCode, itemDescription: source.item_description, targetProgramId: targetId, entries: rows0 });
  if (createdNew) {
    // Undo of a brand-new twin = archive it (its demand goes with it). One entry.
    await logAudit(rls, { planId, entityType: 'programs', entityId: targetId, action: 'insert', changes: { item_code: twinCode, customer: source.customer, status: 'pipeline', saved_from: 'inquiry', inquiry_id: inquiryId } });
  } else {
    // Undo of extra volume on an existing twin = subtract what was added.
    await logAudit(rls, { planId, entityType: 'demand_plan', entityId: targetId, action: 'update', changes: { saved_from: 'inquiry', additional: true, months: rows0.length, trimmed: te.detail.length, edits: acc.edits, set: acc.edits.length, more: 0, inquiry_add: true, inquiry_id: inquiryId } });
  }
  await logTrims(rls, planId, te.detail);

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
  trims?: PipelineTrim[];
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

  const access = await assertInquiryAccess(input.planId);
  if (!access.ok) return { ok: false, error: access.error };
  const { rls, svc: supabase, userId, orgId } = access;

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
      created_by: userId,
      updated_by: userId,
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
    created_by: userId, updated_by: userId,
  }));
  const { error: de } = await supabase.from('demand_plan').upsert(drows, { onConflict: 'program_id,month_index' });
  if (de) return { ok: false, error: permError(de.message) };

  const te = await applyTrims(supabase, input.planId, userId, input.trims);
  if (te.error) return { ok: false, error: permError(te.error) };

  const inquiryId = await recordInquiry(supabase, { orgId, planId: input.planId, userId, kind: 'new', customer, itemCode, itemDescription: itemDescription || itemCode, targetProgramId: created.id, entries: rows0 });
  await logAudit(rls, {
    planId: input.planId, entityType: 'programs', entityId: created.id, action: 'insert',
    changes: { item_code: itemCode, customer, status: 'pipeline', saved_from: 'inquiry', trimmed: te.detail.length, inquiry_id: inquiryId },
  });
  await logTrims(rls, input.planId, te.detail);

  revalidatePath('/demand-plan');
  revalidatePath('/programs');
  return { ok: true };
}
