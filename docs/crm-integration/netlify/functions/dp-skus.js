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
//   DP_ALLOWED_ROLES   optional, comma-separated. Default: admin,sales
//
// Callers must hold a CRM session cookie — see crm-auth.js. The page sends it
// automatically, but only if the fetch asks for it:
//   fetch('/.netlify/functions/dp-skus?customer=Acme', { credentials: 'same-origin' })

const { requireSession, json } = require('./lib/session');

/** Roles permitted to see cost and margin. Not everyone with a login should. */
const DEFAULT_ROLES = ['admin', 'sales'];

// Only these reach the planner. An allowlist rather than a passthrough, so the
// CRM can never be talked into calling a different endpoint.
const ALLOWED = ['market', 'destination', 'customer', 'q', 'status', 'bucket', 'version'];

exports.handler = async (event) => {
  const base = process.env.DP_API_BASE;
  const key = process.env.DP_API_KEY;
  if (!base || !key) {
    return json(500, 'not_configured', 'DP_API_BASE and DP_API_KEY must be set in the Netlify environment.');
  }

  // Before anything else. A Netlify function is a public URL: without this,
  // /.netlify/functions/dp-skus would hand the org's costs and margins to
  // anyone who typed it, never having met the CRM's login page.
  const roles = (process.env.DP_ALLOWED_ROLES || '').split(',').map((r) => r.trim()).filter(Boolean);
  const auth = requireSession(event, roles.length ? roles : DEFAULT_ROLES);
  if (auth.error) return auth.error;

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
    return json(502, 'planner_unreachable', 'Could not reach the demand planner.');
  }
};
