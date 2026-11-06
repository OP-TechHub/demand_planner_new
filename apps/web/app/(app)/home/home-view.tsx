'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Activity, CalendarRange } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { RecalculateButton } from '../recalculate-button';
import { DashboardOverview, type OtherData, type StatusData } from './dashboard-overview';

/** The slice of the plan the dashboard shows — serializable, so the offline copy can hold it. */
export type HomePlanInfo = {
  id: string;
  name: string;
  is_live: boolean;
  plan_start_date: string;
  horizon_months: number;
  settings_margin_metric: string;
  settings_allocation_mode: string;
  settings_scope: string;
  settings_lookback_months: number;
};

export type HomeViewProps = {
  plan: HomePlanInfo | null;
  /** Pre-formatted `last computed` label, or null when never computed. */
  lastComputed: string | null;
  /** True when the plan has computed results — shows the overview instead of the empty card. */
  hasSummary: boolean;
  active: StatusData;
  pipeline: StatusData;
  other: OtherData;
  alerts: { level: 'warn' | 'info'; text: string }[];
  bucketCount: number;
  userCount: number;
  /** Offline copy: the Recalculate button (POST /api/recompute + status polling) is hidden. */
  offline?: boolean;
};

/**
 * The dashboard, rendered purely from props. The overview's program filter,
 * range filter and chart tooltips all run in the browser, so they work
 * identically on the saved offline copy. `staleNotice` (server freshness
 * probe) and `recentActivity` (streamed audit-log card body) are per-request
 * server renders — passed online only, never serialized.
 */
export function HomeView({
  plan, lastComputed, hasSummary, active, pipeline, other, alerts, bucketCount, userCount, offline,
  staleNotice, recentActivity,
}: HomeViewProps & { staleNotice?: ReactNode; recentActivity?: ReactNode }) {
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
        {plan && !offline && <RecalculateButton planId={plan.id} />}
      </div>

      {staleNotice}

      {hasSummary && plan ? (
        <DashboardOverview active={active} pipeline={pipeline} other={other} planStartDate={plan.plan_start_date} horizon={plan.horizon_months} />
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
            {recentActivity ?? (
              <p className="text-sm text-muted-foreground">Not stored in the offline copy — reconnect to see recent activity.</p>
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
        <MiniStat label="Size buckets" value={String(bucketCount)} />
        <MiniStat label="Team members" value={String(userCount)} />
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
