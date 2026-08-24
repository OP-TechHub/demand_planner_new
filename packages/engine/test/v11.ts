// Adapter: load the committed v11 costing fixture into engine types, preserving
// the Excel-computed `expected` blocks for parity assertions.
//
// The workbook is the oracle; this file is the only place that knows its shape.
import v11 from '../fixtures/v11.json';
import type {
  CostAssumptions,
  CostSku,
  Destination,
  OdcBasis,
  OdcComponent,
  SizeBucket,
  SkuStatus,
} from '../src/costing/types';

type RawSku = (typeof v11.skus)[number];
type RawBucket = (typeof v11.buckets)[number];
type RawDestination = (typeof v11.destinations)[number];

export interface V11Sku extends CostSku {
  expected: RawSku['expected'];
}
export interface V11Bucket extends SizeBucket {
  expected: RawBucket['expected'];
}
export interface V11Destination extends Destination {
  expected: RawDestination['expected'];
}

export const reference = v11.reference;

export function v11Assumptions(): CostAssumptions {
  return {
    feedCostPerKg: v11.assumptions.feedCostPerKg,
    clearingCostPerKg: v11.assumptions.clearingCostPerKg,
    fcrReference: v11.assumptions.fcrReference,
    fxRate: v11.assumptions.fxRate,
    importTaxPct: {
      domestic: v11.assumptions.importTaxPct.domestic,
      export: v11.assumptions.importTaxPct.export,
    },
    domestic: { ...v11.assumptions.domestic },
    export: { ...v11.assumptions.export },
    margins: { ...v11.assumptions.margins },
    freight: { ...v11.assumptions.freight },
    odc: v11.assumptions.odc.map(
      (c): OdcComponent => ({
        name: c.name,
        value: c.value,
        currency: c.currency as 'LKR' | 'USD',
        basis: c.basis as OdcBasis,
      })
    ),
  };
}

/**
 * The 34 workbook SKUs.
 *
 * Every one is `full_fish` — that is the parity default, and it is what makes
 * 28 of the 34 rows reproduce v11 untouched (Decisions §7). The by-product rows
 * are switched to `absorbed` deliberately, in their own tests, never here.
 */
export function v11Skus(): V11Sku[] {
  return v11.skus.map((s, i) => ({
    id: 's' + String(i).padStart(2, '0'),
    name: s.name,
    status: s.status as SkuStatus,
    category: s.category,
    glazePct: s.glazePct,
    baseYield: s.baseYield,
    pctFish: s.pctFish,
    pctMarinade: s.pctMarinade,
    marinadeUsdPerKg: s.marinadeUsdPerKg,
    processUsdPerKg: s.processUsdPerKg,
    packingUsdPerKg: s.packingUsdPerKg,
    packSize: s.packSize,
    rawMaterialBasis: 'full_fish',
    expected: s.expected,
  }));
}

export function v11Buckets(): V11Bucket[] {
  return v11.buckets.map((b) => ({
    id: b.id,
    label: b.label,
    medianG: b.medianG,
    fcr: b.fcr,
    expected: b.expected,
  }));
}

export function v11Destinations(): V11Destination[] {
  return v11.destinations.map((d, i) => ({
    id: 'd' + String(i).padStart(2, '0'),
    name: d.name,
    seaRatePer20ft: d.seaRatePer20ft,
    airRatePerLot: d.airRatePerLot,
    expected: d.expected,
  }));
}

/** The port the workbook's export tab is currently computed against. */
export function selectedDestination(): V11Destination {
  const d = v11Destinations().find((x) => x.name === v11.selectedDestination);
  if (!d) throw new Error(`selected destination not in table: ${v11.selectedDestination}`);
  return d;
}

export function skuNamed(name: string): V11Sku {
  const s = v11Skus().find((x) => x.name === name);
  if (!s) throw new Error(`no such SKU in fixture: ${name}`);
  return s;
}
