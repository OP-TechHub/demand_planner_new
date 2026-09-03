// Costing for the machine-to-machine API (/api/v1/costing) — SERVER ONLY.
//
// `lib/costing.ts` cannot serve these routes: it loads through the cookie-bound
// Supabase client, and an API-key caller has no session to bind to. This module
// is the same load, done under the service role and scoped explicitly by
// org_id — the service client bypasses RLS, so that filter is the ONLY thing
// keeping one org's costs out of another org's API response. Every query here
// must carry it.
//
// The row -> engine adapters are shared with the UI (lib/costing-adapt.ts), so
// a price quoted over the API is computed by exactly the code that renders the
// grid. That is deliberate: the CRM must never see a number the planner would
// disagree with.
import type { createServiceClient } from '@/lib/supabase/service';
import { computeCost, type CostOutput, type DomesticOutput, type ExportOutput } from '@oceanpick/engine';
import type {
  CostAssumptionVersion,
  CostDestinationRate,
  CostDestinationRow,
  CostMarket,
  CostOdcComponentRow,
  CostSizeBucket,
  CostSkuBucketYield,
  CostSkuRow,
} from '@oceanpick/shared';
import { toAssumptions, toBucket, toDestination, toSku } from '@/lib/costing-adapt';

/** The service client, with its `demand_planner` schema typing preserved. */
type Svc = ReturnType<typeof createServiceClient>;

export interface ApiCostingContext {
  version: CostAssumptionVersion;
  odc: CostOdcComponentRow[];
  buckets: CostSizeBucket[];
  destinations: CostDestinationRow[];
  rates: Map<string, CostDestinationRate>;
  skus: CostSkuRow[];
  /** skuId -> bucketId -> yield */
  yields: Map<string, Record<string, number>>;
}

/**
 * Load an org's costing context at a given assumptions version (default: the
 * current one). Returns null when the module was never seeded for this org —
 * the route turns that into a 404 rather than an empty list, because an empty
 * list reads as "no SKUs" when the truth is "not set up".
 */
export async function loadApiCostingContext(
  svc: Svc,
  orgId: string,
  versionId?: string | null
): Promise<ApiCostingContext | null> {
  const [{ data: versions }, { data: buckets }, { data: destinations }, { data: skus }] = await Promise.all([
    svc.from('cost_assumption_versions').select('*').eq('org_id', orgId).order('version_no', { ascending: false }),
    svc.from('cost_size_buckets').select('*').eq('org_id', orgId).order('sort_order'),
    svc.from('cost_destinations').select('*').eq('org_id', orgId).eq('is_active', true).order('sort_order'),
    svc.from('cost_skus').select('*').eq('org_id', orgId).is('deleted_at', null).order('sort_order'),
  ]);

  const allVersions = (versions ?? []) as CostAssumptionVersion[];
  if (allVersions.length === 0) return null;

  const version = versionId
    ? allVersions.find((v) => v.id === versionId)
    : (allVersions.find((v) => v.is_current) ?? allVersions[0]);
  if (!version) return null;

  const skuRows = (skus ?? []) as CostSkuRow[];

  const [{ data: odc }, { data: rates }, { data: yields }] = await Promise.all([
    svc.from('cost_odc_components').select('*').eq('version_id', version.id).order('sort_order'),
    svc.from('cost_destination_rates').select('*').eq('version_id', version.id),
    // Scoped to this org's SKUs: the table has no org_id of its own, so without
    // the `in` it would read every org's yields under the service role.
    skuRows.length
      ? svc.from('cost_sku_bucket_yields').select('*').in('sku_id', skuRows.map((s) => s.id))
      : Promise.resolve({ data: [] as CostSkuBucketYield[] }),
  ]);

  const rateMap = new Map<string, CostDestinationRate>();
  for (const r of (rates ?? []) as CostDestinationRate[]) rateMap.set(r.destination_id, r);

  const yieldMap = new Map<string, Record<string, number>>();
  for (const y of (yields ?? []) as CostSkuBucketYield[]) {
    const existing = yieldMap.get(y.sku_id) ?? {};
    existing[y.bucket_id] = y.yield_pct;
    yieldMap.set(y.sku_id, existing);
  }

  return {
    version,
    odc: (odc ?? []) as CostOdcComponentRow[],
    buckets: (buckets ?? []) as CostSizeBucket[],
    destinations: (destinations ?? []) as CostDestinationRow[],
    rates: rateMap,
    skus: skuRows,
    yields: yieldMap,
  };
}

