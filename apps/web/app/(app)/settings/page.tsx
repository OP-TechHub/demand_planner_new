import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { can, type UserRole } from '@oceanpick/shared';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const plan = await getActivePlan();
  if (!plan) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm">
        <p className="font-semibold text-amber-900">No master plan found</p>
        <p className="mt-1 text-amber-800">
          Run <code className="rounded bg-amber-100 px-1">supabase/seed.sql</code> first.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('users').select('role').eq('id', user!.id).maybeSingle();

  return <SettingsForm plan={plan} canEdit={can.editMaster((me?.role ?? 'viewer') as UserRole)} />;
}
