/* Service worker : met en cache l'interface du scanner pour qu'elle s'ouvre sans réseau.
 * Les appels à l'API ne sont jamais mis en cache. */
var CACHE = 'tsp-scanner-v3';
var SHELL = ['index.html', 'app.js', 'camera.js', 'jsQR.js', 'scanner.css', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.indexOf('/api/') !== -1 || url.origin !== self.location.origin) return;
  // Réseau d'abord (mises à jour), cache en secours.
  e.respondWith(fetch(e.request).then(function (resp) {
    if (resp.ok) { var copy = resp.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
    return resp;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true });
  }));
});
