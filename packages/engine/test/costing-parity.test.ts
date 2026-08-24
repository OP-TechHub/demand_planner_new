// Parity: the costing engine must reproduce barramundi_costing_v11.xlsx.
//
// This is the lock referred to in Costing_Module_Decisions.md §12. It asserts
// the `full_fish` flat path only — the bucketed path and the `absorbed`
// by-product path have no Excel oracle and are tested in costing.test.ts.
//
// Tolerance is RELATIVE 1e-9, not absolute. The engine and Excel do the same
// arithmetic in a slightly different order — Excel computes (process+packing)*FX
// while the engine converts each separately — so the last bit or two can differ
// on a five-figure LKR value. A relative bound proves we reproduce the model
// rather than Excel's floating-point rounding.
import { describe, it, expect } from 'vitest';
import { computeCost, destinationPerKg, odcTotalUsd, wholeFishCost } from '../src/costing';
import type { DomesticOutput, ExportOutput } from '../src/costing';
import {
  reference,
  selectedDestination,
  v11Assumptions,
  v11Buckets,
  v11Destinations,
  v11Skus,
} from './v11';

const REL = 1e-9;

function closeTo(actual: number, expected: number, label: string) {
  const tolerance = REL * Math.max(1, Math.abs(expected));
  expect(
    Math.abs(actual - expected),
    `${label}: got ${actual}, expected ${expected} (tolerance ${tolerance})`
  ).toBeLessThanOrEqual(tolerance);
}

const A = v11Assumptions();
const SKUS = v11Skus();

describe('v11 parity — base whole-fish cost', () => {
  it('domestic matches the Assumptions tab', () => {
    const wf = wholeFishCost(A, 'domestic');
    closeTo(wf.effectiveFeedCostUsd, reference.domestic.effectiveFeedCostUsd, 'effective feed (B8)');
    closeTo(wf.feedCostPerKgFishUsd, reference.domestic.feedCostPerKgFishUsd, 'feed per kg fish (B10)');
    closeTo(wf.odcUsd, reference.domestic.odcUsd, 'ODC (B11)');
    closeTo(wf.wholeFishUsd, reference.domestic.wholeFishUsd, 'whole fish USD (B19)');
    closeTo(wf.wholeFishLkr, reference.domestic.wholeFishLkr, 'whole fish LKR (B21)');
  });

  it('export differs on exactly one line: import tax is zero', () => {
    const wf = wholeFishCost(A, 'export');
    closeTo(wf.effectiveFeedCostUsd, reference.export.effectiveFeedCostUsd, 'effective feed (B8)');
    closeTo(wf.feedCostPerKgFishUsd, reference.export.feedCostPerKgFishUsd, 'feed per kg fish (B10)');
    closeTo(wf.odcUsd, reference.export.odcUsd, 'ODC (B11)');
    closeTo(wf.wholeFishUsd, reference.export.wholeFishUsd, 'whole fish USD (B12)');

    // The shared-input rule: ODC and FCR are identical across markets, so the
    // whole difference is feed x tax.
    const dom = wholeFishCost(A, 'domestic');
    closeTo(wf.odcUsd, dom.odcUsd, 'ODC is shared');
    expect(wf.fcrUsed).toBe(dom.fcrUsed);
    closeTo(
      dom.effectiveFeedCostUsd - wf.effectiveFeedCostUsd,
      A.feedCostPerKg * A.importTaxPct.domestic,
      'the only base difference'
    );
  });
});

describe('v11 parity — domestic SKU cost chain (LKR)', () => {
  it('has all 34 workbook SKUs', () => {
    expect(SKUS).toHaveLength(34);
  });

  it.each(SKUS.map((s) => [s.name, s] as const))('%s', (_name, sku) => {
    const res = computeCost({ market: 'domestic', assumptions: A, sku });
    expect(res.ok, `${sku.name} should cost cleanly`).toBe(true);
    if (!res.ok) return;

    const out = res.value.result as DomesticOutput;
    const e = sku.expected.domestic;

    closeTo(out.chain.wholeFish, e.wholeFishLkr, `${sku.name} whole fish (col I)`);
    closeTo(out.chain.fishComponent, e.fishComponent, `${sku.name} fish comp (col J)`);
    closeTo(out.chain.marinadeComponent, e.marinadeComponent, `${sku.name} marinade comp (col L)`);
    closeTo(out.chain.rawMaterial, e.rawMaterial, `${sku.name} raw material (col M)`);
    closeTo(out.chain.coldHold, e.coldHold, `${sku.name} cold-hold (col P)`);
    closeTo(out.chain.exFactory, e.exFactory, `${sku.name} ex-factory (col Q)`);
    closeTo(out.chain.freight, e.freight, `${sku.name} freight (col R)`);
    closeTo(out.chain.finalCost, e.finalCost, `${sku.name} FINAL (col S)`);

    closeTo(out.unglazed.finalCost, e.unglazed.final, `${sku.name} FINAL no glaze (col U)`);
    closeTo(out.unglazed.rackRate, e.unglazed.rackRate, `${sku.name} rack no glaze (col V)`);
    closeTo(out.glazed.finalCost, e.glazed.final, `${sku.name} FINAL glaze (col W)`);
    closeTo(out.glazed.rackRate, e.glazed.rackRate, `${sku.name} rack glaze (col X)`);
  });
});

