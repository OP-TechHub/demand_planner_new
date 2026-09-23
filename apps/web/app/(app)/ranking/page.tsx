import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { StalePlanNotice } from '../stale-banner';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { RankingClient, type RankRow, type MonthCell } from './ranking-client';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function RankingPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Program Ranking</h1>;
  const supabase = await createClient();
  const months: number = plan.horizon_months;

  const [{ data: progs }, { data: ranks }, { data: buckets }, dp, rr] = await Promise.all([
    // Every program in the plan, whatever its status — this page lists them all.
    supabase
      .from('programs')
      .select('id, status, locked, customer, item_code, item_description, primary_bucket_id, primary_yield, max_monthly_demand_fp, price_per_fp, barra_cost_wr, packing_cost_fp, processing_cost_fp, storage_cost_fp, freight_cost_fp, other_costs_fp')
      .eq('plan_id', plan.id)
      .is('deleted_at', null),
    supabase.from('plan_rank').select('program_id, global_rank, in_scope').eq('plan_id', plan.id),
    // Archived ones included, for naming only: a program can still point at a retired bucket.
    supabase.from('buckets').select('id, name'),
    fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', plan.id),
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, rolling_fp, revenue, rolling_margin', plan.id),
  ]);

  const bucketName = new Map<string, string>((buckets ?? []).map((b: any) => [b.id, b.name]));
  const engineRank = new Map<string, number>(
    (ranks ?? []).filter((r: any) => r.in_scope).map((r: any) => [r.program_id, r.global_rank])
  );

  // Month-by-month figures, so the client can total them over whatever date
  // range the reader picks. Demand is read the way the engine reads it: a month
  // override where one exists, the program's max monthly demand otherwise —
  // worked out here rather than taken from the results so programs the engine
  // skipped still get one.
  const overrides = new Map<string, Map<number, number>>();
  for (const r of dp as any[]) {
    if (r.month_index < 1 || r.month_index > months) continue;
    const o = overrides.get(r.program_id) ?? new Map<number, number>();
    o.set(r.month_index, Number(r.demand_fp) || 0);
    overrides.set(r.program_id, o);
  }

  type Res = { fulfilled: number; revenue: number; margin: number };
  const results = new Map<string, Map<number, Res>>();
  for (const r of rr as any[]) {
    if (r.month_index < 1 || r.month_index > months) continue;
    const byMonth = results.get(r.program_id) ?? new Map<number, Res>();
    byMonth.set(r.month_index, {
      fulfilled: Number(r.rolling_fp) || 0,
      revenue: Number(r.revenue) || 0,
      margin: Number(r.rolling_margin) || 0,
    });
    results.set(r.program_id, byMonth);
  }

  const rows: RankRow[] = (progs ?? []).map((p: any) => {
    const y = Number(p.primary_yield);
    const price = Number(p.price_per_fp);
    // Primary-path cost per kg FP (spec §2.1) — the same figure the engine ranks on.
    const costFp = (y > 0 ? Number(p.barra_cost_wr) / y : 0)
      + Number(p.packing_cost_fp) + Number(p.processing_cost_fp) + Number(p.storage_cost_fp)
      + Number(p.freight_cost_fp) + Number(p.other_costs_fp);
    const o = overrides.get(p.id);
    const res = results.get(p.id);
    const maxDemand = Number(p.max_monthly_demand_fp) || 0;
    // One cell per horizon month. Result fields stay null for months the engine
    // produced nothing for, so a program it never allocated still reads "—".
    const monthly: MonthCell[] = Array.from({ length: months }, (_, i) => {
      const m = i + 1;
      const r = res?.get(m);
      return {
        demand: o?.get(m) ?? maxDemand,
        fulfilled: r?.fulfilled ?? null,
        revenue: r?.revenue ?? null,
        margin: r?.margin ?? null,
      };
    });
    return {
      id: p.id,
      engineRank: engineRank.get(p.id) ?? null,
      customer: p.customer || '—',
      item: p.item_description || p.item_code,
      status: p.status,
      locked: !!p.locked,
      bucket: bucketName.get(p.primary_bucket_id) ?? '—',
      price,
      costFp,
      marginFp: price - costFp,
      marginWr: (price - costFp) * y,
      monthly,
    };
  });

  return (
    <div className="space-y-4">
      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
      <RankingClient rows={rows} metric={plan.settings_margin_metric} planStartDate={plan.plan_start_date} horizon={months} />
    </div>
  );
}
