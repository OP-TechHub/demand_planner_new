'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setActivePlan } from './plan-actions';

export function ScenarioBanner({ name, masterId }: { name: string; masterId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-6 py-1.5 text-sm text-amber-900">
      <span>📎 Viewing scenario: <span className="font-medium">{name}</span> — edits here don&apos;t affect the master plan.</span>
      <div className="flex items-center gap-2">
        <Link href="/diff" className="rounded-md border border-amber-300 px-2 py-0.5 text-xs hover:bg-amber-100">
          Compare to master
        </Link>
        <button
          onClick={() => start(async () => { await setActivePlan(masterId); router.refresh(); })}
          disabled={pending}
          className="rounded-md border border-amber-300 px-2 py-0.5 text-xs hover:bg-amber-100 disabled:opacity-50"
        >
          Switch to Master
        </button>
      </div>
    </div>
  );
}
