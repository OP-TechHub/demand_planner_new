// The marinade cost chain, pinned against a real recipe sheet.
//
// Marinade cost used to be one typed USD figure. It is now built from the
// ingredients, and the arithmetic that turns eleven LKR rows into that one
// figure is the whole point — get it wrong and every marinated SKU is mispriced
// with nothing on screen to show why.
//
// The test lives here rather than in apps/web because the helper is pure and
// this package is where the costing arithmetic is pinned. It imports from
// packages/shared the same way costing-base-cost-mask.test.ts reaches into
// apps/web: by relative path, so nothing has to be built first.
import { describe, expect, it } from 'vitest';
import { marinadeCostFromLines } from '../../shared/src/index';

/**
 * The non-fish rows of the fish-cutlet recipe sheet the builder replaces.
 *
 * Fish is absent on purpose. The sheet's first line is 870 g of fish at
 * LKR 1,034/kg, and it must NOT be entered here: the engine already carries
 * fish as whole-fish cost / yield, so pricing it again in the marinade would
 * charge for it twice.
 *
 * Eggs are absent too, and for a duller reason: the sheet prices them per egg
 * (3 at LKR 60), not per kilo, and this builder is per kilo throughout. They
 * belong here as a weight at a price per kilo.
 */
const CUTLET = [
  { ingredient: 'Chilli and garlic sauce (KIST)', qty_g: 50, price_lkr_per_kg: 1466 },
  { ingredient: 'Soy sauce (MD)', qty_g: 20, price_lkr_per_kg: 760 },
  { ingredient: 'Lime', qty_g: 40, price_lkr_per_kg: 2000 },
  { ingredient: 'Chilli powder (WIJAYA)', qty_g: 6, price_lkr_per_kg: 260 },
  { ingredient: 'Black pepper powder (WIJAYA)', qty_g: 6, price_lkr_per_kg: 4200 },
  { ingredient: 'Cumin powder (WIJAYA)', qty_g: 4, price_lkr_per_kg: 3700 },
  { ingredient: 'Salt (RAIGAM ISI)', qty_g: 8, price_lkr_per_kg: 275 },
  { ingredient: 'Garam masala powder (SAKTHI)', qty_g: 8, price_lkr_per_kg: 5200 },
  { ingredient: 'Bread crumbs (MDK)', qty_g: 100, price_lkr_per_kg: 860 },
  { ingredient: 'Sunflower oil', qty_g: 400, price_lkr_per_kg: 1590 },
];

/** What the sheet's own Batch Cost column says, row for row. */
const LINE_COSTS = [73.3, 15.2, 80, 1.56, 25.2, 14.8, 2.2, 41.6, 86, 636];

const FX = 340;

describe('marinade cost from ingredients', () => {
  it('costs each line as qty_g x LKR/kg / 1000', () => {
    for (const [i, l] of CUTLET.entries()) {
      expect((l.qty_g * l.price_lkr_per_kg) / 1000).toBeCloseTo(LINE_COSTS[i]!, 2);
    }
  });

  it('totals the lines in LKR', () => {
    const r = marinadeCostFromLines(CUTLET, 642, FX)!;
    expect(r.totalLkr).toBeCloseTo(975.86, 2);
    expect(r.totalLkr).toBeCloseTo(
      LINE_COSTS.reduce((a, b) => a + b, 0),
      2
    );
  });

  it('divides by the total dose, scales to a kilo, then converts once at FX', () => {
    // Dose = the sum of the quantities: the case where nothing is lost.
    const r = marinadeCostFromLines(CUTLET, 642, FX)!;
    expect(r.lkrPerKg).toBeCloseTo(1520.03, 2); // 975.86 / 642 x 1000
    expect(r.usdPerKg).toBeCloseTo(4.4707, 4); // / 340
  });

  it('recovers more per kilo when the batch loses weight in cooking', () => {
    // The reason total dose is entered rather than summed. 642 g of marinade
    // going in, 330 g of it retained in the finished product: the same rupees
    // are spread over half the weight, so the cost per kg is roughly double.
    const asDosed = marinadeCostFromLines(CUTLET, 642, FX)!;
    const asRetained = marinadeCostFromLines(CUTLET, 330, FX)!;

    expect(asRetained.lkrPerKg).toBeCloseTo(2957.15, 2);
    expect(asRetained.usdPerKg).toBeCloseTo(8.6975, 4);
    expect(asRetained.usdPerKg).toBeGreaterThan(asDosed.usdPerKg);
    // Same total spend either way — only the divisor moved.
    expect(asRetained.totalLkr).toBeCloseTo(asDosed.totalLkr, 6);
  });

  it('scales the answer with FX, and nothing else', () => {
    const at340 = marinadeCostFromLines(CUTLET, 642, 340)!;
    const at325 = marinadeCostFromLines(CUTLET, 642, 325)!;
    expect(at325.lkrPerKg).toBeCloseTo(at340.lkrPerKg, 6);
    expect(at325.usdPerKg).toBeCloseTo(at340.lkrPerKg / 325, 6);
  });

  it('refuses to divide by a dose or an FX rate of zero', () => {
    expect(marinadeCostFromLines(CUTLET, 0, FX)).toBeNull();
    expect(marinadeCostFromLines(CUTLET, -1, FX)).toBeNull();
    expect(marinadeCostFromLines(CUTLET, 642, 0)).toBeNull();
  });

  it('costs an empty recipe at zero rather than failing', () => {
    // Reached constantly while the first row is still being typed.
    const r = marinadeCostFromLines([], 100, FX)!;
    expect(r.totalLkr).toBe(0);
    expect(r.usdPerKg).toBe(0);
  });
});
