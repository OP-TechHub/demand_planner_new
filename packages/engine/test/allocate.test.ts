import { describe, it, expect } from 'vitest';
import { rankPrograms } from '../src/rank';
import { ownMonthAllocation } from '../src/allocate';
import type { EngineBucket, EngineInput, EngineProgram, Settings } from '../src/types';
import { v30Input } from './v30';

function prog(id: string, demand: number, over: Partial<EngineProgram> = {}): EngineProgram {
  return {
    id, status: 'active', locked: false, primaryBucket: 'B', primaryYield: 0.5,
    secondaryBucket: null, secondaryYield: null, tertiaryBucket: null, tertiaryYield: null,
    price: 10, barraCostWr: 1, packing: 0, processing: 0, storage: 0, freight: 0, other: 0,
    demand: [demand], ...over,
  };
}
function run(programs: EngineProgram[], buckets: EngineBucket[], harvest: Record<string, number[]>, settings: Partial<Settings> = {}) {
  const input: EngineInput = {
    months: 1, buckets, programs, harvest,
    settings: { marginMetric: 'margin_wr', allocationMode: 'fill_what_you_can', scope: 'active_pipeline', lookbackMonths: 2, ...settings },
  };
  return ownMonthAllocation(input, rankPrograms(input));
}
const wr = (r: ReturnType<typeof run>, id: string) => r.ownWr[id]?.[0] ?? 0;
const fp = (r: ReturnType<typeof run>, id: string) => r.ownFp[id]?.[0] ?? 0;
const B: EngineBucket[] = [{ id: 'B', sortOrder: 10 }];

describe('§4 own-month allocation — behavioral', () => {
  it('ample capacity: fully allocated (WR = demandFP / yield)', () => {
    const r = run([prog('a', 1000, { primaryYield: 0.5 })], B, { B: [5000] });
    expect(wr(r, 'a')).toBeCloseTo(2000, 6);
    expect(fp(r, 'a')).toBeCloseTo(1000, 6);
  });

  it('scarce capacity, fill-what-you-can: partial fill', () => {
    const r = run([prog('a', 1000, { primaryYield: 0.5 })], B, { B: [1000] });
    expect(wr(r, 'a')).toBeCloseTo(1000, 6);
    expect(fp(r, 'a')).toBeCloseTo(500, 6);
  });

  it('all-or-nothing: zero when full demand cannot be met', () => {
    const r = run([prog('a', 1000, { primaryYield: 0.5 })], B, { B: [1000] }, { allocationMode: 'all_or_nothing' });
    expect(wr(r, 'a')).toBe(0);
    expect(fp(r, 'a')).toBe(0);
  });

  it('rank order: rank 1 takes capacity, rank 2 gets the remainder', () => {
    // both need 2000 WR; higher price -> higher margin -> rank 1
    const r = run([
      prog('low', 1000, { price: 10 }),
      prog('high', 1000, { price: 50 }),
    ], B, { B: [3000] });
    expect(wr(r, 'high')).toBeCloseTo(2000, 6); // full
    expect(wr(r, 'low')).toBeCloseTo(1000, 6); // remainder
    expect(fp(r, 'low')).toBeCloseTo(500, 6);
  });

  it('path cascade: primary empty falls through to secondary', () => {
    const buckets: EngineBucket[] = [{ id: 'P', sortOrder: 10 }, { id: 'S', sortOrder: 20 }];
    const r = run(
      [prog('a', 1000, { primaryBucket: 'P', primaryYield: 0.5, secondaryBucket: 'S', secondaryYield: 0.4 })],
      buckets, { P: [0], S: [5000] }
    );
    expect(fp(r, 'a')).toBeCloseTo(1000, 6);
    const sec = r.allocations.find((x) => x.programId === 'a' && x.path === 'secondary');
    expect(sec?.allocatedWr).toBeCloseTo(2500, 6); // 1000 / 0.4
    expect(r.allocations.some((x) => x.path === 'primary')).toBe(false);
  });

  it('zero demand: no allocation', () => {
    const r = run([prog('a', 0)], B, { B: [5000] });
    expect(r.allocations).toHaveLength(0);
  });
});

describe('§4 own-month allocation — V30 invariants', () => {
  const input = v30Input();
  const ranked = rankPrograms(input);
  const res = ownMonthAllocation(input, ranked);
  const inScope = ranked.filter((r) => r.inScope);

  it('own FP never exceeds demand', () => {
    for (const r of inScope) {
      const own = res.ownFp[r.program.id]!;
      for (let m = 0; m < input.months; m++) {
        expect(own[m]!).toBeLessThanOrEqual((r.program.demand[m] ?? 0) + 1e-6);
      }
    }
  });

  it('own consumption never exceeds bucket capacity', () => {
    for (const b of input.buckets) {
      const cons = res.ownConsumption[b.id]!;
      const cap = input.harvest[b.id] ?? [];
      for (let m = 0; m < input.months; m++) {
        expect(cons[m]!).toBeLessThanOrEqual((cap[m] ?? 0) + 1e-6);
      }
    }
  });

  it('is deterministic (identical output across runs)', () => {
    const again = ownMonthAllocation(input, rankPrograms(input));
    expect(again.allocations).toEqual(res.allocations);
  });
});
