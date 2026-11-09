/* The books library: catalogue of «مكتبة مدرسة الفقاهة» (Arabic edition) and a word index of its Arabic books,
   page by page. Run by .github/workflows/books.yml; each run continues where the last one stopped.
     node tools/books/crawl.mjs <data-dir>
   Kept in <data-dir>: catalog.json (for the app), index.json (segments + which pages they cover), seg/…, state.json.
   No page text is kept: only word codes (books/words.js) and page numbers; the app links to the page at its source. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as E from "./eshia.mjs";
import { writeSegment, mergeSegments } from "./segment.mjs";

const require = createRequire(import.meta.url);
const W = require("../../books/words.js");
const M = require("../../match.js");

const DIR = process.argv[2] || "books-data";
const MINUTES = +process.env.BOOKS_MINUTES || 300;
const RATE = +process.env.BOOKS_RATE || 2;                 // requests per second, at most
const CHECKPOINT = (+process.env.BOOKS_CHECKPOINT || 70) * 60e3;
const CARD_SHARE = +process.env.BOOKS_CARD_SHARE || 0.3;   // part of a run spent on books' cards until all are read
const PUBLISH = process.env.BOOKS_PUBLISH || "";           // a script that publishes <data-dir> (run at checkpoints)
const UA = "Mozilla/5.0 (compatible; qasida-books/1.0; +https://github.com/sa89588/qasida)";
const t0 = Date.now(), deadline = t0 + MINUTES * 60e3;
const left = () => deadline - Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

fs.mkdirSync(DIR, { recursive: true });
const P = (f) => path.join(DIR, f);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), "utf8")); } catch { return d; } };
const writeJSON = (f, v) => fs.writeFileSync(P(f), JSON.stringify(v));
const state = readJSON("state.json", { catalogAt: 0, books: {}, progress: {}, nextDoc: 0, segN: 0 });
const index = readJSON("index.json", { format: 1, source: E.BASE, docs: 0, segments: [], vols: [] });

/* ---------- polite fetching ---------- */
let nextAt = 0;
const stats = { req: 0, fail: 0, pages: 0 };
async function get(url) {
  for (let k = 0; k < 4; k++) {
    const now = Date.now(), wait = Math.max(0, nextAt - now);
    nextAt = Math.max(now, nextAt) + 1000 / RATE;
    if (wait) await sleep(wait);
    try {
      stats.req++;
      const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ar" }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) { await sleep(10000 * (k + 1)); continue; }
      if (!r.ok) return null;
      return await r.text();
    } catch { await sleep(4000 * (k + 1)); }
  }
  stats.fail++;
  return null;
}

/* ---------- the catalogue ---------- */
async function catalogue() {
  if (Object.keys(state.books).length && Date.now() - state.catalogAt < 7 * 864e5) return;
  const html = await get(E.BASE + "/all");
  const all = html ? E.parseAll(html) : [];
  if (all.length < 1000) { log("catalogue: list not read", all.length); return; }
  for (const b of all) {
    const o = state.books[b.id] || (state.books[b.id] = {});
    o.t = b.title; o.a = b.author; o.v = b.vols;
  }
  for (let ci = 0; ci < E.CATEGORIES.length; ci++) {
    const h = await get(E.BASE + "/" + encodeURIComponent(E.CATEGORIES[ci]) + "/all");
    for (const id of h ? E.parseCategory(h) : []) if (state.books[id] && state.books[id].c == null) state.books[id].c = ci;
  }
  state.catalogAt = Date.now();
  log("catalogue:", all.length, "books");
}

