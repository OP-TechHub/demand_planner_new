import { monthIndexOfDate, monthLabel } from '@oceanpick/shared';
import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadOrgPlan, planMeta } from '@/lib/api-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InLine = { item_code?: unknown; delivery_date?: unknown; month_index?: unknown; qty_fp?: unknown; ref?: unknown };

/**
 * POST /api/v1/match — the endpoint the PO matcher leans on. Send PO lines;
 * get back, per line, the plan's verdict: whether the item exists, how much is
 * planned that month, how much the plan can supply, and any shortfall.
 *
 * Body: { plan_id?: string, lines: [{ item_code, qty_fp,
 *          delivery_date?: "YYYY-MM-DD" | month_index?: number, ref? }] }
 * Quantities are kg of finished product (FP). Convert cartons to kg before
 * sending. With no plan_id, matches against the org's master plan.
 */
export async function POST(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ('error' in auth) return auth.error;

  const body = (await req.json().catch(() => null)) as { plan_id?: string; lines?: InLine[] } | null;
  if (!body || !Array.isArray(body.lines)) {
    return jsonError(400, 'invalid_body', 'Send a JSON body with a "lines" array.');
  }
  if (body.lines.length === 0) return jsonError(400, 'no_lines', 'The "lines" array is empty.');
  if (body.lines.length > 500) return jsonError(400, 'too_many_lines', 'Send at most 500 lines per request.');

  const svc = createServiceClient();
  const plan = await loadOrgPlan(svc, auth.caller.orgId, body.plan_id);
  if (!plan) return jsonError(404, 'plan_not_found', 'No such plan in this organisation.');

  // Normalise each input line and resolve its month up front.
  const parsed = body.lines.map((l) => {
    const item_code = typeof l.item_code === 'string' ? l.item_code.trim() : '';
    const qty_fp = Number(l.qty_fp);
    const ref = l.ref == null ? undefined : String(l.ref);
    let month: number | null = null;
    if (typeof l.month_index === 'number' && Number.isInteger(l.month_index)) {
      month = l.month_index >= 1 && l.month_index <= plan.horizon_months ? l.month_index : null;
    } else if (typeof l.delivery_date === 'string') {
      month = monthIndexOfDate(plan.plan_start_date, l.delivery_date, plan.horizon_months);
    }
    return { item_code, qty_fp, ref, month, rawDate: typeof l.delivery_date === 'string' ? l.delivery_date : null };
  });

  // Batch-load everything the lines reference: programs, then their overrides
  // and results for the months in play.
  const codes = [...new Set(parsed.map((p) => p.item_code).filter(Boolean))];
  const { data: progRows } = codes.length
    ? await svc
        .from('programs')
        .select('id, item_code, item_description, customer, max_monthly_demand_fp, price_per_fp')
        .eq('plan_id', plan.id)
        .is('deleted_at', null)
        .in('item_code', codes)
    : { data: [] };
  const progByCode = new Map(
    (progRows ?? []).map((p: ProgRow) => [p.item_code, p])
  );
  const ids = (progRows ?? []).map((p: ProgRow) => p.id);

  const overrides = new Map<string, number>(); // `${progId}:${month}` -> demand_fp
  const results = new Map<string, RawResult>(); // `${progId}:${month}` -> result
  if (ids.length) {
    const [{ data: ov }, { data: rs }] = await Promise.all([
      svc.from('demand_plan').select('program_id, month_index, demand_fp').eq('plan_id', plan.id).in('program_id', ids),
      svc.from('rolling_results').select('program_id, month_index, rolling_fp, fulfilment_pct, unfulfilled_wr').eq('plan_id', plan.id).in('program_id', ids),
    ]);
    for (const r of (ov ?? []) as { program_id: string; month_index: number; demand_fp: number }[]) {
      overrides.set(`${r.program_id}:${r.month_index}`, Number(r.demand_fp));
    }
    for (const r of (rs ?? []) as RawResult[]) {
      results.set(`${r.program_id}:${r.month_index}`, r);
    }
  }

  const lines = parsed.map((p) => {
    const prog = progByCode.get(p.item_code);
    const base = {
      item_code: p.item_code,
      ref: p.ref,
      order_qty_fp: Number.isFinite(p.qty_fp) ? p.qty_fp : null,
      month_index: p.month,
      month: p.month ? monthLabel(plan.plan_start_date, p.month) : null,
    };

    if (!prog) return { ...base, matched: false, verdict: 'no_such_item' as const };
    const meta = { description: prog.item_description, customer: prog.customer, price_per_fp: Number(prog.price_per_fp) };
    if (p.month == null) {
      return { ...base, matched: true, program: meta, verdict: 'out_of_window' as const };
    }

    const key = `${prog.id}:${p.month}`;
    const planned_demand_fp = overrides.get(key) ?? Number(prog.max_monthly_demand_fp);
    const res = results.get(key);
    const available_fp = res ? Number(res.rolling_fp) : null;
    const qty = Number.isFinite(p.qty_fp) ? p.qty_fp : 0;

    let verdict: 'can_fulfil' | 'short' | 'not_computed';
    let shortfall_fp: number | null = null;
    if (available_fp == null) {
      verdict = 'not_computed';
    } else if (qty <= available_fp) {
      verdict = 'can_fulfil';
    } else {
      verdict = 'short';
      shortfall_fp = qty - available_fp;
    }

    return {
      ...base,
      matched: true,
      program: meta,
      planned_demand_fp,
      exceeds_planned: Number.isFinite(p.qty_fp) ? p.qty_fp > planned_demand_fp : null,
      available_fp,
      fulfilment_pct: res?.fulfilment_pct == null ? null : Number(res.fulfilment_pct),
      shortfall_fp,
      verdict,
    };
  });

  return jsonOk(lines, planMeta(plan));
}

type ProgRow = {
  id: string; item_code: string; item_description: string; customer: string;
  max_monthly_demand_fp: number; price_per_fp: number;
};
type RawResult = { program_id: string; month_index: number; rolling_fp: number; fulfilment_pct: number | null; unfulfilled_wr: number };
