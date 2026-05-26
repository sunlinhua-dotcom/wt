// 瓷砖速查 service worker — offline-tolerant browsing.
// Strategy:
//   - app shell (html/css/js/manifest/icon/tiles.json): network-first with cache fallback
//   - images (thumb/full/scraped): cache-first, fall back to network and store
// Bumping CACHE_VERSION on every deploy clears stale shell.

const CACHE_VERSION = 'wt-v3-2026-05-26';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const IMG_CACHE = `${CACHE_VERSION}-img`;

const SHELL_URLS = [
  './',
  'index.html',
  'app.js',
  'style.css',
  'manifest.webmanifest',
  'icon.png',
  'data/tiles.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => !k.startsWith(CACHE_VERSION))
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only handle our origin

  // Images → cache-first
  if (url.pathname.includes('/images/')) {
    event.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        return hit || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Shell → network-first so deploys propagate, fall back to cache when offline.
  if (url.pathname.endsWith('/sw.js')) return; // never cache the SW itself
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh.ok && SHELL_URLS.some(u => url.pathname.endsWith(u.replace(/^\.\//, '')))) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req) || await cache.match('index.html');
      return hit || new Response('Offline', { status: 504 });
    }
  })());
});
