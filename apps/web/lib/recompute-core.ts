import { createServiceClient } from '@/lib/supabase/service';
import { runEngine, type EngineInput, type EngineProgram } from '@oceanpick/engine';

/**
 * The actual recompute work: load inputs, run the pure engine, persist the
 * computed tables. Server-only, uses the SERVICE-ROLE client (computed tables
 * are service-role-write-only). Throws on failure.
 *
 * Authorization is the caller's job — see app/api/recompute/route.ts, which
 * verifies the requester can read the plan under RLS before invoking this.
 */
export async function runRecompute(planId: string): Promise<{ ms: number; computedAt: string }> {
  const svc = createServiceClient();
  const started = Date.now();

  const { data: plan, error: planErr } = await svc
    .from('plans')
    .select('id, org_id, horizon_months, plan_start_date, settings_margin_metric, settings_allocation_mode, settings_scope, settings_lookback_months')
    .eq('id', planId)
    .maybeSingle();
  if (planErr || !plan) throw new Error(planErr?.message ?? 'Plan not found.');

  const months: number = plan.horizon_months;

  // PostgREST caps a SELECT at 1000 rows; demand_plan and harvest_plan exceed
  // that, so page through them fully.
  async function fetchAll<T = Record<string, unknown>>(table: string, cols: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await svc.from(table).select(cols).eq('plan_id', planId).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  const [{ data: buckets }, { data: programs }] = await Promise.all([
    svc.from('buckets').select('id, sort_order').eq('org_id', plan.org_id).eq('is_archived', false).order('sort_order'),
    // Order by sort_order == the "row order" the engine uses for locked ranking.
    svc.from('programs').select('*').eq('plan_id', planId).is('deleted_at', null).order('sort_order'),
  ]);
  const demandRows = await fetchAll<{ program_id: string; month_index: number; demand_fp: number }>(
    'demand_plan', 'program_id, month_index, demand_fp'
  );
  const harvestRows = await fetchAll<{ bucket_id: string; month_index: number; capacity_kg_wr: number }>(
    'harvest_plan', 'bucket_id, month_index, capacity_kg_wr'
  );

  // demand overrides keyed by program:month (missing months fall back to baseline)
  const demandByPM = new Map<string, number>();
  for (const r of demandRows ?? []) demandByPM.set(`${r.program_id}:${r.month_index}`, r.demand_fp);

  const engProgams: EngineProgram[] = (programs ?? []).map((p) => ({
    id: p.id,
    status: p.status,
    locked: p.locked,
    primaryBucket: p.primary_bucket_id,
    primaryYield: p.primary_yield,
    secondaryBucket: p.secondary_bucket_id,
    secondaryYield: p.secondary_yield,
    tertiaryBucket: p.tertiary_bucket_id,
    tertiaryYield: p.tertiary_yield,
    price: p.price_per_fp,
    barraCostWr: p.barra_cost_wr,
    packing: p.packing_cost_fp,
    processing: p.processing_cost_fp,
    storage: p.storage_cost_fp,
    freight: p.freight_cost_fp,
    other: p.other_costs_fp,
    demand: Array.from({ length: months }, (_, i) =>
      demandByPM.get(`${p.id}:${i + 1}`) ?? p.max_monthly_demand_fp
    ),
  }));

  const harvest: Record<string, number[]> = {};
  for (const b of buckets ?? []) harvest[b.id] = new Array(months).fill(0);
  for (const r of harvestRows ?? []) {
    const arr = harvest[r.bucket_id];
    if (arr && r.month_index >= 1 && r.month_index <= months) arr[r.month_index - 1] = r.capacity_kg_wr;
  }

  const input: EngineInput = {
    months,
    buckets: (buckets ?? []).map((b) => ({ id: b.id, sortOrder: b.sort_order })),
    programs: engProgams,
    harvest,
    settings: {
      marginMetric: plan.settings_margin_metric,
      allocationMode: plan.settings_allocation_mode,
      scope: plan.settings_scope,
      lookbackMonths: plan.settings_lookback_months,
    },
  };

  const { ranked, own, rolling, aggregate } = runEngine(input);

  const planRankRows = ranked.map((r) => ({
    plan_id: planId, program_id: r.program.id,
    priority_score: r.inScope ? Math.round(r.priorityScore) : 0,
    global_rank: r.globalRank, in_scope: r.inScope,
  }));
  const allocationRows = own.allocations.map((a) => ({
    plan_id: planId, program_id: a.programId, month_index: a.month + 1, path: a.path, allocated_wr: a.allocatedWr,
  }));
  const fByKey = new Map(aggregate.fulfilment.map((f) => [`${f.programId}:${f.month}`, f]));
  const rollingRows = rolling.cells.map((c) => {
    const f = fByKey.get(`${c.programId}:${c.month}`);
    return {
      plan_id: planId, program_id: c.programId, month_index: c.month + 1,
      demand_fp: c.demandFp, own_fp: c.ownFp, own_wr: c.ownWr,
      borrow_m1_prim_wr: c.borrow.m1_prim, borrow_m1_alt_wr: c.borrow.m1_alt, borrow_m1_tert_wr: c.borrow.m1_tert,
      borrow_m2_prim_wr: c.borrow.m2_prim, borrow_m2_alt_wr: c.borrow.m2_alt, borrow_m2_tert_wr: c.borrow.m2_tert,
      borrow_m3_prim_wr: c.borrow.m3_prim, borrow_m3_alt_wr: c.borrow.m3_alt, borrow_m3_tert_wr: c.borrow.m3_tert,
      borrow_m4_prim_wr: c.borrow.m4_prim, borrow_m4_alt_wr: c.borrow.m4_alt, borrow_m4_tert_wr: c.borrow.m4_tert,
      rolling_fp: c.rollingFp, rolling_wr: c.rollingWr,
      // `rolling_margin` stays revenue − cost at the primary-path rate, which is
      // what Excel does and what the ±$1 parity test pins. The engine's per-path
      // decomposition (§5.5) is kept separately rather than discarded.
      rolling_margin: f?.margin ?? 0,
      rolling_margin_per_path: c.rollingMargin,
      revenue: f?.revenue ?? 0, cost: f?.cost ?? 0,
      fulfilment_pct: f?.fulfilmentPct ?? null, unfulfilled_wr: f?.unfulfilledWr ?? 0,
    };
  });
  const unallocatedRows = aggregate.unallocated.map((u) => ({
    plan_id: planId, bucket_id: u.bucketId, month_index: u.month + 1,
    plan_capacity_wr: u.capacity, own_consumption_wr: u.ownConsumption,
    borrowings_into_wr: u.borrowingsInto, unallocated_wr: u.unallocatedWr,
  }));
  const pipelineRows = aggregate.pipeline.map((p) => ({
    plan_id: planId, bucket_id: p.bucketId, month_index: p.month + 1, pipeline_wr: p.pipelineWr,
  }));
  const summaryRows = aggregate.planSummary.map((s) => ({
    plan_id: planId, period: s.period, demand_fp: s.demandFp, allocated_fp: s.allocatedFp,
    unallocated_fp: s.unallocatedFp, allocated_wr: s.allocatedWr, unallocated_wr: s.unallocatedWr,
    revenue: s.revenue, cost: s.cost, margin: s.margin, gp_pct: s.gpPct,
    revenue_opportunity: s.revenueOpportunity, cost_opportunity: s.costOpportunity,
    margin_opportunity: s.marginOpportunity, margin_gap: s.marginGap,
  }));

  // --- persist: delete existing, insert fresh (service role) ---
  for (const t of ['plan_rank', 'allocations', 'rolling_results', 'unallocated_wr', 'pipeline_wr', 'plan_summary']) {
    const { error } = await svc.from(t).delete().eq('plan_id', planId);
    if (error) throw new Error(`clearing ${t}: ${error.message}`);
  }
  const inserts: [string, unknown[]][] = [
    ['plan_rank', planRankRows], ['allocations', allocationRows], ['rolling_results', rollingRows],
    ['unallocated_wr', unallocatedRows], ['pipeline_wr', pipelineRows], ['plan_summary', summaryRows],
  ];
  for (const [t, rows] of inserts) {
    if (!rows.length) continue;
    const { error } = await svc.from(t).insert(rows);
    if (error) throw new Error(`writing ${t}: ${error.message}`);
  }

  const computedAt = new Date().toISOString();
  await svc.from('plans').update({ last_computed_at: computedAt }).eq('id', planId);

  return { ms: Date.now() - started, computedAt };
}
