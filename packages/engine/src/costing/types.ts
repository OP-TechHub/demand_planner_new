// Costing engine input/output types.
//
// Pure and I/O-free, like the demand engine: the app adapts DB rows into
// CostInput, runs computeCost, and persists the resolved output. Identifiers
// are opaque strings (DB uses uuids; the v11 fixture uses labels).
//
// Reference: costing_module/Costing_Module_Decisions.md

export type Market = 'domestic' | 'export';
export type Currency = 'LKR' | 'USD';
export type OdcBasis = 'per_kg' | 'per_fish';
export type SkuStatus = 'active' | 'inactive';

/**
 * Whether a SKU carries the whole fish or none of it (Decisions §7).
 *
 *  full_fish — whole_fish_cost / yield. Reproduces v11. Default for every SKU,
 *              including co-products, which are costed at their standalone
 *              yields as though each were the target of its own run.
 *  absorbed  — zero raw material: the main product already absorbed the fish.
 *              Cost is downstream only (process + packing + cold-hold +
 *              freight). Used by the six by-product SKUs, which are priced on
 *              contribution against a market price rather than on margin.
 */
export type RawMaterialBasis = 'full_fish' | 'absorbed';

export interface OdcComponent {
  name: string;
  value: number;
  currency: Currency;
  /** per_fish components amortise over the bucket median; per_kg stay flat. */
  basis: OdcBasis;
}

export interface CostAssumptions {
  /** USD per kg of feed, before tax and clearing. */
  feedCostPerKg: number;
  /** USD/kg — customs clearing on imported feed. Added AFTER tax, not taxed. */
  clearingCostPerKg: number;
  /** Reference FCR, used when no size bucket is in play. */
  fcrReference: number;
  /** LKR per 1 USD. */
  fxRate: number;
  /** Duty on feed. Export is 0 (drawback) — the only base-cost difference. */
  importTaxPct: Record<Market, number>;
  domestic: { transportLkr: number; coldHoldLkr: number };
  export: { freightToPortUsd: number; coldChainUsd: number };
  margins: {
    rackPct: number;
    fobPct: number;
    importerClearingPct: number;
    importerMarkupPct: number;
    distributorMarkupPct: number;
  };
  freight: { containerFillKg: number; airLotKg: number };
  odc: OdcComponent[];
}

export interface SizeBucket {
  id: string;
  label: string;
  /** Median fish weight in grams — what per-fish ODC amortises over. */
  medianG: number;
  /** Cumulative FCR at this size. Rises with fish size. */
  fcr: number;
}

/** Per-SKU overrides of a global assumption. Undefined means inherit. */
export interface SkuOverrides {
  rackMarginPct?: number;
  fobMarginPct?: number;
  transportLkr?: number;
  coldHoldLkr?: number;
  freightToPortUsd?: number;
  coldChainUsd?: number;
  /**
   * The downstream export ladder, past FOB. Clearing and trade markups are
   * negotiated per product and per channel, so a SKU can carry its own instead
   * of every line sharing the version's.
   */
  importerClearingPct?: number;
  importerMarkupPct?: number;
  distributorMarkupPct?: number;
}

/**
 * How a SKU's selling price is arrived at.
 *
 *  margin — cost-plus. Price = FINAL / (1 - margin). The workbook's only mode,
 *           and the default, so parity is unaffected.
 *  target — you name the price and the margin falls out of it. What you do when
 *           the market sets the price and the question is whether it clears
 *           your cost, not what your cost implies the price should be.
 */
export type PricingMode = 'margin' | 'target';

export interface CostSku {
  id: string;
  name: string;
  status: SkuStatus;
  category: string;
  /** Added ice on frozen product. Dilutes fish cost only, via effective yield. */
  glazePct: number;
  /** Flat yield, used when no bucket is in play or the bucket has no entry. */
  baseYield: number;
  pctFish: number;
  pctMarinade: number;
  marinadeUsdPerKg: number;
  processUsdPerKg: number;
  packingUsdPerKg: number;
  packSize: string | null;
  rawMaterialBasis: RawMaterialBasis;
  /**
   * What the market pays, in the market's currency. Drives contribution for
   * absorbed SKUs. Null means contribution can't be computed yet.
   */
  marketPrice?: number | null;
  /** Defaults to 'margin' when absent, which is the workbook's behaviour. */
  pricingMode?: PricingMode;
  /**
   * The price you intend to sell at, in the market's currency. Used only when
   * pricingMode is 'target'. Domestic: the shelf/rack price. Export: the FOB
   * price, so CIF and the chain below build on it.
   */
  targetPrice?: number | null;
  overrides?: SkuOverrides;
  /** bucketId -> yield. Populated later by the farm; falls back to baseYield. */
  bucketYields?: Record<string, number>;
}

export interface Destination {
  id: string;
  name: string;
  seaRatePer20ft: number;
  airRatePerLot: number;
}

