// Spec §3 — ranking and prioritization.
import type { EngineInput, EngineProgram } from './types';
import { rankingMargin } from './derived';

export interface RankedProgram {
  program: EngineProgram;
  inScope: boolean;
  bucketPriority: number; // primary bucket sort_order (lower = higher priority)
  inBucketRank: number; // 1 = best margin among in-scope programs in this bucket
  priorityScore: number; // lower = served first; +Infinity if out of scope
  globalRank: number; // 1..N over in-scope programs (0 if out of scope)
}

function idLess(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rank all programs (spec §3). Out-of-scope programs get inScope=false,
 * priorityScore=+Infinity, globalRank=0. In-scope programs are ordered by
 * priority_score = (locked ? 0 : 1_000_000) + bucketPriority*100 + inBucketRank,
 * ties broken deterministically by id.
 */
export function rankPrograms(input: EngineInput): RankedProgram[] {
  const { programs, buckets, settings } = input;
  const sortOrder = new Map(buckets.map((b) => [b.id, b.sortOrder]));
  const inScope = (p: EngineProgram) =>
    p.status === 'active' || (settings.scope === 'active_pipeline' && p.status === 'pipeline');

  // In-bucket rank: among in-scope programs sharing a primary bucket, by the
  // margin metric (desc), ties by id. (Lock is applied later via the offset.)
  const byBucket = new Map<string, EngineProgram[]>();
  for (const p of programs) {
    if (!inScope(p)) continue;
    let arr = byBucket.get(p.primaryBucket);
    if (!arr) { arr = []; byBucket.set(p.primaryBucket, arr); }
    arr.push(p);
  }
  const inBucketRank = new Map<string, number>();
  for (const arr of byBucket.values()) {
    arr.sort((a, b) => {
      const d = rankingMargin(b, settings.marginMetric) - rankingMargin(a, settings.marginMetric);
      return d !== 0 ? d : idLess(a.id, b.id);
    });
    arr.forEach((p, i) => inBucketRank.set(p.id, i + 1));
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
    .sort((a, b) => a.priorityScore - b.priorityScore || idLess(a.program.id, b.program.id))
    .forEach((r, i) => { r.globalRank = i + 1; });

  return ranked;
}
