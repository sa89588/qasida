// Poem-words index: find a poem from any word or line in it.
// Sources (each allows automated reading; checked robots.txt):
//   doro-iq.com (Blogger feed) · aghanilyrics.com (latmiyat + anasheed sections) · shiapoem.com (sitemap)
//   Telegram public channels via their t.me/s web preview (no robots restrictions)
// Published per poem: title, reciter, poet, source link, and the poem's words as an unordered set of
// 24-bit codes — enough to search, not a copy of the poem. The text itself is never stored.
//
// Incremental: every run reads only what is new on each source, plus a time-boxed backfill of
// older Telegram posts until each channel is complete. Output, in <dataDir>:
//   lyrics-index.json        {updated, format, count, chunks:[{file,count,hash}], sources:{…}}
//   lyrics/<src>-<n>.json    up to 1000 poems: [[key, title, reciter, poet, url, packedCodes], …]
//   lyrics/state.json        cursors per source
// Usage: node tools/lyrics/collect.mjs <dataDir>      (LYRICS_MINUTES caps the run; default 40)
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const M = require("../../match.js");
const W = require("../../lite/words.js");

const OUT = process.argv[2] || "data";
const FORMAT = 4;   // 4: credits no longer taken from "كلمات قصيدة …" headings
const UA = "qasida-reader-catalog/1.0 (+https://github.com/sa89588/qasida)";
const DELAY = +(process.env.LYRICS_DELAY_MS ?? 1200);
const BUDGET = +(process.env.LYRICS_MINUTES || 40) * 60000;
const CHUNK = 1000;
const TELEGRAM = ["qasaedmaqtobah", "aabas78", "qassad19"];
const started = Date.now();
const timeUp = () => Date.now() - started > BUDGET;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) => String(s).replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
export const textLines = (html) => decode(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>|<\/(p|div|h\d|li|blockquote|tr)>/gi, "\n").replace(/<[^>]+>/g, " "))
  .split("\n").map((s) => s.replace(/[ \t\u00a0]{3,}/g, " // ").replace(/\s+/g, " ").trim()).filter(Boolean);   // wide gaps separate the two halves of a verse
const arabic = (s) => (String(s).match(/[ء-ي]/g) || []).length;

async function get(url, json) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ar", accept: json ? "application/json" : "text/html" } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) { await sleep(15000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return json ? r.json() : r.text();
    } catch { await sleep(5000 * (i + 1)); }
  }
  return null;
}
/* The inner HTML of the first element whose opening tag matches `open` (balanced on its tag name). */
export function block(html, open) {
  const m = open.exec(html); open.lastIndex = 0;
  if (!m) return "";
  const tag = m[0].match(/^<(\w+)/)[1];
  const re = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"); re.lastIndex = m.index;
  let depth = 0, x, end = html.length;
  while ((x = re.exec(html))) { depth += x[0][1] === "/" ? -1 : 1; if (depth === 0) { end = x.index; break; } }
  return html.slice(m.index + m[0].length, end);
}

