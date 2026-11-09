/* Self-test of the books catalogue: the page parsers on saved pages, the other libraries' lists, and merging. */
import fs from "node:fs"; import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as E from "./eshia.mjs";
import { splitShiabooksTitle, parseShiabooksField } from "./sources.mjs";
import { merge, titleKey, fieldOf, FIELDS } from "./merge.mjs";
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
console.log("books self-test ok:", all.length, "eshia books in sample,", m.length, "merged entries");
