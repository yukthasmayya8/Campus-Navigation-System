/* Service worker (needs HTTPS or localhost). App data lives in IndexedDB (src/lib/offline.js);
   this file caches the app shell and map tiles the user has actually viewed.
   It never bulk-downloads tiles (the public OpenStreetMap tile servers forbid that). */
const SHELL = 'campus-shell-v1', TILES = 'campus-tiles-v1', MAX_TILES = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, TILES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET') return;                        // writes are online-only
  if (url.origin === self.location.origin && (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads'))) return; // data: IndexedDB handles it

  if (url.hostname.endsWith('tile.openstreetmap.org')) {   // map tiles: cache-first, only tiles already viewed
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); c.put(req, res.clone()).then(() => trim(c)); return res; }
      catch { return hit || Response.error(); }            // offline & not cached: Leaflet shows a blank tile, routes still draw
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {                           // pages: network first, fall back to cached shell
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); return res; })
      .catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.open(SHELL).then(async (c) => {     // built assets: stale-while-revalidate
    const hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
