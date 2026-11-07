/* Arabic normalisation and fuzzy matching of a page's text against the poem index.
   Works in the browser (window.QMatch) and in Node (module.exports) for testing. */
(function (root) {
  "use strict";
  const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/[ً-ٰٟۖ-ۭ]/g, "") // تشكيل
      .replace(/ـ/g, "")                            // تطويل
      .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
      .replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/[گك]/g, "ك").replace(/چ/g, "ج").replace(/ڤ/g, "ف").replace(/پ/g, "ب")
      .replace(/ک/g, "ك").replace(/ی/g, "ي")
      .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
      .replace(/[^ء-ي0-9a-z\n]+/gi, " ")
      .replace(/[ \t]+/g, " ").trim().toLowerCase();
  }
  const compact = (s) => norm(s).replace(/\s+/g, "");
  const POET_NOISE = /^(السيد|الشاعر|الاديب|الحاج|الملا|الشيخ|للشاعر|الاستاذ)\s+/;
  function poetKey(s) { let n = norm(s); for (let i = 0; i < 4; i++) n = n.replace(POET_NOISE, ""); return n.replace(/\s+/g, ""); }

  function grams(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }
  function dice(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return 0;
    const A = grams(a), B = grams(b); let inter = 0, tA = 0, tB = 0;
    for (const v of A.values()) tA += v; for (const v of B.values()) tB += v;
    for (const [g, v] of A) if (B.has(g)) inter += Math.min(v, B.get(g));
    return (2 * inter) / (tA + tB);
  }
  /* How well does `needle` appear somewhere inside `hay` (both compact)? 0..1 */
  function fuzzyContains(hay, needle) {
    if (!hay || !needle || needle.length < 4) return 0;
    if (hay.includes(needle)) return 1;
    const n = needle.length; let best = 0;
    if (hay.length <= n) return dice(hay, needle);
    for (let i = 0; i + n <= hay.length; i += 2) {
      const d = dice(hay.slice(i, i + n), needle);
      if (d > best) { best = d; if (best > 0.95) break; }
    }
    return best;
  }

  /* Score one poem against page text. `typed` = the user typed a short query. */
  function scorePoem(p, text, typed) {
    const hay = compact(text);
    if (hay.length < 3) return 0;
    const titles = [p.title].concat(p.aliases || []).map(compact).filter(Boolean);
    let s = 0;
    if (typed) {
      // A typed query is short: compare it to each field, and accept substrings.
      const fields = titles.concat([compact(p.opening)], (p.keywords || []).map(compact), (p.reciters || []).map(compact));
      for (const f of fields) {
        if (!f) continue;
        s = Math.max(s, dice(hay, f));
        if (hay.length >= 3 && f.includes(hay)) s = Math.max(s, 0.8);
      }
      if (p.poet && hay.length >= 3 && poetKey(p.poet).includes(poetKey(text))) s = Math.max(s, 0.5);
      return s;
    }
    // Page text from the camera: look for the title, opening and refrain inside it.
    for (const t of titles) s = Math.max(s, fuzzyContains(hay, t) * 0.95);
    if (p.opening) s = Math.max(s, fuzzyContains(hay, compact(p.opening)));
    for (const k of p.keywords || []) s = Math.max(s, fuzzyContains(hay, compact(k)) * 0.9);
    if (p.poet) {
      const ps = fuzzyContains(hay, poetKey(p.poet));
      if (ps > 0.7) s += 0.08;
    }
    return Math.min(s, 1);
  }

  function findMatches(poems, text, typed) {
    const ranked = poems.map((p) => ({ p, s: scorePoem(p, text, typed) }))
      .filter((r) => r.s >= 0.45).sort((a, b) => b.s - a.s);
    const top = ranked[0];
    const second = ranked[1];
    // A match must be strong and clearly ahead of the runner-up.
    const best = top && top.s >= 0.72 && (!second || top.s - second.s >= 0.08) ? top : null;
    return { best, candidates: ranked.filter((r) => r !== best).slice(0, 4) };
  }

  /* A best guess at the title from raw page text: the first line with real words. */
  function guessTitle(text) {
    const lines = String(text || "").split(/\n+/).map((l) => l.replace(/[^ء-ي\s]/g, " ").replace(/\s+/g, " ").trim());
    return lines.find((l) => l.length >= 5 && l.split(" ").some((w) => w.length >= 3)) || "";
  }

  const api = { norm, compact, poetKey, dice, fuzzyContains, scorePoem, findMatches, guessTitle, toArabicDigits: (s) => String(s == null ? "" : s).replace(/[0-9]/g, (d) => AR_DIGITS[+d]) };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.QMatch = api;
})(typeof self !== "undefined" ? self : this);
