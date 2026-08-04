import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { InquiryClient, type InquiryProgram, type InquiryBucket } from './inquiry-client';

export default async function InquiryPage() {
  const plan = await getActivePlan();
  if (!plan) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
        <p className="font-semibold text-warning">No master plan found</p>
        <p className="mt-1 text-warning">Run the seed first, then come back.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: progData }, { data: bucketData }] = await Promise.all([
    supabase
      .from('programs')
      .select('id, item_code, item_description, customer, status')
      .eq('plan_id', plan.id)
      .is('deleted_at', null)
      .order('customer')
      .order('sort_order'),
    supabase
      .from('buckets')
      .select('id, name')
      .eq('is_archived', false)
      .order('sort_order'),
  ]);

  const programs = (progData ?? []) as InquiryProgram[];
  const buckets = (bucketData ?? []) as InquiryBucket[];

  return (
    <InquiryClient
      planId={plan.id}
      planStartDate={plan.plan_start_date}
      horizon={plan.horizon_months}
      programs={programs}
      buckets={buckets}
    />
  );
}