/* ---------- names and titles ---------- */
export function cleanName(s) {
  let t = String(s || "").replace(/[()«»"✒️🔷📜🎙🎤]/gu, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) t = t.replace(/^[\s\-–—.:|،\/\\*_~]+|[\s\-–—.:|،\/\\*_~]+$/g, "").replace(/^(الرادود|الشاعر|كلمات|أداء|اداء|بصوت|للشاعر|الحاج|الملا)\s+/, "");
  return t.split(/\s+/).slice(0, 6).join(" ").trim();
}
function originalSpelling(raw, n) {
  const words = String(raw).replace(/[|\-–]/g, " ").split(/\s+/).filter(Boolean), k = n.split(" ").length;
  for (let i = 0; i + k <= words.length; i++) if (M.norm(words.slice(i, i + k).join(" ")) === n) return words.slice(i, i + k).join(" ");
  return n;
}
const TITLE_NOISE = /^(كلمات\s+)?(لطميه|قصيده|نعي|موشح|انشوده|نشيد|ردات|شور|فزاعيه|لطميات|اغنيه)\s+/;
export function splitTitle(raw, reciters, hint) {
  const t = String(raw).replace(/مكتوب[هة]?\s*كامل[هة]?|\s+مكتوب[هة]?(?=\s|$)/g, "").replace(/\s+/g, " ").trim();
  let title = t, reciter = hint || "";
  const parts = t.split(/\s+[-|–]\s+|\s*\|\s*/);
  if (parts.length >= 2) { title = parts[0]; reciter = reciter || parts.slice(1).join(" "); }
  const by = title.match(/^(.*?)\s+(?:المنشد|للمنشد|الرادود|اداء|أداء)\s+(.{3,})$/);
  if (by) { title = by[1]; reciter = reciter || by[2]; }
  let n = M.norm(title).replace(/^كلمات\s+/, "");
  for (let i = 0; i < 2; i++) n = n.replace(TITLE_NOISE, "");
  for (const [k, name] of reciters) {
    const short = k.replace(/^(الحاج|الرادود|الملا|السيد|الشيخ) /, "");
    const full = n.lastIndexOf(" " + k), idx = n.lastIndexOf(" " + short);
    const at = full > 0 ? full : idx;
    if (at > 0 && n.length - at <= k.length + 1) { reciter = reciter || name; n = n.slice(0, at); break; }
  }
  n = n.replace(/\s+(الرادود|الحاج|الملا|السيد|الشيخ|المنشد)$/, "").trim();
  return { title: originalSpelling(t, n), reciter: cleanName(reciter) };
}
/* A poem with no printed title is known by its opening: the first line that is verse, first half. */
const DESC = /^(قصيده|قصيدة|لطميه|لطمية|موشح|كعديه|كعدية|نعي|لذكرى|ذكرى|استشهاد|مولد|ولاده|ولادة|بمناسبه|بمناسبة|شور|زنجيل|فزاعيه|فزاعية|ردات|نزله|نزلة|طور|اللحن|لحن|بحر|وزن|مقدمه|مقدمة|جديد|حصري|السلام عليكم|قصائد)/;
export function openingTitle(lines) {
  for (const l of lines.slice(0, 6)) {
    const n = M.norm(l);
    if (!n || DESC.test(n) || n.split(" ").length < 2 || arabic(l) < 6) continue;
    const half = l.split(/\s{3,}|\/\/+|\.{3,}|…|\*+|=|ـ{3,}/).map((x) => x.trim()).filter((x) => arabic(x) >= 5)[0] || l;
    return half.split(/\s+/).slice(0, 8).join(" ").replace(/[^\p{L}\p{M}\s]/gu, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}
const BOILER = /درون العراق|مكتوب[هة]? كامل|كما يمكنكم|اشترك|تابعونا|حقوق|المزيد من القصائد|للاشتراك|قناه|القناه|واتساب|انستا|تيك توك|فيسبوك|يوتيوب|^كلمات (لطمي|قصيد)|^الكاتب|^التوزيع|^الهندس|^المكان|^اخراج|^تصوير|^حسينيه|قصائد حسينيه مكتوبه|ومقروءه من قبل الرواديد/;
const META = /^(?:[^\p{L}]*)(قصيده|قصيدة|القصيده|الشاعر|كلمات الشاعر|كلمات|الرادود|اداء|أداء|المنشد|بصوت)\s*[:：|]?\s*(.*)$/u;
/* Split a post or page into verse lines and its credits. */
export function readPoem(lines) {
  const meta = { title: "", poet: "", reciter: "" }, body = [];
  for (const raw of lines) {
    if (/https?:|www\.|t\.me|@\w|\d{7,}/i.test(raw)) continue;
    const l = raw.replace(/[#_]+/g, " ").trim();
    const m = l.match(META);
    if (m && m[2] && l.length < 80) {
      const k = m[1], v = m[2];
      if (/^(كلمات|كلمات الشاعر)$/.test(k) && /^(قصيد|لطمي|نعي|موشح|انشود|اغني)/.test(M.norm(v))) continue;   // a heading, not a credit
      if (/قصيد/.test(k)) meta.title = meta.title || v;
      else if (/شاعر|كلمات/.test(k)) meta.poet = meta.poet || cleanName(v);
      else meta.reciter = meta.reciter || cleanName(v);
      continue;
    }
    if (BOILER.test(M.norm(l)) || arabic(l) < 3) continue;
    body.push(l);
  }
  return { meta, body };
}

/* ---------- sources ---------- */
async function knownReciters() {
  const names = new Map();
  for (const f of await fs.readdir(OUT).catch(() => [])) {
    if (!/^sv-.*\.json$/.test(f)) continue;
    try { for (const a of JSON.parse(await fs.readFile(path.join(OUT, f), "utf8")).artists || []) { const k = M.norm(a); if (k.length >= 5) names.set(k, a); } } catch {}
  }
  return [...names].sort((a, b) => b[0].length - a[0].length);
}

async function* doro(have, reciters) {
  for (let start = 1; start < 50000 && !timeUp(); start += 150) {
    const j = await get(`https://www.doro-iq.com/feeds/posts/default?alt=json&max-results=150&start-index=${start}`, true);
    const entries = j?.feed?.entry || [];
    if (!entries.length) break;
    let fresh = 0;
    for (const e of entries) {
      const url = (e.link || []).find((l) => l.rel === "alternate")?.href;
      if (!url || have(url)) continue;
      fresh++;
      const labels = (e.category || []).map((c) => c.term), title = e.title?.$t || "";
      if (!/لطمي|قصيد|نعي|موشح|شور|ردات|فزاعي|انشود|نشيد|مولد/.test(title) && !labels.includes("قصائد مكتوبة")) continue;
      if (labels.some((l) => /اغاني|برامج|ملازم|نتائج|الصف|رياضة|سياسة|اخبار|العاب|وظائف/.test(l))) continue;
      const { meta, body } = readPoem(textLines(e.content?.$t || ""));
      const label = labels.find((l) => !/قصائد|شعر|دين|منوعات/.test(l)) || "";
      const t = splitTitle(title, reciters, meta.reciter || label);
      yield { key: url, title: t.title, reciter: t.reciter, poet: meta.poet, url, body };
    }
    if (!fresh) break;                       // a whole page we already have: nothing older is new
    await sleep(DELAY);
  }
}

async function* aghani(have, reciters) {
  const sections = [
    ["https://aghanilyrics.com/section/%D9%84%D8%B7%D9%85%D9%8A%D8%A7%D8%AA-%D8%AD%D8%B3%D9%8A%D9%86%D9%8A%D8%A9/", /لطمي|قصيد|نعي/],
    ["https://aghanilyrics.com/section/%D8%A7%D9%86%D8%A7%D8%B4%D9%8A%D8%AF/", /انشود|نشيد|كلمات/]
  ];
  for (const [secUrl, want] of sections) {
    const sec = await get(secUrl);
    if (!sec) continue;
    const links = [...new Set([...sec.matchAll(/href="(https:\/\/aghanilyrics\.com\/topic\/[^"]+)"/g)].map((m) => m[1]))]
      .filter((u) => want.test(decodeURIComponent(u)) && !have(u));
    for (const u of links) {
      if (timeUp()) return;
      await sleep(DELAY);
      const html = await get(u);
      if (!html) continue;
      const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
      const { meta, body } = readPoem(textLines(block(html, /<div[^>]*class="[^"]*\bmainDiv\b[^"]*"[^>]*>/)));
      const t = splitTitle(h1, reciters, meta.reciter);
      yield { key: u, title: t.title, reciter: t.reciter, poet: meta.poet, url: u, body };
    }
  }
}

async function* shiapoem(have) {
  const sm = await get("https://shiapoem.com/sitemap_pages.xml");
  if (!sm) return;
  const ids = [...new Set([...sm.matchAll(/\/poems\/(\d+)/g)].map((m) => m[1]))];
  for (const id of ids) {
    const url = `https://shiapoem.com/poems/${id}`;
    if (have(url)) continue;
    if (timeUp()) return;
    await sleep(DELAY);
    const html = await get(url);
    if (!html) continue;
    const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
    const head = decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "");
    const poet = cleanName((head.match(/للشاعر\s+(.+?)(?:\s+والرادود|$)/) || [])[1] || "");
    const reciter = cleanName(((head.match(/والرادود\s+(.+)$/) || [])[1] || "").split("،")[0]);
    const { body } = readPoem(textLines(block(html, /<div[^>]*class="[^"]*\bpoem_text_container\b[^"]*"[^>]*>/)));
    yield { key: url, title: h1, reciter, poet, url, body };
  }
}

/* Telegram public preview: 20 posts per page, newest last; ?before=ID pages backwards. */
export function telegramPosts(html, ch) {
  const out = [];
  const re = /<div class="tgme_widget_message_wrap[^"]*"[^>]*>/g; let m;
  const starts = []; while ((m = re.exec(html))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const seg = html.slice(starts[i], starts[i + 1] || html.length);
    const id = +((seg.match(new RegExp(`data-post="${ch}/(\\d+)"`, "i")) || [])[1] || 0);
    if (!id) continue;
    const text = block(seg, /<div class="tgme_widget_message_text[^"]*"[^>]*>/);
    out.push({ id, lines: text ? textLines(text) : [] });
  }
  return out;
}
async function* telegram(state) {
  for (const ch of TELEGRAM) {
    const st = state.tg[ch] = state.tg[ch] || { newest: 0, oldest: 0, complete: false };
    const take = (p) => {
      const { meta, body } = readPoem(p.lines);
      if (body.length < 8 || arabic(body.join(" ")) < 150) return null;
      const title = meta.title ? cleanName(meta.title).split(/\s+/).slice(0, 8).join(" ") : openingTitle(body);
      if (!title) return null;
      const url = `https://t.me/${ch}/${p.id}`;
      return { key: url, title, reciter: meta.reciter, poet: meta.poet, url, body };
    };
    // 1) what is new since the last run (latest page, then backwards until known posts)
    let before = 0, pages = 0, newestNow = st.newest;
    while (!timeUp() && pages++ < 60) {
      const html = await get(`https://t.me/s/${ch}` + (before ? `?before=${before}` : ""));
      const posts = html ? telegramPosts(html, ch) : [];
      if (!posts.length) break;
      for (const p of posts) { newestNow = Math.max(newestNow, p.id); if (p.id > st.newest) { const r = take(p); if (r) yield r; } }
      const min = Math.min(...posts.map((p) => p.id));
      if (!st.oldest) st.oldest = min;
      if (min <= st.newest || min <= 1) break;
      if (!st.newest) { st.oldest = min; break; }   // first run: the backfill below takes it from here
      before = min;
      await sleep(DELAY);
    }
    st.newest = newestNow;
    // 2) older posts, until the channel is complete (time-boxed; resumes next run)
    while (!st.complete && !timeUp() && st.oldest > 1) {
      await sleep(DELAY);
      const html = await get(`https://t.me/s/${ch}?before=${st.oldest}`);
      const posts = (html ? telegramPosts(html, ch) : []).filter((p) => p.id < st.oldest);
      if (!posts.length) { st.complete = true; break; }
      for (const p of posts) { const r = take(p); if (r) yield r; }
      st.oldest = Math.min(...posts.map((p) => p.id));
    }
    if (st.oldest <= 1) st.complete = true;
  }
}

/* ---------- store ---------- */
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
async function readJSON(f, d) { try { return JSON.parse(await fs.readFile(f, "utf8")); } catch { return d; } }

export async function main() {
  const dir = path.join(OUT, "lyrics");
  await fs.mkdir(dir, { recursive: true });
  const index = await readJSON(path.join(OUT, "lyrics-index.json"), null);
  const state = await readJSON(path.join(dir, "state.json"), { tg: {} });
  // Load what we have: chunks per source, keys, and content signatures (to drop reposts).
  const chunks = {};      // src -> [[rows…], …]
  const keys = new Set(), sigs = new Set();
  const sig = (packed) => sha(W.unpack(packed).sort().slice(0, 40).join(""));
  if (index && index.format === FORMAT) {
    for (const c of index.chunks) {
      const doc = await readJSON(path.join(OUT, c.file), null); if (!doc) continue;
      (chunks[doc.src] = chunks[doc.src] || [])[doc.n] = doc.poems;
      for (const r of doc.poems) { keys.add(r[0]); sigs.add(sig(r[5])); }
    }
  } else { state.tg = {}; }  // new format: collect everything again
  const have = (k) => keys.has(k);
  const changed = new Set();
  const add = (src, p) => {
    if (keys.has(p.key) || !p.title || p.body.length < 6) return false;
    const codes = W.codeWords(p.body.join("\n"));
    if (codes.length < 25) return false;
    const packed = W.pack(codes), s = sig(packed);
    if (sigs.has(s)) return false;            // the same poem posted again
    keys.add(p.key); sigs.add(s);
    const list = chunks[src] = chunks[src] || [[]];
    let n = list.length - 1; if (!list[n]) list[n] = [];
    if (list[n].length >= CHUNK) { n++; list[n] = []; }
    list[n].push([p.key, String(p.title).slice(0, 120), String(p.reciter || "").slice(0, 60), String(p.poet || "").slice(0, 60), p.url, packed]);
    changed.add(`${src}-${n}`);
    return true;
  };
  const reciters = await knownReciters();
  const counts = {};
  const run = async (src, gen) => { let n = 0; try { for await (const p of gen) if (add(src, p)) n++; } catch (e) { console.error(src, e.message); } counts[src] = n; };
  await run("doro", doro(have, reciters));
  await run("aghani", aghani(have, reciters));
  await run("shiapoem", shiapoem(have));
  await run("tg", telegram(state));

  // Write changed chunks and the index.
  const list = [];
  let total = 0;
  for (const [src, arr] of Object.entries(chunks)) arr.forEach((poems, n) => {
    if (!poems) return;
    const file = `lyrics/${src}-${n}.json`;
    list.push({ file, src, n, poems });
    total += poems.length;
  });
  const entries = [];
  for (const c of list) {
    const body = JSON.stringify({ src: c.src, n: c.n, poems: c.poems });
    if (changed.has(`${c.src}-${c.n}`) || !index || index.format !== FORMAT) await fs.writeFile(path.join(OUT, c.file), body);
    entries.push({ file: c.file, count: c.poems.length, hash: sha(body) });
  }
  const sources = {}; for (const c of list) sources[c.src] = (sources[c.src] || 0) + c.poems.length;
  const newIndex = { updated: changed.size ? new Date().toISOString() : (index?.updated || new Date().toISOString()), format: FORMAT, count: total, sources,
    telegram: Object.fromEntries(Object.entries(state.tg).map(([k, v]) => [k, v.complete ? "complete" : "collecting"])),
    note: "words are 24-bit codes, unordered; read each poem at its url", chunks: entries };
  await fs.writeFile(path.join(OUT, "lyrics-index.json"), JSON.stringify(newIndex, null, 1));
  await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
  await fs.rm(path.join(OUT, "lyrics.json"), { force: true });   // the old single-file index (format 2)
  console.log(`poem texts: ${total} (new: ${JSON.stringify(counts)}; telegram: ${JSON.stringify(newIndex.telegram)})`);
  return changed.size > 0;
}
if (process.argv[1] && process.argv[1].endsWith("collect.mjs")) {
  main().then(async (changed) => { if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`); })
    .catch((e) => { console.error(e); process.exit(1); });
}
