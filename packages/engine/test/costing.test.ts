// Costing behaviour that v11 cannot prove.
//
// Every glaze cell in the workbook is 0, the bucket columns are computed and
// never consumed, and the absorbed by-product model is a deliberate departure
// (Costing_Module_Decisions.md §7, §12). These are the tests that cover them.
import { describe, it, expect } from 'vitest';
import { computeCost, costChain, glazedFinal, resolveYield, validateCostInput } from '../src/costing';
import type { CostSku, DomesticOutput, ExportOutput, SizeBucket } from '../src/costing';
import { selectedDestination, skuNamed, v11Assumptions, v11Buckets, v11Skus } from './v11';

const A = v11Assumptions();
const DUBAI = selectedDestination();

const domestic = (sku: CostSku, bucket?: SizeBucket | null) =>
  computeCost({ market: 'domestic', assumptions: A, sku, bucket });
const exported = (sku: CostSku, bucket?: SizeBucket | null) =>
  computeCost({ market: 'export', assumptions: A, sku, bucket, destination: DUBAI });

/** Unwrap a result that is expected to succeed. */
function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  expect(r.ok, 'expected a costable SKU').toBe(true);
  return r as Extract<T, { ok: true }>;
}

describe('glaze', () => {
  const fillet = skuNamed('Skin-on fillet');

  it('reproduces the 20% glaze anchor on domestic skin-on fillet', () => {
    const out = ok(domestic({ ...fillet, glazePct: 0.2 })).value.result as DomesticOutput;
    expect(out.unglazed.finalCost).toBeCloseTo(2985.06, 2);
    expect(out.glazed.finalCost).toBeCloseTo(2577.88, 2);
    expect(out.glazed.rackRate).toBeCloseTo(4296.47, 2);
  });

  it('is algebraically identical to costing at an effective yield of yield x (1 + glaze)', () => {
    // The whole reason FINAL_glaze can be derived from FINAL_base: glaze dilutes
    // the fish component and nothing else. If that ever stops holding, the
    // shortcut in glazedFinal() is wrong.
    for (const glazePct of [0.05, 0.1, 0.2, 0.35]) {
      const base = costChain({ market: 'domestic', assumptions: A, sku: { ...fillet, glazePct } });
      const viaEffectiveYield = costChain({
        market: 'domestic',
        assumptions: A,
        sku: { ...fillet, glazePct: 0, baseYield: fillet.baseYield * (1 + glazePct) },
      });
      expect(glazedFinal(base, glazePct)).toBeCloseTo(viaEffectiveYield.finalCost, 9);
    }
  });

  it('dilutes the fish cost only — processing, packing and freight stay per kg', () => {
    const plain = ok(domestic(fillet)).value.result as DomesticOutput;
    const glazed = ok(domestic({ ...fillet, glazePct: 0.2 })).value.result as DomesticOutput;
    // The chain itself is the base build-up either way; only FINAL moves.
    expect(glazed.chain.exFactory).toBeCloseTo(plain.chain.exFactory, 9);
    expect(glazed.chain.freight).toBeCloseTo(plain.chain.freight, 9);
    expect(glazed.glazed.finalCost).toBeLessThan(plain.unglazed.finalCost);
  });

  it('leaves FINAL untouched at 0% glaze, which is why all 34 v11 rows match', () => {
    for (const sku of v11Skus()) {
      const out = ok(domestic(sku)).value.result as DomesticOutput;
      expect(out.glazed.finalCost, sku.name).toBeCloseTo(out.unglazed.finalCost, 9);
    }
  });

  it('is applied to the frozen-glazed export state but never to fresh', () => {
    const out = ok(exported({ ...fillet, glazePct: 0.2 })).value.result as ExportOutput;
    expect(out.frozenGlazed.finalCost).toBeLessThan(out.frozenPlain.finalCost);
    // Fresh is frozen-no-glaze to FOB, diverging only onto air freight.
    expect(out.fresh.finalCost).toBeCloseTo(out.frozenPlain.finalCost, 9);
    expect(out.fresh.fob).toBeCloseTo(out.frozenPlain.fob, 9);
    expect(out.fresh.cif).toBeGreaterThan(out.frozenPlain.cif);
  });
});

