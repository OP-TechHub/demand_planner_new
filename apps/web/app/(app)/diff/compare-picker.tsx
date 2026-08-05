'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

export type PickPlan = { id: string; name: string; label: string };

/** Two plan selectors that drive the comparison via ?a=&b= query params. */
export function ComparePicker({ plans, a, b }: { plans: PickPlan[]; a: string; b: string }) {
  const router = useRouter();
  const set = (key: 'a' | 'b', val: string) => {
    const nextA = key === 'a' ? val : a;
    const nextB = key === 'b' ? val : b;
    router.push(`/diff?a=${nextA}&b=${nextB}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Plan A</span>
        <select value={a} onChange={(e) => set('a', e.target.value)} className={sel}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.label}</option>)}
        </select>
      </label>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
      <label className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Plan B</span>
        <select value={b} onChange={(e) => set('b', e.target.value)} className={sel}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.label}</option>)}
        </select>
      </label>
    </div>
  );
}

const sel = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
