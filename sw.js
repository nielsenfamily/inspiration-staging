/* Offline support. App files are fetched fresh when online and kept for offline use.
   This file rarely needs to change; adding new app files does not require editing it. */
const CACHE = 'inspiration-app';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'fonts/fonts.css', 'lib/quill.js', 'lib/quill.core.css',
  'lib/supabase.js', 'lib/docx.min.js', 'lib/mammoth.min.js', 'js/config.js', 'js/store.js', 'js/sync.js', 'js/scenes.js',
  'js/app.js', 'js/editor.js', 'js/transfer.js', 'img/icon.svg', 'img/icon-192.png', 'img/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(u => cache.add(u).catch(() => null)));
    try {
      const css = await (await fetch('fonts/fonts.css')).text();
      const fonts = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => 'fonts/' + m[1].replace(/['"]/g, ''));
      await Promise.all(fonts.map(u => cache.add(u).catch(() => null)));
    } catch (e) { /* offline during install */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'cache-urls') {
    caches.open(CACHE).then(c => event.data.urls.forEach(u => c.add(u).catch(() => null)));
  }
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // database calls go straight through

  // Libraries, fonts, backgrounds and icons never change: use the saved copy first
  if (/\/(lib|fonts|backgrounds|img)\//.test(url.pathname)) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Everything else: fresh from the network when possible, saved copy when offline
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([fetch(req), timeout(5000)]);
      if (res.ok && !url.search) cache.put(req, res.clone());
      return res;
    } catch (e) {
      const key = url.search ? new Request(url.origin + url.pathname) : req;
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
      throw e;
    }
  })());
});