export interface CostInput {
  market: Market;
  assumptions: CostAssumptions;
  sku: CostSku;
  /** Null resolves through the flat reference model (buckets switched off). */
  bucket?: SizeBucket | null;
  /** Required for export CIF and below; ignored for domestic. */
  destination?: Destination | null;
}

// --- Output ----------------------------------------------------------------

export interface WholeFishCost {
  /** feed x (1 + tax) + clearing */
  effectiveFeedCostUsd: number;
  /** effective feed x FCR */
  feedCostPerKgFishUsd: number;
  odcUsd: number;
  wholeFishUsd: number;
  wholeFishLkr: number;
  /** The FCR actually used — bucket's, or the reference. */
  fcrUsed: number;
}

/** The cost build-up, in the market's currency. Glaze-free (Decisions §7). */
export interface CostChain {
  wholeFish: number;
  fishComponent: number;
  marinadeComponent: number;
  rawMaterial: number;
  process: number;
  packing: number;
  coldHold: number;
  exFactory: number;
  freight: number;
  finalCost: number;
  /** The yield actually used — bucket's, or the SKU's flat value. */
  yieldUsed: number;
}

export interface DomesticState {
  finalCost: number;
  /** Cost-plus price at the rack margin. Always computed, whatever the mode. */
  rackRate: number;
  /** The price actually used: the target if one is set, else the rack rate. */
  sellingPrice: number;
  /** Gross margin realised at sellingPrice. Negative when it sells below cost. */
  marginPct: number | null;
  /**
   * What a kg of WHOLE ROUND fish earns, rather than what a kg of pack earns.
   *
   * Deducts every conversion input including marinade but not the fish, scales
   * to the round weight by yield, then charges the whole fish once:
   *
   *   (sellingPrice - conversion inputs) x yield - whole fish cost
   *
   * Null for an absorbed by-product, which never paid for the fish (Decisions
   * §7) and so has no whole-round figure to report.
   */
  wholeRoundMarginPerKg: number | null;
  /**
   * That figure over the WHOLE ROUND COST it was earned on — feed x FCR plus
   * ODC. A return on the farm cost, not a margin on revenue, so it routinely
   * exceeds 100%.
   */
  wholeRoundMarginPct: number | null;
  /** marketPrice - finalCost. Null when no market price is set. */
  contributionPerKg: number | null;
}

export interface ExportState {
  finalCost: number;
  /** Cost-plus FOB at the FOB margin. Always computed, whatever the mode. */
  fob: number;
  /** The FOB actually used: the target if one is set, else the cost-plus FOB. */
  sellingPrice: number;
  /** Gross margin realised at sellingPrice. */
  marginPct: number | null;
  /**
   * What a kg of WHOLE ROUND fish earns, rather than what a kg of pack earns.
   *
   * Deducts every conversion input including marinade but not the fish, scales
   * to the round weight by yield, then charges the whole fish once:
   *
   *   (sellingPrice - conversion inputs) x yield - whole fish cost
   *
   * Null for an absorbed by-product, which never paid for the fish (Decisions
   * §7) and so has no whole-round figure to report.
   */
  wholeRoundMarginPerKg: number | null;
  /**
   * That figure over the WHOLE ROUND COST it was earned on — feed x FCR plus
   * ODC. A return on the farm cost, not a margin on revenue, so it routinely
   * exceeds 100%.
   */
  wholeRoundMarginPct: number | null;
  /** Built on sellingPrice, so a target FOB carries through the whole chain. */
  cif: number;
  importerPrice: number;
  distributorT3: number;
  freightPerKg: number;
  contributionPerKg: number | null;
}

/**
 * How this SKU's selling price should be read.
 *  margin       — cost-plus. Rack rate / FOB are the answer.
 *  contribution — absorbed by-product. The cost figure is a FLOOR; price is set
 *                 by what the market bears, and contribution is the number that
 *                 matters (Decisions §7).
 */
export type PricingBasis = 'margin' | 'contribution';

export interface DomesticOutput {
  market: 'domestic';
  currency: 'LKR';
  chain: CostChain;
  unglazed: DomesticState;
  glazed: DomesticState;
}

export interface ExportOutput {
  market: 'export';
  currency: 'USD';
  chain: CostChain;
  destination: { id: string; name: string; seaPerKg: number; airPerKg: number } | null;
  frozenPlain: ExportState;
  frozenGlazed: ExportState;
  /** Identical to frozenPlain up to FOB, then diverges onto air freight. */
  fresh: ExportState;
}

export interface CostOutput {
  skuId: string;
  bucketId: string | null;
  pricingBasis: PricingBasis;
  wholeFish: WholeFishCost;
  result: DomesticOutput | ExportOutput;
}

/**
 * A reason the SKU cannot be costed. Per Decisions §11 a broken fish/marinade
 * split highlights and does NOT calculate, so this is an error, not a warning.
 */
export interface CostIssue {
  code: 'split_not_100' | 'invalid_yield' | 'missing_destination';
  message: string;
}

export type CostResult = { ok: true; value: CostOutput } | { ok: false; issues: CostIssue[] };
