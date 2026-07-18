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
  settings_plan_years_ahead: number;
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
 * Can this user edit a section OF THIS PLAN?
 *
 * Mirrors the DB's can_write_section() exactly, so the UI never offers an edit
 * the database will reject:
 *   • a locked plan (read-only snapshot) is never editable
 *   • a scenario is editable only by its owner
 *   • the master honours role + section grants
 */
export function canEditPlanSection(
  plan: { type: PlanType; owner_user_id: string | null; is_locked: boolean },
  user: { id: string; role: UserRole; edit_sections?: string[] | null },
  section: EditableSection
): boolean {
  if (plan.is_locked) return false;
  if (plan.type === 'scenario') return plan.owner_user_id === user.id;
  return canEditSection(user.role, user.edit_sections, section);
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
 * Which month index a calendar date falls in, relative to the plan start.
 * A date anywhere in M1's month returns 1. Returns null when the date lands
 * outside the plan's window (before M1, or past the horizon). The day of month
 * is ignored — planning is monthly, so a delivery on the 7th and the 28th of
 * the same month are the same slot.
 */
export function monthIndexOfDate(
  planStartDate: string,
  date: string,
  horizon: number
): number | null {
  const start = new Date(planStartDate + 'T00:00:00Z');
  const d = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const index =
    (d.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (d.getUTCMonth() - start.getUTCMonth()) + 1;
  return index >= 1 && index <= horizon ? index : null;
}

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Read a CSV month column heading back into a month index (inverse of
 * monthLabel). Returns null when the heading names no month, or names one
 * outside the plan's window.
 *
 * Deliberately liberal, because a heading rarely survives a round-trip intact:
 * Excel reads "Apr 26" as a date and writes it back as "26-Apr", so the year
 * and the day-of-month swap places. Both are accepted — a bare 1-2 digit number
 * beside a month name is read as a 2-digit year either way, which lands on the
 * right month because our labels only ever carry a year. "M1" is still accepted
 * so CSVs exported before the headings changed continue to import.
 */
export function parseMonthHeader(
  planStartDate: string,
  header: string,
  horizon: number
): number | null {
  const h = header.trim().toLowerCase();
  if (!h) return null;

  const legacy = /^m(\d+)$/.exec(h);
  if (legacy) {
    const i = Number(legacy[1]);
    return i >= 1 && i <= horizon ? i : null;
  }

  // Split on anything that isn't alphanumeric: "Apr 26", "26-Apr", "Apr/2026".
  const tokens = h.split(/[^a-z0-9]+/).filter(Boolean);

  let month0 = -1;
  let year = -1;
  for (const t of tokens) {
    const named = MONTH_ABBR.findIndex((a) => t.startsWith(a));
    if (named !== -1 && month0 === -1) { month0 = named; continue; }
    if (/^\d{1,4}$/.test(t) && year === -1) year = Number(t);
  }

  // Numeric-only form: "2026-04" (a bare month number needs the year first, or
  // there's no telling which of the two numbers is which).
  if (month0 === -1) {
    if (tokens.length !== 2) return null;
    const [a, b] = tokens.map(Number);
    if (!(a >= 1000 && b >= 1 && b <= 12)) return null;
    year = a;
    month0 = b - 1;
  }

  if (month0 === -1 || year === -1) return null;
  if (year < 100) year += 2000;

  const start = new Date(planStartDate + 'T00:00:00Z');
  const index =
    (year - start.getUTCFullYear()) * 12 + (month0 - start.getUTCMonth()) + 1;
  return index >= 1 && index <= horizon ? index : null;
}

/**
 * Financial year (Apr-Mar) for a month index.
 * M1-M12 -> fy1, M13-M24 -> fy2, etc. Assumes plan starts in April.
 */
export function fiscalYearOf(monthIndex: number): 1 | 2 | 3 | 4 | 5 {
  return (Math.floor((monthIndex - 1) / 12) + 1) as 1 | 2 | 3 | 4 | 5;
}
