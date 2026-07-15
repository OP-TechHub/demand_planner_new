import { describe, it, expect } from 'vitest';
import { rankPrograms } from '../src/rank';
import { ownMonthAllocation } from '../src/allocate';
import { rollingCalc } from '../src/rolling';
import { v30Input, v30 } from './v30';

// The definitive parity proof (spec §9.2 #1): our rolling_fp must equal the V30
// 60-MS "Allocated FP" grid for every in-scope program, every month, to ±0.01.
// Exercises ranking + own-month allocation + forward-borrowing together.
describe('Excel V30 parity — 60-MS Allocated FP (rolling_fp)', () => {
  const input = v30Input();
  const ranked = rankPrograms(input);
  const own = ownMonthAllocation(input, ranked);
  const rolling = rollingCalc(input, ranked, own);
  const rfp = new Map<string, number[]>();
  for (const c of rolling.cells) {
    const a = rfp.get(c.programId) ?? new Array<number>(input.months).fill(0);
    a[c.month] = c.rollingFp; rfp.set(c.programId, a);
  }

  it('matches Excel rolling_fp for every in-scope program, all 60 months', () => {
    let checked = 0;
    for (let i = 0; i < v30.programs.length; i++) {
      const raw = v30.programs[i] as { item_code: string; expected_rolling_fp?: number[] };
      if (!raw.expected_rolling_fp) continue;
      checked++;
      const mine = rfp.get('p' + String(i).padStart(2, '0')) ?? [];
      for (let m = 0; m < input.months; m++) {
        expect(Math.abs((mine[m] ?? 0) - (raw.expected_rolling_fp[m] ?? 0)), `${raw.item_code} M${m + 1}`).toBeLessThan(0.01);
      }
    }
    expect(checked).toBe(28);
  });
});
