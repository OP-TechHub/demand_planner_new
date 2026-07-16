import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile } from '@/lib/plan';
import { canEditSection, type Bucket, type Program, type UserRole } from '@oceanpick/shared';
import { ProgramsClient } from './programs-client';

export default async function ProgramsPage() {
  const plan = await getActivePlan();
  if (!plan) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
        <p className="font-semibold text-warning">No master plan found</p>
        <p className="mt-1 text-warning">
          Run <code className="rounded bg-warning/15 px-1">supabase/seed.sql</code> before adding programs.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: programs }, { data: buckets }, profile] = await Promise.all([
    supabase.from('programs').select('*').eq('plan_id', plan.id).is('deleted_at', null).order('sort_order'),
    supabase.from('buckets').select('*').order('sort_order'),
    getProfile(),
  ]);

  const canEdit = canEditSection((profile?.role ?? 'viewer') as UserRole, profile?.edit_sections, 'programs');

  return (
    <ProgramsClient
      planId={plan.id}
      programs={(programs ?? []) as Program[]}
      buckets={(buckets ?? []) as Bucket[]}
      canEdit={canEdit}
    />
  );
}
