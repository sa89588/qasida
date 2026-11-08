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
    return { get: (k) => tx("readonly", (s) => s.get(k)).catch(() => null), put: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => {}) };
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

  const worker = new Worker(BASE + "search-worker.js?v=2");
  let qid = 0; const pending = new Map();
  let readyResolve; const ready = new Promise((r) => { readyResolve = r; });
  const info = { tracks: 0, poems: 0, manifest: null, updated: null, partial: false, loaded: false };
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") { info.tracks = m.tracks; info.poems = m.poems || 0; info.loaded = true; readyResolve(); }
    else if (m.type === "result" || m.type === "error") { const p = pending.get(m.id); pending.delete(m.id); p && (m.type === "error" ? p.reject(new Error(m.message)) : p.resolve(m)); }
  };
  function ask(text, typed) {
    return ready.then(() => new Promise((resolve, reject) => { const id = ++qid; pending.set(id, { resolve, reject }); worker.postMessage({ type: "query", id, text, typed }); }));
  }

  let loading = null;
  function load(force, onProgress) {
    if (loading && !force) return loading;
    return (loading = (async () => {
      const say = (t, p) => { try { onProgress && onProgress(t, p); } catch {} };
      const [poemsDoc, fresh] = await Promise.all([
        fetch(BASE + "../poems.json?v=13").then((r) => r.json()).catch(() => ({ poems: [] })),
        fetchData("manifest.json", true)
      ]);
      const manifest = fresh || store.get("manifest", null);
      if (fresh) store.set("manifest", fresh);
      info.manifest = manifest; info.updated = manifest?.updated || null; info.partial = !!manifest && manifest.complete === false;
      const shards = [];
      const want = chosen(manifest);
      let i = 0;
      for (const s of want) {
        const sec = manifest.sections[s];
        let saved = await idb.get(sec.file);
        if (!saved || saved.updated !== manifest.updated || force) {
          say(`أنزّل قسم ${SECTIONS[s]?.[0] || s}…`, i / want.length);
          const data = await fetchData(sec.file, force);
          if (data) { saved = { updated: manifest.updated, data }; await idb.put(sec.file, saved); }
        }
        if (saved) shards.push(saved.data);
        i++;
      }
      // Poem words (hashed): refreshed daily; the collector updates them weekly.
      let lyr = await idb.get("lyrics.json");
      if (!lyr || force || Date.now() - lyr.fetched > 864e5) {
        say("أنزّل فهرس كلمات القصائد…", 1);
        const data = await fetchData("lyrics.json", true);
        if (data) { lyr = { fetched: Date.now(), data }; await idb.put("lyrics.json", lyr); }
      }
      worker.postMessage({ type: "load", shards, poems: poemsDoc.poems || [], lyrics: lyr?.data || null });
      await ready;
      return info;
    })().catch((e) => { worker.postMessage({ type: "load", shards: [], poems: [], lyrics: null }); throw e; }));
  }

  /* Seconds → "13:55" in Arabic digits' companion form (the apps convert digits themselves). */
  const clock = (s) => { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  root.QLib = { SECTIONS, store, fetchData, chosen, ask, load, info, ready: () => ready, clock };
})(window);
