/* Audio sources besides YouTube. ShiaVoice: search through the user's small proxy
   (or, without one, by asking Gemini to read the public search page), then play with
   ShiaVoice's own embeddable player. */
(function (root) {
  "use strict";
  const M = root.QMatch;
  const LS_W = "qasida.worker.v1", LS_C = "qasida.svCache.v1";
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  };
  const worker = () => String(ls.get(LS_W, "") || "").trim().replace(/\/+$/, "");
  const setWorker = (u) => ls.set(LS_W, String(u || "").trim());
  const available = () => !!worker() || (root.QSmart && root.QSmart.ready());

  async function viaWorker(q, signal) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    if (signal) signal.addEventListener("abort", () => ctl.abort(), { once: true });
    try {
      const r = await fetch(worker() + "/shiavoice?q=" + encodeURIComponent(q), { signal: ctl.signal });
      if (!r.ok) { const e = new Error("worker"); e.code = "worker_" + r.status; throw e; }
      const j = await r.json();
      return Array.isArray(j.items) ? j.items : [];
    } catch (e) { if (signal && signal.aborted) { const c = new Error("cancelled"); c.code = "cancelled"; throw c; } if (!e.code) e.code = "worker_down"; throw e; }
    finally { clearTimeout(t); }
  }
  async function svSearch(q, signal) {
    const key = M.compact(q);
    const cache = ls.get(LS_C, {});
    if (cache[key] && Date.now() - cache[key].t < 3 * 864e5) return cache[key].items;
    let items;
    if (worker()) items = await viaWorker(q, signal);
    else if (root.QSmart && root.QSmart.ready()) items = await root.QSmart.readShiavoiceSearch(q, signal);
    else { const e = new Error("no_source"); e.code = "no_source"; throw e; }
    items = items.filter((x) => x && /^[A-Za-z0-9]{3,12}$/.test(x.id)).map((x) => ({ id: x.id, title: String(x.title || "").slice(0, 160), artist: String(x.artist || "").slice(0, 80), duration: String(x.duration || "").slice(0, 10) }));
    const c2 = ls.get(LS_C, {}); c2[key] = { t: Date.now(), items };
    const ks = Object.keys(c2); if (ks.length > 80) for (const k of ks.slice(0, ks.length - 80)) delete c2[k];
    ls.set(LS_C, c2);
    return items;
  }
  function rank(item, info) {
    const t = M.compact(item.title);
    if (t.length < 3) return 0;
    const needles = [info.title, info.opening, info.refrain, ...(info.queries || []).slice(0, 2), ...(info.verses || []).slice(0, 3).map((v) => v[0])]
      .map((s) => M.compact(s)).filter((s) => s.length >= 4);
    let s = 0;
    for (const n of needles) {
      s = Math.max(s, M.dice(t, n));
      if (t.length >= 5 && n.includes(t)) s = Math.max(s, 0.9);     // the track title is the poem's title or opening
      if (n.length >= 5 && t.includes(n)) s = Math.max(s, 0.9);     // the track title contains the poem's title
      if (t.length >= 6) s = Math.max(s, M.fuzzyContains(n, t) * 0.92);
    }
    const rec = M.poetKey(info.reciter || "");
    if (rec.length >= 4 && M.poetKey(item.artist).includes(rec)) s += 0.08;
    return Math.min(s, 1.1);
  }
  async function findShiavoice(info, signal) {
    const qs = [...new Set([info.title, info.opening, info.refrain].map((q) => String(q || "").trim()).filter((q) => q.length >= 3))].slice(0, 2);
    if (!qs.length && info.queries && info.queries[0]) qs.push(info.queries[0]);
    const res = await Promise.allSettled(qs.map((q) => svSearch(q, signal)));
    const seen = new Map();
    for (const r of res) if (r.status === "fulfilled") for (const it of r.value) if (!seen.has(it.id)) seen.set(it.id, { ...it, score: rank(it, info) });
    if (!seen.size) { const bad = res.find((r) => r.status === "rejected"); if (bad) throw bad.reason; }
    return [...seen.values()].filter((x) => x.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 4);
  }
  async function test() {
    const items = await viaWorker("غضب رب العباد");
    return items.length;
  }
  root.QSources = { worker, setWorker, available, hasWorker: () => !!worker(), findShiavoice, test };
})(self);
