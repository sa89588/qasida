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

  const S = { catalog: null, books: [], byKey: new Map(), fields: [], sources: {}, lessons: [], channels: [], libraries: [] };
  const listeners = [];
  const skey = (s) => s[0] + s[1];
  function take(c) {
    S.catalog = c; S.fields = c.fields || []; S.sources = c.sources || {};
    S.books = c.books.map((r, i) => {
      const b = { i, title: r[0], author: r[1], field: r[2], lang: r[3], died: r[4], fullAuthor: r[5], topics: r[6],
        sources: r[7].map((s) => ({ src: s[0], id: s[1], vols: s[2], label: s[3] || "" })), kind: r[8] || "b" };
      b.key = skey(r[7][0]);
      b.tkey = M.compact(b.title); b.akey = M.compact(b.author + " " + b.fullAuthor); b.pkey = M.compact(b.topics);
      return b;
    });
    S.lessons = (c.lessons || []).map(([u, d, ch, t, n, x]) => ({ u, d, ch, t: t || "", n: n || "", x: x || "", key: M.compact(d + " " + (t || "") + " " + (x || "")) + " " + u.toLowerCase() }));
    S.channels = c.channels || [];
    S.libraries = (c.libraries || []).map(([u, t, n, x, name]) => ({ u, t: t || name, n: n || "", x: x || "", d: name || "" }));
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
    k: (id) => "https://www.imamkadhim.com/?post_type=book&p=" + id,
    n: (id) => "https://najafdesertlibrary.com/book/" + encodeURIComponent(id),
    m: (id) => "https://bibliography.mk.iq/share/" + id,
    u: (id) => "https://turath.alkafeel.net/book/" + id,
    j: (id) => /^r/.test(id) ? "https://www.aljawadain.org/library/researches/single?research_id=" + String(id).slice(1) : "https://www.aljawadain.org/library/books/single?book_id=" + id,
    t: (id) => "https://t.me/" + id
  };
  /* Search engines that look inside the books themselves (each opens its own results). */
  const TEXT_ENGINES = [
    { name: "مكتبة مدرسة الفقاهة", site: "https://ar.lib.eshia.ir/", note: "نصوص آلاف كتب الحوزة، صفحةً صفحة", url: (q) => "https://ar.lib.eshia.ir/search/" + encodeURIComponent(q) },
    { name: "مكتبة أهل البيت (ع)", site: "https://ablibrary.net/", note: "نصوص كتبها كاملة", url: (q) => "https://ablibrary.net/search?query=" + encodeURIComponent(q) },
    { name: "مكتبة العتبة العباسية (الكفيل) الرقمية", site: "https://library.alkafeel.net/dic/", note: "الكتب والأطاريح الجامعية والبحوث والمجلات (أكثر من ٣٠٠ ألف مصدر)", url: (q) => "https://library.alkafeel.net/dic/search/?t=all&q=" + encodeURIComponent(q) },
    { name: "مكتبة صحراء النجف", site: "https://najafdesertlibrary.com/", note: "نصوص كتب الحديث والتفسير والفقه، مع البحث داخل المحتوى", url: (q) => "https://najafdesertlibrary.com/search?q=" + encodeURIComponent(q) },
    { name: "مكتبة نور الرقمية (noorlib)", site: "https://noorlib.ir/ar", note: "نصوص أكثر من مئة ألف كتاب عربي وفارسي", url: (q) => "https://noorlib.ir/ar/search?q=" + encodeURIComponent(q) },
    { name: "المكتبة الشاملة", site: "https://shamela.ws/", note: "نصوص كتب التراث الإسلامي العام", url: (q) => "https://shamela.ws/search?q=" + encodeURIComponent(q) },
    { name: "مجلات نور التخصصية (noormags)", site: "https://www.noormags.ir/view/ar/default", note: "مقالات المجلات العلمية والحوزوية ونصوصها", url: (q) => "https://www.noormags.ir/view/ar/search?q=" + encodeURIComponent(q) },
    { name: "موقع التراث الرقمي (العتبة العباسية)", site: "https://bibliography.mk.iq/", note: "مكتبة التراث وما حُقّق منه وبنك البحوث وفهارس المخطوطات", url: (q) => "https://bibliography.mk.iq/search?query=" + encodeURIComponent(q) + "&search_scope=all" },
    { name: "مكتبة الروضة الحيدرية", site: "https://www.haydarya.com/", note: "مكتبة العتبة العلوية: الكتب والرسائل الجامعية والمكتبة المختصة بأمير المؤمنين (ع)", url: (q) => "https://www.haydarya.com/?fid=1&search=" + encodeURIComponent(q) + "&search_type=2" },
    { name: "المكتبة الوقفية", site: "https://waqfeya.net/", note: "عناوين الكتب المصورة ومؤلفوها", url: (q) => "https://waqfeya.net/search?q=" + encodeURIComponent(q) }
  ];
  /* Libraries to open and browse at their own site (no search that the app can open). */
  const SITES = [
    { name: "مكتبة العتبة الحسينية المقدسة", note: "قسم الشؤون الفكرية والثقافية ومكتبته وإصداراته", url: "https://icad.iq/about-imam-hussain-library" },
    { name: "مكتبة ودار مخطوطات العتبة العباسية", note: "المكتبة وخدماتها ومخطوطاتها", url: "https://alkafeel.net/library/" },
    { name: "المكتبة الإلكترونية للعتبة الكاظمية", note: "كتب العتبة وبحوثها ومجلاتها", url: "https://www.aljawadain.org/library/main" },
    { name: "Al-Islam.org", note: "مكتبة أهل البيت الرقمية بالإنجليزية ولغات أخرى (البحث فيها يحتاج حساباً)", url: "https://www.al-islam.org/" },
    { name: "شبكة مشكاة الإسلامية", note: "مكتبة مشكاة (قد لا يفتح الموقع أحياناً)", url: "https://www.almeshkat.net/" }
  ];
  /* Telegram channels (lessons, libraries) whose description holds every word asked for. */
  function searchLessons(q) {
    const parts = M.norm(q).split(/\s+/).filter((w) => w.length >= 2).map((w) => w.replace(/^(و?ال)(?=..)/, ""));
    if (!parts.length) return [];
    return S.lessons.filter((l) => parts.every((p) => l.key.includes(p)));
  }
  /* Lessons on a book: channels whose description names it («شرح المكاسب…»). */
  function lessonsFor(b) {
    const keys = [M.compact(b.title)];
    // «معالم الدين وملاذ المجتهدين» is taught as «معالم الدين».
    const words = M.norm(b.title).split(/\s+/).filter(Boolean);
    // Only when what follows is a second name joined by «و» — «معالم الدين في فقه آل ياسين» is another book.
    if (words.length > 2 && words[2][0] === "و") { const two = M.compact(words.slice(0, 2).join(" ")); if (two.length >= 7) keys.push(two); }
    const ks = keys.filter((k) => k.length >= 5);
    if (!ks.length) return [];
    return S.lessons.filter((l) => ks.some((k) => l.key.includes(k))).sort((a, b) => (+b.n || 0) - (+a.n || 0)).slice(0, 15);
  }
  const sourceUrl = (s) => URLS[s.src] ? URLS[s.src](s.id) : "#";
  const textSearchUrl = (q, eshiaId) => "https://ar.lib.eshia.ir/search/" + (eshiaId ? eshiaId + "/" : "") + encodeURIComponent(String(q).trim());

  root.QBooks = { load, refresh, state: S, onChange: (f) => listeners.push(f), search, searchLessons, lessonsFor, sourceUrl, textSearchUrl, TEXT_ENGINES, SITES, get: (k) => S.byKey.get(k) };
})(self);
