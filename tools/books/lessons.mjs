/* Lesson series — hawza lessons and explanations, audio, video and text, each opened at its source:
   - «مدرسة الفقاهة» (eshia.ir): the archive of the «بحث الخارج» and higher «سطوح» courses, every course with its
     years and the subject of each year; each lesson there has its text and its recording.
   - YouTube playlists that the hawza Telegram channels post (only the playlist page is read: name, channel, size).
   Nothing is downloaded; the app links to the lesson's own page. */
import { unent } from "./eshia.mjs";

const ES = "https://www.eshia.ir";
const clean = (s) => unent(String(s || "").replace(/<br\s*\/?>/gi, " — ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^[\s—]+|[\s—]+$/g, "").trim();

/* The archive's pages that list teachers and their courses, with what each holds. */
export const ESHIA_HUBS = [
  ["/Ar/Feqh/Archive/", "النجف الأشرف", "خارج", "ar"],
  ["/Ar/Feqh/Archive/qaravieh/", "النجف الأشرف — الحرم العلوي", "خارج", "ar"],
  ["/Ar/Feqh/Archive/almasajed/", "النجف الأشرف — المساجد", "خارج", "ar"],
  ["/Ar/Feqh/Archive/Karbala/", "كربلاء", "خارج", "ar"],
  ["/Ar/Feqh/Archive/Qom/", "قم — دروس بالعربية", "خارج", "ar"],
  ["/Ar/Feqh/Archive/lebanon/", "بيروت", "خارج", "ar"],
  ["/Ar/Feqh/Archive/Damascus/", "دمشق", "خارج", "ar"],
  ["/Ar/Feqh/Archive/qatif/", "القطيف والأحساء", "خارج", "ar"],
  ["/Ar/Feqh/Archive/Dakar/", "داكار", "خارج", "ar"],
  ["/Ar/Feqh/Archive/Translate/", "تقريرات عربية لدروس قم", "خارج", "ar"],
  ["/Ar/Feqh/Archive/sath3/", "السطوح العالية", "سطوح", "ar"],
  ["/feqh/archive/", "قم — المسجد الأعظم", "خارج", "fa"],
  ["/Feqh/Archive/qom/feyzieh/", "قم — المدرسة الفيضية", "خارج", "fa"],
  ["/Feqh/Archive/qom/khan/", "قم — مدرسة الخان", "خارج", "fa"],
  ["/Feqh/Archive/qom/golpayegani/", "قم — مدرسة الگلپايگاني", "خارج", "fa"],
  ["/Feqh/Archive/qomschools/", "قم — مدارس أخرى", "خارج", "fa"],
  ["/feqh/Archive/qom/tafsir", "قم — التفسير ونهج البلاغة", "تفسير", "fa"],
  ["/Feqh/Archive/Mashhad/", "مشهد — مدرسة الخوئي", "خارج", "fa"],
  ["/Feqh/Archive/Mashhad/schools", "مشهد — مدارس أخرى", "خارج", "fa"],
  ["/feqh/Archive/mashhad/tafsir", "مشهد — التفسير ونهج البلاغة", "تفسير", "fa"],
  ["/Feqh/Archive/Iran/", "مدن إيران", "خارج", "fa"],
  ["/Feqh/Archive/Afghanestan/", "كابل", "خارج", "fa"],
  ["/Feqh/Archive/Moaser/", "كبار المعاصرين", "خارج", "fa"],
  ["/Feqh/Archive/Rejal/", "علم الرجال", "خارج", "fa"],
  ["/Aqaed/Archive/", "الكلام والفلسفة", "كلام", "fa"]
];

/* A hub page: <section><span>teacher</span><div><a href="faiyaz/Feqh/">بحث الفقه</a>…</div></section> */
export function parseEshiaHub(html, hubPath) {
  const out = [];
  const base = new URL(hubPath.endsWith("/") ? hubPath : hubPath + "/", ES);
  for (const part of String(html).split(/<section>/).slice(1)) {
    const teacher = clean((part.match(/<span>([\s\S]*?)<\/span>/) || [])[1]);
    if (!teacher) continue;
    for (const m of part.split(/<\/section>/)[0].matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const u = new URL(m[1], base);
      if (u.host !== "www.eshia.ir" && u.host !== "eshia.ir") continue;
      const path = u.pathname.replace(/\/+$/, "/");
      if (!/\/archive\/[^/]+\/[^/]+\/$/i.test(path)) continue;
      out.push({ teacher, course: clean(m[2]), path });
    }
  }
  // «السطوح العالية»: a box per book (المكاسب، الرسائل، الكفاية), a link per part.
  for (const box of String(html).split(/class="linkbox(?!header)[^"]*"/).slice(1)) {
    const book = clean((box.match(/class="linkboxheader">([\s\S]*?)<\/div>/) || [])[1]);
    if (!book) continue;
    for (const m of box.split(/<\/ul>/)[0].matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const path = new URL(m[1], base).pathname.replace(/\/+$/, "/");
      if (/\/archive\/[^/]+\/[^/]+\/$/i.test(path)) out.push({ teacher: "", course: book + " — " + clean(m[2]).replace(/^\u200c/, ""), path, book });
    }
  }
  return out;
}

/* A course page: its title, then each year: the subject taught and the year's link. */
export function parseEshiaCourse(html) {
  const title = clean((String(html).match(/class="onvanedoroos">([\s\S]*?)<\/div>/) || [])[1]);
  const years = [];
  const box = (String(html).split('id="link-teacher"')[1] || "").split(/<\/main>|id="footer"/)[0];
  for (const m of box.matchAll(/<div>\s*<p>([\s\S]*?)<\/p>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/div>/g)) {
    const topic = clean(m[1]), label = clean(m[3]).replace(/^(سال|السنة)\s*/, "");
    if (/report\/asatid/i.test(m[2]) || !topic || topic === "مبحث") continue;
    years.push([label, topic.slice(0, 220), new URL(m[2], ES).pathname]);
  }
  return { title, years };
}

export async function eshiaLessons(get, log) {
  const courses = new Map();
  for (const [hub, place, level, lang] of ESHIA_HUBS) {
    const h = await get(ES + hub);
    if (!h) { log("eshia lessons: hub not read", hub); continue; }
    for (const c of parseEshiaHub(h, hub)) {
      const k = c.path.toLowerCase();
      if (!courses.has(k)) courses.set(k, { ...c, place, level, lang });
    }
  }
  const out = [];
  for (const c of courses.values()) {
    const h = await get(ES + c.path);
    const page = h ? parseEshiaCourse(h) : { title: "", years: [] };
    if (!page.years.length) continue;
    out.push({ src: "q", id: c.path, title: page.title || c.course + " — " + c.teacher, teacher: c.teacher, where: c.place,
      level: c.level, lang: c.lang, count: page.years.length, media: "نص وصوت", parts: page.years });
  }
  log("eshia lessons", courses.size, "courses,", out.length, "with years");
  return out;
}

/* ---------- YouTube playlists ---------- */
const YT_LINK = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:playlist\?list=|watch\?[^"'\s<]*?list=)|youtu\.be\/[\w-]+\?[^"'\s<]*?list=)([\w-]{10,64})/g;
/* Playlist ids in a post (its links and its text). */
export function playlistIds(html) {
  const ids = new Set();
  for (const m of unent(String(html)).matchAll(YT_LINK)) if (/^(PL|OL|UU|FL)/.test(m[1])) ids.add(m[1]);
  return [...ids];
}
/* The playlist page: name, channel, number of videos, first video. */
export function parseYoutubePlaylist(html) {
  const h = String(html);
  const title = unent((h.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "").trim();
  if (!title || /^YouTube$/i.test(title)) return null;
  const count = +((h.match(/"stats":\[\{"runs":\[\{"text":"([\d,]+)"/) || h.match(/"numVideosText":\{"runs":\[\{"text":"([\d,]+)"/) || [])[1] || "0").replace(/,/g, "");
  const owner = unent((h.match(/"ownerText":\{"runs":\[\{"text":"([^"]+)"/) || h.match(/"text":\{"content":"([^"]+)"/) || [])[1] || "").trim();
  const video = (h.match(/"videoId":"([\w-]{11})"/) || [])[1] || "";
  const about = unent((h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "").trim();
  return { title, owner, count, video, about: /Share your videos with friends/i.test(about) ? "" : about.slice(0, 160) };
}
export async function youtubeLessons(get, log, ids, cache) {
  // A playlist's page is read again every few weeks: names and sizes change slowly.
  const out = [], now = Date.now();
  let read = 0;
  for (const [id, ctx] of Object.entries(ids)) {
    let p = cache[id];
    if (!p || now - (p.at || 0) > 21 * 864e5) {
      if (read >= 400) { if (!p) continue; }
      else {
        const h = await get("https://www.youtube.com/playlist?list=" + id); read++;
        const page = h ? parseYoutubePlaylist(h) : null;
        p = page ? { ...page, at: now } : { dead: true, at: now };
        cache[id] = p;
      }
    }
    if (!p || p.dead || !p.count) continue;
    out.push({ src: "y", id, title: p.title, teacher: "", where: p.owner, level: "", lang: /[پچژگ]/.test(p.title) ? "fa" : "ar", count: p.count, media: "فيديو",
      video: p.video, about: p.about || ctx.slice(0, 160) });
  }
  log("youtube playlists", Object.keys(ids).length, "found,", read, "read,", out.length, "kept");
  return out;
}

/* ---------- the stage of a series, from the book it explains ---------- */
const STAGES = [
  ["خارج", /بحث\s*(ال)?خارج|درس\s*(ال)?خارج|خارج\s*(ال)?(فقه|اصول|أصول)|درس‌?\s*خارج/],
  ["سطوح", /المكاسب|مكاسب|الرسائل|فرائد\s*الاصول|فرائد\s*الأصول|الكفاي[ةه]|كفاي[ةه]\s*الا?أ?صول|الحلق[ةه]\s*الثالث[ةه]|اللمع[ةه]|الروض[ةه]\s*البهي[ةه]|نهاي[ةه]\s*الحكم[ةه]|مكاسب|رسائل|کفایه|لمعه/],
  ["مقدمات", /الآجرومي[ةه]|الاجرومي[ةه]|قطر\s*الندى|ابن\s*عقيل|الالفي[ةه]|الألفي[ةه]|مغني\s*اللبيب|المنطق|حاشي[ةه]\s*ملا|البلاغ[ةه]|مختصر\s*المعاني|التصريف|شرح\s*الامثل[ةه]|الصرف|النحو|الباب\s*الحادي\s*عشر|الحلق[ةه]\s*(الاولى|الأولى|الثاني[ةه])|اصول\s*الفقه|أصول\s*الفقه|بداي[ةه]\s*الحكم[ةه]|عقائد\s*الامامي[ةه]|عقائد\s*الإمامي[ةه]|الموجز|جامع\s*المقدمات|البهج[ةه]\s*المرضي[ةه]|شرح\s*النظام/]
];
export function stageOf(text) {
  for (const [name, re] of STAGES) if (re.test(text)) return name;
  return "";
}
