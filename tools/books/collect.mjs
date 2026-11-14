/* The books library's catalogue: one list from several libraries, the same book once with all its sources.
     node tools/books/collect.mjs <data-dir>
   - «مكتبة مدرسة الفقاهة» (ar.lib.eshia.ir): its list of books weekly, and each book's card (author's year of death,
     language) a part at a time. Searching inside its books is done by its own search engine, which the app opens.
   - «شبكة الفكر» (alfeker.net) and «كتب شيعية» (shiabooks.net): their whole lists, every run (a few minutes).
   Kept in <data-dir>: catalog.json (for the app) and state.json. Run by .github/workflows/books.yml. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as E from "./eshia.mjs";
import { alfeker, shiabooks, ablibrary, hassanain, husseini, kadhim, najafDesert, maaref, turath, jawadain } from "./sources.mjs";
import { merge, FIELDS } from "./merge.mjs";
import { telegram, CHANNELS, LIBRARY_CHANNELS } from "./telegram.mjs";

const require = createRequire(import.meta.url);
const W = require("../../books/words.js");

const DIR = process.argv[2] || "books-data";
const MINUTES = +process.env.BOOKS_MINUTES || 60;
const RATE = +process.env.BOOKS_RATE || 1.5;
const PUBLISH = process.env.BOOKS_PUBLISH || "";
const UA = "Mozilla/5.0 (compatible; qasida-books/1.0; +https://github.com/sa89588/qasida)";
const t0 = Date.now(), deadline = t0 + MINUTES * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

fs.mkdirSync(DIR, { recursive: true });
const P = (f) => path.join(DIR, f);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), "utf8")); } catch { return d; } };
const state = readJSON("state.json", { catalogAt: 0, books: {} });
state.sources = state.sources || {};

/* ---------- polite fetching (one request at a time per host, RATE per second) ---------- */
const nextAt = new Map();
const stats = { req: 0, fail: 0 };
async function get(url) {
  const host = new URL(url).host;
  for (let k = 0; k < 4; k++) {
    const now = Date.now(), at = nextAt.get(host) || 0, wait = Math.max(0, at - now);
    nextAt.set(host, Math.max(now, at) + 1000 / RATE);
    if (wait) await sleep(wait);
    try {
      stats.req++;
      const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ar" }, signal: AbortSignal.timeout(40000) });
      if (r.status === 404 || r.status === 400) return null;
      if (r.status === 429 || r.status >= 500) { await sleep(10000 * (k + 1)); continue; }
      if (!r.ok) return null;
      return await r.text();
    } catch { await sleep(4000 * (k + 1)); }
  }
  stats.fail++;
  return null;
}

/* ---------- مكتبة مدرسة الفقاهة ---------- */
async function eshiaCatalogue() {
  const CAT_VERSION = 2;
  if (Object.keys(state.books).length && Date.now() - state.catalogAt < 7 * 864e5 && state.catVersion === CAT_VERSION) return;
  const html = await get(E.BASE + "/all");
  const all = html ? E.parseAll(html) : [];
  if (all.length < 1000) { log("eshia: list not read", all.length); return; }
  for (const b of all) { const o = state.books[b.id] || (state.books[b.id] = {}); o.t = b.title; o.a = b.author; o.v = b.vols; }
  for (let ci = 0; ci < E.CATEGORIES.length; ci++) {
    const cat = E.CATEGORIES[ci], url = E.BASE + "/" + encodeURIComponent(cat);
    let ids = (await get(url + "/all").then((h) => (h ? E.parseCategory(h) : [])));
    if (ids.length < 5) {
      const top = await get(url);
      if (top) { ids = ids.concat(E.parseCategory(top)); for (const sub of E.subCategories(top, cat).slice(0, 40)) { const hs = await get(url + "/" + encodeURIComponent(sub)); if (hs) ids = ids.concat(E.parseCategory(hs)); } }
    }
    log("eshia field", cat, ids.length);
    for (const id of ids) if (state.books[id]) state.books[id].c = ci;
  }
  state.catalogAt = Date.now(); state.catVersion = CAT_VERSION;
  log("eshia:", all.length, "books");
}
const latin = (s) => /^[\x00-\x7f\s]+$/.test(s);
async function eshiaCard(id) {
  const b = state.books[id];
  if (latin(b.t)) { b.lang = "en"; return; }
  const land = await get(E.BASE + "/" + id);
  if (!land) return;
  const nav = E.parseNav(land);
  const vols = nav.volumes.filter((v) => v > 0);
  b.card = E.parseCard(land);
  if (b.c == null) { const f = E.fieldOfSubject(b.card.subject); if (f != null) b.c = f; }
  const v = vols[0] ?? nav.volumes[0] ?? 1;
  const vc = nav.vol === v && nav.page === 0 ? land : await get(`${E.BASE}/${id}/${v}/0`);
  const vn = vc ? E.parseNav(vc) : {};
  const first = vn.next ?? 1, last = vn.last ?? first;
  const probe = await get(`${E.BASE}/${id}/${v}/${Math.min(last, first + 8)}`);
  b.lang = (probe && W.lang(E.pageText(probe))) || "ar?";
}

