// 离线缓存：先用网络拿最新版本，失败时用缓存，保证没网也能打开。
const CACHE = 'xiulian-v17';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'rules.js', 'store.js', 'fx.js', 'native.js', 'chars.js', 'voices.js', 'sync.js', 'viewer.js', 'bgm.js', 'manifest.webmanifest',
  'ink-night.jpg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
