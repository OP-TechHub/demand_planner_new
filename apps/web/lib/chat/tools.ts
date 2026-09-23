// The assistant's tools — SERVER ONLY, and READ ONLY.
//
// Every query runs on the signed-in user's session client, so RLS decides what
// the assistant can see: exactly what that user could open in the app, no more.
// Nothing here writes. A tool that edits a plan belongs behind an explicit
// confirmation step, not in this file.
//
// Results are sized for a model to read, not for a grid to render: long month
// ranges come back as per-item totals with the monthly detail dropped, and the
// tool says so, so the model narrows the question instead of guessing.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Plan } from '@oceanpick/shared';
import { fetchAllPaged } from '@/lib/fetch-all';
import { getPlanFreshness } from '@/lib/plan-freshness';
import { loadCostingContext } from '@/lib/costing';
import { priceSkus, type SkuPriceRow } from '@/lib/costing-api';
import { resolveQuery } from '@/lib/api-costing-query';
import {
  clampWindow,
  getDemand,
  getPrograms,
  getResults,
  monthOf,
  type MonthWindow,
  type PlanRef,
} from '@/lib/queries/plan-data';

type Db = SupabaseClient<any, any, any>;

export interface ToolContext {
  db: Db;
  /** The plan selected in the header — the default whenever a tool gets no plan_id. */
  activePlan: Plan | null;
}

/** Month cells (items × months) above which monthly detail is dropped for totals. */
const MAX_CELLS = 300;
/** Priced costing rows returned before asking the model to filter. */
const MAX_PRICE_ROWS = 40;

// --- Input schemas -----------------------------------------------------------

const planId = { type: 'string', description: 'Plan id from list_plans. Omit to use the plan selected in the header.' };
const from = { type: 'string', description: 'First month, YYYY-MM. Omit to start at the plan start.' };
const to = { type: 'string', description: 'Last month, YYYY-MM. Omit to run to the plan horizon.' };
const itemCode = { type: 'string', description: 'Exact item code, from get_programs.' };

function tool(name: string, description: string, properties: Record<string, unknown>): Anthropic.Beta.BetaTool {
  return {
    name,
    description,
    input_schema: { type: 'object', properties, additionalProperties: false },
    // Inputs are streamed as generated; parseArgs below validates them before
    // anything runs, since the API no longer does once this is on.
    eager_input_streaming: true,
  };
}

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  tool(
    'list_plans',
    'List the plans this user can see (the master, the live plan, official copies and their scenarios) with start date, horizon, and when each was last recalculated. Marks which one is selected in the header.',
    {}
  ),
  tool(
    'get_plan_overview',
    'Headline numbers for one plan: financial-year and 60-month totals (demand, allocated and unallocated FP/WR, revenue, cost, margin, GP%, opportunity), program count, and whether the computed results are stale. Start here for broad questions about a plan.',
    { plan_id: planId }
  ),
  tool(
    'get_programs',
    'The item master for a plan: item code, description, customer, status, baseline monthly demand (kg FP) and price per kg FP. Use to find item codes or which items belong to a customer.',
    { plan_id: planId, item_code: itemCode, customer: { type: 'string', description: 'Case-insensitive customer name filter.' } }
  ),
  tool(
    'get_demand',
    'Planned demand per item per month in kg FP (the month override where one is set, else the baseline). Narrow with item_code and a month range for monthly detail.',
    { plan_id: planId, item_code: itemCode, from, to }
  ),
  tool(
    'get_results',
    'Computed supply results from the last recalculation, per item per month: demand FP, available FP and WR, fulfilment %, unfulfilled WR, revenue and cost. Answers "can we supply it?" and "where are we short?". Items come back worst shortfall first.',
    { plan_id: planId, item_code: itemCode, from, to }
  ),
  tool(
    'get_harvest',
    'Harvest by size bucket per month in kg WR: planned capacity, what the processing plant requested, what was actually harvested, and (from the last recalculation) the whole-round left unallocated.',
    { plan_id: planId, from, to }
  ),
  tool(
    'search_costing',
    'Priced costing SKUs: cost per kg before margin, margin %, selling price, contribution per kg, and for export the freight per kg (C&F = selling price + freight). Domestic prices are LKR, export USD. Every filter is optional.',
    {
      query: { type: 'string', description: 'SKU name or category contains.' },
      customer: { type: 'string', description: 'Customer contains.' },
      market: { type: 'string', enum: ['domestic', 'export'] },
      destination: { type: 'string', description: 'Export destination name, exact.' },
      bucket: { type: 'string', description: 'Size bucket label. Omit for the flat reference model.' },
      status: { type: 'string', enum: ['active', 'inactive', 'all'] },
    }
  ),
];

