const CACHE_NAME = 'skysafe-v1';
const URLS_TO_CACHE = [
  '/',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'https://unpkg.com/cropperjs@1.5.13/dist/cropper.min.js',
  'https://unpkg.com/cropperjs@1.5.13/dist/cropper.min.css'
];

// Install the service worker and cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

// Serve cached content when offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});