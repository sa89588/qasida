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

  const worker = new Worker(BASE + "search-worker.js?v=8");
  let qid = 0; const pending = new Map();
  let readyResolve; const ready = new Promise((r) => { readyResolve = r; });
  const waiters = { ready: [], lyrics: [] };
  const info = { tracks: 0, poems: 0, manifest: null, lyricsIndex: null, updated: null, partial: false, loaded: false, checked: 0, refreshing: null };
  const listeners = new Set();
  const changed = () => { for (const f of listeners) { try { f(info); } catch {} } };
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") { info.tracks = m.tracks || info.tracks; info.poems = m.poems || 0; info.loaded = true; readyResolve(); waiters.ready.splice(0).forEach((f) => f()); changed(); }
    else if (m.type === "lyrics-ready") { info.poems = m.poems || 0; waiters.lyrics.splice(0).forEach((f) => f()); changed(); }
    else if (m.type === "result" || m.type === "error") { const p = pending.get(m.id); pending.delete(m.id); p && (m.type === "error" ? p.reject(new Error(m.message)) : p.resolve(m)); }
  };
  const next = (kind) => new Promise((r) => waiters[kind].push(r));
  function ask(text, typed) {
    return ready.then(() => new Promise((resolve, reject) => { const id = ++qid; pending.set(id, { resolve, reject }); worker.postMessage({ type: "query", id, text, typed }); }));
  }

  /* Sections of the catalog: from IndexedDB, downloading those whose fingerprint changed (when allowed). */
  async function sections(manifest, net, force, say) {
    const want = chosen(manifest), out = []; let fetched = 0;
    for (let i = 0; i < want.length; i++) {
      const s = want[i], part = manifest.sections[s], key = part.hash || manifest.updated;
      let saved = await idb.get(part.file);
      if (net && (!saved || saved.hash !== key || force)) {
        say(`أنزّل قسم ${SECTIONS[s]?.[0] || s}…`, i / want.length);
        const data = await fetchData(part.file, true);
        if (data) { saved = { hash: key, data }; await idb.put(part.file, saved); fetched++; }
      }
      if (saved) out.push(saved.data);
    }
    return { shards: out, fetched };
  }
  /* Text chunks: download the changed ones into IndexedDB; the worker reads them from there. */
  async function textChunks(lindex, force, say) {
    let fetched = 0;
    const parts = lindex?.chunks || [];
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i], saved = await idb.get(c.file);
      if (!saved || saved.hash !== c.hash || force) {
        say("أنزّل كلمات القصائد…", i / parts.length);
        const data = await fetchData(c.file, true);
        if (data) { await idb.put(c.file, { hash: c.hash, data }); fetched++; }
      }
    }
    return { parts: parts.map((c) => ({ file: c.file, hash: c.hash })), fetched };
  }
  let poemsDoc = null;
  const bookPoems = async () => poemsDoc || (poemsDoc = await fetch(BASE + "../poems.json?v=13").then((r) => r.json()).catch(() => ({ poems: [] })));

  /* Opening: start at once from what this phone already has (search works immediately),
     then check the server in the background and swap in whatever changed. */
  let starting = null;
  function load(force, onProgress) {
    const say = (t, p) => { try { onProgress && onProgress(t, p); } catch {} };
    if (force) return refresh("all", say).then(() => info);
    if (starting) return starting;
    return (starting = (async () => {
      const manifest = store.get("manifest", null), lindex = store.get("lyricsIndex", null);
      info.manifest = manifest; info.lyricsIndex = lindex; info.updated = manifest?.updated || null; info.partial = !!manifest && manifest.complete === false;
      const { shards } = manifest ? await sections(manifest, false, false, say) : { shards: [] };
      worker.postMessage({ type: "load", shards, poems: (await bookPoems()).poems || [], lyricsParts: lindex ? lindex.chunks.map((c) => ({ file: c.file, hash: c.hash })) : [] });
      await ready;
      let catalogIn; const catalogStage = new Promise((r) => { catalogIn = r; });
      info.refreshing = refresh(false, say, catalogIn).catch(() => {}).finally(() => catalogIn());
      if (!manifest) await catalogStage;                  // a first visit: wait for the catalog only; the texts follow
      return info;
    })());
  }
  /* Fetch the newest manifests; download changed parts; rebuild only what changed. */
  async function refresh(force, say, catalogDone) {
    say = say || (() => {});
    const [freshMan, freshLyr] = await Promise.all([fetchData("manifest.json", true), fetchData("lyrics-index.json", true)]);
    const before = { tracks: info.tracks, poems: info.poems };
    let fetchedAll = 0;
    if (freshMan) {
      store.set("manifest", freshMan); info.manifest = freshMan; info.updated = freshMan.updated; info.partial = freshMan.complete === false;
      const { shards, fetched } = await sections(freshMan, true, force, say);
      fetchedAll += fetched;
      if (fetched || !info.tracks) { const w = next("ready"); worker.postMessage({ type: "load", shards, poems: (await bookPoems()).poems || [] }); await w; }
    }
    if (catalogDone) catalogDone();
    if (freshLyr) {
      store.set("lyricsIndex", freshLyr); info.lyricsIndex = freshLyr;
      const { parts, fetched } = await textChunks(freshLyr, force, say);
      fetchedAll += fetched;
      if (fetched || !info.poems) { const w = next("lyrics"); worker.postMessage({ type: "lyrics", parts }); await w; }
    }
    info.checked = Date.now(); say(null);
    changed();
    return { newTracks: Math.max(0, info.tracks - before.tracks), newPoems: Math.max(0, info.poems - before.poems), fetched: fetchedAll,
      updated: info.manifest?.updated, lyricsUpdated: info.lyricsIndex?.updated };
  }
  /* "Check for new now". */
  async function checkNow(onProgress) {
    await load(false).catch(() => {});
    if (info.refreshing) await info.refreshing;
    return refresh(false, onProgress);
  }

  /* Seconds → "13:55" in Arabic digits' companion form (the apps convert digits themselves). */
  const clock = (s) => { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  root.QLib = { SECTIONS, store, fetchData, chosen, ask, load, checkNow, info, ready: () => ready, clock, onChange: (f) => listeners.add(f) };
})(window);
