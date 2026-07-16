'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { recompute } from './recompute';

export function RecalculateButton({ planId, label = 'Recalculate now' }: { planId: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      const res = await recompute(planId);
      if (res.error) toast.error(res.error);
      else {
        toast.success(`Recomputed in ${res.ms} ms`);
        router.refresh();
      }
    });
  }

  return (
    <Button onClick={onClick} disabled={pending}>
      <RefreshCw className={cn(pending && 'animate-spin')} />
      {pending ? 'Recalculating…' : label}
    </Button>
  );
}
