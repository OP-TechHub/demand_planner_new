// The composite chain, from a batch of sub-products to a price per pack.
//
// A composite SKU is costed the way a kitchen works: for one BATCH, divided
// down to one finished unit.
//
//     sub-product   = qty x price + other ingredients x batch / units they cover
//     batch cost    = sum(sub-products) + sum(overheads)
//     cost per unit = batch cost / units the batch makes
//
// Each sub-product has its own price, which is the main thing, and may carry a
// list of other ingredients used for it, whose cost is ADDED on top. The
// engine only ever sees one number: the per-unit total, per kg, in LKR.
// Everything between the lists and that number lives in packages/shared, so
// this is where it is pinned.
//
// Lives here for the reason marinade-recipe.test.ts does: the helpers are pure,
// and this package is where the costing arithmetic is held to account. Imported
// by relative path so nothing has to be built first.
import { describe, expect, it } from 'vitest';
import {
  componentBatchCostLkr,
  componentCostLkr,
  componentIngredientsLkr,
  compositeBreakdownLkr,
  compositeCostLkr,
  compositeLkrPerKg,
  costUnitKg,
  type CostComponentInput,
  type CostOverheadInput,
} from '../../shared/src/index';
import { computeCost } from '../src/costing';
import type { CostSku, DomesticOutput, ExportOutput } from '../src/costing';
import { selectedDestination, skuNamed, v11Assumptions } from './v11';

// ---------------------------------------------------------------------------
// The rules, on a small hand-checkable pack entered per unit (batch of 1).
// ---------------------------------------------------------------------------

