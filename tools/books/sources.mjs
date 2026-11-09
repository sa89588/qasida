/* The other libraries of the unified catalogue (besides «مكتبة مدرسة الفقاهة», see eshia.mjs):
   - شبكة الفكر (alfeker.net): its public WordPress API — every book with its field, author and topics.
   - كتب شيعية (shiabooks.net): one page per field lists all its books.
   Each gives rows { src, id, title, author, field (the source's own name), topics, lang }. */
import { plain, unent } from "./eshia.mjs";

const json = (t) => { try { return JSON.parse(t); } catch { return null; } };

/* ---------- شبكة الفكر ---------- */
const AF = "https://alfeker.net/wp-json/wp/v2/";
async function allTerms(get, tax, log) {
  const map = new Map();
  for (let page = 1; page < 200; page++) {
    const list = json(await get(`${AF}${tax}?per_page=100&page=${page}&_fields=id,name,parent`));
    if (!Array.isArray(list) || !list.length) break;
    for (const t of list) map.set(t.id, { name: unent(t.name), parent: t.parent || 0 });
    if (list.length < 100) break;
  }
  log && log("alfeker", tax, map.size);
  return map;
}
export async function alfeker(get, log) {
  const cats = await allTerms(get, "book_cat", log), authors = await allTerms(get, "book_author", log), topics = await allTerms(get, "book_topic", log);
  const out = [];
  for (let page = 1; page < 400; page++) {
    const list = json(await get(`${AF}book?per_page=100&page=${page}&_fields=id,title,link,book_cat,book_author,book_researcher,book_topic`));
    if (!Array.isArray(list) || !list.length) break;
    for (const b of list) {
      const id = +((String(b.link).match(/\/b\/(\d+)/) || [])[1] || 0);
      if (!id) continue;
      const c = cats.get((b.book_cat || [])[0]);
      const parent = c && c.parent ? cats.get(c.parent) : null;
      const field = [parent && parent.name, c && c.name].filter(Boolean).join(" / ");
      const lang = /فارسي|Persian/.test(field) ? "fa" : /English|انجليزي|بنغالي|Bengali|اندونيسي|Indonesian|الفرنسي|French|Other/.test(field) ? "en" : "ar";
      const title = plain(b.title && b.title.rendered);
      out.push({ src: "f", id, title, label: title, author: (b.book_author || []).map((a) => authors.get(a)?.name).filter(Boolean).join("، "),
        field, lang, topics: (b.book_topic || []).map((t) => topics.get(t)?.name).filter(Boolean).slice(0, 6).join("، ") });
    }
    if (list.length < 100) break;
  }
  log && log("alfeker books", out.length);
  return out;
}

