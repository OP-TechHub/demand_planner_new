import { describe, it, expect } from 'vitest';
import { runEngine } from '../src/engine';
import { v30Input, v30 } from './v30';

describe('runEngine orchestrator — V30', () => {
  it('produces rolling_fp matching Excel (end-to-end through the orchestrator)', () => {
    const { rolling } = runEngine(v30Input());
    const rfp = new Map<string, number[]>();
    for (const c of rolling.cells) {
      const a = rfp.get(c.programId) ?? new Array<number>(60).fill(0);
      a[c.month] = c.rollingFp; rfp.set(c.programId, a);
    }
    let checked = 0;
    for (let i = 0; i < v30.programs.length; i++) {
      const raw = v30.programs[i] as { expected_rolling_fp?: number[] };
      if (!raw.expected_rolling_fp) continue;
      checked++;
      const mine = rfp.get('p' + String(i).padStart(2, '0')) ?? [];
      for (let m = 0; m < 60; m++) expect(Math.abs((mine[m] ?? 0) - (raw.expected_rolling_fp[m] ?? 0))).toBeLessThan(0.01);
    }
    expect(checked).toBe(28);
  });

  it('is deterministic', () => {
    const a = runEngine(v30Input());
    const b = runEngine(v30Input());
    expect(b.rolling.cells).toEqual(a.rolling.cells);
    expect(b.aggregate.planSummary).toEqual(a.aggregate.planSummary);
  });
});
