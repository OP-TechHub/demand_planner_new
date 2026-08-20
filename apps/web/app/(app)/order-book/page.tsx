import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { type GridRow } from '@/lib/grid-csv';
import { StalePlanNotice } from '../stale-banner';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { OrderBookGrid } from './order-book-grid';
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

/** Cell colours. Deliberate data-viz values, not theme tokens — see output-grid. */
const BLUE = '#bfdbfe';
const PINK = '#fbcfe8';
const YELLOW = '#fde68a';

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

  const rows: GridRow[] = [];
  const cellBg = new Map<string, string>();
  const cellTitle = new Map<string, string>();
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
          cellBg.set(k, YELLOW);
          cellTitle.set(k, `Pipeline — can fulfil ${num0(ful)} kg of ${num0(dem)} kg asked`);
        }
        return ful;
      }

      // An empty month is neither sold nor unsold, so it stays uncoloured.
      if (!(dem > 0)) return dem;

      const qty = poQty.get(k);
      if (qty !== undefined) {
        const refs = poRefs.get(k) ?? [];
        (poMonths[p.id] ??= []).push(m);
        cellBg.set(k, BLUE);
        cellTitle.set(k, `PO received — ${refs.join(', ')} · ${num0(qty)} kg`);
      } else if (p.status === 'active') {
        cellBg.set(k, PINK);
        cellTitle.set(k, `Active, no PO yet — ${num0(dem)} kg forecast`);
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Order Book</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The demand plan by program × month, coloured by how firm each month is.
        </p>
      </div>

      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 text-xs">
        <Key color={BLUE} title="PO received">the month&apos;s PO quantity — firm</Key>
        <Key color={PINK} title="Active, no PO">forecast demand — not yet sold</Key>
        <Key color={YELLOW} title="Pipeline">what the plan can fulfil, not the full ask</Key>
      </div>

      {!computed && anyPipeline && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Pipeline rows read zero until the plan is calculated — their figure is what the engine can fulfil, and there
          are no results yet. <b>Recalculate</b> to fill them in.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          This plan has no programs yet — add them on the Programs tab first.
        </p>
      ) : (
        <OrderBookGrid
          planStartDate={plan.plan_start_date}
          horizon={horizon}
          rows={rows}
          poMonths={poMonths}
          cellBg={cellBg}
          cellTitle={cellTitle}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Pick the months you want, then narrow to the programs you care about — the picker beside the tabs takes any
        number of them, and searching by customer lets you add a whole account at once. The tabs then sort what&apos;s
        left by what it does <i>in those months</i>: <b>PO received</b> is any program holding a PO in that window,
        <b> Active, no PO</b> is an active program with none, and <b>Pipeline</b> is the inquiry rows. Narrowing the
        months re-answers the question, so a program whose only PO lands outside the window moves between the first two,
        and the counts on the tabs move with it. Active and pipeline programs are kept apart, active first. For an <b>active</b> program the figure is its demand
        plan quantity — <span className="rounded px-1" style={{ background: BLUE, color: '#1e293b' }}>blue</span> once a
        PO has been received for that month (the PO Update tab has already set demand to the PO sum), and{' '}
        <span className="rounded px-1" style={{ background: PINK, color: '#1e293b' }}>pink</span> while it is still
        only a forecast. A <b>pipeline</b> program is{' '}
        <span className="rounded px-1" style={{ background: YELLOW, color: '#1e293b' }}>yellow</span> and shows what the
        plan <b>can fulfil</b> rather than what was asked for, because an unconfirmed inquiry only belongs in an order
        book to the extent supply can actually cover it — hover one to see the ask behind it. Months with no demand, and
        pipeline months the plan can&apos;t fulfil at all, are left uncoloured. The TOTAL row therefore adds firm and
        forecast active demand to fulfilable pipeline, which is the order book as a whole.
      </p>
    </div>
  );
}

function Key({ color, title, children }: { color: string; title: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-4 w-6 shrink-0 rounded border border-border" style={{ background: color }} />
      <span>
        <b>{title}</b> <span className="text-muted-foreground">— {children}</span>
      </span>
    </span>
  );
}
