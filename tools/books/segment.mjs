/* The word index of the books, in segments that are only ever added (so each run uploads only what is new).
   A segment covers a run of page numbers (docs) [base, base + docs). Its words are spread over `nb` bucket files
   (bucket = code & (nb - 1)); a bucket file holds, sorted by code:
     code (3 bytes) · count (varint) · first doc − base (varint) · gaps to the next docs (varints)
   Words found on more than COMMON of a segment's pages carry no postings; they are listed in the segment's `common`.
   The same format is read by books/search.js in the app. */
import fs from "node:fs";
import path from "node:path";

export const COMMON = 0.3;
const TARGET_FILE = 48 * 1024;

function varint(out, n) { while (n >= 128) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); }
function readVarint(b, p) { let n = 0, mul = 1, x; do { x = b[p.i++]; n += (x & 127) * mul; mul *= 128; } while (x & 128); return n; }

/* postings: Map code → ascending array of doc numbers (absolute). */
export function writeSegment(root, seg, postings) {
  const dir = path.join(root, "seg", seg.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const common = [];
  let total = 0;
  for (const [c, docs] of postings) { if (seg.docs >= 500 && docs.length > seg.docs * COMMON) common.push(c); else total += docs.length; }
  const est = total * 1.4 + postings.size * 5;
  let nb = 16; while (nb < 4096 && est / nb > TARGET_FILE) nb *= 2;
  const buckets = Array.from({ length: nb }, () => []);
  const commonSet = new Set(common);
  for (const c of [...postings.keys()].sort((a, b) => a - b)) if (!commonSet.has(c)) buckets[c & (nb - 1)].push(c);
  let bytes = 0;
  buckets.forEach((codes, k) => {
    const out = [];
    for (const c of codes) {
      const docs = postings.get(c);
      out.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
      varint(out, docs.length);
      let prev = seg.base;
      for (let i = 0; i < docs.length; i++) { varint(out, i === 0 ? docs[0] - seg.base : docs[i] - prev); prev = docs[i]; }
    }
    if (out.length) { fs.writeFileSync(path.join(dir, k.toString(36) + ".bin"), Buffer.from(out)); bytes += out.length; }
  });
  return { id: seg.id, base: seg.base, docs: seg.docs, nb, common: common.sort((a, b) => a - b), postings: total, bytes };
}

export function readSegment(root, seg) {
  const map = new Map();
  const dir = path.join(root, "seg", seg.id);
  for (let k = 0; k < seg.nb; k++) {
    const f = path.join(dir, k.toString(36) + ".bin");
    if (!fs.existsSync(f)) continue;
    const b = fs.readFileSync(f), p = { i: 0 };
    while (p.i < b.length) {
      const c = (b[p.i] << 16) | (b[p.i + 1] << 8) | b[p.i + 2]; p.i += 3;
      const n = readVarint(b, p), docs = new Array(n);
      let d = seg.base;
      for (let i = 0; i < n; i++) { d += readVarint(b, p); docs[i] = d; }
      map.set(c, docs);
    }
  }
  return map;
}

/* Merge neighbouring segments into one (their doc ranges follow each other). Common words of a part
   cannot be restored (their pages were not kept), so a word common in any part stays common in the whole. */
export function mergeSegments(root, segs, id) {
  const merged = new Map();
  const common = new Set();
  for (const s of segs) for (const c of s.common) common.add(c);
  for (const s of segs) {
    for (const [c, docs] of readSegment(root, s)) {
      if (common.has(c)) continue;
      const a = merged.get(c); if (a) { for (const d of docs) a.push(d); } else merged.set(c, docs);
    }
  }
  const base = segs[0].base, docs = segs[segs.length - 1].base + segs[segs.length - 1].docs - base;
  const out = writeSegment(root, { id, base, docs }, merged);
  out.common = [...new Set([...out.common, ...common])].sort((a, b) => a - b);
  for (const s of segs) fs.rmSync(path.join(root, "seg", s.id), { recursive: true, force: true });
  return out;
}
