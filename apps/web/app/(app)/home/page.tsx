import { createClient } from '@/lib/supabase/server';
import { monthLabel } from '@oceanpick/shared';

export default async function HomePage() {
  const supabase = await createClient();

  const [{ data: plan }, { count: bucketCount }, { count: userCount }] = await Promise.all([
    supabase.from('plans').select('*').eq('type', 'master').maybeSingle(),
    supabase.from('buckets').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Session 1 checkpoint. Input pages arrive in Session 2.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Master plan" value={plan ? plan.name : 'Not seeded'} />
        <Stat label="Size buckets" value={String(bucketCount ?? 0)} />
        <Stat label="Team members" value={String(userCount ?? 0)} />
      </div>

      {plan ? (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">Plan horizon</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            M1 = <span className="font-medium text-foreground">{monthLabel(plan.plan_start_date, 1)}</span>
            {' · '}
            M{plan.horizon_months} ={' '}
            <span className="font-medium text-foreground">
              {monthLabel(plan.plan_start_date, plan.horizon_months)}
            </span>
          </p>
          <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Row k="Margin metric" v={plan.settings_margin_metric} />
            <Row k="Allocation mode" v={plan.settings_allocation_mode} />
            <Row k="Scope" v={plan.settings_scope} />
            <Row k="Lookback" v={`${plan.settings_lookback_months} months`} />
          </dl>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm">
          <p className="font-semibold text-amber-900">No master plan found</p>
          <p className="mt-1 text-amber-800">
            Run <code className="rounded bg-amber-100 px-1">supabase/seed.sql</code> in the
            Supabase SQL Editor.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
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
