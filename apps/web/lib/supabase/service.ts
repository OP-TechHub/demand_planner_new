import { createClient } from '@supabase/supabase-js';
import { DB_SCHEMA } from '@oceanpick/shared';

/**
 * Service-role Supabase client. **BYPASSES ROW-LEVEL SECURITY.** Server-only —
 * never import this from a client component, and never expose the key.
 *
 * This is the client the calc engine's recompute uses to write the computed
 * tables (plan_rank, allocations, rolling_results, unallocated_wr, plan_summary),
 * which are read-only to `authenticated` and writable only by `service_role`.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (server env).');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: DB_SCHEMA },
  });
}
