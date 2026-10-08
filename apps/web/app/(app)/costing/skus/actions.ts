'use server';

import { revalidatePath } from 'next/cache';
import type { CostComponentInput, CostOverheadInput } from '@oceanpick/shared';
import { parseSkuForm, type MarinadeRecipe } from '@/lib/sku-form';
import { createClient } from '@/lib/supabase/server';

export type SkuFormState = { error: string | null; ok: boolean };


/**
 * Create or update a costing SKU.
 *
 * The fish/marinade split is validated here as well as by a database constraint
 * and by the engine. Decisions §11 makes a broken split a hard stop rather than
 * a warning — a row that can't be costed shouldn't be storable.
 */
export async function saveCostSku(_prev: SkuFormState, fd: FormData): Promise<SkuFormState> {
  const parsed = parseSkuForm(fd);
  if (!parsed.ok) return parsed;
  const { id, orgId, payload, recipe, parts, overheads, touchesParts, baseYield } = parsed;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', ok: false };

  if (id) {
    const { error } = await supabase
      .from('cost_skus')
      .update({ ...payload, updated_by: user.id })
      .eq('id', id);
    if (error) return { error: friendly(error.message), ok: false };

    const recipeError = await writeMarinadeLines(supabase, id, recipe);
    if (recipeError) return { error: recipeError, ok: false };
    if (touchesParts) {
      const partsError = await writeSubProducts(supabase, id, parts ?? null, overheads ?? []);
      if (partsError) return { error: partsError, ok: false };
    }
  } else {
    if (!orgId) return { error: 'Missing organization.', ok: false };
    // Land it at the END of the list. The dialog has no sort-order field, and
    // defaulting to 0 would put every new SKU above the seeded ones — the list
    // is read in workbook order, so a new addition belongs after it, not first.
    const { data: last } = await supabase
      .from('cost_skus')
      .select('sort_order')
      .eq('org_id', orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 10;
    const { data: created, error } = await supabase
      .from('cost_skus')
      .insert({ ...payload, org_id: orgId, sort_order: sortOrder, created_by: user.id, updated_by: user.id })
      .select('id')
      .single();
    if (error || !created) return { error: friendly(error?.message ?? 'Could not save.'), ok: false };

    const recipeError = await writeMarinadeLines(supabase, (created as { id: string }).id, recipe);
    if (recipeError) return { error: recipeError, ok: false };
    if (touchesParts) {
      const partsError = await writeSubProducts(supabase, (created as { id: string }).id, parts ?? null, overheads ?? []);
      if (partsError) return { error: partsError, ok: false };
    }

    // Seed per-bucket yields at the flat value, so a new SKU behaves like the
    // seeded ones the moment size grades are switched on (Decisions §6).
    const { data: buckets } = await supabase.from('cost_size_buckets').select('id').eq('org_id', orgId);
    const bucketRows = (buckets ?? []) as { id: string }[];
    if (bucketRows.length) {
      await supabase.from('cost_sku_bucket_yields').insert(
        bucketRows.map((b) => ({ sku_id: (created as { id: string }).id, bucket_id: b.id, yield_pct: baseYield }))
      );
    }
  }

  revalidatePath('/costing');
  revalidatePath('/costing/skus');
  return { error: null, ok: true };
}

/**
 * Replace a SKU's marinade ingredients with what the form posted.
 *
 * Delete-then-insert rather than a diff: the rows carry no meaning of their own
 * beyond their order, so matching them up to preserve ids would be bookkeeping
 * that buys nothing. Returns an error message, or null on success.
 *
 * Not a transaction — PostgREST has no way to make it one — so a failed insert
 * after a successful delete leaves the recipe empty while the SKU still claims
 * a total dose. The message says so rather than reporting a save that half
 * happened, and reopening the builder is enough to put it back.
 */
async function writeMarinadeLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
  skuId: string,
  recipe: MarinadeRecipe | null | undefined | 'invalid'
): Promise<string | null> {
  if (recipe === undefined || recipe === 'invalid') return null;

  const { error: delError } = await supabase.from('cost_sku_marinade_lines').delete().eq('sku_id', skuId);
  if (delError) return `The SKU was saved, but its marinade ingredients could not be updated: ${delError.message}`;

  if (recipe === null) return null;

  const { error: insError } = await supabase.from('cost_sku_marinade_lines').insert(
    recipe.lines.map((l, i) => ({
      sku_id: skuId,
      sort_order: i * 10,
      ingredient: l.ingredient,
      qty_g: l.qty_g,
      price_lkr_per_kg: l.price_lkr_per_kg,
    }))
  );
  if (insError) {
    return `The SKU was saved, but its marinade ingredients were not — reopen it and apply the marinade builder again. (${insError.message})`;
  }
  return null;
}

/**
 * Replace a composite SKU's sub-products with what the form posted.
 *
 * Delete-then-insert, like the marinade lines and for the same reason: the
 * rows mean nothing beyond their order. Deleting a sub-product takes its
 * ingredients with it (on delete cascade). Not a transaction, so a failure
 * part-way says exactly that rather than reporting a save that half happened.
 */
