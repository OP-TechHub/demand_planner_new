// Base whole-fish cost, ex-farm. Decisions §3, §6.
//
// This is the one part of the model that is genuinely shared between the two
// markets: feed, clearing, FCR and ODC are entered once. Export differs on
// exactly one line — import tax is 0 (duty drawback).
import type { CostAssumptions, Market, OdcComponent, SizeBucket, WholeFishCost } from './types';

/** A component's value in USD. LKR values convert at the assumptions' FX rate. */
export function componentUsd(c: OdcComponent, fxRate: number): number {
  return c.currency === 'USD' ? c.value : c.value / fxRate;
}

/**
 * ODC per kg of fish.
 *
 * Without a bucket this is the flat sum of components — the ~1000 g reference.
 * With a bucket, per-fish components (fingerling, vaccine) amortise over the
 * median weight while per-kg components stay flat:
 *
 *   ODC(bucket) = sum(per_kg) + sum(per_fish) / median_kg
 *
 * Small fish therefore carry much higher ODC/kg — a fingerling spread over
 * 300 g costs more per kg than the same fingerling spread over 3.1 kg.
 */
export function odcTotalUsd(a: CostAssumptions, bucket?: SizeBucket | null): number {
  if (!bucket) {
    return a.odc.reduce((sum, c) => sum + componentUsd(c, a.fxRate), 0);
  }
  const medianKg = bucket.medianG / 1000;
  let perKg = 0;
  let perFish = 0;
  for (const c of a.odc) {
    const usd = componentUsd(c, a.fxRate);
    if (c.basis === 'per_fish') perFish += usd;
    else perKg += usd;
  }
  // A zero median would be bad bucket data, not a costing outcome — treat the
  // per-fish components as unamortisable rather than returning Infinity.
  return medianKg > 0 ? perKg + perFish / medianKg : perKg;
}

/**
 * Effective feed cost: tax applies to the feed only, and clearing is added
 * AFTER tax rather than being taxed itself.
 */
export function effectiveFeedCostUsd(a: CostAssumptions, market: Market): number {
  return a.feedCostPerKg * (1 + a.importTaxPct[market]) + a.clearingCostPerKg;
}

/**
 * Whole fish cost, ex-farm. Only FCR and ODC vary by size bucket; feed price,
 * clearing and tax do not.
 */
export function wholeFishCost(a: CostAssumptions, market: Market, bucket?: SizeBucket | null): WholeFishCost {
  const effectiveFeedCostUsdValue = effectiveFeedCostUsd(a, market);
  const fcrUsed = bucket ? bucket.fcr : a.fcrReference;
  const feedCostPerKgFishUsd = effectiveFeedCostUsdValue * fcrUsed;
  const odcUsd = odcTotalUsd(a, bucket);
  const wholeFishUsd = feedCostPerKgFishUsd + odcUsd;
  return {
    effectiveFeedCostUsd: effectiveFeedCostUsdValue,
    feedCostPerKgFishUsd,
    odcUsd,
    wholeFishUsd,
    wholeFishLkr: wholeFishUsd * a.fxRate,
    fcrUsed,
  };
}
