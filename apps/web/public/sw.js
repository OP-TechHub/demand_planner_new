/*
 * Service worker — deliberately minimal.
 *
 * The planner is not an offline app: every page is a server component that
 * reads Supabase with the user's cookie, so there is no meaningful page HTML to
 * cache and no attempt is made to. This worker exists to do two things:
 *
 *   1. Provide a fetch handler, which is what makes the app installable and
 *      gets us the desktop install prompt.
 *   2. Serve the immutable, content-hashed build assets from Cache Storage, so
 *      a cold launch of the installed window paints without waiting on the
 *      network. Those URLs are content-addressed, so a cached copy can never be
 *      stale — a new deploy means new URLs.
 *
 * Consequences worth keeping in mind before extending this:
 *
 *   - NOTHING user-specific is ever cached. Responses here are role- and
 *     RLS-scoped per user, and Cache Storage is shared across sessions on the
 *     device, so caching a page would leak one user's data to the next.
 *   - Because no HTML is cached, `skipWaiting` is safe: a new worker can take
 *     over mid-session without the classic "old shell asks for deleted chunks"
 *     ChunkLoadError.
 */

const VERSION = 'v1';
const STATIC_CACHE = `op-static-${VERSION}`;
const SHELL_CACHE = `op-shell-${VERSION}`;
const OFFLINE_URL = '/offline';

/*
 * The build-asset cache is never invalidated by content (hashed URLs are
 * immutable), so it would otherwise grow by one deploy's worth of chunks
 * forever. Cache Storage keys come back in insertion order, so trimming the
 * front evicts the oldest entries.
 */
const STATIC_MAX_ENTRIES = 240;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // The one page we cache: static, unauthenticated, and no user data on it.
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      } catch {
        // A missing fallback page must not block activation — the fetch
        // handler synthesises a response if this cache entry isn't there.
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, SHELL_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('op-') && !keep.has(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/** Drop the oldest entries once the build-asset cache exceeds its cap. */
async function trimStaticCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= STATIC_MAX_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - STATIC_MAX_ENTRIES).map((k) => cache.delete(k)));
}

const OFFLINE_FALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font:14px/1.5 system-ui,sans-serif;background:#fbfdfe;color:#111f2b;padding:24px;text-align:center}
h1{font-size:16px;margin:0 0 8px}p{margin:0;color:#5a6b78}</style></head><body><div>
<h1>You&rsquo;re offline</h1><p>The Demand Planner needs a connection. Reconnect and try again.</p>
</div></body></html>`;

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Server Actions POST to the page's own URL, and the REST API authenticates
  // per request. Neither is ours to touch.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase, fonts, anything not us.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  /*
   * App Router serves the SAME url as either an HTML document or an RSC flight
   * payload, chosen by the RSC request header. A cache keyed on URL alone will
   * happily hand a flight payload to a document request and blank the app, so
   * client-navigation traffic is passed straight through.
   */
  if (request.headers.has('RSC') || url.searchParams.has('_rsc')) return;

  // Immutable build output: cache-first, and populate on miss.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
          // Not awaited: trimming must not delay the response.
          event.waitUntil(trimStaticCache(cache));
        }
        return response;
      })()
    );
    return;
  }

  // Everything else goes to the network. Page navigations get a readable
  // fallback if that fails, because inside a chromeless installed window
  // there's no address bar to explain the browser's own error page.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cached = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
          return (
            cached ??
            new Response(OFFLINE_FALLBACK_HTML, {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })()
    );
  }
});
