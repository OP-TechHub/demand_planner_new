// The composite chain, from a sub-product list to a price per pack.
//
// A composite SKU is costed from what goes into ONE unit of it — the rice, the
// chopsuey, the fish and the curry in a rice pack. Each sub-product has its own
// price, which is the main thing, and may also carry a list of other
// ingredients used for it, whose cost is ADDED on top:
//
//     sub-product cost = qty x price + other ingredients / units they cover
//
// The engine only ever sees one number: the total of all of that, per kg, in
// LKR. Everything between the list and that number lives in packages/shared,
// so this is where it is pinned.
//
// Lives here for the reason marinade-recipe.test.ts does: the helpers are pure,
// and this package is where the costing arithmetic is held to account. Imported
// by relative path so nothing has to be built first.
import { describe, expect, it } from 'vitest';
import {
  componentCostLkr,
  componentIngredientsLkr,
  compositeCostLkr,
  compositeLkrPerKg,
  costUnitKg,
  type CostComponentInput,
} from '../../shared/src/index';
import { computeCost } from '../src/costing';
import type { CostSku, DomesticOutput, ExportOutput } from '../src/costing';
import { selectedDestination, skuNamed, v11Assumptions } from './v11';

/**
 * A 450 g rice pack.
 *
 *   Rice           0.20 kg at LKR 220/kg                         =  44.00
 *     + used for it, per pack:
 *         garlic        10 g at 1,200/kg =  12.00
 *         vegetables    50 g at   400/kg =  20.00
 *                                                 ingredients    =  32.00
 *                                                 rice line      =  76.00
 *
 *   Chopsuey       0.10 kg at LKR 600/kg                         =  60.00
 *   Fish portion   0.10 kg at LKR 2,400/kg                       = 240.00
 *
 *   Chicken curry  0.08 kg at LKR 900/kg (the chicken itself)    =  72.00
 *     + used for it, for a cooked batch that does 12 packs:
 *         onion        300 g at   400/kg = 120.00
 *         spice mix     60 g at 2,500/kg = 150.00
 *                                  batch = 270.00  ÷ 12 packs    =  22.50
 *                                                 curry line     =  94.50
 *
 *                                                  per pack      = 470.50
 */
const RICE_EXTRAS = [
  { ingredient: 'Garlic', qty_g: 10, price_lkr_per_kg: 1200 },
  { ingredient: 'Mixed vegetables', qty_g: 50, price_lkr_per_kg: 400 },
];
const CURRY_EXTRAS = [
  { ingredient: 'Onion', qty_g: 300, price_lkr_per_kg: 400 },
  { ingredient: 'Spice mix', qty_g: 60, price_lkr_per_kg: 2500 },
];

const RICE: CostComponentInput = {
  name: 'Rice', qty: 0.2, unit: 'kg', price_lkr_per_unit: 220,
  recipe: { output_qty: 1, lines: RICE_EXTRAS },
};
const CHOPSUEY: CostComponentInput = { name: 'Chopsuey', qty: 0.1, unit: 'kg', price_lkr_per_unit: 600, recipe: null };
const FISH: CostComponentInput = { name: 'Fish portion', qty: 0.1, unit: 'kg', price_lkr_per_unit: 2400, recipe: null };
const CURRY: CostComponentInput = {
  name: 'Chicken curry', qty: 0.08, unit: 'kg', price_lkr_per_unit: 900,
  recipe: { output_qty: 12, lines: CURRY_EXTRAS },
};

const RICE_PACK = [RICE, CHOPSUEY, FISH, CURRY];
const PACK_G = 450;

describe('a sub-product’s other ingredients', () => {
  it('are their total, shared over the finished units they cover', () => {
    expect(componentIngredientsLkr(RICE_EXTRAS, 1)).toBeCloseTo(32, 9);
    expect(componentIngredientsLkr(CURRY_EXTRAS, 12)).toBeCloseTo(22.5, 9);
  });

  it('cannot be shared over no units at all', () => {
    expect(componentIngredientsLkr(CURRY_EXTRAS, 0)).toBeNull();
    expect(componentIngredientsLkr(CURRY_EXTRAS, -1)).toBeNull();
  });
});

