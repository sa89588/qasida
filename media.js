/* Saved recordings on this phone (IndexedDB): audio downloaded for offline listening,
   and audio or video files the user picked from the phone. */
(function (root) {
  "use strict";
  const DB = "qasida-media", STORE = "media";
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!root.indexedDB) { rej(new Error("no-idb")); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "key" }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode); const s = t.objectStore(STORE);
      const out = fn(s);
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("abort"));
    });
  }
  const put = (key, blob, meta = {}) => tx("readwrite", (s) => s.put({ key, blob, size: blob.size, type: blob.type, savedAt: Date.now(), ...meta }));
  const get = (key) => tx("readonly", (s) => s.get(key));
  const del = (key) => tx("readwrite", (s) => s.delete(key));
  const keys = () => tx("readonly", (s) => s.getAllKeys());
  const clear = () => tx("readwrite", (s) => s.clear());
  async function list() {
    const all = await tx("readonly", (s) => s.getAll());
    return (all || []).map(({ blob, ...m }) => m);
  }
  /* Download a remote audio file into the phone. Fails with code "cors" when the source does not allow it. */
  async function saveRemote(url, meta, onProgress) {
    let res;
    try { res = await fetch(url, { mode: "cors", credentials: "omit" }); }
    catch { const e = new Error("cors"); e.code = navigator.onLine === false ? "offline" : "cors"; throw e; }
    if (!res.ok) { const e = new Error("http"); e.code = "http"; throw e; }
    const total = +res.headers.get("content-length") || 0;
    let blob;
    if (res.body && res.body.getReader && onProgress) {
      const reader = res.body.getReader(); const parts = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got, total); }
      blob = new Blob(parts, { type: res.headers.get("content-type") || "audio/mpeg" });
    } else blob = await res.blob();
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    await put(url, blob, meta);
    return blob;
  }
  async function usage() {
    const items = await list();
    return { count: items.length, bytes: items.reduce((a, b) => a + (b.size || 0), 0) };
  }
  root.QMedia = { put, get, del, keys, clear, list, saveRemote, usage };
})(self);
