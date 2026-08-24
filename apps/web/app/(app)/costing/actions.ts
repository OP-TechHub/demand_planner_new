'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { loadCostingContext, toAssumptions, toBucket, toDestination, toSku } from '@/lib/costing';
import { computeCost, type DomesticOutput, type ExportOutput } from '@oceanpick/engine';
import type { CostMarket, CostProductState } from '@oceanpick/shared';

export interface SaveCostingInput {
  name: string;
  market: CostMarket;
  versionId: string;
  bucketId: string | null;
  destinationIds: string[];
  skuIds: string[];
  notes?: string;
  overrides?: Record<string, number>;
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

  const assumptions = toAssumptions(ctx.version, ctx.odc);
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
      assumption_overrides: input.overrides ?? {},
      bucket_id: input.bucketId,
      destination_mode: dests.length > 1 ? 'multi' : 'single',
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

  const lines: Record<string, unknown>[] = [];
  let sort = 0;
  const skipped: string[] = [];

  for (const skuRow of skus) {
    const engineSku = toSku(skuRow, input.market, ctx.yields.get(skuRow.id));

    const targets = input.market === 'domestic' ? [null] : dests;
    for (const dest of targets) {
      const result = computeCost({
        market: input.market,
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
      const marketPrice = input.market === 'domestic' ? skuRow.market_price_lkr : skuRow.market_price_usd;
      const common = {
        costing_id: costingId,
        sku_id: skuRow.id,
        sku_name: skuRow.name,
        destination_id: dest?.id ?? null,
        destination_name: dest?.name ?? null,
        currency: input.market === 'domestic' ? 'LKR' : 'USD',
        inputs: {
          yield_used: result.value.result.chain.yieldUsed,
          glaze_pct: skuRow.glaze_pct,
          pct_fish: skuRow.pct_fish,
          pct_marinade: skuRow.pct_marinade,
          process_usd_per_kg: skuRow.process_usd_per_kg,
          packing_usd_per_kg: skuRow.packing_usd_per_kg,
          marinade_usd_per_kg: skuRow.marinade_usd_per_kg,
          raw_material_basis: skuRow.raw_material_basis,
          bucket_id: input.bucketId,
        },
      };

      if (input.market === 'domestic') {
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
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single();
  if (error || !copy) return { error: error?.message ?? 'Could not copy the costing.' };
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

/** Soft-delete a costing. RLS allows this only for its creator or an admin. */
export async function deleteCosting(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };

  const { error } = await supabase
    .from('cost_costings')
    .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/costing/saved');
  return { error: null };
}
