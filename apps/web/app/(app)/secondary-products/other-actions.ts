'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { WideRow, WideImportResult } from '@/components/wide-grid-import';

export type OtherFormState = { error: string | null; ok: boolean };

/**
 * Create or update an "other product" — a traded line outside the harvest plan.
 * Admin only, enforced by RLS; the checks here are for a civil error message
 * rather than for safety.
 */
export async function saveOtherProduct(_prev: OtherFormState, fd: FormData): Promise<OtherFormState> {
  const id = String(fd.get('id') ?? '').trim();
  const orgId = String(fd.get('org_id') ?? '').trim();
  const name = String(fd.get('name') ?? '').trim();
  const unitLabel = String(fd.get('unit_label') ?? 'kg').trim() || 'kg';
  const unitCost = Number(String(fd.get('unit_cost') ?? '').trim());
  const unitRevenue = Number(String(fd.get('unit_revenue') ?? '').trim());
  const sortOrder = Number(String(fd.get('sort_order') ?? '0').trim());
  // Optional opening quantity: the months it applies to are filled in on save,
  // so a product can be entered complete without a second trip to Quantities.
  const rawQty = String(fd.get('quantity') ?? '').trim();
  const quantity = rawQty === '' ? null : Number(rawQty);
  const fromMonth = Number(String(fd.get('from_month') ?? '1').trim());
  const toMonth = Number(String(fd.get('to_month') ?? '1').trim());

  if (!name) return { error: 'Name is required.', ok: false };
  if (!Number.isFinite(unitCost) || unitCost < 0) return { error: 'Unit cost must be zero or greater.', ok: false };
  if (!Number.isFinite(unitRevenue) || unitRevenue < 0) return { error: 'Unit revenue must be zero or greater.', ok: false };
  if (!Number.isInteger(sortOrder)) return { error: 'Order must be a whole number.', ok: false };
  if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
    return { error: 'Quantity must be zero or greater.', ok: false };
  }
  if (quantity !== null && quantity > 0) {
    if (!Number.isInteger(fromMonth) || !Number.isInteger(toMonth) || fromMonth < 1 || toMonth > 60 || fromMonth > toMonth) {
      return { error: 'Pick a valid month range for the quantity.', ok: false };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', ok: false };

  const row = {
    name,
    unit_label: unitLabel,
    unit_cost: unitCost,
    unit_revenue: unitRevenue,
    sort_order: sortOrder,
    updated_by: user.id,
  };

  let productId = id;
  let productOrg = orgId;
  if (id) {
    const { error } = await supabase.from('other_products').update(row).eq('id', id);
    if (error) return { error: friendly(error.message), ok: false };
  } else {
    if (!orgId) return { error: 'Missing organization.', ok: false };
    const { data, error } = await supabase
      .from('other_products')
      .insert({ ...row, org_id: orgId, created_by: user.id })
      .select('id, org_id')
      .single();
    if (error) return { error: friendly(error.message), ok: false };
    productId = data.id;
    productOrg = data.org_id;
  }

  // Fills the chosen months and leaves every other month alone — this is a
  // shortcut into the quantity row, not a replacement for it.
  if (quantity !== null && quantity > 0 && productId) {
    const months = [];
    for (let m = fromMonth; m <= toMonth; m++) months.push({ product_id: productId, org_id: productOrg, month_index: m, quantity });
    const { error } = await supabase
      .from('other_product_months')
      .upsert(months, { onConflict: 'product_id,month_index' });
    if (error) return { error: error.message, ok: false };
  }

  revalidatePath('/secondary-products');
  return { error: null, ok: true };
}

/** Archive or restore an other product — soft-hide, so past figures stay traceable. */
export async function setOtherArchived(id: string, archived: boolean): Promise<{ error: string | null }> {
  if (!id) return { error: 'Missing product.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };
  const { error } = await supabase
    .from('other_products')
    .update({ is_archived: archived, updated_by: user.id })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/secondary-products');
  return { error: null };
}

/**
 * Replace a product's monthly quantities.
 *
 * The whole row is sent, so the months NOT sent are the months cleared — which
 * is why this deletes what isn't in the payload rather than upserting over it.
 * A quantity of zero is stored as no row at all: nothing planned and nothing
 * sold read the same on the grid, and it keeps the table to what was typed.
 */
export async function saveOtherQuantities(
  productId: string,
  orgId: string,
  quantities: { month_index: number; quantity: number }[]
): Promise<{ error: string | null }> {
  if (!productId) return { error: 'Missing product.' };
  if (!orgId) return { error: 'Missing organization.' };

  const rows = quantities.filter((q) => Number.isFinite(q.quantity) && q.quantity > 0);
  if (rows.some((q) => !Number.isInteger(q.month_index) || q.month_index < 1 || q.month_index > 60)) {
    return { error: 'Month out of range.' };
  }
  if (quantities.some((q) => !Number.isFinite(q.quantity) || q.quantity < 0)) {
    return { error: 'Quantities must be zero or greater.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };

  const keep = rows.map((q) => q.month_index);
  // Clear the months that are no longer in the row, then write the rest.
  const del = supabase.from('other_product_months').delete().eq('product_id', productId);
  const { error: delError } = keep.length
    ? await del.not('month_index', 'in', `(${keep.join(',')})`)
    : await del;
  if (delError) return { error: delError.message };

  if (rows.length) {
    const { error } = await supabase
      .from('other_product_months')
      .upsert(
        rows.map((q) => ({ product_id: productId, org_id: orgId, month_index: q.month_index, quantity: q.quantity })),
        { onConflict: 'product_id,month_index' }
      );
    if (error) return { error: error.message };
  }

  revalidatePath('/secondary-products');
  return { error: null };
}

function friendly(message: string): string {
  if (/other_products_unique_name/.test(message)) return 'A product with that name already exists.';
  if (/row-level security/i.test(message)) return 'Only an admin can change other products.';
  return message;
}

/**
 * Import monthly quantities from a wide CSV — one row per product, one column
 * per month, headed the way the grid heads them ("Apr 26").
 *
 * Cells present in the file are written; months the file leaves out are left
 * alone, so a file covering one year doesn't wipe the other four. Products are
 * matched on NAME, which is what the sheet carries and what the unique
 * constraint already guarantees within an org.
 */
export async function importOtherQuantities(orgId: string, rows: WideRow[]): Promise<WideImportResult> {
  if (!orgId) return { error: 'Missing organization.', count: 0, unknown: [] };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', count: 0, unknown: [] };

  const { data: products } = await supabase.from('other_products').select('id, name').eq('org_id', orgId);
  const idByName = new Map(
    ((products ?? []) as { id: string; name: string }[]).map((p) => [p.name.trim().toLowerCase(), p.id])
  );

  const upserts: Record<string, unknown>[] = [];
  const unknown = new Set<string>();
  for (const row of rows) {
    const pid = idByName.get(row.key.trim().toLowerCase());
    if (!pid) { unknown.add(row.key); continue; }
    for (const c of row.cells) {
      if (c.month < 1 || c.month > 60 || !Number.isFinite(c.value) || c.value < 0) continue;
      upserts.push({ product_id: pid, org_id: orgId, month_index: c.month, quantity: c.value });
    }
  }

  if (upserts.length) {
    const { error } = await supabase
      .from('other_product_months')
      .upsert(upserts, { onConflict: 'product_id,month_index' });
    if (error) return { error: friendly(error.message), count: 0, unknown: [...unknown] };
  }

  revalidatePath('/secondary-products');
  return { error: null, count: upserts.length, unknown: [...unknown] };
}