describe('by-products: absorbed raw material (Decisions §7)', () => {
  // The six by-product rows, with the cost each should fall to once the fish is
  // recognised as already paid for by the main product.
  const EXPECTED_FLOOR_LKR: Record<string, number> = {
    'Belly flaps': 270,
    Head: 219,
    Collar: 321,
    'Fish frames / bones (stock)': 185,
    'Fish skin (crispy / pet treat)': 236,
    'Trimmings / mince': 236,
  };

  const byProducts = v11Skus().filter((s) => s.category === 'By-product');

  it('covers exactly the six workbook by-product rows', () => {
    expect(byProducts.map((s) => s.name).sort()).toEqual(Object.keys(EXPECTED_FLOOR_LKR).sort());
  });

  it.each(byProducts.map((s) => [s.name, s] as const))('%s falls to its downstream cost', (name, sku) => {
    const absorbed = ok(domestic({ ...sku, rawMaterialBasis: 'absorbed' })).value.result as DomesticOutput;
    const full = ok(domestic(sku)).value.result as DomesticOutput;

    expect(absorbed.chain.fishComponent).toBe(0);
    expect(absorbed.chain.finalCost).toBeCloseTo(EXPECTED_FLOOR_LKR[name]!, 6);
    // The whole point: v11's figure is an order of magnitude higher.
    expect(full.chain.finalCost).toBeGreaterThan(absorbed.chain.finalCost * 10);
  });

  it('reports contribution rather than margin as the pricing basis', () => {
    const belly = skuNamed('Belly flaps');
    const res = ok(domestic({ ...belly, rawMaterialBasis: 'absorbed', marketPrice: 800 }));
    expect(res.value.pricingBasis).toBe('contribution');

    const out = res.value.result as DomesticOutput;
    // A pet-treat buyer at LKR 800 contributes 530/kg against a 270 floor —
    // the trade v11's 18,593 figure would have talked you out of.
    expect(out.unglazed.contributionPerKg).toBeCloseTo(800 - 270, 6);
  });

  it('leaves contribution null when no market price is set', () => {
    const belly = skuNamed('Belly flaps');
    const out = ok(domestic({ ...belly, rawMaterialBasis: 'absorbed' })).value.result as DomesticOutput;
    expect(out.unglazed.contributionPerKg).toBeNull();
  });

  it('makes glaze a no-op, since there is no fish cost left to dilute', () => {
    const belly = { ...skuNamed('Belly flaps'), rawMaterialBasis: 'absorbed' as const, glazePct: 0.2 };
    const out = ok(domestic(belly)).value.result as DomesticOutput;
    expect(out.glazed.finalCost).toBeCloseTo(out.unglazed.finalCost, 9);
  });

  it('defaults every SKU to full_fish, which is what preserves parity', () => {
    for (const sku of v11Skus()) {
      expect(sku.rawMaterialBasis, sku.name).toBe('full_fish');
      expect(ok(domestic(sku)).value.pricingBasis).toBe('margin');
    }
  });

  it('does not change co-products: they keep standalone yields and carry the fish', () => {
    // Decisions §7 — tail portions are costed as though each were the target of
    // its own run. The co-product yield advantage is upside, not cost relief.
    const tails = skuNamed('Tail portions — regular (70/130) s/on');
    const out = ok(domestic(tails)).value.result as DomesticOutput;
    expect(out.chain.yieldUsed).toBe(tails.baseYield);
    expect(out.chain.fishComponent).toBeGreaterThan(0);
    expect(out.chain.finalCost).toBeCloseTo(tails.expected.domestic.finalCost, 6);
  });
});

