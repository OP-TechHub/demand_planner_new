import { getProfile } from '@/lib/plan';
import { loadCostingContext } from '@/lib/costing';
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
  const [ctx, profile] = await Promise.all([loadCostingContext(), getProfile()]);
  if (!ctx) return <CostingSetupNotice />;

  const rates = Object.fromEntries(
    [...ctx.rates.entries()].map(([id, r]) => [id, { sea: r.sea_rate_per_20ft, air: r.air_rate_per_lot }])
  );
  const yields = Object.fromEntries(ctx.yields.entries());

  return (
    <CostGridClient
      version={ctx.version}
      odc={ctx.odc}
      buckets={ctx.buckets}
      destinations={ctx.destinations}
      rates={rates}
      skus={ctx.skus}
      yields={yields}
      isAdmin={(profile?.role ?? 'viewer') === 'admin'}
    />
  );
}
