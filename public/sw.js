/* RecipeBox service worker — instant launch + offline app shell.
 * Strategy:
 *  - Precache the app shell + libraries + icons on install.
 *  - Stale-while-revalidate for navigations + static assets: serve from cache
 *    instantly, refresh in the background, apply on next launch.
 *  - Never touch /api/* (network as usual; the app falls back to its local
 *    mirror when offline) and never cache non-GET requests.
 *  - Versioned caches; old versions are purged on activate.
 * Bump VERSION on each deploy so a new worker installs and updates take effect.
 */
const VERSION = '2026-06-26b';
const SHELL_CACHE = 'rb-shell-' + VERSION;
const RUNTIME_CACHE = 'rb-runtime-' + VERSION;

const PRECACHE = [
  '/', '/index.html', '/app.js', '/shopping-list.js', '/recipe-tags.js', '/app-config.js',
  '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/maskable-icon.png',
  '/apple-touch-icon.png', '/favicon-32.png',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Best-effort per item so one failed fetch doesn't abort the whole precache.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res.clone());
      } catch (e) { /* skip */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k.startsWith('rb-') && !k.endsWith(VERSION)) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // API: always go to the network; offline is handled by the app's local mirror.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Navigations: stale-while-revalidate against the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('/index.html');
      const network = fetch(req).then((res) => {
        if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put('/index.html', res.clone()));
        return res;
      }).catch(() => null);
      if (cached) { event.waitUntil(network); return cached; }
      return (await network) || (await caches.match('/')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  // Static assets + libraries + fonts: stale-while-revalidate.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || Response.error();
  })());
});
