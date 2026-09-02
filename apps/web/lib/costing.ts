// Costing data layer — SERVER ONLY.
//
// Imports `next/headers` via the Supabase server client, so this module must
// never be reached from a client component. The pure row->engine adapters live
// in `lib/costing-adapt.ts` and are re-exported here for server callers'
// convenience; client components must import them from there directly.
// No `server-only` package in this project, so the boundary is held by convention
// and by the build: importing this from a client component pulls in
// `next/headers` and fails the compile immediately, which is how the split into
// costing-adapt.ts was found in the first place.
import { canEditBaseCost, canViewBaseCost, type UserRole } from '@oceanpick/shared';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/plan';
import { maskBaseCost } from '@/lib/costing-base-cost';
import type {
  CostAssumptionVersion,
  CostDestinationRate,
  CostDestinationRow,
  CostOdcComponentRow,
  CostSizeBucket,
  CostSkuBucketYield,
  CostSkuMarinadeLine,
  CostSkuRow,
} from '@oceanpick/shared';

export * from '@/lib/costing-adapt';
export * from '@/lib/costing-base-cost';

/** What the signed-in user may do with the base fish cost and the ODC table. */
export interface BaseCostAccess {
  canView: boolean;
  canEdit: boolean;
}

/**
 * Resolve the caller's base-cost grants once per request.
 *
 * Every costing screen needs this — the ones that show the numbers, and the
 * ones that merely have to avoid shipping them to the browser — so it reads
 * the request-cached profile rather than re-querying `users`.
 */
export async function getBaseCostAccess(): Promise<BaseCostAccess> {
  const profile = await getProfile();
  const role = (profile?.role ?? 'viewer') as UserRole;
  return {
    canView: canViewBaseCost(role, profile?.edit_sections),
    canEdit: canEditBaseCost(role, profile?.edit_sections),
  };
}

/**
 * The assumptions to hand a client component, masked unless the caller is
 * allowed to see them. Every page that passes `version` and `odc` into the
 * browser goes through here — that is the whole enforcement point, since the
 * grid and the SKU dialog cost in the browser.
 */
export function forClient(
  ctx: Pick<CostingContext, 'version' | 'odc'>,
  access: BaseCostAccess
): { version: CostAssumptionVersion; odc: CostOdcComponentRow[] } {
  return access.canView
    ? { version: ctx.version, odc: ctx.odc }
    : maskBaseCost(ctx.version, ctx.odc);
}

/** Everything a costing screen needs, in one round of queries. */
export interface CostingContext {
  version: CostAssumptionVersion;
  /** Every version, newest first — for pinning and for the version picker. */
  versions: CostAssumptionVersion[];
  odc: CostOdcComponentRow[];
  buckets: CostSizeBucket[];
  destinations: CostDestinationRow[];
  rates: Map<string, CostDestinationRate>;
  skus: CostSkuRow[];
  /** skuId -> bucketId -> yield */
  yields: Map<string, Record<string, number>>;
  /** skuId -> its marinade recipe, in entry order. Absent means it has none. */
  marinadeLines: Map<string, CostSkuMarinadeLine[]>;
}

/**
 * Load the costing context, at a specific assumptions version or the current one.
 *
 * Returns null when the module has never been seeded — the caller renders a
 * setup notice rather than an empty grid, because an empty grid looks like a
 * bug and a missing seed is not one.
 */
export async function loadCostingContext(versionId?: string | null): Promise<CostingContext | null> {
  const supabase = await createClient();

  const [{ data: versions }, { data: buckets }, { data: destinations }, { data: skus }] = await Promise.all([
    supabase.from('cost_assumption_versions').select('*').order('version_no', { ascending: false }),
    supabase.from('cost_size_buckets').select('*').order('sort_order'),
    supabase.from('cost_destinations').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('cost_skus').select('*').is('deleted_at', null).order('sort_order'),
  ]);

  const allVersions = (versions ?? []) as CostAssumptionVersion[];
  if (allVersions.length === 0) return null;

  const version = versionId
    ? (allVersions.find((v) => v.id === versionId) ?? allVersions.find((v) => v.is_current) ?? allVersions[0]!)
    : (allVersions.find((v) => v.is_current) ?? allVersions[0]!);

  const [{ data: odc }, { data: rates }, { data: yields }, { data: marinade }] = await Promise.all([
    supabase.from('cost_odc_components').select('*').eq('version_id', version.id).order('sort_order'),
    supabase.from('cost_destination_rates').select('*').eq('version_id', version.id),
    // 34 SKUs x 7 buckets = 238 rows, comfortably under PostgREST's 1000 cap.
    supabase.from('cost_sku_bucket_yields').select('*'),
    // Only marinated SKUs carry any, a dozen rows each at the outside.
    supabase.from('cost_sku_marinade_lines').select('*').order('sort_order'),
  ]);

  const rateMap = new Map<string, CostDestinationRate>();
  for (const r of (rates ?? []) as CostDestinationRate[]) rateMap.set(r.destination_id, r);

  const yieldMap = new Map<string, Record<string, number>>();
  for (const y of (yields ?? []) as CostSkuBucketYield[]) {
    const existing = yieldMap.get(y.sku_id) ?? {};
    existing[y.bucket_id] = y.yield_pct;
    yieldMap.set(y.sku_id, existing);
  }

  const marinadeMap = new Map<string, CostSkuMarinadeLine[]>();
  for (const l of (marinade ?? []) as CostSkuMarinadeLine[]) {
    const existing = marinadeMap.get(l.sku_id);
    if (existing) existing.push(l);
    else marinadeMap.set(l.sku_id, [l]);
  }

  return {
    version,
    versions: allVersions,
    odc: (odc ?? []) as CostOdcComponentRow[],
    buckets: (buckets ?? []) as CostSizeBucket[],
    destinations: (destinations ?? []) as CostDestinationRow[],
    rates: rateMap,
    skus: (skus ?? []) as CostSkuRow[],
    yields: yieldMap,
    marinadeLines: marinadeMap,
  };
}
