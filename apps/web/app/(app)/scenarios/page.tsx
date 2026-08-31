import { getActivePlan, getSelectablePlans, getProfile } from '@/lib/plan';
import { can, type UserRole } from '@oceanpick/shared';
import { ScenariosClient, type ForkSource } from './scenarios-client';

export default async function ScenariosPage() {
  const [plans, active, profile] = await Promise.all([getSelectablePlans(), getActivePlan(), getProfile()]);
  // Only the user's private sandboxes here — official plans (is_sandbox = false)
  // live under Admin → Plans, even though they share the 'scenario' type.
  const scenarios = plans
    .filter((p) => p.type === 'scenario' && p.is_sandbox)
    .map((p) => ({ id: p.id, name: p.name, description: p.description, forked_at: p.forked_at }));

  const master = plans.find((p) => p.type === 'master') ?? null;

  const canCreate = can.createScenario((profile?.role ?? 'viewer') as UserRole);

  /**
   * What a new scenario may be forked from — and what a new plan may be based on:
   * any plan the whole org works on, plus the caller's own sandboxes.
   *
   * Deliberately excludes OTHER people's sandboxes even though an admin's RLS
   * lets them read those — someone's private draft is not a base anyone else
   * should be building quotes on. `getSelectablePlans` already hides them from
   * everyone but admins, so this filter only bites for admins.
   */
  const forkSources: ForkSource[] = plans
    .filter((p) => !p.is_sandbox || p.owner_user_id === profile?.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.type === 'master' ? 'master' : p.is_sandbox ? 'mine' : 'official',
      isLive: p.is_live,
      horizonMonths: p.horizon_months,
      planStartDate: p.plan_start_date,
    }));

  return (
    <ScenariosClient
      scenarios={scenarios}
      activeId={active?.id ?? ''}
      hasMaster={!!master}
      canCreate={canCreate}
      yearsAhead={master?.settings_plan_years_ahead ?? 10}
      forkSources={forkSources}
    />
  );
}