describe('v11 parity — export SKU cost chain and value chain (USD, Dubai)', () => {
  const destination = selectedDestination();

  it('is computed against the port the workbook has selected', () => {
    expect(destination.name).toBe('Dubai (UAE)');
  });

  it.each(SKUS.map((s) => [s.name, s] as const))('%s', (_name, sku) => {
    const res = computeCost({ market: 'export', assumptions: A, sku, destination });
    expect(res.ok, `${sku.name} should cost cleanly`).toBe(true);
    if (!res.ok) return;

    const out = res.value.result as ExportOutput;
    const e = sku.expected.export;

    closeTo(out.chain.wholeFish, e.wholeFishUsd, `${sku.name} whole fish (col I)`);
    closeTo(out.chain.fishComponent, e.fishComponent, `${sku.name} fish comp (col J)`);
    closeTo(out.chain.marinadeComponent, e.marinadeComponent, `${sku.name} marinade comp (col L)`);
    closeTo(out.chain.rawMaterial, e.rawMaterial, `${sku.name} raw material (col M)`);
    closeTo(out.chain.coldHold, e.coldHold, `${sku.name} cold-chain (col P)`);
    closeTo(out.chain.exFactory, e.exFactory, `${sku.name} ex-factory (col Q)`);
    closeTo(out.chain.freight, e.freight, `${sku.name} freight to port (col R)`);
    closeTo(out.chain.finalCost, e.finalCost, `${sku.name} FINAL (col S)`);

    const states = [
      ['frozen plain (U-X)', out.frozenPlain, e.frozenPlain],
      ['frozen glazed (Y-AB)', out.frozenGlazed, e.frozenGlazed],
      ['fresh (AC-AF)', out.fresh, e.fresh],
    ] as const;

    for (const [label, actual, expectedState] of states) {
      closeTo(actual.finalCost, expectedState.final, `${sku.name} ${label} FINAL`);
      closeTo(actual.fob, expectedState.fob, `${sku.name} ${label} FOB`);
      closeTo(actual.cif, expectedState.cif, `${sku.name} ${label} CIF`);
      closeTo(actual.distributorT3, expectedState.distributorT3, `${sku.name} ${label} Dist->T3`);
    }
  });
});

describe('v11 parity — destination freight conversion', () => {
  it.each(v11Destinations().map((d) => [d.name, d] as const))('%s', (_name, d) => {
    const { seaPerKg, airPerKg } = destinationPerKg(d, A.freight.containerFillKg, A.freight.airLotKg);
    closeTo(seaPerKg, d.expected.seaPerKg, `${d.name} sea $/kg (col D)`);
    closeTo(airPerKg, d.expected.airPerKg, `${d.name} air $/kg (col E)`);
  });

  it('responds to the editable fill weight', () => {
    const dubai = selectedDestination();
    closeTo(destinationPerKg(dubai, 7000, 500).seaPerKg, 0.45, 'Dubai at 7,000 kg');
    closeTo(destinationPerKg(dubai, 5000, 500).seaPerKg, 0.63, 'Dubai at 5,000 kg');
    closeTo(destinationPerKg(dubai, 7000, 500).airPerKg, 2.8, 'Dubai air at 500 kg');
  });
});

// The ONLY oracle available for the bucketed path: v11 computes per-bucket ODC
// and whole-fish cost on the Assumptions tab, then never feeds them to the SKU
// rows. Decisions §12.
describe('v11 parity — per-bucket ODC and whole-fish cost (computed but unused in v11)', () => {
  it.each(v11Buckets().map((b) => [b.label, b] as const))('%s', (_label, bucket) => {
    closeTo(odcTotalUsd(A, bucket), bucket.expected.odcUsd, `${bucket.label} ODC (row 11)`);

    const wf = wholeFishCost(A, 'domestic', bucket);
    closeTo(wf.wholeFishUsd, bucket.expected.wholeFishUsd, `${bucket.label} whole fish USD (row 19)`);
    closeTo(wf.wholeFishLkr, bucket.expected.wholeFishLkr, `${bucket.label} whole fish LKR (row 21)`);
  });

  it('amortises per-fish ODC over the median: small fish carry more', () => {
    const buckets = v11Buckets();
    const smallest = buckets[0]!;
    const largest = buckets[buckets.length - 1]!;
    expect(odcTotalUsd(A, smallest)).toBeGreaterThan(odcTotalUsd(A, largest));

    // The handoff's anchors, confirmed against the workbook.
    closeTo(odcTotalUsd(A, smallest), 1.16862745098039, '0-600g (median 300g) ODC');
    closeTo(odcTotalUsd(A, largest), 0.208728652751423, '2200-4000g (median 3100g) ODC');
  });

  it('at the ~1000 g reference the flat and bucketed ODC agree', () => {
    const oneKilo = { id: 'ref', label: '1kg', medianG: 1000, fcr: A.fcrReference };
    const perFish = A.odc.filter((c) => c.basis === 'per_fish');
    expect(perFish.length, 'fingerling + vaccine amortise per fish').toBe(2);
    // median 1 kg means dividing by 1, so the bucketed sum collapses to the flat one
    closeTo(odcTotalUsd(A, oneKilo), odcTotalUsd(A), 'ODC at 1 kg median');
  });
});
