import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { PATH_SELECT, programPath, type AllocPath, type Program } from '@oceanpick/shared';
import { CHANNELS as ENGINE_CHANNELS } from '@oceanpick/engine';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { getActivePlan } from '@/lib/plan';
import { StalePlanNotice } from '../stale-banner';
import { type BorrowSource, type OtherData, type StatusData, type StatusKey } from './dashboard-overview';
import { OfflineCopy } from '@/components/pwa/offline-copy';
import { HomeView } from './home-view';

export default async function HomePage() {
  const supabase = await createClient();

  // The plan selected in the top bar, defaulting to the org's live plan.
  const plan = await getActivePlan();
  const planId = plan?.id;

  // Every query below depends only on the plan id, so they all go out in one
  // round trip instead of the chain of awaits this page used to make. An
  // uncomputed plan has no rolling_results rows, so fetching it regardless of
  // `summary` costs next to nothing.
  const none = Promise.resolve({ data: null });
  const noRows = Promise.resolve([] as any[]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [
    { count: bucketCount }, { count: userCount }, { data: summary },
    { data: progs }, { data: bks }, rr, { data: secDefs }, { data: otherDefs }, otherMonths, harv,
  ] = await Promise.all([
    // Live buckets only — archived ones aren't part of the plan's supply.
    supabase.from('buckets').select('*', { count: 'exact', head: true }).eq('is_archived', false),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    planId
      ? supabase.from('plan_summary').select('*').eq('plan_id', planId).eq('period', 'total_60mo').maybeSingle()
      : none,
    // Program status + customer, for the active/pipeline split and the
    // shortfall-by-customer chart.
    planId
      ? supabase
          .from('programs')
          .select('id, item_code, status, customer, max_monthly_demand_fp, ' + PATH_SELECT)
          .eq('plan_id', planId).is('deleted_at', null)
      : none,
    planId ? supabase.from('buckets').select('id, name').eq('is_archived', false) : none,
    planId
      ? fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, demand_fp, rolling_fp, rolling_wr, own_fp, own_wr, revenue, cost, ' +
          ENGINE_CHANNELS.map((ch) => `borrow_${ch.field}_wr`).join(', '), planId)
      : noRows,
    planId
      ? supabase.from('secondary_products').select('name, basis, source_item_code, yield_pct, price_per_kg, is_archived').eq('plan_id', planId)
      : none,
    planId
      ? supabase.from('other_products').select('id, name, unit_cost, unit_revenue').eq('plan_id', planId).eq('is_archived', false)
      : none,
    planId
      ? fetchAllByPlan(supabase, 'other_product_months', 'product_id, month_index, quantity', planId)
          .catch(() => [] as { product_id: string; month_index: number; quantity: number }[])
      : noRows,
    planId ? fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, capacity_kg_wr', planId) : noRows,
  ]);

  const lastComputed = plan?.last_computed_at ? new Date(plan.last_computed_at).toLocaleString() : null;

  // One rolling_results pass feeds the overview (per month) and the alerts (per
  // program). Figures are kept per program STATUS so the overview's programs
  // filter (active / pipeline / combined) can be applied client-side.
  const emptyStatus = (): StatusData => ({ monthly: [], shortfall: [], secondaryProducts: [] });
  const byStatus: Record<StatusKey, StatusData> = { active: emptyStatus(), pipeline: emptyStatus() };
  let other: OtherData = { monthly: [], products: [] };
  const alerts: { level: 'warn' | 'info'; text: string }[] = [];

  if (plan) {
    const months = plan.horizon_months;
    if (!plan.last_computed_at) alerts.push({ level: 'warn', text: 'Plan hasn’t been computed yet — click Recalculate now.' });
    else if (Date.now() - new Date(plan.last_computed_at).getTime() > 24 * 3600 * 1000)
      alerts.push({ level: 'warn', text: 'Computed results are over 24 hours old — Recalculate to refresh.' });

    type Prog = Pick<Program, 'id' | 'item_code' | 'status' | 'customer' | 'max_monthly_demand_fp'> &
      Pick<Program, `${AllocPath}_bucket_id` | `${AllocPath}_yield`>;
    const progList = (progs ?? []) as unknown as Prog[];
    const progById = new Map(progList.map((p) => [p.id, p]));
    const bucketName = new Map((bks ?? []).map((b) => [b.id, b.name as string]));

    if (summary) {
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
      const CHANNELS = ENGINE_CHANNELS.map((ch) => ({ offset: ch.offset, path: ch.path, col: `borrow_${ch.field}_wr` }));
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
            const { bucket_id: bucketId, yield: py } = programPath(prog, ch.path);
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

      // Other products: traded lines outside the harvest plan, tied to no
      // program, so they sit outside the status filter. Quantity is typed in
      // per month; revenue and cost are flat per-unit rates. Same arithmetic as
      // lib/side-products.ts, kept per product name and per month for the card
      // breakdown and range filter.
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

    const noYield = progList.filter((p) => (p.max_monthly_demand_fp ?? 0) > 0 && (!p.primary_yield || p.primary_yield <= 0)).length;
    if (noYield) alerts.push({ level: 'warn', text: `${noYield} program${noYield > 1 ? 's have' : ' has'} demand but no primary yield.` });
    const cap = new Map<string, number>();
    for (const h of harv) cap.set(h.bucket_id, (cap.get(h.bucket_id) ?? 0) + h.capacity_kg_wr);
    const zero = (bks ?? []).filter((b) => (cap.get(b.id) ?? 0) === 0);
    if (zero.length) alerts.push({ level: 'info', text: `${zero.length} bucket${zero.length > 1 ? 's have' : ' has'} zero 60-month capacity (${zero.map((b) => b.name).slice(0, 3).join(', ')}${zero.length > 3 ? '…' : ''}).` });

    if (!alerts.some((a) => a.level === 'warn')) alerts.push({ level: 'info', text: 'No warnings — plan looks healthy.' });
  }

  const props = {
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          is_live: plan.is_live,
          plan_start_date: plan.plan_start_date,
          horizon_months: plan.horizon_months,
          settings_margin_metric: plan.settings_margin_metric,
          settings_allocation_mode: plan.settings_allocation_mode,
          settings_scope: plan.settings_scope,
          settings_lookback_months: plan.settings_lookback_months,
        }
      : null,
    lastComputed,
    hasSummary: Boolean(summary && plan),
    active: byStatus.active,
    pipeline: byStatus.pipeline,
    other,
    alerts,
    bucketCount: bucketCount ?? 0,
    userCount: userCount ?? 0,
  };
  const view = (
    <HomeView
      {...props}
      staleNotice={
        // Streamed: the freshness probe shouldn't hold back the rest of the page.
        plan ? (
          <Suspense fallback={null}>
            <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
          </Suspense>
        ) : undefined
      }
      recentActivity={
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <RecentActivity />
        </Suspense>
      }
    />
  );
  // No plan yet (unseeded org) → nothing worth copying to the device.
  if (!plan) return view;
  return (
    <OfflineCopy route="home" props={props}>
      {view}
    </OfflineCopy>
  );
}

/** Streamed separately so the audit-log query doesn't hold back the dashboard. */
async function RecentActivity() {
  const supabase = await createClient();
  const [{ data: entries }, { data: users }] = await Promise.all([
    supabase.from('audit_log').select('user_id, action, entity_type, at').order('at', { ascending: false }).limit(8),
    supabase.from('users').select('id, full_name, email'),
  ]);
  const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name || u.email]));
  const recent = (entries ?? []).map((e) => ({ who: nameById.get(e.user_id) ?? '—', text: `${e.action} ${e.entity_type}`, when: new Date(e.at).toLocaleString() }));

  if (recent.length === 0) return <p className="text-sm text-muted-foreground">No recent activity recorded.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {recent.map((r, i) => (
        <li key={i} className="flex items-center justify-between gap-2">
          <span className="truncate"><span className="font-medium">{r.who}</span>{' '}
            <span className="text-muted-foreground">{r.text}</span></span>
          <span className="shrink-0 text-xs text-muted-foreground">{r.when}</span>
        </li>
      ))}
    </ul>
  );
}