describe('size buckets', () => {
  const buckets = v11Buckets();
  const fillet = skuNamed('Skin-on fillet');

  it('resolves through the flat yield while buckets are off', () => {
    expect(resolveYield(fillet, null)).toBe(fillet.baseYield);
    const out = ok(domestic(fillet)).value;
    expect(out.bucketId).toBeNull();
    expect(out.wholeFish.fcrUsed).toBe(A.fcrReference);
  });

  it('falls back to the flat yield for a bucket the farm has not filled in yet', () => {
    // The placeholder state: buckets exist, per-SKU yields do not.
    const b = buckets[0]!;
    expect(resolveYield(fillet, b)).toBe(fillet.baseYield);
    expect(resolveYield({ ...fillet, bucketYields: { [b.id]: 0.41 } }, b)).toBe(0.41);
    // A zero or missing entry is not a yield — fall back rather than divide by it.
    expect(resolveYield({ ...fillet, bucketYields: { [b.id]: 0 } }, b)).toBe(fillet.baseYield);
  });

  it('uses the bucket FCR and amortised ODC once a bucket is supplied', () => {
    const b = buckets[0]!;
    const out = ok(domestic(fillet, b)).value;
    expect(out.bucketId).toBe(b.id);
    expect(out.wholeFish.fcrUsed).toBe(b.fcr);
    expect(out.wholeFish.fcrUsed).not.toBe(A.fcrReference);
  });

  it('costs a small fish above a large one, at equal yield', () => {
    // FCR rises with size but ODC/kg falls faster at the small end, so the
    // 0-600 g bucket is the expensive one. This is the effect buckets exist for.
    const smallest = ok(domestic(fillet, buckets[0]!)).value.result as DomesticOutput;
    const midRange = ok(domestic(fillet, buckets[1]!)).value.result as DomesticOutput;
    expect(smallest.chain.finalCost).toBeGreaterThan(midRange.chain.finalCost);
  });

  it('switching buckets on is a data change, not an engine change', () => {
    // The 800-1100g bucket is the ~1000 g reference the flat model represents,
    // so with reference FCR its cost matches the flat path. That equivalence is
    // what makes the flag flip safe.
    const referenceBucket = { ...buckets[2]!, fcr: A.fcrReference, medianG: 1000 };
    const viaBucket = ok(domestic(fillet, referenceBucket)).value.result as DomesticOutput;
    const flat = ok(domestic(fillet)).value.result as DomesticOutput;
    expect(viaBucket.chain.finalCost).toBeCloseTo(flat.chain.finalCost, 9);
  });
});

describe('per-SKU overrides (Decisions §8)', () => {
  const fillet = skuNamed('Skin-on fillet');

  it('inherits the global value when nothing is overridden', () => {
    const out = ok(domestic(fillet)).value.result as DomesticOutput;
    expect(out.chain.freight).toBe(A.domestic.transportLkr);
    expect(out.chain.coldHold).toBe(A.domestic.coldHoldLkr);
  });

  it('takes the SKU value when one is set', () => {
    const out = ok(domestic({ ...fillet, overrides: { transportLkr: 95, coldHoldLkr: 15 } })).value
      .result as DomesticOutput;
    expect(out.chain.freight).toBe(95);
    expect(out.chain.coldHold).toBe(15);
    // Cold-hold sits inside ex-factory; freight lands after it.
    expect(out.chain.exFactory).toBeCloseTo(out.chain.rawMaterial + out.chain.process + out.chain.packing + 15, 9);
    expect(out.chain.finalCost).toBeCloseTo(out.chain.exFactory + 95, 9);
  });

  it('overrides margins per SKU without touching cost', () => {
    const dom = ok(domestic({ ...fillet, overrides: { rackMarginPct: 0.25 } })).value.result as DomesticOutput;
    expect(dom.chain.finalCost).toBeCloseTo(fillet.expected.domestic.finalCost, 6);
    expect(dom.unglazed.rackRate).toBeCloseTo(dom.unglazed.finalCost / 0.75, 9);

    const exp = ok(exported({ ...fillet, overrides: { fobMarginPct: 0.5 } })).value.result as ExportOutput;
    expect(exp.frozenPlain.fob).toBeCloseTo(exp.frozenPlain.finalCost / 0.5, 9);
  });

  it('applies export adders separately from domestic ones', () => {
    const out = ok(exported({ ...fillet, overrides: { freightToPortUsd: 0.4, coldChainUsd: 0.25 } })).value
      .result as ExportOutput;
    expect(out.chain.freight).toBe(0.4);
    expect(out.chain.coldHold).toBe(0.25);
  });
});

