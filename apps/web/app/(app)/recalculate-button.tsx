'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { getRecomputeStatus } from './recompute';

const POLL_MS = 1500;
const GIVE_UP_MS = 5 * 60 * 1000;

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
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const poll = useCallback(
    (announce: boolean) => {
      const startedAt = Date.now();
      const tick = async () => {
        if (stopped.current) return;
        const s = await getRecomputeStatus(planId);
        if (stopped.current) return;

        if (s.status === 'done') {
          setRunning(false);
          if (announce) toast.success(`Recomputed in ${s.ms ?? '—'} ms`);
          router.refresh();
          return;
        }
        if (s.status === 'error') {
          setRunning(false);
          toast.error(s.error ?? 'Recompute failed.');
          return;
        }
        if (Date.now() - startedAt > GIVE_UP_MS) {
          setRunning(false);
          toast.error('Recompute is taking unusually long — check back shortly.');
          return;
        }
        timer.current = setTimeout(tick, POLL_MS);
      };
      timer.current = setTimeout(tick, POLL_MS);
    },
    [planId, router]
  );

  // If a run is already in flight (e.g. someone else started it, or we navigated
  // away and back), show it and follow along.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getRecomputeStatus(planId);
      if (cancelled || (s.status !== 'queued' && s.status !== 'running')) return;
      setRunning(true);
      poll(false);
    })();
    return () => { cancelled = true; };
  }, [planId, poll]);

  async function onClick() {
    setRunning(true);
    try {
      const res = await fetch('/api/recompute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunning(false);
        toast.error(body?.error ?? 'Could not start the recompute.');
        return;
      }
      toast.info(body?.alreadyRunning ? 'A recompute is already running…' : 'Recalculating in the background…');
      poll(true);
    } catch {
      setRunning(false);
      toast.error('Could not start the recompute.');
    }
  }

  return (
    <Button onClick={onClick} disabled={running} size={size} variant={variant}>
      <RefreshCw className={cn(running && 'animate-spin')} />
      {running ? 'Recalculating…' : label}
    </Button>
  );
}
