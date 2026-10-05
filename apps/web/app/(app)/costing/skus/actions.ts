'use server';

import { revalidatePath } from 'next/cache';
import { compositeCostLkr, type CostComponentInput } from '@oceanpick/shared';
import { createClient } from '@/lib/supabase/server';

export type SkuFormState = { error: string | null; ok: boolean };

/** A marinade recipe as the dialog posts it: ingredients plus their divisor. */
interface MarinadeRecipe {
  total_dose_g: number;
  lines: { ingredient: string; qty_g: number; price_lkr_per_kg: number }[];
}

/**
 * Read the marinade recipe out of the form.
 *
 * Three outcomes, and the distinction between the last two matters:
 *   - a recipe          — replace whatever is stored
 *   - null              — the field was posted empty: this SKU has no recipe,
 *                         so clear any ingredients it used to have
 *   - undefined         — the field was absent entirely: leave the stored
 *                         recipe alone (no caller does this today, but a
 *                         partial form should never silently delete rows)
 *
 * Re-validated here rather than trusted: it arrives as a JSON string in a
 * hidden input, which is to say from the browser, which is to say from anyone.
 */
function marinadeRecipe(fd: FormData): MarinadeRecipe | null | undefined | 'invalid' {
  const raw = fd.get('marinade_recipe');
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (s === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return 'invalid';
  }
  if (typeof parsed !== 'object' || parsed === null) return 'invalid';

  const { total_dose_g: dose, lines } = parsed as Record<string, unknown>;
  if (typeof dose !== 'number' || !Number.isFinite(dose) || dose <= 0) return 'invalid';
  if (!Array.isArray(lines) || lines.length === 0) return 'invalid';
  // A recipe is a dozen rows in practice. The cap is only here so a crafted
  // payload can't turn one save into an unbounded insert.
  if (lines.length > 200) return 'invalid';

  const clean: MarinadeRecipe['lines'] = [];
  for (const l of lines) {
    if (typeof l !== 'object' || l === null) return 'invalid';
    const { ingredient, qty_g: qty, price_lkr_per_kg: price } = l as Record<string, unknown>;
    const name = String(ingredient ?? '').trim().slice(0, 200);
    if (!name) return 'invalid';
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) return 'invalid';
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return 'invalid';
    clean.push({ ingredient: name, qty_g: qty, price_lkr_per_kg: price });
  }
  return { total_dose_g: dose, lines: clean };
}

/**
 * Read a composite SKU's sub-products out of the form.
 *
 * Same three outcomes as the marinade recipe, for the same reasons: a list
 * (replace what is stored), null (posted empty — the SKU has none), undefined
 * (field absent — leave the stored rows alone). Re-validated here because it
 * arrives as JSON in a hidden input.
 */
function subProducts(fd: FormData): CostComponentInput[] | null | undefined | 'invalid' {
  const raw = fd.get('sub_products');
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (s === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return 'invalid';
  }
  if (!Array.isArray(parsed)) return 'invalid';
  if (parsed.length === 0) return null;
  // A pack is a handful of sub-products. The caps only stop a crafted payload
  // turning one save into an unbounded insert.
  if (parsed.length > 100) return 'invalid';

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

  const clean: CostComponentInput[] = [];
  for (const c of parsed) {
    if (typeof c !== 'object' || c === null) return 'invalid';
    const { name, qty, unit, price_lkr_per_unit: price, recipe } = c as Record<string, unknown>;
    const cleanName = String(name ?? '').trim().slice(0, 200);
    const cleanUnit = String(unit ?? '').trim().slice(0, 20) || 'kg';
    const q = num(qty);
    const p = num(price);
    if (!cleanName || q == null || p == null) return 'invalid';

    let cleanRecipe: CostComponentInput['recipe'] = null;
    if (recipe != null) {
      if (typeof recipe !== 'object') return 'invalid';
      const { output_qty: out, lines } = recipe as Record<string, unknown>;
      if (typeof out !== 'number' || !Number.isFinite(out) || out <= 0) return 'invalid';
      if (!Array.isArray(lines) || lines.length === 0 || lines.length > 200) return 'invalid';
      const cleanLines: NonNullable<CostComponentInput['recipe']>['lines'] = [];
      for (const l of lines) {
        if (typeof l !== 'object' || l === null) return 'invalid';
        const { ingredient, qty_g: g, price_lkr_per_kg: perKg } = l as Record<string, unknown>;
        const ing = String(ingredient ?? '').trim().slice(0, 200);
        const gq = num(g);
        const gp = num(perKg);
        if (!ing || gq == null || gp == null) return 'invalid';
        cleanLines.push({ ingredient: ing, qty_g: gq, price_lkr_per_kg: gp });
      }
      cleanRecipe = { output_qty: out, lines: cleanLines };
    }
    clean.push({ name: cleanName, qty: q, unit: cleanUnit, price_lkr_per_unit: p, recipe: cleanRecipe });
  }
  return clean;
}

