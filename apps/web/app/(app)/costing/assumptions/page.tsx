import { getProfile } from '@/lib/plan';
import { loadCostingContext } from '@/lib/costing';
import { CostingSetupNotice } from '../setup-notice';
import { AssumptionsClient } from './assumptions-client';

/**
 * The official farm economics: feed, FCR, FX, ODC, adders, margins, and the
 * destination freight table.
 *
 * Admin-maintained (Decisions §4/§5). Everyone can read them — a costing is
 * unreadable without knowing what it was built on — but only an admin decides
 * what a fish costs to grow. Users who need a different number override it
 * inside their own costing instead, where the deviation is visible.
 */
export default async function AssumptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const sp = await searchParams;
  const [ctx, profile] = await Promise.all([loadCostingContext(sp.v ?? null), getProfile()]);
  if (!ctx) return <CostingSetupNotice />;

  const rates = Object.fromEntries(
    [...ctx.rates.entries()].map(([id, r]) => [id, { sea: r.sea_rate_per_20ft, air: r.air_rate_per_lot }])
  );

  return (
    <AssumptionsClient
      version={ctx.version}
      versions={ctx.versions}
      odc={ctx.odc}
      buckets={ctx.buckets}
      destinations={ctx.destinations}
      rates={rates}
      isAdmin={(profile?.role ?? 'viewer') === 'admin'}
    />
  );
}
