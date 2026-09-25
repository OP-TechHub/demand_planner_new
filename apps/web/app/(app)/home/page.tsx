import { AlertTriangle, Activity, CalendarRange } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { fetchAllByPlan, fetchAllPaged } from '@/lib/fetch-all';
import { getActivePlan } from '@/lib/plan';
import { Card } from '@/components/ui/card';
import { RecalculateButton } from '../recalculate-button';
import { StalePlanNotice } from '../stale-banner';
import { DashboardOverview, type BorrowSource, type OtherData, type StatusData, type StatusKey } from './dashboard-overview';

export default async function HomePage() {
  const supabase = await createClient();

  // The plan selected in the top bar, defaulting to the org's live plan.
  const plan = await getActivePlan();
  const [{ count: bucketCount }, { count: userCount }, { data: summary }] = await Promise.all([
    // Live buckets only — archived ones aren't part of the plan's supply.
    supabase.from('buckets').select('*', { count: 'exact', head: true }).eq('is_archived', false),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    plan
      ? supabase.from('plan_summary').select('*').eq('plan_id', plan.id).eq('period', 'total_60mo').maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const lastComputed = plan?.last_computed_at ? new Date(plan.last_computed_at).toLocaleString() : null;

  // One rolling_results pass feeds the overview (per month) and the alerts (per
  // program). Figures are kept per program STATUS so the overview's programs
  // filter (active / pipeline / combined) can be applied client-side.
  const emptyStatus = (): StatusData => ({ monthly: [], shortfall: [], secondaryProducts: [] });
  const byStatus: Record<StatusKey, StatusData> = { active: emptyStatus(), pipeline: emptyStatus() };
  let other: OtherData = { monthly: [], products: [] };
  const alerts: { level: 'warn' | 'info'; text: string }[] = [];
  let recent: { who: string; text: string; when: string }[] = [];

  if (plan) {
    const months = plan.horizon_months;
    if (!plan.last_computed_at) alerts.push({ level: 'warn', text: 'Plan hasn’t been computed yet — click Recalculate now.' });
    else if (Date.now() - new Date(plan.last_computed_at).getTime() > 24 * 3600 * 1000)
      alerts.push({ level: 'warn', text: 'Computed results are over 24 hours old — Recalculate to refresh.' });

    // Program status + customer, for the active/pipeline split and the
    // shortfall-by-customer chart.
    const [{ data: progs }, { data: bks }] = await Promise.all([
      supabase
        .from('programs')
        .select('id, item_code, status, customer, primary_yield, secondary_yield, tertiary_yield, primary_bucket_id, secondary_bucket_id, tertiary_bucket_id, max_monthly_demand_fp')
        .eq('plan_id', plan.id).is('deleted_at', null),
      supabase.from('buckets').select('id, name').eq('is_archived', false),
    ]);
    type Prog = {
      id: string; item_code: string; status: string; customer: string;
      primary_yield: number; secondary_yield: number | null; tertiary_yield: number | null;
      primary_bucket_id: string; secondary_bucket_id: string | null; tertiary_bucket_id: string | null;
      max_monthly_demand_fp: number;
    };
    const progList = (progs ?? []) as Prog[];
    const progById = new Map(progList.map((p) => [p.id, p]));
    const bucketName = new Map((bks ?? []).map((b) => [b.id, b.name as string]));

    if (summary) {
      const rr = await fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, demand_fp, rolling_fp, rolling_wr, own_fp, own_wr, revenue, cost, ' +
        'borrow_m1_prim_wr, borrow_m1_alt_wr, borrow_m1_tert_wr, borrow_m2_prim_wr, borrow_m2_alt_wr, borrow_m2_tert_wr, ' +
        'borrow_m3_prim_wr, borrow_m3_alt_wr, borrow_m3_tert_wr, borrow_m4_prim_wr, borrow_m4_alt_wr, borrow_m4_tert_wr', plan.id);
      const zeros = () => new Array<number>(months).fill(0);

      // Per-status accumulators. The engine only writes rows for in-scope
      // programs, so every row is active or pipeline; anything else is skipped.
      type Acc = {
        dem: number[]; ful: number[];
        // wr = whole round actually consumed (rolling_wr). wrNeed = the whole round
        // the full demand book would take, demand_fp / primary_yield per spec §2.2
        // (Excel col AH) — a demand-side figure, so it stands at primary yield
        // throughout rather than at the paths the engine happened to use.
        wr: number[]; wrNeed: number[];
        // Own-month share of the fulfilled volume; the remainder of rolling_fp /
        // rolling_wr came through the borrow channels (up to four months back).
        ownFp: number[]; ownWr: number[];
        rev: number[]; cst: number[];
        // Borrowed WR per target month, attributed to its SOURCE (month − offset,
        // path bucket) — the same attribution the engine's §8.2 pipeline uses.
        // Each channel's FP is its WR at that path's yield.
        borrowByMonth: Map<string, BorrowSource>[];
        // Kept per month (not pre-totalled) so the overview's time filter can rank
        // customers within the selected range rather than over the whole horizon.
        shortByCust: Map<string, number[]>;
        // Feedstock WR for secondary products, per source item code.
        feedByCode: Map<string, number[]>;
      };
      const newAcc = (): Acc => ({
        dem: zeros(), ful: zeros(), wr: zeros(), wrNeed: zeros(), ownFp: zeros(), ownWr: zeros(), rev: zeros(), cst: zeros(),
        borrowByMonth: Array.from({ length: months }, () => new Map()),
        shortByCust: new Map(), feedByCode: new Map(),
      });
      const acc: Record<StatusKey, Acc> = { active: newAcc(), pipeline: newAcc() };
      const CHANNELS = [1, 2, 3, 4].flatMap((offset) => (['prim', 'alt', 'tert'] as const).map((path) => ({ offset, path, col: `borrow_m${offset}_${path}_wr` as const })));
      const pd = new Map<string, number>(), pf = new Map<string, number>();

      for (const r of rr) {
        const prog = progById.get(r.program_id);
        const st = prog?.status as StatusKey | undefined;
        const a = st ? acc[st] : undefined;
        const i = r.month_index - 1;
        if (prog && a && i >= 0 && i < months) {
          a.dem[i] += r.demand_fp; a.ful[i] += r.rolling_fp; a.wr[i] += r.rolling_wr; a.rev[i] += r.revenue; a.cst[i] += r.cost;
          a.ownFp[i] += r.own_fp; a.ownWr[i] += r.own_wr;
          const y = Number(prog.primary_yield) || 0;
          if (y > 0) a.wrNeed[i] += r.demand_fp / y;
          for (const ch of CHANNELS) {
            const bwr = Number((r as Record<string, unknown>)[ch.col] ?? 0);
            if (!(bwr > 0)) continue;
            const src = i - ch.offset;
            if (src < 0) continue;
            const bucketId = ch.path === 'prim' ? prog.primary_bucket_id : ch.path === 'alt' ? prog.secondary_bucket_id : prog.tertiary_bucket_id;
            const py = ch.path === 'prim' ? prog.primary_yield : ch.path === 'alt' ? prog.secondary_yield : prog.tertiary_yield;
            if (!bucketId) continue;
            const key = `${src}:${bucketId}`;
            const m = a.borrowByMonth[i]!;
            const cur = m.get(key) ?? { srcMonth: src + 1, bucket: bucketName.get(bucketId) ?? bucketId, wr: 0, fp: 0 };
            cur.wr += bwr; cur.fp += bwr * Number(py ?? 0);
            m.set(key, cur);
          }
          const short = Math.max(0, r.demand_fp - r.rolling_fp);
          if (short > 0) {
            const cust = prog.customer ?? '—';
            let arr = a.shortByCust.get(cust);
            if (!arr) { arr = zeros(); a.shortByCust.set(cust, arr); }
            arr[i] += short;
          }
          let feed = a.feedByCode.get(prog.item_code);
          if (!feed) { feed = zeros(); a.feedByCode.set(prog.item_code, feed); }
          feed[i] += r.rolling_wr;
        }
        pd.set(r.program_id, (pd.get(r.program_id) ?? 0) + r.demand_fp);
        pf.set(r.program_id, (pf.get(r.program_id) ?? 0) + r.rolling_fp);
      }

      // Secondary-product revenue, on the same basis as the Secondary products
      // page: quantity = feedstock WR × yield, value = quantity × price. Group 1
      // reads one product's whole round; group 2 reads the plan's total — here
      // the total of the status being built, so active + pipeline = the plan.
      const { data: secDefs } = await supabase
        .from('secondary_products')
        .select('name, basis, source_item_code, yield_pct, price_per_kg, is_archived');
      const secRows = ((secDefs ?? []) as {
        name: string; basis: string; source_item_code: string | null; yield_pct: number; price_per_kg: number; is_archived: boolean;
      }[]).filter((d) => !d.is_archived);

      for (const st of ['active', 'pipeline'] as const) {
        const a = acc[st];
        const secRev = zeros();
        // Per product too, keyed by name (the same by-product off two source
        // items rolls up under one name), kept per month for the range filter.
        const secByName = new Map<string, number[]>();
        for (const d of secRows) {
          const feed = d.basis === 'total_wr' ? a.wr : a.feedByCode.get(d.source_item_code ?? '');
          if (!feed) continue;
          const rate = Number(d.yield_pct) * Number(d.price_per_kg);
          if (!(rate > 0)) continue;
          let byName = secByName.get(d.name);
          if (!byName) { byName = zeros(); secByName.set(d.name, byName); }
          for (let i = 0; i < months; i++) { const v = (feed[i] ?? 0) * rate; secRev[i] += v; byName[i] += v; }
        }
        byStatus[st] = {
          monthly: a.dem.map((d, i) => ({
            demand: d, fulfilled: a.ful[i] ?? 0, wrUsed: a.wr[i] ?? 0, wrNeeded: a.wrNeed[i] ?? 0,
            ownFp: a.ownFp[i] ?? 0, ownWr: a.ownWr[i] ?? 0, revenue: a.rev[i] ?? 0, cost: a.cst[i] ?? 0,
            secondaryRevenue: secRev[i] ?? 0,
            borrowSources: [...(a.borrowByMonth[i]?.values() ?? [])].sort((x, y) => y.wr - x.wr),
          })),
          shortfall: [...a.shortByCust.entries()].map(([customer, m]) => ({ customer, months: m })),
          secondaryProducts: [...secByName.entries()].map(([name, m]) => ({ name, months: m })),
        };
      }

      // Other products: traded lines outside the harvest plan (org-scoped, like
      // secondary products) and tied to no program, so they sit outside the
      // status filter. Quantity is typed in per month; revenue and cost are flat
      // per-unit rates. Same arithmetic as lib/side-products.ts, kept per
      // product name and per month for the card breakdown and range filter.
      const [{ data: otherDefs }, otherMonths] = await Promise.all([
        supabase.from('other_products').select('id, name, unit_cost, unit_revenue').eq('is_archived', false),
        fetchAllPaged(
          (a: number, b: number) => supabase.from('other_product_months').select('product_id, month_index, quantity').range(a, b),
          'other_product_months'
        ).catch(() => [] as { product_id: string; month_index: number; quantity: number }[]),
      ]);
      const othRev = zeros(), othCost = zeros();
      const othByName = new Map<string, number[]>();
      const otherById = new Map(
        ((otherDefs ?? []) as { id: string; name: string; unit_cost: number; unit_revenue: number }[]).map((p) => [p.id, p])
      );
      for (const m of otherMonths as { product_id: string; month_index: number; quantity: number }[]) {
        const p = otherById.get(m.product_id);
        const i = m.month_index - 1;
        if (!p || i < 0 || i >= months) continue;
        const q = Number(m.quantity) || 0;
        const rv = q * Number(p.unit_revenue);
        othRev[i] += rv;
        othCost[i] += q * Number(p.unit_cost);
        let byName = othByName.get(p.name);
        if (!byName) { byName = zeros(); othByName.set(p.name, byName); }
        byName[i] += rv;
      }
      other = {
        monthly: othRev.map((rv, i) => ({ revenue: rv, cost: othCost[i] ?? 0 })),
        products: [...othByName.entries()].map(([name, m]) => ({ name, months: m })),
      };

      let under = 0;
      for (const [pid, d] of pd) if (d > 0 && (pf.get(pid) ?? 0) / d < 0.5) under++;
      if (under) alerts.push({ level: 'warn', text: `${under} program${under > 1 ? 's' : ''} under 50% fulfilled over 60 months.` });
    }

    const harv = await fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, capacity_kg_wr', plan.id);
    const noYield = progList.filter((p) => (p.max_monthly_demand_fp ?? 0) > 0 && (!p.primary_yield || p.primary_yield <= 0)).length;
    if (noYield) alerts.push({ level: 'warn', text: `${noYield} program${noYield > 1 ? 's have' : ' has'} demand but no primary yield.` });
    const cap = new Map<string, number>();
    for (const h of harv) cap.set(h.bucket_id, (cap.get(h.bucket_id) ?? 0) + h.capacity_kg_wr);
    const zero = (bks ?? []).filter((b) => (cap.get(b.id) ?? 0) === 0);
    if (zero.length) alerts.push({ level: 'info', text: `${zero.length} bucket${zero.length > 1 ? 's have' : ' has'} zero 60-month capacity (${zero.map((b) => b.name).slice(0, 3).join(', ')}${zero.length > 3 ? '…' : ''}).` });

    if (!alerts.some((a) => a.level === 'warn')) alerts.push({ level: 'info', text: 'No warnings — plan looks healthy.' });

    const [{ data: entries }, { data: users }] = await Promise.all([
      supabase.from('audit_log').select('user_id, action, entity_type, at').order('at', { ascending: false }).limit(8),
      supabase.from('users').select('id, full_name, email'),
    ]);
    const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name || u.email]));
    recent = (entries ?? []).map((e) => ({ who: nameById.get(e.user_id) ?? '—', text: `${e.action} ${e.entity_type}`, when: new Date(e.at).toLocaleString() }));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan && <span className="font-medium text-foreground">{plan.name}</span>}
            {plan ? ' · ' : ''}
            {lastComputed ? `last computed ${lastComputed}.` : 'not computed yet.'}
          </p>
        </div>
        {plan && <RecalculateButton planId={plan.id} />}
      </div>

      {plan && <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />}

      {summary && plan ? (
        <DashboardOverview active={byStatus.active} pipeline={byStatus.pipeline} other={other} planStartDate={plan.plan_start_date} horizon={plan.horizon_months} />
      ) : (
        <Card className="border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
          No computed results yet. Add programs, demand, and harvest capacity, then{' '}
          <b className="text-foreground">Recalculate</b> to see fulfilment, revenue, and margin.
        </Card>
      )}

      {plan && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Recent activity</h2>
            </div>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate"><span className="font-medium">{r.who}</span>{' '}
                      <span className="text-muted-foreground">{r.text}</span></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{r.when}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Alerts</h2>
            </div>
            <ul className="space-y-1.5 text-sm">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', a.level === 'warn' ? 'bg-warning' : 'bg-muted-foreground/40')} />
                  <span className={a.level === 'warn' ? 'text-warning' : 'text-muted-foreground'}>{a.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <MiniStat label={plan?.is_live ? 'Live plan' : 'Plan'} value={plan ? plan.name : 'Not seeded'} />
        <MiniStat label="Size buckets" value={String(bucketCount ?? 0)} />
        <MiniStat label="Team members" value={String(userCount ?? 0)} />
      </div>

      {plan && (
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Plan horizon</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            M1 = <span className="font-medium text-foreground">{monthLabel(plan.plan_start_date, 1)}</span>
            {' · '}M{plan.horizon_months} ={' '}
            <span className="font-medium text-foreground">{monthLabel(plan.plan_start_date, plan.horizon_months)}</span>
          </p>
          <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Row k="Margin metric" v={plan.settings_margin_metric} />
            <Row k="Allocation mode" v={plan.settings_allocation_mode} />
            <Row k="Scope" v={plan.settings_scope} />
            <Row k="Lookback" v={`${plan.settings_lookback_months} months`} />
          </dl>
        </Card>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border pb-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v.replace(/_/g, ' ')}</dd>
    </div>
  );
}
