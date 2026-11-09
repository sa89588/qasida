/* QBooks — the unified catalogue on the phone: every book of the libraries, each once, with all its sources.
   Kept in IndexedDB; refreshed from the server in the background (the server rebuilds it every day).
   Searching inside the books' text is done by «مكتبة مدرسة الفقاهة»'s own engine: textSearchUrl() opens it. */
(function (root) {
  "use strict";
  const DATA = ["https://raw.githubusercontent.com/sa89588/qasida/library/", "https://cdn.jsdelivr.net/gh/sa89588/qasida@library/"];
  const M = root.QMatch;
  const DB = "qasida-books", STORE = "kv", FORMAT = 2;

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
  async function fetchJSON(path) {
    let last;
    for (const base of DATA) {
      try { const r = await fetch(base + path + "?t=" + Date.now(), { cache: "no-store" }); if (r.ok) return await r.json(); last = new Error("http " + r.status); }
      catch (e) { last = e; }
    }
    throw last || new Error("offline");
  }

  const S = { catalog: null, books: [], byKey: new Map(), fields: [], sources: {} };
  const listeners = [];
  const skey = (s) => s[0] + s[1];
  function take(c) {
    S.catalog = c; S.fields = c.fields || []; S.sources = c.sources || {};
    S.books = c.books.map((r, i) => {
      const b = { i, title: r[0], author: r[1], field: r[2], lang: r[3], died: r[4], fullAuthor: r[5], topics: r[6],
        sources: r[7].map((s) => ({ src: s[0], id: s[1], vols: s[2], label: s[3] || "" })) };
      b.key = skey(r[7][0]);
      b.tkey = M.compact(b.title); b.akey = M.compact(b.author + " " + b.fullAuthor); b.pkey = M.compact(b.topics);
      return b;
    });
    S.byKey = new Map();
    for (const b of S.books) for (const s of b.sources) S.byKey.set(s.src + s.id, b);
    for (const f of listeners) try { f(); } catch {}
  }
  async function load(onProgress) {
    const c = await kv("catalog2");
    if (c && c.format === FORMAT) { take(c); refresh().catch(() => {}); return S; }
    onProgress && onProgress("أنزّل فهرس الكتب (مرة واحدة)…");
    await refresh(true);
    return S;
  }
  async function refresh(force) {
    const at = (await kv("checkedAt2")) || 0;
    if (!force && Date.now() - at < 60 * 60e3) return false;
    const c = await fetchJSON("catalog.json");
    await kv("checkedAt2", Date.now());
    if (!c || c.format !== FORMAT) { if (force) throw new Error("format"); return false; }
    if (S.catalog && S.catalog.updated === c.updated) return false;
    await kv("catalog2", c);
    take(c);
    return true;
  }

  /* Books whose title, author or topics hold every word asked for; titles first. */
  function search(q, filter) {
    let parts = M.norm(q).split(/\s+/).filter((w) => w.length >= 2).map((w) => w.replace(/^(و?ال)(?=..)/, ""));
    // «مجلة تراثنا», «كتاب الغيبة»: the libraries do not always write the word «مجلة» or «كتاب».
    const core = parts.filter((w) => !/^(مجله|مجلات|كتاب|كتب|موسوعه|ديوان|رساله)$/.test(w));
    if (core.length) parts = core;
    if (!parts.length) return [];
    const qk = M.compact(q);
    const out = [];
    for (const b of S.books) {
      if (filter && !filter(b)) continue;
      const inT = parts.every((p) => b.tkey.includes(p));
      const inTA = inT || parts.every((p) => b.tkey.includes(p) || b.akey.includes(p));
      const inAny = inTA || parts.every((p) => b.tkey.includes(p) || b.akey.includes(p) || b.pkey.includes(p));
      if (!inAny) continue;
      let s = b.tkey === qk ? 100 : b.tkey.startsWith(qk) ? 85 : inT ? 70 : inTA ? 55 : 35;
      s += Math.min(6, b.sources.length * 2) + (b.lang === "ar" ? 3 : 0) - Math.min(15, b.tkey.length / 12);
      out.push([s, b]);
    }
    return out.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  const URLS = {
    e: (id) => "https://ar.lib.eshia.ir/" + id,
    f: (id) => "https://alfeker.net/b/" + id + "/",
    s: (id) => "https://shiabooks.net/library.php?id=" + id,
    a: (id) => "https://ablibrary.net/book_content/b/" + id + "/1",
    h: (id) => "https://www.alhassanain.org/arabic/?com=book&id=" + id,
    i: (id) => "https://publication.imamhussain.org/post/" + id,
    k: (id) => "https://www.imamkadhim.com/?post_type=book&p=" + id
  };
  /* Search engines that look inside the books themselves (each opens its own results). */
  const TEXT_ENGINES = [
    { name: "مكتبة مدرسة الفقاهة", note: "نصوص آلاف كتب الحوزة، صفحةً صفحة", url: (q) => "https://ar.lib.eshia.ir/search/" + encodeURIComponent(q) },
    { name: "مكتبة أهل البيت (ع)", note: "نصوص كتبها كاملة", url: (q) => "https://ablibrary.net/search?q=" + encodeURIComponent(q) },
    { name: "مكتبة العتبة العباسية (الكفيل) الرقمية", note: "فهارس مصادرها الرقمية والرسائل الجامعية", url: (q) => "https://library.alkafeel.net/dic/search/?q=" + encodeURIComponent(q) }
  ];
  const sourceUrl = (s) => URLS[s.src] ? URLS[s.src](s.id) : "#";
  const textSearchUrl = (q, eshiaId) => "https://ar.lib.eshia.ir/search/" + (eshiaId ? eshiaId + "/" : "") + encodeURIComponent(String(q).trim());

  root.QBooks = { load, refresh, state: S, onChange: (f) => listeners.push(f), search, sourceUrl, textSearchUrl, TEXT_ENGINES, get: (k) => S.byKey.get(k) };
})(self);
