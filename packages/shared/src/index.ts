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
  /** true = a user's private sandbox; false = master or an official plan. */
  is_sandbox: boolean;
  /** true = the org's default working ("live") plan. At most one per org. */
  is_live: boolean;
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
  /** ERP export item number (EXPORT006…). Reference only — item_code stays the key. */
  export_code: string | null;
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
  /** A private sandbox scenario — any non-viewer may create their own. */
  createScenario: (r: UserRole) => r !== 'viewer',
  /** An official plan (master or admin copy) — admins only. */
  createPlan: (r: UserRole) => r === 'admin',
} as const;

/**
 * Sections whose edit access can be granted per user. Admins always have all;
 * everyone else edits only the sections they've been granted (empty = view-only).
 */
export const EDITABLE_SECTIONS = [
  'programs',
  'demand_plan',
  'harvest_plan',
  'buckets',
  'inquiry',
  'harvest_request',
  'base_cost_view',
  'base_cost_edit',
  'assumptions_edit',
] as const;
export type EditableSection = (typeof EDITABLE_SECTIONS)[number];

/**
 * The tabs whose edit access is granted PER PLAN (see plan_editor_grants).
 * 'buckets' is excluded — buckets are org-wide (no plan_id), so their grant
 * stays global via canEditSection / users.edit_sections. 'inquiry' isn't a
 * table — it's the right to save inquiries into the plan's pipeline.
 *
 * 'harvest_request' is held by the processing plant and is intentionally
 * separate from 'harvest_plan': stating a monthly requirement and editing the
 * harvest capacity are different jobs, usually different people.
 */
export const PLAN_EDITABLE_SECTIONS = ['programs', 'demand_plan', 'harvest_plan', 'inquiry', 'harvest_request'] as const;
export type PlanEditableSection = (typeof PLAN_EDITABLE_SECTIONS)[number];

export const SECTION_LABEL: Record<EditableSection, string> = {
  programs: 'Programs',
  demand_plan: 'Demand Plan',
  harvest_plan: 'Harvest Plan',
  buckets: 'Buckets',
  inquiry: 'New Inquiry',
  harvest_request: 'Harvest Request Plan',
  base_cost_view: 'Base cost — view',
  base_cost_edit: 'Base cost — edit',
  assumptions_edit: 'Assumptions — edit',
};

/**
 * What the fish costs to grow — the feed price, clearing, import tax, FCR, FX
 * and the other-direct-cost components. Commercially sensitive (they are
 * supplier prices and a tax position), so unlike the rest of the assumptions
 * they are hidden from everyone by default and released per user by an admin.
 *
 * Two grants rather than one, because the people who need to SEE the number to
 * sanity-check a quote are usually not the people allowed to CHANGE it.
 */
export const BASE_COST_VIEW = 'base_cost_view';
export const BASE_COST_EDIT = 'base_cost_edit';

/** May this user see the base fish cost and the ODC components? */
export function canViewBaseCost(role: UserRole, editSections: string[] | null | undefined): boolean {
  if (role === 'admin') return true;
  const granted = editSections ?? [];
  // Edit implies view: granting the right to change a number you cannot read
  // would be nonsense, and it spares an admin from having to tick both.
  return granted.includes(BASE_COST_VIEW) || granted.includes(BASE_COST_EDIT);
}

/** May this user change them — i.e. publish a version that alters them? */
export function canEditBaseCost(role: UserRole, editSections: string[] | null | undefined): boolean {
  if (role === 'admin') return true;
  return (editSections ?? []).includes(BASE_COST_EDIT);
}

/**
 * The REST of the Assumptions screen — everything the base-cost grants don't
 * already cover: the adders (transport, cold holding, freight to port, cold
 * chain), the margins, container fill and air lot weights, the destination
 * freight rates, and the size-grade medians and FCRs.
 *
 * Deliberately one grant rather than several. These are not secret the way the
 * fish cost is — everyone can already read them — so this is about who
 * maintains them, and in practice that is one person per company, not one per
 * section.
 */
export const ASSUMPTIONS_EDIT = 'assumptions_edit';

/** May this user change the non-base-cost assumptions? */
export function canEditAssumptions(role: UserRole, editSections: string[] | null | undefined): boolean {
  if (role === 'admin') return true;
  return (editSections ?? []).includes(ASSUMPTIONS_EDIT);
}

/**
 * May this user publish a new assumptions version at all — i.e. is any part of
 * the screen theirs to change? Publishing always mints a whole version; which
 * FIELDS of it they may actually move is the two checks above.
 */
