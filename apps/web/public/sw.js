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
 *   - The only HTML cached is the two static offline pages, and each is stored
 *     together with every build file it references (see cacheOfflinePages), so
 *     a cached page never asks for a chunk that is not also cached. That keeps
 *     `skipWaiting` safe: a new worker can take over mid-session without the
 *     classic "old shell asks for deleted chunks" ChunkLoadError.
 *
 * Offline Cost Grid: /offline/costing is a static page whose DATA lives in
 * IndexedDB (lib/offline-costing.ts), written by the page itself, per user, and
 * wiped on sign-out. This worker only ever caches that page's HTML and code.
 */

const VERSION = 'v2';
const STATIC_CACHE = `op-static-${VERSION}`;
const SHELL_CACHE = `op-shell-${VERSION}`;
const OFFLINE_URL = '/offline';
const OFFLINE_COSTING_URL = '/offline/costing';
/** The static pages kept for use with no connection. No user data on either. */
const OFFLINE_PAGES = [OFFLINE_URL, OFFLINE_COSTING_URL];

/** Build-file URLs referenced from an HTML page or a stylesheet. */
function assetUrls(text) {
  const found = new Set();
  // Script tags, and chunk paths inside the inlined flight data (which omit /_next/ and may be escaped).
  for (const m of text.matchAll(/(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\\\s)<>]+/g)) {
    found.add(m[0].startsWith('/_next/') ? m[0] : `/_next/${m[0]}`);
  }
  return found;
}

/**
 * Cache the offline pages together with every build file they need, then drop
 * whatever the previous deploy left behind. All-or-nothing: if any fetch
 * fails, the existing copy is kept untouched, so a flaky connection can never
 * leave a page cached without its code.
 */
let caching = null;
function cacheOfflinePages() {
  if (caching) return caching;
  caching = (async () => {
    const entries = new Map();
    const pending = [];
    for (const page of OFFLINE_PAGES) {
      const res = await fetch(new Request(page, { cache: 'reload', credentials: 'same-origin' }));
      if (!res.ok || res.redirected) throw new Error(`${page}: ${res.status}`);
      entries.set(page, res.clone());
      for (const u of assetUrls(await res.text())) pending.push(u);
    }
    const seen = new Set();
    while (pending.length) {
      const url = pending.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      entries.set(url, res.clone());
      // Stylesheets pull in fonts and images of their own.
      if (url.endsWith('.css')) for (const u of assetUrls(await res.text())) pending.push(u);
    }
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all([...entries].map(([url, res]) => cache.put(url, res)));
    const keepPaths = new Set(entries.keys());
    for (const req of await cache.keys()) {
      if (!keepPaths.has(new URL(req.url).pathname)) await cache.delete(req);
    }
  })().finally(() => {
    caching = null;
  });
  return caching;
}

/** Which cached offline page answers a failed navigation to `pathname`. */
function offlinePageFor(pathname) {
  if (pathname === '/costing' || pathname === OFFLINE_COSTING_URL) return OFFLINE_COSTING_URL;
  return OFFLINE_URL;
}

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
      // The offline pages: static, unauthenticated, and no user data on them.
      try {
        await cacheOfflinePages();
      } catch {
        // A missing fallback page must not block activation — the fetch
        // handler synthesises a response if this cache entry isn't there,
        // and the Cost Grid asks for another attempt on its next visit.
      }
      await self.skipWaiting();
    })()
  );
});

// The Cost Grid posts this after saving its offline copy, so the page that
// shows the copy is cached with the code of the build that saved it.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'cache-offline-pages') {
    event.waitUntil(cacheOfflinePages().catch(() => {}));
  }
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
        // Either cache will do: the offline pages keep their own copies of the
        // files they need, out of reach of the static cache's trimming.
        const hit = await caches.match(request);
        if (hit) return hit;
        const cache = await caches.open(STATIC_CACHE);
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
          // Costing falls back to the saved Cost Grid; everything else to the
          // offline screen. Costing is redirected rather than answered in place,
          // so the address bar and Next's router both agree on which page this is;
          // the redirected navigation fails too and lands back here.
          const page = offlinePageFor(url.pathname);
          if (page !== url.pathname && page === OFFLINE_COSTING_URL) {
            const has = await caches.match(page, { cacheName: SHELL_CACHE });
            if (has) return Response.redirect(page, 302);
          }
          const cached =
            (await caches.match(page, { cacheName: SHELL_CACHE })) ??
            (await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE }));
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