// --- The CRM-facing row ----------------------------------------------------

/**
 * One priced line. Deliberately NOT the engine's full output: feed cost, FCR,
 * whole-fish cost and the ODC build-up are all withheld. A salesperson needs to
 * know their floor and their room to move, which is `cost`, `margin_pct` and
 * `selling_price`; the inputs that reveal farm economics stay in the planner.
 */
export interface SkuPriceRow {
  sku_id: string;
  name: string;
  category: string;
  customer: string;
  pack_size: string | null;
  status: string;
  market: CostMarket;
  currency: 'LKR' | 'USD';
  /** Which physical state this price is for — the price genuinely differs. */
  state: 'unglazed' | 'glazed' | 'frozen' | 'frozen_glazed' | 'fresh';
  destination: { id: string; name: string } | null;
  /** Total cost per kg landed at the pricing point, BEFORE any margin. */
  cost: number;
  /** Gross margin realised at `selling_price`. Negative means below cost. */
  margin_pct: number | null;
  /**
   * What a kg of WHOLE ROUND fish earns, over what the farm spent growing it.
   *
   * Every conversion input is deducted, the result is scaled to round weight by
   * yield, the whole fish is charged once, and the remainder is taken over the
   * whole round cost — feed x FCR plus ODC. A return on the farm cost rather
   * than a share of revenue, so it is not capped at 1 and is NOT comparable to
   * `margin_pct`. Null for an absorbed by-product, which never paid for a fish.
   */
  whole_round_margin_pct: number | null;
  /** Rack rate (domestic) or FOB (export) — the target price when one is set. */
  selling_price: number;
  /**
   * Headroom per kg. For a normal SKU that is `selling_price - cost`: how far a
   * salesperson can discount before hitting the floor. For an absorbed
   * by-product (`pricing_basis: 'contribution'`) it is the engine's own figure,
   * measured against the MARKET price rather than a cost-plus one — those SKUs
   * carry no raw material cost and are priced on what the market bears, so a
   * cost-plus reading would be meaningless. Null when a by-product has no
   * market price set yet.
   */
  contribution_per_kg: number | null;
  /** 'margin' = cost-plus; 'target' = price named, margin derived. */
  pricing_mode: string;
  /** 'contribution' marks an absorbed by-product, where cost is a FLOOR. */
  pricing_basis: string;
  /**
   * Export sea/air freight per kg, beyond FOB. Null for domestic.
   *
   * Deliberately given as the freight figure rather than a finished CIF number:
   * the CRM's calculator recomputes the selling price as a salesperson moves
   * the margin, and a CIF sent from here would still reflect the ORIGINAL
   * price. Let the caller add it to whatever price it is showing:
   *   cif = selling_price + freight_per_kg
   */
  freight_per_kg: number | null;
}

/** Money to 2dp, ratios to 4 — enough for a quote, not a rounding argument. */
const money = (n: number) => Math.round(n * 100) / 100;
const ratio = (n: number | null) => (n === null ? null : Math.round(n * 10000) / 10000);

/**
 * Flatten one engine result into the rows the CRM shows.
 *
 * A glazed row is emitted only when the SKU actually carries glaze: at 0% it is
 * identical to the unglazed row, and two identical prices in a quote list is
 * how a salesperson loses confidence in the list. `product_form` likewise drops
 * states the SKU is never sold in.
 */
