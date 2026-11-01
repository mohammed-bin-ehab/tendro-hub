const CACHE_NAME = 'tendro-shell-v2';
const SHELL_FILES = [
  '/static/offline.html',
  '/static/offline.css',
  '/static/tendro-hub.svg',
  '/static/style.css?v=12',
  '/static/app.js?v=11',
  '/theme.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('tendro-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try { return await fetch(request, { signal: controller.signal }); }
      catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('/static/offline.html')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      } finally { clearTimeout(timeout); }
    })());
    return;
  }

  if (url.pathname.startsWith('/static/') || url.pathname === '/theme.css') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      });
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network.catch(() => new Response('', { status: 503 }));
    })());
  }
});
