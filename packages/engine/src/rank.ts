// Spec §3 — ranking. Replicates the V30 model's 60-MS formulas exactly
// (columns BW "InBkt", BX "SortKey", BY "Global"), which differ from the prose
// spec §3.1 in one key way discovered via Excel parity:
//
//   InBkt within a bucket:
//     - LOCKED programs are ordered by ORIGINAL ROW ORDER (Excel "BR"/P-row),
//       NOT by margin.  (BW: SUMPRODUCT((BU=1)*(BR<BR_this))+1)
//     - UNLOCKED programs come AFTER all locked in the bucket, ordered by the
//       margin lens (W/X/Y) DESCENDING, tie-broken by original order.
//
//   SortKey = (1-locked)*1_000_000 + bucketPriority*100 + InBkt
//   Global  = count of in-scope programs with a smaller SortKey, + 1.
import type { EngineInput, EngineProgram } from './types';
import { rankingMargin } from './derived';

export interface RankedProgram {
  program: EngineProgram;
  inScope: boolean;
  bucketPriority: number; // primary bucket sort_order (lower = higher priority)
  inBucketRank: number; // Excel "InBkt"
  priorityScore: number; // Excel "SortKey"; +Infinity if out of scope
  globalRank: number; // 1..N over in-scope programs (0 if out of scope)
}

export function rankPrograms(input: EngineInput): RankedProgram[] {
  const { programs, buckets, settings } = input;
  const sortOrder = new Map(buckets.map((b) => [b.id, b.sortOrder]));
  const order = new Map(programs.map((p, i) => [p.id, i])); // original row order (BR/P-row)
  const inScope = (p: EngineProgram) =>
    p.status === 'active' || (settings.scope === 'active_pipeline' && p.status === 'pipeline');

  // In-bucket rank per Excel BW.
  const byBucket = new Map<string, EngineProgram[]>();
  for (const p of programs) {
    if (!inScope(p)) continue;
    let arr = byBucket.get(p.primaryBucket);
    if (!arr) { arr = []; byBucket.set(p.primaryBucket, arr); }
    arr.push(p);
  }
  const inBucketRank = new Map<string, number>();
  for (const arr of byBucket.values()) {
    const idx = (p: EngineProgram) => order.get(p.id) ?? 0;
    const locked = arr.filter((p) => p.locked).sort((a, b) => idx(a) - idx(b));
    const unlocked = arr.filter((p) => !p.locked).sort((a, b) => {
      const d = rankingMargin(b, settings.marginMetric) - rankingMargin(a, settings.marginMetric);
      return d !== 0 ? d : idx(a) - idx(b);
    });
    locked.forEach((p, i) => inBucketRank.set(p.id, i + 1));
    unlocked.forEach((p, i) => inBucketRank.set(p.id, locked.length + i + 1));
  }

  const ranked: RankedProgram[] = programs.map((p) => {
    const scoped = inScope(p);
    const bucketPriority = sortOrder.get(p.primaryBucket) ?? 9999;
    const ibr = inBucketRank.get(p.id) ?? 0;
    return {
      program: p,
      inScope: scoped,
      bucketPriority,
      inBucketRank: ibr,
      priorityScore: scoped ? (p.locked ? 0 : 1_000_000) + bucketPriority * 100 + ibr : Number.POSITIVE_INFINITY,
      globalRank: 0,
    };
  });

  ranked
    .filter((r) => r.inScope)
    .sort((a, b) => a.priorityScore - b.priorityScore || (order.get(a.program.id)! - order.get(b.program.id)!))
    .forEach((r, i) => { r.globalRank = i + 1; });

  return ranked;
}