/**
 * A 450 g rice pack, entered per pack.
 *
 *   Rice           0.20 kg at 220                    =  44.00
 *     + garlic 10 g at 1,200, vegetables 50 g at 400 =  32.00   → 76.00
 *   Chopsuey       0.10 kg at 600                    =  60.00
 *   Fish portion   0.10 kg at 2,400                  = 240.00
 *   Chicken curry  0.08 kg at 900                    =  72.00
 *     + onion 300 g at 400, spice 60 g at 2,500 = 270, enough for 12 packs
 *                                                    =  22.50   → 94.50
 *                                          per pack  = 470.50
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
  name: 'Rice', qty: 0.2, unit: 'kg', price_lkr_per_unit: 220, recipe: { output_qty: 1, lines: RICE_EXTRAS },
};
const CHOPSUEY: CostComponentInput = { name: 'Chopsuey', qty: 0.1, unit: 'kg', price_lkr_per_unit: 600, recipe: null };
const FISH: CostComponentInput = { name: 'Fish portion', qty: 0.1, unit: 'kg', price_lkr_per_unit: 2400, recipe: null };
const CURRY: CostComponentInput = {
  name: 'Chicken curry', qty: 0.08, unit: 'kg', price_lkr_per_unit: 900, recipe: { output_qty: 12, lines: CURRY_EXTRAS },
};
const RICE_PACK = [RICE, CHOPSUEY, FISH, CURRY];
const PACK_G = 450;

describe('a sub-product’s other ingredients', () => {
  it('are their total, shared over the finished units they are enough for', () => {
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
    expect(componentCostLkr(RICE)).toBeCloseTo(44 + 32, 9);
    expect(componentCostLkr(CURRY)).toBeCloseTo(72 + 22.5, 9);
    // Taking the list away leaves exactly the sub-product's own price behind.
    expect(componentCostLkr({ ...RICE, recipe: null })).toBeCloseTo(44, 9);
  });

  it('still carries the ingredients when the main price is zero', () => {
    expect(componentCostLkr({ ...RICE, price_lkr_per_unit: 0 })).toBeCloseTo(32, 9);
  });

  it('does not scale the ingredients by the sub-product’s quantity', () => {
    // The list says how many finished units it is enough for — doubling the
    // rice in the pack does not double the garlic.
    expect(componentCostLkr({ ...RICE, qty: 0.4 })).toBeCloseTo(88 + 32, 9);
  });
});

describe('the per-unit total', () => {
  it('is every sub-product, ingredients included', () => {
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
    expect(compositeLkrPerKg(null, 'kg', null)).toBeNull();
  });
});

describe('batches', () => {
  it('cost the same per unit whether entered per unit or per batch', () => {
    // The pack above, scaled up to a batch of 12: every own quantity x 12, and
    // every ingredient list still saying how many packs IT is enough for.
    const batch = RICE_PACK.map((c) => ({ ...c, qty: c.qty * 12 }));
    expect(compositeCostLkr(batch, 12)).toBeCloseTo(470.5, 9);
    expect(compositeBreakdownLkr(batch, 12)!.batchLkr).toBeCloseTo(470.5 * 12, 9);
  });

  it('charge a bulk sub-recipe only the share this batch uses', () => {
    // The curry list is enough for 12 packs. A batch of 6 is charged half of it.
    expect(componentBatchCostLkr({ ...CURRY, qty: 0 }, 6)).toBeCloseTo(270 / 2, 9);
    // And a batch of 12, all of it.
    expect(componentBatchCostLkr({ ...CURRY, qty: 0 }, 12)).toBeCloseTo(270, 9);
  });

  it('spread overheads over the units the batch makes', () => {
    const overheads: CostOverheadInput[] = [{ name: 'Labour', amount_lkr: 600 }];
    const b = compositeBreakdownLkr([], 12, overheads)!;
    expect(b.overheadsBatchLkr).toBe(600);
    expect(b.perUnitLkr).toBeCloseTo(50, 9);
  });

  it('have no per-unit figure for a batch that makes nothing', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(compositeBreakdownLkr(RICE_PACK, bad), String(bad)).toBeNull();
      expect(compositeCostLkr(RICE_PACK, bad), String(bad)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Acceptance: a real kitchen costing sheet, reproduced.
//
// "Garlic Rice, Vegetable Chop Suey with Pan-Fried Barra" — a batch of 12
// packs, with a gravy made 48 cups at a time. The sheet's figures are the
// oracle; nothing here is seeded into the app. Each of the sheet's component
// groups is one sub-product, and the group's subtotal is that sub-product's
// batch cost.
//
// The sheet's own per-pack breakdown double-counts the frying oil (it sits in
// two SUM ranges) and shows chop suey at 637.39. That is the sheet's bug, not
// a figure to match: the oil belongs to the fish and is counted there once.
// ---------------------------------------------------------------------------

const g = (kg: number) => kg * 1000;
const SOY = 400 / 0.385; // bought as 385 g for LKR 400
const VINEGAR = 210 / 0.35;
const GINGER_PASTE = 1125 / 0.225;

/** Everything the sheet costs per kg or per piece, so one price change reaches every line using it. */
const PRICES = {
  basmati: 740, butter: 1750, cookingOil: 1250, garlic: 900, onion: 400,
  carrot: 400, potato: 400, cabbage: 320, beans: 440, pepper: 2500, cornFlour: 900, salt: 275,
  soy: SOY, sesameOil: 3500, oyster: 1040,
  sunflowerOil: 1560, coriander: 625, lime: 2000, limeGravy: 1500, barraPortions: 1200, barraMeat: 700,
  garlicPaste: 2200, turmeric: 3000, chilli: 1790, sesameSeed: 2295,
  vinegar: VINEGAR, brownSugar: 320, gingerPaste: GINGER_PASTE,
};
type Prices = typeof PRICES;

const BATCH_PACKS = 12;
const GRAVY_CUPS = 48;

const line = (ingredient: string, kg: number, price: number) => ({ ingredient, qty_g: g(kg), price_lkr_per_kg: price });

function gravyLines(p: Prices) {
  return [
    line('Barra Meat', 0.15, p.barraMeat), line('Salt', 0.005, p.salt), line('Corn Flour', 0.03, p.cornFlour),
    line('Pepper', 0.003, p.pepper), line('Chilli Powder', 0.007, p.chilli), line('Vinegar', 0.02, p.vinegar),
    line('Brown Sugar', 0.025, p.brownSugar), line('Soy Sauce', 0.08, p.soy), line('Oyster Sauce', 0.08, p.oyster),
    line('Lime', 0.09, p.limeGravy), line('Ginger Paste', 0.03, p.gingerPaste), line('Garlic Paste', 0.02, p.garlicPaste),
    line('Sesame Oil', 0.01, p.sesameOil), line('Water', 0.65, 0),
  ];
}

