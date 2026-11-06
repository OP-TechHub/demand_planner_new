import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { type GridRow } from '@/lib/grid-csv';
import { StalePlanNotice } from '../stale-banner';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { OfflineCopy } from '@/components/pwa/offline-copy';
import { OrderBookView } from './order-book-view';
import { BLUE, PINK, YELLOW } from './colors';
import { num0 } from '@/lib/format';

/**
 * Order Book — the demand plan read as "what is actually sold".
 *
 * Same programs × months grid as the Demand Plan, but each cell is coloured by
 * how firm it is, and pipeline rows deliberately carry a different figure:
 *
 *   BLUE    a PO has been received for that program-month. The figure is the
 *           demand plan's, which the PO tab has already set to the PO sum.
 *   PINK    an active program with no PO for that month — forecast, unsold.
 *   YELLOW  a pipeline (inquiry) program with something to show. Carries what the
 *           plan CAN FULFIL (rolling_fp), not the demand asked for: an inquiry's
 *           full ask isn't an order book entry, only the part supply can cover.
 *           A pipeline month the plan can't fulfil at all stays uncoloured.
 *
 * Anything else (inactive) is left uncoloured rather than dropped, so a
 * deactivated program with orders against it stays visible.
 */

export default async function OrderBookPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Order Book</h1>;

  const supabase = await createClient();
  const horizon = plan.horizon_months;
  const months = Array.from({ length: horizon }, (_, i) => i + 1);

  const [{ data: progs }, demand, poLines, rr] = await Promise.all([
    supabase
      .from('programs')
      .select('id, item_code, item_description, customer, status, max_monthly_demand_fp, sort_order')
      .eq('plan_id', plan.id).is('deleted_at', null).order('sort_order'),
    fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', plan.id),
    fetchAllByPlan(supabase, 'po_updates', 'program_id, month_index, quantity_fp, po_ref', plan.id),
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, rolling_fp', plan.id),
  ]);

  type Prog = {
    id: string; item_code: string; item_description: string; customer: string;
    status: string; max_monthly_demand_fp: number; sort_order: number;
  };
  const programs = (progs ?? []) as Prog[];

  // Demand is sparse — a month with no override carries the program's baseline.
  const overrides = new Map<string, number>();
  for (const d of demand as { program_id: string; month_index: number; demand_fp: number }[]) {
    overrides.set(`${d.program_id}:${d.month_index}`, Number(d.demand_fp));
  }
  const fulfilled = new Map<string, number>();
  for (const r of rr as { program_id: string; month_index: number; rolling_fp: number }[]) {
    fulfilled.set(`${r.program_id}:${r.month_index}`, Number(r.rolling_fp));
  }
  // A month can carry more than one PO, so collect both the total and the refs.
  const poQty = new Map<string, number>();
  const poRefs = new Map<string, string[]>();
  for (const l of poLines as { program_id: string; month_index: number; quantity_fp: number; po_ref: string }[]) {
    const k = `${l.program_id}:${l.month_index}`;
    poQty.set(k, (poQty.get(k) ?? 0) + Number(l.quantity_fp));
    const refs = poRefs.get(k);
    if (refs) refs.push(l.po_ref); else poRefs.set(k, [l.po_ref]);
  }

  // Active first, then pipeline, then the rest; plan order within each. The three
  // groups read differently, so keeping them contiguous makes the grid scannable.
  const rank = (s: string) => (s === 'active' ? 0 : s === 'pipeline' ? 1 : 2);
  const ordered = [...programs].sort((a, b) => rank(a.status) - rank(b.status) || a.sort_order - b.sort_order);

  // Plain objects, not Maps: the whole props bag is saved as the page's
  // offline copy, so it must be plain serializable data throughout.
  const rows: GridRow[] = [];
  const cellBg: Record<string, string> = {};
  const cellTitle: Record<string, string> = {};
  const poMonths: Record<string, number[]> = {};

  for (const p of ordered) {
    const pipeline = p.status === 'pipeline';
    const values = months.map((m) => {
      const k = `${p.id}:${m}`;
      const dem = overrides.get(k) ?? Number(p.max_monthly_demand_fp);

      // Pipeline carries only what supply can actually cover.
      if (pipeline) {
        const ful = fulfilled.get(k) ?? 0;
        if (ful > 0) {
          cellBg[k] = YELLOW;
          cellTitle[k] = `Pipeline — can fulfil ${num0(ful)} kg of ${num0(dem)} kg asked`;
        }
        return ful;
      }

      // An empty month is neither sold nor unsold, so it stays uncoloured.
      if (!(dem > 0)) return dem;

      const qty = poQty.get(k);
      if (qty !== undefined) {
        const refs = poRefs.get(k) ?? [];
        (poMonths[p.id] ??= []).push(m);
        cellBg[k] = BLUE;
        cellTitle[k] = `PO received — ${refs.join(', ')} · ${num0(qty)} kg`;
      } else if (p.status === 'active') {
        cellBg[k] = PINK;
        cellTitle[k] = `Active, no PO yet — ${num0(dem)} kg forecast`;
      }
      return dem;
    });

    rows.push({
      key: p.id,
      label: p.customer,
      sublabel: `${p.item_description} (${p.item_code})`,
      group: p.status,
      values,
    });
  }

  const computed = rr.length > 0;
  const anyPipeline = programs.some((p) => p.status === 'pipeline');

  // Everything below the stale-plan notice renders from this one bag — the
  // same object feeds the offline copy, so the copy holds exactly this view.
  const props = {
    planStartDate: plan.plan_start_date,
    horizon,
    rows,
    poMonths,
    cellBg,
    cellTitle,
    computed,
    anyPipeline,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Order Book</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The demand plan by program × month, coloured by how firm each month is.
        </p>
      </div>

      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />

      <OfflineCopy route="order-book" props={props}>
        <OrderBookView {...props} />
      </OfflineCopy>
    </div>
  );
}
