import { randomBytes, createHash } from 'node:crypto';

/**
 * API-key helpers for the machine-to-machine read API (/api/v1).
 *
 * A raw key looks like `op_live_<48 hex chars>`. We store only its SHA-256 hash
 * and a short prefix; the raw value is shown once at creation and never again.
 * SHA-256 (not bcrypt) is deliberate: the secret is 192 bits of CSPRNG entropy,
 * so it isn't brute-forceable, and a fast hash keeps per-request verification
 * cheap.
 */

const PREFIX = 'op_live_';

export function generateApiKey(): { raw: string; hash: string; keyPrefix: string } {
  const raw = PREFIX + randomBytes(24).toString('hex'); // 48 hex chars
  return { raw, hash: hashApiKey(raw), keyPrefix: raw.slice(0, PREFIX.length + 6) };
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex');
}

/**
 * Pull the raw key off a request. Accepts either `Authorization: Bearer <key>`
 * or `X-API-Key: <key>` — whichever the caller finds easier. Returns null when
 * neither is present.
 */
export function readApiKeyFromRequest(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const header = req.headers.get('x-api-key');
  return header ? header.trim() : null;
}
