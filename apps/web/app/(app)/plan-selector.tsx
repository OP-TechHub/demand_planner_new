'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setActivePlan } from './plan-actions';

export interface PlanOption { id: string; name: string; type: string }

export function PlanSelector({ plans, activeId }: { plans: PlanOption[]; activeId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    start(async () => { await setActivePlan(id); router.refresh(); });
  }

  return (
    <select
      value={activeId}
      onChange={onChange}
      disabled={pending}
      className="rounded-md border bg-card px-2 py-0.5 text-xs outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      aria-label="Active plan"
    >
      {plans.map((p) => (
        <option key={p.id} value={p.id}>{p.type === 'master' ? 'Master Plan' : p.name}</option>
      ))}
    </select>
  );
}
