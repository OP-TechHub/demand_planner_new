import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/plan';
import { forClient, getBaseCostAccess, loadCostingContext } from '@/lib/costing';
import { CostingSetupNotice } from './setup-notice';
import { CostGridClient } from './cost-grid-client';

/**
 * The live cost grid — every SKU at the current assumptions.
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
    [...ctx.rates.entries()].map(([id, r]) => [id, { sea: r.sea_rate_per_20ft, air: r.air_rate_per_lot }])
  );
  const yields = Object.fromEntries(ctx.yields.entries());

  // The grid prices in the browser, so hiding the base fish cost means sending
  // an equivalent-but-masked set of assumptions rather than simply not drawing
  // the numbers — they'd still be in the page payload.
  const { version, odc } = forClient(ctx, baseCost);

  return (
    <CostGridClient
      version={version}
      odc={odc}
      buckets={ctx.buckets}
      destinations={ctx.destinations}
      rates={rates}
      skus={ctx.skus}
      yields={yields}
      authors={authors}
      currentUserId={profile?.id ?? null}
      isAdmin={(profile?.role ?? 'viewer') === 'admin'}
      canViewBaseCost={baseCost.canView}
    />
  );
}
