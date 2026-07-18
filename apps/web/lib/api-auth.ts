import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { hashApiKey, readApiKeyFromRequest } from '@/lib/api-keys';

/** A verified caller: the org the key belongs to, and the key row's id. */
export type ApiCaller = { orgId: string; keyId: string; scopes: string[] };

/**
 * Authenticate an /api/v1 request by its API key. Returns the caller's org on
 * success, or a ready-to-return 401 `NextResponse` on failure — the route does
 * `if ('error' in r) return r.error;`.
 *
 * Verification uses the service role because the key lookup spans orgs (RLS is
 * keyed to a logged-in user, and there isn't one here). `last_used_at` is
 * touched best-effort so a revoked-but-active key is easy to spot.
 */
export async function authenticateApiRequest(
  req: Request
): Promise<{ caller: ApiCaller } | { error: NextResponse }> {
  const raw = readApiKeyFromRequest(req);
  if (!raw) return { error: jsonError(401, 'missing_api_key', 'Provide an API key via the Authorization: Bearer header or X-API-Key.') };

  const svc = createServiceClient();
  const { data } = await svc
    .from('api_keys')
    .select('id, org_id, scopes, revoked_at')
    .eq('key_hash', hashApiKey(raw))
    .maybeSingle();

  if (!data) return { error: jsonError(401, 'invalid_api_key', 'This API key is not valid.') };
  if (data.revoked_at) return { error: jsonError(401, 'revoked_api_key', 'This API key has been revoked.') };

  // Fire-and-forget: a failed touch must never fail the request.
  void svc.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);

  return { caller: { orgId: data.org_id, keyId: data.id, scopes: data.scopes ?? ['read'] } };
}

/** A consistent error envelope: { error: { code, message } }. */
export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** A success envelope. `data` is the payload; `meta` carries plan/window context. */
export function jsonOk(data: unknown, meta?: Record<string, unknown>): NextResponse {
  return NextResponse.json(meta ? { data, meta } : { data });
}
