// SKU cost chain, glaze, and the domestic / export value chains.
// Decisions §3 (markets), §6 (buckets), §7 (by-products), §8 (overrides), §11.
import type {
  CostChain,
  CostInput,
  CostIssue,
  CostResult,
  CostSku,
  Destination,
  DomesticOutput,
  DomesticState,
  ExportOutput,
  ExportState,
  SizeBucket,
} from './types';
import { wholeFishCost } from './whole-fish';

/** Float slack for the fish/marinade split. 0.82 + 0.18 is not exactly 1 in IEEE754. */
const SPLIT_EPSILON = 1e-9;

/**
 * The yield to cost at: the bucket's entry if the farm has supplied one, else
 * the SKU's flat value. While buckets are off, this is always the flat value —
 * which is what makes "switching them on" a data change, not an engine change.
 */
export function resolveYield(sku: CostSku, bucket?: SizeBucket | null): number {
  if (!bucket) return sku.baseYield;
  const y = sku.bucketYields?.[bucket.id];
  return y != null && y > 0 ? y : sku.baseYield;
}

/**
 * Reasons this SKU cannot be costed.
 *
 * A split that doesn't total 100% is an ERROR, not a warning: per Decisions §11
 * the row highlights and does not calculate. v11 highlights but still computes;
 * every workbook row totals 100%, so parity is unaffected by the difference.
 */
export function validateCostInput(input: CostInput): CostIssue[] {
  const { sku, market, destination } = input;
  const issues: CostIssue[] = [];

  const split = sku.pctFish + sku.pctMarinade;
  if (Math.abs(split - 1) > SPLIT_EPSILON) {
    issues.push({
      code: 'split_not_100',
      message: `% fish + % marinade = ${(split * 100).toFixed(2)}%, must be 100%`,
    });
  }

  // Yield only divides the fish component, so it only matters when the SKU
  // actually carries fish. An absorbed by-product is unaffected by it.
  if (sku.rawMaterialBasis === 'full_fish') {
    const y = resolveYield(sku, input.bucket);
    if (!(y > 0)) {
      issues.push({ code: 'invalid_yield', message: `yield must be greater than 0, got ${y}` });
    }
  }

  // Everything up to FOB is generic, but CIF and below need a port. A costing
  // always carries at least one destination, so a missing one is a caller bug
  // rather than a state to render — better to say so than to imply zero freight.
  if (market === 'export' && !destination) {
    issues.push({ code: 'missing_destination', message: 'export costing requires a destination' });
  }

  return issues;
}

/**
 * The cost build-up, glaze-free, in the market's currency.
 *
 * Domestic works in LKR and converts the USD-denominated per-SKU inputs
 * (marinade, process, packing) at the FX rate. Export is USD throughout with no
 * conversion at all.
 */
export function costChain(input: CostInput): CostChain {
  const { sku, market, assumptions: a } = input;
  const o = sku.overrides ?? {};
  const wf = wholeFishCost(a, market, input.bucket);
  const yieldUsed = resolveYield(sku, input.bucket);
  const domestic = market === 'domestic';

  const wholeFish = domestic ? wf.wholeFishLkr : wf.wholeFishUsd;

  // Decisions §7: an absorbed by-product carries no raw material — the main
  // product already paid for the fish. Its cost is downstream only.
  const fishComponent = sku.rawMaterialBasis === 'absorbed' ? 0 : (sku.pctFish * wholeFish) / yieldUsed;

  const fx = domestic ? a.fxRate : 1;
  const marinadeComponent = sku.pctMarinade * sku.marinadeUsdPerKg * fx;
  const rawMaterial = fishComponent + marinadeComponent;

  const process = sku.processUsdPerKg * fx;
  const packing = sku.packingUsdPerKg * fx;

  // Ordering matters and was an explicit change request: cold-hold sits INSIDE
  // ex-factory; freight comes AFTER it, on the way to FINAL.
  const coldHold = domestic
    ? (o.coldHoldLkr ?? a.domestic.coldHoldLkr)
    : (o.coldChainUsd ?? a.export.coldChainUsd);
  const exFactory = rawMaterial + process + packing + coldHold;

  const freight = domestic
    ? (o.transportLkr ?? a.domestic.transportLkr)
    : (o.freightToPortUsd ?? a.export.freightToPortUsd);

  return {
    wholeFish,
    fishComponent,
    marinadeComponent,
    rawMaterial,
    process,
    packing,
    coldHold,
    exFactory,
    freight,
    finalCost: exFactory + freight,
    yieldUsed,
  };
}

/**
 * FINAL with glaze, derived from the base.
 *
 * Glaze is added ice: it dilutes the FISH cost only, via an effective yield of
 * `yield x (1 + glaze)`. Because nothing else in the chain changes, the glazed
 * FINAL falls out of the base one:
 *
 *   FINAL_glaze = FINAL_base - fish_comp_base x (glaze / (1 + glaze))
 *
 * An absorbed by-product has no fish component, so glaze cannot dilute
 * anything and the two are equal — which is correct, not a special case.
 */
export function glazedFinal(chain: CostChain, glazePct: number): number {
  if (glazePct <= 0) return chain.finalCost;
  return chain.finalCost - chain.fishComponent * (glazePct / (1 + glazePct));
}

