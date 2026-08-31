// Pure adapters between the `cost_*` row shapes and the engine's input types.
//
// Deliberately free of any server-only import: the cost grid recomputes in the
// browser, so these run on both sides. The database loader lives in
// `lib/costing.ts`, which imports `next/headers` and must never reach a client
// bundle. Keep this file dependency-light for that reason.
import type {
  CostAssumptionVersion,
  CostCosting,
  CostDestinationRate,
  CostDestinationRow,
  CostMarket,
  CostOdcComponentRow,
  CostSizeBucket,
  CostSkuRow,
} from '@oceanpick/shared';
import type { CostAssumptions, CostSku, Destination, SizeBucket } from '@oceanpick/engine';

/**
 * The assumption fields a user may override inside their own costing
 * (Decisions §4). Admins maintain the official values; anyone may deviate, and
 * the deviation is stamped on the costing so a reviewer can see it.
 */
export const OVERRIDABLE = [
  'feed_cost_per_kg',
  'clearing_cost_per_kg',
  'fcr_reference',
  'fx_rate',
  'import_tax_pct_domestic',
  'import_tax_pct_export',
  'domestic_transport_lkr',
  'domestic_cold_hold_lkr',
  'export_freight_to_port_usd',
  'export_cold_chain_usd',
  'rack_margin_pct',
  'fob_margin_pct',
  'importer_clearing_pct',
  'importer_markup_pct',
  'distributor_markup_pct',
  'container_fill_kg',
  'air_lot_kg',
] as const;

export type OverridableField = (typeof OVERRIDABLE)[number];

export const OVERRIDE_LABEL: Record<OverridableField, string> = {
  feed_cost_per_kg: 'Feed cost (USD/kg feed)',
  clearing_cost_per_kg: 'Clearing cost (USD/kg)',
  fcr_reference: 'FCR',
  fx_rate: 'FX rate (LKR per USD)',
  import_tax_pct_domestic: 'Import tax — domestic',
  import_tax_pct_export: 'Import tax — export',
  domestic_transport_lkr: 'Transport (LKR/kg)',
  domestic_cold_hold_lkr: 'Cold holding (LKR/kg)',
  export_freight_to_port_usd: 'Freight to port (USD/kg)',
  export_cold_chain_usd: 'Cold chain (USD/kg)',
  rack_margin_pct: 'Rack margin',
  fob_margin_pct: 'FOB margin',
  importer_clearing_pct: 'Importer clearing',
  importer_markup_pct: 'Importer markup',
  distributor_markup_pct: 'Distributor markup',
  container_fill_kg: 'Container fill weight (kg)',
  air_lot_kg: 'Air lot weight (kg)',
};

/** Fields entered and displayed as percentages. */
export const PERCENT_FIELDS = new Set<OverridableField>([
  'import_tax_pct_domestic',
  'import_tax_pct_export',
  'rack_margin_pct',
  'fob_margin_pct',
  'importer_clearing_pct',
  'importer_markup_pct',
  'distributor_markup_pct',
]);

/** Apply a costing's overrides on top of its pinned version. */
export function applyOverrides(
  version: CostAssumptionVersion,
  overrides: Record<string, number> | null | undefined
): CostAssumptionVersion {
  if (!overrides || Object.keys(overrides).length === 0) return version;
  const merged = { ...version };
  for (const field of OVERRIDABLE) {
    const v = overrides[field];
    if (typeof v === 'number' && Number.isFinite(v)) (merged as Record<string, unknown>)[field] = v;
  }
  return merged;
}

/** DB rows -> the engine's assumptions object. */
export function toAssumptions(version: CostAssumptionVersion, odc: CostOdcComponentRow[]): CostAssumptions {
  return {
    feedCostPerKg: version.feed_cost_per_kg,
    clearingCostPerKg: version.clearing_cost_per_kg,
    fcrReference: version.fcr_reference,
    fxRate: version.fx_rate,
    importTaxPct: {
      domestic: version.import_tax_pct_domestic,
      export: version.import_tax_pct_export,
    },
    domestic: {
      transportLkr: version.domestic_transport_lkr,
      coldHoldLkr: version.domestic_cold_hold_lkr,
    },
    export: {
      freightToPortUsd: version.export_freight_to_port_usd,
      coldChainUsd: version.export_cold_chain_usd,
    },
    margins: {
      rackPct: version.rack_margin_pct,
      fobPct: version.fob_margin_pct,
      importerClearingPct: version.importer_clearing_pct,
      importerMarkupPct: version.importer_markup_pct,
      distributorMarkupPct: version.distributor_markup_pct,
    },
    freight: {
      containerFillKg: version.container_fill_kg,
      airLotKg: version.air_lot_kg,
    },
    odc: odc.map((c) => ({ name: c.name, value: c.value, currency: c.currency, basis: c.basis })),
  };
}

/**
 * DB row -> the engine's SKU.
 *
 * `market` decides which market price and which adder overrides apply — the SKU
 * is one record serving both markets (Decisions §2/§3).
 */
export function toSku(row: CostSkuRow, market: CostMarket, bucketYields?: Record<string, number>): CostSku {
  const domestic = market === 'domestic';
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    category: row.category,
    glazePct: row.glaze_pct,
    baseYield: row.base_yield,
    pctFish: row.pct_fish,
    pctMarinade: row.pct_marinade,
    marinadeUsdPerKg: row.marinade_usd_per_kg,
    processUsdPerKg: row.process_usd_per_kg,
    packingUsdPerKg: row.packing_usd_per_kg,
    packSize: row.pack_size,
    rawMaterialBasis: row.raw_material_basis,
    // One number, two readings: what the market bears (drives by-product
    // contribution) and what we intend to charge (the target). Which one it
    // acts as is decided by pricing_mode, not by a second column.
    marketPrice: domestic ? row.market_price_lkr : row.market_price_usd,
    pricingMode: row.pricing_mode,
    targetPrice: domestic ? row.market_price_lkr : row.market_price_usd,
    overrides: {
      rackMarginPct: row.override_rack_margin_pct ?? undefined,
      fobMarginPct: row.override_fob_margin_pct ?? undefined,
      transportLkr: row.override_transport_lkr ?? undefined,
      coldHoldLkr: row.override_cold_hold_lkr ?? undefined,
      freightToPortUsd: row.override_freight_to_port_usd ?? undefined,
      coldChainUsd: row.override_cold_chain_usd ?? undefined,
      importerClearingPct: row.override_importer_clearing_pct ?? undefined,
      importerMarkupPct: row.override_importer_markup_pct ?? undefined,
      distributorMarkupPct: row.override_distributor_markup_pct ?? undefined,
    },
    bucketYields,
  };
}

export function toBucket(row: CostSizeBucket): SizeBucket {
  return { id: row.id, label: row.label, medianG: row.median_g, fcr: row.fcr };
}

export function toDestination(row: CostDestinationRow, rate: CostDestinationRate | undefined): Destination {
  return {
    id: row.id,
    name: row.name,
    seaRatePer20ft: rate?.sea_rate_per_20ft ?? 0,
    airRatePerLot: rate?.air_rate_per_lot ?? 0,
  };
}

/** True when a costing deviates from its pinned version. */
export function hasOverrides(costing: Pick<CostCosting, 'assumption_overrides'>): boolean {
  return Object.keys(costing.assumption_overrides ?? {}).length > 0;
}
