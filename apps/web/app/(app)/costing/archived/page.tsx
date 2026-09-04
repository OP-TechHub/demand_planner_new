import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import type { CostAssumptionVersion, CostCosting } from '@oceanpick/shared';
import { ArchivedList, type ArchivedCosting, type ArchivedSku } from './archived-client';

/**
 * The costing module's bin: everything soft-deleted, and a way back.
 *
 * Admin-only, and read under the service role — a deleted costing is invisible
 * to the ordinary client because its read policy filters `deleted_at is null`,
 * so this page could not list what it exists to list. Every query is scoped by
 * `org_id` by hand for the same reason the actions are (see actions.ts).
 */
export default async function ArchivedCostingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: meRow } = await supabase
    .from('users')
    .select('role, org_id')
    .eq('id', user!.id)
    .maybeSingle();
  const me = meRow as { role: string; org_id: string } | null;

  if (me?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Deleted costings</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Admins only.
        </div>
      </div>
    );
  }

  const svc = createServiceClient();
  const orgId = me.org_id;

  const [{ data: costings }, { data: skus }, { data: versions }, { data: users }] = await Promise.all([
    svc
      .from('cost_costings')
      .select('*')
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
    svc
      .from('cost_skus')
      .select('id, name, category, status, deleted_at, created_at')
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
    svc.from('cost_assumption_versions').select('*').eq('org_id', orgId),
    svc.from('users').select('id, full_name').eq('org_id', orgId),
  ]);

  const deleted = (costings ?? []) as CostCosting[];

  // Line counts for the deleted costings only — a costing with no lines left is
  // worth restoring differently from one carrying a full quote, and the count is
  // the only thing on this page that says which is which.
  const ids = deleted.map((c) => c.id);
  const { data: lines } = ids.length
    ? await svc.from('cost_costing_lines').select('costing_id').in('costing_id', ids)
    : { data: [] as { costing_id: string }[] };

  const counts = new Map<string, number>();
  for (const l of (lines ?? []) as { costing_id: string }[]) {
    counts.set(l.costing_id, (counts.get(l.costing_id) ?? 0) + 1);
  }

  const versionById = new Map(
    ((versions ?? []) as CostAssumptionVersion[]).map((v) => [v.id, v])
  );
  const names = new Map(
    ((users ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name])
  );

  const costingRows: ArchivedCosting[] = deleted.map((c) => ({
    id: c.id,
    name: c.name,
    market: c.market,
    lineCount: counts.get(c.id) ?? 0,
    // `deleteCosting` stamps updated_by alongside deleted_at, so on a deleted
    // row the two agree and this really is who deleted it.
    authorName: names.get(c.created_by) ?? 'Unknown',
    deletedAt: c.deleted_at!,
    versionLabel: (() => {
      const v = versionById.get(c.version_id);
      return v ? `v${v.version_no}${v.label ? ` · ${v.label}` : ''}` : 'unknown version';
    })(),
    // Deliberately no override detail here: this page is a recovery list, and
    // showing overrides would leak base-cost figures to an admin view that has
    // no masking of its own. The costing shows them once restored.
    hasOverrides: Object.keys(c.assumption_overrides ?? {}).length > 0,
  }));

  const skuRows: ArchivedSku[] = (
    (skus ?? []) as { id: string; name: string; category: string; status: string; deleted_at: string }[]
  ).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    status: s.status,
    deletedAt: s.deleted_at,
  }));

  return <ArchivedList costings={costingRows} skus={skuRows} />;
}
