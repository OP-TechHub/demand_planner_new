'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { recompute } from './recompute';

export function RecalculateButton({
  planId,
  label = 'Recalculate now',
  size = 'md',
  variant = 'default',
}: {
  planId: string;
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'default' | 'outline';
}) {
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
    <Button onClick={onClick} disabled={pending} size={size} variant={variant}>
      <RefreshCw className={cn(pending && 'animate-spin')} />
      {pending ? 'Recalculating…' : label}
    </Button>
  );
}
