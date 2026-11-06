import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile } from '@/lib/plan';
import { type SnapshotOption } from './restore-snapshot';
import { listApiKeys, type ApiKeyRow } from './api-keys-actions';
import { OfflineCopy } from '@/components/pwa/offline-copy';
import { SettingsView } from './settings-view';

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

  // The offline snapshot deliberately carries NO API key material — not even
  // labels or prefixes — so nothing about the keys is re-rendered from a
  // device copy. The real list is passed only to the online render below.
  const props = { plan, isAdmin, snapshots, apiKeys: [] as ApiKeyRow[] };
  return (
    <OfflineCopy route="settings" props={props}>
      <SettingsView {...props} apiKeys={apiKeys} />
    </OfflineCopy>
  );
}
