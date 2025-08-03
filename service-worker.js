const CACHE_NAME = 'skylens-v4'; // bump this on every deploy
const URLS_TO_CACHE = [
  '/',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'lenscrop.min.js',
  'lensstyle.min.css'
];

// 🔧 INSTALL: cache assets and log failures
self.addEventListener('install', event => {
  self.skipWaiting(); // activate new worker immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
      .catch(err => {
        console.error('[SW] Install failed:', err);
      })
  );
});

// ACTIVATE: clean old caches and notify all tabs
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key); // clear outdated cache
          }
        })
      )
    )
    .then(() => self.clients.claim()) // take control of all open tabs
    .then(() => {
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SKY_UPDATE' }); // notify update
        });
      });
    })
  );
});

// FETCH: serve from cache first, then fallback to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
