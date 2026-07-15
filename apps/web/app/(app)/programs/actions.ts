'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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
    const { error } = await supabase
      .from('programs')
      .insert({ ...row, sort_order: sortOrder, created_by: user.id });
    if (error) return { error: friendly(error.message), ok: false };
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
  await supabase
    .from('programs')
    .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', id);
  revalidatePath('/programs');
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('duplicate') || m.includes('unique') || m.includes('item_code')) {
    return 'An item code must be unique within the plan. That code is already used.';
  }
  return message;
}
