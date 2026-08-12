import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import { StalePlanNotice } from '../stale-banner';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { InquiryManagementClient, type OtbProgram } from './inquiry-management-client';

/**
 * Inquiry management — "what is the most we can offer this customer?".
 *
 * Reads the same Total OTB the Open to buy page shows (spare whole round plus
 * the whole round still held by unconfirmed pipeline inquiries), restricted to
 * the size ranges the customer's product actually sources from, and converts it
 * to finished goods at that product's yields.
 */
export default async function InquiryManagementPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Inquiry management</h1>;
  const supabase = await createClient();

  const [{ data: buckets }, { data: progs }, uw, pw] = await Promise.all([
    supabase.from('buckets').select('id, name, sort_order').eq('is_archived', false).order('sort_order'),
    supabase
      .from('programs')
      .select(
        'id, customer, item_code, item_description, status, ' +
          'primary_bucket_id, secondary_bucket_id, tertiary_bucket_id, ' +
          'primary_yield, secondary_yield, tertiary_yield'
      )
      .eq('plan_id', plan.id)
      .is('deleted_at', null)
      .order('sort_order'),
    fetchAllByPlan(supabase, 'unallocated_wr', 'bucket_id, month_index, unallocated_wr', plan.id),
    fetchAllByPlan(supabase, 'pipeline_wr', 'bucket_id, month_index, pipeline_wr', plan.id),
  ]);

  // The concatenated select defeats Supabase's row-type inference, so name the shape.
  const progRows = (progs ?? []) as unknown as {
    id: string; customer: string; item_code: string; item_description: string; status: string;
    primary_bucket_id: string; secondary_bucket_id: string | null; tertiary_bucket_id: string | null;
    primary_yield: number; secondary_yield: number | null; tertiary_yield: number | null;
  }[];

  // Paths in cascade order (primary → secondary → tertiary), nulls dropped.
  const programs: OtbProgram[] = progRows.map((p) => ({
    id: p.id,
    customer: p.customer,
    item_code: p.item_code,
    item_description: p.item_description,
    status: p.status,
    paths: [
      { path: 'primary' as const, bucket_id: p.primary_bucket_id, yield: Number(p.primary_yield) },
      p.secondary_bucket_id
        ? { path: 'secondary' as const, bucket_id: p.secondary_bucket_id, yield: Number(p.secondary_yield) }
        : null,
      p.tertiary_bucket_id
        ? { path: 'tertiary' as const, bucket_id: p.tertiary_bucket_id, yield: Number(p.tertiary_yield) }
        : null,
    ].filter((x): x is { path: 'primary' | 'secondary' | 'tertiary'; bucket_id: string; yield: number } =>
      x !== null && !!x.bucket_id && x.yield > 0
    ),
  }));

  const unallocated: Record<string, number> = {};
  for (const r of uw as { bucket_id: string; month_index: number; unallocated_wr: number }[]) {
    unallocated[`${r.bucket_id}:${r.month_index}`] = Number(r.unallocated_wr);
  }
  const pipeline: Record<string, number> = {};
  for (const r of pw as { bucket_id: string; month_index: number; pipeline_wr: number }[]) {
    pipeline[`${r.bucket_id}:${r.month_index}`] = Number(r.pipeline_wr);
  }
  const computed = uw.length > 0 || pw.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inquiry management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The most we could offer a customer for an inquiry — total open to buy in their size ranges, as finished goods.
        </p>
      </div>

      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />

      {!computed ? (
        <NotComputed />
      ) : (
        <InquiryManagementClient
          planStartDate={plan.plan_start_date}
          horizon={plan.horizon_months}
          buckets={(buckets ?? []) as { id: string; name: string }[]}
          programs={programs}
          unallocated={unallocated}
          pipeline={pipeline}
        />
      )}
    </div>
  );
}
