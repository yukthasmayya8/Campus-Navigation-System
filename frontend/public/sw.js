/* Service worker (needs HTTPS or localhost). App data lives in IndexedDB (src/lib/offline.js);
   this file caches the app shell, built assets, and map tiles the user has actually viewed.
   It never bulk-downloads tiles (the public OpenStreetMap tile servers forbid that). */
const VERSION = 'v2';
const SHELL = `campus-shell-${VERSION}`;
const ASSETS = `campus-assets-${VERSION}`;
const TILES = `campus-tiles-${VERSION}`;
const MAX_TILES = 400;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const NAV_TIMEOUT_MS = 5000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map(async (u) => {
      try {
        const r = await fetch(u, { cache: 'reload' });
        if (r.ok) await c.put(u, r);
      } catch { /* offline during install: nothing to do */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS, TILES]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'CACHE_URLS' && Array.isArray(e.data.urls)) {
    e.waitUntil((async () => {
      const c = await caches.open(ASSETS);
      await Promise.all(e.data.urls.map(async (u) => {
        try {
          const r = await fetch(u);
          if (r.ok) await c.put(u, r);
        } catch { /* ignore */ }
      }));
    })());
  }
});

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
  }
}

function offlineShell() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campus Navigation</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><h1>You are offline</h1><p>Campus Navigation could not reach the network and no cached copy is available yet. Reconnect, open the app once online, and it will work offline afterwards.</p></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  // API and uploads are online-only data; IndexedDB handles offline reads.
  if (url.origin === self.location.origin && (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads'))) return;

  // Map tiles: cache-first, only tiles the user has actually viewed.
  if (url.hostname.endsWith('tile.openstreetmap.org') || url.hostname.endsWith('basemaps.cartocdn.com')) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
          c.put(req, res.clone()).then(() => trimTiles(c)).catch(() => {});
        }
        return res;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigations: network first with a timeout, then the cached copy, then a tiny offline page.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const shell = await caches.open(SHELL);
      const asset = await caches.open(ASSETS);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
        const res = await fetch(req, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          shell.put('/', res.clone()).catch(() => {});
          asset.put(req, res.clone()).catch(() => {});
        }
        return res;
      } catch {
        const hit = (await asset.match(req)) || (await shell.match(req)) || (await shell.match('/'));
        return hit || offlineShell();
      }
    })());
    return;
  }

  // Built assets and other same-origin files: cache-first with a background refresh.
  e.respondWith((async () => {
    const c = await caches.open(ASSETS);
    const hit = await c.match(req);
    const network = fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    if (hit) {
      network.catch(() => {}); // refresh in the background
      return hit;
    }
    const res = await network;
    return res || (await caches.open(SHELL).then((s) => s.match(req))) || Response.error();
  })());
});