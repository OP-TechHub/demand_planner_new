import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { computeCost, type DomesticOutput, type ExportOutput } from '@oceanpick/engine';
import type {
  CostAssumptionVersion,
  CostCosting,
  CostCostingDestination,
  CostCostingLine,
  CostProductState,
} from '@oceanpick/shared';
import {
  applyOverrides,
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
import { CostingDetail, type RepricedLine } from './costing-detail';

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
      repriced={Object.fromEntries(repriced) as Record<string, RepricedLine>}
      showBaseCost={baseCost.canView}
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

    const destRow = line.destination_id ? ctx.destinations.find((d) => d.id === line.destination_id) : null;
    if (costing.market === 'export' && !destRow) continue;

    const result = computeCost({
      market: costing.market,
      assumptions,
      sku: toSku(skuRow, costing.market, ctx.yields.get(skuRow.id)),
      bucket,
      destination: destRow ? toDestination(destRow, ctx.rates.get(destRow.id)) : null,
    });
    if (!result.ok) continue;

    const absorbed = skuRow.raw_material_basis === 'absorbed';
    const marketPrice = costing.market === 'domestic' ? skuRow.market_price_lkr : skuRow.market_price_usd;
    const state = line.state as CostProductState;

    if (costing.market === 'domestic') {
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