export function canPublishAssumptions(role: UserRole, editSections: string[] | null | undefined): boolean {
  return canEditAssumptions(role, editSections) || canEditBaseCost(role, editSections);
}

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
 * Can this user edit a plan-scoped tab OF THIS PLAN?
 *
 * Mirrors the DB's can_write_section() exactly, so the UI never offers an edit
 * the database will reject:
 *   • a locked plan is never editable (not even by an admin — unlock first)
 *   • an admin edits any unlocked plan
 *   • a sandbox scenario is fully editable by its owner (all tabs)
 *   • an official plan needs an explicit per-plan grant for that tab
 *
 * `hasGrant` is whether a plan_editor_grants row exists for (plan, user, tab);
 * the caller loads it (e.g. via getMyPlanGrants). It's ignored for sandboxes.
 */
export function canEditPlanSection(
  plan: { is_locked: boolean; is_sandbox: boolean; owner_user_id: string | null },
  user: { id: string; role: UserRole },
  hasGrant: boolean
): boolean {
  if (plan.is_locked) return false;
  if (user.role === 'admin') return true;
  if (plan.is_sandbox) return plan.owner_user_id === user.id;
  return hasGrant;
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

// ============================================================================
// COSTING MODULE
//
// Mirrors the `cost_*` tables (supabase/migrations/20260824000001_costing_module.sql).
// Deliberately standalone: nothing here references a plan, program or bucket
// from the demand planner (costing_module/Costing_Module_Decisions.md §1).
// Numeric columns arrive from PostgREST as JS numbers.
// ============================================================================

export type CostMarket = 'domestic' | 'export';
export type CostCurrency = 'LKR' | 'USD';
export type CostOdcBasis = 'per_kg' | 'per_fish';
export type CostSkuStatus = 'active' | 'inactive';
export type CostDestMode = 'single' | 'multi';
export type CostRawMaterialBasis = 'full_fish' | 'absorbed';
export type CostProductState = 'unglazed' | 'glazed' | 'frozen_plain' | 'frozen_glazed' | 'fresh';

/** Frozen, fresh, or costed either way. Fresh cannot carry glaze — glaze is ice. */
export type CostProductForm = 'frozen' | 'fresh' | 'both';
/** Which market's grid a SKU appears in. Its recipe is shared regardless. */
export type CostMarketScope = 'domestic' | 'export' | 'both';
/** margin = cost-plus; target = the price is named and the margin derived. */
export type CostPricingMode = 'margin' | 'target';

/** The category vocabulary in use. Free text in the DB; this is the offered set. */
export const COST_CATEGORIES = ['Whole', 'Fillet', 'By-product', 'Value-added'] as const;

/** Costing's own copy of the size grades — NOT demand_planner.buckets. */
export interface CostSizeBucket {
  id: string;
  org_id: string;
  label: string;
  min_g: number;
  max_g: number;
  median_g: number;
  fcr: number;
  sort_order: number;
}

export interface CostAssumptionVersion {
  id: string;
  org_id: string;
  version_no: number;
  label: string;
  notes: string;
  is_current: boolean;
  effective_from: string;
  feed_cost_per_kg: number;
  clearing_cost_per_kg: number;
  fcr_reference: number;
  fx_rate: number;
  import_tax_pct_domestic: number;
  import_tax_pct_export: number;
  domestic_transport_lkr: number;
  domestic_cold_hold_lkr: number;
  export_freight_to_port_usd: number;
  export_cold_chain_usd: number;
  rack_margin_pct: number;
  fob_margin_pct: number;
  importer_clearing_pct: number;
  importer_markup_pct: number;
  distributor_markup_pct: number;
  container_fill_kg: number;
  air_lot_kg: number;
}

export interface CostOdcComponentRow {
  id: string;
  version_id: string;
  name: string;
  value: number;
  currency: CostCurrency;
  basis: CostOdcBasis;
  sort_order: number;
}

export interface CostDestinationRow {
  id: string;
  org_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export interface CostDestinationRate {
  version_id: string;
  destination_id: string;
  sea_rate_per_20ft: number;
  air_rate_per_lot: number;
}

export interface CostSkuRow {
  id: string;
  org_id: string;
  name: string;
  status: CostSkuStatus;
  category: string;
  sort_order: number;
  glaze_pct: number;
  base_yield: number;
  pct_fish: number;
  pct_marinade: number;
  marinade_usd_per_kg: number;
  process_usd_per_kg: number;
  packing_usd_per_kg: number;
  pack_size: string | null;
  raw_material_basis: CostRawMaterialBasis;
  product_form: CostProductForm;
  market_scope: CostMarketScope;
  /**
   * The port this SKU is normally quoted to. Nothing up to FOB depends on it —
   * it sets the freight that turns FOB into CIF, and the trade ladder past
   * that. Null falls back to the first active destination.
   */
  default_destination_id: string | null;
  /**
   * The size grade this SKU is normally costed at. Unlike the port, this moves
   * the cost — it selects the FCR and the per-grade yield. Null is the flat
   * reference model.
   */
  default_bucket_id: string | null;
  /** Free text until a customer master exists. */
  customer: string;
  /**
   * How the selling price is arrived at. In 'target' mode the market_price_*
   * columns below ARE the target — one number, not two that can drift.
   */
  pricing_mode: CostPricingMode;
  market_price_lkr: number | null;
  market_price_usd: number | null;
  /**
   * Grams of marinade that the ingredient recipe's total cost is divided by.
   * Null means marinade_usd_per_kg was typed directly rather than built from
   * ingredients — which is the case for every SKU that has no marinade at all.
   */
  marinade_total_dose_g: number | null;
  override_rack_margin_pct: number | null;
  override_fob_margin_pct: number | null;
  override_transport_lkr: number | null;
  override_cold_hold_lkr: number | null;
  override_freight_to_port_usd: number | null;
  override_cold_chain_usd: number | null;
  /** Past FOB: null inherits the assumption version's value. */
  override_importer_clearing_pct: number | null;
  override_importer_markup_pct: number | null;
  override_distributor_markup_pct: number | null;
  /** Null for the seeded workbook recipes — those are admin-maintained. */
  created_by: string | null;
  deleted_at: string | null;
}

export interface CostSkuBucketYield {
  sku_id: string;
  bucket_id: string;
  yield_pct: number;
}

/**
 * One ingredient in a SKU's marinade, priced in LKR.
 *
 * Fish never appears here: the engine already carries it as whole-fish cost ÷
 * yield, so pricing it again in the marinade would count it twice.
 */
export interface CostSkuMarinadeLine {
  id: string;
  sku_id: string;
  sort_order: number;
  ingredient: string;
  qty_g: number;
  price_lkr_per_kg: number;
}

/** An ingredient row as the SKU form posts it — no id yet, no SKU to belong to. */
export interface CostMarinadeLineInput {
  ingredient: string;
  qty_g: number;
  price_lkr_per_kg: number;
}

/**
 * The marinade chain, from ingredients to the USD figure the engine consumes.
 *
 * Total dose is a parameter rather than the sum of the doses: a batch loses
 * weight to cooking, so the marinade retained in the finished product weighs
 * less than what went in, and dividing by the input weight under-recovers.
 */
export function marinadeCostFromLines(
  lines: CostMarinadeLineInput[],
  totalDoseG: number,
  fxRate: number
): { totalLkr: number; lkrPerKg: number; usdPerKg: number } | null {
  const totalLkr = lines.reduce((sum, l) => sum + (l.qty_g * l.price_lkr_per_kg) / 1000, 0);
  if (!(totalDoseG > 0) || !(fxRate > 0)) return null;
  const lkrPerKg = (totalLkr / totalDoseG) * 1000;
  return { totalLkr, lkrPerKg, usdPerKg: lkrPerKg / fxRate };
}

export interface CostCosting {
  id: string;
  org_id: string;
  name: string;
  notes: string;
  market: CostMarket;
  version_id: string;
  /** Fields this costing deviates from the official set on. */
  assumption_overrides: Record<string, number>;
  bucket_id: string | null;
  destination_mode: CostDestMode;
  created_at: string;
  created_by: string;
  deleted_at: string | null;
}

export interface CostCostingDestination {
  costing_id: string;
  destination_id: string;
  destination_name: string;
  is_primary: boolean;
  sort_order: number;
}

export interface CostCostingLine {
  id: string;
  costing_id: string;
  sku_id: string | null;
  sku_name: string;
  destination_id: string | null;
  destination_name: string | null;
  state: CostProductState;
  currency: CostCurrency;
  final_cost: number;
  selling_price: number | null;
  contribution_per_kg: number | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  sort_order: number;
}

/** Human labels for the shipping/pack states. */
export const COST_STATE_LABEL: Record<CostProductState, string> = {
  unglazed: 'No glaze',
  glazed: 'With glaze',
  frozen_plain: 'Frozen · no glaze',
  frozen_glazed: 'Frozen · glazed',
  fresh: 'Fresh (air)',
};
