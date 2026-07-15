import { describe, it, expect } from 'vitest';
import { rankPrograms } from '../src/rank';
import type { EngineBucket, EngineInput, EngineProgram, Settings } from '../src/types';
import { v30Input, v30Programs } from './v30';

function prog(id: string, over: Partial<EngineProgram> = {}): EngineProgram {
  return {
    id, status: 'active', locked: false, primaryBucket: 'B1', primaryYield: 0.5,
    secondaryBucket: null, secondaryYield: null, tertiaryBucket: null, tertiaryYield: null,
    price: 10, barraCostWr: 1, packing: 0, processing: 0, storage: 0, freight: 0, other: 0,
    demand: new Array(60).fill(0), ...over,
  };
}
function makeInput(programs: EngineProgram[], buckets: EngineBucket[], settings: Partial<Settings> = {}): EngineInput {
  return {
    months: 60, buckets, programs, harvest: {},
    settings: { marginMetric: 'margin_wr', allocationMode: 'fill_what_you_can', scope: 'active_pipeline', lookbackMonths: 2, ...settings },
  };
}
const rankOf = (r: ReturnType<typeof rankPrograms>, id: string) => r.find((x) => x.program.id === id)!;

describe('§3 ranking — behavioral', () => {
  const buckets: EngineBucket[] = [{ id: 'small', sortOrder: 10 }, { id: 'big', sortOrder: 70 }];

  it('locked beats unlocked even in a worse bucket', () => {
    const r = rankPrograms(makeInput([
      prog('locked-big', { locked: true, primaryBucket: 'big' }),
      prog('unlocked-small', { primaryBucket: 'small' }),
    ], buckets));
    expect(rankOf(r, 'locked-big').globalRank).toBe(1);
    expect(rankOf(r, 'unlocked-small').globalRank).toBe(2);
  });

  it('among unlocked, lower bucket sort_order ranks first', () => {
    const r = rankPrograms(makeInput([
      prog('big', { primaryBucket: 'big' }),
      prog('small', { primaryBucket: 'small' }),
    ], buckets));
    expect(rankOf(r, 'small').globalRank).toBe(1);
    expect(rankOf(r, 'big').globalRank).toBe(2);
  });

  it('within a bucket, higher margin ranks first (in-bucket rank)', () => {
    // price higher -> higher margin_wr
    const r = rankPrograms(makeInput([
      prog('low', { primaryBucket: 'small', price: 10 }),
      prog('high', { primaryBucket: 'small', price: 20 }),
    ], buckets));
    expect(rankOf(r, 'high').inBucketRank).toBe(1);
    expect(rankOf(r, 'low').inBucketRank).toBe(2);
    expect(rankOf(r, 'high').globalRank).toBeLessThan(rankOf(r, 'low').globalRank);
  });

  it('scope filter: inactive is never in scope; pipeline depends on scope setting', () => {
    const progs = [prog('a'), prog('p', { status: 'pipeline' }), prog('x', { status: 'inactive' })];
    const withPipeline = rankPrograms(makeInput(progs, buckets, { scope: 'active_pipeline' }));
    expect(rankOf(withPipeline, 'x').inScope).toBe(false);
    expect(rankOf(withPipeline, 'p').inScope).toBe(true);
    const activeOnly = rankPrograms(makeInput(progs, buckets, { scope: 'active' }));
    expect(rankOf(activeOnly, 'p').inScope).toBe(false);
    expect(rankOf(activeOnly, 'a').inScope).toBe(true);
  });

  it('ties broken deterministically by id', () => {
    const r = rankPrograms(makeInput([
      prog('b', { primaryBucket: 'small' }),
      prog('a', { primaryBucket: 'small' }),
    ], buckets));
    expect(rankOf(r, 'a').inBucketRank).toBe(1);
    expect(rankOf(r, 'b').inBucketRank).toBe(2);
  });
});

describe('§3 ranking — V30 structure', () => {
  const ranked = rankPrograms(v30Input());
  const inScope = ranked.filter((r) => r.inScope);

  it('in-scope count equals active+pipeline programs', () => {
    const active = v30Programs().filter((p) => p.status !== 'inactive');
    expect(inScope.length).toBe(active.length);
  });

  it('all locked in-scope programs rank above all unlocked ones', () => {
    const locked = inScope.filter((r) => r.program.locked).map((r) => r.globalRank);
    const unlocked = inScope.filter((r) => !r.program.locked).map((r) => r.globalRank);
    expect(Math.max(...locked)).toBeLessThan(Math.min(...unlocked));
  });

  it('global ranks are a contiguous 1..N over in-scope programs', () => {
    const ranks = inScope.map((r) => r.globalRank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: inScope.length }, (_, i) => i + 1));
  });
});
