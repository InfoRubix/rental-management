/* Rental Management service worker.
 *
 * Built by vite.config.ts (plugin "rental-management-pwa"), which fills in BUILD_ID and PRECACHE.
 *
 * Rules:
 *  - Only this site's own static files are cached (built JS/CSS, icons, manifest, the app shell).
 *  - /api/* and every other site (Google sign-in, Firebase) are NEVER handled here: they always go
 *    straight to the network, so private data, sign-in tokens and borrowing records are never stored
 *    by the service worker, and nothing can be "saved" while offline.
 *  - Page navigations are network-first; offline they fall back to the cached app shell, which shows
 *    an offline message instead of stale data.
 *  - A new version waits until the user taps "Update" (no forced reloads that lose unsaved forms).
 */
const BUILD_ID = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;
const PREFIX = 'rm-static-';
const CACHE = PREFIX + BUILD_ID;
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' bypasses the HTTP cache so the shell matches this build.
      cache.addAll([SHELL, ...PRECACHE].map((u) => new Request(u, { cache: 'reload' }))),
    ),
  );
  // No skipWaiting() here: the page asks for it when the user agrees to update.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove caches from older versions of this app only (never touch anything else).
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isPrivate(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes always go to the network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google sign-in, Firebase, other sites: untouched
  if (isPrivate(url)) return; // API: untouched, never cached

  // Page loads (including deep links like /item/abc or /admin/requests/xyz): network first.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Keep the latest app shell for offline use (every route serves the same index.html).
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SHELL, copy));
          }
          return res;
        } catch {
          const cached = await caches.match(SHELL, { cacheName: CACHE });
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Built files and icons: cache first (their names change with every build, so they never go stale).
  const cacheable = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || PRECACHE.includes(url.pathname);
  if (!cacheable) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })(),
  );
});
