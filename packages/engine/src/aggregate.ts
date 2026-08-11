// Spec §6–§8 — aggregations over the rolling results.
//  §6 Unallocated WR (bucket, month)
//  §7 Program fulfilment + revenue/cost/margin (program, month)
//  §8.1 Annual Summary (FY1..FY5, total_60mo)
// Physical rows (volumes, unallocated) are exact vs Excel; the money rows use
// flat price/cost (time-varying deferred) so they can differ for the handful of
// programs that carry time-varying overrides.
import type { EngineInput, EngineProgram, PathKey } from './types';
import { pathCostMargin } from './derived';
import type { RankedProgram } from './rank';
import type { OwnMonthResult } from './allocate';
import { CHANNELS } from './rolling';
import type { RollingResult } from './rolling';

export interface UnallocatedCell {
  bucketId: string;
  month: number;
  capacity: number;
  ownConsumption: number;
  borrowingsInto: number;
  unallocatedWr: number;
}

export interface FulfilmentCell {
  programId: string;
  month: number;
  demandFp: number;
  rollingFp: number;
  fulfilmentPct: number | null; // null when demand is 0
  unfulfilledWr: number;
  revenue: number;
  cost: number;
  margin: number;
}

export type Period = 'fy1' | 'fy2' | 'fy3' | 'fy4' | 'fy5' | 'total_60mo';
export interface PlanSummaryRow {
  period: Period;
  demandFp: number;
  allocatedFp: number;
  unallocatedFp: number;
  allocatedWr: number;
  unallocatedWr: number;
  revenue: number;
  cost: number;
  margin: number;
  gpPct: number;
  revenueOpportunity: number;
  costOpportunity: number;
  marginOpportunity: number;
  marginGap: number;
}

export interface PipelineCell { bucketId: string; month: number; pipelineWr: number }

export interface AggregateResult {
  unallocated: UnallocatedCell[];
  fulfilment: FulfilmentCell[];
  planSummary: PlanSummaryRow[];
  pipeline: PipelineCell[];
}

const PERIODS: { period: Period; start: number; end: number }[] = [
  { period: 'fy1', start: 0, end: 11 },
  { period: 'fy2', start: 12, end: 23 },
  { period: 'fy3', start: 24, end: 35 },
  { period: 'fy4', start: 36, end: 47 },
  { period: 'fy5', start: 48, end: 59 },
  { period: 'total_60mo', start: 0, end: 59 },
];

