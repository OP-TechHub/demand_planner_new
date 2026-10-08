import { compositeCostLkr, type CostComponentInput, type CostOverheadInput } from '@oceanpick/shared';

/**
 * The SKU dialog's form, read and validated — shared by the SKU master's save
 * and by a saved costing's own copy of a product, so the two can never drift
 * on what a valid recipe is. Moved out of the server-action module because
 * such a module may only export async functions.
 */

/** A marinade recipe as the dialog posts it: ingredients plus their divisor. */
export interface MarinadeRecipe {
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

/**
 * Read a composite SKU's per-batch overheads out of the form. Same shape and
 * the same three outcomes as the sub-products beside it.
 */
function batchOverheads(fd: FormData): CostOverheadInput[] | null | undefined | 'invalid' {
  const raw = fd.get('overheads');
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
  if (parsed.length > 50) return 'invalid';

  const clean: CostOverheadInput[] = [];
  for (const o of parsed) {
    if (typeof o !== 'object' || o === null) return 'invalid';
    const { name, amount_lkr: amount } = o as Record<string, unknown>;
    const cleanName = String(name ?? '').trim().slice(0, 200);
    if (!cleanName) return 'invalid';
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return 'invalid';
    clean.push({ name: cleanName, amount_lkr: amount });
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
 * Read the SKU form into the row it describes, or the first thing wrong with
 * it. The fish/marinade split is validated here as well as by a database
 * constraint and by the engine: Decisions §11 makes a broken split a hard stop
 * rather than a warning — a row that can't be costed shouldn't be storable.
 */
export function parseSkuForm(fd: FormData) {
  // Every early return below carries ok: false; the success at the end ok: true.
  const id = String(fd.get('id') ?? '').trim();
  const orgId = String(fd.get('org_id') ?? '').trim();
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required.', ok: false as const };

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
    return { error: 'Yield must be between 0 and 1 (0.45 = 45%).', ok: false as const };
  }
  if (pctFish == null || pctMarinade == null || pctFish < 0 || pctMarinade < 0) {
    return { error: '% fish and % marinade must be 0 or more.', ok: false as const };
  }
  if (Math.abs(pctFish + pctMarinade - 1) > 1e-6) {
    return {
      error: `% fish + % marinade must total 100% — currently ${((pctFish + pctMarinade) * 100).toFixed(2)}%.`,
      ok: false as const,
    };
  }
  // Blank reads as null here. With the glazed/not-glazed toggle the only way
  // to reach that is picking "Glazed" and leaving the box empty, so name that
  // rather than talking about a field the user never saw when unglazed.
  if (glazePct == null) {
    return { error: 'A glazed SKU needs a glaze percentage — 0.2 for 20% added ice.', ok: false as const };
  }
  if (glazePct < 0) return { error: 'Glaze % must be 0 or more.', ok: false as const };

  // Glaze is added ice, so a fresh product cannot carry any. Caught here as well
  // as by a check constraint, so the message names the fix rather than leaking
  // a constraint name.
  const productForm = String(fd.get('product_form') ?? 'both');
  if (productForm === 'fresh' && glazePct > 0) {
    return { error: 'Fresh product can’t carry glaze — glaze is added ice. Set glaze to 0, or make this frozen.', ok: false as const };
  }

  // "Other…" in the category dropdown reveals a free-text box; prefer it when
  // it has been filled in.
  const categoryOther = String(fd.get('category_other') ?? '').trim();
  const category = categoryOther || String(fd.get('category') ?? '').trim();

  const recipe = marinadeRecipe(fd);
  if (recipe === 'invalid') {
    return { error: 'The marinade ingredients could not be read. Reopen the marinade cost builder and apply it again.', ok: false as const };
  }

  // A composite SKU is costed from its sub-products, so it needs some — and,
  // unless it is sold by the kg, the weight of one unit, which is what turns
  // the per-unit total into the per-kg figure the adders and margins run on.
  const parts = subProducts(fd);
  if (parts === 'invalid') {
    return { error: 'The sub-products could not be read. Check each one has a name, a quantity and a price — and that any ingredient list says how many units it covers — then save again.', ok: false as const };
  }
  const unitLabel = String(fd.get('unit_label') ?? 'kg').trim().slice(0, 20) || 'kg';
  const unitWeightG = optionalNumber(fd, 'unit_weight_g');
  // Quantities and overheads are entered per batch; this is what a batch makes.
  // Absent or blank reads as 1 — entered per unit — which is what every
  // composite saved before batches existed already is.
  const batchRaw = String(fd.get('batch_units') ?? '').trim();
  const batchUnits = batchRaw === '' ? 1 : Number(batchRaw);
  const overheads = batchOverheads(fd);
  if (overheads === 'invalid') {
    return { error: 'The overheads could not be read. Check each one has a name and an amount, then save again.', ok: false as const };
  }
  if (composite && !(Number.isFinite(batchUnits) && batchUnits > 0)) {
    return { error: `Enter how many ${unitLabel === 'kg' ? 'kg' : `${unitLabel}s`} one batch makes — it must be more than 0. Use 1 if the quantities are for a single one.`, ok: false as const };
  }
  if (composite) {
    if (!parts || parts.length === 0) {
      return { error: 'A composite SKU needs at least one sub-product — add what goes into it, with a quantity and a price.', ok: false as const };
    }
    if (unitLabel !== 'kg' && !(typeof unitWeightG === 'number' && unitWeightG > 0)) {
      return {
        error: `Enter the net weight of one ${unitLabel} in grams. Processing, packing, freight and margins are per kg, so the weight is what connects them to a price per ${unitLabel}.`,
        ok: false as const,
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
      return { error: 'Name the primary ingredient this product is made from, e.g. wet swim bladder.', ok: false as const };
    }
    const scope = String(fd.get('market_scope') ?? 'both');
    const needsLkr = scope === 'domestic' || scope === 'both';
    const needsUsd = scope === 'export' || scope === 'both';
    if ((needsLkr && inputLkr == null) || (needsUsd && inputUsd == null)) {
      return {
        error: `${inputName} needs a cost per kg in every market this SKU sells in. Enter 0 if the main product has already paid for it.`,
        ok: false as const,
      };
    }
    if ((inputLkr ?? 0) < 0 || (inputUsd ?? 0) < 0) {
      return { error: 'The primary ingredient cost cannot be negative.', ok: false as const };
    }
  }

  const numeric = {
    marinade_usd_per_kg: requiredNumber(fd, 'marinade_usd_per_kg') ?? 0,
    process_usd_per_kg: requiredNumber(fd, 'process_usd_per_kg') ?? 0,
    packing_usd_per_kg: requiredNumber(fd, 'packing_usd_per_kg') ?? 0,
  };
  for (const [k, v] of Object.entries(numeric)) {
    if (v < 0) return { error: `${k.replace(/_/g, ' ')} cannot be negative.`, ok: false as const };
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
    // Inherits from the port rather than the version; blank follows the port.
    override_duty_levy_pct: optionalNumber(fd, 'override_duty_levy_pct'),
  };
  for (const m of ['override_rack_margin_pct', 'override_fob_margin_pct'] as const) {
    const v = overrides[m];
    if (typeof v === 'number' && v >= 1) {
      return { error: 'A margin override must be below 100% — price is cost ÷ (1 − margin).', ok: false as const };
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
        ok: false as const,
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
          batch_units: composite ? batchUnits : 1,
          composite_cost_lkr: parts ? compositeCostLkr(parts, composite ? batchUnits : 1, overheads ?? []) : null,
        }
      : {}),
    // The divisor lives on the SKU so the recipe can be replayed; null says the
    // marinade cost was typed rather than built. `undefined` is dropped from
    // the payload by the spread below, leaving what is stored untouched.
    ...(recipe === undefined ? {} : { marinade_total_dose_g: recipe === null ? null : recipe.total_dose_g }),
    ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v === undefined ? null : v])),
  };

  return { ok: true as const, id, orgId, payload, recipe, parts, overheads, touchesParts, composite, baseYield };
}
