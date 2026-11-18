/* يخزّن ملفات التطبيق حتى يشتغل بدون إنترنت */
const CACHE = 'workshop-v1';
const ASSETS = [
  './', './index.html', './manifest.json', './icon.svg',
  './css/style.css', './css/print.css',
  './js/util.js', './js/data.js', './js/db.js', './js/components.js', './js/app.js',
  './js/view-home.js', './js/view-intake.js', './js/view-order.js', './js/view-settings.js', './js/print.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* الشبكة أولاً (حتى توصل التحديثات)، وإذا ماكو إنترنت نستخدم المخزّن */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes('fonts.g'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