export function toPriceRows(
  sku: CostSkuRow,
  out: CostOutput,
  destination: CostDestinationRow | null
): SkuPriceRow[] {
  const dest = destination ? { id: destination.id, name: destination.name } : null;
  const base = {
    sku_id: sku.id,
    name: sku.name,
    category: sku.category,
    customer: sku.customer,
    pack_size: sku.pack_size,
    status: sku.status,
    pricing_mode: sku.pricing_mode,
    pricing_basis: out.pricingBasis,
    destination: dest,
  };

  const hasGlaze = sku.glaze_pct > 0;
  const rows: SkuPriceRow[] = [];

  const push = (
    state: SkuPriceRow['state'],
    market: CostMarket,
    currency: 'LKR' | 'USD',
    s: {
      finalCost: number;
      sellingPrice: number;
      marginPct: number | null;
      wholeRoundMarginPct: number | null;
      contributionPerKg: number | null;
    },
    freightPerKg: number | null
  ) => {
    rows.push({
      ...base,
      market,
      currency,
      state,
      cost: money(s.finalCost),
      margin_pct: ratio(s.marginPct),
      whole_round_margin_pct: ratio(s.wholeRoundMarginPct),
      selling_price: money(s.sellingPrice),
      contribution_per_kg:
        out.pricingBasis === 'contribution'
          ? (s.contributionPerKg === null ? null : money(s.contributionPerKg))
          : money(s.sellingPrice - s.finalCost),
      freight_per_kg: freightPerKg === null ? null : money(freightPerKg),
    });
  };

  if (out.result.market === 'domestic') {
    const r = out.result as DomesticOutput;
    push('unglazed', 'domestic', 'LKR', r.unglazed, null);
    if (hasGlaze && sku.product_form !== 'fresh') push('glazed', 'domestic', 'LKR', r.glazed, null);
  } else {
    const r = out.result as ExportOutput;
    if (sku.product_form !== 'fresh') {
      push('frozen', 'export', 'USD', r.frozenPlain, r.frozenPlain.freightPerKg);
      if (hasGlaze) push('frozen_glazed', 'export', 'USD', r.frozenGlazed, r.frozenGlazed.freightPerKg);
    }
    // Fresh flies rather than ships, so it carries the air rate, not the sea one.
    if (sku.product_form !== 'frozen') push('fresh', 'export', 'USD', r.fresh, r.fresh.freightPerKg);
  }

  return rows;
}

/**
 * Price every SKU in `skus` for one market, across the destinations given
 * (export) or once (domestic). SKUs the engine refuses to cost are reported
 * rather than silently dropped: a SKU missing from a quote list with no
 * explanation is worse than one flagged as broken.
 */
export function priceSkus(
  ctx: ApiCostingContext,
  skus: CostSkuRow[],
  market: CostMarket,
  destinations: CostDestinationRow[],
  bucket: CostSizeBucket | null
): { rows: SkuPriceRow[]; skipped: { sku_id: string; name: string; reason: string }[] } {
  const assumptions = toAssumptions(ctx.version, ctx.odc);
  const engineBucket = bucket ? toBucket(bucket) : null;
  const rows: SkuPriceRow[] = [];
  const skipped: { sku_id: string; name: string; reason: string }[] = [];

  // Export freight is part of finalCost, so with no destination there is no
  // price to quote. Say so once rather than returning an empty list, which
  // reads as "no SKUs" when the truth is "no ports configured".
  if (market === 'export' && destinations.length === 0) {
    for (const sku of skus) {
      if (sku.market_scope === 'domestic') continue;
      skipped.push({ sku_id: sku.id, name: sku.name, reason: 'No active export destination to price against.' });
    }
    return { rows, skipped };
  }

  for (const sku of skus) {
    // market_scope decides which grid a SKU belongs in; a domestic-only retail
    // bag has no export price to quote.
    if (sku.market_scope !== 'both' && sku.market_scope !== market) continue;

    const engineSku = toSku(sku, market, ctx.yields.get(sku.id));
    const targets = market === 'domestic' ? [null] : destinations;

    for (const d of targets) {
      const res = computeCost({
        market,
        assumptions,
        sku: engineSku,
        bucket: engineBucket,
        destination: d ? toDestination(d, ctx.rates.get(d.id)) : null,
      });
      if (!res.ok) {
        skipped.push({ sku_id: sku.id, name: sku.name, reason: res.issues.map((i) => i.message).join('; ') });
        continue;
      }
      rows.push(...toPriceRows(sku, res.value, d));
    }
  }

  return { rows, skipped };
}
