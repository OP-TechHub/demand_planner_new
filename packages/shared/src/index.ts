/**
 * Shared types across the workspace.
 *
 * NOTE: `database.types.ts` is generated from the live schema, not hand-written.
 * After linking your Supabase project, run:
 *
 *   npm run db:types
 *
 * ...and then re-export it from here. Until then, these hand-written types
 * cover what Session 1 needs. They are the *contract*, so if they drift from
 * the database, the database wins — regenerate.
 */

/**
 * The app's Postgres schema. Not `public`.
 *
 * Two consequences you must not forget:
 *  1. Both Supabase clients pass `db: { schema: DB_SCHEMA }`, or every query
 *     404s.
 *  2. `demand_planner` must be listed under Project Settings -> API ->
 *     Exposed schemas, or PostgREST refuses to serve it at all.
 */
export const DB_SCHEMA = 'demand_planner' as const;

export type UserRole = 'admin' | 'planner' | 'contributor' | 'viewer';
export type PlanType = 'master' | 'scenario';
export type ProgramStatus = 'active' | 'pipeline' | 'inactive';
export type MarginMetric = 'margin_fp' | 'margin_wr' | 'total_contribution';
export type AllocationMode = 'fill_what_you_can' | 'all_or_nothing';
export type PlanScope = 'active' | 'active_pipeline';
export type AllocPath = 'primary' | 'secondary' | 'tertiary';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  allowed_email_domain: string;
}

export interface AppUser {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
  edit_sections: string[];
}

export interface Plan {
  id: string;
  org_id: string;
  type: PlanType;
  parent_plan_id: string | null;
  name: string;
  description: string;
  owner_user_id: string | null;
  is_locked: boolean;
  plan_start_date: string;
  horizon_months: number;
  settings_margin_metric: MarginMetric;
  settings_allocation_mode: AllocationMode;
  settings_scope: PlanScope;
  settings_lookback_months: number;
  last_computed_at: string | null;
  forked_at: string | null;
}

export interface Bucket {
  id: string;
  org_id: string;
  name: string;
  sort_order: number;
  is_archived: boolean;
}

/**
 * A program: one customer × product line within a plan. Mirrors
 * `demand_planner.programs` (data-model.md §4). Numeric columns arrive from
 * PostgREST as JS numbers.
 */
export interface Program {
  id: string;
  plan_id: string;
  status: ProgramStatus;
  item_code: string;
  item_description: string;
  customer: string;
  max_monthly_demand_fp: number;
  primary_bucket_id: string;
  secondary_bucket_id: string | null;
  tertiary_bucket_id: string | null;
  primary_yield: number;
  secondary_yield: number | null;
  tertiary_yield: number | null;
  price_per_fp: number;
  barra_cost_wr: number;
  packing_cost_fp: number;
  processing_cost_fp: number;
  storage_cost_fp: number;
  freight_cost_fp: number;
  other_costs_fp: number;
  locked: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

/** One editable cell of the sparse per-program demand grid (data-model.md §4). */
export interface DemandCell {
  id: string;
  plan_id: string;
  program_id: string;
  month_index: number;
  demand_fp: number;
}

/** One editable cell of the sparse per-bucket harvest grid (data-model.md §4). */
export interface HarvestCell {
  id: string;
  plan_id: string;
  bucket_id: string;
  month_index: number;
  capacity_kg_wr: number;
}

/** The fixed planning horizon (months). data-model.md fixes this at 60 for v1. */
export const HORIZON_MONTHS = 60 as const;

/** Program status → chip color intent, shared by list + panel. */
export const PROGRAM_STATUS_META: Record<ProgramStatus, { label: string; tone: 'active' | 'pipeline' | 'inactive' }> = {
  active: { label: 'Active', tone: 'active' },
  pipeline: { label: 'Pipeline', tone: 'pipeline' },
  inactive: { label: 'Inactive', tone: 'inactive' },
};

/** Role capability checks. Single source of truth for the UI. */
export const can = {
  manageUsers: (r: UserRole) => r === 'admin',
  editBuckets: (r: UserRole) => r === 'admin',
  editMaster: (r: UserRole) => r === 'admin' || r === 'planner',
  createScenario: (r: UserRole) => r !== 'viewer',
} as const;

/**
 * Sections whose edit access can be granted per user. Admins always have all;
 * everyone else edits only the sections they've been granted (empty = view-only).
 */
export const EDITABLE_SECTIONS = ['programs', 'demand_plan', 'harvest_plan', 'buckets'] as const;
export type EditableSection = (typeof EDITABLE_SECTIONS)[number];

export const SECTION_LABEL: Record<EditableSection, string> = {
  programs: 'Programs',
  demand_plan: 'Demand Plan',
  harvest_plan: 'Harvest Plan',
  buckets: 'Buckets',
};

/** Can this user edit a given section? Admin ⇒ everything; others ⇒ granted only. */
export function canEditSection(
  role: UserRole,
  editSections: string[] | null | undefined,
  section: EditableSection
): boolean {
  if (role === 'admin') return true;
  return (editSections ?? []).includes(section);
}

/**
 * Month index (1-60) -> calendar label, derived from the plan's start date.
 * M1 = plan_start_date. Matches the workbook: 2026-04-01 -> "Apr 26".
 */
export function monthLabel(planStartDate: string, monthIndex: number): string {
  const start = new Date(planStartDate + 'T00:00:00Z');
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (monthIndex - 1), 1));
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = String(d.getUTCFullYear()).slice(2);
  return `${month} ${year}`;
}

/**
 * Financial year (Apr-Mar) for a month index.
 * M1-M12 -> fy1, M13-M24 -> fy2, etc. Assumes plan starts in April.
 */
export function fiscalYearOf(monthIndex: number): 1 | 2 | 3 | 4 | 5 {
  return (Math.floor((monthIndex - 1) / 12) + 1) as 1 | 2 | 3 | 4 | 5;
}