/* ---------- which books first ---------- */
// The books studied and cited most in the Hawza, read first; then the rest, field by field, the oldest authors first.
const CORE = ["الكافي", "من لا يحضره الفقيه", "تهذيب الاحكام", "الاستبصار", "وسائل الشيعه", "مستدرك الوسائل", "بحار الانوار", "نهج البلاغه",
  "الصحيفه السجاديه", "جامع احاديث الشيعه", "الوافي", "شرائع الاسلام", "اللمعه الدمشقيه", "الروضه البهيه", "العروه الوثقي", "منهاج الصالحين",
  "جواهر الكلام", "المكاسب", "كتاب الطهاره", "مستمسك العروه", "الحدائق الناضره", "مصباح الفقيه", "تحرير الوسيله", "مختلف الشيعه", "تذكره الفقهاء",
  "فرائد الاصول", "كفايه الاصول", "اصول الفقه", "دروس في علم الاصول", "معالم الدين", "فوائد الاصول", "اجود التقريرات", "مصباح الاصول", "نهايه الدرايه",
  "المنطق", "بدايه الحكمه", "نهايه الحكمه", "الحكمه المتعاليه", "شرح المنظومه", "كشف المراد", "الباب الحادي عشر", "عقائد الاماميه", "اوائل المقالات",
  "تصحيح اعتقادات الاماميه", "الاعتقادات", "الميزان في تفسير القران", "مجمع البيان", "التبيان في تفسير القران", "تفسير القمي", "تفسير العياشي",
  "تفسير نور الثقلين", "البرهان في تفسير القران", "الارشاد", "الامالي", "كمال الدين", "عيون اخبار الرضا", "الخصال", "التوحيد", "معاني الاخبار",
  "ثواب الاعمال", "علل الشرائع", "كامل الزيارات", "الغيبه", "الاحتجاج", "مصباح المتهجد", "اقبال الاعمال", "المزار", "رجال النجاشي", "رجال الطوسي",
  "الفهرست", "اختيار معرفه الرجال", "معجم رجال الحديث", "جامع السعادات", "المحجه البيضاء", "اللهوف", "مقاتل الطالبيين", "نفس المهموم",
  "المراجعات", "الغدير", "مغني اللبيب", "شرح ابن عقيل", "مختصر المعاني", "المطول"].map(M.compact);
const ORDER = [0, 1, 3, 4, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];   // field order: fiqh, usul, hadith, aqaid, quran, akhlaq…
function priority(id) {
  const b = state.books[id], k = M.compact(b.t);
  const core = CORE.findIndex((c) => k === c || k.startsWith(c));
  if (core >= 0) return core;
  const field = b.c == null ? 99 : ORDER.indexOf(b.c);
  return 1000 + field * 100000 + Math.min(9999, (b.card && b.card.died) || 5000);
}
const latin = (s) => /^[\x00-\x7f\s]+$/.test(s);

/* ---------- a book's card and language ---------- */
async function card(id) {
  const b = state.books[id];
  if (latin(b.t)) { b.lang = "en"; b.card = b.card || {}; return; }
  const land = await get(E.BASE + "/" + id);
  if (!land) return;
  const nav = E.parseNav(land);
  b.vols = nav.volumes.filter((v) => v > 0);
  if (!b.vols.length) b.vols = nav.volumes.length ? nav.volumes : [1];
  b.card = E.parseCard(land);
  // The first real volume: its card gives the pages, and a page of it tells the language.
  const v = b.vols[0];
  const vc = nav.vol === v && nav.page === 0 ? land : await get(`${E.BASE}/${id}/${v}/0`);
  if (!vc) return;
  const vn = E.parseNav(vc);
  const first = vn.next ?? 1, last = vn.last ?? first;
  state.progress[id + ":" + v] = state.progress[id + ":" + v] || { first, last, next: first };
  const probe = await get(`${E.BASE}/${id}/${v}/${Math.min(last, first + 8)}`);
  b.lang = probe ? W.lang(E.pageText(probe)) || "" : "";
  if (!b.lang) { const p2 = await get(`${E.BASE}/${id}/${v}/${Math.min(last, first + 30)}`); b.lang = p2 ? W.lang(E.pageText(p2)) || "ar?" : "ar?"; }
}

/* ---------- the pages: words → codes → postings ---------- */
let postings = new Map(), runBase = state.nextDoc;
function add(doc, codes) { for (const c of codes) { const a = postings.get(c); if (a) a.push(doc); else postings.set(c, [doc]); } }
async function volume(id, v, until) {
  const key = id + ":" + v;
  let pr = state.progress[key];
  if (!pr) {
    const h = await get(`${E.BASE}/${id}/${v}/0`);
    if (!h) return false;
    const n = E.parseNav(h);
    pr = state.progress[key] = { first: n.next ?? 1, last: n.last ?? (n.next ?? 1), next: n.next ?? 1 };
  }
  if (pr.done) return true;
  const startPage = pr.next, firstDoc = state.nextDoc;
  let p = pr.next;
  const WINDOW = 3;
  while (p <= pr.last && Date.now() < until) {
    const batch = [];
    for (let k = 0; k < WINDOW && p + k <= pr.last; k++) batch.push(p + k);
    const htmls = await Promise.all(batch.map((x) => get(`${E.BASE}/${id}/${v}/${x}`)));
    htmls.forEach((h, k) => { const doc = state.nextDoc + (batch[k] - startPage); if (h) { const t = E.pageText(h); if (t) add(doc, W.codes(t)); stats.pages++; } });
    p += batch.length;
  }
  const n = p - startPage;
  if (n > 0) { index.vols.push([id, v, firstDoc, startPage, n]); state.nextDoc += n; }
  pr.next = p;
  if (p > pr.last) pr.done = true;
  return pr.done;
}

