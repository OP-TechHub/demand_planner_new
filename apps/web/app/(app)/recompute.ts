'use server';

import { createClient } from '@/lib/supabase/server';

export type JobState = 'queued' | 'running' | 'done' | 'error' | 'none';
export type RecomputeStatus = { status: JobState; error?: string | null; ms?: number | null };

/**
 * Latest recompute job for a plan, read under RLS. The engine itself now runs as
 * a background job (see app/api/recompute/route.ts) — the UI starts it with a
 * POST and polls this for progress.
 */
export async function getRecomputeStatus(planId: string): Promise<RecomputeStatus> {
  if (!planId) return { status: 'none' };
  const supabase = await createClient();
  const { data } = await supabase
    .from('recompute_jobs')
    .select('status, error, ms')
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { status: 'none' };
  return { status: data.status as JobState, error: data.error, ms: data.ms };
}
