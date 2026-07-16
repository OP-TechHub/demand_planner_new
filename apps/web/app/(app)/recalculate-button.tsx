'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
      <Button onClick={onClick} disabled={pending}>
        <RefreshCw className={cn(pending && 'animate-spin')} />
        {pending ? 'Recalculating…' : 'Recalculate now'}
      </Button>
      {msg && <span className={err ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{msg}</span>}
    </div>
  );
}