/* ---------- saving ---------- */
function checkpoint(final) {
  const docs = state.nextDoc - runBase;
  if (docs > 0) {
    const seg = writeSegment(DIR, { id: "s" + (state.segN++).toString(36), base: runBase, docs }, postings);
    index.segments.push(seg);
    log("segment", seg.id, "docs", docs, "words", postings.size, "postings", seg.postings, "bytes", seg.bytes, "buckets", seg.nb);
  }
  postings = new Map(); runBase = state.nextDoc;
  compact();
  index.docs = state.nextDoc;
  index.updated = new Date().toISOString();
  writeJSON("index.json", index);
  writeJSON("catalog.json", catalogForApp());
  writeJSON("state.json", state);
  if (PUBLISH) { try { require("node:child_process").execSync(PUBLISH, { stdio: "inherit" }); } catch (e) { log("publish failed", e.message); } }
}
/* Few segments for the app to read: neighbours merged while there are many, or the newest are small. */
function compact() {
  const segs = index.segments;
  const LIMIT = 10, BIG = 400000;
  for (;;) {
    let best = -1, size = Infinity;
    for (let i = 0; i + 1 < segs.length; i++) { const s = segs[i].docs + segs[i + 1].docs; if (s <= BIG && s < size) { size = s; best = i; } }
    const tooMany = segs.length > LIMIT;
    const smallTail = segs.length >= 3 && segs.slice(-3).every((s) => s.docs < 40000);
    if (best < 0 || !(tooMany || smallTail)) break;
    const i = smallTail && !tooMany ? segs.length - 2 : best;
    const m = mergeSegments(DIR, [segs[i], segs[i + 1]], "s" + (state.segN++).toString(36));
    segs.splice(i, 2, m);
    log("merged into", m.id, "docs", m.docs, "bytes", m.bytes);
  }
}
function catalogForApp() {
  const books = Object.entries(state.books).map(([id, b]) => [+id, b.t, b.a, b.v, b.c ?? -1, b.lang || "",
    (b.card && b.card.died) || 0, (b.card && b.card.author) || "", (b.card && b.card.subject) || "", (b.card && b.card.full) || ""]);
  return { format: 1, source: E.BASE, updated: new Date().toISOString(), cats: E.CATEGORIES.map((c) => c.replace(/_/g, " ")),
    fields: ["id", "title", "author", "volumes", "category", "lang", "died", "fullAuthor", "subject", "fullTitle"], books };
}

/* ---------- the run ---------- */
async function main() {
  await catalogue();
  const ids = Object.keys(state.books).map(Number).sort((a, b) => priority(a) - priority(b) || a - b);
  // Cards (and languages), most important books first, for part of the run.
  const cardUntil = Date.now() + left() * CARD_SHARE;
  let cards = 0;
  for (const id of ids) {
    if (Date.now() > cardUntil) break;
    if (state.books[id].lang) continue;
    await card(id); cards++;
    if (cards % 200 === 0) log("cards", cards);
  }
  log("cards read this run:", cards, "| without card:", ids.filter((id) => !state.books[id].lang).length);
  // Pages of the Arabic books, in order.
  let lastSave = Date.now();
  const stopAt = deadline - 4 * 60e3;
  outer: for (const id of ids.sort((a, b) => priority(a) - priority(b) || a - b)) {
    const b = state.books[id];
    if (!b.lang || !b.lang.startsWith("ar")) continue;
    for (const v of b.vols || [1]) {
      for (;;) {
        if (Date.now() > stopAt) break outer;
        const done = await volume(id, v, Math.min(stopAt, lastSave + CHECKPOINT));
        if (Date.now() >= lastSave + CHECKPOINT && Date.now() < stopAt) { checkpoint(false); lastSave = Date.now(); }
        if (done || state.progress[id + ":" + v] == null) break;           // finished, or its card could not be read
      }
    }
  }
  checkpoint(true);
  log("done:", stats, "| docs", state.nextDoc, "| segments", index.segments.length, "| minutes", ((Date.now() - t0) / 60e3).toFixed(1));
}
main().catch((e) => { console.error(e); try { checkpoint(true); } catch {} process.exit(1); });