function meal(p: Prices): CostComponentInput[] {
  return [
    {
      // The rice itself is the main price; what is cooked into it comes on top.
      name: 'Rice', qty: 1, unit: 'kg', price_lkr_per_unit: p.basmati,
      recipe: {
        output_qty: BATCH_PACKS,
        lines: [line('Butter', 0.1, p.butter), line('Cooking Oil', 0.07, p.cookingOil), line('Garlic', 0.36, p.garlic), line('Onion', 0.16, p.onion)],
      },
    },
    {
      // No single main item: everything in it is an ingredient.
      name: 'Chop suey', qty: 0, unit: 'kg', price_lkr_per_unit: 0,
      recipe: {
        output_qty: BATCH_PACKS,
        lines: [
          line('Carrot', 0.3, p.carrot), line('Potato', 0.3, p.potato), line('Cabbage', 0.15, p.cabbage), line('Beans', 0.3, p.beans),
          line('Pepper', 0.007, p.pepper), line('Corn Flour', 0.015, p.cornFlour), line('Salt', 0.04, p.salt),
          line('Soy Sauce', 0.005, p.soy), line('Sesame Oil', 0.01, p.sesameOil), line('Oyster Sauce', 0.01, p.oyster),
        ],
      },
    },
    {
      // 60 g x 12 portions; the frying oil lives here and nowhere else.
      name: 'Fish', qty: 0.72, unit: 'kg', price_lkr_per_unit: p.barraPortions,
      recipe: {
        output_qty: BATCH_PACKS,
        lines: [
          line('Sunflower Oil', 0.08, p.sunflowerOil), line('Coriander Leaf', 0.05, p.coriander), line('Lime', 0.03, p.lime),
          line('Garlic Paste', 0.005, p.garlicPaste), line('Turmeric Powder', 0.002, p.turmeric),
          line('Chilli Powder', 0.002, p.chilli), line('Sesame Seed', 0.02, p.sesameSeed),
        ],
      },
    },
    // Packaging is counted in pieces, one of each per pack.
    { name: 'Container', qty: 12, unit: 'pcs', price_lkr_per_unit: 36, recipe: null },
    { name: 'Sauce Cup', qty: 12, unit: 'pcs', price_lkr_per_unit: 10, recipe: null },
    { name: 'Cutlery', qty: 12, unit: 'pcs', price_lkr_per_unit: 20, recipe: null },
    { name: 'Sticker', qty: 12, unit: 'pcs', price_lkr_per_unit: 10, recipe: null },
    // A sub-recipe made in bulk: the list fills 48 cups, one cup goes in each
    // pack, so this batch of 12 is charged 12/48 of what the gravy cost.
    { name: 'Gravy', qty: 0, unit: 'cup', price_lkr_per_unit: 0, recipe: { output_qty: GRAVY_CUPS, lines: gravyLines(p) } },
  ];
}

const OVERHEADS: CostOverheadInput[] = [
  { name: 'Labour', amount_lkr: 800 },
  { name: 'Electricity', amount_lkr: 71.06 },
  { name: 'Gas', amount_lkr: 71.06 },
  { name: 'Transport', amount_lkr: 50 },
];

/** cost ÷ (1 − margin): a gross margin on the selling price, not a markup. */
const priceAt = (cost: number, margin: number) => cost / (1 - margin);
const cents = 2; // ±0.005, inside the sheet's ±0.01 tolerance

