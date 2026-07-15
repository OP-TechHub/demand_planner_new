import { describe, it, expect } from 'vitest';
import { rankPrograms } from '../src/rank';
import { ownMonthAllocation } from '../src/allocate';
import { rollingCalc } from '../src/rolling';
import { aggregate } from '../src/aggregate';
import { v30Input, v30 } from './v30';

describe('§6–8 aggregations — V30', () => {
  const input = v30Input();
  const ranked = rankPrograms(input);
  const own = ownMonthAllocation(input, ranked);
  const rolling = rollingCalc(input, ranked, own);
  const agg = aggregate(input, ranked, own, rolling);

  const exp = (v30 as { expected: { unallocated_wr: Record<string, number[]>; annual: Record<string, number[] | null> } }).expected;

  it('§6 Unallocated WR matches Excel (±0.01)', () => {
    const byKey = new Map(agg.unallocated.map((u) => [`${u.bucketId}:${u.month}`, u.unallocatedWr]));
    let maxDiff = 0, worst = '';
    for (const [bucket, arr] of Object.entries(exp.unallocated_wr)) {
      for (let m = 0; m < input.months; m++) {
        const mine = byKey.get(`${bucket}:${m}`) ?? 0;
        const d = Math.abs(mine - (arr[m] ?? 0));
        if (d > maxDiff) { maxDiff = d; worst = `${bucket} M${m + 1}: mine=${mine.toFixed(2)} excel=${(arr[m] ?? 0).toFixed(2)}`; }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`Unallocated WR max diff: ${maxDiff.toFixed(4)} (${worst})`);
    expect(maxDiff).toBeLessThan(0.01);
  });

  it('§8.1 Annual Summary volume rows match Excel', () => {
    const rows = ['fy1', 'fy2', 'fy3', 'fy4', 'fy5', 'total_60mo'] as const;
    const get = (period: string) => agg.planSummary.find((r) => r.period === period)!;
    const check = (label: string, key: 'demandFp' | 'allocatedFp' | 'unallocatedFp' | 'allocatedWr' | 'unallocatedWr') => {
      const excel = exp.annual[key];
      if (!excel) return;
      rows.forEach((period, i) => {
        const mine = get(period)[key];
        const d = Math.abs(mine - (excel[i] ?? 0));
        // eslint-disable-next-line no-console
        if (d >= 1) console.log(`${label} ${period}: mine=${mine.toFixed(0)} excel=${(excel[i] ?? 0).toFixed(0)} diff=${d.toFixed(1)}`);
        expect(d, `${label} ${period}`).toBeLessThan(1);
      });
    };
    check('DemandFP', 'demandFp');
    check('AllocatedFP', 'allocatedFp');
    check('UnallocatedFP', 'unallocatedFp');
    check('AllocatedWR', 'allocatedWr');
    check('UnallocatedWR', 'unallocatedWr');
  });

  it('§8.1 Annual Summary FINANCIALS match Excel with time-varying price/cost', () => {
    const rows = ['fy1', 'fy2', 'fy3', 'fy4', 'fy5', 'total_60mo'] as const;
    const get = (period: string) => agg.planSummary.find((r) => r.period === period)!;
    const check = (label: string, key: 'revenue' | 'cost' | 'margin', excel: number[] | null | undefined) => {
      if (!excel) return;
      rows.forEach((period, i) => {
        const d = Math.abs(get(period)[key] - (excel[i] ?? 0));
        // eslint-disable-next-line no-console
        if (d >= 1) console.log(`${label} ${period}: mine=${get(period)[key].toFixed(0)} excel=${(excel[i] ?? 0).toFixed(0)} diff=${d.toFixed(1)}`);
        expect(d, `${label} ${period}`).toBeLessThan(1);
      });
    };
    check('Revenue', 'revenue', exp.annual.revenue);
    check('Cost', 'cost', exp.annual.cost);
    check('Margin', 'margin', exp.annual.margin);
  });

  it('invariants: unallocated >= 0, fulfilment in [0,1], FYs sum to total', () => {
    for (const u of agg.unallocated) expect(u.unallocatedWr).toBeGreaterThanOrEqual(0);
    for (const f of agg.fulfilment) if (f.fulfilmentPct != null) { expect(f.fulfilmentPct).toBeGreaterThanOrEqual(0); expect(f.fulfilmentPct).toBeLessThanOrEqual(1); }
    const fySum = ['fy1', 'fy2', 'fy3', 'fy4', 'fy5'].reduce((s, p) => s + agg.planSummary.find((r) => r.period === p)!.allocatedFp, 0);
    const total = agg.planSummary.find((r) => r.period === 'total_60mo')!.allocatedFp;
    expect(Math.abs(fySum - total)).toBeLessThan(1e-6);
  });
});
