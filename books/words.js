/* Words of a book page → integer search codes. Shared by the indexer (Node) and the books app (browser),
   so a word typed on the phone becomes exactly the code of the same word on the indexed page.
   The texts themselves are never stored: only these 24-bit codes, and the link to the page at its source.
   Light stemming only (the conjunction و and the article ال), as in the poems app. */
(function (root) {
  "use strict";
  const M = root.QMatch || (typeof require === "function" ? require("../match.js") : null);
  // Particles that carry no meaning of their own (normalised spelling: ى→ي، ة→ه، أ→ا).
  const STOP = new Set(("من في علي الي عن ان او ثم قد كل لا ما لم لن هو هي هم هما انا انت نحن هذا هذه ذلك تلك الذي التي الذين " +
    "اللذين اللتي كان كانت يكون تكون له لها لهم به بها بهم فيه فيها منه منها عليه عليها اليه اليها عنه عنها انه انها " +
    "اذا اذ لو لكن بل حتي مع عند بعد قبل بين غير اي ايضا قال قالت يقول ثمه ليس اما الا لان كما وهو وهي وان وقد ولا وما " +
    "ص ج ه ع ره قده").split(" "));
  function stem(w) {
    if (w.length > 3 && w[0] === "و") w = w.slice(1);
    const m = w.match(/^(ال|بال|فال|كال|لل)(.{2,})$/);
    if (m) w = m[2];
    return w;
  }
  function words(text) {
    const out = [];
    for (let w of M.norm(text).split(/\s+/)) {
      if (w.length < 2 || STOP.has(w) || /\d/.test(w)) continue;
      w = stem(w);
      if (w.length >= 2 && !STOP.has(w)) out.push(w);
    }
    return out;
  }
  function code(w) {
    let h = 0x811c9dc5;
    for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ((h ^ (h >>> 24)) & 0xffffff) >>> 0;
  }
  /* The distinct codes of a page, ascending. */
  function codes(text) { return [...new Set(words(text).map(code))].sort((a, b) => a - b); }
  /* Persian or Arabic? Counted on the raw text (before Persian letters are folded into Arabic ones). */
  const FA = new Set("است را که این آن های برای شود بود کرد از می‌شود نمی ایشان آنها بنابراین چنین چون همه خود".split(" "));
  function lang(raw) {
    const ws = String(raw).replace(/[‌]/g, " ").split(/[^؀-ۿ]+/).filter(Boolean);
    if (ws.length < 15) return "";
    let fa = 0; for (const w of ws) if (FA.has(w)) fa++;
    const letters = (String(raw).match(/[پچژگ]/g) || []).length;
    return fa / ws.length > 0.03 || letters / ws.length > 0.05 ? "fa" : "ar";
  }
  const api = { words, stem, code, codes, lang, STOP };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.QBookWords = api;
})(typeof self !== "undefined" ? self : this);
