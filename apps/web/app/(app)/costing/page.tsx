import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/plan';
import { canPublishAssumptions, type UserRole } from '@oceanpick/shared';
import { forClient, forClientByVersion, getBaseCostAccess, loadCostingContext } from '@/lib/costing';
import { CostingSetupNotice } from './setup-notice';
import { CostGridClient, type CostGridProps } from './cost-grid-client';
import { OfflineCopy } from '@/components/pwa/offline-copy';

/**
 * The live cost grid — every SKU on the assumptions version it is costed on.
 *
 * The grid computes in the browser, not here: the engine is pure and small, so
 * switching market, bucket or destination is instant rather than a round trip.
 * That matters because comparing SKUs side by side is the whole point of the
 * view (Costing_Module_Decisions.md §9).
 */
export default async function CostingPage() {
  const supabase = await createClient();
  const [ctx, profile, baseCost, { data: users }] = await Promise.all([
    loadCostingContext(),
    getProfile(),
    getBaseCostAccess(),
    supabase.from('users').select('id, full_name'),
  ]);
  if (!ctx) return <CostingSetupNotice />;

  // Anyone may add a SKU, so the grid mixes shared workbook recipes with
  // colleagues' additions — and a row's price is only as trustworthy as the
  // person who set its recipe up. Resolved once here rather than per row.
  const authors = Object.fromEntries(
    ((users ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name])
  );

  const rates = Object.fromEntries(
    [...ctx.rates.entries()].map(([id, r]) => [id, { sea: r.sea_rate_per_20ft, air: r.air_rate_per_lot, duty: r.duty_levy_pct ?? null }])
  );
  const yields = Object.fromEntries(ctx.yields.entries());

  // The grid prices in the browser, so hiding the base fish cost means sending
  // an equivalent-but-masked set of assumptions rather than simply not drawing
  // the numbers — they'd still be in the page payload.
  const { version, odc } = forClient(ctx, baseCost);
  // Each SKU is priced on its own version, so every version in play goes to
  // the browser — masked one by one, since an older feed price is still the
  // feed price.
  const byVersion = forClientByVersion(ctx, baseCost);
  // Moving a SKU onto new assumptions is gated like publishing them (the DB
  // policy is the enforcement; this only decides whether to draw the buttons).
  const role = (profile?.role ?? 'viewer') as UserRole;
  const canRecost = canPublishAssumptions(role, profile?.edit_sections);

  const props: CostGridProps = {
    version,
    odc,
    costedVersions: Object.fromEntries(ctx.costedVersions.entries()),
    byVersion,
    canRecost,
    buckets: ctx.buckets,
    destinations: ctx.destinations,
    rates,
    skus: ctx.skus,
    yields,
    authors,
    currentUserId: profile?.id ?? null,
    isAdmin: (profile?.role ?? 'viewer') === 'admin',
    canViewBaseCost: baseCost.canView,
  };
  return (
    <OfflineCopy route="costing" props={props}>
      <CostGridClient {...props} />
    </OfflineCopy>
  );
}
