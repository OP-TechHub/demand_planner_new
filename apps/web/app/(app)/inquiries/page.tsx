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
      .select('id, created_at, created_by, kind, customer, item_code, item_description, months, total_fp, target_program_id')
      .eq('plan_id', plan.id)
      .order('created_at', { ascending: false }),
    supabase.from('users').select('id, full_name, email'),
  ]);

  // Which target programs are still pipeline (so still promotable).
  const targetIds = [...new Set((rows ?? []).map((r) => r.target_program_id).filter(Boolean))] as string[];
  const pipelineTargets = new Set<string>();
  if (targetIds.length) {
    const { data: progs } = await supabase.from('programs').select('id, status').in('id', targetIds);
    for (const p of progs ?? []) if (p.status === 'pipeline') pipelineTargets.add(p.id);
  }

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
    target_program_id: r.target_program_id,
    promotable: r.target_program_id ? pipelineTargets.has(r.target_program_id) : false,
  }));

  return <InquiriesClient planName={plan.name} planStartDate={plan.plan_start_date} inquiries={inquiries} />;
}
