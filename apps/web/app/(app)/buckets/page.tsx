import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile } from '@/lib/plan';
import { canEditSection, type Bucket, type Program, type HarvestCell, type UserRole } from '@oceanpick/shared';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { BucketsClient, type BucketRow } from './buckets-client';

export default async function BucketsPage() {
  const plan = await getActivePlan();
  if (!plan) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
        <p className="font-semibold text-warning">No master plan found</p>
        <p className="mt-1 text-warning">
          Run <code className="rounded bg-warning/15 px-1">supabase/seed.sql</code> first.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: buckets }, { data: programs }, harvest, profile] = await Promise.all([
    supabase.from('buckets').select('*').order('sort_order'),
    supabase.from('programs').select('primary_bucket_id, secondary_bucket_id, tertiary_bucket_id').eq('plan_id', plan.id).is('deleted_at', null),
    // harvest_plan can exceed the 1000-row cap (buckets × 60), so page it.
    fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, month_index, capacity_kg_wr', plan.id),
    getProfile(),
  ]);

  // Programs using a bucket in any of its three paths.
  const usage = new Map<string, number>();
  for (const p of (programs ?? []) as Pick<Program, 'primary_bucket_id' | 'secondary_bucket_id' | 'tertiary_bucket_id'>[]) {
    for (const id of [p.primary_bucket_id, p.secondary_bucket_id, p.tertiary_bucket_id]) {
      if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
    }
  }
  // Harvest capacity per bucket, kept PER MONTH so the client's range filter can
  // re-total it without another round trip. Each cell is rounded before summing,
  // exactly as the Harvest Plan grid does it, so a bucket's total here always
  // matches that page's row total rather than drifting by the stored decimals.
  const horizon = plan.horizon_months;
  const monthly = new Map<string, number[]>();
  for (const h of (harvest ?? []) as Pick<HarvestCell, 'bucket_id' | 'month_index' | 'capacity_kg_wr'>[]) {
    const i = h.month_index - 1;
    if (i < 0 || i >= horizon) continue;
    let arr = monthly.get(h.bucket_id);
    if (!arr) { arr = new Array<number>(horizon).fill(0); monthly.set(h.bucket_id, arr); }
    arr[i] += Math.round(h.capacity_kg_wr);
  }

  const rows: BucketRow[] = ((buckets ?? []) as Bucket[]).map((b) => ({
    bucket: b,
    usage: usage.get(b.id) ?? 0,
    monthly: monthly.get(b.id) ?? new Array<number>(horizon).fill(0),
  }));

  return (
    <BucketsClient
      orgId={plan.org_id}
      rows={rows}
      planStartDate={plan.plan_start_date}
      horizon={horizon}
      canEdit={canEditSection((profile?.role ?? 'viewer') as UserRole, profile?.edit_sections, 'buckets')}
    />
  );
}
