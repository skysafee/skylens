// service-worker.js
const SW_VERSION = 'v20250812.3';
const SHELL_CACHE = 'skylens-shell-' + SW_VERSION;
const RUNTIME_CACHE = 'skylens-runtime-' + SW_VERSION;

const PRECACHE_URLS = [
  './',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'offline.html',
  'iconlensnew192.png',
  'iconlensnew512.png'
];

function fetchWithTimeout(request, ms = 7000) {
  return Promise.race([
    fetch(request),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

async function limitCacheSize(cacheName, maxItems = 300) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      await cache.delete(keys[0]);
      await limitCacheSize(cacheName, maxItems);
    }
  } catch (e) { /* ignore */ }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .catch(err => console.error('[SW] Precache failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
      return Promise.resolve();
    }));
    await self.clients.claim();
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'SKY_UPDATE', version: SW_VERSION }));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Navigation: network-first, fallback offline page
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResp = await fetchWithTimeout(req, 7000);
        // update cached shell root
        caches.open(SHELL_CACHE).then(cache => cache.put('./', networkResp.clone()).catch(()=>{}));
        return networkResp;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        const offline = await caches.match('offline.html');
        if (offline) return offline;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Static assets (css/js/manifest/icons) -> cache-first, background refresh
  if (isSameOrigin && (req.destination === 'style' || req.destination === 'script' || req.destination === 'manifest' ||
      req.url.endsWith('.png') || req.url.endsWith('.json') || req.url.endsWith('.svg'))) {

    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) {
          fetch(req).then(resp => { if (resp && resp.ok) caches.open(SHELL_CACHE).then(c => c.put(req, resp.clone())); }).catch(()=>{});
          return cached;
        }
        return fetch(req).then(resp => {
          if (resp && resp.ok) caches.open(SHELL_CACHE).then(c => c.put(req, resp.clone()));
          return resp;
        }).catch(() => caches.match('offline.html'));
      })
    );
    return;
  }

  // Images/media -> runtime cache (cache-first then network)
  if (req.destination === 'image' || req.url.match(/\.(png|jpe?g|gif|webp|avif)$/i)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          cache.put(req, resp.clone()).catch(()=>{});
          limitCacheSize(RUNTIME_CACHE, 400);
        }
        return resp;
      } catch (e) {
        return caches.match('offline.html');
      }
    })());
    return;
  }

  // Default: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then(resp => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    }).catch(() => null);
    return cached || (await networkPromise) || (await caches.match('offline.html'));
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKY_FORCE_UPDATE') {
    self.skipWaiting();
  }
});
