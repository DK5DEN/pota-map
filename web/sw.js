/*
 * Service worker for use without a network.
 *
 * Parks notoriously have no reception - which is exactly where the map is
 * needed. The tile architecture pays off here: single tiles can be kept on
 * purpose, instead of all or nothing.
 *
 * Five strategies, depending on the kind of request:
 *   navigation    network first, cache as fallback
 *   own tiles     cache first, refreshed in the background
 *   foreign tiles cache while fresh, asked again once stale
 *   app files     cache first (file names carry a hash)
 *   data          network first, cache as fallback
 *   /api/         never - live data does not belong in a cache
 */

const VERSION = "v4";
const SHELL = `pota-shell-${VERSION}`;
const TILES = `pota-tiles-${VERSION}`;
const DATA = `pota-data-${VERSION}`;
/* Foreign tiles get their own store, kept apart from ours for two reasons:
   the area somebody deliberately saved for a trip must never be thrown out to
   make room for a raster tile they scrolled past, and only this store has an
   upper bound. */
const RASTER = `pota-raster-${VERSION}`;

/* Whose tiles we keep. Anything not listed here passes the worker untouched
   and is left to the browser. */
const RASTER_HOSTS = [
  "tile.openstreetmap.org",
  "a.tile.opentopomap.org",
  "b.tile.opentopomap.org",
  "c.tile.opentopomap.org",
];

/* About 130 MB at 30 KB a tile. High enough that a day out never hits it, low
   enough that the browser does not start evicting our own stores instead. */
const RASTER_MAX = 4000;

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

/**
 * How long a stored answer may be served without asking again. Read from the
 * headers the server sent, which is what the OSM tile usage policy asks for
 * ("honour server caching headers"). OpenTopoMap sends max-age=604800, so a
 * tile that was looked at once is good for a week without a single further
 * request.
 *
 * The obvious `Date` header is of no use here: a cross-origin answer only
 * hands out the safelisted headers, and `Date` is not one of them - reading
 * it gives null, and every tile would look stale on the next visit. So the
 * time of storage is written down by us, see `storeWithStamp`. `Expires` is
 * safelisted and serves as the fallback.
 */
function freshUntil(response) {
  const control = response.headers.get("cache-control") || "";
  if (/\bno-store\b|\bno-cache\b/.test(control)) return 0;

  const maxAge = /max-age=(\d+)/.exec(control);
  const stored = Number(response.headers.get("x-stored-at"));
  if (maxAge && stored) return stored + Number(maxAge[1]) * 1000;

  const expires = Date.parse(response.headers.get("expires") || "");
  return Number.isNaN(expires) ? 0 : expires;
}

/**
 * How long a stale tile may still be handed out. Both servers say so
 * themselves: openstreetmap.org sends max-age of about five hours but
 * `stale-while-revalidate=604800`, meaning "show the old one and fetch a new
 * one in the background, for a week". Ignoring that would mean a fresh
 * request per tile every five hours - the load their policy asks us to avoid.
 *
 * `stale-if-error` covers the other case: the server cannot be reached, so
 * the old tile is the right answer rather than a hole in the map.
 */
function staleUntil(response, directive) {
  const control = response.headers.get("cache-control") || "";
  const allowed = new RegExp(directive + "=(\\d+)").exec(control);
  const stored = Number(response.headers.get("x-stored-at"));
  if (!allowed || !stored) return 0;
  return stored + Number(allowed[1]) * 1000;
}

/**
 * Put a tile into the store with the time it arrived. The answer has to be
 * rebuilt for that - headers of a response cannot be changed - which is
 * cheap: at this point the tile is a few dozen kilobytes in memory anyway.
 */
async function storeWithStamp(cache, request, response) {
  const body = await response.clone().arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set("x-stored-at", String(Date.now()));
  await cache.put(request, new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
}

/**
 * For foreign tiles: answer from the store while the tile is fresh, ask again
 * once it is not.
 *
 * Deliberately no `If-None-Match` of our own, although the ETag is right
 * there: a request header that is not on the safelist turns the request into
 * a preflight, and their server allows `Origin, Authorization, Accept` and
 * nothing else - the preflight would fail and the tile with it. A plain
 * `fetch` gets us the same thing for free, because the browser revalidates
 * out of its own HTTP cache and answers a 304 without a body on the wire.
 *
 * On a network error the old tile stays and is served. Nothing is ever
 * removed before its replacement has arrived: `cache.put` overwrites in one
 * step, and a failed fetch touches nothing.
 */
async function keepWhileFresh(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const stored = await cache.match(request);

  const renew = async () => {
    const answer = await fetch(request);
    // An opaque answer (no CORS headers) cannot be told apart from an error
    // page, so it is passed on but not stored.
    if (answer && answer.ok) {
      await storeWithStamp(cache, request, answer);
      trimRaster(cacheName);
    }
    return answer;
  };

  if (stored) {
    const now = Date.now();
    if (now < freshUntil(stored)) return stored;
    // Stale but within the window they allow: hand out the old tile and
    // renew behind it. Without waitUntil the browser may stop the worker as
    // soon as the answer is out, and the renewal would never arrive.
    if (now < staleUntil(stored, "stale-while-revalidate")) {
      event.waitUntil(renew().catch(() => { /* next time then */ }));
      return stored;
    }
  }

  try {
    return await renew();
  } catch (err) {
    // Their server is unreachable. An old tile beats a hole in the map, and
    // `stale-if-error` says as much - but a tile in hand is worth more than
    // the directive, so it is served either way.
    if (stored) return stored;
    throw err;
  }
}

/**
 * Keep the foreign store bounded. `cache.keys()` answers in the order things
 * went in, so the oldest are at the front - close enough to "what has not
 * been needed for longest" for tiles, and it needs no index of its own.
 *
 * Runs after a write, but not after every one: counting the keys is cheap,
 * doing it a thousand times an afternoon is not.
 */
let sinceTrim = 0;
function trimRaster(cacheName) {
  if (++sinceTrim < 100) return;
  sinceTrim = 0;
  (async () => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const tooMany = keys.length - RASTER_MAX;
    for (let i = 0; i < tooMany; i++) await cache.delete(keys[i]);
  })().catch(() => { /* a full store is a nuisance, not a fault */ });
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Foreign tiles are kept while somebody is looking at them - that is the
    // cache the tile policies ask for. What is not allowed is fetching them
    // ahead of time; no code here does that.
    if (RASTER_HOSTS.includes(url.hostname)) {
      e.respondWith(keepWhileFresh(e, RASTER));
    }
    return;
  }

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
