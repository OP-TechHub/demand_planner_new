import { describe, it, expect } from 'vitest';
import { pathCostMargin } from '../src/derived';
import { v30Programs } from './v30';

// Spec §2.1. total_cost is flat (SUM of cost components) and matches Excel col V
// exactly. Excel's margin col W, however, is a 60-month average of TIME-VARYING
// monthly price/cost (Time-Variable Overrides tab) — which spec §1.6 defers and
// our schema doesn't yet model. So flat margin matches Excel only for programs
// without time-varying overrides (24/30 in V30). This test records that reality.
describe('§2 derived per-path cost/margin — V30', () => {
  const programs = v30Programs();

  it('has the full V30 program set', () => {
    expect(programs).toHaveLength(30);
  });

  it('total_cost matches Excel col V for every program (±0.01)', () => {
    for (const p of programs) {
      const cm = pathCostMargin(p, 'primary');
      expect(cm, `${p.item_code} must have a primary path`).not.toBeNull();
      expect(cm!.total_cost_fp, `${p.item_code} total_cost`).toBeCloseTo(p.expected.total_cost_fp, 2);
    }
  });

  it('margin is internally consistent: margin_fp = price - total_cost, margin_wr = margin_fp * yield', () => {
    for (const p of programs) {
      const cm = pathCostMargin(p, 'primary')!;
      expect(cm.margin_fp).toBeCloseTo(p.price - cm.total_cost_fp, 6);
      expect(cm.margin_wr).toBeCloseTo(cm.margin_fp * p.primaryYield, 6);
    }
  });

  it('flat margin matches Excel for programs WITHOUT time-varying price/cost (>=24/30)', () => {
    const matches = programs.filter((p) => {
      const cm = pathCostMargin(p, 'primary')!;
      return Math.abs(cm.margin_fp - p.expected.margin_fp) < 0.01;
    });
    // The remaining programs diverge because Excel uses time-varying overrides
    // (spec §1.6, deferred). Documented, expected.
    expect(matches.length).toBeGreaterThanOrEqual(24);
  });

  it('returns null for a path the program does not have', () => {
    const primaryOnly = programs.find((p) => !p.secondaryBucket);
    expect(primaryOnly, 'fixture should include a primary-only program').toBeTruthy();
    expect(pathCostMargin(primaryOnly!, 'secondary')).toBeNull();
  });
});
