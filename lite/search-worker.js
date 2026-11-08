/* Search worker for the no-key version.
   Holds the ShiaVoice catalog (titles, reciters, albums — no lyrics) and the book index,
   and finds which poem a page photo or a typed fragment belongs to. Runs off the main thread. */
"use strict";
if (typeof importScripts === "function") importScripts("../match.js?v=13", "words.js?v=2");
const M = typeof QMatch !== "undefined" ? QMatch : require("../match.js");
const Wd = typeof QWords !== "undefined" ? QWords : require("./words.js");

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
let keyIndex = new Map();  // title key -> entry index
/* Poem words (hashed): which poem contains these words? */
let lyr = [], lyrPost = new Map(), lyrIdf = new Map(), lyrMass = [], lyrByTitle = new Map();

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
  keyIndex = new Map(entries.map((e, i) => [e.key, i]));
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

/* docs: the poem-words chunks (format 3: [key, title, reciter, poet, url, packed 4-char word codes]). */
function buildLyrics(docs) {
  lyr = [];
  for (const d of [].concat(docs || [])) for (const p of (d && d.poems) || [])
    lyr.push({ title: p[1], reciter: p[2], poet: p[3], url: p[4], h: Wd.unpack(p[5] || "") });
  const tmp = new Map();
  lyr.forEach((p, i) => { for (const h of p.h) { let a = tmp.get(h); if (!a) tmp.set(h, a = []); a.push(i); } });
  const N = lyr.length || 1;
  lyrPost = new Map(); lyrIdf = new Map();
  for (const [h, a] of tmp) { lyrPost.set(h, Int32Array.from(a)); lyrIdf.set(h, Math.log(1 + N / a.length)); }
  lyrMass = lyr.map((p) => p.h.reduce((sum, h) => sum + lyrIdf.get(h), 0));
  lyrByTitle = new Map(lyr.map((p, i) => [M.compact(p.title), i]));
  return lyr.length;
}

/* Words typed, spoken or read from a page → poems that contain them.
   Rare words count more than common ones (each word weighs log(1 + N/df)). */
function searchLyrics(text, typed) {
  if (!lyr.length) return [];
  const q = [...new Set(Wd.words(text).map(Wd.code))];
  if (!q.length) return [];
  const unknown = Math.log(1 + lyr.length);
  let qMass = 0;
  const mass = new Map(), count = new Map();
  for (const h of q) {
    const w = lyrIdf.get(h) ?? unknown; qMass += w;
    const a = lyrPost.get(h); if (!a) continue;
    for (const i of a) { mass.set(i, (mass.get(i) || 0) + w); count.set(i, (count.get(i) || 0) + 1); }
  }
  const out = [];
  for (const [i, m] of mass) {
    const n = count.get(i), cov = m / Math.min(qMass, lyrMass[i] || qMass);
    let s = 0;
    if (!typed) { if (n >= 5 && cov >= 0.3) s = 0.55 + 0.45 * Math.min(1, cov / 0.6); }
    else if (q.length === 1) s = 0.72;                                  // one word: every poem that has it
    else if (q.length <= 3) { if (n === q.length) s = 0.82; else if (n >= 2 && cov >= 0.6) s = 0.7; }
    else if (n >= 3 && cov >= 0.55) s = 0.55 + 0.45 * Math.min(1, cov);
    if (s) out.push({ i, s, cov });
  }
  out.sort((a, b) => b.s - a.s || b.cov - a.cov);
  return out.slice(0, 40);
}

/* The catalog entry (recordings) for a title: exact key first, then a close or longer spelling
   (catalog titles often carry the whole first line), preferring one sung by the same reciter. */