// --- Argument parsing --------------------------------------------------------

type Args = Record<string, string | undefined>;

/**
 * Validate a tool input against its declared properties: an object whose
 * values are all strings, with no keys the tool doesn't know. Returns an error
 * message for the model instead of throwing, so it can correct and retry.
 */
function parseArgs(name: string, input: unknown): Args | string {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return `Unknown tool "${name}".`;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return 'Input must be an object.';
  const allowed = (def.input_schema as { properties: Record<string, { enum?: string[] }> }).properties;
  const out: Args = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(k in allowed)) return `Unknown parameter "${k}".`;
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'string') return `Parameter "${k}" must be a string.`;
    const choices = allowed[k]?.enum;
    if (choices && !choices.includes(v)) return `Parameter "${k}" must be one of: ${choices.join(', ')}.`;
    out[k] = v.trim();
  }
  return out;
}

// --- Helpers -----------------------------------------------------------------

class ToolError extends Error {}

async function resolvePlan(ctx: ToolContext, id?: string): Promise<Plan> {
  if (!id || id === ctx.activePlan?.id) {
    if (!ctx.activePlan) throw new ToolError('No plan is selected and none was given.');
    return ctx.activePlan;
  }
  // RLS is the access check: a plan this user may not read simply isn't found.
  const { data } = await ctx.db.from('plans').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!data) throw new ToolError(`No plan with id ${id} is visible to this user. Call list_plans for valid ids.`);
  return data as Plan;
}

/** "YYYY-MM" → the plan's 1-based month index. */
function monthIndexOf(plan: PlanRef, ym: string | undefined, label: string): number | null {
  if (!ym) return null;
  const m = /^(\d{4})-(\d{1,2})$/.exec(ym);
  if (!m) throw new ToolError(`${label} must be YYYY-MM, got "${ym}".`);
  const start = new Date(plan.plan_start_date + 'T00:00:00Z');
  return (Number(m[1]) - start.getUTCFullYear()) * 12 + (Number(m[2]) - 1 - start.getUTCMonth()) + 1;
}

function windowOf(plan: PlanRef, args: Args): MonthWindow {
  const lo = monthIndexOf(plan, args.from, 'from');
  const hi = monthIndexOf(plan, args.to, 'to');
  const win = clampWindow(plan, lo, hi);
  if (win.from > win.to) {
    throw new ToolError(
      `No months to show: from must not be after to, and the plan runs ${monthOf(plan, 1).month} to ${monthOf(plan, plan.horizon_months).month}.`
    );
  }
  return win;
}

function planHeader(plan: Plan, win?: MonthWindow) {
  return {
    plan: { id: plan.id, name: plan.name, type: plan.type, last_computed_at: plan.last_computed_at },
    ...(win ? { months: `${monthOf(plan, win.from).month} to ${monthOf(plan, win.to).month}` } : {}),
  };
}

