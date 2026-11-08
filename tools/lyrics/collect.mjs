// Builds the poem-words index used to find a poem from any word or line in it.
// Sources (both allow automated reading in robots.txt):
//   - doro-iq.com  : Blogger feed of written latmiyat (≈900), footer gives reciter and poet
//   - aghanilyrics.com : its "لطميات حسينية" section
// What is published: title, reciter, poet, a link to the source page, and the poem's words as
// hashes (an unordered set — enough to search, not a copy of the poem). The text itself is not stored.
//
// Usage: node tools/lyrics/collect.mjs <dataDir>   (FORCE=1 to ignore the weekly freshness check)
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const M = require("../../match.js");
const W = require("../../lite/words.js");

const OUT = process.argv[2] || "data";
const FORMAT = 2;   // bump when the collector changes: a new format is collected again at once
const UA = "qasida-reader-catalog/1.0 (+https://github.com/sa89588/qasida)";
const DELAY = +(process.env.LYRICS_DELAY_MS || 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => String(s).replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const textLines = (html) => decode(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>|<\/(p|div|h\d|li|blockquote|tr)>/gi, "\n").replace(/<[^>]+>/g, " "))
  .split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

async function get(url, json) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: json ? "application/json" : "text/html" } });
      if (r.status === 404) return null;
      if (r.ok) return json ? r.json() : r.text();
    } catch {}
    await sleep(5000 * (i + 1));
  }
  return null;
}

