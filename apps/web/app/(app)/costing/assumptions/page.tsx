import { getProfile } from '@/lib/plan';
import {
  canEditAssumptions,
  type CostDestinationRow,
  type CostOdcComponentRow,
  type UserRole,
} from '@oceanpick/shared';
import { createClient } from '@/lib/supabase/server';
import { forClient, getBaseCostAccess, loadCostingContext, maskBaseCost } from '@/lib/costing';
import { CostingSetupNotice } from '../setup-notice';
import { AssumptionsClient } from './assumptions-client';

/**
 * The official farm economics: feed, FCR, FX, ODC, adders, margins, and the
 * destination freight table.
 *
 * Admin-maintained by default (Decisions §4/§5), but an admin can hand the
 * upkeep to a named user: 'base_cost_edit' for the two protected sections,
 * 'assumptions_edit' for everything else. Most of it is readable by everyone — a
 * costing is unreadable without knowing what it was built on — but the two
 * sections that say what the fish costs to grow ("Base fish cost" and "Other
 * direct costs") are commercially sensitive and hidden unless an admin has
 * granted the user base-cost view. Only an admin decides what a fish costs to
 * grow, unless they have handed that out too; users who need a different number
 * override it inside their own costing instead, where the deviation is visible.
 *
 * The hidden numbers are masked out of the props rather than merely left
 * unrendered — this page ships `version` to the browser for the live preview,
 * so an unrendered field would still be readable in the page payload.
 */
export default async function AssumptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const sp = await searchParams;
  const [ctx, profile, baseCost] = await Promise.all([
    loadCostingContext(sp.v ?? null),
    getProfile(),
    getBaseCostAccess(),
  ]);
  if (!ctx) return <CostingSetupNotice />;

  // Retired ports, which the costing context deliberately leaves out — nothing
  // prices against them. They are here only so this screen can offer to bring
  // one back, instead of it disappearing the moment someone retires it.
  const supabase = await createClient();
  const { data: retired } = await supabase
    .from('cost_destinations')
    .select('*')
    .eq('is_active', false)
    .order('sort_order');

  const rates = Object.fromEntries(
    [...ctx.rates.entries()].map(([id, r]) => [id, { sea: r.sea_rate_per_20ft, air: r.air_rate_per_lot }])
  );

  const { version, odc } = forClient(ctx, baseCost);

  return (
    <AssumptionsClient
      version={version}
      // The picker carries every version, and each one is a full row — so the
      // whole list is masked, not just the selected one.
      versions={
        baseCost.canView
          ? ctx.versions
          : ctx.versions.map((v) => maskBaseCost(v, [] as CostOdcComponentRow[]).version)
      }
      odc={odc}
      buckets={ctx.buckets}
      destinations={ctx.destinations}
      retiredDestinations={(retired ?? []) as CostDestinationRow[]}
      rates={rates}
      isAdmin={(profile?.role ?? 'viewer') === 'admin'}
      canViewBaseCost={baseCost.canView}
      canEditBaseCost={baseCost.canEdit}
      canEditAssumptions={canEditAssumptions((profile?.role ?? 'viewer') as UserRole, profile?.edit_sections)}
    />
  );
}
