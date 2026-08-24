import { getProfile } from '@/lib/plan';
import { loadCostingContext } from '@/lib/costing';
import { CostingSetupNotice } from '../setup-notice';
import { SkusClient } from './skus-client';

/**
 * The costing SKU master — one standalone list serving both markets
 * (Costing_Module_Decisions.md §2).
 *
 * Deliberately not joined to the demand planner's programs: these are product
 * recipes, not customer × item lines, and they must survive a plan rolling
 * forward. A customer master arrives later as its own standalone.
 */
export default async function CostingSkusPage() {
  const [ctx, profile] = await Promise.all([loadCostingContext(), getProfile()]);
  if (!ctx) return <CostingSetupNotice />;

  return (
    <SkusClient
      skus={ctx.skus}
      buckets={ctx.buckets}
      yields={Object.fromEntries(ctx.yields.entries())}
      orgId={ctx.version.org_id}
      isAdmin={(profile?.role ?? 'viewer') === 'admin'}
    />
  );
}