describe('acceptance: garlic rice, chop suey and pan-fried barra', () => {
  const b = compositeBreakdownLkr(meal(PRICES), BATCH_PACKS, OVERHEADS)!;
  const group = (...names: string[]) =>
    b.components.filter((c) => names.includes(c.name)).reduce((s, c) => s + c.batchLkr, 0);

  it('costs the gravy sub-recipe: batch 703.72, 48 cups, 14.66 a cup', () => {
    const lines = gravyLines(PRICES);
    expect(componentIngredientsLkr(lines, 1)).toBeCloseTo(703.72, cents);
    expect(componentIngredientsLkr(lines, GRAVY_CUPS)).toBeCloseTo(14.66, cents);
  });

  it('matches every group subtotal', () => {
    expect(group('Rice')).toBeCloseTo(1390.5, cents);
    expect(group('Chop suey')).toBeCloseTo(512.59, cents);
    expect(group('Fish')).toBeCloseTo(1146.53, cents);
    expect(group('Container', 'Sauce Cup', 'Cutlery', 'Sticker')).toBeCloseTo(912, cents);
    expect(group('Gravy')).toBeCloseTo(175.93, cents);
    expect(b.overheadsBatchLkr).toBeCloseTo(992.12, cents);
  });

  it('matches the batch cost, the cost per pack and the selling price', () => {
    expect(b.batchLkr).toBeCloseTo(5129.68, cents);
    expect(b.perUnitLkr).toBeCloseTo(427.47, cents);
    expect(priceAt(b.perUnitLkr, 0.39)).toBeCloseTo(700.78, cents);
    // 39% applied as a markup would give 594.19 — the wrong reading.
    expect(priceAt(b.perUnitLkr, 0.39)).not.toBeCloseTo(b.perUnitLkr * 1.39, 0);
  });

  it('has a breakdown that adds up exactly: nothing is counted in two groups', () => {
    const perUnit = [...b.components, ...b.overheads].reduce((s, x) => s + x.perUnitLkr, 0);
    expect(perUnit).toBeCloseTo(b.perUnitLkr, 9);
    expect(b.componentsBatchLkr + b.overheadsBatchLkr).toBeCloseTo(b.batchLkr, 9);
  });

  it('follows a price change: basmati 740 → 800', () => {
    const up = compositeBreakdownLkr(meal({ ...PRICES, basmati: 800 }), BATCH_PACKS, OVERHEADS)!;
    expect(up.batchLkr).toBeCloseTo(5189.68, cents);
    expect(up.perUnitLkr).toBeCloseTo(432.47, cents);
    expect(priceAt(up.perUnitLkr, 0.39)).toBeCloseTo(708.97, cents);
  });

  it('follows a price used in both the meal and the gravy: salt 275 → 375', () => {
    const p = { ...PRICES, salt: 375 };
    const up = compositeBreakdownLkr(meal(p), BATCH_PACKS, OVERHEADS)!;
    expect(componentIngredientsLkr(gravyLines(p), GRAVY_CUPS)).toBeCloseTo(14.6713, 4);
    // +4.00 from the meal's own salt, +0.125 from its share of the gravy's.
    expect(up.batchLkr - b.batchLkr).toBeCloseTo(4.125, 6);
    expect(up.perUnitLkr).toBeCloseTo(427.82, cents);
  });

  it('follows a margin change: 39% → 30%', () => {
    expect(priceAt(b.perUnitLkr, 0.3)).toBeCloseTo(610.68, cents);
  });

  it('reaches the same selling price through the costing engine', () => {
    // The app's real path: per-pack total → per kg → engine → back to a pack.
    // The per-kg fish adders are zeroed and the margin set to the sheet's 39%,
    // which is how this product would be set up on the SKU screen.
    const A = v11Assumptions();
    const packG = 400;
    const kg = costUnitKg('pack', packG)!;
    const sku: CostSku = {
      ...skuNamed('Skin-on fillet'),
      name: 'Garlic rice meal',
      rawMaterialBasis: 'composite',
      compositeCostLkrPerKg: compositeLkrPerKg(b.perUnitLkr, 'pack', packG),
      glazePct: 0,
      processUsdPerKg: 0,
      packingUsdPerKg: 0,
      overrides: { rackMarginPct: 0.39, transportLkr: 0, coldHoldLkr: 0 },
    };
    const res = computeCost({ market: 'domestic', assumptions: A, sku });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = res.value.result as DomesticOutput;
    expect(out.chain.finalCost * kg).toBeCloseTo(427.47, cents);
    expect(out.unglazed.sellingPrice * kg).toBeCloseTo(700.78, cents);
    // The pack weight cancels out: it converts to per kg and straight back.
    expect(out.unglazed.marginPct).toBeCloseTo(0.39, 9);
  });
});

// ---------------------------------------------------------------------------
// End to end through the engine, with the engine's own adders left on.
// ---------------------------------------------------------------------------

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
    expect(out.chain.rawMaterial * kg).toBeCloseTo(470.5, 6);
    // Adders are per kg, so a pack carries its weight's share of each.
    const adders = out.chain.process + out.chain.packing + out.chain.coldHold + out.chain.freight;
    expect(out.chain.finalCost * kg).toBeCloseTo(470.5 + adders * kg, 6);
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
