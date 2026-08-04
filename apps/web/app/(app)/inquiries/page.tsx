import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { InquiriesClient, type InquiryRow } from './inquiries-client';

export default async function InquiriesPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Inquiries</h1>;

  const supabase = await createClient();
  const [{ data: rows }, { data: users }] = await Promise.all([
    supabase
      .from('inquiries')
      .select('id, created_at, created_by, kind, customer, item_code, item_description, months, total_fp')
      .eq('plan_id', plan.id)
      .order('created_at', { ascending: false }),
    supabase.from('users').select('id, full_name, email'),
  ]);

  const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name || u.email]));
  const inquiries: InquiryRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    created_by: r.created_by ? (nameById.get(r.created_by) ?? '—') : '—',
    kind: r.kind,
    customer: r.customer,
    item_code: r.item_code,
    item_description: r.item_description,
    months: r.months,
    total_fp: Number(r.total_fp),
  }));

  return <InquiriesClient planName={plan.name} inquiries={inquiries} />;
}
