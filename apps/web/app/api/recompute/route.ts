import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runRecompute } from '@/lib/recompute-core';

// The engine can churn for a while on a big plan; give it room. (Capped by the
// Vercel plan's limit — it simply runs up to whatever is allowed.)
export const maxDuration = 300;

/**
 * Kick off a recompute as a BACKGROUND job.
 *
 * The response returns as soon as the job row exists, so the request never
 * blocks on the engine. `waitUntil` keeps the function alive to finish the work
 * after the response is sent, so it also survives the user navigating away.
 * The UI polls `recompute_jobs` for status.
 */
export async function POST(req: Request) {
  const { planId } = (await req.json().catch(() => ({}))) as { planId?: string };
  if (!planId) return NextResponse.json({ error: 'Missing plan.' }, { status: 400 });

  // Authorization gate: the caller must be able to read this plan under RLS.
  const rls = await createClient();
  const { data: { user } } = await rls.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Your session expired. Sign in again.' }, { status: 401 });
  const { data: allowed } = await rls.from('plans').select('id, org_id').eq('id', planId).maybeSingle();
  if (!allowed) return NextResponse.json({ error: 'Plan not found or not accessible.' }, { status: 403 });

  const svc = createServiceClient();

  // Don't stack duplicate runs for the same plan.
  const { data: inflight } = await svc
    .from('recompute_jobs')
    .select('id')
    .eq('plan_id', planId)
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle();
  if (inflight) return NextResponse.json({ jobId: inflight.id, alreadyRunning: true }, { status: 202 });

  const { data: job, error: jobErr } = await svc
    .from('recompute_jobs')
    .insert({ plan_id: planId, org_id: allowed.org_id, requested_by: user.id, status: 'running' })
    .select('id')
    .maybeSingle();
  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? 'Could not queue the recompute.' }, { status: 500 });
  }

  const work = (async () => {
    try {
      const { ms } = await runRecompute(planId);
      await svc
        .from('recompute_jobs')
        .update({ status: 'done', ms, finished_at: new Date().toISOString() })
        .eq('id', job.id);
    } catch (e) {
      await svc
        .from('recompute_jobs')
        .update({
          status: 'error',
          error: e instanceof Error ? e.message : 'Recompute failed.',
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }
  })();

  // On Vercel this keeps the function alive to finish after the response is sent.
  // Outside Vercel (local dev) waitUntil isn't available, so just await the work —
  // the client polls either way, so the behaviour is the same, only slower to respond.
  try {
    waitUntil(work);
  } catch {
    await work;
  }

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