function entryFor(title, reciter) {
  const k = cleanTitle(title).replace(/\s+/g, "");
  if (keyIndex.has(k)) return keyIndex.get(k);
  const c = M.compact(title);
  if (keyIndex.has(c)) return keyIndex.get(c);
  const rk = M.poetKey(reciter || "");
  let best = -1, bestS = 0;
  for (const { i } of searchTyped(title)) {
    const key = entries[i].key;
    const close = M.dice(c, key) >= 0.86 || (Math.min(c.length, key.length) >= 6 && (key.startsWith(c) || c.startsWith(key)));
    if (!close) continue;
    let s = M.dice(c, key);
    if (rk.length >= 4 && entries[i].recs.some((ref) => M.dice(M.poetKey(rec(ref).artist), rk) >= 0.8)) s += 1;
    if (s > bestS) { bestS = s; best = i; }
  }
  return best;
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
  const qn2 = cleanTitle(text);
  const { hits, touched } = overlap(q);
  for (const i of touched) {
    const e = entries[i];
    const inTitle = hits[i] / qn, titleInQ = hits[i] / lens[i];
    if (inTitle < 0.5 && titleInQ < 0.7) continue;
    // Whole words only: "نيوتن" must not match "يبني وتنظر" through the joined letters.
    const wordIn = (" " + e.title + " ").includes(" " + qn2 + " ");
    const inner = !wordIn && e.key.includes(q);
    const contains = q.includes(e.key) && e.key.length >= 6 && (" " + qn2 + " ").includes(" " + e.title + " ");
    let s = Math.max(M.dice(q, e.key), wordIn ? 0.92 : 0, inner ? 0.6 : 0,
      contains ? 0.6 + 0.3 * (e.key.length / q.length) : 0, inTitle * 0.85 * (wordIn || contains ? 1 : 0.85));
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
    const recs = [];
    for (const t of [p.title].concat(p.aliases || [])) {
      const idx = keyIndex.get(cleanTitle(t).replace(/\s+/g, ""));
      if (idx != null && !seen.has(idx)) { seen.add(idx); for (const ref of entries[idx].recs) recs.push(rec(ref)); }
    }
    results.push({ title: p.title, score: Math.min(1, s + 0.05), book: p, recs: sortRecs(recs, text).slice(0, 60), total: recs.length });
  }
  // Poems whose words contain what was typed or read: the original poem, then its recordings by title.
  const lyrSeen = new Set();
  const titleScore = new Map(found.map((x) => [x.i, x.s]));
  for (const { i, s } of searchLyrics(text, typed)) {
    const L = lyr[i];
    const tk = M.compact(L.title);
    if (lyrSeen.has(tk)) continue; lyrSeen.add(tk);
    const idx = entryFor(L.title, L.reciter);
    let recs = [];
    if (idx >= 0) { if (seen.has(idx)) continue; seen.add(idx); recs = entries[idx].recs.map(rec); }
    results.push({ title: L.title, score: Math.min(1, Math.max(s, idx >= 0 ? titleScore.get(idx) || 0 : 0)), lyric: { url: L.url, poet: L.poet, reciter: L.reciter },
      recs: sortRecs(recs, text + " " + L.reciter).slice(0, 60), total: recs.length });
    if (results.length >= 12) break;
  }
  for (const { i, s } of found) {
    if (results.length >= 14) break;
    if (seen.has(i)) continue;
    seen.add(i);
    const e = entries[i];
    const recs = e.recs.map(rec);
    results.push({ title: e.recs.length ? recs[0].title : e.title, key: e.key, score: Math.min(1, s), recs: sortRecs(recs, text).slice(0, 60), total: recs.length });
  }
  // A title match whose poem text we also have: offer its words.
  for (const r of results) if (!r.lyric && !r.book) {
    const ct = M.compact(r.title);
    let li = lyrByTitle.get(r.key) ?? lyrByTitle.get(ct);
    if (li == null && ct.length >= 8) {                       // catalog titles often run on into the first line
      const rk = M.poetKey(r.recs[0]?.artist || "");
      li = lyr.findIndex((L) => { const lt = M.compact(L.title); return lt.length >= 6 && ct.startsWith(lt) && (!rk || !L.reciter || M.dice(M.poetKey(L.reciter), rk) >= 0.6 || r.recs.some((x) => M.dice(M.poetKey(x.artist), M.poetKey(L.reciter)) >= 0.8)); });
      if (li < 0) li = null;
    }
    if (li != null) r.lyric = { url: lyr[li].url, poet: lyr[li].poet, reciter: lyr[li].reciter };
  }
  // Display title: the most common original spelling among the recordings.
  for (const r of results) if (!r.book && !r.lyric && r.recs.length) {
    const count = new Map(); for (const x of r.recs) count.set(x.title, (count.get(x.title) || 0) + 1);
    r.title = [...count].sort((a, b) => b[1] - a[1])[0][0];
  }
  return results.map((r, n) => [r, n]).sort((a, b) => b[0].score - a[0].score || a[1] - b[1]).map((x) => x[0]);
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
      if (m.type === "load") { SHARDS = m.shards; const info = build(m.shards, m.poems); info.poems = buildLyrics(m.lyrics); self.postMessage({ type: "ready", ...info }); }
      else if (m.type === "query") { const results = query(m.text, m.typed); const artist = m.typed ? byArtist(m.text) : null; self.postMessage({ type: "result", id: m.id, results, artist }); }
    } catch (e) { self.postMessage({ type: "error", id: m.id, message: String(e && e.message || e) }); }
  };
} else {
  module.exports = { build: (s, p, l) => { SHARDS = s; const r = build(s, p); r.poems = buildLyrics(l); return r; }, query, cleanTitle, byArtist, searchLyrics };
}