export function aggregate(
  input: EngineInput,
  ranked: RankedProgram[],
  own: OwnMonthResult,
  rolling: RollingResult
): AggregateResult {
  const { months, harvest, buckets } = input;
  const programs = new Map(input.programs.map((p) => [p.id, p]));
  const inScope = new Set(ranked.filter((r) => r.inScope).map((r) => r.program.id));

  // --- §6 Unallocated WR ---
  const unallocated: UnallocatedCell[] = [];
  for (const b of buckets) {
    const cap = harvest[b.id] ?? [];
    const cons = own.ownConsumption[b.id] ?? [];
    const drawn = rolling.drawn[b.id] ?? [];
    for (let m = 0; m < months; m++) {
      const ownC = cons[m] ?? 0;
      const into = drawn[m] ?? 0;
      unallocated.push({
        bucketId: b.id,
        month: m,
        capacity: cap[m] ?? 0,
        ownConsumption: ownC,
        borrowingsInto: into,
        unallocatedWr: Math.max(0, (cap[m] ?? 0) - ownC - into),
      });
    }
  }

  // --- §7 Program fulfilment + money ---
  // Excel's financials (Annual Summary rows 16-18) use FLAT price (Programs!M)
  // and FLAT primary total cost (Programs!V) × allocated FP — not per-path, and
  // not the time-varying W/X columns (those feed display + ranking only). Match:
  //   revenue = rolling_fp × price,  cost = rolling_fp × primary_total_cost.
  const primaryCost = new Map<string, number>();
  const costFlat = (p: EngineProgram) => {
    let c = primaryCost.get(p.id);
    if (c == null) { c = pathCostMargin(p, 'primary')?.total_cost_fp ?? 0; primaryCost.set(p.id, c); }
    return c;
  };
  const fulfilment: FulfilmentCell[] = rolling.cells.map((c) => {
    const p = programs.get(c.programId) as EngineProgram;
    const pct = c.demandFp > 0 ? Math.min(1, c.rollingFp / c.demandFp) : null;
    const unfulfilledWr = c.demandFp > 0 && p.primaryYield > 0 ? Math.max(0, (c.demandFp - c.rollingFp) / p.primaryYield) : 0;
    const revenue = c.rollingFp * p.price;
    const cost = c.rollingFp * costFlat(p);
    return { programId: c.programId, month: c.month, demandFp: c.demandFp, rollingFp: c.rollingFp, fulfilmentPct: pct, unfulfilledWr, revenue, cost, margin: revenue - cost };
  });
  const fByKey = new Map(fulfilment.map((f) => [`${f.programId}:${f.month}`, f]));
  const unByKey = new Map(unallocated.map((u) => [`${u.bucketId}:${u.month}`, u]));

  // --- §8.1 Annual Summary ---
  const planSummary: PlanSummaryRow[] = PERIODS.map(({ period, start, end }) => {
    let demandFp = 0, allocatedFp = 0, allocatedWr = 0, revenue = 0, cost = 0, revOpp = 0, costOpp = 0;
    for (const r of ranked) {
      if (!inScope.has(r.program.id)) continue;
      const p = r.program;
      for (let m = start; m <= end; m++) {
        const f = fByKey.get(`${p.id}:${m}`);
        if (!f) continue;
        demandFp += f.demandFp;
        allocatedFp += f.rollingFp;
        revenue += f.revenue;
        cost += f.cost;
        revOpp += f.demandFp * p.price;
        costOpp += f.demandFp * costFlat(p);
      }
    }
    // allocatedWr summed from the rolling grid; unallocatedWr from §6
    for (const c of rolling.cells) {
      if (!inScope.has(c.programId)) continue;
      if (c.month < start || c.month > end) continue;
      allocatedWr += c.rollingWr;
    }
    let unallocatedWr = 0;
    for (const b of buckets) {
      for (let m = start; m <= end; m++) {
        unallocatedWr += unByKey.get(`${b.id}:${m}`)?.unallocatedWr ?? 0;
      }
    }
    const margin = revenue - cost;
    const marginOpp = revOpp - costOpp;
    return {
      period,
      demandFp,
      allocatedFp,
      unallocatedFp: demandFp - allocatedFp,
      allocatedWr,
      unallocatedWr,
      revenue,
      cost,
      margin,
      gpPct: revenue > 0 ? margin / revenue : 0,
      revenueOpportunity: revOpp,
      costOpportunity: costOpp,
      marginOpportunity: marginOpp,
      marginGap: marginOpp - margin,
    };
  });

  // --- §8.2 Pipeline WR: WR consumed BY pipeline programs, attributed to the
  //     SOURCE (bucket, month). Own-month consumption sources at the same month;
  //     each borrow channel sources at (path bucket, target month - offset). ---
  const isPipeline = (id: string) => programs.get(id)?.status === 'pipeline';
  const pathBucket = (p: EngineProgram, path: PathKey) =>
    path === 'primary' ? p.primaryBucket : path === 'secondary' ? p.secondaryBucket : p.tertiaryBucket;
  const pipeByBM: Record<string, number[]> = {};
  for (const b of buckets) pipeByBM[b.id] = new Array<number>(months).fill(0);
  const addPipe = (bucket: string | null, month: number, wr: number) => {
    if (!bucket || month < 0 || month >= months) return;
    const arr = pipeByBM[bucket] ?? (pipeByBM[bucket] = new Array<number>(months).fill(0));
    arr[month] = (arr[month] ?? 0) + wr;
  };
  for (const a of own.allocations) {
    if (!isPipeline(a.programId)) continue;
    addPipe(pathBucket(programs.get(a.programId)!, a.path), a.month, a.allocatedWr);
  }
  for (const c of rolling.cells) {
    if (!isPipeline(c.programId)) continue;
    const p = programs.get(c.programId)!;
    for (const { field, path, offset } of CHANNELS) {
      const wr = c.borrow[field];
      if (wr > 0) addPipe(pathBucket(p, path), c.month - offset, wr);
    }
  }
  const pipeline: PipelineCell[] = [];
  for (const b of buckets) for (let m = 0; m < months; m++) pipeline.push({ bucketId: b.id, month: m, pipelineWr: pipeByBM[b.id]?.[m] ?? 0 });

  return { unallocated, fulfilment, planSummary, pipeline };
}
