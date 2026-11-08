/* Offline support for the no-key version (scope: /qasida/lite/).
   - App code: network first, cached copy only when offline (an update is never mixed with old files).
   - Reader files (../vendor) and icons: cache first, stored the first time they are used.
   - The catalog lives in IndexedDB (lite.js); audio streams from its source and is not cached. */
const VERSION = "qasida-lite-v6";
const SHELL = ["./", "index.html", "lite.css?v=4", "library.js?v=2", "lite.js?v=5", "search-worker.js?v=3", "words.js?v=1", "manifest.webmanifest",
  "../match.js?v=13", "../voice.js?v=13", "../poems.json?v=13", "../vendor/tesseract/tesseract.min.js", "../icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("qasida-lite-") && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isStatic = (p) => /\/qasida\/(vendor|icons)\//.test(p);
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isStatic(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      const r = await fetch(req, { cache: "no-cache" });
      if (r.ok) c.put(req, r.clone());   // also refills the cache if the main app's worker cleared it
      return r;
    } catch {
      return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) ||
        (req.mode === "navigate" ? await c.match("index.html") : Response.error());
    }
  })());
});
