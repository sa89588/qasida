/* Self-test of the books indexer: the page parsers on saved pages, the word codes, and the index format. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as E from "./eshia.mjs"; import { writeSegment, readSegment, mergeSegments } from "./segment.mjs";
const require = createRequire(import.meta.url); const W = require("../../books/words.js");
const F = (n) => fs.readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const all = E.parseAll(F("all.html"));
assert.ok(all.length >= 40 && all.every((b) => b.id > 0 && b.title && b.vols >= 1), "book list");
const nav = E.parseNav(F("page-ar.html"));
assert.deepEqual([nav.vol, nav.page, nav.last, nav.next, nav.volumes.length], [1, 50, 472, 51, 11], "page navigation");
const card = E.parseCard(F("card.html"));
assert.equal(card.died, 460); assert.equal(card.subject, "فقه"); assert.equal(card.volumes, 10);
assert.equal(E.parseNav(F("card.html")).next, 1);
const text = E.pageText(F("page-ar.html"));
assert.ok(text.includes("زرارة") && !text.includes("الاستبصار ج"), "page text without footnotes");
assert.equal(W.lang(text + " " + text), "ar"); assert.equal(W.lang(E.pageText(F("page-fa.html")).repeat(3)), "fa");
assert.ok(W.codes("قال الصادق عليه السلام في الصلاة").includes(W.code("صلاه")), "stemmed, normalised code");
// index round trip and merge
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
const p1 = new Map([[5, [0, 3, 7]], [900000, [1, 2]]]), p2 = new Map([[5, [10, 11]], [77, [12]]]);
const s1 = writeSegment(dir, { id: "a", base: 0, docs: 10 }, p1), s2 = writeSegment(dir, { id: "b", base: 10, docs: 5 }, p2);
assert.deepEqual(readSegment(dir, s1).get(900000), [1, 2]);
const m = mergeSegments(dir, [s1, s2], "c");
const mm = readSegment(dir, m);
assert.deepEqual([mm.get(5), mm.get(77), m.base, m.docs], [[0, 3, 7, 10, 11], [12], 0, 15], "merge");
console.log("books self-test ok:", all.length, "books in sample,", W.codes(text).length, "words on the sample page");