const round = (n: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const tooMuchDetail = (cells: number) =>
  `Monthly detail omitted (${cells} cells). Narrow with item_code or a shorter from/to range for month-by-month figures.`;

// --- Tool implementations ----------------------------------------------------

async function listPlans(ctx: ToolContext) {
  const { data, error } = await ctx.db
    .from('plans')
    .select('id, name, type, is_live, is_sandbox, is_locked, plan_start_date, horizon_months, last_computed_at')
    .is('deleted_at', null)
    .order('type', { ascending: true })
    .order('forked_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p: any) => ({ ...p, selected: p.id === ctx.activePlan?.id }));
}

async function planOverview(ctx: ToolContext, args: Args) {
  const plan = await resolvePlan(ctx, args.plan_id);
  const [{ data: summary }, { count }, freshness] = await Promise.all([
    ctx.db.from('plan_summary').select('*').eq('plan_id', plan.id),
    ctx.db.from('programs').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id).is('deleted_at', null),
    getPlanFreshness(plan.id, plan.last_computed_at, ctx.db),
  ]);
  const order = ['fy1', 'fy2', 'fy3', 'fy4', 'fy5', 'total_60mo'];
  return {
    ...planHeader(plan),
    start: monthOf(plan, 1).month,
    end: monthOf(plan, plan.horizon_months).month,
    program_count: count ?? 0,
    results_computed: freshness.computed,
    results_stale: freshness.stale,
    summary: ((summary ?? []) as any[])
      .sort((a, b) => order.indexOf(a.period) - order.indexOf(b.period))
      .map(({ plan_id: _drop, period, gp_pct, ...amounts }) => ({
        period,
        gp_pct: round(Number(gp_pct), 4),
        ...Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, round(Number(v))])),
      })),
  };
}

async function programs(ctx: ToolContext, args: Args) {
  const plan = await resolvePlan(ctx, args.plan_id);
  let rows = await getPrograms(ctx.db, plan, args.item_code);
  if (args.customer) {
    const needle = args.customer.toLowerCase();
    rows = rows.filter((r) => r.customer.toLowerCase().includes(needle));
  }
  return { ...planHeader(plan), count: rows.length, programs: rows };
}

async function demand(ctx: ToolContext, args: Args) {
  const plan = await resolvePlan(ctx, args.plan_id);
  const win = windowOf(plan, args);
  const items = await getDemand(ctx.db, plan, win, args.item_code);
  const cells = items.length * (win.to - win.from + 1);
  const detail = cells <= MAX_CELLS;
  return {
    ...planHeader(plan, win),
    unit: 'kg FP',
    ...(detail ? {} : { note: tooMuchDetail(cells) }),
    items: items.map((i) => ({
      item_code: i.item_code,
      baseline_monthly_demand_fp: i.baseline_monthly_demand_fp,
      total_demand_fp: round(i.months.reduce((s, m) => s + m.demand_fp, 0)),
      ...(detail ? { months: i.months.map((m) => ({ month: m.month, demand_fp: round(m.demand_fp) })) } : {}),
    })),
  };
}

async function results(ctx: ToolContext, args: Args) {
  const plan = await resolvePlan(ctx, args.plan_id);
  const win = windowOf(plan, args);
  const [items, freshness] = await Promise.all([
    getResults(ctx.db, plan, win, args.item_code),
    getPlanFreshness(plan.id, plan.last_computed_at, ctx.db),
  ]);
  const cells = items.reduce((n, i) => n + i.months.length, 0);
  const detail = cells <= MAX_CELLS;

  const rows = items.map((i) => {
    const sum = (k: 'demand_fp' | 'unfulfilled_wr' | 'revenue' | 'cost') => round(i.months.reduce((s, m) => s + m[k], 0));
    const short = i.months.filter((m) => m.fulfilment_pct !== null && m.fulfilment_pct < 1);
    return {
      item_code: i.item_code,
      total_demand_fp: sum('demand_fp'),
      total_unfulfilled_wr: sum('unfulfilled_wr'),
      total_revenue: sum('revenue'),
      total_cost: sum('cost'),
      months_short: short.length,
      first_short_month: short[0]?.month ?? null,
      ...(detail
        ? {
            months: i.months.map((m) => ({
              month: m.month,
              demand_fp: round(m.demand_fp),
              available_fp: round(m.available_fp),
              available_wr: round(m.available_wr),
              fulfilment_pct: m.fulfilment_pct === null ? null : round(m.fulfilment_pct, 4),
              unfulfilled_wr: round(m.unfulfilled_wr),
              revenue: round(m.revenue),
              cost: round(m.cost),
            })),
          }
        : {}),
    };
  });
  rows.sort((a, b) => b.total_unfulfilled_wr - a.total_unfulfilled_wr);

  return {
    ...planHeader(plan, win),
    results_computed: freshness.computed,
    results_stale: freshness.stale,
    ...(detail ? {} : { note: tooMuchDetail(cells) }),
    items: rows,
  };
}