/** Optional number field: blank means "inherit the global value". */
function optionalNumber(fd: FormData, key: string): number | null | undefined {
  const raw = fd.get(key);
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function requiredNumber(fd: FormData, key: string): number | null {
  const n = Number(String(fd.get(key) ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Create or update a costing SKU.
 *
 * The fish/marinade split is validated here as well as by a database constraint
 * and by the engine. Decisions §11 makes a broken split a hard stop rather than
 * a warning — a row that can't be costed shouldn't be storable.
 */
export async function saveCostSku(_prev: SkuFormState, fd: FormData): Promise<SkuFormState> {
  const id = String(fd.get('id') ?? '').trim();
  const orgId = String(fd.get('org_id') ?? '').trim();
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required.', ok: false };

  // Read first: a composite SKU has no yield, split or glaze to validate, and
  // the checks below must not reject it over fields it does not show.
  const basis = String(fd.get('raw_material_basis') ?? 'full_fish');
  const composite = basis === 'composite';

  // None of these mean anything on a composite, and the form does not show
  // them. Fixed at the neutral values the table's constraints accept, rather
  // than read from fields that are not there.
  const baseYield = composite ? 1 : requiredNumber(fd, 'base_yield');
  const pctFish = composite ? 1 : requiredNumber(fd, 'pct_fish');
  const pctMarinade = composite ? 0 : requiredNumber(fd, 'pct_marinade');
  // Glaze is added ice diluting a fish component; a composite has neither.
  const glazePct = composite ? 0 : requiredNumber(fd, 'glaze_pct');

  if (baseYield == null || baseYield <= 0 || baseYield > 1) {
    return { error: 'Yield must be between 0 and 1 (0.45 = 45%).', ok: false };
  }
  if (pctFish == null || pctMarinade == null || pctFish < 0 || pctMarinade < 0) {
    return { error: '% fish and % marinade must be 0 or more.', ok: false };
  }
  if (Math.abs(pctFish + pctMarinade - 1) > 1e-6) {
    return {
      error: `% fish + % marinade must total 100% — currently ${((pctFish + pctMarinade) * 100).toFixed(2)}%.`,
      ok: false,
    };
  }
  // Blank reads as null here. With the glazed/not-glazed toggle the only way
  // to reach that is picking "Glazed" and leaving the box empty, so name that
  // rather than talking about a field the user never saw when unglazed.
  if (glazePct == null) {
    return { error: 'A glazed SKU needs a glaze percentage — 0.2 for 20% added ice.', ok: false };
  }
  if (glazePct < 0) return { error: 'Glaze % must be 0 or more.', ok: false };

  // Glaze is added ice, so a fresh product cannot carry any. Caught here as well
  // as by a check constraint, so the message names the fix rather than leaking
  // a constraint name.
  const productForm = String(fd.get('product_form') ?? 'both');
  if (productForm === 'fresh' && glazePct > 0) {
    return { error: 'Fresh product can’t carry glaze — glaze is added ice. Set glaze to 0, or make this frozen.', ok: false };
  }

  // "Other…" in the category dropdown reveals a free-text box; prefer it when
  // it has been filled in.
  const categoryOther = String(fd.get('category_other') ?? '').trim();
  const category = categoryOther || String(fd.get('category') ?? '').trim();

  const recipe = marinadeRecipe(fd);
  if (recipe === 'invalid') {
    return { error: 'The marinade ingredients could not be read. Reopen the marinade cost builder and apply it again.', ok: false };
  }

  // A composite SKU is costed from its sub-products, so it needs some — and,
  // unless it is sold by the kg, the weight of one unit, which is what turns
  // the per-unit total into the per-kg figure the adders and margins run on.
  const parts = subProducts(fd);
  if (parts === 'invalid') {
    return { error: 'The sub-products could not be read. Check each one has a name, a quantity and a price — and that any ingredient list says how many units it covers — then save again.', ok: false };
  }
  const unitLabel = String(fd.get('unit_label') ?? 'kg').trim().slice(0, 20) || 'kg';
  const unitWeightG = optionalNumber(fd, 'unit_weight_g');
  if (composite) {
    if (!parts || parts.length === 0) {
      return { error: 'A composite SKU needs at least one sub-product — add what goes into it, with a quantity and a price.', ok: false };
    }
    if (unitLabel !== 'kg' && !(typeof unitWeightG === 'number' && unitWeightG > 0)) {
      return {
        error: `Enter the net weight of one ${unitLabel} in grams. Processing, packing, freight and margins are per kg, so the weight is what connects them to a price per ${unitLabel}.`,
        ok: false,
      };
    }
  }
  // Whether this save touches the sub-product columns and rows at all. Kept
  // off every other SKU's save so nothing but a composite depends on the
  // composite migration having been applied.
  const touchesParts =
    parts !== undefined && (composite || (parts?.length ?? 0) > 0 || fd.get('sub_products_stored') === '1');

  // A SKU built from something other than a whole fish needs a price for that
  // something, in the currency of every market it sells in. Zero is a valid
  // answer and is stored as zero — an input the main product already paid for
  // is genuinely free to this SKU — but a BLANK is an omission, and would
  // silently cost the product at nothing.
  const inputName = String(fd.get('primary_input_name') ?? '').trim();
  const inputLkr = optionalNumber(fd, 'primary_input_cost_lkr');
  const inputUsd = optionalNumber(fd, 'primary_input_cost_usd');
  if (basis === 'ingredient') {
    if (!inputName) {
      return { error: 'Name the primary ingredient this product is made from, e.g. wet swim bladder.', ok: false };
    }
    const scope = String(fd.get('market_scope') ?? 'both');
    const needsLkr = scope === 'domestic' || scope === 'both';
    const needsUsd = scope === 'export' || scope === 'both';
    if ((needsLkr && inputLkr == null) || (needsUsd && inputUsd == null)) {
      return {
        error: `${inputName} needs a cost per kg in every market this SKU sells in. Enter 0 if the main product has already paid for it.`,
        ok: false,
      };
    }
    if ((inputLkr ?? 0) < 0 || (inputUsd ?? 0) < 0) {
      return { error: 'The primary ingredient cost cannot be negative.', ok: false };
    }
  }

  const numeric = {
    marinade_usd_per_kg: requiredNumber(fd, 'marinade_usd_per_kg') ?? 0,
    process_usd_per_kg: requiredNumber(fd, 'process_usd_per_kg') ?? 0,
    packing_usd_per_kg: requiredNumber(fd, 'packing_usd_per_kg') ?? 0,
  };
  for (const [k, v] of Object.entries(numeric)) {
    if (v < 0) return { error: `${k.replace(/_/g, ' ')} cannot be negative.`, ok: false };
  }

  const overrides = {
    override_rack_margin_pct: optionalNumber(fd, 'override_rack_margin_pct'),
    override_fob_margin_pct: optionalNumber(fd, 'override_fob_margin_pct'),
    override_transport_lkr: optionalNumber(fd, 'override_transport_lkr'),
    override_cold_hold_lkr: optionalNumber(fd, 'override_cold_hold_lkr'),
    override_freight_to_port_usd: optionalNumber(fd, 'override_freight_to_port_usd'),
    override_cold_chain_usd: optionalNumber(fd, 'override_cold_chain_usd'),
    // Past FOB. Markups, not margins: they multiply a price rather than divide
    // into it, so unlike rack/FOB below they carry no upper bound.
    override_importer_clearing_pct: optionalNumber(fd, 'override_importer_clearing_pct'),
    override_importer_markup_pct: optionalNumber(fd, 'override_importer_markup_pct'),
    override_distributor_markup_pct: optionalNumber(fd, 'override_distributor_markup_pct'),
  };
  for (const m of ['override_rack_margin_pct', 'override_fob_margin_pct'] as const) {
    const v = overrides[m];
    if (typeof v === 'number' && v >= 1) {
      return { error: 'A margin override must be below 100% — price is cost ÷ (1 − margin).', ok: false };
    }
  }

  // A SKU priced on a target needs a target in the currency its market uses.
  // Checked here as well as by a constraint so the message says which box.
  const pricingMode = String(fd.get('pricing_mode') ?? 'margin');
  const marketScope = String(fd.get('market_scope') ?? 'both');
  const targetLkr = optionalNumber(fd, 'market_price_lkr');
  const targetUsd = optionalNumber(fd, 'market_price_usd');
  if (pricingMode === 'target') {
    const needsLkr = marketScope === 'domestic' || marketScope === 'both';
    const needsUsd = marketScope === 'export' || marketScope === 'both';
    const hasLkr = typeof targetLkr === 'number' && targetLkr > 0;
    const hasUsd = typeof targetUsd === 'number' && targetUsd > 0;
    if (!(needsLkr && hasLkr) && !(needsUsd && hasUsd)) {
      return {
        error:
          marketScope === 'export'
            ? 'Pricing on a target needs an export target price in USD.'
            : marketScope === 'domestic'
              ? 'Pricing on a target needs a domestic target price in LKR.'
              : 'Pricing on a target needs a target price — LKR for domestic, USD for export.',
        ok: false,
      };
    }
  }

  const payload = {
    name,
    customer: String(fd.get('customer') ?? '').trim(),
    status: String(fd.get('status') ?? 'active'),
    category,
    product_form: productForm,
    market_scope: marketScope,
    pricing_mode: pricingMode,
    glaze_pct: glazePct,
    base_yield: baseYield,
    pct_fish: pctFish,
    pct_marinade: pctMarinade,
    ...numeric,
    pack_size: String(fd.get('pack_size') ?? '').trim() || null,
    // Blank means "no port picked" — the editor then falls back to the first
    // active destination, which is what every SKU did before this was stored.
    default_destination_id: String(fd.get('default_destination_id') ?? '').trim() || null,
    // Blank is a real answer here, not a missing one: it is the flat reference
    // model, which is what every SKU was costed on before grades existed.
    default_bucket_id: String(fd.get('default_bucket_id') ?? '').trim() || null,
    raw_material_basis: basis,
    // Kept on the row when the basis moves away from 'ingredient' rather than
    // nulled: switching a SKU to full fish to see what it would cost should
    // not throw away the ingredient price on the way back.
    primary_input_name: inputName || null,
    primary_input_cost_lkr: inputLkr ?? null,
    primary_input_cost_usd: inputUsd ?? null,
    market_price_lkr: targetLkr ?? null,
    market_price_usd: targetUsd ?? null,
    // The sub-product total is worked out HERE, from the validated list, never
    // taken from the browser: it is the number the grid and the API cost from.
    // Per unit of finished product, in LKR.
    ...(touchesParts
      ? {
          unit_label: composite ? unitLabel : 'kg',
          unit_weight_g: composite && unitLabel !== 'kg' ? (unitWeightG ?? null) : null,
          composite_cost_lkr: parts ? compositeCostLkr(parts) : null,
        }
      : {}),
    // The divisor lives on the SKU so the recipe can be replayed; null says the
    // marinade cost was typed rather than built. `undefined` is dropped from
    // the payload by the spread below, leaving what is stored untouched.
    ...(recipe === undefined ? {} : { marinade_total_dose_g: recipe === null ? null : recipe.total_dose_g }),
    ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v === undefined ? null : v])),
  };

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
      const partsError = await writeSubProducts(supabase, id, parts ?? null);
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
      const partsError = await writeSubProducts(supabase, (created as { id: string }).id, parts ?? null);
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
  parts: CostComponentInput[] | null
): Promise<string | null> {
  const { error: delError } = await supabase.from('cost_sku_components').delete().eq('sku_id', skuId);
  if (delError) return `The SKU was saved, but its sub-products could not be updated: ${friendly(delError.message)}`;
  if (!parts || parts.length === 0) return null;

  const { data: inserted, error: insError } = await supabase
    .from('cost_sku_components')
    .insert(
      parts.map((p, i) => ({
        sku_id: skuId,
        sort_order: i * 10,
        name: p.name,
        qty: p.qty,
        unit: p.unit,
        // The sub-product's own price, exactly as typed. Its other ingredients
        // are added on top of it, never folded into it.
        price_lkr_per_unit: p.price_lkr_per_unit,
        // How many finished units the ingredient list covers; null = no list.
        recipe_output_qty: p.recipe ? p.recipe.output_qty : null,
      }))
    )
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
  if (m.includes('duplicate') || m.includes('unique')) {
    return 'A SKU with that name already exists.';
  }
  return message;
}