async function writeSubProducts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  skuId: string,
  parts: CostComponentInput[] | null,
  overheads: CostOverheadInput[]
): Promise<string | null> {
  const { error: delError } = await supabase.from('cost_sku_components').delete().eq('sku_id', skuId);
  if (delError) return `The SKU was saved, but its sub-products could not be updated: ${friendly(delError.message)}`;
  if (!parts || parts.length === 0) return null;

  // Overheads share the table: a flat amount per batch is a row of qty 1 at
  // that price, marked so it is never mistaken for something in the pack. They
  // sort after the sub-products and never carry an ingredient list.
  const overheadRows = overheads.map((o, j) => ({
    sku_id: skuId,
    sort_order: (parts.length + j) * 10,
    kind: 'overhead',
    name: o.name,
    qty: 1,
    unit: 'batch',
    price_lkr_per_unit: o.amount_lkr,
    recipe_output_qty: null,
  }));

  const { data: inserted, error: insError } = await supabase
    .from('cost_sku_components')
    .insert([
      ...parts.map((p, i) => ({
        sku_id: skuId,
        sort_order: i * 10,
        kind: 'component',
        name: p.name,
        qty: p.qty,
        unit: p.unit,
        // The sub-product's own price, exactly as typed. Its other ingredients
        // are added on top of it, never folded into it.
        price_lkr_per_unit: p.price_lkr_per_unit,
        // How many finished units the ingredient list covers; null = no list.
        recipe_output_qty: p.recipe ? p.recipe.output_qty : null,
      })),
      ...overheadRows,
    ])
    .select('id, sort_order');
  if (insError || !inserted) {
    return `The SKU was saved, but its sub-products were not — reopen it and save again. (${friendly(insError?.message ?? 'no rows returned')})`;
  }

  // Matched back by sort_order rather than by array position: an insert's
  // returned rows are not promised to come back in the order they were sent.
  const idByOrder = new Map((inserted as { id: string; sort_order: number }[]).map((r) => [r.sort_order, r.id]));
  const ingredientRows = parts.flatMap((p, i) =>
    (p.recipe?.lines ?? []).map((l, j) => ({
      component_id: idByOrder.get(i * 10)!,
      sort_order: j * 10,
      ingredient: l.ingredient,
      qty_g: l.qty_g,
      price_lkr_per_kg: l.price_lkr_per_kg,
    }))
  );
  if (ingredientRows.length === 0) return null;
  const { error: ingError } = await supabase.from('cost_sku_component_ingredients').insert(ingredientRows);
  if (ingError) {
    return `The SKU and its sub-products were saved, but their ingredient lists were not — reopen it and save again. (${friendly(ingError.message)})`;
  }
  return null;
}

/** Set one SKU's yield for one size grade (Decisions §6). */
export async function saveSkuBucketYield(
  skuId: string,
  bucketId: string,
  yieldPct: number
): Promise<{ error: string | null }> {
  if (!Number.isFinite(yieldPct) || yieldPct <= 0 || yieldPct > 1) {
    return { error: 'Yield must be between 0 and 1 (0.45 = 45%).' };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };

  const { error } = await supabase
    .from('cost_sku_bucket_yields')
    .upsert({ sku_id: skuId, bucket_id: bucketId, yield_pct: yieldPct, updated_by: user.id });
  if (error) return { error: error.message };

  revalidatePath('/costing');
  revalidatePath('/costing/skus');
  return { error: null };
}

/** Soft-delete a SKU. Saved costings keep their snapshot of it either way. */
export async function archiveCostSku(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('cost_skus')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/costing/skus');
  revalidatePath('/costing');
  return { error: null };
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('cost_skus_split_totals_100')) {
    return '% fish + % marinade must total 100%.';
  }
  if (m.includes('cost_skus_target_needs_a_price')) {
    return 'Pricing on a target needs a target price for the market this SKU sells in.';
  }
  if (m.includes('cost_skus_fresh_has_no_glaze')) {
    return 'Fresh product can’t carry glaze — glaze is added ice.';
  }
  // The composite basis, its columns and its tables all arrive in one
  // migration. Any of these means it has not been applied to this database.
  if (
    (m.includes('enum') && m.includes('composite')) ||
    m.includes('unit_label') ||
    m.includes('unit_weight_g') ||
    m.includes('composite_cost_lkr') ||
    m.includes('cost_sku_component')
  ) {
    return 'This database has not been updated for composite SKUs yet. Apply migration 20261005000001_costing_composite_basis.sql, then save again.';
  }
  // Batches and overheads arrived one migration later.
  if (m.includes('batch_units') || m.includes("'kind' column") || m.includes('column "kind"')) {
    return 'This database has not been updated for composite batches and overheads yet. Apply migration 20261006000001_costing_composite_batch.sql, then save again.';
  }
  if (m.includes('duplicate') || m.includes('unique')) {
    return 'A SKU with that name already exists.';
  }
  return message;
}
