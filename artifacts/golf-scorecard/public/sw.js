// Golf Trip Scorecard service worker
// Strategy:
//   - HTML navigations: network-first, fall back to cached shell when offline.
//   - Same-origin static assets (Vite-hashed files): cache-first.
//   - Everything else (including API calls): pass through, never cache.
// Bump CACHE_VERSION when shipping a breaking change to the SW itself.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const ASSET_CACHE = `assets-${CACHE_VERSION}`;
const SHELL_URLS = ["./", "./index.html", "./manifest.webmanifest", "./favicon.svg", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((cached) => cached || Response.error())),
    );
    return;
  }

  if (/\.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|webp|ico|json)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (!res || res.status !== 200 || res.type === "opaque") return res;
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
          return res;
        });
      }),
    );
  }
});
