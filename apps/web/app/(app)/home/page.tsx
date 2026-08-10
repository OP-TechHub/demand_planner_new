import { AlertTriangle, Activity, CalendarRange } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { getActivePlan } from '@/lib/plan';
import { Card } from '@/components/ui/card';
import { RecalculateButton } from '../recalculate-button';
import { StalePlanNotice } from '../stale-banner';
import { DashboardOverview, type MonthPoint, type ShortfallRow } from './dashboard-overview';

export default async function HomePage() {
  const supabase = await createClient();

  // The plan selected in the top bar, defaulting to the org's live plan.
  const plan = await getActivePlan();
  const [{ count: bucketCount }, { count: userCount }, { data: summary }] = await Promise.all([
    supabase.from('buckets').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    plan
      ? supabase.from('plan_summary').select('*').eq('plan_id', plan.id).eq('period', 'total_60mo').maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const lastComputed = plan?.last_computed_at ? new Date(plan.last_computed_at).toLocaleString() : null;

  // One rolling_results pass feeds the overview (per month) and the alerts (per program).
  let monthly: MonthPoint[] = [];
  let shortfall: ShortfallRow[] = [];
  const alerts: { level: 'warn' | 'info'; text: string }[] = [];
  let recent: { who: string; text: string; when: string }[] = [];

  if (plan) {
    const months = plan.horizon_months;
    if (!plan.last_computed_at) alerts.push({ level: 'warn', text: 'Plan hasn’t been computed yet — click Recalculate now.' });
    else if (Date.now() - new Date(plan.last_computed_at).getTime() > 24 * 3600 * 1000)
      alerts.push({ level: 'warn', text: 'Computed results are over 24 hours old — Recalculate to refresh.' });

    // Program status + customer, for the active/pipeline split and the
    // shortfall-by-customer chart.
    const { data: progs } = await supabase
      .from('programs').select('id, status, customer, primary_yield, max_monthly_demand_fp')
      .eq('plan_id', plan.id).is('deleted_at', null);
    const progList = (progs ?? []) as { id: string; status: string; customer: string; primary_yield: number; max_monthly_demand_fp: number }[];
    const statusById = new Map(progList.map((p) => [p.id, p.status]));
    const customerById = new Map(progList.map((p) => [p.id, p.customer]));

    if (summary) {
      const rr = await fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, demand_fp, rolling_fp, rolling_wr, revenue, cost', plan.id);
      const dem = new Array<number>(months).fill(0), ful = new Array<number>(months).fill(0);
      const wr = new Array<number>(months).fill(0);
      const rev = new Array<number>(months).fill(0), cst = new Array<number>(months).fill(0);
      const actDem = new Array<number>(months).fill(0), pipeDem = new Array<number>(months).fill(0);
      const pd = new Map<string, number>(), pf = new Map<string, number>();
      // Kept per month (not pre-totalled) so the overview's time filter can rank
      // customers within the selected range rather than over the whole horizon.
      const shortByCust = new Map<string, number[]>();
      for (const r of rr) {
        const i = r.month_index - 1;
        if (i >= 0 && i < months) {
          dem[i] += r.demand_fp; ful[i] += r.rolling_fp; wr[i] += r.rolling_wr; rev[i] += r.revenue; cst[i] += r.cost;
          const st = statusById.get(r.program_id);
          if (st === 'active') actDem[i] += r.demand_fp;
          else if (st === 'pipeline') pipeDem[i] += r.demand_fp;
          const short = Math.max(0, r.demand_fp - r.rolling_fp);
          if (short > 0) {
            const cust = customerById.get(r.program_id) ?? '—';
            let arr = shortByCust.get(cust);
            if (!arr) { arr = new Array<number>(months).fill(0); shortByCust.set(cust, arr); }
            arr[i] += short;
          }
        }
        pd.set(r.program_id, (pd.get(r.program_id) ?? 0) + r.demand_fp);
        pf.set(r.program_id, (pf.get(r.program_id) ?? 0) + r.rolling_fp);
      }
      monthly = dem.map((d, i) => ({ demand: d, fulfilled: ful[i] ?? 0, wrUsed: wr[i] ?? 0, revenue: rev[i] ?? 0, cost: cst[i] ?? 0, activeDemand: actDem[i] ?? 0, pipelineDemand: pipeDem[i] ?? 0 }));
      shortfall = [...shortByCust.entries()].map(([customer, m]) => ({ customer, months: m }));
      let under = 0;
      for (const [pid, d] of pd) if (d > 0 && (pf.get(pid) ?? 0) / d < 0.5) under++;
      if (under) alerts.push({ level: 'warn', text: `${under} program${under > 1 ? 's' : ''} under 50% fulfilled over 60 months.` });
    }

    const [{ data: bks }, harv] = await Promise.all([
      supabase.from('buckets').select('id, name').eq('is_archived', false),
      fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, capacity_kg_wr', plan.id),
    ]);
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
        <DashboardOverview monthly={monthly} shortfall={shortfall} planStartDate={plan.plan_start_date} horizon={plan.horizon_months} />
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
