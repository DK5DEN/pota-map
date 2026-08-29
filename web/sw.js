/*
 * Service worker for use without a network.
 *
 * Parks notoriously have no reception - which is exactly where the map is
 * needed. The tile architecture pays off here: single tiles can be kept on
 * purpose, instead of all or nothing.
 *
 * Four strategies, depending on the kind of request:
 *   navigation   network first, cache as fallback
 *   tiles        cache first, refreshed in the background
 *   app files    cache first (file names carry a hash)
 *   data         network first, cache as fallback
 *   /api/        never - live data does not belong in a cache
 */

const VERSION = "v4";
const SHELL = `pota-shell-${VERSION}`;
const TILES = `pota-tiles-${VERSION}`;
const DATA = `pota-data-${VERSION}`;

self.addEventListener("install", (e) => {
  // Take over at once: an old version would otherwise keep deciding what
  // gets cached.
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // drop the caches of older versions
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("pota-") && !n.endsWith(VERSION))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const answer = await fetch(request);
    if (answer && answer.ok) cache.put(request, answer.clone());
    return answer;
  } catch (err) {
    const stored = await cache.match(request);
    if (stored) return stored;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const stored = await cache.match(request);
  if (stored) return stored;
  const answer = await fetch(request);
  if (answer && answer.ok) cache.put(request, answer.clone());
  return answer;
}

/**
 * For tiles: serve from the cache, but refresh in the background.
 *
 * Plain "cache first" does not work here. The tile archives are rebuilt
 * weekly, so a tile fetched once would stay forever, and whoever visited
 * before a rebuild would see missing layers and empty properties with no way
 * to fix it.
 *
 * This way delivery stays instant and the stock heals itself on the next call.
 * Without a network the cache simply answers.
 */
async function cacheFirstWithRefresh(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const stored = await cache.match(request);

  const fetchNext = fetch(request)
    .then((answer) => {
      if (answer && answer.ok) cache.put(request, answer.clone());
      return answer;
    })
    .catch(() => null);

  if (stored) {
    // Without waitUntil the browser stops the worker as soon as the response
    // is out - the refresh would never arrive.
    event.waitUntil(fetchNext);
    return stored;
  }
  const fresh = await fetchNext;
  if (fresh) return fresh;
  throw new Error("neither cache nor network");
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // never cache live data
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    e.respondWith(networkFirst(request, SHELL));
    return;
  }

  if (url.pathname.startsWith("/t/")) {
    e.respondWith(cacheFirstWithRefresh(e, TILES));
    return;
  }

  if (
    url.pathname.startsWith("/vendor/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/sprites/") ||
    /^\/(app|style|maplibre-gl)-[A-Z0-9]+\.(js|css)$/.test(url.pathname)
  ) {
    e.respondWith(cacheFirst(request, SHELL));
    return;
  }

  if (url.pathname.startsWith("/data/")) {
    e.respondWith(networkFirst(request, DATA));
  }
});

/* Prefetch an area of tiles on request. The page sends the URLs, the worker
   fetches them in small waves and reports progress. */
self.addEventListener("message", (e) => {
  const message = e.data || {};
  if (message.kind !== "prefetch" || !Array.isArray(message.urls)) return;

  e.waitUntil(
    (async () => {
      const cache = await caches.open(TILES);
      const urls = message.urls;
      let done = 0;
      const WAVE = 6;

      for (let i = 0; i < urls.length; i += WAVE) {
        await Promise.all(
          urls.slice(i, i + WAVE).map(async (u) => {
            try {
              if (await cache.match(u)) return;
              const a = await fetch(u);
              if (a && a.ok) await cache.put(u, a.clone());
            } catch (err) {
              /* a single tile may be missing */
            } finally {
              done++;
            }
          }),
        );
        const clients = await self.clients.matchAll();
        for (const c of clients) {
          c.postMessage({ kind: "progress", done, total: urls.length });
        }
      }
    })(),
  );
});