async function harvest(ctx: ToolContext, args: Args) {
  const plan = await resolvePlan(ctx, args.plan_id);
  const win = windowOf(plan, args);
  const inWindow = (table: string, cols: string) =>
    fetchAllPaged(
      (f, t) => ctx.db.from(table).select(cols).eq('plan_id', plan.id)
        .gte('month_index', win.from).lte('month_index', win.to).range(f, t),
      table
    );

  const [{ data: buckets }, capacity, requested, actual, unallocated] = await Promise.all([
    ctx.db.from('buckets').select('id, name, sort_order').order('sort_order'),
    inWindow('harvest_plan', 'bucket_id, month_index, capacity_kg_wr'),
    inWindow('harvest_request', 'bucket_id, month_index, quantity_kg_wr'),
    inWindow('harvest_actual', 'bucket_id, month_index, quantity_kg_wr'),
    inWindow('unallocated_wr', 'bucket_id, month_index, unallocated_wr'),
  ]);

  type Cell = { capacity_wr: number; requested_wr: number; actual_wr: number; unallocated_wr: number };
  const blank = (): Cell => ({ capacity_wr: 0, requested_wr: 0, actual_wr: 0, unallocated_wr: 0 });
  const grid = new Map<string, Map<number, Cell>>(); // bucket -> month -> cell
  let unsizedRequest = 0;
  const add = (rows: any[], key: keyof Cell, col: string) => {
    for (const r of rows) {
      // Requests from before the size breakdown carry no bucket.
      if (!r.bucket_id) { unsizedRequest += Number(r[col]); continue; }
      const months = grid.get(r.bucket_id) ?? new Map<number, Cell>();
      const cell = months.get(r.month_index) ?? blank();
      cell[key] += Number(r[col]);
      months.set(r.month_index, cell);
      grid.set(r.bucket_id, months);
    }
  };
  add(capacity, 'capacity_wr', 'capacity_kg_wr');
  add(requested, 'requested_wr', 'quantity_kg_wr');
  add(actual, 'actual_wr', 'quantity_kg_wr');
  add(unallocated, 'unallocated_wr', 'unallocated_wr');

  const cells = [...grid.values()].reduce((n, m) => n + m.size, 0);
  const detail = cells <= MAX_CELLS;
  const out = ((buckets ?? []) as { id: string; name: string }[])
    .filter((b) => grid.has(b.id))
    .map((b) => {
      const months = [...grid.get(b.id)!.entries()].sort((x, y) => x[0] - y[0]);
      const total = months.reduce((s, [, c]) => {
        (Object.keys(s) as (keyof Cell)[]).forEach((k) => (s[k] += c[k]));
        return s;
      }, blank());
      (Object.keys(total) as (keyof Cell)[]).forEach((k) => (total[k] = round(total[k])));
      return {
        bucket: b.name,
        totals: total,
        ...(detail
          ? {
              months: months.map(([m, c]) => ({
                month: monthOf(plan, m).month,
                capacity_wr: round(c.capacity_wr),
                requested_wr: round(c.requested_wr),
                actual_wr: round(c.actual_wr),
                unallocated_wr: round(c.unallocated_wr),
              })),
            }
          : {}),
      };
    });

  return {
    ...planHeader(plan, win),
    unit: 'kg WR',
    note: [
      'unallocated_wr comes from the last recalculation; actual_wr is recorded separately and never feeds the engine.',
      unsizedRequest ? `A further ${round(unsizedRequest)} kg WR was requested without a size bucket.` : '',
      detail ? '' : tooMuchDetail(cells),
    ].filter(Boolean).join(' '),
    buckets: out,
  };
}

