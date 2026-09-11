'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  applyOverrides,
  getBaseCostAccess,
  isBaseCostField,
  loadCostingContext,
  toAssumptions,
  toBucket,
  toDestination,
  toSku,
  OVERRIDABLE,
  type CostingContext,
  type OverridableField,
} from '@/lib/costing';
import { computeCost, type DomesticOutput, type ExportOutput } from '@oceanpick/engine';
import type {
  CostCosting,
  CostDestinationRow,
  CostMarket,
  CostMarketScope,
  CostProductState,
  CostSkuRow,
  CostVisibility,
} from '@oceanpick/shared';

/**
 * Clean the per-costing assumption overrides posted from the browser.
 *
 * Unknown keys are dropped rather than trusted: this object is stored verbatim
 * and later merged over a version, so an unrecognised field would be dead
 * weight at best and a silent surprise at worst.
 *
 * A value equal to the version's own is NOT an override — recording it would
 * light the "custom assumptions" badge on a costing that deviates from nothing,
 * and worse, would freeze that field against a later official change while
 * claiming to be a deliberate choice.
 *
 * Base-cost fields are refused outright from a caller without the grant. You
 * cannot deviate from a number you are not allowed to read, and the browser
 * does not offer those fields — but the action is a public endpoint, and an
 * override reaches the engine, so a crafted request would otherwise move the
 * prices in a saved quote.
 */
function cleanOverrides(
  raw: Record<string, number> | undefined,
  version: Record<string, unknown>,
  canViewBaseCost: boolean
): { overrides: Record<string, number>; error: string | null } {
  const out: Record<string, number> = {};
  if (!raw) return { overrides: out, error: null };

  for (const field of OVERRIDABLE) {
    const v = raw[field];
    if (v == null) continue;
    if (!canViewBaseCost && isBaseCostField(field)) {
      return {
        overrides: {},
        error: 'The base fish cost and the other direct costs are restricted — ask an admin for access to override them.',
      };
    }
    if (!Number.isFinite(v) || v < 0) {
      return { overrides: {}, error: `${field.replace(/_/g, ' ')} must be a number of 0 or more.` };
    }
    // price = cost / (1 - margin), so 100% is a division by zero.
    if ((field === 'rack_margin_pct' || field === 'fob_margin_pct') && v >= 1) {
      return { overrides: {}, error: 'Rack and FOB margins must be below 100% — price is cost ÷ (1 − margin).' };
    }
    if (field === 'fcr_reference' || field === 'fx_rate' || field === 'container_fill_kg' || field === 'air_lot_kg') {
      if (v <= 0) return { overrides: {}, error: `${field.replace(/_/g, ' ')} must be greater than 0.` };
    }
    if (v !== version[field]) out[field] = v;
  }
  return { overrides: out, error: null };
}

export interface SaveCostingInput {
  name: string;
  market: CostMarket;
  versionId: string;
  bucketId: string | null;
  destinationIds: string[];
  skuIds: string[];
  notes?: string;
  /** Defaults to public — a costing is opted out of the shared list, not into it. */
  visibility?: CostVisibility;
  /**
   * Per-costing deviations from the pinned version, keyed by the column names
   * in OVERRIDABLE. Applied to the engine AND stored, so the costing reproduces
   * exactly and a reviewer can see what was changed (Decisions §4).
   */
  overrides?: Partial<Record<OverridableField, number>>;
}

/**
 * Snapshot the grid as a saved costing.
 *
 * The lines are RESOLVED and stored, not recomputed on read: reopening a costing
 * must show what was actually quoted, months later, whatever has happened to the
 * assumptions since (Costing_Module_Decisions.md §4). The version is pinned too,
 * so "reprice at current assumptions" has something to compare against.
 *
 * Deliberately recomputed here rather than trusting numbers posted from the
 * browser — the client grid is a view, not a source of truth.
 */
