import { createClient } from '@/lib/supabase/server';
import { monthLabel } from '@oceanpick/shared';
import { RecalculateButton } from '../recalculate-button';

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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lastComputed ? `Plan last computed ${lastComputed}.` : 'Plan has not been computed yet.'}
          </p>
        </div>
        {plan && <RecalculateButton planId={plan.id} />}
      </div>

      {summary ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Total Demand FP" value={`${kg(summary.demand_fp)} kg`} sub="60 months" />
          <Stat label="Fulfilled" value={`${(fulfilled * 100).toFixed(0)}%`} sub={`${kg(summary.allocated_fp)} kg FP`} />
          <Stat label="Revenue" value={usd(summary.revenue)} sub="allocated" />
          <Stat label="Margin" value={usd(summary.margin)} sub={`GP ${(summary.gp_pct * 100).toFixed(1)}%`} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
          No computed results yet. Add programs, demand, and harvest capacity, then <b>Recalculate now</b> to see
          fulfilment, revenue, and margin.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Master plan" value={plan ? plan.name : 'Not seeded'} />
        <Stat label="Size buckets" value={String(bucketCount ?? 0)} />
        <Stat label="Team members" value={String(userCount ?? 0)} />
      </div>

      {plan && (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">Plan horizon</h2>
          <p className="mt-2 text-sm text-muted-foreground">
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
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b pb-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v.replace(/_/g, ' ')}</dd>
    </div>
  );
}
