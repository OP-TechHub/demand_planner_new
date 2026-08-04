import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getSelectablePlans, getProfile } from '@/lib/plan';
import { can, type UserRole } from '@oceanpick/shared';
import { ScenariosClient, type PickProgram } from './scenarios-client';

export default async function ScenariosPage() {
  const [plans, active] = await Promise.all([getSelectablePlans(), getActivePlan()]);
  // Only the user's private sandboxes here — official plans (is_sandbox = false)
  // live under Admin → Plans, even though they share the 'scenario' type.
  const scenarios = plans
    .filter((p) => p.type === 'scenario' && p.is_sandbox)
    .map((p) => ({ id: p.id, name: p.name, description: p.description, forked_at: p.forked_at }));

  const master = plans.find((p) => p.type === 'master') ?? null;

  const profile = await getProfile();
  const canCreate = can.createScenario((profile?.role ?? 'viewer') as UserRole);

  let programs: PickProgram[] = [];
  if (master) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('programs')
      .select('id, item_code, item_description, customer')
      .eq('plan_id', master.id)
      .is('deleted_at', null)
      .order('sort_order');
    programs = (data ?? []) as PickProgram[];
  }

  return (
    <ScenariosClient
      scenarios={scenarios}
      activeId={active?.id ?? ''}
      hasMaster={!!master}
      canCreate={canCreate}
      yearsAhead={master?.settings_plan_years_ahead ?? 10}
      programs={programs}
    />
  );
}
