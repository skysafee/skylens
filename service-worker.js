// service-worker.js
const SW_VERSION = 'vas202508121'; // bump on each deploy
const CACHE_NAME = 'skylens-shell-' + SW_VERSION;
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

// Utility: safe fetch with timeout
function fetchWithTimeout(request, ms = 7000) {
  return Promise.race([
    fetch(request),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

// Limit cache size (basic)
async function limitCacheSize(cacheName, maxItems = 100) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      await cache.delete(keys[0]);
      // Recursively ensure limit (simple)
      await limitCacheSize(cacheName, maxItems);
    }
  } catch (e) {
    // ignore
  }
}

// INSTALL: pre-cache
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .catch(err => {
        console.error('[SW] Precache failed:', err);
      })
  );
});

// ACTIVATE: cleanup old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => {
        if (k !== CACHE_NAME && k !== RUNTIME_CACHE) return caches.delete(k);
        return Promise.resolve();
      })
    );
    await self.clients.claim();

    // notify clients that a new SW is active (optional)
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'SKY_UPDATE', version: SW_VERSION }));
  })());
});

// FETCH: navigation -> network-first with offline fallback.
// static assets -> cache-first.
// images -> cache-first with runtime cache.
// other -> stale-while-revalidate.
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = self.location.origin === url.origin;

  // Navigation requests (HTML) -> network-first then offline fallback
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetchWithTimeout(req, 7000);
        // Update shell cache with latest index.html (soft)
        const cache = await caches.open(CACHE_NAME);
        cache.put('./', networkResponse.clone()).catch(() => {});
        return networkResponse;
      } catch (err) {
        // Try cache fallback
        const cached = await caches.match(req);
        if (cached) return cached;
        const offline = await caches.match('offline.html');
        if (offline) return offline;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // For same-origin static assets (css/js/manifest/icons) -> cache-first
  if (isSameOrigin && (req.destination === 'style' || req.destination === 'script' || req.destination === 'manifest' || req.url.endsWith('.png') || req.url.endsWith('.svg') || req.url.endsWith('.json'))) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) {
          // update in background
          fetch(req).then(resp => {
            if (resp && resp.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(req, resp.clone()));
            }
          }).catch(()=>{});
          return cached;
        }
        return fetch(req).then(resp => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return resp;
        }).catch(() => caches.match('offline.html'));
      })
    );
    return;
  }

  // Images & media -> runtime cache with cache-first
  if (req.destination === 'image' || req.url.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          cache.put(req, resp.clone()).catch(()=>{});
          // keep runtime cache in check
          limitCacheSize(RUNTIME_CACHE, 200);
        }
        return resp;
      } catch (e) {
        // Optionally return a small inline fallback image or offline.html for navigations
        return caches.match('offline.html');
      }
    })());
    return;
  }

  // Default: stale-while-revalidate for everything else
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

// Listen for messages from clients (manual update trigger)
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKY_FORCE_UPDATE') {
    self.skipWaiting();
  }
});
