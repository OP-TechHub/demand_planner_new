// Engine input/output types. The engine is pure and I/O-free: the app adapts
// its DB rows into EngineInput, runs the engine, and persists the results.
// Bucket identifiers are opaque strings (DB uses ids; the V30 fixture uses names).

/**
 * A program's sourcing paths, in cascade order — each a (size bucket, yield).
 * Primary is required; the rest are optional. Five is the cap: each path has its
 * own allocations enum value, programs columns and rolling_results borrow columns.
 */
export const PATH_KEYS = ['primary', 'secondary', 'tertiary', 'quaternary', 'quinary'] as const;
export type PathKey = (typeof PATH_KEYS)[number];
export type Status = 'active' | 'pipeline' | 'inactive';
export type MarginMetric = 'margin_fp' | 'margin_wr' | 'total_contribution';
export type AllocationMode = 'fill_what_you_can' | 'all_or_nothing';
export type Scope = 'active' | 'active_pipeline';

export interface EngineBucket {
  id: string;
  sortOrder: number; // lower = higher priority (Bucket Legend order)
}

export interface EngineProgram {
  id: string;
  status: Status;
  locked: boolean;
  primaryBucket: string;
  primaryYield: number;
  secondaryBucket: string | null;
  secondaryYield: number | null;
  tertiaryBucket: string | null;
  tertiaryYield: number | null;
  /** Optional 4th and 5th paths — absent on older callers/fixtures, treated as none. */
  quaternaryBucket?: string | null;
  quaternaryYield?: number | null;
  quinaryBucket?: string | null;
  quinaryYield?: number | null;
  price: number;
  barraCostWr: number;
  packing: number;
  processing: number;
  storage: number;
  freight: number;
  other: number;
  /** Effective demand (FP) per month, length === input.months. */
  demand: number[];
}

export interface Settings {
  marginMetric: MarginMetric;
  allocationMode: AllocationMode;
  scope: Scope;
  lookbackMonths: number;
}

export interface EngineInput {
  months: number;
  buckets: EngineBucket[];
  programs: EngineProgram[];
  /** bucketId -> capacity (kg WR) per month, length === months. */
  harvest: Record<string, number[]>;
  settings: Settings;
}
