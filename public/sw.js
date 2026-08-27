/* Dialogy service worker. Keep Next.js documents, RSC payloads, API calls and
 * build assets network-only so authenticated data and Turbopack HMR never use
 * stale cache entries. */
const CACHE_PREFIX = 'dialogy';
const STATIC_CACHE = `${CACHE_PREFIX}-static-v1`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-v1`;
const PRECACHE_URLS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(`${CACHE_PREFIX}-`) &&
                ![STATIC_CACHE, RUNTIME_CACHE].includes(cacheName),
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/sw-turbopack.js'
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
    return;
  }

  if (!isStaticAsset(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (!response.ok) {
          return response;
        }

        const responseToCache = response.clone();
        void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseToCache));
        return response;
      });
    }),
  );
});

function isStaticAsset(pathname) {
  return /\.(?:avif|gif|ico|jpe?g|mp3|ogg|png|svg|wav|webp|woff2?)$/i.test(pathname);
}
