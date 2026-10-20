// Service worker : l'application fonctionne hors ligne une fois chargée.
const VERSION = 'sentinelle-v1.1.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './js/app.js',
  './js/core/audio.js',
  './js/core/ble.js',
  './js/core/emf.js',
  './js/core/geo.js',
  './js/core/glint.js',
  './js/core/icons.js',
  './js/core/native.js',
  './js/core/radar-logic.js',
  './js/core/sensors.js',
  './js/core/spectrum.js',
  './js/core/store.js',
  './js/core/ui.js',
  './js/core/wifi.js',
  './js/screens/camera.js',
  './js/screens/emf.js',
  './js/screens/home.js',
  './js/screens/radars.js',
  './js/screens/scope.js',
  './js/screens/settings.js',
  './js/screens/waves.js',
  './js/services/radar-service.js',
  './js/sim/demo.js',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réponse immédiate depuis le cache, mise à jour en arrière-plan.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const network = fetch(request)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || (request.mode === 'navigate' ? cache.match('./index.html') : Response.error());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
