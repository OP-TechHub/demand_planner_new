// Spec §2 — derived per-program values (per-path cost and margin).
import type { EngineProgram, PathKey } from './types';

export interface PathCostMargin {
  total_cost_fp: number;
  margin_fp: number;
  margin_wr: number;
}

/** The (bucket, yield) for a path, or null if the program doesn't have it. */
export function pathOf(p: EngineProgram, path: PathKey): { bucket: string; yield: number } | null {
  const bucket = path === 'primary' ? p.primaryBucket : path === 'secondary' ? p.secondaryBucket : p.tertiaryBucket;
  const y = path === 'primary' ? p.primaryYield : path === 'secondary' ? p.secondaryYield : p.tertiaryYield;
  if (!bucket || y == null || y <= 0) return null;
  return { bucket, yield: y };
}

/**
 * Per-path cost/margin (spec §2.1). `price`/`barraWr` are parameters so callers
 * can pass time-varying values later; default to the program's flat values.
 * Returns null for a path the program doesn't have (or with zero/invalid yield).
 */
export function pathCostMargin(
  p: EngineProgram,
  path: PathKey,
  price: number = p.price,
  barraWr: number = p.barraCostWr
): PathCostMargin | null {
  const info = pathOf(p, path);
  if (!info) return null;
  const total_cost_fp = barraWr / info.yield + p.packing + p.processing + p.storage + p.freight + p.other;
  const margin_fp = price - total_cost_fp;
  return { total_cost_fp, margin_fp, margin_wr: margin_fp * info.yield };
}

/** The margin value a program is ranked on, per the plan's margin metric (spec §3.1). */
export function rankingMargin(
  p: EngineProgram,
  metric: 'margin_fp' | 'margin_wr' | 'total_contribution'
): number {
  const primary = pathCostMargin(p, 'primary');
  if (!primary) return -Infinity; // unallocatable → lowest priority
  if (metric === 'margin_fp') return primary.margin_fp;
  if (metric === 'margin_wr') return primary.margin_wr;
  // total_contribution = margin_fp[primary] × total demand FP over the horizon
  const totalDemand = p.demand.reduce((s, d) => s + d, 0);
  return primary.margin_fp * totalDemand;
}
