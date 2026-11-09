/* QBooks — the books library's data on the phone and its search.
   catalog.json: every book (title, author, volumes, field, language, author's year of death…).
   index.json: segments of the word index and which pages (book, volume, page) each page number stands for.
   A word is looked up by reading one small bucket file per segment (see tools/books/segment.mjs). */
(function (root) {
  "use strict";
  const DATA = ["https://raw.githubusercontent.com/sa89588/qasida/books/", "https://cdn.jsdelivr.net/gh/sa89588/qasida@books/"];
  const W = root.QBookWords, M = root.QMatch;
  const DB = "qasida-books", STORE = "kv";

  /* ---------- small storage ---------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function kv(key, val) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const tx = db.transaction(STORE, val === undefined ? "readonly" : "readwrite"), st = tx.objectStore(STORE);
        const q = val === undefined ? st.get(key) : st.put(val, key);
        q.onsuccess = () => res(val === undefined ? q.result : true); q.onerror = () => rej(q.error);
      });
    } catch { return undefined; }
  }
  async function fetchData(path, kind, fresh) {
    let last;
    for (const base of DATA) {
      try {
        const r = await fetch(base + path + (fresh ? (path.includes("?") ? "&" : "?") + "t=" + Date.now() : ""), { cache: fresh ? "no-store" : "default" });
        if (r.ok) return kind === "json" ? await r.json() : await r.arrayBuffer();
        last = new Error("http " + r.status);
        if (r.status === 404 && kind !== "json") break;     // an empty bucket is simply not there
      } catch (e) { last = e; }
    }
    throw last || new Error("offline");
  }

  /* ---------- catalogue and index ---------- */
  const S = { catalog: null, index: null, books: [], byId: new Map(), vols: [], volsOf: new Map(), cats: [], updatedAt: 0 };
  const listeners = [];
  function take(catalog, index) {
    if (catalog) {
      S.catalog = catalog; S.cats = catalog.cats || [];
      S.books = catalog.books.map((r) => ({ id: r[0], title: r[1], author: r[2], volumes: r[3], cat: r[4], lang: r[5], died: r[6], fullAuthor: r[7], subject: r[8], fullTitle: r[9],
        key: M.compact(r[1] + " " + (r[9] || "")), akey: M.compact(r[2] + " " + (r[7] || "")) }));
      S.byId = new Map(S.books.map((b) => [b.id, b]));
    }
    if (index) {
      S.index = index;
      S.vols = index.vols.slice().sort((a, b) => a[2] - b[2]);
      S.volsOf = new Map();
      for (const v of S.vols) { const a = S.volsOf.get(v[0]); if (a) a.push(v); else S.volsOf.set(v[0], [v]); }
    }
    for (const f of listeners) try { f(); } catch {}
  }
  /* Instant start from what this phone kept; then the latest from the server. */
  async function load(onProgress) {
    const [c, i] = await Promise.all([kv("catalog"), kv("index")]);
    if (c && i) { take(c, i); refresh().catch(() => {}); return S; }
    onProgress && onProgress("أنزّل فهرس الكتب (مرة واحدة)…");
    await refresh(true);
    return S;
  }
  async function refresh(force) {
    const at = (await kv("checkedAt")) || 0;
    if (!force && Date.now() - at < 30 * 60e3) return false;
    const index = await fetchData("index.json", "json", true);
    const same = S.index && S.index.updated === index.updated;
    const catalog = same && S.catalog ? null : await fetchData("catalog.json", "json", true);
    await kv("checkedAt", Date.now());
    if (same) return false;
    if (catalog) await kv("catalog", catalog);
    await kv("index", index);
    take(catalog, index);
    return true;
  }

  /* ---------- where a page number points ---------- */
  function locate(doc) {
    const v = S.vols; let lo = 0, hi = v.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (v[m][2] <= doc) lo = m + 1; else hi = m - 1; }
    const e = v[hi]; if (!e || doc >= e[2] + e[4]) return null;
    return { book: e[0], vol: e[1], page: e[3] + (doc - e[2]) };
  }
  const pageUrl = (b, v, p) => "https://ar.lib.eshia.ir/" + b + "/" + v + "/" + p;
  const bookUrl = (b) => "https://ar.lib.eshia.ir/" + b;
  function coverage(id) {
    const vs = S.volsOf.get(id) || [];
    const pages = vs.reduce((s, v) => s + v[4], 0);
    return { pages, volumes: [...new Set(vs.map((v) => v[1]))].sort((a, b) => a - b) };
  }

  /* ---------- reading the word index ---------- */
  const bucketCache = new Map();
  async function bucket(seg, k) {
    const key = seg.id + "/" + k.toString(36);
    if (bucketCache.has(key)) return bucketCache.get(key);
    const p = (async () => {
      const path = "seg/" + key + ".bin";
      // Segments never change once written (a merge makes a new one), so a fetched bucket is kept for good.
      let c = null; try { c = await caches.open("qasida-books-buckets"); const hit = await c.match(path); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch {}
      try { const buf = await fetchData(path, "bin"); try { c && c.put(path, new Response(buf.slice(0))); } catch {} return new Uint8Array(buf); }
      catch (e) { if (String(e.message).includes("404")) return new Uint8Array(0); throw e; }
    })();
    bucketCache.set(key, p);
    p.catch(() => bucketCache.delete(key));
    return p;
  }
  function find(b, code, base) {
    let i = 0;
    const vint = () => { let n = 0, mul = 1, x; do { x = b[i++]; n += (x & 127) * mul; mul *= 128; } while (x & 128); return n; };
    while (i < b.length) {
      const c = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]; i += 3;
      const n = vint();
      if (c === code) { const out = new Array(n); let d = base; for (let k = 0; k < n; k++) { d += vint(); out[k] = d; } return out; }
      if (c > code) return [];
      for (let k = 0; k < n; k++) vint();
    }
    return [];
  }
  function intersect(a, b) { const out = []; let i = 0, j = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++; } return out; }

  /* Pages whose words include all the words asked for (or, failing that, most of them).
     opts.book: only inside that book. Returns { words, common, mode, hits: [{book, pages:[{vol,page,n}]}], total }. */
  async function searchText(q, opts) {
    opts = opts || {};
    const words = [...new Set(W.words(q))].slice(0, 8);
    const codes = words.map(W.code);
    const out = { words, common: [], mode: "all", hits: [], total: 0 };
    if (!codes.length || !S.index) return out;
    let ranges = null;
    if (opts.book) { ranges = (S.volsOf.get(opts.book) || []).map((v) => [v[2], v[2] + v[4]]); if (!ranges.length) return out; }
    const inRanges = (d) => !ranges || ranges.some(([a, b]) => d >= a && d < b);
    const segs = S.index.segments.filter((s) => !ranges || ranges.some(([a, b]) => a < s.base + s.docs && b > s.base));
    const commonWords = new Set();
    const lists = await Promise.all(segs.map(async (s) => {
      const per = await Promise.all(codes.map(async (c, wi) => {
        if (s.common.includes(c)) { commonWords.add(words[wi]); return null; }      // on almost every page: no filter
        return find(await bucket(s, c & (s.nb - 1)), c, s.base).filter(inRanges);
      }));
      return per;
    }));
    out.common = [...commonWords];
    const counts = new Map();          // doc → how many of the words
    let all = [];
    for (const per of lists) {
      const real = per.filter(Boolean);
      if (!real.length) continue;
      let acc = real[0]; for (let k = 1; k < real.length && acc.length; k++) acc = intersect(acc, real[k]);
      all = all.concat(acc);
      if (real.length > 1) for (const l of real) for (const d of l) counts.set(d, (counts.get(d) || 0) + 1);
    }
    let docs = all.map((d) => [d, codes.length]);
    if (!docs.length && codes.length > 1) {                 // no page has them all: pages with most of them
      out.mode = "most";
      const need = Math.max(2, codes.length - 1 - (codes.length > 4 ? 1 : 0));
      docs = [...counts].filter(([, n]) => n >= need).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3000);
    }
    const byBook = new Map();
    for (const [d, n] of docs) {
      const loc = locate(d); if (!loc) continue;
      let g = byBook.get(loc.book); if (!g) byBook.set(loc.book, g = { book: loc.book, pages: [], best: 0 });
      g.pages.push({ vol: loc.vol, page: loc.page, n }); g.best = Math.max(g.best, n);
    }
    const qk = M.compact(q);
    out.hits = [...byBook.values()].map((g) => {
      const b = S.byId.get(g.book);
      g.pages.sort((x, y) => y.n - x.n || x.vol - y.vol || x.page - y.page);
      g.score = g.best * 1000 + Math.min(500, g.pages.length) + (b && qk.length > 3 && b.key.includes(qk) ? 300 : 0);
      return g;
    }).sort((a, b) => b.score - a.score);
    out.total = docs.length;
    return out;
  }

  /* Books by title or author: every word of the query must appear. */
  function searchTitles(q, filter) {
    const parts = M.norm(q).split(/\s+/).filter((w) => w.length >= 2).map((w) => w.replace(/^ال(?=..)/, ""));
    if (!parts.length) return [];
    const qk = M.compact(q);
    const out = [];
    for (const b of S.books) {
      if (filter && !filter(b)) continue;
      const inT = parts.every((p) => b.key.includes(p)), inA = !inT && parts.every((p) => b.akey.includes(p) || b.key.includes(p));
      if (!inT && !inA) continue;
      const tk = M.compact(b.title);
      const s = (tk === qk ? 100 : tk.startsWith(qk) ? 80 : inT ? 60 : 40) + (b.lang === "ar" ? 5 : 0) - Math.min(20, tk.length / 10);
      out.push([s, b]);
    }
    return out.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  root.QBooks = { load, refresh, state: S, onChange: (f) => listeners.push(f), searchText, searchTitles, locate, coverage, pageUrl, bookUrl };
})(self);