describe('validation (Decisions §11)', () => {
  const marinated = skuNamed('Marinated fillet — lemon herb');

  it('refuses to calculate when the fish/marinade split is not 100%', () => {
    const res = domestic({ ...marinated, pctFish: 0.8, pctMarinade: 0.18 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.map((i) => i.code)).toContain('split_not_100');
    expect(res.issues[0]!.message).toContain('98.00%');
  });

  it('accepts every v11 split, so parity is unaffected by the stricter rule', () => {
    for (const sku of v11Skus()) {
      expect(validateCostInput({ market: 'domestic', assumptions: A, sku }), sku.name).toEqual([]);
    }
  });

  it('tolerates float noise in a split that is genuinely 100%', () => {
    // 0.65 + 0.35 and friends do not land on exactly 1 in IEEE754.
    for (const [fish, marinade] of [
      [0.65, 0.35],
      [0.82, 0.18],
      [0.78, 0.22],
      [0.62, 0.38],
    ]) {
      expect(validateCostInput({ market: 'domestic', assumptions: A, sku: { ...marinated, pctFish: fish!, pctMarinade: marinade! } })).toEqual([]);
    }
  });

  it('rejects a zero yield only when the SKU actually carries fish', () => {
    const broken = { ...skuNamed('Skin-on fillet'), baseYield: 0 };
    expect(domestic(broken).ok).toBe(false);
    // An absorbed by-product never divides by yield, so a bad one cannot hurt it.
    expect(domestic({ ...broken, rawMaterialBasis: 'absorbed' }).ok).toBe(true);
  });

  it('requires a destination for export rather than implying zero freight', () => {
    const res = computeCost({ market: 'export', assumptions: A, sku: skuNamed('Skin-on fillet') });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.map((i) => i.code)).toContain('missing_destination');
  });

  it('reports every issue at once rather than the first', () => {
    const res = computeCost({
      market: 'export',
      assumptions: A,
      sku: { ...skuNamed('Skin-on fillet'), baseYield: 0, pctFish: 0.5, pctMarinade: 0.2 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.map((i) => i.code).sort()).toEqual(['invalid_yield', 'missing_destination', 'split_not_100']);
  });
});

describe('determinism', () => {
  it('same inputs always yield the same landed price', () => {
    // Quotes depend on this; Decisions §4 pins an assumptions version per quote
    // precisely so a re-resolve cannot drift.
    const sku = skuNamed('Skin-on fillet');
    const runs = Array.from({ length: 5 }, () => JSON.stringify(exported(sku)));
    expect(new Set(runs).size).toBe(1);
  });
});

describe('target pricing', () => {
  const fillet = skuNamed('Skin-on fillet');

  it('defaults to cost-plus, so every v11 row prices on margin', () => {
    for (const sku of v11Skus()) {
      const out = ok(domestic(sku)).value.result as DomesticOutput;
      expect(sku.pricingMode, sku.name).toBeUndefined();
      expect(out.unglazed.sellingPrice, sku.name).toBeCloseTo(out.unglazed.rackRate, 9);
    }
  });

  it('reports the margin implied by the cost-plus price', () => {
    const out = ok(domestic(fillet)).value.result as DomesticOutput;
    // Rack rate IS cost / (1 - 40%), so the realised margin is the input margin.
    expect(out.unglazed.marginPct).toBeCloseTo(A.margins.rackPct, 9);
  });

  it('uses the target price and derives the margin from it', () => {
    // FINAL is LKR 2,985.06, so LKR 6,000 leaves just over half as margin.
    const out = ok(domestic({ ...fillet, pricingMode: 'target', targetPrice: 6000 })).value
      .result as DomesticOutput;
    expect(out.unglazed.sellingPrice).toBe(6000);
    expect(out.unglazed.marginPct).toBeCloseTo((6000 - out.unglazed.finalCost) / 6000, 9);
    // The cost-plus price stays available for comparison rather than being lost.
    expect(out.unglazed.rackRate).toBeCloseTo(4975.09, 2);
  });

  it('reports a negative margin when the target sits below cost', () => {
    // Worth surfacing rather than clamping: pricing below cost is the answer
    // the question was asked to find.
    const out = ok(domestic({ ...fillet, pricingMode: 'target', targetPrice: 2000 })).value
      .result as DomesticOutput;
    expect(out.unglazed.marginPct).toBeLessThan(0);
  });

  it('falls back to cost-plus when the target is blank or zero', () => {
    const plus = ok(domestic(fillet)).value.result as DomesticOutput;
    for (const targetPrice of [null, 0]) {
      const out = ok(domestic({ ...fillet, pricingMode: 'target', targetPrice })).value
        .result as DomesticOutput;
      expect(out.unglazed.sellingPrice).toBeCloseTo(plus.unglazed.rackRate, 9);
    }
  });

  it('ignores a target while the SKU prices on margin', () => {
    const out = ok(domestic({ ...fillet, pricingMode: 'margin', targetPrice: 6000 })).value
      .result as DomesticOutput;
    expect(out.unglazed.sellingPrice).toBeCloseTo(out.unglazed.rackRate, 9);
  });

  it('carries a target FOB through CIF and the whole export chain', () => {
    const base = ok(exported(fillet)).value.result as ExportOutput;
    const out = ok(exported({ ...fillet, pricingMode: 'target', targetPrice: 14 })).value
      .result as ExportOutput;

    expect(out.frozenPlain.sellingPrice).toBe(14);
    // CIF builds on what is actually charged, not on the cost-plus FOB.
    expect(out.frozenPlain.cif).toBeCloseTo(14 + out.frozenPlain.freightPerKg, 9);
    expect(out.frozenPlain.cif).toBeGreaterThan(base.frozenPlain.cif);
    expect(out.frozenPlain.distributorT3).toBeGreaterThan(base.frozenPlain.distributorT3);
    // The cost-plus FOB is still reported, so the gap is visible.
    expect(out.frozenPlain.fob).toBeCloseTo(base.frozenPlain.fob, 9);
  });

  it('prices fresh and frozen off the same target but different freight', () => {
    const out = ok(exported({ ...fillet, pricingMode: 'target', targetPrice: 14 })).value
      .result as ExportOutput;
    expect(out.fresh.sellingPrice).toBe(14);
    expect(out.frozenPlain.sellingPrice).toBe(14);
    // Same FOB, diverging only on the air leg.
    expect(out.fresh.cif).toBeGreaterThan(out.frozenPlain.cif);
  });

  it('gives a glazed state a better margin at the same target', () => {
    // Glaze lowers FINAL, so selling at one price earns more on the glazed run.
    const out = ok(domestic({ ...fillet, glazePct: 0.2, pricingMode: 'target', targetPrice: 6000 }))
      .value.result as DomesticOutput;
    expect(out.glazed.marginPct!).toBeGreaterThan(out.unglazed.marginPct!);
  });
});