/* Known reciters (from the ShiaVoice catalog) to split "title reciter" headings. */
async function knownReciters() {
  const names = new Map();
  for (const f of await fs.readdir(OUT).catch(() => [])) {
    if (!/^sv-.*\.json$/.test(f)) continue;
    try { for (const a of JSON.parse(await fs.readFile(path.join(OUT, f), "utf8")).artists || []) { const k = M.norm(a); if (k.length >= 5) names.set(k, a); } } catch {}
  }
  return [...names].sort((a, b) => b[0].length - a[0].length);
}
/* "- الرادود محمد الجنامي ." → "محمد الجنامي" */
export function cleanName(s) {
  let t = String(s || "").replace(/[()«»"]/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) t = t.replace(/^[\s\-–—.:|،]+|[\s\-–—.:|،]+$/g, "").replace(/^(الرادود|الشاعر|كلمات|أداء|اداء|بصوت|للشاعر|الحاج)\s+/, "");
  return t.trim();
}
/* The normalised title, written back in the source's own spelling (keeps ة, أ, …). */
function originalSpelling(raw, n) {
  const words = String(raw).replace(/[|\-–]/g, " ").split(/\s+/).filter(Boolean), k = n.split(" ").length;
  for (let i = 0; i + k <= words.length; i++) if (M.norm(words.slice(i, i + k).join(" ")) === n) return words.slice(i, i + k).join(" ");
  return n;
}
const TITLE_NOISE = /^(كلمات\s+)?(لطميه|قصيده|نعي|موشح|انشوده|نشيد|ردات|شور|فزاعيه|لطميات)\s+/;
export function splitTitle(raw, reciters, hint) {
  let t = String(raw).replace(/\bمكتوب[هة]?\s*كامل[هة]?\b/g, "").replace(/\s+/g, " ").trim();
  let title = t, reciter = hint || "";
  const parts = t.split(/\s+[-|–]\s+|\s*\|\s*/);
  if (parts.length >= 2) { title = parts[0]; reciter = reciter || parts.slice(1).join(" "); }
  let n = M.norm(title).replace(/^كلمات\s+/, "");
  for (let i = 0; i < 2; i++) n = n.replace(TITLE_NOISE, "");
  // reciter written after the title without a separator
  for (const [k, name] of reciters) {
    const idx = n.lastIndexOf(" " + k.replace(/^(الحاج|الرادود|الملا|السيد|الشيخ) /, ""));
    const full = n.lastIndexOf(" " + k);
    const at = full > 0 ? full : idx;
    if (at > 0 && n.length - at <= k.length + 1) { reciter = reciter || name; n = n.slice(0, at); break; }
  }
  n = n.replace(/\s+(الرادود|الحاج|الملا|السيد|الشيخ)$/, "").trim();
  return { title: originalSpelling(t, n), reciter: cleanName(reciter) };
}
const BOILER = /درون العراق|مكتوب[هة]? كامل|كما يمكنكم|اشترك|تابعونا|حقوق|المزيد من القصائد|^كلمات (لطمي|قصيد)|^لطميه |^الكاتب|^التوزيع|^الهندس|^المكان|^اخراج|^تصوير|^ليله \d|^حسينيه/;

async function fromDoro(reciters) {
  const out = [];
  for (let start = 1; start < 20000; start += 150) {
    const j = await get(`https://www.doro-iq.com/feeds/posts/default?alt=json&max-results=150&start-index=${start}`, true);
    const entries = j?.feed?.entry || [];
    if (!entries.length) break;
    for (const e of entries) {
      const labels = (e.category || []).map((c) => c.term);
      const title = e.title?.$t || "";
      if (!/لطمي|قصيد|نعي|موشح|شور|ردات|فزاعي/.test(title) && !labels.includes("قصائد مكتوبة")) continue;
      if (labels.some((l) => /اغاني|برامج|ملازم|نتائج|الصف|رياضة|سياسة|اخبار|العاب|وظائف/.test(l))) continue;
      const lines = textLines(e.content?.$t || "");
      let reciter = "", poet = "";
      const body = [];
      for (const l of lines) {
        const m = l.match(/^(الرادود|الشاعر|كلمات الشاعر|كلمات|اداء|أداء)\s*[|:：]\s*(.+)$/);
        if (m) { if (/رادود|اداء|أداء/.test(m[1])) reciter = reciter || m[2]; else poet = poet || m[2]; continue; }
        if (/^ـ{5,}|^-\s/.test(l)) continue;
        if (BOILER.test(M.norm(l))) continue;
        body.push(l);
      }
      const label = labels.find((l) => !/قصائد|شعر|دين|منوعات/.test(l)) || "";
      const t = splitTitle(title, reciters, reciter || label);
      const link = (e.link || []).find((l) => l.rel === "alternate")?.href;
      if (body.length >= 6 && t.title.length >= 2 && link) out.push({ title: t.title, reciter: t.reciter, poet: cleanName(poet), url: link, body });
    }
    await sleep(DELAY);
  }
  return out;
}

function mainDiv(html) {
  const at = html.search(/<div[^>]*class="[^"]*\bmainDiv\b[^"]*"[^>]*>/);
  if (at < 0) return "";
  const re = /<\/?div\b[^>]*>/gi; re.lastIndex = at; let depth = 0, m, end = html.length;
  while ((m = re.exec(html))) { depth += m[0][1] === "/" ? -1 : 1; if (depth === 0) { end = m.index; break; } }
  return html.slice(at, end);
}
async function fromAghani(reciters) {
  const out = [];
  const sec = await get("https://aghanilyrics.com/section/%D9%84%D8%B7%D9%85%D9%8A%D8%A7%D8%AA-%D8%AD%D8%B3%D9%8A%D9%86%D9%8A%D8%A9/");
  if (!sec) return out;
  const links = [...new Set([...sec.matchAll(/href="(https:\/\/aghanilyrics\.com\/topic\/[^"]+)"/g)].map((m) => m[1]))]
    .filter((u) => /لطمي|قصيد|نعي/.test(decodeURIComponent(u)));
  for (const u of links) {
    await sleep(DELAY);
    const html = await get(u);
    if (!html) continue;
    const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
    const body = textLines(mainDiv(html)).filter((l) => !BOILER.test(M.norm(l)));
    const t = splitTitle(h1, reciters, "");
    if (body.length >= 6 && t.title) out.push({ title: t.title, reciter: t.reciter, poet: "", url: u, body });
  }
  return out;
}

export async function main() {
  const file = path.join(OUT, "lyrics.json");
  const old = JSON.parse(await fs.readFile(file, "utf8").catch(() => "null"));
  const fresh = old && old.format === FORMAT && Date.now() - Date.parse(old.updated) < 7 * 864e5;
  if (fresh && !process.env.FORCE) { console.log("poem texts are fresh"); return false; }
  const reciters = await knownReciters();
  const all = [...await fromDoro(reciters), ...await fromAghani(reciters)];
  // one entry per poem: same title + reciter from two sites → keep the longer text
  const byKey = new Map();
  for (const p of all) {
    const k = M.compact(p.title) + "|" + M.poetKey(p.reciter);
    const prev = byKey.get(k);
    if (!prev || p.body.length > prev.body.length) byKey.set(k, p);
  }
  const poems = [...byKey.values()].map((p) => [p.title, p.reciter, p.poet, p.url, W.hashWords(p.body.join("\n")).join(" ")]);
  if (poems.length < 50 && old?.poems?.length > poems.length) { console.log("too few poems read; keeping the previous index"); return false; }
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ updated: new Date().toISOString(), format: FORMAT, count: poems.length,
    note: "words are hashed (FNV-1a, base36) and unordered; read the poem at its url", poems }));
  console.log(`poem texts: ${poems.length} (doro + aghani read: ${all.length})`);
  return true;
}
if (process.argv[1] && process.argv[1].endsWith("collect.mjs")) {
  main().then(async (changed) => { if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`); })
    .catch((e) => { console.error(e); process.exit(1); });
}
