import { describe, it, expect } from 'vitest';
import { rankPrograms } from '../src/rank';
import { ownMonthAllocation } from '../src/allocate';
import { rollingCalc } from '../src/rolling';
import type { EngineBucket, EngineInput, EngineProgram, Settings } from '../src/types';
import { v30Input } from './v30';

function prog(id: string, demand: number[], over: Partial<EngineProgram> = {}): EngineProgram {
  return {
    id, status: 'active', locked: false, primaryBucket: 'B', primaryYield: 0.5,
    secondaryBucket: null, secondaryYield: null, tertiaryBucket: null, tertiaryYield: null,
    price: 10, barraCostWr: 1, packing: 0, processing: 0, storage: 0, freight: 0, other: 0,
    demand, ...over,
  };
}
function run(programs: EngineProgram[], buckets: EngineBucket[], harvest: Record<string, number[]>, settings: Partial<Settings> = {}) {
  const months = harvest[Object.keys(harvest)[0]!]!.length;
  const input: EngineInput = {
    months, buckets, programs, harvest,
    settings: { marginMetric: 'margin_wr', allocationMode: 'fill_what_you_can', scope: 'active_pipeline', lookbackMonths: 2, ...settings },
  };
  const ranked = rankPrograms(input);
  const own = ownMonthAllocation(input, ranked);
  return { input, own, rolling: rollingCalc(input, ranked, own) };
}
const cell = (r: ReturnType<typeof run>, id: string, m: number) => r.rolling.cells.find((c) => c.programId === id && c.month === m)!;
const B: EngineBucket[] = [{ id: 'B', sortOrder: 10 }];

describe('§5 Rolling Calc — behavioral', () => {
  it('borrows from M-1 when own month has no capacity', () => {
    const r = run([prog('a', [0, 0, 1000])], B, { B: [0, 5000, 0] });
    const c = cell(r, 'a', 2);
    expect(c.borrow.m1_prim).toBeCloseTo(2000, 6); // 1000 FP / 0.5
    expect(c.rollingFp).toBeCloseTo(1000, 6);
  });

  it('month 1 (index 0) can never borrow', () => {
    const r = run([prog('a', [1000, 0, 0])], B, { B: [0, 5000, 5000] });
    const c = cell(r, 'a', 0);
    expect(c.rollingFp).toBe(0);
    expect(Object.values(c.borrow).every((v) => v === 0)).toBe(true);
  });

  it('borrow is capped by residual demand', () => {
    const r = run([prog('a', [0, 0, 500])], B, { B: [0, 5000, 0] });
    const c = cell(r, 'a', 2);
    expect(c.borrow.m1_prim).toBeCloseTo(1000, 6); // 500 / 0.5, not more
    expect(c.rollingFp).toBeCloseTo(500, 6);
  });

  it('borrow is capped by available prior capacity', () => {
    const r = run([prog('a', [0, 0, 1000])], B, { B: [0, 300, 0] });
    const c = cell(r, 'a', 2);
    expect(c.borrow.m1_prim).toBeCloseTo(300, 6);
    expect(c.rollingFp).toBeCloseTo(150, 6); // 300 * 0.5, under-fulfilled
  });

  it('falls through to M-2 after M-1 is exhausted', () => {
    // demand only at M3; prior months carry leftover capacity (300 at M-1, 400 at M-2)
    const r = run([prog('a', [0, 0, 1000])], B, { B: [400, 300, 0] });
    const c = cell(r, 'a', 2);
    expect(c.borrow.m1_prim).toBeCloseTo(300, 6); // M-1 leftover drained first
    expect(c.borrow.m2_prim).toBeCloseTo(400, 6); // then M-2
  });

  it('rank order governs competition for prior capacity', () => {
    const r = run([
      prog('low', [0, 0, 1000], { price: 10 }),
      prog('high', [0, 0, 1000], { price: 50 }),
    ], B, { B: [0, 2000, 0] });
    expect(cell(r, 'high', 2).borrow.m1_prim).toBeCloseTo(2000, 6); // rank 1 takes it all
    expect(cell(r, 'low', 2).borrow.m1_prim).toBe(0);
  });
});

describe('§5.6 guarantees — V30', () => {
  const input = v30Input();
  const ranked = rankPrograms(input);
  const own = ownMonthAllocation(input, ranked);
  const rolling = rollingCalc(input, ranked, own);

  it('no negative borrowings', () => {
    for (const c of rolling.cells) {
      for (const v of Object.values(c.borrow)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('rolling FP never exceeds demand', () => {
    for (const c of rolling.cells) expect(c.rollingFp).toBeLessThanOrEqual(c.demandFp + 1e-6);
  });

  it('capacity is never oversubscribed (own consumption + borrowings <= capacity)', () => {
    for (const b of input.buckets) {
      const cap = input.harvest[b.id] ?? [];
      const cons = own.ownConsumption[b.id] ?? [];
      const drawn = rolling.drawn[b.id] ?? [];
      for (let m = 0; m < input.months; m++) {
        expect((cons[m] ?? 0) + (drawn[m] ?? 0)).toBeLessThanOrEqual((cap[m] ?? 0) + 1e-6);
      }
    }
  });

  it('is deterministic', () => {
    const again = rollingCalc(input, rankPrograms(input), ownMonthAllocation(input, rankPrograms(input)));
    expect(again.cells).toEqual(rolling.cells);
  });
});
