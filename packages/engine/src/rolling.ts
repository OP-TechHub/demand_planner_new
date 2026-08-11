// Spec §5 — Rolling Calc forward-borrowing engine.
//
// For each target month M (ascending), each in-scope program (rank order),
// attempt the borrow channels in cascade: M-1 prim/alt/tert, then M-2, M-3, M-4
// — offset-major, so nearer harvest is always exhausted before reaching further
// back. Each channel draws from a prior month's LEFTOVER capacity = plan capacity
// − own-month consumption − borrowings already committed to that (bucket, month).
// Processing target→rank→channel makes "already committed" exactly the running
// `drawn` accumulator (earlier target months + higher-rank same-month + earlier
// channels have all run first), which keeps the whole thing acyclic (§5.4).
//
// Rank order is what makes the priority work across the deeper reach: active
// programs, then pipeline, each in rank order, every one of them taking its fill
// from all four source months before the next is considered. So an unmet pipeline
// order claims M-3/M-4 capacity ahead of anything ranked below it, and whatever
// survives the whole pass is the spare an inquiry is then offered.
import type { EngineInput, PathKey } from './types';
import { pathCostMargin, pathOf } from './derived';
import type { RankedProgram } from './rank';
import type { OwnMonthResult } from './allocate';

/**
 * How many months back the engine can borrow. A plan's `lookbackMonths` setting
 * narrows this; nothing widens it without adding the matching `borrow_m*_*_wr`
 * columns to `rolling_results`.
 */
export const MAX_LOOKBACK = 4;

type Offset = 1 | 2 | 3 | 4;
type PathSuffix = 'prim' | 'alt' | 'tert';

/** One WR figure per (source offset × sourcing path) — 3 × MAX_LOOKBACK in all. */
export type BorrowChannels = Record<`m${Offset}_${PathSuffix}`, number>;

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

const PATH_SUFFIX: { path: PathKey; suffix: PathSuffix }[] = [
  { path: 'primary', suffix: 'prim' },
  { path: 'secondary', suffix: 'alt' },
  { path: 'tertiary', suffix: 'tert' },
];

/**
 * The cascade, offset-major: all three paths at M-1, then all three at M-2, and
 * so on out to MAX_LOOKBACK. Exported so the aggregations and the persistence
 * layer attribute each channel to the same (path bucket, month − offset) source.
 */
export const CHANNELS: { offset: number; path: PathKey; field: keyof BorrowChannels }[] =
  Array.from({ length: MAX_LOOKBACK }, (_, i) => i + 1).flatMap((offset) =>
    PATH_SUFFIX.map(({ path, suffix }) => ({
      offset,
      path,
      field: `m${offset}_${suffix}` as keyof BorrowChannels,
    }))
  );

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

  const newBorrow = (): BorrowChannels => {
    const b = {} as BorrowChannels;
    for (const ch of CHANNELS) b[ch.field] = 0;
    return b;
  };
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
      // Borrowed WR collapsed per path — every offset for a path shares its yield
      // and margin, so the decomposition (§5.5) only cares which path it came via.
      const borrowedWr: Record<PathKey, number> = { primary: 0, secondary: 0, tertiary: 0 };
      for (const ch of CHANNELS) borrowedWr[ch.path] += b[ch.field];
      const primWr = (opw.primary[M] ?? 0) + borrowedWr.primary;
      const altWr = (opw.secondary[M] ?? 0) + borrowedWr.secondary;
      const tertWr = (opw.tertiary[M] ?? 0) + borrowedWr.tertiary;
      const rollingWr = ownWr + borrowedWr.primary + borrowedWr.secondary + borrowedWr.tertiary;
      const rollingFp =
        ownFp +
        borrowedWr.primary * yields.primary +
        borrowedWr.secondary * yields.secondary +
        borrowedWr.tertiary * yields.tertiary;
      const rollingMargin =
        primWr * yields.primary * marginFp.primary +
        altWr * yields.secondary * marginFp.secondary +
        tertWr * yields.tertiary * marginFp.tertiary;
      cells.push({ programId: p.id, month: M, demandFp: p.demand[M] ?? 0, ownFp, ownWr, borrow: { ...b }, rollingFp, rollingWr, rollingMargin });
    }
  }

  return { cells, drawn };
}
