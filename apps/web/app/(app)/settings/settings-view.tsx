'use client';

import type { Plan } from '@oceanpick/shared';
import { SettingsForm } from './settings-form';
import { RollForwardCard } from './roll-forward';
import { RestoreSnapshotCard, type SnapshotOption } from './restore-snapshot';
import { ApiKeysCard } from './api-keys';
import type { ApiKeyRow } from './api-keys-actions';

/**
 * Everything the Settings page needs. The snapshot saved for offline carries
 * `apiKeys: []` — no key labels, prefixes or usage data are ever written to
 * the device (see page.tsx); the real list only travels to the online render.
 */
export type SettingsViewProps = {
  plan: Plan;
  isAdmin: boolean;
  snapshots: SnapshotOption[];
  apiKeys: ApiKeyRow[];
  /**
   * Offline copy: every card here is a form (server actions), so instead of
   * rendering them disabled the view becomes a plain-text statement of the
   * plan's settings. Roll-forward, snapshot restore and API keys are hidden.
   */
  offline?: boolean;
};

const MARGIN_LABELS: Record<string, string> = {
  margin_fp: 'Margin per kg FP',
  margin_wr: 'Margin per kg WR',
  total_contribution: 'Total contribution',
};
const ALLOC_LABELS: Record<string, string> = {
  fill_what_you_can: 'Fill what you can',
  all_or_nothing: 'All-or-nothing',
};
const SCOPE_LABELS: Record<string, string> = {
  active: 'Active only',
  active_pipeline: 'Active + Pipeline',
};

export function SettingsView({ plan, isAdmin, snapshots, apiKeys, offline }: SettingsViewProps) {
  if (offline) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Plan Settings</h1>
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Read-only — this is the saved copy of the plan&apos;s settings. Changing settings, rolling the plan
          forward, restoring a snapshot and managing API keys all need a connection.
        </p>
        <div className="rounded-lg border bg-card p-5 text-sm">
          <dl className="space-y-2">
            <SettingRow k="Margin metric" v={MARGIN_LABELS[plan.settings_margin_metric] ?? plan.settings_margin_metric} />
            <SettingRow k="Allocation mode" v={ALLOC_LABELS[plan.settings_allocation_mode] ?? plan.settings_allocation_mode} />
            <SettingRow k="Scope" v={SCOPE_LABELS[plan.settings_scope] ?? plan.settings_scope} />
            <SettingRow
              k="Lookback months (borrowing)"
              v={plan.settings_lookback_months === 0 ? '0 — no borrowing' : String(plan.settings_lookback_months)}
            />
            <SettingRow k="Plan start month (M1)" v={plan.plan_start_date.slice(0, 7)} />
            {plan.type === 'master' && (
              <SettingRow k="Financial years offered when creating a plan" v={String(plan.settings_plan_years_ahead ?? 10)} />
            )}
          </dl>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SettingsForm plan={plan} canEdit={isAdmin} />
      {isAdmin && !plan.is_locked && (
        <>
          <RollForwardCard
            planId={plan.id}
            planName={plan.name}
            planStartDate={plan.plan_start_date}
            horizon={plan.horizon_months}
          />
          <RestoreSnapshotCard
            planId={plan.id}
            planName={plan.name}
            planStartDate={plan.plan_start_date}
            horizon={plan.horizon_months}
            snapshots={snapshots}
          />
        </>
      )}
      {isAdmin && <ApiKeysCard keys={apiKeys} />}
    </div>
  );
}

function SettingRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-1.5 last:border-b-0 last:pb-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
