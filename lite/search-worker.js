/* Search worker for the no-key version.
   Holds the ShiaVoice catalog (titles, reciters, albums — no lyrics) and the book index,
   and finds which poem a page photo or a typed fragment belongs to. Runs off the main thread. */
"use strict";
if (typeof importScripts === "function") importScripts("../match.js?v=13");
const M = typeof QMatch !== "undefined" ? QMatch : require("../match.js");

/* How much each section counts when several fit equally well: Husayni poetry first. */
const SECTION_WEIGHT = { letmiat: 1, qesaed: 0.99, enashid: 0.95, afrah: 0.93, zeyarat: 0.9, ed3ie: 0.9, other: 0.9,
  mohadrat: 0.8, khotab: 0.8, athan: 0.75, quran: 0.75, hawza: 0.7, kutub: 0.7 };

const NOISE = new RegExp("(^|\\s)(" + [
  "لطميه", "لطميات", "لطمه", "قصيده", "قصائد", "نعي", "نعاوي", "موشح", "انشوده", "اناشيد", "نشيد", "الرادود", "رادود",
  "الملا", "ملا", "الشيخ", "السيد", "الحاج", "الشاعر", "ردات", "رده", "جديد", "جديده", "حصريا", "حصري", "كامله", "كامل",
  "مقطع", "بصوت", "اداء", "الاصدار", "اصدار", "البوم", "ه", "هـ", "مع", "و"
].join("|") + ")(?=\\s|$)", "g");

let entries = [];          // one entry per distinct poem title: { key, title, recs: [rowRef], weight }
let post = new Map();      // trigram -> Int32Array of entry indexes
let lens = null;           // trigram count of each entry key
let artists = [];          // per shard
let shardInfo = [];        // [{section, artists, albums}]
let book = [];             // poems.json entries (curated, with Rafed audio)

function cleanTitle(title, artist) {
  let t = String(title || "").replace(/\([^)]*\)|\[[^\]]*\]|«|»/g, " ");
  t = M.norm(t).replace(/[0-9]+/g, " ");
  const a = M.norm(artist || "").replace(/[0-9]+/g, " ").trim();
  if (a.length >= 5) t = t.split(a).join(" ");
  for (let i = 0; i < 3; i++) t = t.replace(NOISE, " ");
  return t.replace(/\s+/g, " ").trim();
}
function trigrams(s) { const set = new Set(); for (let i = 0; i + 3 <= s.length; i++) set.add(s.slice(i, i + 3)); return set; }

function build(shards, poems) {
  shardInfo = []; entries = []; book = poems || [];
  const byKey = new Map();
  let tracks = 0;
  shards.forEach((sh, si) => {
    shardInfo.push({ section: sh.section, artists: sh.artists || [], albums: sh.albums || {} });
    for (let ri = 0; ri < sh.rows.length; ri++) {
      const r = sh.rows[ri]; tracks++;
      const artist = sh.artists[r[2]] || "";
      const clean = cleanTitle(r[1], artist);
      let key = clean.replace(/\s+/g, "");
      if (key.length < 4) key = M.compact(r[1]);
      if (key.length < 3) continue;
      let e = byKey.get(key);
      if (!e) { e = { key, title: clean || M.norm(r[1]), shown: r[1], recs: [], weight: 0 }; byKey.set(key, e); entries.push(e); }
      e.recs.push((si << 20) | ri);
      e.weight = Math.max(e.weight, SECTION_WEIGHT[sh.section] ?? 0.85);
    }
  });
  // Inverted index on character trigrams of each title key.
  const tmp = new Map();
  lens = new Uint16Array(entries.length);
  entries.forEach((e, i) => {
    const g = trigrams(e.key); lens[i] = g.size;
    for (const t of g) { let a = tmp.get(t); if (!a) tmp.set(t, a = []); a.push(i); }
  });
  post = new Map();
  for (const [t, a] of tmp) post.set(t, Int32Array.from(a));
  return { entries: entries.length, tracks };
}

function rec(ref) {
  const si = ref >>> 20, ri = ref & 0xfffff, sh = shardInfo[si], r = SHARDS[si].rows[ri];
  return { id: r[0], title: r[1], artist: sh.artists[r[2]] || "", dur: r[3], album: sh.albums[r[4]] || "", section: sh.section };
}
let SHARDS = [];

/* Count, for every entry, how many of its trigrams occur in `q`. */
function overlap(q) {
  const hits = new Uint16Array(entries.length), touched = [];
  for (const t of trigrams(q)) {
    const a = post.get(t); if (!a) continue;
    for (let k = 0; k < a.length; k++) { const i = a[k]; if (hits[i]++ === 0) touched.push(i); }
  }
  return { hits, touched };
}

