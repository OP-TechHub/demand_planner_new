'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Plan } from '@oceanpick/shared';
import { updateSettings, type SettingsFormState } from './actions';

const initial: SettingsFormState = { error: null, ok: false };

export function SettingsForm({ plan, canEdit }: { plan: Plan; canEdit: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateSettings, initial);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state.ok) {
      setSaved(true);
      router.refresh();
      const t = setTimeout(() => setSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state.ok, router]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Plan Settings</h1>

      {!canEdit && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Read-only — only admins and planners can change plan settings.
        </p>
      )}

      <form action={formAction} className="space-y-6 rounded-lg border bg-card p-5 text-sm">
        <input type="hidden" name="plan_id" value={plan.id} />
        <fieldset disabled={!canEdit} className="space-y-6">
          <RadioGroup
            label="Margin metric"
            name="settings_margin_metric"
            value={plan.settings_margin_metric}
            options={[
              ['margin_fp', 'Margin per kg FP'],
              ['margin_wr', 'Margin per kg WR'],
              ['total_contribution', 'Total contribution'],
            ]}
          />
          <RadioGroup
            label="Allocation mode"
            name="settings_allocation_mode"
            value={plan.settings_allocation_mode}
            options={[
              ['fill_what_you_can', 'Fill what you can'],
              ['all_or_nothing', 'All-or-nothing'],
            ]}
          />
          <RadioGroup
            label="Scope"
            name="settings_scope"
            value={plan.settings_scope}
            options={[
              ['active', 'Active only'],
              ['active_pipeline', 'Active + Pipeline'],
            ]}
          />

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Lookback months (borrowing)</span>
              <select name="settings_lookback_months" defaultValue={String(plan.settings_lookback_months)} className={inputCls}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Plan start month (M1)</span>
              <input type="month" name="plan_start_month" defaultValue={plan.plan_start_date.slice(0, 7)} className={inputCls} />
            </label>
          </div>

          {plan.type === 'master' && (
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Financial years offered when creating a plan</span>
              <input
                type="number"
                name="settings_plan_years_ahead"
                min={1}
                max={30}
                defaultValue={String(plan.settings_plan_years_ahead ?? 10)}
                className={inputCls}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                How far ahead the “New Plan” financial-year dropdown reaches (1–30 years).
              </span>
            </label>
          )}

          {state.error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{state.error}</p>}

          {canEdit && (
            <div className="flex items-center gap-3">
              <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {pending ? 'Saving…' : 'Save changes'}
              </button>
              {saved && <span className="text-sm text-success">Saved.</span>}
              <span className="text-xs text-muted-foreground">Recompute runs on save once the calc engine ships (Phase 2).</span>
            </div>
          )}
        </fieldset>
      </form>
    </div>
  );
}

const inputCls = 'mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';

function RadioGroup({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: [string, string][];
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="space-y-1">
        {options.map(([val, text]) => (
          <label key={val} className="flex items-center gap-2">
            <input type="radio" name={name} value={val} defaultChecked={value === val} />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
