/* One catalogue from several libraries: the same book listed by two or three of them becomes one entry
   with all its sources. Same book = same title (without edition, volume or publisher notes) and an author name
   in common (or no author given on one side). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const M = require("../../match.js");

/* Our own fields, so every library's sections fall into the same few. */
export const FIELDS = ["الفقه", "أصول الفقه", "القرآن وعلومه", "الحديث", "العقائد والكلام", "الأخلاق والأدعية", "سيرة أهل البيت", "التاريخ والتراجم",
  "الفلسفة والمنطق", "الرجال والدراية", "اللغة والأدب", "الفكر والردود", "المجلات", "متفرقة"];
const RULES = [[/مجل/, 12], [/رجال|دراي/, 9], [/اصول|أصول/, 1], [/فقه|رسائل عمليه|احكام|أحكام|فتاو/, 0], [/قران|قرآن|تفسير/, 2], [/حديث|روايه|رواية|الكتب الاربعه/, 3],
  [/عقائد|عقيده|كلام|امامه|إمامة/, 4], [/اخلاق|أخلاق|دعاء|ادعيه|أدعية|زيار|عرفان/, 5], [/سيره|سيرة|اهل البيت|أهل البيت|فضائل|عزاء|النبي/, 6],
  [/تاريخ|تأريخ|تراجم|سير ذاتيه|السير الذاتية|قصص|جغرافي/, 7], [/فلسف|منطق|عقلاني|حكمه|حكمة/, 8], [/لغه|لغة|ادب|أدب|شعر|معاجم|روايات/, 10],
  [/شبهات|فكر|قضايا|معاصره|معاصرة|(^|\s)الفرق|مذاهب|نحل|سياس|نفس|اجتماع|تربيه|تربية/, 11]];
export function fieldOf(name) {
  const n = String(name || "").replace(/ی/g, "ي").replace(/ک/g, "ك").replace(/ة/g, "ه").replace(/[‌]/g, " ");
  for (const [re, f] of RULES) if (re.test(n) || re.test(String(name || ""))) return f;
  return 13;
}

const EDITION = /\s*[-–]\s*(ط|طبعة|الطبعة|ط\.ق|ط\.ج|تحقيق|ترجمة|شرح|مع|المحشى)[\s\S]*$|\s*\([^)]*\)\s*|\s*-\s*(ج|الجزء)\s*\d+.*$|\s+ط\s+\S+.*$/g;
const PARTS = /[،,]?\s*[\d٠-٩]+\s*(جزء|اجزاء|أجزاء|مجلد|مجلدات)|[،,]?\s*(ج|الجزء)\s*[\d٠-٩]+(\s*[-–]?\s*(ج\s*)?[\d٠-٩]+)*/g;
export function titleKey(t) {
  let s = String(t || "").replace(PARTS, " ").replace(EDITION, " ").replace(/\s+[-–]\s+.*$/, "").replace(/\s*[،,]\s*$/, "");
  s = M.norm(s).replace(/(^|\s)(ج|الجزء|المجلد)\s*\d+/g, " ");      // numbers stay: issue 12 is not issue 13
  return s.replace(/\s+/g, "");
}
const HONOR = new Set("الشيخ شيخ السيد سيد العلامه علامه الامام امام ايه اله الله المحقق محقق الشهيد شهيد الحاج الدكتور دكتور د بن ابن ابي ابو محمد علي حسن حسين احمد الميرزا ميرزا المولي الملا ملا ثقه الاسلام الطائفه رضوان عليه قدس سره الحسيني الحسني الموسوي".split(" "));
export function authorTokens(a) {
  return new Set(M.norm(a).split(/[\s،,]+/).map((w) => w.replace(/^ال(?=...)/, "")).filter((w) => w.length >= 3 && !HONOR.has(w) && !HONOR.has("ال" + w)));
}

// A Persian translation is not the Arabic book of the same name.
const langClass = (l) => (!l || l.startsWith("ar") ? (l === "ar" ? "ar" : "") : "x");
/* rows: { src, id, title, author, field, lang, vols?, died?, fullAuthor?, topics? } → entries */
export function merge(rows) {
  const byTitle = new Map();
  const entries = [];
  for (const r of rows) {
    const k = titleKey(r.title);
    if (!k) continue;
    const at = authorTokens((r.author || "") + " " + (r.fullAuthor || ""));
    let group = byTitle.get(k);
    if (!group) byTitle.set(k, group = []);
    const lg = langClass(r.lang);
    let e = group.find((g) => (!lg || !g.lang || g.lang === lg) && (!at.size || !g.at.size || [...at].some((x) => g.at.has(x))));
    if (!e) { e = { at: new Set(), rows: [], lang: "" }; group.push(e); entries.push(e); }
    if (lg) e.lang = lg;
    for (const x of at) e.at.add(x);
    e.rows.push(r);
  }
  const ORDER = { e: 0, a: 1, f: 2, s: 3, h: 4, i: 5, k: 6 };
  return entries.map((e) => {
    const rs = e.rows.sort((a, b) => ORDER[a.src] - ORDER[b.src]);
    const best = rs.filter((r) => r.lang === "ar").sort((a, b) => a.title.length - b.title.length)[0] || rs[0];   // the plainest title
    const author = rs.map((r) => r.author).find((a) => a && a !== "---") || "";
    const fields = rs.map((r) => fieldOf(r.field)).filter((f) => f !== 13);
    const lang = rs.some((r) => r.lang && r.lang.startsWith("ar")) ? "ar" : (rs.find((r) => r.lang) || {}).lang || "";
    return {
      title: best.title, author, field: fields.length ? fields[0] : 13, lang,
      died: Math.max(0, ...rs.map((r) => r.died || 0)), fullAuthor: (rs.find((r) => r.fullAuthor) || {}).fullAuthor || "",
      topics: rs.map((r) => r.topics).filter(Boolean).join("، ").slice(0, 160),
      // Each library's own title is kept when it says more (a volume, an edition, a journal issue).
      sources: rs.map((r) => (r.label && r.label !== best.title ? [r.src, r.id, r.vols || 0, r.label.slice(0, 140)] : [r.src, r.id, r.vols || 0]))
    };
  });
}
