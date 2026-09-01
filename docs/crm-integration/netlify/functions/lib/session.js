// Shared session helpers for the CRM's Netlify functions.
//
// Lives in `lib/` so Netlify does not publish it as a function of its own — a
// directory only becomes a function when it holds an index.js or a file
// matching the directory name.
//
// Uses only Node's built-in `crypto`. No npm dependency, so this drops into a
// hand-coded CRM without a build step or a package.json change.
//
// WHAT THIS REPLACES
// A password compared in browser JavaScript can be read by anyone who opens
// devtools, and — more importantly — it guards only the page. Netlify function
// URLs are public and never load that page, so they are reachable straight from
// the address bar. Here the password is checked SERVER-side, and the browser is
// handed a signed cookie it cannot read or forge. Every sensitive function then
// verifies that cookie instead of trusting the page.

const crypto = require('crypto');

const COOKIE_NAME = 'crm_session';
/** 12 hours: a working day, so nobody is logged out mid-call. */
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

// --- token -----------------------------------------------------------------

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const unb64url = (s) => Buffer.from(s, 'base64url');

/**
 * Sign a session payload. Format is `<base64url(json)>.<base64url(hmac)>` — a
 * minimal JWT, deliberately hand-rolled to avoid pulling in a library for
 * fifteen lines of HMAC.
 *
 * The payload is readable by anyone holding the cookie (it is signed, not
 * encrypted), so put identity in it and nothing secret.
 */
function signSession(payload, secret, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64url(JSON.stringify(body));
  const mac = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${b64url(mac)}`;
}

/**
 * Verify a session token. Returns the payload, or null for anything wrong:
 * malformed, tampered with, or expired. Never throws — a bad cookie is an
 * ordinary event, not an error.
 */
function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;

  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const data = token.slice(0, dot);
  const given = unb64url(token.slice(dot + 1));
  const want = crypto.createHmac('sha256', secret).update(data).digest();

  // timingSafeEqual throws on a length mismatch, so check length first.
  if (given.length !== want.length) return null;
  if (!crypto.timingSafeEqual(given, want)) return null;

  let payload;
  try {
    payload = JSON.parse(unb64url(data).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

// --- cookies ---------------------------------------------------------------

/** Read one cookie off a Netlify event. Header case varies by runtime. */
function readCookie(event, name = COOKIE_NAME) {
  const headers = event.headers || {};
  const raw = headers.cookie || headers.Cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * The Set-Cookie value for a fresh session.
 *
 *   HttpOnly — page JavaScript cannot read it, so an XSS bug cannot steal it.
 *   Secure   — HTTPS only.
 *   SameSite=Lax — not sent on cross-site requests, which blocks CSRF for the
 *                  GET endpoints here without needing a separate token.
 */
function sessionCookie(token, ttlSeconds = DEFAULT_TTL_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
}

/** The Set-Cookie value that logs someone out. */
function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// --- passwords -------------------------------------------------------------

/**
 * Hash a password with scrypt (built into Node — no dependency).
 *
 * Stored form: `scrypt$<saltHex>$<hashHex>`. Each password gets its own random
 * salt, so two people choosing the same password do not produce the same hash,
 * and a stolen list cannot be attacked with a precomputed table.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time password check against a stored `scrypt$salt$hash` string. */
function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  let salt, want;
  try {
    salt = Buffer.from(parts[1], 'hex');
    want = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || want.length === 0) return false;

  const got = crypto.scryptSync(password, salt, want.length);
  return crypto.timingSafeEqual(got, want);
}

// --- guard -----------------------------------------------------------------

/**
 * The check every sensitive function runs first.
 *
 * Returns `{ user }` when the caller holds a valid session, or `{ error }` — a
 * ready-to-return response — when they do not. Fails CLOSED: a missing
 * CRM_SESSION_SECRET refuses rather than waving callers through, because a
 * misconfigured deploy must not become an open door.
 *
 * `allowedRoles` is optional; omit it to accept any signed-in user.
 */
function requireSession(event, allowedRoles) {
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret) {
    return { error: json(500, 'not_configured', 'CRM_SESSION_SECRET is not set in the Netlify environment.') };
  }

  const user = verifySession(readCookie(event), secret);
  if (!user) {
    return { error: json(401, 'unauthorized', 'Sign in to continue.') };
  }

  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(user.role)) {
    // 403, not 404: they are who they say, they just may not see this.
    return { error: json(403, 'forbidden', 'Your role does not have access to this data.') };
  }

  return { user };
}

function json(statusCode, code, message, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify({ error: { code, message } }),
  };
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  signSession,
  verifySession,
  readCookie,
  sessionCookie,
  clearCookie,
  hashPassword,
  verifyPassword,
  requireSession,
  json,
};