/** Per-kg freight from a per-shipment rate and its editable fill weight. */
export function destinationPerKg(d: Destination, containerFillKg: number, airLotKg: number) {
  return {
    seaPerKg: containerFillKg > 0 ? d.seaRatePer20ft / containerFillKg : 0,
    airPerKg: airLotKg > 0 ? d.airRatePerLot / airLotKg : 0,
  };
}

function contribution(marketPrice: number | null | undefined, finalCost: number): number | null {
  return marketPrice == null ? null : marketPrice - finalCost;
}

/**
 * The price to actually use, and the margin it implies.
 *
 * A target only applies when the SKU is in target mode AND a usable figure is
 * set: a blank or zero target must fall back to cost-plus rather than pricing
 * the product at nothing.
 */
function resolvePrice(sku: CostSku, costPlusPrice: number, finalCost: number) {
  const useTarget =
    sku.pricingMode === 'target' && sku.targetPrice != null && sku.targetPrice > 0;
  const sellingPrice = useTarget ? sku.targetPrice! : costPlusPrice;
  return {
    sellingPrice,
    // Gross-margin basis, matching how rack and FOB margins are defined.
    // Goes negative when the target sits below cost — which is the point of
    // asking, so it is reported rather than clamped.
    marginPct: sellingPrice > 0 ? (sellingPrice - finalCost) / sellingPrice : null,
  };
}

function domesticState(
  finalCost: number,
  rackMarginPct: number,
  sku: CostSku
): DomesticState {
  const rackRate = rackMarginPct < 1 ? finalCost / (1 - rackMarginPct) : 0;
  const { sellingPrice, marginPct } = resolvePrice(sku, rackRate, finalCost);
  return {
    finalCost,
    rackRate,
    sellingPrice,
    marginPct,
    contributionPerKg: contribution(sku.marketPrice, finalCost),
  };
}

function exportState(
  finalCost: number,
  freightPerKg: number,
  input: CostInput
): ExportState {
  const { assumptions: a, sku } = input;
  const m = a.margins;
  const fobMargin = sku.overrides?.fobMarginPct ?? m.fobPct;

  const fob = fobMargin < 1 ? finalCost / (1 - fobMargin) : 0;
  const { sellingPrice, marginPct } = resolvePrice(sku, fob, finalCost);

  // The chain builds on the price actually charged, so a target FOB carries
  // through to what the importer and distributor pay.
  const clearing = sku.overrides?.importerClearingPct ?? m.importerClearingPct;
  const importerMarkup = sku.overrides?.importerMarkupPct ?? m.importerMarkupPct;
  const distributorMarkup = sku.overrides?.distributorMarkupPct ?? m.distributorMarkupPct;

  const cif = sellingPrice + freightPerKg;
  const importerPrice = cif * (1 + clearing) * (1 + importerMarkup);
  const distributorT3 = importerPrice * (1 + distributorMarkup);

  return {
    finalCost,
    fob,
    sellingPrice,
    marginPct,
    cif,
    importerPrice,
    distributorT3,
    freightPerKg,
    contributionPerKg: contribution(sku.marketPrice, finalCost),
  };
}

/**
 * Cost one SKU, for one market, at one size bucket, to one destination.
 *
 * Returns a result rather than throwing so the UI can highlight a bad row
 * without a value (Decisions §11).
 */
export function computeCost(input: CostInput): CostResult {
  const issues = validateCostInput(input);
  if (issues.length > 0) return { ok: false, issues };

  const { sku, market, assumptions: a } = input;
  const wholeFish = wholeFishCost(a, market, input.bucket);
  const chain = costChain(input);
  const glazed = glazedFinal(chain, sku.glazePct);

  // Decisions §7: an absorbed by-product's cost is a FLOOR, not a base for
  // cost-plus. Read its price off the market and its contribution off this.
  const pricingBasis = sku.rawMaterialBasis === 'absorbed' ? 'contribution' : 'margin';

  const common = { skuId: sku.id, bucketId: input.bucket?.id ?? null, pricingBasis, wholeFish } as const;

  if (market === 'domestic') {
    const rackMargin = sku.overrides?.rackMarginPct ?? a.margins.rackPct;
    const result: DomesticOutput = {
      market: 'domestic',
      currency: 'LKR',
      chain,
      unglazed: domesticState(chain.finalCost, rackMargin, sku),
      glazed: domesticState(glazed, rackMargin, sku),
    };
    return { ok: true, value: { ...common, result } };
  }

  const d = input.destination!;
  const { seaPerKg, airPerKg } = destinationPerKg(d, a.freight.containerFillKg, a.freight.airLotKg);

  const result: ExportOutput = {
    market: 'export',
    currency: 'USD',
    chain,
    destination: { id: d.id, name: d.name, seaPerKg, airPerKg },
    frozenPlain: exportState(chain.finalCost, seaPerKg, input),
    frozenGlazed: exportState(glazed, seaPerKg, input),
    // Fresh is identical to frozen-no-glaze all the way to FOB; it diverges
    // only by leaving on a plane instead of in a container.
    fresh: exportState(chain.finalCost, airPerKg, input),
  };
  return { ok: true, value: { ...common, result } };
}
