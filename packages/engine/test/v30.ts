// Adapter: load the committed V30 fixture into engine types, preserving the
// Excel-computed `expected` block for parity assertions.
import v30 from '../fixtures/v30.json';
import type { EngineProgram, Status } from '../src/types';

type Raw = (typeof v30.programs)[number];

export interface V30Program extends EngineProgram {
  item_code: string;
  expected: Raw['expected'];
}

export function v30Programs(): V30Program[] {
  return v30.programs.map((p, i) => ({
    id: p.item_code || String(i),
    status: p.status as Status,
    locked: p.locked,
    primaryBucket: p.primary_bucket as string,
    primaryYield: p.primary_yield as number,
    secondaryBucket: p.secondary_bucket,
    secondaryYield: p.secondary_yield,
    tertiaryBucket: p.tertiary_bucket,
    tertiaryYield: p.tertiary_yield,
    price: p.price_per_fp,
    barraCostWr: p.barra_cost_wr,
    packing: p.packing_cost_fp,
    processing: p.processing_cost_fp,
    storage: p.storage_cost_fp,
    freight: p.freight_cost_fp,
    other: p.other_costs_fp,
    demand: p.demand,
    item_code: p.item_code,
    expected: p.expected,
  }));
}

export { v30 };
