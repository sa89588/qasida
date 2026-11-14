/* Self-test of the books catalogue: the page parsers on saved pages, the other libraries' lists, and merging. */
import fs from "node:fs"; import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as E from "./eshia.mjs";
import { splitShiabooksTitle, parseShiabooksField, parseAblibraryList, parseHassanainList, parseHusseiniList, parseNajafSitemaps, parseMaarefList, parseTurathList, parseJawadainList } from "./sources.mjs";
import { merge, titleKey, fieldOf, fieldOfTitle, FIELDS } from "./merge.mjs";
import { parsePreview, lessonLinks, fileTitle, parseChannelPage } from "./telegram.mjs";
const require = createRequire(import.meta.url); const W = require("../../books/words.js");
const F = (n) => fs.readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const all = E.parseAll(F("all.html"));
assert.ok(all.length >= 40 && all.every((b) => b.id > 0 && b.title && b.vols >= 1), "eshia book list");
const nav = E.parseNav(F("page-ar.html"));
assert.deepEqual([nav.vol, nav.page, nav.last, nav.next, nav.volumes.length], [1, 50, 472, 51, 11], "page navigation");
const card = E.parseCard(F("card.html"));
assert.equal(card.died, 460); assert.equal(card.subject, "فقه"); assert.equal(card.volumes, 10);
const text = E.pageText(F("page-ar.html"));
assert.equal(W.lang(text + " " + text), "ar"); assert.equal(W.lang(E.pageText(F("page-fa.html")).repeat(3)), "fa");
// shiabooks
assert.deepEqual(splitShiabooksTitle("الكافي - (دار الكتب الإسلامية) - أبي جعفر محمد بن يعقوب الكليني - 8 مجلدات"), { title: "الكافي", author: "أبي جعفر محمد بن يعقوب الكليني", vols: 8 });
assert.deepEqual(splitShiabooksTitle("رجال البرقي لــ أحمد بن عبدالله بن خالد البرقي - تحقيق حيدر محمد علي البغدادي"), { title: "رجال البرقي", author: "أحمد بن عبدالله بن خالد البرقي", vols: 0 });
assert.equal(splitShiabooksTitle("ولاية الفقيه - الشيخ أحمد النراقي").author, "الشيخ أحمد النراقي");
assert.deepEqual(parseShiabooksField('<h2><a href="library.php?id=15804">البرج في العمارة - بيرتون بيج</a></h2>'), [{ id: 15804, full: "البرج في العمارة - بيرتون بيج" }]);
assert.deepEqual(parseAblibraryList('<a class="x" href="/book_content/b/10316/1"><h2 class="t">أجوبة السائلين</h2><p class="m">المؤلف: الشيخ فاضل اللنكراني<!-- --> · <!-- -->الناشر: قم<!-- --> · <!-- -->160<!-- --> <!-- -->صفحة</p></a>').map((r) => [r.id, r.title, r.author, r.pages]), [[10316, "أجوبة السائلين", "الشيخ فاضل اللنكراني", 160]]);
assert.deepEqual(parseHassanainList('<div class="item book" itemscope><h2 class="contentheading" itemprop="title"><a href="?com=book&amp;id=653">الروضة من الكافي</a> - الجزء 8</h2><span class="creator" itemprop="author">الكليني</span><a href="?com=book&amp;view=category&amp;id=110"><b>متون حديثية</b></a>').map((r) => [r.id, r.title, r.label, r.author, r.field]), [[653, "الروضة من الكافي", "الروضة من الكافي - الجزء 8", "الكليني", "متون حديثية"]]);
assert.equal(parseHusseiniList('<a href="https://publication.imamhussain.org/post/2943">\n<h5 class="text-center">أساليب السرد</h5></a><a href="x"><h6 class="t">مؤسسة وارث الأنبياء</h6></a>')[0].id, 2943);
// مكتبة صحراء النجف، موقع التراث الرقمي، الهيأة العليا لإحياء التراث، العتبة الكاظمية
const nd = parseNajafSitemaps('<loc>https://najafdesertlibrary.com/book/%D9%83%D8%AA%D8%A7%D8%A8-%D8%A7%D9%84%D9%82%D8%B6%D8%A7%D8%A1</loc><loc>https://najafdesertlibrary.com/book/كتاب-القضاء-4</loc><loc>https://najafdesertlibrary.com/book/الكافي</loc>', '<loc>https://najafdesertlibrary.com/book/الكافي/v/8</loc>');
assert.deepEqual(nd.map((r) => [r.id, r.title, r.label, r.vols]), [["كتاب-القضاء", "كتاب القضاء", "كتاب القضاء", 0], ["كتاب-القضاء-4", "كتاب القضاء", "كتاب القضاء (نسخة 4)", 0], ["الكافي", "الكافي", "الكافي", 8]]);
const mkHtml = '<div class="" id="content110574"><div class="table-head d-flex w-100 px-3"><h1 style="width: 100px">العنوان : </h1>\n<h1>كتاب الخلاف ج1-6</h1></div><div><p style="width: 100px">المؤلف : </p>\n<p style="">الشيخ الطوسي</p></div><div><p style="width: 100px">المحقق : </p><p style="">بلا</p></div><div><p style="width: 100px"> عدد الاجزاء : </p><p style="">بلا</p></div></div>';
assert.deepEqual(parseMaarefList(mkHtml + mkHtml.replace("content110574", "content110574"), 2).map((r) => [r.id, r.title, r.author, r.editor, r.vols, r.field]), [[110574, "كتاب الخلاف ج1-6", "الشيخ الطوسي", "", 6, "ما حقق من التراث"]]);
assert.deepEqual(parseTurathList('<a href="/book/350" target="_blank" class="book-link"><img src="x.jpg"><h4 class="book-title  text-center" style="x" title="فصل الخطاب">فصل الخطاب</h4></a>').map((r) => [r.id, r.title]), [[350, "فصل الخطاب"]]);
assert.deepEqual(parseJawadainList("<a class='c-card-book' href='https://www.aljawadain.org/library/books/single?book_id=1492' style=''><h5 class=\"c-card-book__title\"> الامامان </h5><b>التصنيف:</b> <span class='px-1'> السيرة </span><b>المؤلف:</b> <span class='px-1'> آل ياسين </span></a>", "b").map((r) => [r.id, r.title, r.author, r.field]), [["1492", "الامامان", "آل ياسين", "السيرة"]]);
assert.equal(parseJawadainList("<a class='c-card-research' href='https://www.aljawadain.org/library/researches/single?research_id=142'><h5 class=\"c-card-research__title\"> ضرام الحزن </h5></a>", "r")[0].id, "r142");
// merging
assert.equal(titleKey("الكافي- ط الاسلامية"), titleKey("الكافي"));
assert.equal(titleKey("وسائل الشيعة - ط آل البیت"), titleKey("وسائل الشيعة"));
assert.equal(titleKey("الكافي ، 15 جزء – طبعة دار الحديث"), titleKey("الكافي"));
assert.equal(titleKey("الكافي في أصول الفقه – ج1ج2"), titleKey("الكافي في أصول الفقه"));
assert.notEqual(titleKey("آفاق الحضارة (العدد 9)").length, 0);
assert.equal(fieldOf("رجال الحديث"), 9); assert.equal(fieldOf("الفقه والأصول / الأصول"), 1); assert.equal(fieldOf("القرآن وعلومه"), 2);
for (let i = 0; i < FIELDS.length; i++) assert.equal(fieldOf(FIELDS[i]), i, "own field " + FIELDS[i]);
const m = merge([
  { src: "e", id: 11005, title: "الكافي- ط الاسلامية", author: "الشيخ الكليني", field: "الحديث", lang: "ar", vols: 8 },
  { src: "s", id: 8263, title: "الكافي", author: "أبي جعفر محمد بن يعقوب الكليني", field: "الحديث وعلومه", lang: "ar", vols: 8 },
  { src: "e", id: 10025, title: "كتاب الطهارة", author: "الخميني، السيد مصطفى", field: "الفقه", lang: "ar" },
  { src: "e", id: 10135, title: "كتاب الطهارة", author: "الشيخ مرتضى الأنصاري", field: "الفقه", lang: "ar" }]);
