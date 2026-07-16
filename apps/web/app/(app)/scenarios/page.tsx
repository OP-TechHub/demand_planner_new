import { getActivePlan, getSelectablePlans } from '@/lib/plan';
import { ScenariosClient } from './scenarios-client';

export default async function ScenariosPage() {
  const [plans, active] = await Promise.all([getSelectablePlans(), getActivePlan()]);
  const scenarios = plans
    .filter((p) => p.type === 'scenario')
    .map((p) => ({ id: p.id, name: p.name, description: p.description, forked_at: p.forked_at }));

  return (
    <ScenariosClient
      scenarios={scenarios}
      activeId={active?.id ?? ''}
      hasMaster={plans.some((p) => p.type === 'master')}
    />
  );
}
