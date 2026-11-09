/* Reading the pages of «مكتبة مدرسة الفقاهة» (ar.lib.eshia.ir): the list of all books, a book's card,
   and the text of one page. Only what the index needs is kept: titles, authors, volumes, page numbers,
   and the words of a page as codes. */
export const BASE = "https://ar.lib.eshia.ir";
export const CATEGORIES = ["الفقه", "أصول_الفقه", "القرآنیة", "علوم_الحديث", "العقائد", "الأخلاق", "السیرة", "التأریخ_و_الجغرافیا",
  "العلم_العقلاني", "الفرق_والنحل", "الأدب", "المعاجم", "السياسية", "العلوم_الجدیدة", "المجلات"];

const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", zwnj: "‌" };
export const unent = (s) => String(s).replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? " ");
export const plain = (html) => unent(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " "))
  .replace(/[ \t\r]+/g, " ").replace(/\n\s*/g, "\n").trim();

/* «جميع المجموعات»: every book as [id, title, author, volumes]. */
export function parseAll(html) {
  const out = [];
  for (const row of html.match(/<tr class="course"[\s\S]*?<\/tr>/g) || []) {
    const id = (row.match(/class="BookName-sub[^"]*">\s*<a href="[^"]*\/(\d+)"/) || [])[1];
    if (!id) continue;
    const title = plain((row.match(/class="BookName-sub[^"]*">\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "");
    const author = plain((row.match(/class="BookAuthor-sub[^"]*">\s*(?:<a[^>]*>)?([\s\S]*?)(?:<\/a>)?\s*<\/td>/) || [])[1] || "");
    const vols = +plain((row.match(/class="BookVolumes-sub[^"]*">([\s\S]*?)<\/td>/) || [])[1] || "1") || 1;
    out.push({ id: +id, title, author, vols });
  }
  return out;
}

/* Navigation of any page: volumes offered, this volume, first and last page. */
export function parseNav(html) {
  const sel = (html.match(/<select class="VolumeSelector"[\s\S]*?<\/select>/) || [""])[0];
  const volumes = [...sel.matchAll(/<option value="(\d+)"/g)].map((m) => +m[1]);
  const vol = +((sel.match(/<option value="(\d+)" selected/) || [])[1] ?? NaN);
  const link = (title) => { const m = html.match(new RegExp('<a href="/\\d+/(\\d+)/(\\d+)" title="' + title + '"')); return m ? { vol: +m[1], page: +m[2] } : null; };
  const first = link("إظهار الصفحة الأولى"), last = link("إظهار الصفحة الأخيرة"), next = link("إظهار الصفحة التالیة");
  const page = +((html.match(/class="PageSelector" value="(\d+)"/) || [])[1] ?? NaN);
  return { volumes, vol, page, first: first && first.page, last: last && last.page, next: next && next.page };
}

/* The page's own text: without the site's menus and without the editor's footnotes. */
export function pageText(html) {
  const i = html.indexOf('id="book-page-content"');
  if (i < 0) return "";
  let b = html.slice(i);
  const m = b.indexOf('class="sticky-menue"');
  if (m >= 0) { const e = b.indexOf("</div>", m); if (e >= 0) b = b.slice(e + 6); }
  const end = b.indexOf("</td>"); if (end >= 0) b = b.slice(0, end);
  b = b.replace(/<p class="rfdFootnote[\s\S]*?<\/p>/g, " ").replace(/<a [^>]*name="_ftn[^"]*"[^>]*>[\s\S]*?<\/a>/g, " ");
  const hr = b.lastIndexOf("<hr"); if (hr >= 0 && !/<p(?![^>]*rfdFootnote)/.test(b.slice(hr))) b = b.slice(0, hr);
  return plain(b);
}

/* A volume's card («شهادة الكتاب», page 0): full title, full author with year of death, subject, publisher. */
export function parseCard(html) {
  const t = pageText(html);
  const f = (k) => { const m = t.match(new RegExp(k + "[ \\t]*:[ \\t]*([^\\n]*)")); return m ? m[1].trim() : ""; };
  const author = f("نام کامل پدیدآورنده");
  const d = author.match(/\(\s*م\s*([\d٠-٩۰-۹]+)\s*(ق|ش|م)?/);
  const digits = (s) => +String(s).replace(/[٠-٩]/g, (x) => "٠١٢٣٤٥٦٧٨٩".indexOf(x)).replace(/[۰-۹]/g, (x) => "۰۱۲۳۴۵۶۷۸۹".indexOf(x));
  return {
    full: f("نام کامل کتاب").slice(0, 200), author: author.replace(/\s*\(.*$/, "").slice(0, 160), died: d ? digits(d[1]) : 0,
    subject: f("موضوع").slice(0, 80), publisher: f("ناشر").slice(0, 80), pages: +f("تعداد صفحات") || 0, volumes: +f("تعداد مجلدات") || 0
  };
}

/* Books in a category page («/الفقه/all»): their ids. */
export const parseCategory = (html) => parseAll(html).map((b) => b.id);
/* Links from a category page to its sub-categories («/الفقه/رسائل_عملیه»). */
export function subCategories(html, cat) {
  const out = new Set();
  for (const m of html.matchAll(/href="(?:https?:\/\/ar\.lib\.eshia\.ir)?\/([^"\/#?]+)\/([^"\/#?]+)"/g)) {
    let a, b; try { a = decodeURIComponent(m[1]); b = decodeURIComponent(m[2]); } catch { continue; }
    if (a === cat && b !== "all" && b !== "authors" && !/^\d+$/.test(b)) out.add(b);
  }
  return [...out];
}
/* A card's subject → one of the fields, when the field pages did not list the book. */
const SUBJECTS = [[/اصول|أصول/, 1], [/فقه|احكام|أحكام|رسائل عمليه|رساله عمليه/, 0], [/تفسير|قرآن|قران|علوم القرآن/, 2], [/حديث|حدیث|كتب اربعه|الكتب الاربعة|الکتب الاربعة|روايات|رجال|درايه/, 3],
  [/كلام|عقائد|عقايد|امامت|إمامة/, 4], [/اخلاق|أخلاق|دعا|ادعيه|زيارات/, 5], [/سيره|سیره|مقتل|زندگينامه|تراجم/, 6], [/تاريخ|تاریخ|جغرافيا/, 7],
  [/فلسفه|منطق|عرفان|حكمت/, 8], [/فرق|مذاهب|اديان/, 9], [/ادبيات|نحو|صرف|بلاغت|بلاغه|شعر|لغت|ادب/, 10], [/فرهنگ|معجم|لغه/, 11], [/سياس|سیاس/, 12]];
export function fieldOfSubject(subject) {
  const s = String(subject || "").replace(/[\u200c]/g, " ").replace(/ی/g, "ي").replace(/ک/g, "ك");
  for (const [re, c] of SUBJECTS) if (re.test(s)) return c;
  return null;
}
