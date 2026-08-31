/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Month-on-month comparison of two plans.
 *
 * The companion to `lib/diff.ts`, which lists "what differs" as a flat, capped
 * set of rows. That answers "is anything different"; this answers the question
 * people actually have — "the live plan has been revised all year, so how does
 * each month's harvest, demand and cost now stand against the plan we set?"
 * Which needs a grid, month by month, not a list of changed cells.
 *
 * ALIGNMENT is the whole difficulty. Two plans each number their months from 1,
 * but M1 of a FY26 plan and M1 of a FY27 plan are a year apart. Comparing them
 * by index would silently line up different calendar months and report a
 * difference that is really just a shift in time. So everything here is aligned
 * on the CALENDAR month, and a month a plan doesn't cover reads as absent
 * rather than zero.
 */
import { fetchAllByPlan } from '@/lib/fetch-all';
import type { Plan } from '@oceanpick/shared';

/** Months since year 0 for a 'YYYY-MM-DD' — a comparable absolute month number. */
function absMonth(date: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return NaN;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/** The inverse: an absolute month number back to 'YYYY-MM-01'. */
function toDate(abs: number): string {
  const y = Math.floor(abs / 12);
  const mo = (abs % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-01`;
}

/** A grid too wide to be read is worse than a message saying why. */
const MAX_ALIGNED_MONTHS = 132;

export interface CompareSeries {
  key: string;
  label: string;
  sublabel: string;
  /** Per aligned month. `null` = this plan does not cover that month at all. */
  a: (number | null)[];
  b: (number | null)[];
}

export interface CompareMetric {
  key: string;
  label: string;
  /** Resolved to a formatter client-side (functions can't cross the RSC boundary). */
  format: 'kg' | 'usd0';
  /** What the rows are — buckets for harvest, programs for everything else. */
  rowLabel: string;
  /** A one-line description of what the figures mean, shown under the grid. */
  note: string;
  rows: CompareSeries[];
}

/**
 * The per-kg cost rates behind each program, sent instead of six more full
 * month grids: the components are `volume × rate`, so the client can build them
 * from the volume series it already has. Keeps the payload to a dozen numbers
 * per program rather than six arrays.
 */
export interface CostComponent {
  key: string;
  label: string;
  /** item_code -> the rate in each plan. Missing side = the program isn't in it. */
  rates: Record<string, { a: number; b: number }>;
}

export interface MonthlyCompare {
  /** The aligned window: the calendar span both plans are laid out on. */
  startDate: string;
  horizon: number;
  metrics: CompareMetric[];
  costComponents: CostComponent[];
  /** Calendar months both plans cover. 0 means the windows never meet. */
  overlapMonths: number;
  /** True when the two plans sit on different calendar windows. */
  windowsDiffer: boolean;
  /** Set when the combined span is too wide to lay out; `metrics` is then empty. */
  tooWide: boolean;
  /** True when either plan has no computed results — inputs still compare, outputs can't. */
  outputsMissing: boolean;
}

const OUTPUT_METRICS: { key: string; label: string; column: string; format: 'kg' | 'usd0'; note: string }[] = [
  { key: 'revenue', label: 'Revenue', column: 'revenue', format: 'usd0', note: 'Allocated volume × price, as computed.' },
  { key: 'cost', label: 'Cost', column: 'cost', format: 'usd0', note: 'Allocated volume × the loaded cost per kg. Use the dropdown to split it into components.' },
  { key: 'margin', label: 'Margin', column: 'rolling_margin', format: 'usd0', note: 'Revenue − cost, as computed.' },
  { key: 'volume', label: 'Volume', column: 'rolling_fp', format: 'kg', note: 'Finished product actually allocated — what the plan can deliver, not what was asked for.' },
];

export async function computeMonthlyCompare(supabase: any, planA: Plan, planB: Plan): Promise<MonthlyCompare> {
  const startA = absMonth(planA.plan_start_date);
  const startB = absMonth(planB.plan_start_date);
  const endA = startA + planA.horizon_months - 1;
  const endB = startB + planB.horizon_months - 1;

  const from = Math.min(startA, startB);
  const to = Math.max(endA, endB);
  const horizon = to - from + 1;

  const base: MonthlyCompare = {
    startDate: Number.isFinite(from) ? toDate(from) : planA.plan_start_date,
    horizon,
    metrics: [],
    costComponents: [],
    overlapMonths: Math.max(0, Math.min(endA, endB) - Math.max(startA, startB) + 1),
    windowsDiffer: startA !== startB || planA.horizon_months !== planB.horizon_months,
    tooWide: false,
    outputsMissing: false,
  };

  if (!Number.isFinite(from) || horizon < 1 || horizon > MAX_ALIGNED_MONTHS) return { ...base, tooWide: true };

  const offsetA = startA - from;
  const offsetB = startB - from;
  /** Whether a plan's window covers a slot — outside it the answer is "absent", not "zero". */
  const coversA = (slot: number) => slot >= offsetA && slot < offsetA + planA.horizon_months;
  const coversB = (slot: number) => slot >= offsetB && slot < offsetB + planB.horizon_months;

  const PROG_COLS =
    'id, item_code, customer, item_description, max_monthly_demand_fp, primary_yield, ' +
    'barra_cost_wr, packing_cost_fp, processing_cost_fp, storage_cost_fp, freight_cost_fp, other_costs_fp';
  const rrCols = `program_id, month_index, ${OUTPUT_METRICS.map((m) => m.column).join(', ')}`;

  const [progA, progB, buckets, harvA, harvB, demA, demB, rrA, rrB] = await Promise.all([
    supabase.from('programs').select(PROG_COLS).eq('plan_id', planA.id).is('deleted_at', null),
    supabase.from('programs').select(PROG_COLS).eq('plan_id', planB.id).is('deleted_at', null),
    supabase.from('buckets').select('id, name, sort_order').order('sort_order'),
    fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, month_index, capacity_kg_wr', planA.id),
    fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, month_index, capacity_kg_wr', planB.id),
    fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', planA.id),
    fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', planB.id),
    fetchAllByPlan(supabase, 'rolling_results', rrCols, planA.id),
    fetchAllByPlan(supabase, 'rolling_results', rrCols, planB.id),
  ]);

  const rowsA = (progA?.data ?? []) as any[];
  const rowsB = (progB?.data ?? []) as any[];

  // Programs are matched on item_code: a fork renumbers program ids, so the code
  // is the only identity that survives (same rule as lib/diff.ts).
  const codeByIdA = new Map<string, string>(rowsA.map((p) => [p.id, p.item_code]));
  const codeByIdB = new Map<string, string>(rowsB.map((p) => [p.id, p.item_code]));
  const progByCodeA = new Map<string, any>(rowsA.map((p) => [p.item_code, p]));
  const progByCodeB = new Map<string, any>(rowsB.map((p) => [p.item_code, p]));

  const allCodes = [...new Set([...progByCodeA.keys(), ...progByCodeB.keys()])];
  const nameOf = (code: string) => progByCodeA.get(code) ?? progByCodeB.get(code);
  allCodes.sort((x, y) => {
    const nx = nameOf(x), ny = nameOf(y);
    return `${nx?.customer ?? ''}${nx?.item_description ?? ''}`.localeCompare(`${ny?.customer ?? ''}${ny?.item_description ?? ''}`);
  });

  /** Build one program-keyed series pair from two already-indexed month maps. */
  const programRows = (
    mapA: Map<string, number>,
    mapB: Map<string, number>,
    /** What an absent cell means for this metric: a stored 0, or fall back to a baseline. */
    fallback: (code: string, side: 'a' | 'b') => number
  ): CompareSeries[] =>
    allCodes.map((code) => {
      const nm = nameOf(code);
      const inA = progByCodeA.has(code);
      const inB = progByCodeB.has(code);
      return {
        key: code,
        label: nm?.customer ?? code,
        // Which side a program is missing from is the first thing you want to
        // know when its whole row reads as a change.
        sublabel: `${nm?.item_description ?? code}${!inB ? ' · only in A' : !inA ? ' · only in B' : ''}`,
        a: Array.from({ length: horizon }, (_, i) =>
          inA && coversA(i) ? mapA.get(`${code}:${i}`) ?? fallback(code, 'a') : null
        ),
        b: Array.from({ length: horizon }, (_, i) =>
          inB && coversB(i) ? mapB.get(`${code}:${i}`) ?? fallback(code, 'b') : null
        ),
      };
    });

  /** Index plan rows by `key:alignedSlot`, converting the plan's own month_index. */
  const indexBy = (rows: any[], keyOf: (r: any) => string | undefined, offset: number, column: string) => {
    const out = new Map<string, number>();
    for (const r of rows) {
      const k = keyOf(r);
      if (k == null) continue;
      const slot = offset + (r.month_index - 1);
      if (slot < 0 || slot >= horizon) continue;
      const cell = `${k}:${slot}`;
      out.set(cell, (out.get(cell) ?? 0) + (Number(r[column]) || 0));
    }
    return out;
  };

  const metrics: CompareMetric[] = [];

  // --- Harvest: capacity per bucket per month. Buckets are org-scoped, so the
  //     same bucket_id means the same bucket in both plans — no matching needed.
  const bucketRows = (buckets?.data ?? []) as any[];
  const hA = indexBy(harvA, (r) => r.bucket_id, offsetA, 'capacity_kg_wr');
  const hB = indexBy(harvB, (r) => r.bucket_id, offsetB, 'capacity_kg_wr');
  const usedBuckets = new Set([...hA.keys(), ...hB.keys()].map((k) => k.slice(0, k.lastIndexOf(':'))));
  metrics.push({
    key: 'harvest',
    label: 'Harvest',
    format: 'kg',
    rowLabel: 'Bucket',
    note: 'Harvest capacity entered per size bucket, in kg round weight. An empty cell is a real 0 — no capacity was entered for that month.',
    rows: bucketRows
      .filter((b) => usedBuckets.has(b.id))
      .map((b) => ({
        key: b.id,
        label: b.name,
        sublabel: '',
        // Harvest has no baseline: a month with no row genuinely has no capacity.
        a: Array.from({ length: horizon }, (_, i) => (coversA(i) ? hA.get(`${b.id}:${i}`) ?? 0 : null)),
        b: Array.from({ length: horizon }, (_, i) => (coversB(i) ? hB.get(`${b.id}:${i}`) ?? 0 : null)),
      })),
  });

  // --- Demand: the EFFECTIVE figure, which is the month's override where one
  //     exists and the program's baseline otherwise. Comparing only the stored
  //     overrides would show nothing when a plan simply never overrode a month.
  const dA = indexBy(demA, (r) => codeByIdA.get(r.program_id), offsetA, 'demand_fp');
  const dB = indexBy(demB, (r) => codeByIdB.get(r.program_id), offsetB, 'demand_fp');
  metrics.push({
    key: 'demand',
    label: 'Demand',
    format: 'kg',
    rowLabel: 'Program',
    note: 'Effective demand in kg finished product — the month’s override where one was entered, the program’s baseline where it wasn’t.',
    rows: programRows(dA, dB, (code, side) =>
      Number((side === 'a' ? progByCodeA : progByCodeB).get(code)?.max_monthly_demand_fp) || 0
    ),
  });

  // --- Outputs, which need a computed plan on both sides.
  const outputsMissing = !rrA.length || !rrB.length;
  if (!outputsMissing) {
    for (const { key, label, column, format, note } of OUTPUT_METRICS) {
      const mA = indexBy(rrA, (r) => codeByIdA.get(r.program_id), offsetA, column);
      const mB = indexBy(rrB, (r) => codeByIdB.get(r.program_id), offsetB, column);
      metrics.push({ key, label, format, rowLabel: 'Program', note, rows: programRows(mA, mB, () => 0) });
    }
  }

  // --- Cost components: the six per-kg rates behind Cost. Sent as rates, not as
  //     six more grids — the client multiplies them by the volume series. The
  //     rate itself can differ between plans (someone revised the barra cost),
  //     so a component's change captures both a rate move and a volume move.
  const PARTS: { key: string; label: string; rate: (p: any) => number }[] = [
    { key: 'barra', label: 'Barra cost', rate: (p) => (Number(p.primary_yield) > 0 ? Number(p.barra_cost_wr) / Number(p.primary_yield) : 0) },
    { key: 'packing', label: 'Packing', rate: (p) => Number(p.packing_cost_fp) || 0 },
    { key: 'processing', label: 'Processing', rate: (p) => Number(p.processing_cost_fp) || 0 },
    { key: 'storage', label: 'Storage', rate: (p) => Number(p.storage_cost_fp) || 0 },
    { key: 'freight', label: 'Freight', rate: (p) => Number(p.freight_cost_fp) || 0 },
    { key: 'other', label: 'Other costs', rate: (p) => Number(p.other_costs_fp) || 0 },
  ];
  const costComponents: CostComponent[] = outputsMissing
    ? []
    : PARTS.map(({ key, label, rate }) => {
        const rates: Record<string, { a: number; b: number }> = {};
        for (const code of allCodes) {
          const pa = progByCodeA.get(code);
          const pb = progByCodeB.get(code);
          rates[code] = { a: pa ? rate(pa) : 0, b: pb ? rate(pb) : 0 };
        }
        return { key, label, rates };
      });

  return { ...base, metrics, costComponents, outputsMissing };
}
