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
      // Passed so the editor can show what each override would inherit if left
      // blank — a new SKU shouldn't be a guess about what the defaults are.
      version={ctx.version}
      // Anyone may add a SKU; editing one is limited to whoever created it
      // (Decisions §5, same rule as costings). The seeded 34 have no creator,
      // so they stay admin-only — they are shared company recipes.
      currentUserId={profile?.id ?? null}
      isAdmin={(profile?.role ?? 'viewer') === 'admin'}
    />
  );
}