/* ---------- the catalogue for the app ---------- */
const LIBRARIES = {
  e: { name: "مكتبة مدرسة الفقاهة", url: "https://ar.lib.eshia.ir/" },
  a: { name: "مكتبة أهل البيت (ع)", url: "https://ablibrary.net/" },
  f: { name: "شبكة الفكر", url: "https://alfeker.net/" },
  s: { name: "كتب شيعية", url: "https://shiabooks.net/" },
  h: { name: "شبكة الإمامين الحسنين", url: "https://www.alhassanain.org/arabic/?com=book" },
  i: { name: "إصدارات العتبة الحسينية", url: "https://publication.imamhussain.org/books" },
  k: { name: "مكتبة الإمام الكاظم (ع)", url: "https://www.imamkadhim.com/" },
  n: { name: "مكتبة صحراء النجف", url: "https://najafdesertlibrary.com/" },
  m: { name: "مكتبة ودار مخطوطات العتبة العباسية (موقع التراث الرقمي)", url: "https://bibliography.mk.iq/" },
  u: { name: "الهيأة العليا لإحياء التراث (العتبة العباسية)", url: "https://turath.alkafeel.net/books" },
  j: { name: "المكتبة الإلكترونية للعتبة الكاظمية", url: "https://www.aljawadain.org/library/main" },
  t: { name: "قنوات التلكرام", url: "https://t.me/" }
};
const ESHIA_FIELD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 10, 10, 11, 13, 12];   // eshia's fields → ours
function eshiaRows() {
  return Object.entries(state.books).map(([id, b]) => ({ src: "e", id: +id, title: b.t, label: b.t, author: b.a === "---" ? "" : b.a, vols: b.v,
    field: b.c != null && b.c >= 0 ? FIELDS[ESHIA_FIELD[b.c]] : (b.card && b.card.subject) || "", lang: b.lang || "",
    died: (b.card && b.card.died) || 0, fullAuthor: (b.card && b.card.author) || "", topics: "" }));
}
function write() {
  const tg = state.tg || { files: [], lessons: {} };
  const tgRows = tg.files.map((f) => ({ src: "t", id: f.ch + "/" + f.post, title: f.title, label: [f.title !== f.file.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ") ? f.file : "", f.size].filter(Boolean).join(" · ") || f.title,
    author: "", field: "", topics: "", paper: f.ch === "Karbala_Center", lang: /[پچژگ]|[یک]/.test(f.title) && !/[ي]/.test(f.title) ? "fa" : "ar" }));
  const rows = [...eshiaRows(), ...Object.values(state.sources).flat(), ...tgRows];
  const entries = merge(rows);
  const books = entries.map((e) => [e.title, e.author, e.field, e.lang, e.died, e.fullAuthor, e.topics, e.sources, e.kind]);
  // Lesson and library channels on Telegram: [username, what it is, the channel that listed it]
  const lessons = Object.values(tg.lessons || {}).filter((l) => !l.dead && l.kind !== "user")
    .map((l) => [l.u, l.d, l.ch, l.t || "", l.n || "", l.x || ""]).sort((a, b) => (a[3] || a[1]).localeCompare(b[3] || b[1], "ar"));
  // Book libraries on Telegram (many show no posts on the web: the app opens them in Telegram).
  const libraries = LIBRARY_CHANNELS.map((c) => { const p = (tg.libs || {})[c.u] || {}; return [c.u, p.t || c.name, p.n || "", p.x || c.note || "", c.name]; });
  const counts = {}; for (const r of rows) counts[r.src] = (counts[r.src] || 0) + 1;
  fs.writeFileSync(P("catalog.json"), JSON.stringify({ format: 2, updated: new Date().toISOString(), fields: FIELDS,
    sources: Object.fromEntries(Object.entries(LIBRARIES).map(([k, v]) => [k, { ...v, count: counts[k] || 0 }])),
    channels: CHANNELS.map((c) => [c.ch, c.name]),
    columns: ["title", "author", "field", "lang", "died", "fullAuthor", "topics", "sources[[src,id,volumes,label]]", "kind b|r|j"], books, lessons, libraries }));
  // The page-text index of earlier versions is no longer used.
  fs.rmSync(P("seg"), { recursive: true, force: true }); fs.rmSync(P("index.json"), { force: true });
  fs.writeFileSync(P("state.json"), JSON.stringify(state));
  log("catalogue:", rows.length, "rows →", books.length, "books", counts);
  if (PUBLISH) { try { require("node:child_process").execSync(PUBLISH, { stdio: "inherit" }); } catch (e) { log("publish failed", e.message); } }
}

async function main() {
  await eshiaCatalogue();
  // Each library's whole list, in parallel (each host is asked politely on its own); a failed read keeps the last list.
  // [reader, fewest books for a good read, days between reads] — the big page-by-page lists weekly.
  const LIBS = { f: [alfeker, 1000, 1], s: [shiabooks, 1000, 1], a: [ablibrary, 1000, 1], h: [hassanain, 100, 1], i: [husseini, 30, 1], k: [kadhim, 20, 1],
    n: [najafDesert, 1000, 1], m: [maaref, 2000, 7], u: [turath, 30, 7], j: [jawadain, 300, 7] };
  state.sourcesAt = state.sourcesAt || {};
  await Promise.all(Object.entries(LIBS).map(async ([k, [fn, min, days]]) => {
    if (state.sources[k] && Date.now() - (state.sourcesAt[k] || 0) < days * 864e5 - 3 * 3600e3) return;
    const rows = await fn(get, log).catch((e) => { log(k, "failed", e.message); return null; });
    if (rows && rows.length >= min) { state.sources[k] = rows; state.sourcesAt[k] = Date.now(); } else log(k, "kept the previous list", rows ? rows.length : 0);
  }));
  // Telegram channels (a part each run, then only what is new).
  state.tg = state.tg || {};
  await telegram(get, log, state.tg, +process.env.BOOKS_TG_REQUESTS || 1800).catch((e) => log("telegram failed", e.message));
  write();
  // Cards of eshia's books, until the time is up (the most read fields first).
  const ids = Object.keys(state.books).filter((id) => !state.books[id].lang).sort((a, b) => (state.books[a].c ?? 99) - (state.books[b].c ?? 99) || a - b);
  let n = 0;
  for (const id of ids) { if (Date.now() > deadline - 3 * 60e3) break; await eshiaCard(id); if (++n % 300 === 0) log("cards", n); }
  if (n) write();
  log("done:", stats, "| cards", n, "| without card", Object.values(state.books).filter((b) => !b.lang).length, "| minutes", ((Date.now() - t0) / 60e3).toFixed(1));
}
main().catch((e) => { console.error(e); process.exit(1); });
