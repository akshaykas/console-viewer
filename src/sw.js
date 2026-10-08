// Caches the app files so the site opens offline and can be installed.
// The build script stamps a new version on each deploy so old caches get cleared.
const CACHE = 'portplay-__BUILD_VERSION__'
const FILES = [
  './',
  'index.html',
  'index.css',
  'filters.js',
  'recording.js',
  'renderer.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

// Network first so updates show up right away, cache as the offline fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copy))
        return response
      })
      .catch(() => caches.match(event.request))
  )
})
