// Service worker for Cycling Segment Tracker 2.
// - Cache-first for map tiles so rides/segments still render offline
// - Network-first with cache fallback for app assets & fonts
// Version bump = force refresh of cached assets.

const APP_CACHE = "cst-app-v2";
const TILE_CACHE = "cst-tiles-v1";

const TILE_HOSTS = [
  "basemaps.cartocdn.com",
  "tile.openstreetmap.org",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org",
  "tile.opentopomap.org",
  "a.tile.opentopomap.org",
  "b.tile.opentopomap.org",
  "c.tile.opentopomap.org",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(APP_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isTileRequest(url) {
  try {
    const u = new URL(url);
    if (!TILE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) {
      // basemaps cartocdn uses {s}.basemaps... so subdomains (a|b|c|d.basemaps...)
      return (
        u.hostname.endsWith(".basemaps.cartocdn.com") ||
        u.hostname.endsWith(".tile.openstreetmap.org") ||
        u.hostname.endsWith(".tile.opentopomap.org")
      );
    }
    return true;
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = req.url;

  // 0) Never touch our own API routes — auth cookies + JSON error bodies
  //    must reach the SPA untouched.
  try {
    const u = new URL(url);
    if (u.origin === self.location.origin && u.pathname.startsWith("/api/")) {
      return;
    }
  } catch { /* fall through */ }

  // 1) Map tiles: cache-first (stale ok, tiles are immutable)
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const resp = await fetch(req, { mode: "cors" });
          if (resp && (resp.ok || resp.type === "opaque")) {
            cache.put(req, resp.clone());
          }
          return resp;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 2) Nominatim — always try network, never cache results
  if (url.includes("nominatim.openstreetmap.org")) {
    return; // let the browser handle it; the geocoder itself swallows failures
  }

  // 3) App assets / fonts: network-first with cache fallback
  if (
    url.startsWith(self.location.origin) ||
    url.includes("fonts.googleapis.com") ||
    url.includes("fonts.gstatic.com")
  ) {
    event.respondWith(
      (async () => {
        try {
          const resp = await fetch(req);
          if (resp && resp.ok) {
            const cache = await caches.open(APP_CACHE);
            cache.put(req, resp.clone());
          }
          return resp;
        } catch {
          const cache = await caches.open(APP_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          // For navigations, fall back to cached index.html
          if (req.mode === "navigate") {
            const shell = await cache.match("/index.html");
            if (shell) return shell;
          }
          return Response.error();
        }
      })()
    );
  }
});
