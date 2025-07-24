const CACHE_NAME = 'skylens';
const URLS_TO_CACHE = [
  '/',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'https://unpkg.com/cropperjs@1.5.13/dist/cropper.min.js',
  'https://unpkg.com/cropperjs@1.5.13/dist/cropper.min.css'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // 🔥 Force activate new SW immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', event => {
  clients.claim(); // 🔥 Take control of all clients immediately
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
