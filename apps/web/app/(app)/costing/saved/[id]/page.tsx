import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { computeCost, type DomesticOutput, type ExportOutput } from '@oceanpick/engine';
import {
  COST_CATEGORIES,
  type CostAssumptionVersion,
  type CostCosting,
  CostCostingDestination,
  CostCostingLine,
  CostProductState,
} from '@oceanpick/shared';
import {
  applyOverrides,
  forClient,
  getBaseCostAccess,
  loadCostingContext,
  stripBaseCostOutputs,
  stripBaseCostOverrides,
  toAssumptions,
  toBucket,
  toDestination,
  toSku,
} from '@/lib/costing';
import { getProfile } from '@/lib/plan';
import { CostingDetail, type AddableSku, type RepricedLine, type SavedCostingEditor } from './costing-detail';

/**
 * One saved costing, as sent — plus what it would cost at today's assumptions.
 *
 * The stored lines are shown verbatim; nothing is recomputed into them
 * (Decisions §4). The reprice is calculated alongside and shown as a delta, so
 * "what did we quote" and "what would we quote now" are both answerable without
 * either overwriting the other.
 */
export default async function SavedCostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: costingRow }, { data: lineRows }, { data: destRows }] = await Promise.all([
    supabase.from('cost_costings').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
    supabase.from('cost_costing_lines').select('*').eq('costing_id', id).order('sort_order'),
    supabase.from('cost_costing_destinations').select('*').eq('costing_id', id).order('sort_order'),
  ]);

  if (!costingRow) notFound();
  const costing = costingRow as CostCosting;
  const lines = (lineRows ?? []) as CostCostingLine[];
  const destinations = (destRows ?? []) as CostCostingDestination[];

  const [{ data: pinnedRow }, { data: authorRow }, current, baseCost] = await Promise.all([
    supabase.from('cost_assumption_versions').select('*').eq('id', costing.version_id).maybeSingle(),
    supabase.from('users').select('full_name').eq('id', costing.created_by).maybeSingle(),
    loadCostingContext(),
    getBaseCostAccess(),
  ]);

  const profile = await getProfile();
  const canEdit = costing.created_by === profile?.id || profile?.role === 'admin';

  const pinned = pinnedRow as CostAssumptionVersion | null;
  const authorName = (authorRow as { full_name: string } | null)?.full_name ?? 'Unknown';

  const repriced = current ? reprice(costing, lines, current) : new Map<string, number>();

  // The full SKU form, run on this costing. It costs in the browser, so it is
  // handed the costing's PINNED assumptions (with the costing's own overrides
  // laid over them), masked the way the SKU page masks them. Only for someone
  // who may change the costing, and only while the pinned version exists —
  // the context falls back to the current one otherwise, which is exactly
  // what a saved costing must never be re-costed on.
  const pinnedCtx = canEdit ? await loadCostingContext(costing.version_id) : null;
  const editor: SavedCostingEditor | null =
    pinnedCtx && pinnedCtx.version.id === costing.version_id
      ? {
          orgId: costing.org_id,
          ...forClient(
            { version: applyOverrides(pinnedCtx.version, costing.assumption_overrides), odc: pinnedCtx.odc },
            baseCost
          ),
          buckets: pinnedCtx.buckets,
          destinations: pinnedCtx.destinations,
          rates: Object.fromEntries(
            [...pinnedCtx.rates.entries()].map(([rid, r]) => [
              rid,
              { sea: r.sea_rate_per_20ft, air: r.air_rate_per_lot, duty: r.duty_levy_pct ?? null },
            ])
          ),
          skus: pinnedCtx.skus,
          categories: [...new Set([...COST_CATEGORIES, ...pinnedCtx.skus.map((s) => s.category).filter(Boolean)])],
          marinadeLines: Object.fromEntries(pinnedCtx.marinadeLines.entries()),
          components: Object.fromEntries(pinnedCtx.components.entries()),
          overheads: Object.fromEntries(pinnedCtx.overheads.entries()),
          knownIngredients: knownIngredientsOf(pinnedCtx.marinadeLines, pinnedCtx.components),
        }
      : null;

  // What the owner may still add. Products already on the sheet are excluded by
  // their snapshot name — that is what the lines are keyed on, and it is what a
  // second copy of the same product would collide with. Archived SKUs are left
  // out: costing on a recipe that has been retired is how a stale price gets
  // quoted. The list is version-independent, so reading it off the current
  // context is safe even though the lines are costed on the pinned one.
  //
  // Both markets are offered, as the grid now offers them: a market scope says
  // which grid a recipe was written for, not which costing it may go on. The
  // scope travels with each entry so the dialog can mark the ones set up for
  // the other market.
  const onCosting = new Set(lines.map((l) => l.sku_name));
  const addable: AddableSku[] =
    canEdit && current
      ? current.skus
          .filter((s) => s.status === 'active' && !onCosting.has(s.name))
          .map((s) => ({
            id: s.id,
            name: s.name,
            category: s.category,
            customer: s.customer,
            scope: s.market_scope,
          }))
      : [];

  // The reprice above uses the real assumptions — it runs here, on the server.
  // What goes to the browser is the costing without its base-cost content: the
  // stored whole-fish build-up on each line, and any override of a base-cost
  // field, both of which state the numbers outright.
  const shown = baseCost.canView
    ? costing
    : { ...costing, assumption_overrides: stripBaseCostOverrides(costing.assumption_overrides) };
  const shownLines = baseCost.canView
    ? lines
    : lines.map((l) => ({ ...l, outputs: stripBaseCostOutputs(l.outputs) }) as CostCostingLine);

  return (
    <CostingDetail
      costing={shown}
      lines={shownLines}
      destinations={destinations}
      pinnedLabel={pinned ? `v${pinned.version_no}${pinned.label ? ` · ${pinned.label}` : ''}` : 'unknown version'}
      pinnedIsCurrent={pinned?.is_current ?? false}
      currentLabel={
        current ? `v${current.version.version_no}${current.version.label ? ` · ${current.version.label}` : ''}` : null
      }
      authorName={authorName}
      canEdit={canEdit}
      addable={addable}
      repriced={Object.fromEntries(repriced) as Record<string, RepricedLine>}
      showBaseCost={baseCost.canView}
      editor={editor}
      // The grade this costing was built at, for the sheet. Grades are
      // org-level and rarely renamed, so the current context's label serves
      // lines saved before the grade was snapshotted with them.
      gradeLabel={
        current && costing.bucket_id ? (current.buckets.find((b) => b.id === costing.bucket_id)?.label ?? null) : null
      }
    />
  );
}