/* ---------- كتب شيعية ---------- */
const SB = "https://shiabooks.net/";
const VOLUMES = /^(\d+|[٠-٩]+)\s*(مجلد|مجلدات|جزء|أجزاء|اجزاء|ج)$|^(مجلدين|مجلدان|جزئين|جزءان|في\s+\S+\s+مجلدات?)$/;
const NOT_AUTHOR = /^(\(.*\)|ط\.?\s|طبعة|الطبعة|تحقيق|تحقیق|ترجمة|تعليق|شرح\s|نسخة|مصورة|مجلة|العدد)/;
/* «الكافي - (دار الكتب الإسلامية) - أبي جعفر محمد بن يعقوب الكليني - 8 مجلدات» → title, author, volumes. */
export function splitShiabooksTitle(s) {
  let parts = String(s).split(/\s+[-–]\s+/).map((x) => x.trim()).filter(Boolean);
  let vols = 0;
  parts = parts.filter((p) => { if (VOLUMES.test(p)) { const n = +(p.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).match(/\d+/) || [0])[0]; vols = n || 2; return false; } return true; });
  let title = parts[0] || s, author = "";
  const rest = parts.slice(1).filter((p) => !NOT_AUTHOR.test(p));
  if (rest.length) author = rest[rest.length - 1];
  const l = title.match(/^(.*?)\s+(?:لــ|لـ)\s*(.+)$/);
  if (l) { title = l[1]; if (!author) author = l[2]; }
  return { title: title.trim(), author: author.trim(), vols };
}
export function parseShiabooksField(html) {
  const out = [];
  for (const m of html.matchAll(/<h2><a href="library\.php\?id=(\d+)">([\s\S]*?)<\/a><\/h2>/g)) out.push({ id: +m[1], full: plain(m[2]) });
  return out;
}
export async function shiabooks(get, log) {
  const home = await get(SB + "library.php");
  if (!home) return [];
  const fields = [...new Map([...home.matchAll(/href="library\.php\?catid=(\d+)"[^>]*>([^<(]+)/g)].map((m) => [+m[1], plain(m[2])])).entries()];
  const out = [];
  for (const [catid, name] of fields) {
    const seen = new Set();
    for (let page = 1; page < 60; page++) {
      const h = await get(`${SB}library.php?catid=${catid}` + (page > 1 ? `&page=${page}` : ""));
      const rows = h ? parseShiabooksField(h).filter((r) => !seen.has(r.id)) : [];
      if (!rows.length) break;
      for (const r of rows) {
        seen.add(r.id);
        const t = splitShiabooksTitle(r.full);
        if (/مجل/.test(name)) t.author = "";               // a journal: what follows its name is the issue, not an author
        out.push({ src: "s", id: r.id, title: t.title, author: t.author, vols: t.vols, field: name, label: r.full,
          lang: /English/i.test(name) ? "en" : /[پچژگ]/.test(r.full) ? "fa" : "ar", topics: "" });
      }
      if (!/[?&]page=\d+/.test(h)) break;          // one page lists the whole field
    }
  }
  log && log("shiabooks books", out.length, "in", fields.length, "fields");
  return out;
}

/* ---------- مكتبة أهل البيت (ع) — ablibrary.net: its book list, 200 a page ---------- */
export function parseAblibraryList(html) {
  const out = [];
  for (const m of html.matchAll(/href="\/book_content\/b\/(\d+)\/1"><h2[^>]*>([\s\S]*?)<\/h2><p[^>]*>([\s\S]*?)<\/p>/g)) {
    const meta = plain(m[3].replace(/<!--[\s\S]*?-->/g, ""));
    const author = (meta.match(/المؤلف:\s*([^·]+)/) || [])[1] || "";
    const pages = +((meta.match(/(\d+)\s*صفحة/) || [])[1] || 0);
    const title = plain(m[2]);
    out.push({ src: "a", id: +m[1], title, label: title, author: author.trim(), field: "", topics: "", pages,
      lang: /\(\s*(فارسى|فارسي)\s*\)|[پچژگ]/.test(title) ? "fa" : /\(\s*(انجليزي|English)\s*\)/i.test(title) ? "en" : "ar" });
  }
  return out;
}
export async function ablibrary(get, log) {
  const out = [], seen = new Set();
  for (let page = 1; page < 400; page++) {
    const h = await get("https://ablibrary.net/book_content/book-list" + (page > 1 ? "?page=" + page : ""));
    const rows = h ? parseAblibraryList(h).filter((r) => !seen.has(r.id)) : [];
    if (!rows.length) break;
    for (const r of rows) { seen.add(r.id); out.push(r); }
  }
  log && log("ablibrary books", out.length);
  return out;
}

/* ---------- شبكة الإمامين الحسنين (alhassanain.org): its library, page by page ---------- */
export function parseHassanainList(html) {
  const out = [];
  for (const block of html.split(/<div class="item book"/).slice(1)) {
    const m = block.match(/<h2 class="contentheading"[^>]*><a href="\?com=book&amp;id=(\d+)">([\s\S]*?)<\/a>([^<]*)<\/h2>/);
    if (!m) continue;
    const title = plain(m[2]), part = plain(m[3]).replace(/^\s*-\s*/, "");
    const author = plain((block.match(/itemprop="author">([\s\S]*?)<\/span>/) || [])[1] || "");
    const field = plain((block.match(/view=category&amp;id=\d+"><b>([\s\S]*?)<\/b>/) || [])[1] || "");
    out.push({ src: "h", id: +m[1], title, label: part ? title + " - " + part : title, author, field, topics: "", lang: "ar" });
  }
  return out;
}
export async function hassanain(get, log) {
  const out = [], seen = new Set();
  for (let page = 1; page < 3000; page++) {
    const h = await get("https://www.alhassanain.org/arabic/?com=book" + (page > 1 ? "&page=" + page : ""));
    const rows = h ? parseHassanainList(h).filter((r) => !seen.has(r.id)) : [];
    if (!rows.length) break;
    for (const r of rows) { seen.add(r.id); out.push(r); }
  }
  log && log("alhassanain books", out.length);
  return out;
}

/* ---------- إصدارات العتبة الحسينية (publication.imamhussain.org) ---------- */
export function parseHusseiniList(html) {
  const out = [];
  for (const m of html.matchAll(/href="https:\/\/publication\.imamhussain\.org\/post\/(\d+)">\s*<h5[^>]*>([\s\S]*?)<\/h5>[\s\S]*?<h6[^>]*>([\s\S]*?)<\/h6>/g)) {
    const title = plain(m[2]);
    out.push({ src: "i", id: +m[1], title, label: title, author: "", publisher: plain(m[3]), field: "", topics: plain(m[3]), lang: "ar" });
  }
  return out;
}
export async function husseini(get, log) {
  const out = [], seen = new Set();
  for (let page = 1; page < 500; page++) {
    const h = await get("https://publication.imamhussain.org/books" + (page > 1 ? "?page=" + page : ""));
    const rows = h ? parseHusseiniList(h).filter((r) => !seen.has(r.id)) : [];
    if (!rows.length) break;
    for (const r of rows) { seen.add(r.id); out.push(r); }
  }
  log && log("imamhussain publications", out.length);
  return out;
}

/* ---------- مكتبة الإمام موسى الكاظم (imamkadhim.com): its WordPress API ---------- */
export async function kadhim(get, log) {
  const API = "https://imamkadhim.com/wp-json/wp/v2/";
  const cats = new Map();
  for (let page = 1; page < 20; page++) {
    const list = json(await get(`${API}categories?per_page=100&page=${page}&_fields=id,name`));
    if (!Array.isArray(list) || !list.length) break;
    for (const c of list) cats.set(c.id, unent(c.name));
    if (list.length < 100) break;
  }
  const out = [];
  for (let page = 1; page < 100; page++) {
    const list = json(await get(`${API}book?per_page=100&page=${page}&_fields=id,title,link,categories`));
    if (!Array.isArray(list) || !list.length) break;
    for (const b of list) {
      const title = plain(b.title && b.title.rendered), names = (b.categories || []).map((c) => cats.get(c)).filter(Boolean);
      // Its categories are mostly the authors' names.
      out.push({ src: "k", id: b.id, url: String(b.link || ""), title, label: title, author: names[0] || "", field: names.slice(1).join(" "), topics: "", lang: "ar" });
    }
    if (list.length < 100) break;
  }
  log && log("imamkadhim books", out.length);
  return out;
}
