/* Offline support.
   - App code (pages, scripts, styles, index): network first, so an update is never mixed with old files;
     the cached copy is used only when offline.
   - Reader files and icons (large, rarely change): cache first.
   - Audio and YouTube stream from their sources and are not cached. */
const VERSION = "qasida-v17";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "match.js", "smart.js", "voice.js", "media.js", "sources.js", "keysync.js?v=17", "lite/library.js?v=7", "lite/search-worker.js?v=8", "lite/words.js?v=2", "poems.json", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "vendor/tesseract/tesseract.min.js", "vendor/tesseract/worker.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
    await self.skipWaiting(); // take over at once: never leave an old worker serving old code
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && !k.startsWith("qasida-lite-")) await caches.delete(k);   // the no-key version keeps its own cache
    await self.clients.claim();
  })());
});
self.addEventListener("message", (e) => { if (e.data === "skip-waiting") self.skipWaiting(); });

const isStatic = (path) => /\/(vendor|icons)\//.test(path);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") { e.respondWith(staleWhileRevalidate(req)); return; }
  if (url.origin !== self.location.origin) return;
  if (req.headers.has("range")) return;

  if (isStatic(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  // App code: network first, cache when offline. Query strings (?v=) are ignored for the offline copy.
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const key = req.mode === "navigate" ? "index.html" : new Request(url.origin + url.pathname);
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) c.put(key, res.clone());
      return res;
    } catch {
      return (await c.match(key)) || (await c.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
