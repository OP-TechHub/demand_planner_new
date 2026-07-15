// Spec §4 — own-month allocation. For each month, walk in-scope programs in
// global-rank order, cascading each through primary → secondary → tertiary,
// drawing from that month's bucket capacity. Months are independent.
import type { EngineInput, PathKey } from './types';
import { pathOf } from './derived';
import type { RankedProgram } from './rank';

export interface Allocation {
  programId: string;
  month: number; // 0-based
  path: PathKey;
  allocatedWr: number;
}

export interface OwnMonthResult {
  allocations: Allocation[];
  /** programId -> own-month FP fulfilled per month */
  ownFp: Record<string, number[]>;
  /** programId -> own-month WR consumed per month (all paths) */
  ownWr: Record<string, number[]>;
  /** bucketId -> own-month WR consumed per month (all programs, all paths) */
  ownConsumption: Record<string, number[]>;
}

const PATHS: readonly PathKey[] = ['primary', 'secondary', 'tertiary'];
const EPS = 1e-9;

export function ownMonthAllocation(input: EngineInput, ranked: RankedProgram[]): OwnMonthResult {
  const { months, harvest, settings } = input;
  const order = ranked
    .filter((r) => r.inScope)
    .sort((a, b) => a.globalRank - b.globalRank)
    .map((r) => r.program);

  const zero = () => new Array<number>(months).fill(0);
  const allocations: Allocation[] = [];
  const ownFp: Record<string, number[]> = {};
  const ownWr: Record<string, number[]> = {};
  const ownConsumption: Record<string, number[]> = {};
  for (const p of order) { ownFp[p.id] = zero(); ownWr[p.id] = zero(); }
  for (const b of input.buckets) ownConsumption[b.id] = zero();

  for (let m = 0; m < months; m++) {
    const consumed: Record<string, number> = {}; // per bucket, this month
    for (const p of order) {
      const demand = p.demand[m] ?? 0;
      if (demand <= 0) continue;
      let fulfilledFp = 0;
      for (const path of PATHS) {
        const info = pathOf(p, path);
        if (!info) continue;
        const residualFp = demand - fulfilledFp;
        if (residualFp <= EPS) break;

        const capacity = harvest[info.bucket]?.[m] ?? 0;
        const already = consumed[info.bucket] ?? 0;
        const available = Math.max(0, capacity - already);
        if (available <= EPS) continue;

        const residualWr = residualFp / info.yield;
        const allocWr =
          settings.allocationMode === 'all_or_nothing'
            ? (available + EPS >= residualWr ? residualWr : 0)
            : Math.min(residualWr, available);
        if (allocWr <= EPS) continue;

        allocations.push({ programId: p.id, month: m, path, allocatedWr: allocWr });
        consumed[info.bucket] = already + allocWr;
        const oc = ownConsumption[info.bucket] ?? (ownConsumption[info.bucket] = zero());
        oc[m] = (oc[m] ?? 0) + allocWr;
        const wr = ownWr[p.id]!;
        wr[m] = (wr[m] ?? 0) + allocWr;
        const fp = allocWr * info.yield;
        const fpArr = ownFp[p.id]!;
        fpArr[m] = (fpArr[m] ?? 0) + fp;
        fulfilledFp += fp;
      }
    }
  }

  return { allocations, ownFp, ownWr, ownConsumption };
}
