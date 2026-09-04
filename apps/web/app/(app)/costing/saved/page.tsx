import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/plan';
import { getBaseCostAccess, stripBaseCostOverrides } from '@/lib/costing';
import type { CostAssumptionVersion, CostCosting } from '@oceanpick/shared';
import { SavedList, type SavedRow } from './saved-list';

/**
 * Every saved costing in the org.
 *
 * Editable only by whoever made it (Decisions §5), and now visible on their
 * terms too: a private costing reaches this query only for its owner and for
 * admins, because the read policy filters it out for everyone else. Each row
 * shows the assumptions version it was pinned to, and flags the ones built on
 * overridden numbers so they can't be mistaken for the standard rates.
 */
export default async function SavedCostingsPage() {
  const supabase = await createClient();
  const [{ data: costings }, { data: versions }, profile, baseCost] = await Promise.all([
    supabase
      .from('cost_costings')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('cost_assumption_versions').select('*'),
    getProfile(),
    getBaseCostAccess(),
  ]);

  const rows = (costings ?? []) as CostCosting[];
  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Saved costings</h1>
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing saved yet. Build a costing on the grid, then snapshot it.
          </p>
          <Link href="/costing" className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            Go to the cost grid
          </Link>
        </div>
      </div>
    );
  }

  const versionById = new Map(
    ((versions ?? []) as CostAssumptionVersion[]).map((v) => [v.id, v])
  );

  // Line counts and author names, resolved in one pass each rather than per row.
  const [{ data: lineCounts }, { data: users }] = await Promise.all([
    supabase.from('cost_costing_lines').select('costing_id'),
    supabase.from('users').select('id, full_name'),
  ]);

  const counts = new Map<string, number>();
  for (const l of (lineCounts ?? []) as { costing_id: string }[]) {
    counts.set(l.costing_id, (counts.get(l.costing_id) ?? 0) + 1);
  }
  const names = new Map(((users ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]));

  const list: SavedRow[] = rows.map((c) => ({
    // Each row carries its whole costing, overrides and all — so a base-cost
    // deviation someone else saved would otherwise state the number here.
    costing: baseCost.canView
      ? c
      : { ...c, assumption_overrides: stripBaseCostOverrides(c.assumption_overrides) },
    versionLabel: (() => {
      const v = versionById.get(c.version_id);
      return v ? `v${v.version_no}${v.label ? ` · ${v.label}` : ''}` : 'unknown version';
    })(),
    versionIsCurrent: versionById.get(c.version_id)?.is_current ?? false,
    lineCount: counts.get(c.id) ?? 0,
    authorName: names.get(c.created_by) ?? 'Unknown',
    canEdit: c.created_by === profile?.id || profile?.role === 'admin',
    // Ownership, not edit rights: an admin may change anyone's costing, but the
    // Mine tab has to mean the ones they made or it is the old list again.
    isMine: c.created_by === profile?.id,
  }));

  return <SavedList rows={list} />;
}
