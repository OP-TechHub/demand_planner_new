'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type SecondaryFormState = { error: string | null; ok: boolean };

/** Mirrors TOTAL_WR in the client — kept here so the action has no client import. */
const TOTAL_WR = '__total_wr__';

/**
 * Create or update a by-product definition (admin only — enforced by RLS).
 * `yield_pct` is entered as a percentage in the form and stored as a fraction,
 * so 2 on screen is 0.02 in the column the engine arithmetic reads.
 */
export async function saveSecondaryProduct(_prev: SecondaryFormState, fd: FormData): Promise<SecondaryFormState> {
  const id = String(fd.get('id') ?? '').trim();
  const orgId = String(fd.get('org_id') ?? '').trim();
  const sourceItemCode = String(fd.get('source_item_code') ?? '').trim();
  const name = String(fd.get('name') ?? '').trim();
  const yieldPct = Number(String(fd.get('yield_pct') ?? '').trim());
  const price = Number(String(fd.get('price_per_kg') ?? '').trim());
  const sortOrder = Number(String(fd.get('sort_order') ?? '0').trim());

  if (!sourceItemCode) return { error: 'Pick what this is recovered from.', ok: false };
  if (!name) return { error: 'Name is required.', ok: false };
  if (!Number.isFinite(yieldPct) || yieldPct <= 0 || yieldPct > 100) {
    return { error: 'Yield must be greater than 0 and at most 100%.', ok: false };
  }
  if (!Number.isFinite(price) || price < 0) return { error: 'Price must be zero or greater.', ok: false };
  if (!Number.isInteger(sortOrder)) return { error: 'Order must be a whole number.', ok: false };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', ok: false };

  // The form offers "whole fish" alongside the product list; it maps to the
  // total-WR basis, which the table stores with a null source product.
  const isTotal = sourceItemCode === TOTAL_WR;
  const row = {
    basis: isTotal ? 'total_wr' : 'program',
    source_item_code: isTotal ? null : sourceItemCode,
    name,
    yield_pct: yieldPct / 100,
    price_per_kg: price,
    sort_order: sortOrder,
    updated_by: user.id,
  };

  if (id) {
    const { error } = await supabase.from('secondary_products').update(row).eq('id', id);
    if (error) return { error: friendly(error.message), ok: false };
  } else {
    if (!orgId) return { error: 'Missing organization.', ok: false };
    const { error } = await supabase
      .from('secondary_products')
      .insert({ ...row, org_id: orgId, created_by: user.id });
    if (error) return { error: friendly(error.message), ok: false };
  }

  revalidatePath('/secondary-products');
  return { error: null, ok: true };
}

/** Archive or restore a by-product — soft-hide, so past definitions stay traceable. */
export async function setSecondaryArchived(id: string, archived: boolean): Promise<{ error: string | null }> {
  if (!id) return { error: 'Missing by-product.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };
  const { error } = await supabase
    .from('secondary_products')
    .update({ is_archived: archived, updated_by: user.id })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/secondary-products');
  return { error: null };
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('duplicate') || m.includes('unique')) {
    return 'That product already has a by-product with this name.';
  }
  if (m.includes('row-level security') || m.includes('violates row-level')) {
    return 'Only an admin can change by-product definitions.';
  }
  return message;
}
