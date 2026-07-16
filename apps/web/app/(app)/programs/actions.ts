'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

export type ProgramFormState = { error: string | null; ok: boolean };

const REQUIRED_TEXT = ['item_code', 'item_description', 'customer'] as const;

/** Pull a numeric field; returns NaN if blank/unparseable so callers can validate. */
function num(fd: FormData, key: string): number {
  const raw = String(fd.get(key) ?? '').trim();
  if (raw === '') return NaN;
  return Number(raw);
}

/** Optional bucket select: '' → null. Optional yield: '' → null. */
function optionalPath(fd: FormData, bucketKey: string, yieldKey: string) {
  const bucketId = String(fd.get(bucketKey) ?? '').trim() || null;
  const y = String(fd.get(yieldKey) ?? '').trim();
  return { bucketId, yield: y === '' ? null : Number(y) };
}

/**
 * Create or update a program. `id` (hidden) present → update, absent → insert.
 * Validation mirrors the DB check constraints so the user gets a readable
 * message instead of a raw constraint violation. RLS still enforces access.
 */
export async function saveProgram(
  _prev: ProgramFormState,
  fd: FormData
): Promise<ProgramFormState> {
  const planId = String(fd.get('plan_id') ?? '').trim();
  const id = String(fd.get('id') ?? '').trim();
  if (!planId) return { error: 'Missing plan.', ok: false };

  for (const key of REQUIRED_TEXT) {
    if (!String(fd.get(key) ?? '').trim()) {
      return { error: `${key.replace(/_/g, ' ')} is required.`, ok: false };
    }
  }

  const maxDemand = num(fd, 'max_monthly_demand_fp');
  if (!Number.isFinite(maxDemand) || maxDemand < 0) {
    return { error: 'Max monthly demand must be zero or greater.', ok: false };
  }

  const primaryBucket = String(fd.get('primary_bucket_id') ?? '').trim();
  const primaryYield = num(fd, 'primary_yield');
  if (!primaryBucket) return { error: 'Primary bucket is required.', ok: false };
  if (!(primaryYield > 0 && primaryYield <= 1)) {
    return { error: 'Primary yield must be between 0 and 1.', ok: false };
  }

  const secondary = optionalPath(fd, 'secondary_bucket_id', 'secondary_yield');
  if (secondary.bucketId && !(Number(secondary.yield) > 0 && Number(secondary.yield) <= 1)) {
    return { error: 'Secondary yield must be between 0 and 1 when a secondary bucket is set.', ok: false };
  }
  const tertiary = optionalPath(fd, 'tertiary_bucket_id', 'tertiary_yield');
  if (tertiary.bucketId && !(Number(tertiary.yield) > 0 && Number(tertiary.yield) <= 1)) {
    return { error: 'Tertiary yield must be between 0 and 1 when a tertiary bucket is set.', ok: false };
  }

  const price = num(fd, 'price_per_fp');
  if (!(price > 0)) return { error: 'Price must be greater than 0.', ok: false };

  const costFields = [
    'barra_cost_wr', 'packing_cost_fp', 'processing_cost_fp',
    'storage_cost_fp', 'freight_cost_fp', 'other_costs_fp',
  ] as const;
  const costs: Record<string, number> = {};
  for (const key of costFields) {
    const v = num(fd, key);
    if (!Number.isFinite(v) || v < 0) {
      return { error: `${key.replace(/_/g, ' ')} must be zero or greater.`, ok: false };
    }
    costs[key] = v;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', ok: false };

  const row = {
    plan_id: planId,
    status: String(fd.get('status') ?? 'active'),
    item_code: String(fd.get('item_code')).trim(),
    item_description: String(fd.get('item_description')).trim(),
    customer: String(fd.get('customer')).trim(),
    max_monthly_demand_fp: maxDemand,
    primary_bucket_id: primaryBucket,
    primary_yield: primaryYield,
    secondary_bucket_id: secondary.bucketId,
    secondary_yield: secondary.bucketId ? secondary.yield : null,
    tertiary_bucket_id: tertiary.bucketId,
    tertiary_yield: tertiary.bucketId ? tertiary.yield : null,
    price_per_fp: price,
    locked: fd.get('locked') === 'on',
    ...costs,
    updated_by: user.id,
  };

  if (id) {
    const { error } = await supabase.from('programs').update(row).eq('id', id);
    if (error) return { error: friendly(error.message), ok: false };
    await logAudit(supabase, { planId, entityType: 'programs', entityId: id, action: 'update', changes: { item_code: row.item_code, customer: row.customer } });
  } else {
    // New programs sort after existing ones (gaps of 10, matching the seed).
    const { data: last } = await supabase
      .from('programs')
      .select('sort_order')
      .eq('plan_id', planId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = (last?.sort_order ?? 0) + 10;
    const { data: created, error } = await supabase
      .from('programs')
      .insert({ ...row, sort_order: sortOrder, created_by: user.id })
      .select('id')
      .maybeSingle();
    if (error) return { error: friendly(error.message), ok: false };
    if (created) await logAudit(supabase, { planId, entityType: 'programs', entityId: created.id, action: 'insert', changes: { item_code: row.item_code, customer: row.customer } });
  }

  revalidatePath('/programs');
  return { error: null, ok: true };
}

/** Soft-delete (archive) a program. Plain form action — no state needed. */
export async function archiveProgram(fd: FormData): Promise<void> {
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: before } = await supabase.from('programs').select('item_code, plan_id').eq('id', id).maybeSingle();
  await supabase
    .from('programs')
    .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', id);
  await logAudit(supabase, {
    planId: before?.plan_id ?? null,
    entityType: 'programs',
    entityId: id,
    action: 'delete',
    changes: { archived: true, item_code: before?.item_code },
  });
  revalidatePath('/programs');
}

export type ImportProgramRow = {
  status: string;
  item_code: string;
  item_description: string;
  customer: string;
  max_monthly_demand_fp: number;
  primary_bucket_id: string;
  primary_yield: number;
  secondary_bucket_id: string | null;
  secondary_yield: number | null;
  tertiary_bucket_id: string | null;
  tertiary_yield: number | null;
  price_per_fp: number;
  barra_cost_wr: number;
  packing_cost_fp: number;
  processing_cost_fp: number;
  storage_cost_fp: number;
  freight_cost_fp: number;
  other_costs_fp: number;
  locked: boolean;
};

export type ImportResult = { error: string | null; inserted: number; updated: number; skipped: number };

/**
 * Bulk import programs from CSV (rows already validated + bucket-resolved on the
 * client). New item_codes are inserted; existing ones are upserted by primary
 * key `id` — the (plan_id, item_code) index is partial, so it can't be an
 * ON CONFLICT target. Not transactional across the two statements (admin tool).
 */
export async function importPrograms(
  planId: string,
  rows: ImportProgramRow[],
  mode: 'upsert' | 'add_new'
): Promise<ImportResult> {
  if (!planId) return { error: 'Missing plan.', inserted: 0, updated: 0, skipped: 0 };
  if (!rows.length) return { error: 'No rows to import.', inserted: 0, updated: 0, skipped: 0 };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', inserted: 0, updated: 0, skipped: 0 };

  const { data: existing } = await supabase
    .from('programs')
    .select('id, item_code, sort_order')
    .eq('plan_id', planId)
    .is('deleted_at', null);

  const idByCode = new Map<string, string>();
  let maxSort = 0;
  for (const e of (existing ?? []) as { id: string; item_code: string; sort_order: number }[]) {
    idByCode.set(e.item_code, e.id);
    if (e.sort_order > maxSort) maxSort = e.sort_order;
  }

  const newPayload: Record<string, unknown>[] = [];
  const updatePayload: Record<string, unknown>[] = [];
  let skipped = 0;
  let sort = maxSort;

  for (const r of rows) {
    const existingId = idByCode.get(r.item_code);
    if (existingId) {
      if (mode === 'add_new') { skipped++; continue; }
      updatePayload.push({ id: existingId, plan_id: planId, ...fieldsOf(r), updated_by: user.id });
    } else {
      sort += 10;
      newPayload.push({ plan_id: planId, ...fieldsOf(r), sort_order: sort, created_by: user.id, updated_by: user.id });
    }
  }

  let inserted = 0;
  let updated = 0;
  if (newPayload.length) {
    const { error } = await supabase.from('programs').insert(newPayload);
    if (error) return { error: friendly(error.message), inserted: 0, updated: 0, skipped };
    inserted = newPayload.length;
  }
  if (updatePayload.length) {
    const { error } = await supabase.from('programs').upsert(updatePayload, { onConflict: 'id' });
    if (error) return { error: friendly(error.message), inserted, updated: 0, skipped };
    updated = updatePayload.length;
  }

  if (inserted || updated) await logAudit(supabase, { planId, entityType: 'programs', entityId: planId, action: 'update', changes: { imported_new: inserted, imported_updated: updated } });
  revalidatePath('/programs');
  return { error: null, inserted, updated, skipped };
}

function fieldsOf(r: ImportProgramRow) {
  return {
    status: r.status,
    item_code: r.item_code,
    item_description: r.item_description,
    customer: r.customer,
    max_monthly_demand_fp: r.max_monthly_demand_fp,
    primary_bucket_id: r.primary_bucket_id,
    primary_yield: r.primary_yield,
    secondary_bucket_id: r.secondary_bucket_id,
    secondary_yield: r.secondary_yield,
    tertiary_bucket_id: r.tertiary_bucket_id,
    tertiary_yield: r.tertiary_yield,
    price_per_fp: r.price_per_fp,
    barra_cost_wr: r.barra_cost_wr,
    packing_cost_fp: r.packing_cost_fp,
    processing_cost_fp: r.processing_cost_fp,
    storage_cost_fp: r.storage_cost_fp,
    freight_cost_fp: r.freight_cost_fp,
    other_costs_fp: r.other_costs_fp,
    locked: r.locked,
  };
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('duplicate') || m.includes('unique') || m.includes('item_code')) {
    return 'An item code must be unique within the plan. That code is already used.';
  }
  return message;
}
