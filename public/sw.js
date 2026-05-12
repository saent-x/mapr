/**
 * MAPR Service Worker — offline caching for PWA support.
 *
 * Strategies:
 *  • App shell (HTML, JS, CSS, assets): Cache-first, falling back to network.
 *  • API calls (/api/*): Network-first, falling back to cached responses.
 *  • Map tiles: Stale-while-revalidate (allow offline map viewing).
 *
 * On install: pre-caches the app shell entry point.
 * On activate: cleans old caches.
 */

// `__CACHE_VERSION__` is replaced at build time by the swCacheVersion plugin
// in vite.config.js. The fallback string lets dev mode load this file without
// a build step (dev SW is unregistered on load anyway).
const CACHE_VERSION = '__CACHE_VERSION__'.startsWith('__') ? 'mapr-dev' : '__CACHE_VERSION__';
const APP_SHELL_CACHE = `mapr-shell-${CACHE_VERSION}`;
const API_CACHE = `mapr-api-${CACHE_VERSION}`;
const TILE_CACHE = `mapr-tiles-${CACHE_VERSION}`;

// Assets to pre-cache on install — the bare minimum for the app shell.
const PRE_CACHE_URLS = ['/', '/index.html'];

/* ── Install: pre-cache app shell ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return cache.addAll(PRE_CACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-cache failed for some URLs:', err.message);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('mapr-') && key !== APP_SHELL_CACHE && key !== API_CACHE && key !== TILE_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Allow the page to ask a waiting SW to activate immediately.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── Fetch: route by request type ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip non-http(s) requests (e.g., chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // Server-sent event streams must stay outside the service worker. They are
  // long-lived responses and cannot be safely cached or replayed.
  if (url.pathname === '/api/stream' || request.headers.get('accept')?.includes('text/event-stream')) {
    return;
  }

  // Admin and Stripe API responses must NEVER hit the cache: they contain
  // privileged or per-user data that must not survive a logout or replay
  // from devtools by another user on the same browser profile.
  if (
    url.pathname.startsWith('/api/admin') ||
    url.pathname.startsWith('/api/stripe') ||
    url.pathname === '/api/me' ||
    url.pathname.startsWith('/api/source-catalog')
  ) {
    return;
  }

  // API calls: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Map tiles (cartocdn, basemaps): stale-while-revalidate
  if (
    url.hostname.includes('basemaps.cartocdn.com') ||
    url.hostname.includes('tile.openstreetmap.org')
  ) {
    event.respondWith(staleWhileRevalidate(request, TILE_CACHE));
    return;
  }

  // Same-origin navigation requests (top-level HTML): network-first so a
  // freshly deployed shell is delivered without a hard refresh. Falls back
  // to cached /index.html for offline.
  if (url.origin === self.location.origin && request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_SHELL_CACHE));
    return;
  }

  // Same-origin static assets (hashed JS/CSS/images): cache-first is safe
  // because the filename embeds a content hash — a new build produces a
  // new URL. The activate handler purges old shell caches by version.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
    return;
  }

  // External assets (fonts, CDN JS): network-first
  event.respondWith(networkFirst(request, APP_SHELL_CACHE));
});

/* ── Strategy: Cache-first (check cache, fall back to network) ── */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline and not cached — return a simple offline page for navigation requests
    if (request.mode === 'navigate') {
      const offlineCache = await caches.match('/index.html');
      if (offlineCache) return offlineCache;
    }
    throw err;
  }
}

/* ── Strategy: Network-first (try network, fall back to cache) ── */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

/* ── Strategy: Stale-while-revalidate (return cache, update in background) ── */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}
