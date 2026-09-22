// Plan read queries shared by the /api/v1 routes and the in-app assistant.
//
// Each function takes the Supabase client to run under rather than making one.
// The API passes the service client (and has already scoped the plan to the
// caller's org); the assistant passes the signed-in user's session client, so
// RLS decides what it can see. One copy of the query means the CRM and the
// assistant can never disagree about what a plan's demand or results are.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from '@supabase/supabase-js';
import { monthLabel } from '@oceanpick/shared';
import { fetchAllPaged } from '@/lib/fetch-all';

type Db = SupabaseClient<any, any, any>;

/** The plan fields these queries need: which rows, and how to label months. */
export type PlanRef = { id: string; plan_start_date: string; horizon_months: number };

/** Inclusive 1-based month window, already clamped to the plan's horizon. */
export type MonthWindow = { from: number; to: number };

/** A month index paired with its calendar label, e.g. { month_index: 10, month: "Jan 27" }. */
export function monthOf(plan: PlanRef, monthIndex: number) {
  return { month_index: monthIndex, month: monthLabel(plan.plan_start_date, monthIndex) };
}

/** Clamp a requested window to the plan's horizon. Missing ends mean "all". */
export function clampWindow(plan: PlanRef, from?: number | null, to?: number | null): MonthWindow {
  const lo = Math.max(1, Math.trunc(from || 1));
  const hi = Math.min(plan.horizon_months, Math.trunc(to || plan.horizon_months));
  return { from: lo, to: hi };
}

export type ProgramRow = {
  item_code: string;
  item_description: string;
  customer: string;
  status: string;
  baseline_monthly_demand_fp: number;
  price_per_fp: number;
};

/** The item master for a plan, in display order. */
export async function getPrograms(db: Db, plan: PlanRef, itemCode?: string | null): Promise<ProgramRow[]> {
  let q = db
    .from('programs')
    .select('item_code, item_description, customer, status, max_monthly_demand_fp, price_per_fp')
    .eq('plan_id', plan.id)
    .is('deleted_at', null)
    .order('sort_order');
  if (itemCode) q = q.eq('item_code', itemCode);
  const { data, error } = await q;
  if (error) throw new Error(`programs: ${error.message}`);

  return (data ?? []).map((p: any) => ({
    item_code: p.item_code,
    item_description: p.item_description,
    customer: p.customer,
    status: p.status,
    baseline_monthly_demand_fp: Number(p.max_monthly_demand_fp),
    price_per_fp: Number(p.price_per_fp),
  }));
}

export type DemandItem = {
  item_code: string;
  baseline_monthly_demand_fp: number;
  months: { month_index: number; month: string; demand_fp: number }[];
};

/**
 * Planned (effective) demand per item per month, kg FP. Effective = the month's
 * override if one is set, else the program's baseline — resolved here so no
 * caller ever has to.
 */
export async function getDemand(
  db: Db,
  plan: PlanRef,
  win: MonthWindow,
  itemCode?: string | null
): Promise<DemandItem[]> {
  let progQ = db
    .from('programs')
    .select('id, item_code, max_monthly_demand_fp')
    .eq('plan_id', plan.id)
    .is('deleted_at', null)
    .order('sort_order');
  if (itemCode) progQ = progQ.eq('item_code', itemCode);
  const { data: progs, error } = await progQ;
  if (error) throw new Error(`programs: ${error.message}`);
  const programs = (progs ?? []) as { id: string; item_code: string; max_monthly_demand_fp: number }[];

  const ids = programs.map((p) => p.id);
  const overrides = new Map<string, number>();
  if (ids.length) {
    // Paged: programs × months can exceed PostgREST's 1000-row cap, and a truncated
    // page here is invisible — the missing overrides would silently fall back to
    // the baseline below and the answer would look plausible but be wrong.
    const rows = await fetchAllPaged(
      (f, t) => db
        .from('demand_plan')
        .select('program_id, month_index, demand_fp')
        .eq('plan_id', plan.id)
        .in('program_id', ids)
        .gte('month_index', win.from)
        .lte('month_index', win.to)
        .range(f, t),
      'demand_plan'
    );
    for (const r of rows as { program_id: string; month_index: number; demand_fp: number }[]) {
      overrides.set(`${r.program_id}:${r.month_index}`, Number(r.demand_fp));
    }
  }

  return programs.map((p) => {
    const baseline = Number(p.max_monthly_demand_fp);
    const months = [];
    for (let m = win.from; m <= win.to; m++) {
      months.push({ ...monthOf(plan, m), demand_fp: overrides.get(`${p.id}:${m}`) ?? baseline });
    }
    return { item_code: p.item_code, baseline_monthly_demand_fp: baseline, months };
  });
}

export type ResultMonth = {
  month_index: number;
  month: string;
  demand_fp: number;
  available_fp: number;
  available_wr: number;
  fulfilment_pct: number | null;
  unfulfilled_wr: number;
  revenue: number;
  cost: number;
};

export type ResultItem = { item_code: string; months: ResultMonth[] };

/**
 * The computed engine output per item per month, from the last recompute:
 * demand, what the plan can supply (rolling FP/WR), fulfilment % and shortfall.
 */
export async function getResults(
  db: Db,
  plan: PlanRef,
  win: MonthWindow,
  itemCode?: string | null
): Promise<ResultItem[]> {
  let progQ = db
    .from('programs')
    .select('id, item_code')
    .eq('plan_id', plan.id)
    .is('deleted_at', null)
    .order('sort_order');
  if (itemCode) progQ = progQ.eq('item_code', itemCode);
  const { data: progs, error } = await progQ;
  if (error) throw new Error(`programs: ${error.message}`);
  const programs = (progs ?? []) as { id: string; item_code: string }[];
  const codeById = new Map(programs.map((p) => [p.id, p.item_code]));
  const ids = programs.map((p) => p.id);

  const rowsByCode = new Map<string, ResultMonth[]>();
  if (ids.length) {
    // Paged: programs × months exceeds PostgREST's 1000-row cap on any sizeable
    // plan, and a truncated page returns no error — months would just go missing.
    const results = await fetchAllPaged(
      (f, t) => db
        .from('rolling_results')
        .select('program_id, month_index, demand_fp, rolling_fp, rolling_wr, fulfilment_pct, unfulfilled_wr, revenue, cost')
        .eq('plan_id', plan.id)
        .in('program_id', ids)
        .gte('month_index', win.from)
        .lte('month_index', win.to)
        .order('month_index')
        .range(f, t),
      'rolling_results'
    );
    for (const r of results as any[]) {
      const code = codeById.get(r.program_id);
      if (!code) continue;
      const list = rowsByCode.get(code) ?? [];
      list.push({
        ...monthOf(plan, r.month_index),
        demand_fp: Number(r.demand_fp),
        available_fp: Number(r.rolling_fp),
        available_wr: Number(r.rolling_wr),
        fulfilment_pct: r.fulfilment_pct == null ? null : Number(r.fulfilment_pct),
        unfulfilled_wr: Number(r.unfulfilled_wr),
        revenue: Number(r.revenue),
        cost: Number(r.cost),
      });
      rowsByCode.set(code, list);
    }
  }

  return programs.map((p) => ({ item_code: p.item_code, months: rowsByCode.get(p.item_code) ?? [] }));
}
