/* Offline support: the app shell and the on-device reader are cached; the poem index is refreshed when online.
   Audio and YouTube stream from their sources and are not cached. */
const VERSION = "qasida-v1";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "match.js", "poems.json", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "vendor/tesseract/tesseract.min.js", "vendor/tesseract/worker.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("message", (e) => { if (e.data === "skip-waiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: serve cached copy, refresh in background.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.headers.has("range")) return;

  // The index and pages: network first so new poems appear, cache when offline.
  if (req.mode === "navigate" || url.pathname.endsWith("/poems.json")) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(VERSION)).put(req.mode === "navigate" ? "index.html" : req, res.clone());
        return res;
      } catch {
        return (await caches.match(req.mode === "navigate" ? "index.html" : req)) || Response.error();
      }
    })());
    return;
  }
  // Everything else on this site (scripts, reader files, icons): cache first.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
    return res;
  })());
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
