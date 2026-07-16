import { Package, Target, DollarSign, TrendingUp, AlertTriangle, Activity, CalendarRange, type LucideIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { MonthlyLineChart } from '@/components/charts/monthly-line-chart';
import { Card } from '@/components/ui/card';
import { RecalculateButton } from '../recalculate-button';
import { StalePlanNotice } from '../stale-banner';

function kg(n: number) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n));
}
function usd(n: number) {
  return n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n).toLocaleString();
}

export default async function HomePage() {
  const supabase = await createClient();

  const { data: plan } = await supabase.from('plans').select('*').eq('type', 'master').maybeSingle();
  const [{ count: bucketCount }, { count: userCount }, { data: summary }] = await Promise.all([
    supabase.from('buckets').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    plan
      ? supabase.from('plan_summary').select('*').eq('plan_id', plan.id).eq('period', 'total_60mo').maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const fulfilled = summary && summary.demand_fp > 0 ? summary.allocated_fp / summary.demand_fp : 0;
  const lastComputed = plan?.last_computed_at ? new Date(plan.last_computed_at).toLocaleString() : null;

  // One rolling_results pass feeds both the chart (monthly) and the alerts (per-program).
  let chartData: { label: string; demand: number; fulfilled: number }[] = [];
  const alerts: { level: 'warn' | 'info'; text: string }[] = [];
  let recent: { who: string; text: string; when: string }[] = [];

  if (plan) {
    const months = plan.horizon_months;
    if (!plan.last_computed_at) alerts.push({ level: 'warn', text: 'Plan hasn’t been computed yet — click Recalculate now.' });
    else if (Date.now() - new Date(plan.last_computed_at).getTime() > 24 * 3600 * 1000)
      alerts.push({ level: 'warn', text: 'Computed results are over 24 hours old — Recalculate to refresh.' });

    if (summary) {
      const rr = await fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, demand_fp, rolling_fp', plan.id);
      const dem = new Array<number>(months).fill(0), ful = new Array<number>(months).fill(0);
      const pd = new Map<string, number>(), pf = new Map<string, number>();
      for (const r of rr) {
        const i = r.month_index - 1;
        if (i >= 0 && i < months) { dem[i] += r.demand_fp; ful[i] += r.rolling_fp; }
        pd.set(r.program_id, (pd.get(r.program_id) ?? 0) + r.demand_fp);
        pf.set(r.program_id, (pf.get(r.program_id) ?? 0) + r.rolling_fp);
      }
      chartData = dem.map((d, i) => ({ label: monthLabel(plan.plan_start_date, i + 1), demand: d, fulfilled: ful[i] ?? 0 }));
      let under = 0;
      for (const [pid, d] of pd) if (d > 0 && (pf.get(pid) ?? 0) / d < 0.5) under++;
      if (under) alerts.push({ level: 'warn', text: `${under} program${under > 1 ? 's' : ''} under 50% fulfilled over 60 months.` });
    }

    const [{ data: progs }, { data: bks }, harv] = await Promise.all([
      supabase.from('programs').select('id, primary_yield, max_monthly_demand_fp').eq('plan_id', plan.id).is('deleted_at', null),
      supabase.from('buckets').select('id, name').eq('is_archived', false),
      fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, capacity_kg_wr', plan.id),
    ]);
    const noYield = (progs ?? []).filter((p) => (p.max_monthly_demand_fp ?? 0) > 0 && (!p.primary_yield || p.primary_yield <= 0)).length;
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
            {lastComputed ? `Last computed ${lastComputed}.` : 'Plan has not been computed yet.'}
          </p>
        </div>
        {plan && <RecalculateButton planId={plan.id} />}
      </div>

      {plan && <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />}

      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Package} tone="primary" label="Total Demand" value={`${kg(summary.demand_fp)} kg`} sub="60 months, FP" />
          <Stat icon={Target} tone="accent" label="Fulfilled" value={`${(fulfilled * 100).toFixed(0)}%`} sub={`${kg(summary.allocated_fp)} kg FP`} />
          <Stat icon={DollarSign} tone="success" label="Revenue" value={usd(summary.revenue)} sub="allocated" />
          <Stat icon={TrendingUp} tone="primary" label="Margin" value={usd(summary.margin)} sub={`GP ${(summary.gp_pct * 100).toFixed(1)}%`} />
        </div>
      ) : (
        <Card className="border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
          No computed results yet. Add programs, demand, and harvest capacity, then{' '}
          <b className="text-foreground">Recalculate</b> to see fulfilment, revenue, and margin.
        </Card>
      )}

      {chartData.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Monthly demand vs. fulfilled (kg FP)</h2>
          <MonthlyLineChart
            data={chartData}
            series={[
              { key: 'demand', name: 'Demand', color: '#2a78d6', dashed: true },
              { key: 'fulfilled', name: 'Fulfilled', color: '#eb6834' },
            ]}
            format="kg"
          />
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
        <MiniStat label="Master plan" value={plan ? plan.name : 'Not seeded'} />
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

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  tone: 'primary' | 'accent' | 'success';
  label: string;
  value: string;
  sub?: string;
}) {
  const tones = {
    primary: 'bg-primary/10 text-primary',
    accent: 'bg-accent/10 text-accent',
    success: 'bg-success/12 text-success',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-md', tones[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
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
