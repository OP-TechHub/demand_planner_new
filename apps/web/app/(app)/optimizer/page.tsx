import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import { StalePlanNotice } from '../stale-banner';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder } from '@/lib/outputs';
import { OptimizerClient, type OptProgram, type OptBucket } from './optimizer-client';

export default async function OptimizerPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Fulfilment Optimizer</h1>;
  const supabase = await createClient();
  const months = plan.horizon_months;
  const zero = () => new Array<number>(months).fill(0);

  const [order, { data: buckets }, rr, uw] = await Promise.all([
    programOrder(supabase, plan.id),
    supabase.from('buckets').select('id, name, sort_order').eq('is_archived', false).order('sort_order'),
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, demand_fp, own_fp, rolling_fp, rolling_margin', plan.id),
    fetchAllByPlan(supabase, 'unallocated_wr', 'bucket_id, month_index, plan_capacity_wr, own_consumption_wr, borrowings_into_wr, unallocated_wr', plan.id),
  ]);

  if (!rr.length) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Fulfilment Optimizer</h1>
        <NotComputed />
      </div>
    );
  }

  const progById = new Map<string, OptProgram>();
  for (const p of order) progById.set(p.id, { rank: p.rank, label: p.label, sublabel: p.sublabel, demand: zero(), own: zero(), rolling: zero(), margin: zero() });
  for (const r of rr) {
    const p = progById.get(r.program_id);
    if (!p) continue;
    const i = r.month_index - 1;
    p.demand[i] = r.demand_fp; p.own[i] = r.own_fp; p.rolling[i] = r.rolling_fp; p.margin[i] = r.rolling_margin;
  }
  const programs = [...progById.values()].sort((a, b) => a.rank - b.rank);

  const bkt = new Map<string, OptBucket>();
  for (const b of buckets ?? []) bkt.set(b.id, { name: b.name, capacity: zero(), used: zero(), left: zero() });
  for (const u of uw) {
    const b = bkt.get(u.bucket_id);
    if (!b) continue;
    const i = u.month_index - 1;
    b.capacity[i] = u.plan_capacity_wr; b.used[i] = (u.own_consumption_wr ?? 0) + (u.borrowings_into_wr ?? 0); b.left[i] = u.unallocated_wr;
  }

  return (
    <div className="space-y-4">
      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
      <OptimizerClient
        months={months}
        planStartDate={plan.plan_start_date}
        scope={plan.settings_scope}
        programs={programs}
        buckets={[...bkt.values()]}
      />
    </div>
  );
}
