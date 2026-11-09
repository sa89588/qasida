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
import { alfeker, shiabooks } from "./sources.mjs";
import { merge, FIELDS } from "./merge.mjs";

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
const ESHIA_FIELD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 10, 10, 11, 13, 12];   // eshia's fields → ours
function eshiaRows() {
  return Object.entries(state.books).map(([id, b]) => ({ src: "e", id: +id, title: b.t, label: b.t, author: b.a === "---" ? "" : b.a, vols: b.v,
    field: b.c != null && b.c >= 0 ? FIELDS[ESHIA_FIELD[b.c]] : (b.card && b.card.subject) || "", lang: b.lang || "",
    died: (b.card && b.card.died) || 0, fullAuthor: (b.card && b.card.author) || "", topics: "" }));
}
function write() {
  const rows = [...eshiaRows(), ...(state.sources.f || []), ...(state.sources.s || [])];
  const entries = merge(rows);
  const books = entries.map((e) => [e.title, e.author, e.field, e.lang, e.died, e.fullAuthor, e.topics, e.sources]);
  const counts = { e: 0, f: 0, s: 0 }; for (const r of rows) counts[r.src]++;
  fs.writeFileSync(P("catalog.json"), JSON.stringify({ format: 2, updated: new Date().toISOString(), fields: FIELDS,
    sources: { e: { name: "مكتبة مدرسة الفقاهة", url: "https://ar.lib.eshia.ir/", count: counts.e }, f: { name: "شبكة الفكر", url: "https://alfeker.net/", count: counts.f },
      s: { name: "كتب شيعية", url: "https://shiabooks.net/", count: counts.s } },
    columns: ["title", "author", "field", "lang", "died", "fullAuthor", "topics", "sources[[src,id,volumes]]"], books }));
  // The page-text index of earlier versions is no longer used.
  fs.rmSync(P("seg"), { recursive: true, force: true }); fs.rmSync(P("index.json"), { force: true });
  fs.writeFileSync(P("state.json"), JSON.stringify(state));
  log("catalogue:", rows.length, "rows →", books.length, "books", counts);
  if (PUBLISH) { try { require("node:child_process").execSync(PUBLISH, { stdio: "inherit" }); } catch (e) { log("publish failed", e.message); } }
}

async function main() {
  await eshiaCatalogue();
  const f = await alfeker(get, log).catch((e) => { log("alfeker failed", e.message); return null; });
  if (f && f.length > 1000) state.sources.f = f;
  const s = await shiabooks(get, log).catch((e) => { log("shiabooks failed", e.message); return null; });
  if (s && s.length > 1000) state.sources.s = s;
  write();
  // Cards of eshia's books, until the time is up (the most read fields first).
  const ids = Object.keys(state.books).filter((id) => !state.books[id].lang).sort((a, b) => (state.books[a].c ?? 99) - (state.books[b].c ?? 99) || a - b);
  let n = 0;
  for (const id of ids) { if (Date.now() > deadline - 3 * 60e3) break; await eshiaCard(id); if (++n % 300 === 0) log("cards", n); }
  if (n) write();
  log("done:", stats, "| cards", n, "| without card", Object.values(state.books).filter((b) => !b.lang).length, "| minutes", ((Date.now() - t0) / 60e3).toFixed(1));
}
main().catch((e) => { console.error(e); process.exit(1); });
