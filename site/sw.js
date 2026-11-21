/* GradeCalc service worker: makes the site open offline. It caches only this site's own files (the list below) and
 * never touches /api/*, /auth/*, other origins or anything not in the list: those go straight to the network as if
 * there were no service worker. Network first: online you always get the latest deploy (and the cache is refreshed);
 * offline you get the last copy. Your gradebook is never in this cache: it lives in localStorage (or your account).
 * tests/pwa.test.js checks that PRECACHE lists every page, script, style and icon in site/. */
const CACHE = 'gradecalc-v1';
const PRECACHE = [
  '/', '/help', '/about', '/privacy',
  '/manifest.webmanifest', '/favicon.svg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png',
  '/css/tokens.css', '/css/app.css', '/css/site.css',
  '/js/theme.js', '/js/site.js', '/js/help.js', '/js/pwa.js', '/js/app.js', '/js/ui.js', '/js/calc.js', '/js/charts.js',
  '/js/wizard.js', '/js/structure.js', '/js/store.js', '/js/demo.js', '/js/files.js', '/js/sync.js',
  '/vendor/sheetjs-0.20.3/xlsx.mini.min.js',
];
const OURS = new Set(PRECACHE);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) if (!OURS.has(new URL(req.url).pathname)) await cache.delete(req);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !OURS.has(url.pathname)) return; // not ours: the network, untouched
  event.respondWith((async () => {
    let res;
    try {
      res = await fetch(req);
    } catch (err) {
      const hit = await caches.match(url.pathname, { cacheName: CACHE });
      if (hit) return hit;
      throw err;
    }
    // Keep only plain, complete answers for exactly this path (a query like ?signin=ok is stored as the page). Storing
    // happens after the answer and may fail (storage full): the fresh answer is returned either way, never the old copy.
    if (res.status === 200 && res.type === 'basic' && !res.redirected) {
      const copy = res.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(url.pathname, copy)).catch(() => {}));
    }
    return res;
  })());
});
