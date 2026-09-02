import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/plan';
import { forClient, getBaseCostAccess, loadCostingContext } from '@/lib/costing';
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
  const supabase = await createClient();
  const [ctx, profile, baseCost, { data: users }] = await Promise.all([
    loadCostingContext(),
    getProfile(),
    getBaseCostAccess(),
    supabase.from('users').select('id, full_name'),
  ]);
  if (!ctx) return <CostingSetupNotice />;

  // Now that anyone can add a SKU, the list mixes shared company recipes with
  // colleagues' additions. Without an author it's impossible to tell which is
  // which — and a SKU someone added shows up in everybody's cost grid.
  const authors = Object.fromEntries(
    ((users ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name])
  );

  // Same reason as the grid: the SKU dialog costs live in the browser, so a
  // user without the grant gets assumptions that price identically and say
  // nothing about the feed price or the ODC components.
  const { version, odc } = forClient(ctx, baseCost);

  return (
    <SkusClient
      skus={ctx.skus}
      buckets={ctx.buckets}
      yields={Object.fromEntries(ctx.yields.entries())}
      // The ingredients behind each marinade cost. Loaded for every SKU, not
      // just the one being edited, because the builder offers every ingredient
      // anyone has already priced as you type.
      marinadeLines={Object.fromEntries(ctx.marinadeLines.entries())}
      orgId={ctx.version.org_id}
      // Passed so the editor can show what each override would inherit if left
      // blank — a new SKU shouldn't be a guess about what the defaults are.
      version={version}
      // The dialog costs the SKU live, before saving, using the same engine the
      // grid uses — so it needs the same assumptions and freight rates.
      odc={odc}
      destinations={ctx.destinations}
      rates={Object.fromEntries(
        [...ctx.rates.entries()].map(([id, r]) => [id, { sea: r.sea_rate_per_20ft, air: r.air_rate_per_lot }])
      )}
      // Anyone may add a SKU; editing one is limited to whoever created it
      // (Decisions §5, same rule as costings). The seeded 34 have no creator,
      // so they stay admin-only — they are shared company recipes.
      currentUserId={profile?.id ?? null}
      authors={authors}
      isAdmin={(profile?.role ?? 'viewer') === 'admin'}
      canViewBaseCost={baseCost.canView}
    />
  );
}