const kafi = m.find((x) => x.sources.some((s) => s[1] === 11005));
assert.deepEqual(kafi.sources.map((s) => s[0]).sort(), ["e", "s"], "same book from two libraries is one entry");
assert.equal(m.filter((x) => x.title === "كتاب الطهارة").length, 2, "same title, different authors: two books");
assert.equal(merge([{ src: "a", id: 1, title: "الغيبة (فارسى)", author: "الطوسي", lang: "fa" }, { src: "e", id: 2, title: "الغيبة", author: "الطوسي", lang: "ar" }]).length, 2, "a Persian translation stays apart");
const mh = merge([{ src: "e", id: 1, title: "منهاج الصالحين", author: "السيستاني، السيد علي", lang: "ar" }, { src: "e", id: 2, title: "منهاج الصالحين", author: "الخوئي، السيد أبو القاسم", lang: "ar" },
  { src: "n", id: "منهاج-الصالحين", title: "منهاج الصالحين", author: "", lang: "ar" }, { src: "n", id: "منهاج-الصالحين-2", title: "منهاج الصالحين", author: "", lang: "ar" }]);
assert.deepEqual(mh.map((x) => x.sources.length), [1, 1, 2], "copies without an author, of a title several authors wrote, stay apart");
assert.equal(merge([{ src: "e", id: 1, title: "الكافي", author: "الكليني", lang: "ar" }, { src: "n", id: "الكافي", title: "الكافي", author: "", lang: "ar" }]).length, 1, "one author: the copy joins it");
// Telegram previews
const tgHtml = '<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="Qa_droos/77"><div class="tgme_widget_message_document_title accent_color" dir="auto">بين_المناهج_الحوزوية.pdf</div><div class="tgme_widget_message_document_extra" dir="auto">68.9 KB</div><div class="tgme_widget_message_text js-message_text" dir="auto">شرح المكاسب المحرمة | الشيخ عبدالرضا الرويمي دورة كاملة <a href="https://t.me/dhrghyeyhfyytuffu" target="_blank">https://t.me/dhrghyeyhfyytuffu</a><br/>رابط القناة: <a href="https://t.me/s">x</a></div></div>';
const posts = parsePreview(tgHtml, "Qa_droos");
assert.deepEqual([posts[0].id, posts[0].docs[0].size], [77, "68.9 KB"]);
assert.equal(fileTitle(posts[0].docs[0].title, posts[0].text), "بين المناهج الحوزوية");
assert.deepEqual(lessonLinks(posts[0]).map((l) => [l.u, l.d]), [["dhrghyeyhfyytuffu", "شرح المكاسب المحرمة | الشيخ عبدالرضا الرويمي دورة كاملة"]]);
assert.deepEqual(parseChannelPage('<div class="tgme_page_title" dir="auto"><span dir="auto">قنوات الدروس</span></div><div class="tgme_page_extra">12 132 subscribers</div><div class="tgme_page_description" dir="auto">قنوات الدروس الحوزوية</div>'), { title: "قنوات الدروس", about: "قنوات الدروس الحوزوية", members: "12132", kind: "channel" });
assert.equal(parseChannelPage("<title>Telegram: Contact @nobody</title>"), null);
assert.equal(fieldOfTitle("شرح المكاسب"), 0); assert.equal(fieldOfTitle("معجم رجال الحديث"), 9); assert.equal(fieldOfTitle("أصول الدين"), 4);
assert.equal(merge([{ src: "s", id: 1, title: "دراسة في فقه المواريث", author: "x", field: "", lang: "ar" }])[0].kind, "r");
console.log("books self-test ok:", all.length, "eshia books in sample,", m.length, "merged entries");
