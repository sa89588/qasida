/* The on-phone library shared by both versions of the app (same site, same storage):
   the ShiaVoice catalog (titles, reciters, albums), the book index, and the poem-words index.
   Downloaded once, kept in IndexedDB, searched in a Web Worker. No keys needed.
   API: QLib.load(force, onProgress) · QLib.ask(text, typed) · QLib.info */
(function (root) {
  "use strict";
  const BASE = new URL(".", document.currentScript.src).href;       // …/lite/
  const DATA = ["https://raw.githubusercontent.com/sa89588/qasida/data/", "https://cdn.jsdelivr.net/gh/sa89588/qasida@data/"];
  const SECTIONS = {
    letmiat: ["لطميات", true], qesaed: ["قصائد", true], enashid: ["أناشيد", true], afrah: ["مواليد وأفراح", true],
    zeyarat: ["زيارات", true], ed3ie: ["أدعية", true], other: ["أخرى", true],
    mohadrat: ["محاضرات", false], khotab: ["خطب", false], quran: ["القرآن الكريم", false], athan: ["أذان", false],
    hawza: ["دروس حوزوية", false], kutub: ["كتب صوتية", false]
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("lite." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("lite." + k, JSON.stringify(v)); } catch {} }
  };
  const idb = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("qasida-lite", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("shards");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("shards", mode); const q = fn(t.objectStore("shards")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
    return { get: (k) => tx("readonly", (s) => s.get(k)).catch(() => null), put: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => {}),
             del: (k) => tx("readwrite", (s) => s.delete(k)).catch(() => {}) };
  })();

  async function fetchData(name, fresh) {
    for (const base of DATA) {
      try {
        const r = await fetch(base + name + (fresh ? "?t=" + Date.now() : ""), { cache: fresh ? "no-store" : "default" });
        if (r.ok) return await r.json();
      } catch {}
    }
    return null;
  }
  function chosen(manifest) {
    const saved = store.get("sections", null);
    return Object.keys(manifest?.sections || {}).filter((s) => saved ? saved.includes(s) : (SECTIONS[s]?.[1] ?? true));
  }

  const worker = new Worker(BASE + "search-worker.js?v=7");
  let qid = 0; const pending = new Map();
  let readyResolve; const ready = new Promise((r) => { readyResolve = r; });
  let reloaded = null;                                 // resolves when a later load (check now) is indexed
  const info = { tracks: 0, poems: 0, manifest: null, lyricsIndex: null, updated: null, partial: false, loaded: false, checked: 0 };
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") { info.tracks = m.tracks; info.poems = m.poems || 0; info.loaded = true; readyResolve(); if (reloaded) { reloaded(); reloaded = null; } }
    else if (m.type === "result" || m.type === "error") { const p = pending.get(m.id); pending.delete(m.id); p && (m.type === "error" ? p.reject(new Error(m.message)) : p.resolve(m)); }
  };
  function ask(text, typed) {
    return ready.then(() => new Promise((resolve, reject) => { const id = ++qid; pending.set(id, { resolve, reject }); worker.postMessage({ type: "query", id, text, typed }); }));
  }

  /* Download what changed since last time (each section and each text chunk has a fingerprint),
     keep it in IndexedDB, and hand everything to the search worker. */
  async function gather(force, say) {
    const [poemsDoc, freshMan, freshLyr] = await Promise.all([
      fetch(BASE + "../poems.json?v=13").then((r) => r.json()).catch(() => ({ poems: [] })),
      fetchData("manifest.json", true),
      fetchData("lyrics-index.json", true)
    ]);
    const manifest = freshMan || store.get("manifest", null);
    if (freshMan) store.set("manifest", freshMan);
    const lindex = freshLyr || store.get("lyricsIndex", null);
    if (freshLyr) store.set("lyricsIndex", freshLyr);
    info.manifest = manifest; info.lyricsIndex = lindex; info.updated = manifest?.updated || null;
    info.partial = !!manifest && manifest.complete === false; info.checked = Date.now();
    let fetched = 0;
    const want = chosen(manifest), parts = want.map((s) => [s, manifest.sections[s]]).concat((lindex?.chunks || []).map((c) => ["", c]));
    const shards = [], lyrics = [];
    let i = 0;
    for (const [s, part] of parts) {
      const key = part.hash || manifest?.updated;          // older manifests had no per-part fingerprint
      let saved = await idb.get(part.file);
      if (!saved || saved.hash !== key || force === "all") {
        say(s ? `أنزّل قسم ${SECTIONS[s]?.[0] || s}…` : "أنزّل كلمات القصائد…", i / parts.length);
        const data = await fetchData(part.file, true);
        if (data) { saved = { hash: key, data }; await idb.put(part.file, saved); fetched++; }
      }
      if (saved) (s ? shards : lyrics).push(saved.data);
      i++;
    }
    idb.del("lyrics.json");                                // the old single-file text index
    return { shards, lyrics, poems: poemsDoc.poems || [], fetched };
  }

  let loading = null;
  function load(force, onProgress) {
    if (loading && !force) return loading;
    return (loading = (async () => {
      const say = (t, p) => { try { onProgress && onProgress(t, p); } catch {} };
      const d = await gather(force ? "all" : false, say);
      const again = info.loaded ? new Promise((r) => { reloaded = r; }) : null;
      worker.postMessage({ type: "load", shards: d.shards, poems: d.poems, lyrics: d.lyrics });
      await (again || ready);
      return info;
    })().catch((e) => { if (!info.loaded) worker.postMessage({ type: "load", shards: [], poems: [], lyrics: [] }); throw e; }));
  }

  /* "Check for new now": fetch the newest published catalog and texts, download only what changed. */
  async function checkNow(onProgress) {
    await load(false).catch(() => {});
    const before = { tracks: info.tracks, poems: info.poems };
    const say = (t, p) => { try { onProgress && onProgress(t, p); } catch {} };
    const d = await gather(false, say);
    if (d.fetched) {
      const again = new Promise((r) => { reloaded = r; });
      worker.postMessage({ type: "load", shards: d.shards, poems: d.poems, lyrics: d.lyrics });
      await again;
    }
    return { newTracks: Math.max(0, info.tracks - before.tracks), newPoems: Math.max(0, info.poems - before.poems), fetched: d.fetched,
      updated: info.manifest?.updated, lyricsUpdated: info.lyricsIndex?.updated };
  }

  /* Seconds → "13:55" in Arabic digits' companion form (the apps convert digits themselves). */
  const clock = (s) => { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  root.QLib = { SECTIONS, store, fetchData, chosen, ask, load, checkNow, info, ready: () => ready, clock };
})(window);
