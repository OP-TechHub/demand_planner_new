'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recompute } from './recompute';

export function RecalculateButton({ planId }: { planId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  function onClick() {
    setMsg(null); setErr(false);
    start(async () => {
      const res = await recompute(planId);
      if (res.error) { setErr(true); setMsg(res.error); }
      else { setMsg(`Recomputed in ${res.ms} ms`); router.refresh(); }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Recalculating…' : 'Recalculate now'}
      </button>
      {msg && <span className={err ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{msg}</span>}
    </div>
  );
}
