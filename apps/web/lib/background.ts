import { waitUntil } from '@vercel/functions';

/**
 * Run best-effort work after the response goes out, so a server action is not
 * held up by an email send. On Vercel, waitUntil keeps the function alive for
 * it; elsewhere waitUntil is a no-op that would leave the promise dangling, so
 * the work is awaited instead. Failures are logged, never thrown.
 */
export async function runInBackground(work: Promise<unknown>, label = 'background task'): Promise<void> {
  const guarded = work.then(
    () => undefined,
    (e) => console.error(`${label} failed:`, e)
  );
  if (process.env.VERCEL) {
    waitUntil(guarded);
    return;
  }
  await guarded;
}
