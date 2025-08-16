// Minimal service-worker.js for Skylens
// - App-shell caching (cache-first)
// - Navigation fallback (SPA-friendly)
// - Immediate activation (skipWaiting + clients.claim)
// - Sends a "SKY_UPDATE" postMessage when a new SW activates

const SW_VERSION = 'skylens';
const CORE_ASSETS = [
  '/', // allows navigation fallback to be cached as index.html at install-time if fetched
  '/skylens/',               // start url (GitHub Pages)
  '/skylens/index.html',     // if your index is at this path
  '/skylens/style.css',
  '/skylens/script.js',
  '/skylens/manifest.json',
  '/skylens/iconlensnew192.png',
  '/skylens/icons/iconlensnew512.png',
  '/skylens/offline.html'    // optional offline fallback page (recommended)
];

self.addEventListener('install', (event) => {
  // Precache core assets
  event.waitUntil(
    caches.open(SW_VERSION).then(cache => {
      // Try to addAll but ignore failures for missing assets
      return Promise.all(
        CORE_ASSETS.map(path =>
          fetch(path, { cache: 'no-store' }).then(r => {
            if (r.ok) return cache.put(path, r.clone());
            return Promise.resolve();
          }).catch(() => Promise.resolve())
        )
      );
    }).then(() => {
      // Activate worker immediately
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete old caches not matching SW_VERSION
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== SW_VERSION).map(k => caches.delete(k)));
      // Take control immediately
      await self.clients.claim();
      // Notify clients a new SW is active (useful for "App updated" toast)
      const all = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of all) {
        try { client.postMessage({ type: 'SKY_UPDATE', version: SW_VERSION }); } catch (e) {}
      }
    })()
  );
});

// A conservative caching strategy:
// - Navigation requests => network-first then cache then offline fallback (so users get the latest HTML)
// - Static same-origin assets => cache-first then network (fast UI)
// - Others (images/fonts) => cache-first then network
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests for app assets/navigation of this site
  if (url.origin === self.location.origin) {
    // navigation: use network-first so users get updates, fallback to cache/offline
    if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
      event.respondWith((async () => {
        try {
          const networkResp = await fetch(req);
          // update cache with fresh index/html-like response
          const cache = await caches.open(SW_VERSION);
          cache.put(req.url, networkResp.clone().catch(()=>{}));
          return networkResp;
        } catch (err) {
          // network failed, try cache
          const cache = await caches.open(SW_VERSION);
          const cached = await cache.match('/skylens/index.html') || await cache.match('/');
          if (cached) return cached;
          // final fallback to a simple offline page if present
          const offline = await cache.match('/skylens/offline.html');
          if (offline) return offline;
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })());
      return;
    }

    // For other GET requests (css/js/images), prefer cache first for snappy UI
    if (req.method === 'GET') {
      event.respondWith((async () => {
        const cache = await caches.open(SW_VERSION);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const networkResp = await fetch(req);
          // store a copy for future
          if (networkResp && networkResp.ok) cache.put(req, networkResp.clone().catch(()=>{}));
          return networkResp;
        } catch (e) {
          // as a last resort, return cached fallback (if any)
          const fallback = await cache.match('/skylens/offline.html');
          return fallback || new Response(null, { status: 504 });
        }
      })());
      return;
    }
  }

  // for cross-origin or other methods, do nothing (let browser handle)
});

// Optional: listen for messages from page to trigger skipWaiting or other commands
self.addEventListener('message', (ev) => {
  try {
    const data = ev.data || {};
    if (data && data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  } catch (e) {}
});

// Cleanup periodically or on explicit logic could be added later