export async function saveCosting(input: SaveCostingInput): Promise<{ error: string | null; id?: string }> {
  const name = input.name.trim();
  if (!name) return { error: 'Give the costing a name.' };
  if (input.skuIds.length === 0) return { error: 'No SKUs to save.' };
  if (input.market === 'export' && input.destinationIds.length === 0) {
    return { error: 'Pick at least one destination before saving an export costing.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const ctx = await loadCostingContext(input.versionId);
  if (!ctx) return { error: 'Costing is not set up yet.' };

  // The overrides have to reach the ENGINE, not just the stored row. Recording
  // "this costing deviates on FX" while costing every line at the official FX
  // would make the badge a lie and the snapshot unreproducible.
  const { overrides, error: overrideError } = cleanOverrides(
    input.overrides,
    ctx.version as unknown as Record<string, unknown>,
    (await getBaseCostAccess()).canView
  );
  if (overrideError) return { error: overrideError };

  const assumptions = toAssumptions(applyOverrides(ctx.version, overrides), ctx.odc);
  const bucketRow = input.bucketId ? ctx.buckets.find((b) => b.id === input.bucketId) : null;
  const bucket = bucketRow ? toBucket(bucketRow) : null;

  const skus = ctx.skus.filter((s) => input.skuIds.includes(s.id));
  const dests = ctx.destinations.filter((d) => input.destinationIds.includes(d.id));

  const { data: costing, error: costingError } = await supabase
    .from('cost_costings')
    .insert({
      org_id: ctx.version.org_id,
      name,
      notes: input.notes ?? '',
      market: input.market,
      version_id: ctx.version.id,
      assumption_overrides: overrides,
      bucket_id: input.bucketId,
      destination_mode: dests.length > 1 ? 'multi' : 'single',
      visibility: input.visibility ?? 'public',
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single();

  if (costingError || !costing) return { error: costingError?.message ?? 'Could not create the costing.' };
  const costingId = (costing as { id: string }).id;

  if (dests.length > 0) {
    const { error } = await supabase.from('cost_costing_destinations').insert(
      dests.map((d, i) => ({
        costing_id: costingId,
        destination_id: d.id,
        destination_name: d.name,
        is_primary: i === 0,
        sort_order: (i + 1) * 10,
      }))
    );
    if (error) return { error: error.message };
  }

  const { lines, skipped } = resolveLines({
    ctx,
    costingId,
    market: input.market,
    assumptions,
    bucket,
    bucketId: input.bucketId,
    skus,
    dests,
    startSort: 0,
  });

  if (lines.length === 0) {
    await supabase.from('cost_costings').delete().eq('id', costingId);
    return { error: 'Nothing could be costed — every selected SKU has a broken fish/marinade split.' };
  }

  // Chunked: 34 SKUs x 3 states x several ports can exceed a comfortable insert.
  for (let i = 0; i < lines.length; i += 500) {
    const { error } = await supabase.from('cost_costing_lines').insert(lines.slice(i, i + 500));
    if (error) return { error: error.message };
  }

  revalidatePath('/costing/saved');
  return {
    error: skipped.length
      ? `Saved, but ${skipped.length} SKU(s) were left out for a broken split: ${skipped.join(', ')}`
      : null,
    id: costingId,
  };
}

/**
 * Copy someone else's costing so you can work from their numbers.
 *
 * The alternative to letting people edit each other's costings: a costing is a
 * record of what was quoted, so overwriting one destroys the answer to "who
 * sent this price and on what basis". Duplicating gives you their figures
 * without touching their record (Decisions §5).
 *
 * The copy keeps the ORIGINAL pinned assumptions version and the original
 * resolved lines — it is a copy, not a reprice. Use "reprice at current
 * assumptions" on the new one if you want today's numbers.
 */
export async function duplicateCosting(id: string): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const [{ data: sourceRow }, { data: destRows }, { data: lineRows }] = await Promise.all([
    supabase.from('cost_costings').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
    supabase.from('cost_costing_destinations').select('*').eq('costing_id', id).order('sort_order'),
    supabase.from('cost_costing_lines').select('*').eq('costing_id', id).order('sort_order'),
  ]);
  if (!sourceRow) return { error: 'That costing no longer exists.' };

  const source = sourceRow as {
    org_id: string;
    name: string;
    notes: string;
    market: string;
    version_id: string;
    assumption_overrides: Record<string, number>;
    bucket_id: string | null;
    destination_mode: string;
    visibility: CostVisibility;
  };

  const { data: copy, error } = await supabase
    .from('cost_costings')
    .insert({
      org_id: source.org_id,
      name: `${source.name} (copy)`,
      notes: source.notes,
      market: source.market,
      version_id: source.version_id,
      assumption_overrides: source.assumption_overrides,
      bucket_id: source.bucket_id,
      destination_mode: source.destination_mode,
      // A copy of a private costing stays private: the act of copying is not
      // the act of publishing, and the numbers came from someone else.
      visibility: source.visibility,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single();
  if (error || !copy) {
    return { error: error ? `Could not copy this costing: ${error.message}` : 'Could not copy the costing.' };
  }
  const newId = (copy as { id: string }).id;

  const dests = (destRows ?? []) as Record<string, unknown>[];
  if (dests.length) {
    const { error: destError } = await supabase.from('cost_costing_destinations').insert(
      dests.map((d) => ({
        costing_id: newId,
        destination_id: d.destination_id,
        destination_name: d.destination_name,
        is_primary: d.is_primary,
        sort_order: d.sort_order,
      }))
    );
    if (destError) return { error: destError.message };
  }

  const lines = (lineRows ?? []) as Record<string, unknown>[];
  for (let i = 0; i < lines.length; i += 500) {
    const { error: lineError } = await supabase.from('cost_costing_lines').insert(
      lines.slice(i, i + 500).map((l) => ({
        costing_id: newId,
        sku_id: l.sku_id,
        sku_name: l.sku_name,
        destination_id: l.destination_id,
        destination_name: l.destination_name,
        state: l.state,
        currency: l.currency,
        final_cost: l.final_cost,
        selling_price: l.selling_price,
        contribution_per_kg: l.contribution_per_kg,
        inputs: l.inputs,
        outputs: l.outputs,
        sort_order: l.sort_order,
      }))
    );
    if (lineError) return { error: lineError.message };
  }

  revalidatePath('/costing/saved');
  return { error: null, id: newId };
}

/**
 * Soft-delete a costing: stamp `deleted_at` so it leaves every list but stays
 * recoverable from the bin.
 *
 * Runs under the service role, for the same reason `restoreCosting` does. The
 * read policy on `cost_costings` carries `deleted_at is null`, so the instant
 * this statement stamps the row, the row stops satisfying that policy — and the
 * cookie-bound client cannot return a row it is no longer allowed to see. The
 * database reports that as
 *   new row violates row-level security policy for table "cost_costings"
 * which reads like a permission problem and is really a visibility one: the
 * write was allowed, the row just vanished underneath it.
 *
 * Bypassing RLS means the checks it would have made have to be made here
 * instead, and they are not optional:
 *   - the costing is read through the COOKIE client first, so a row the caller
 *     cannot see cannot be deleted, whatever id they post;
 *   - the caller must be its creator or an admin, which is what the update
 *     policy said;
 *   - every statement is filtered by org_id, which is what keeps one org out of
 *     another's data once the policy is out of the way.
 */
export async function deleteCosting(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  // Read as the caller: RLS decides here whether this costing exists for them.
  const { data: row } = await supabase
    .from('cost_costings')
    .select('id, org_id, created_by')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  const costing = row as { id: string; org_id: string; created_by: string } | null;
  if (!costing) return { error: 'That costing no longer exists.' };

  const { data: meRow } = await supabase.from('users').select('role, org_id').eq('id', user.id).maybeSingle();
  const me = meRow as { role: string; org_id: string } | null;
  if (!me) return { error: 'Your session expired. Sign in again.' };
  if (costing.created_by !== user.id && me.role !== 'admin') {
    return { error: 'Only the person who made a costing can delete it.' };
  }

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('cost_costings')
    .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', id)
    .eq('org_id', me.org_id)
    .is('deleted_at', null)
    .select('id');
  if (error) return { error: `Could not delete this costing: ${error.message}` };
  // Zero rows means someone else deleted it while this page was open.
  if (!data?.length) return { error: 'That costing has already been deleted — refresh the page.' };

  revalidatePath('/costing/saved');
  revalidatePath('/costing/archived');
  return { error: null };
}

/**
 * Publish a costing to the shared list, or pull it back to just you.
 *
 * RLS allows the write only for the creator or an admin, and the read policy
 * then does the hiding — so this is the whole of the feature on the write side.
 * Returns the row it changed, which is also how a caller learns the update was
 * refused: a policy denial comes back as zero rows, not as an error.
 */
export async function setCostingVisibility(
  id: string,
  visibility: CostVisibility
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const { data, error } = await supabase
    .from('cost_costings')
    .update({ visibility, updated_by: user.id })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id');
  if (error) return { error: `Could not change who sees this costing: ${error.message}` };
  if (!data?.length) return { error: 'Only the person who made a costing can change who sees it.' };

  revalidatePath('/costing/saved');
  revalidatePath(`/costing/saved/${id}`);
  return { error: null };
}

/**
 * Cost a set of SKUs into rows ready to store on a costing.
 *
 * Shared by the initial save and by adding a product to a costing later, so a
 * line added months afterwards is built exactly like the ones saved on day one:
 * the same states, the same snapshot fields, and the same refusal to store a
 * zero for a SKU whose fish/marinade split is broken.
 *
 * Each product is costed in ITS OWN market, so one costing can hold rupee
 * domestic lines beside dollar export ones. A product scoped to both follows
 * the costing's market — that is what the grid's toggle decides, and it is the
 * only sensible reading of "both".
 */
/**
 * Which market a product is costed in.
 *
 * A scope of 'both' is not a market, so it takes the costing's — everything
 * else is costed the way it was set up, whichever grid it was picked from.
 */
function marketForSku(scope: CostMarketScope, costingMarket: CostMarket): CostMarket {
  return scope === 'both' ? costingMarket : scope;
}

/** The one port an export product falls back to, as a single-element target list. */
function defaultDestFor(sku: CostSkuRow, ctx: CostingContext): (CostDestinationRow | null)[] {
  const preferred = sku.default_destination_id
    ? ctx.destinations.find((d) => d.id === sku.default_destination_id)
    : undefined;
  return [preferred ?? ctx.destinations[0] ?? null];
}

function resolveLines(args: {
  ctx: CostingContext;
  costingId: string;
  market: CostMarket;
  assumptions: ReturnType<typeof toAssumptions>;
  bucket: ReturnType<typeof toBucket> | null;
  bucketId: string | null;
  skus: CostSkuRow[];
  dests: CostDestinationRow[];
  /** Where this batch of lines slots into the existing sheet order. */
  startSort: number;
}): { lines: Record<string, unknown>[]; skipped: string[] } {
  const { ctx, costingId, market, assumptions, bucket, bucketId, skus, dests } = args;
  const lines: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  let sort = args.startSort;

  for (const skuRow of skus) {
    const skuMarket = marketForSku(skuRow.market_scope, market);
    const domesticSku = skuMarket === 'domestic';
    const engineSku = toSku(skuRow, skuMarket, ctx.yields.get(skuRow.id));

    // An export line needs a port. The costing's chosen ports are used when it
    // has any — that is how several ports get compared side by side — but a
    // domestic costing has none, so an export product falls back to the port it
    // is normally quoted to, and then to the first active one.
    const targets = domesticSku ? [null] : dests.length ? dests : defaultDestFor(skuRow, ctx);
    for (const dest of targets) {
      // Nowhere to ship it: no port on the costing and none active at all.
      if (!domesticSku && !dest) {
        skipped.push(skuRow.name);
        continue;
      }
      const result = computeCost({
        market: skuMarket,
        assumptions,
        sku: engineSku,
        bucket,
        destination: dest ? toDestination(dest, ctx.rates.get(dest.id)) : null,
      });

      // A SKU whose split is broken is not costed, so there is nothing honest to
      // snapshot for it — record the omission rather than storing a zero.
      if (!result.ok) {
        skipped.push(skuRow.name);
        continue;
      }

      const absorbed = skuRow.raw_material_basis === 'absorbed';
      const marketPrice = domesticSku ? skuRow.market_price_lkr : skuRow.market_price_usd;
      const common = {
        costing_id: costingId,
        sku_id: skuRow.id,
        sku_name: skuRow.name,
        destination_id: dest?.id ?? null,
        destination_name: dest?.name ?? null,
        currency: domesticSku ? 'LKR' : 'USD',
        inputs: {
          yield_used: result.value.result.chain.yieldUsed,
          glaze_pct: skuRow.glaze_pct,
          pct_fish: skuRow.pct_fish,
          pct_marinade: skuRow.pct_marinade,
          process_usd_per_kg: skuRow.process_usd_per_kg,
          packing_usd_per_kg: skuRow.packing_usd_per_kg,
          marinade_usd_per_kg: skuRow.marinade_usd_per_kg,
          raw_material_basis: skuRow.raw_material_basis,
          primary_input_name: skuRow.primary_input_name,
          primary_input_cost:
            skuRow.raw_material_basis === 'ingredient'
              ? domesticSku
                ? skuRow.primary_input_cost_lkr
                : skuRow.primary_input_cost_usd
              : null,
          // Which market the product was set up for, as against the market this
          // line was costed in. Snapshotted like everything else here: the
          // costing has to still read correctly once the SKU has been rescoped
          // or deleted.
          market_scope: skuRow.market_scope,
          bucket_id: bucketId,
        },
      };

      if (domesticSku) {
        const out = result.value.result as DomesticOutput;
        for (const [state, s] of [
          ['unglazed', out.unglazed],
          ['glazed', out.glazed],
        ] as [CostProductState, DomesticOutput['unglazed']][]) {
          lines.push({
            ...common,
            state,
            final_cost: s.finalCost,
            // Cost-plus for a normal SKU; what the market bears for a by-product,
            // whose cost is a floor rather than a base for margin (§7).
            // sellingPrice already resolves target-vs-cost-plus in the engine.
            selling_price: absorbed ? marketPrice : s.sellingPrice,
            contribution_per_kg: s.contributionPerKg,
            outputs: { ...s, chain: out.chain, wholeFish: result.value.wholeFish },
            sort_order: (sort += 10),
          });
        }
      } else {
        const out = result.value.result as ExportOutput;
        for (const [state, s] of [
          ['frozen_plain', out.frozenPlain],
          ['frozen_glazed', out.frozenGlazed],
          ['fresh', out.fresh],
        ] as [CostProductState, ExportOutput['frozenPlain']][]) {
          lines.push({
            ...common,
            state,
            final_cost: s.finalCost,
            selling_price: absorbed ? marketPrice : s.sellingPrice,
            contribution_per_kg: s.contributionPerKg,
            outputs: { ...s, chain: out.chain, destination: out.destination, wholeFish: result.value.wholeFish },
            sort_order: (sort += 10),
          });
        }
      }
    }
  }


  return { lines, skipped };
}

/**
 * Add products to a costing that has already been saved.
 *
 * The new lines are costed on the costing's OWN basis — its pinned assumptions
 * version, its stored overrides, its bucket, its ports — not on today's
 * numbers. A sheet whose products were priced off different assumptions would
 * not be a quote, and the reprice column would have nothing coherent to
 * compare against.
 *
 * RLS allows the insert only for the creator or an admin, and refuses anyone
 * else outright — the zero-row check after the insert is there for the case
 * where a policy change turns that refusal into a silent filter instead.
 */
export async function addSkusToCosting(
  costingId: string,
  skuIds: string[]
): Promise<{ error: string | null; added?: number }> {
  if (skuIds.length === 0) return { error: 'Pick at least one product to add.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const [{ data: costingRow }, { data: destRows }, { data: existingRows }] = await Promise.all([
    supabase.from('cost_costings').select('*').eq('id', costingId).is('deleted_at', null).maybeSingle(),
    supabase.from('cost_costing_destinations').select('destination_id').eq('costing_id', costingId),
    supabase.from('cost_costing_lines').select('sku_name, sort_order').eq('costing_id', costingId),
  ]);
  if (!costingRow) return { error: 'That costing no longer exists.' };
  const costing = costingRow as CostCosting;

  const ctx = await loadCostingContext(costing.version_id);
  if (!ctx) return { error: 'Costing is not set up yet.' };
  // loadCostingContext falls back to the current version when the one asked for
  // is gone. Silently costing on today's assumptions is exactly what this action
  // must not do, so the fallback is treated as a failure.
  if (ctx.version.id !== costing.version_id) {
    return { error: 'The assumptions version this costing was built on no longer exists.' };
  }

  const assumptions = toAssumptions(applyOverrides(ctx.version, costing.assumption_overrides), ctx.odc);
  const bucketRow = costing.bucket_id ? ctx.buckets.find((b) => b.id === costing.bucket_id) : null;
  const bucket = bucketRow ? toBucket(bucketRow) : null;

  const existing = (existingRows ?? []) as { sku_name: string; sort_order: number }[];
  // Products are identified by their snapshot name, which is what the unique
  // index on the lines keys on and what survives a SKU being deleted.
  const already = new Set(existing.map((l) => l.sku_name));

  // Market scope is not a gate. It says which grid a recipe was written for,
  // and the grid now offers both — so refusing here would mean a product you
  // could put on a costing when you built it could not be added to it later.
  // The engine costs any recipe in either market; what changes is which
  // currency's market price it reads, and a missing one shows as no price
  // rather than a wrong one.
  const skus = ctx.skus.filter((s) => skuIds.includes(s.id) && !already.has(s.name));
  if (skus.length === 0) return { error: 'Those products are already on this costing.' };

  const destIds = ((destRows ?? []) as { destination_id: string }[]).map((d) => d.destination_id);
  const dests = ctx.destinations.filter((d) => destIds.includes(d.id));
  // No hard refusal for a missing port any more: an export product falls back
  // to the one it is normally quoted to. Only a costing with no port to reach
  // at all is stuck, and resolveLines reports that per product rather than
  // failing the whole batch.
  if (costing.market === 'export' && dests.length === 0 && ctx.destinations.length === 0) {
    return { error: 'No active ports, so nothing can be costed for export.' };
  }

  const startSort = existing.reduce((max, l) => Math.max(max, l.sort_order), 0) + 10;
  const { lines, skipped } = resolveLines({
    ctx,
    costingId,
    market: costing.market,
    assumptions,
    bucket,
    bucketId: costing.bucket_id,
    skus,
    dests,
    startSort,
  });

  if (lines.length === 0) {
    return { error: 'Nothing could be costed — every product picked has a broken fish/marinade split.' };
  }

  for (let i = 0; i < lines.length; i += 500) {
    const { data, error } = await supabase
      .from('cost_costing_lines')
      .insert(lines.slice(i, i + 500))
      .select('id');
    if (error) return { error: error.message };
    if (!data?.length) return { error: 'Only the person who made a costing can change what is on it.' };
  }

  // Stamps updated_at through the touch trigger, so the sheet does not claim to
  // be untouched since the day it was saved.
  await supabase.from('cost_costings').update({ updated_by: user.id }).eq('id', costingId);

  revalidatePath('/costing/saved');
  revalidatePath(`/costing/saved/${costingId}`);
  // An export SKU that cannot be costed is recorded once per port, so what
  // actually went on is counted over distinct names, not over the entries.
  const left = [...new Set(skipped)];
  const added = skus.length - left.length;
  return {
    error: left.length
      ? `Added ${added}, but ${left.length} were left out for a broken fish/marinade split: ${left.join(', ')}`
      : null,
    added,
  };
}

/**
 * Take a product off a costing — every state and every port of it at once.
 *
 * Keyed by the snapshot name rather than the SKU id: that is what the lines'
 * unique index treats as one product within a costing, and it still resolves
 * when the underlying SKU has since been deleted and the id set to null.
 *
 * The last product cannot be removed. An empty costing is not a record of
 * anything, and a save is refused when nothing can be costed — deleting the
 * costing is the honest way to end up with none.
 */
export async function removeProductFromCosting(
  costingId: string,
  skuName: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };

  const { data: lineRows } = await supabase
    .from('cost_costing_lines')
    .select('sku_name')
    .eq('costing_id', costingId);
  const names = new Set(((lineRows ?? []) as { sku_name: string }[]).map((l) => l.sku_name));
  if (!names.has(skuName)) return { error: 'That product is not on this costing.' };
  if (names.size <= 1) {
    return { error: 'This is the only product left — delete the costing itself rather than emptying it.' };
  }

  const { data, error } = await supabase
    .from('cost_costing_lines')
    .delete()
    .eq('costing_id', costingId)
    .eq('sku_name', skuName)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'Only the person who made a costing can change what is on it.' };

  await supabase.from('cost_costings').update({ updated_by: user.id }).eq('id', costingId);

  revalidatePath('/costing/saved');
  revalidatePath(`/costing/saved/${costingId}`);
  return { error: null };
}
