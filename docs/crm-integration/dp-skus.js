// Netlify function for the CRM — read-only SKU pricing from the demand planner.
//
// COPY THIS INTO THE CRM REPO at netlify/functions/dp-skus.js.
//
// Why a function and not fetch() straight from the CRM's HTML:
//   1. The API key cannot live in client-side code. Anything in the browser
//      bundle is readable by anyone who opens devtools, and this key grants
//      read access to the whole org's costing.
//   2. No CORS to configure — this is server-to-server.
//
// Environment variables (Netlify -> Site settings -> Environment):
//   DP_API_BASE        https://<your-planner>.vercel.app
//   DP_API_KEY         op_live_...   (mint in the planner: Settings -> API keys)
//   CRM_SHARED_SECRET  optional — see "Who may call this" below
//
// Usage from the CRM page:
//   fetch('/.netlify/functions/dp-skus?customer=Acme&market=export')
//   fetch('/.netlify/functions/dp-skus?id=<sku-uuid>')

// Only these reach the planner. An allowlist rather than a passthrough, so the
// CRM can never be talked into calling a different endpoint.
const ALLOWED = ['market', 'destination', 'customer', 'q', 'status', 'bucket', 'version'];

exports.handler = async (event, context) => {
  const base = process.env.DP_API_BASE;
  const key = process.env.DP_API_KEY;
  if (!base || !key) {
    return json(500, { error: { code: 'not_configured', message: 'DP_API_BASE and DP_API_KEY must be set in the Netlify environment.' } });
  }

  const denied = checkCaller(event, context);
  if (denied) return denied;

  const params = event.queryStringParameters || {};

  // `id` selects the single-SKU endpoint; everything else filters the list.
  const id = (params.id || '').trim();
  const path = id ? `/api/v1/costing/skus/${encodeURIComponent(id)}` : '/api/v1/costing/skus';

  const qs = new URLSearchParams();
  for (const k of ALLOWED) if (params[k]) qs.set(k, params[k]);

  const url = `${base.replace(/\/$/, '')}${path}${qs.toString() ? `?${qs}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    const body = await res.text();

    // Pass the planner's status and body through unchanged: its error envelope
    // is { error: { code, message } }, and the CRM should see the real reason
    // rather than a generic failure invented here.
    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        // `private`, not `public`: prices move only when an assumptions version
        // changes, so a short cache spares the planner a request per lead view,
        // but cost data must not sit in a shared CDN cache.
        'Cache-Control': 'private, max-age=60',
      },
      body,
    };
  } catch (err) {
    // A network failure must not surface the key or the internal URL.
    console.error('dp-skus: request to the demand planner failed', err);
    return json(502, { error: { code: 'planner_unreachable', message: 'Could not reach the demand planner.' } });
  }
};

/**
 * Who may call this.
 *
 * A Netlify function is PUBLIC by default: anyone who knows
 * /.netlify/functions/dp-skus gets your entire costing table, margins included.
 * So this fails CLOSED — if neither check below is available it refuses, rather
 * than quietly serving cost data to the internet.
 *
 * Two ways to satisfy it; use whichever matches how the CRM logs people in:
 *
 *  a) Netlify Identity — the logged-in user arrives on context.clientContext.
 *     The CRM must send the Identity JWT:
 *       fetch(url, { headers: { Authorization: 'Bearer ' + user.token.access_token } })
 *
 *  b) Shared secret — set CRM_SHARED_SECRET in the Netlify environment and have
 *     the CRM send it as the X-CRM-Secret header. Only acceptable if that header
 *     is added somewhere the browser cannot read (an edge function or a proxy);
 *     putting the secret in page JS just moves the open door.
 *
 * Returns a ready-to-return response when the caller is refused, else null.
 */
function checkCaller(event, context) {
  const user = context && context.clientContext && context.clientContext.user;
  if (user) return null;

  const expected = process.env.CRM_SHARED_SECRET;
  if (expected) {
    const headers = event.headers || {};
    const got = headers['x-crm-secret'] || headers['X-CRM-Secret'];
    // Length-first compare so a wrong-length guess exits before the loop.
    if (got && got.length === expected.length && timingSafeEqual(got, expected)) return null;
    return json(401, { error: { code: 'unauthorized', message: 'Missing or invalid credentials.' } });
  }

  return json(401, {
    error: {
      code: 'auth_not_configured',
      message:
        'This function refuses to serve costing data without authentication. ' +
        'Either send a Netlify Identity token, or set CRM_SHARED_SECRET and send the X-CRM-Secret header.',
    },
  });
}

/** Constant-time compare, so a wrong secret cannot be found byte by byte. */
function timingSafeEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