/**
 * Recompute each saved line at the CURRENT assumptions.
 *
 * Skips a line whose SKU has since been archived — there is no honest way to
 * reprice a recipe that no longer exists, and showing a stale number as if it
 * were current would be worse than showing nothing.
 */
function reprice(
  costing: CostCosting,
  lines: CostCostingLine[],
  ctx: NonNullable<Awaited<ReturnType<typeof loadCostingContext>>>
): Map<string, RepricedLine> {
  const out = new Map<string, RepricedLine>();
  const version = applyOverrides(ctx.version, costing.assumption_overrides);
  const assumptions = toAssumptions(version, ctx.odc);
  const bucketRow = costing.bucket_id ? ctx.buckets.find((b) => b.id === costing.bucket_id) : null;
  const bucket = bucketRow ? toBucket(bucketRow) : null;

  for (const line of lines) {
    if (!line.sku_id) continue;
    const skuRow = ctx.skus.find((s) => s.id === line.sku_id);
    if (!skuRow) continue;

    // The line's own market, read off the currency it was saved in. A costing
    // can hold both, so the costing's market says nothing about this line.
    const lineDomestic = line.currency === 'LKR';
    const lineMarket = lineDomestic ? 'domestic' : 'export';

    const destRow = line.destination_id ? ctx.destinations.find((d) => d.id === line.destination_id) : null;
    if (!lineDomestic && !destRow) continue;

    const result = computeCost({
      market: lineMarket,
      assumptions,
      sku: toSku(skuRow, lineMarket, ctx.yields.get(skuRow.id)),
      bucket,
      destination: destRow ? toDestination(destRow, ctx.rates.get(destRow.id)) : null,
    });
    if (!result.ok) continue;

    const absorbed = skuRow.raw_material_basis === 'absorbed';
    const marketPrice = lineDomestic ? skuRow.market_price_lkr : skuRow.market_price_usd;
    const state = line.state as CostProductState;

    if (lineDomestic) {
      const o = result.value.result as DomesticOutput;
      const s = state === 'glazed' ? o.glazed : o.unglazed;
      out.set(line.id, {
        finalCost: s.finalCost,
        sellingPrice: absorbed ? marketPrice : s.rackRate,
      });
    } else {
      const o = result.value.result as ExportOutput;
      const s = state === 'frozen_glazed' ? o.frozenGlazed : state === 'fresh' ? o.fresh : o.frozenPlain;
      out.set(line.id, {
        finalCost: s.finalCost,
        sellingPrice: absorbed ? marketPrice : s.fob,
      });
    }
  }
  return out;
}

/**
 * Every marinade ingredient anyone has priced, with its most recent price —
 * what the marinade builder offers as you type. The same rule the SKUs page
 * applies: last entry wins, names matched case-insensitively.
 */
function knownIngredientsOf(
  marinadeLines: Map<string, { ingredient: string; price_lkr_per_kg: number }[]>,
  components: Map<string, { recipe?: { lines: { ingredient: string; price_lkr_per_kg: number }[] } | null }[]>
): { name: string; price: number }[] {
  const byKey = new Map<string, { name: string; price: number }>();
  const note = (ingredient: string, price: number) => {
    const key = ingredient.trim().toLowerCase();
    if (!key) return;
    const seen = byKey.get(key);
    byKey.set(key, { name: seen?.name ?? ingredient.trim(), price });
  };
  for (const lines of marinadeLines.values()) for (const l of lines) note(l.ingredient, l.price_lkr_per_kg);
  for (const parts of components.values()) {
    for (const p of parts) for (const l of p.recipe?.lines ?? []) note(l.ingredient, l.price_lkr_per_kg);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
