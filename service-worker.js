const CACHE_NAME = 'skylens-vas'; // bump this on every deploy
const URLS_TO_CACHE = [
  'index.html',         // root
  'style.css',
  'script.js',
  'manifest.json',
  'offline.html'        // offline fallback
];

// 🔧 INSTALL: cache assets and log failures
self.addEventListener('install', event => {
  self.skipWaiting(); // activate this SW immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// ACTIVATE: clean old caches and notify clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.map(key => key !== CACHE_NAME && caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll())
      .then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SKY_UPDATE' }));
      })
  );
});

// 📦 FETCH: offline fallback for navigations, cache-first for others
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    // HTML pages (navigations) → try network, else offline.html
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('offline.html'))
    );
  } else {
    // Static assets → cache first, then network
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
  }
});
