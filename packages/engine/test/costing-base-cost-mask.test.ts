// The base-cost mask has to be invisible in the arithmetic.
//
// Hiding what the fish costs to grow cannot change what anything costs: the
// grid, the SKU dialog and the sheet previews all price in the browser, so a
// user without the grant is sent a rewritten set of assumptions instead of the
// real one (apps/web/lib/costing-base-cost.ts). If that rewrite is off by a
// fraction, two people looking at the same SKU see two different prices and
// only one of them is right.
//
// The test lives here rather than in apps/web because what it pins is an engine
// identity — wholeFishCost(masked) === wholeFishCost(real), for every market and
// every size bucket. The mask module imports nothing, precisely so it can be
// reached from here without dragging the web app into this package's compile.
import { describe, expect, it } from 'vitest';
import { maskBaseCost } from '../../../apps/web/lib/costing-base-cost';
import { odcTotalUsd, wholeFishCost } from '../src/costing';
import type { CostAssumptions, Market, SizeBucket } from '../src/costing';
import { v11Assumptions, v11Buckets } from './v11';

const A = v11Assumptions();

/**
 * Mask a set of assumptions the way a server page does: engine type -> the row
 * shape the mask works on -> back again.
 */
function maskedAssumptions(a: CostAssumptions): CostAssumptions {
  const { version, odc } = maskBaseCost(
    {
      feed_cost_per_kg: a.feedCostPerKg,
      clearing_cost_per_kg: a.clearingCostPerKg,
      import_tax_pct_domestic: a.importTaxPct.domestic,
      import_tax_pct_export: a.importTaxPct.export,
      fx_rate: a.fxRate,
    },
    a.odc.map((c, i) => ({
      id: `odc-${i}`,
      name: c.name,
      value: c.value,
      currency: c.currency as string,
      basis: c.basis as string,
    }))
  );

  return {
    ...a,
    feedCostPerKg: version.feed_cost_per_kg,
    clearingCostPerKg: version.clearing_cost_per_kg,
    importTaxPct: { domestic: version.import_tax_pct_domestic, export: version.import_tax_pct_export },
    odc: odc.map((c) => ({
      name: c.name,
      value: c.value,
      currency: c.currency as CostAssumptions['odc'][number]['currency'],
      basis: c.basis as CostAssumptions['odc'][number]['basis'],
    })),
  };
}

const MARKETS: Market[] = ['domestic', 'export'];

describe('base-cost mask', () => {
  const M = maskedAssumptions(A);

  it('reproduces the whole-fish cost in both markets, at the flat reference', () => {
    for (const market of MARKETS) {
      const real = wholeFishCost(A, market);
      const masked = wholeFishCost(M, market);
      expect(masked.wholeFishUsd).toBeCloseTo(real.wholeFishUsd, 10);
      expect(masked.wholeFishLkr).toBeCloseTo(real.wholeFishLkr, 10);
    }
  });

  it('reproduces it for every size grade, where ODC amortises over fish weight', () => {
    const buckets: SizeBucket[] = v11Buckets();
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      for (const market of MARKETS) {
        const real = wholeFishCost(A, market, bucket);
        const masked = wholeFishCost(M, market, bucket);
        expect(masked.wholeFishUsd).toBeCloseTo(real.wholeFishUsd, 10);
      }
      expect(odcTotalUsd(M, bucket)).toBeCloseTo(odcTotalUsd(A, bucket), 10);
    }
  });

  it('does not carry the feed price, the clearing cost or the tax position', () => {
    // What it cannot help revealing is the aggregate — the whole-fish cost is
    // on screen. What it must not reveal is the line items behind it.
    expect(M.feedCostPerKg).not.toBeCloseTo(A.feedCostPerKg, 4);
    expect(M.clearingCostPerKg).toBe(0);
    expect(M.importTaxPct.export).toBe(0);
    expect(M.importTaxPct.domestic).not.toBeCloseTo(A.importTaxPct.domestic, 4);
  });

  it('collapses the ODC table to a per-kg and a per-fish total', () => {
    expect(A.odc.length).toBeGreaterThan(2);
    expect(M.odc).toHaveLength(2);
    expect(M.odc.every((c) => c.currency === 'USD')).toBe(true);
    // No component name survives — several of them are supplier-specific.
    for (const real of A.odc) {
      expect(M.odc.some((c) => c.name === real.name)).toBe(false);
    }
  });

  it('leaves FX alone, because every LKR figure on screen already states it', () => {
    expect(M.fxRate).toBe(A.fxRate);
  });

  it('handles an empty ODC table rather than inventing rows', () => {
    const bare = maskedAssumptions({ ...A, odc: [] });
    expect(bare.odc).toEqual([]);
    for (const market of MARKETS) {
      expect(wholeFishCost(bare, market).wholeFishUsd).toBeCloseTo(
        wholeFishCost({ ...A, odc: [] }, market).wholeFishUsd,
        10
      );
    }
  });
});
