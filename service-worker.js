// Simple but robust service worker for SkyLens
// - caches core shell on install
// - serves static assets from cache-first
// - uses network-first for navigation (so SPA updates when online)
// - skips caching the external Apps Script endpoint (SCRIPT_URL)
// - notifies clients on activate with a SKY_UPDATE message

const CACHE_VERSION = 'skylens-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const CORE_ASSETS = [
  '/',                 // navigation fallback
  '/index.html',
  '/style.css',
  '/script.js',
  '/iconlensnew192.png',
  '/iconlensnew512.png'
];

// If you change SCRIPT_URL in your app, keep it in sync here so we don't cache API responses
const APPS_SCRIPT_ORIGIN = (new URL(self.registration.scope)).origin; // fallback: same origin
// You likely want to avoid caching cross-origin Apps Script requests; handle by domain detection

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // delete old caches
      const keys = await caches.keys();
      await Promise.all(keys.map(k => {
        if (k !== STATIC_CACHE && k !== IMAGE_CACHE) return caches.delete(k);
        return Promise.resolve();
      }));
      await self.clients.claim();

      // Notify clients that a new SW is active (useful to show "App updated")
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'SKY_UPDATE', version: CACHE_VERSION });
      }
    })()
  );
});

function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
         (request.method === 'GET' && request.headers.get('accept') && request.headers.get('accept').includes('text/html'));
}

// A small helper: network-first for navigation so users see the latest app when online
async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

// Cache-first for static assets & images
async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) {
      // for images store in image cache for separate tracking
      if (cacheName === IMAGE_CACHE) await cache.put(request, resp.clone());
      else await cache.put(request, resp.clone());
    }
    return resp;
  } catch (e) {
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Avoid interfering with browser devtools / extension requests
  if (url.protocol.startsWith('chrome-extension')) return;

  // Don't cache external AppsScript / API calls (detect by hostname mismatch)
  // If your SCRIPT_URL is on a known host, you can explicitly skip that host.
  const isCrossOriginApi = (url.origin !== self.location.origin) && /script\.google\.com|googleapis\.com/.test(url.hostname + url.pathname);

  // Navigation (HTML) -> network-first
  if (isNavigationRequest(req)) {
    event.respondWith(
      networkFirst(req).then(resp => {
        // If networkFirst returned a Response, return it; otherwise fallback to cached index.html
        if (resp && resp.ok) return resp;
        return caches.match('/index.html');
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets on same origin: cache-first
  if (req.method === 'GET' && req.destination && (req.destination === 'style' || req.destination === 'script' || req.destination === '' || req.destination === 'document' || req.destination === 'manifest')) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Images: cache-first with separate image cache
  if (req.destination === 'image' || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req, IMAGE_CACHE));
    return;
  }

  // If it's a cross-origin API call (e.g., your Apps Script), just do network-only (don't cache)
  if (isCrossOriginApi) {
    event.respondWith(fetch(req));
    return;
  }

  // Default: try cache, fallback to network
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => cached))
  );
});

// Listen to messages from the page (common pattern: page can send {type: 'SKIP_WAITING'} to activate new SW immediately)
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