async function costing(_ctx: ToolContext, args: Args) {
  // Loaded under the user's session: a role that cannot read costing gets no
  // rows back from RLS and lands in the null branch.
  const ctx = await loadCostingContext();
  if (!ctx) throw new ToolError('Costing is not available to this user, or has not been set up.');

  const sp = new URLSearchParams();
  for (const k of ['market', 'destination', 'bucket', 'customer', 'status'] as const) {
    if (args[k]) sp.set(k, args[k]!);
  }
  if (args.query) sp.set('q', args.query);
  const q = resolveQuery(ctx, sp);
  if ('error' in q) {
    const body = (await q.error.json()) as { error: { message: string } };
    throw new ToolError(body.error.message);
  }

  const rows: SkuPriceRow[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const market of q.markets) {
    const priced = priceSkus(ctx, q.skus, market, q.destinations, q.bucket);
    rows.push(...priced.rows);
    skipped.push(...priced.skipped.map(({ name, reason }) => ({ name, reason })));
  }

  // Compact rows: the ids and repeated SKU attributes cost tokens and add nothing.
  const compact = rows.slice(0, MAX_PRICE_ROWS).map((r) => ({
    sku: r.name,
    customer: r.customer || null,
    pack_size: r.pack_size,
    market: r.market,
    state: r.state,
    destination: r.destination?.name ?? null,
    currency: r.currency,
    cost: r.cost,
    selling_price: r.selling_price,
    margin_pct: r.margin_pct,
    contribution_per_kg: r.contribution_per_kg,
    freight_per_kg: r.freight_per_kg,
    pricing_basis: r.pricing_basis,
  }));

  return {
    assumptions_version: ctx.version.version_no,
    fx_rate: ctx.version.fx_rate,
    size_bucket: q.bucket?.label ?? 'flat reference model',
    available_destinations: ctx.destinations.map((d) => d.name),
    available_buckets: ctx.buckets.map((b) => b.label),
    count: rows.length,
    ...(rows.length > MAX_PRICE_ROWS
      ? { note: `Showing the first ${MAX_PRICE_ROWS} of ${rows.length} rows. Filter by query, customer, market or destination.` }
      : {}),
    rows: compact,
    ...(skipped.length ? { skipped } : {}),
  };
}

const HANDLERS: Record<string, (ctx: ToolContext, args: Args) => Promise<unknown>> = {
  list_plans: listPlans,
  get_plan_overview: planOverview,
  get_programs: programs,
  get_demand: demand,
  get_results: results,
  get_harvest: harvest,
  search_costing: costing,
};

/**
 * Run one tool call. Never throws: a bad input or a failed query comes back as
 * an error result the model can read and recover from.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  input: unknown
): Promise<{ content: string; isError: boolean }> {
  const args = parseArgs(name, input);
  if (typeof args === 'string') return { content: args, isError: true };
  try {
    const out = await HANDLERS[name]!(ctx, args);
    return { content: JSON.stringify(out), isError: false };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : 'The query failed. Try again, or narrow the request.';
    if (!(err instanceof ToolError)) console.error(`[chat] tool ${name} failed`, err);
    return { content: message, isError: true };
  }
}

/** A short present-tense label for the UI while a tool runs. */
export const TOOL_LABELS: Record<string, string> = {
  list_plans: 'Listing plans',
  get_plan_overview: 'Reading the plan summary',
  get_programs: 'Reading programs',
  get_demand: 'Reading demand',
  get_results: 'Reading supply results',
  get_harvest: 'Reading the harvest plan',
  search_costing: 'Pricing SKUs',
};
