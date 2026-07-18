import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile } from '@/lib/plan';
import { SettingsForm } from './settings-form';
import { RollForwardCard } from './roll-forward';
import { RestoreSnapshotCard, type SnapshotOption } from './restore-snapshot';
import { ApiKeysCard } from './api-keys';
import { listApiKeys } from './api-keys-actions';

export default async function SettingsPage() {
  const plan = await getActivePlan();
  if (!plan) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
        <p className="font-semibold text-warning">No master plan found</p>
        <p className="mt-1 text-warning">
          Run <code className="rounded bg-warning/15 px-1">supabase/seed.sql</code> first.
        </p>
      </div>
    );
  }

  const profile = await getProfile();
  const isAdmin = profile?.role === 'admin';
  const apiKeys = isAdmin ? await listApiKeys() : [];

  // Snapshots are the locked, read-only archives left behind by a roll/restore.
  // Only those with a matching horizon can line up slot-for-slot.
  let snapshots: SnapshotOption[] = [];
  if (isAdmin && !plan.is_locked) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('plans')
      .select('id, name, plan_start_date, horizon_months')
      .eq('is_locked', true)
      .eq('horizon_months', plan.horizon_months)
      .is('deleted_at', null)
      .neq('id', plan.id)
      .order('forked_at', { ascending: false });
    snapshots = (data ?? []).map((s: { id: string; name: string; plan_start_date: string; horizon_months: number }) => ({
      id: s.id,
      name: s.name,
      planStartDate: s.plan_start_date,
      horizon: s.horizon_months,
    }));
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
