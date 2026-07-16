// Spec §5 — Rolling Calc forward-borrowing engine.
//
// For each target month M (ascending), each in-scope program (rank order),
// attempt 6 borrow channels in cascade: M-1 prim/alt/tert, then M-2 prim/alt/tert.
// Each channel draws from a prior month's LEFTOVER capacity = plan capacity
// − own-month consumption − borrowings already committed to that (bucket, month).
// Processing target→rank→channel makes "already committed" exactly the running
// `drawn` accumulator (earlier target months + higher-rank same-month + earlier
// channels have all run first), which keeps the whole thing acyclic (§5.4).
import type { EngineInput, PathKey } from './types';
import { pathCostMargin, pathOf } from './derived';
import type { RankedProgram } from './rank';
import type { OwnMonthResult } from './allocate';

export interface BorrowChannels {
  m1_prim: number; m1_alt: number; m1_tert: number;
  m2_prim: number; m2_alt: number; m2_tert: number;
}

export interface RollingCell {
  programId: string;
  month: number; // 0-based target month
  demandFp: number;
  ownFp: number;
  ownWr: number;
  borrow: BorrowChannels;
  rollingFp: number;
  rollingWr: number;
  rollingMargin: number;
}

export interface RollingResult {
  cells: RollingCell[];
  /** bucketId -> WR borrowed OUT of each (bucket, month) source, per month */
  drawn: Record<string, number[]>;
}

const EPS = 1e-9;
const CHANNELS: { offset: number; path: PathKey; field: keyof BorrowChannels }[] = [
  { offset: 1, path: 'primary', field: 'm1_prim' },
  { offset: 1, path: 'secondary', field: 'm1_alt' },
  { offset: 1, path: 'tertiary', field: 'm1_tert' },
  { offset: 2, path: 'primary', field: 'm2_prim' },
  { offset: 2, path: 'secondary', field: 'm2_alt' },
  { offset: 2, path: 'tertiary', field: 'm2_tert' },
];

export function rollingCalc(input: EngineInput, ranked: RankedProgram[], own: OwnMonthResult): RollingResult {
  const { months, harvest, settings } = input;
  const lookback = settings.lookbackMonths;
  const order = ranked
    .filter((r) => r.inScope)
    .sort((a, b) => a.globalRank - b.globalRank)
    .map((r) => r.program);

  const zero = () => new Array<number>(months).fill(0);
  const drawn: Record<string, number[]> = {};
  for (const b of input.buckets) drawn[b.id] = zero();

  const newBorrow = (): BorrowChannels => ({ m1_prim: 0, m1_alt: 0, m1_tert: 0, m2_prim: 0, m2_alt: 0, m2_tert: 0 });
  const borrow: Record<string, BorrowChannels[]> = {};
  for (const p of order) borrow[p.id] = Array.from({ length: months }, newBorrow);

  // Per-path own-month WR (for the rolling_margin per-path decomposition, §5.5).
  const ownPathWr: Record<string, Record<PathKey, number[]>> = {};
  for (const p of order) ownPathWr[p.id] = { primary: zero(), secondary: zero(), tertiary: zero() };
  for (const a of own.allocations) {
    const rec = ownPathWr[a.programId];
    if (!rec) continue;
    const arr = rec[a.path];
    arr[a.month] = (arr[a.month] ?? 0) + a.allocatedWr;
  }

  // --- the borrowing loop (§5.4 order) ---
  for (let M = 0; M < months; M++) {
    for (const p of order) {
      const demand = p.demand[M] ?? 0;
      if (demand <= 0) continue;
      let fulfilledFp = own.ownFp[p.id]?.[M] ?? 0;
      const b = borrow[p.id]![M]!;
      for (const ch of CHANNELS) {
        if (ch.offset > lookback) continue;
        const srcMonth = M - ch.offset;
        if (srcMonth < 0) continue;
        const info = pathOf(p, ch.path);
        if (!info) continue;
        const residualFp = demand - fulfilledFp;
        if (residualFp <= EPS) break;

        const capacity = harvest[info.bucket]?.[srcMonth] ?? 0;
        const ownCons = own.ownConsumption[info.bucket]?.[srcMonth] ?? 0;
        const drawnArr = drawn[info.bucket] ?? (drawn[info.bucket] = zero());
        const available = Math.max(0, capacity - ownCons - (drawnArr[srcMonth] ?? 0));
        if (available <= EPS) continue;

        const borrowedWr = Math.min(residualFp / info.yield, available); // fill-what-you-can (§5.3)
        if (borrowedWr <= EPS) continue;
        b[ch.field] = borrowedWr;
        drawnArr[srcMonth] = (drawnArr[srcMonth] ?? 0) + borrowedWr;
        fulfilledFp += borrowedWr * info.yield;
      }
    }
  }

  // --- post-process: rolling_fp / rolling_wr / rolling_margin (§5.5) ---
  const cells: RollingCell[] = [];
  for (const p of order) {
    const yields: Record<PathKey, number> = { primary: p.primaryYield, secondary: p.secondaryYield ?? 0, tertiary: p.tertiaryYield ?? 0 };
    const marginFp: Record<PathKey, number> = {
      primary: pathCostMargin(p, 'primary')?.margin_fp ?? 0,
      secondary: pathCostMargin(p, 'secondary')?.margin_fp ?? 0,
      tertiary: pathCostMargin(p, 'tertiary')?.margin_fp ?? 0,
    };
    const opw = ownPathWr[p.id]!;
    for (let M = 0; M < months; M++) {
      const b = borrow[p.id]![M]!;
      const ownFp = own.ownFp[p.id]?.[M] ?? 0;
      const ownWr = own.ownWr[p.id]?.[M] ?? 0;
      const primWr = (opw.primary[M] ?? 0) + b.m1_prim + b.m2_prim;
      const altWr = (opw.secondary[M] ?? 0) + b.m1_alt + b.m2_alt;
      const tertWr = (opw.tertiary[M] ?? 0) + b.m1_tert + b.m2_tert;
      const rollingWr = ownWr + b.m1_prim + b.m1_alt + b.m1_tert + b.m2_prim + b.m2_alt + b.m2_tert;
      const rollingFp =
        ownFp +
        (b.m1_prim + b.m2_prim) * yields.primary +
        (b.m1_alt + b.m2_alt) * yields.secondary +
        (b.m1_tert + b.m2_tert) * yields.tertiary;
      const rollingMargin =
        primWr * yields.primary * marginFp.primary +
        altWr * yields.secondary * marginFp.secondary +
        tertWr * yields.tertiary * marginFp.tertiary;
      cells.push({ programId: p.id, month: M, demandFp: p.demand[M] ?? 0, ownFp, ownWr, borrow: { ...b }, rollingFp, rollingWr, rollingMargin });
    }
  }

  return { cells, drawn };
}