describe('a sub-product’s cost', () => {
  it('is its own quantity at its own price when it has no other ingredients', () => {
    expect(componentCostLkr(CHOPSUEY)).toBeCloseTo(60, 9);
    expect(componentCostLkr(FISH)).toBeCloseTo(240, 9);
  });

  it('ADDS the other ingredients to its own price — it never replaces it', () => {
    // Rice is priced as rice (44) and the garlic and vegetables come on top
    // (32). Neither figure stands in for the other.
    expect(componentCostLkr(RICE)).toBeCloseTo(44 + 32, 9);
    expect(componentCostLkr(CURRY)).toBeCloseTo(72 + 22.5, 9);
    // Taking the list away leaves exactly the sub-product's own price behind.
    expect(componentCostLkr({ ...RICE, recipe: null })).toBeCloseTo(44, 9);
  });

  it('still carries the ingredients when the main price is zero', () => {
    // A sub-product made entirely in-house from what is listed under it.
    expect(componentCostLkr({ ...RICE, price_lkr_per_unit: 0 })).toBeCloseTo(32, 9);
  });

  it('does not scale the ingredients by the sub-product’s quantity', () => {
    // The list is written per finished unit (or per batch of them), not per kg
    // of rice — doubling the rice in the pack does not double the garlic.
    expect(componentCostLkr({ ...RICE, qty: 0.4 })).toBeCloseTo(88 + 32, 9);
  });
});

describe('the sub-product total', () => {
  it('is every sub-product, ingredients included, per pack', () => {
    expect(compositeCostLkr(RICE_PACK)).toBeCloseTo(470.5, 9);
  });

  it('is zero for an empty list, not an error', () => {
    expect(compositeCostLkr([])).toBe(0);
  });
});

describe('the finished product’s unit', () => {
  it('needs no weight when the unit is kg', () => {
    expect(costUnitKg('kg', null)).toBe(1);
    // Rows from a database that predates the unit columns read as kg.
    expect(costUnitKg(undefined, undefined)).toBe(1);
    expect(compositeLkrPerKg(470.5, 'kg', null)).toBe(470.5);
  });

  it('converts a per-pack total to per kg by the pack weight', () => {
    expect(costUnitKg('pack', PACK_G)).toBeCloseTo(0.45, 9);
    expect(compositeLkrPerKg(470.5, 'pack', PACK_G)).toBeCloseTo(470.5 / 0.45, 9);
  });

  it('refuses to guess a weight it was not given', () => {
    expect(costUnitKg('pack', null)).toBeNull();
    expect(costUnitKg('pack', 0)).toBeNull();
    expect(compositeLkrPerKg(470.5, 'pack', null)).toBeNull();
    // And no total is no total, whatever the unit.
    expect(compositeLkrPerKg(null, 'kg', null)).toBeNull();
  });
});

describe('a rice pack, costed end to end', () => {
  const A = v11Assumptions();
  // Downstream costs borrowed from a real SKU, so they are the engine's own.
  const base = skuNamed('Skin-on fillet');
  const perKgLkr = compositeLkrPerKg(compositeCostLkr(RICE_PACK), 'pack', PACK_G)!;
  const sku: CostSku = {
    ...base,
    name: 'Rice pack 450 g',
    rawMaterialBasis: 'composite',
    compositeCostLkrPerKg: perKgLkr,
    glazePct: 0,
  };
  const kg = costUnitKg('pack', PACK_G)!;

  it('puts exactly the pack total back into one pack’s raw material', () => {
    const res = computeCost({ market: 'domestic', assumptions: A, sku });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = res.value.result as DomesticOutput;
    // Per kg in the engine, per pack once multiplied back by the pack weight:
    // the LKR 470.50 that was entered, to the cent.
    expect(out.chain.rawMaterial * kg).toBeCloseTo(470.5, 6);
    // Adders are per kg, so a pack carries its weight's share of each.
    const adders = out.chain.process + out.chain.packing + out.chain.coldHold + out.chain.freight;
    expect(out.chain.finalCost * kg).toBeCloseTo(470.5 + adders * kg, 6);
    // And the pack's price is the pack's cost at the same rack margin.
    expect(out.unglazed.sellingPrice * kg).toBeCloseTo((out.chain.finalCost * kg) / (1 - A.margins.rackPct), 6);
  });

  it('converts the LKR total at the version’s FX rate for export', () => {
    const res = computeCost({ market: 'export', assumptions: A, sku, destination: selectedDestination() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = res.value.result as ExportOutput;
    expect(out.chain.rawMaterial * kg).toBeCloseTo(470.5 / A.fxRate, 6);
    expect(out.frozenPlain.sellingPrice).toBeCloseTo(out.chain.finalCost / (1 - A.margins.fobPct), 9);
  });
});
