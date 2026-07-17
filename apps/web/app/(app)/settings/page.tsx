import { getActivePlan, getProfile } from '@/lib/plan';
import { SettingsForm } from './settings-form';

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

  return <SettingsForm plan={plan} canEdit={profile?.role === 'admin'} />;
}
