/* Words of a poem → hashed search terms. Shared by the collector (Node) and the apps (browser),
   so a word typed on the phone hashes exactly like the same word in the collected poem.
   Light stemming only: the conjunction و and the article ال, which vary most between spellings. */
(function (root) {
  "use strict";
  const M = root.QMatch || (typeof require === "function" ? require("../match.js") : null);
  const STOP = new Set(("يا من الى على عل في ما لا لو هو هي انا انت احنا نحن هذا هذي هاي ذا اللي الي عن او ثم قد كل بس مو " +
    "ان اني انه انها له لها بي بيه بيها وين شلون ليش اذا حتى مع عند").split(" "));
  function stem(w) {
    if (w.length > 3 && w[0] === "و") w = w.slice(1);
    const m = w.match(/^(ال|بال|فال|كال|لل)(.{3,})$/);
    if (m) w = m[2];
    return w;
  }
  function words(text) {
    const out = [];
    for (let w of M.norm(text).split(/\s+/)) {
      if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
      w = stem(w);
      if (w.length >= 2 && !STOP.has(w)) out.push(w);
    }
    return out;
  }
  function hash(w) {
    let h = 0x811c9dc5;
    for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  const hashWords = (text) => [...new Set(words(text).map(hash))];
  /* Compact form (format 3): 24-bit hash → 4 base64url characters, packed without separators. */
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function code(w) {
    let h = 0x811c9dc5;
    for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h = (h ^ (h >>> 24)) & 0xffffff;
    return B64[h >> 18] + B64[(h >> 12) & 63] + B64[(h >> 6) & 63] + B64[h & 63];
  }
  const codeWords = (text) => [...new Set(words(text).map(code))];
  const pack = (codes) => codes.join("");
  function unpack(s) { const out = []; for (let i = 0; i + 4 <= s.length; i += 4) out.push(s.slice(i, i + 4)); return out; }
  const api = { words, stem, hash, hashWords, code, codeWords, pack, unpack };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.QWords = api;
})(typeof self !== "undefined" ? self : this);
