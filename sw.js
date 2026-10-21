// Network first for the app shell, cache as fallback so the planner opens offline.
// Sheet data is not cached here; the app keeps its last load in localStorage.
const CACHE = 'tfo-planner-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'js/app.js', 'js/calc.js', 'js/api.js', 'js/sample.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