/* A photographed page: which known titles appear inside its text? */
function searchPage(text) {
  const hay = M.compact(text);
  if (hay.length < 8) return [];
  const lines = String(text).split(/\n+/).map(M.compact).filter((l) => l.length >= 3);
  const head = lines.slice(0, 4).join("");
  const { hits, touched } = overlap(hay);
  const cand = [];
  for (const i of touched) {
    const e = entries[i], L = e.key.length;
    if (L < 7) continue;                                   // «يا حسين» alone appears on almost every page
    const c = hits[i] / lens[i];
    if (c >= 0.55) cand.push([i, c * (0.8 + 0.2 * Math.min(1, L / 18))]);
  }
  cand.sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [i] of cand.slice(0, 150)) {
    const e = entries[i];
    let s = M.fuzzyContains(hay, e.key);
    if (s < 0.72) continue;
    if (head && M.fuzzyContains(head, e.key) >= 0.8) s += 0.06;  // titles sit at the top of the page
    s *= 0.85 + 0.15 * Math.min(1, e.key.length / 20);           // longer titles are more telling
    s *= e.weight;
    s += Math.min(0.04, e.recs.length * 0.004);                  // widely recorded poems are likelier
    out.push({ i, s });
  }
  return out;
}

/* A typed or spoken fragment: titles that contain it, or that it contains. */
function searchTyped(text) {
  const q = M.compact(text);
  if (q.length < 2) return [];
  const out = [];
  if (q.length < 4) {
    for (let i = 0; i < entries.length && out.length < 400; i++) if (entries[i].key.startsWith(q)) out.push({ i, s: 0.7 * entries[i].weight });
    return out;
  }
  const qn = trigrams(q).size || 1;
  const { hits, touched } = overlap(q);
  for (const i of touched) {
    const e = entries[i];
    const inTitle = hits[i] / qn, titleInQ = hits[i] / lens[i];
    if (inTitle < 0.5 && titleInQ < 0.7) continue;
    let s = Math.max(M.dice(q, e.key), e.key.includes(q) ? 0.92 : 0, q.includes(e.key) && e.key.length >= 6 ? 0.9 : 0, inTitle * 0.85);
    s *= e.weight;
    s += Math.min(0.04, e.recs.length * 0.004);
    if (s >= 0.5) out.push({ i, s });
  }
  // Also a reciter's name: their recordings, newest albums last.
  return out;
}

function sortRecs(list, text) {
  const hay = M.compact(text);
  return list.map((r) => {
    let s = SECTION_WEIGHT[r.section] ?? 0.85;
    if (r.dur && r.dur < 90) s -= 0.3;                           // clips and trailers last
    if (r.artist && hay.includes(M.compact(r.artist))) s += 0.3; // the reciter the user named
    return [s, r];
  }).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function query(text, typed) {
  const found = typed ? searchTyped(text) : searchPage(text);
  found.sort((a, b) => b.s - a.s);
  const results = [];
  const seen = new Set();
  // Curated book poems first when they fit: they carry poet, books and Rafed audio.
  const bm = book.map((p) => ({ p, s: M.scorePoem(p, text, typed) })).filter((x) => x.s >= 0.62).sort((a, b) => b.s - a.s).slice(0, 3);
  for (const { p, s } of bm) {
    const keys = [p.title].concat(p.aliases || []).map((t) => cleanTitle(t).replace(/\s+/g, ""));
    const recs = [];
    for (const k of keys) {
      const idx = entries.findIndex((e) => e.key === k);
      if (idx >= 0 && !seen.has(idx)) { seen.add(idx); for (const ref of entries[idx].recs) recs.push(rec(ref)); }
    }
    results.push({ title: p.title, score: Math.min(1, s + 0.05), book: p, recs: sortRecs(recs, text).slice(0, 60), total: recs.length });
  }
  for (const { i, s } of found) {
    if (seen.has(i)) continue;
    seen.add(i);
    const e = entries[i];
    const recs = e.recs.map(rec);
    results.push({ title: e.recs.length ? recs[0].title : e.title, key: e.key, score: Math.min(1, s), recs: sortRecs(recs, text).slice(0, 60), total: recs.length });
    if (results.length >= 12) break;
  }
  // Display title: the most common original spelling among the recordings.
  for (const r of results) if (!r.book && r.recs.length) {
    const count = new Map(); for (const x of r.recs) count.set(x.title, (count.get(x.title) || 0) + 1);
    r.title = [...count].sort((a, b) => b[1] - a[1])[0][0];
  }
  return results;
}

/* Recordings of one reciter (typed name). */
function byArtist(text) {
  const q = M.poetKey(text);
  if (q.length < 4) return null;
  let best = null;
  shardInfo.forEach((sh, si) => sh.artists.forEach((a, ai) => {
    const d = M.dice(q, M.poetKey(a));
    if (d >= 0.85 && (!best || d > best.d)) best = { d, name: a };
  }));
  return best;
}

if (typeof self !== "undefined" && typeof module === "undefined") {
  self.onmessage = (ev) => {
    const m = ev.data;
    try {
      if (m.type === "load") { SHARDS = m.shards; const info = build(m.shards, m.poems); self.postMessage({ type: "ready", ...info }); }
      else if (m.type === "query") { const results = query(m.text, m.typed); const artist = m.typed ? byArtist(m.text) : null; self.postMessage({ type: "result", id: m.id, results, artist }); }
    } catch (e) { self.postMessage({ type: "error", id: m.id, message: String(e && e.message || e) }); }
  };
} else {
  module.exports = { build: (s, p) => { SHARDS = s; return build(s, p); }, query, cleanTitle, byArtist };
}
