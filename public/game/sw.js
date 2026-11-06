import { APP_SHELL, CACHE_NAME, CACHE_PREFIX } from './src/pwa-config.mjs';

const GAME_SCOPE = '/game/';

async function updateCachedAsset(cache, request) {
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
  } catch {
    // A cached response remains usable while the network is unavailable.
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request)
      || (request.mode === 'navigate' ? await cache.match('/game/index.html') : undefined);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    event.waitUntil(updateCachedAsset(cache, request));
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(GAME_SCOPE)) return;
  if (url.pathname === '/game/sign-in' || url.pathname.startsWith('/game/sign-in/')) return;

  const wantsHtml = request.mode === 'navigate'
    || request.destination === 'document'
    || url.pathname.endsWith('.html');
  event.respondWith(wantsHtml ? networkFirst(request) : cacheFirst(request, event));
});
