// يجمع فهرس صوت الشيعة (العنوان، المنشد، المدة، المعرّف، القسم) لتطبيق «قارئ القصائد» بدون مفاتيح.
// يعمل على GitHub Actions. مهذّب: طلب واحد كل ثانية تقريباً، يتوقف عند الضغط، ويكمل من حيث توقف.
// لا يجمع ملفات صوتية ولا نصوصاً؛ التشغيل يتم بمشغّل صوت الشيعة الرسمي.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BASE = "https://shiavoice.com";
const OUT = process.argv[2] || "data";
const BUDGET_MIN = +(process.env.CRAWL_MINUTES || 300);      // stop in time, resume next run
const DELAY_MS = +(process.env.CRAWL_DELAY_MS || 900);
const UA = "qasida-reader-catalog/1.0 (+https://github.com/sa89588/qasida)";
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeUp = () => Date.now() - started > BUDGET_MIN * 60000;

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
const secs = (d) => { const p = String(d || "").split(":").map(Number); if (p.some(isNaN)) return 0; return p.reduce((a, b) => a * 60 + b, 0); };

export function parseCat(html) {
  const title = decode((html.match(/<title>([^<]*)<\/title>/) || [, ""])[1]).replace(/\s*[—-]\s*صوت الشيعة\s*$/, "");
  const bc = (html.match(/<ol[^>]*class="[^"]*breadcrumb[^"]*"[^>]*>([\s\S]*?)<\/ol>/) || [, ""])[1];
  const crumbs = [...bc.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const section = (crumbs.find((h) => /^\/[a-z][a-z0-9-]*$/i.test(h) && h !== "/" && !/^\/cat-\d+$/.test(h)) || "").slice(1);
  const parent = ((crumbs.filter((h) => /^\/cat-\d+$/.test(h)).pop()) || "").slice(5);
  const rows = [];
  const seen = new Set();
  // Only the album's own list: rows inside "track-row" blocks.
  for (const m of html.matchAll(/<div class="[^"]*track-row[^"]*">\s*<button[^>]*class="[^"]*play-track[^"]*"[^>]*>/g)) {
    const tag = m[0];
    const a = (n) => { const x = tag.match(new RegExp(n + '="([^"]*)"')); return x ? decode(x[1]) : ""; };
    const id = a("data-uniqid");
    if (!/^[A-Za-z0-9]{3,12}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, title: a("data-title"), artist: a("data-artist"), dur: secs(a("data-duration")) });
  }
  const pages = [...html.matchAll(/class="page-link"[^>]*href="[^"]*\/page-(\d+)"/g)].map((m) => +m[1]);
  return { title, section, parent, rows, lastPage: Math.max(1, ...pages) };
}

/* A recording's own page: its section and album from the breadcrumb (الرئيسية › لطميات › الرادود › الألبوم). */
export function parsePlay(html) {
  const bc = (html.match(/<ol[^>]*class="[^"]*breadcrumb[^"]*"[^>]*>([\s\S]*?)<\/ol>/) || [, ""])[1];
  const crumbs = [...bc.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], decode(m[2].replace(/<[^>]+>/g, ""))]);
  const section = ((crumbs.find(([h]) => /^\/[a-z][a-z0-9-]*$/i.test(h) && !/^\/cat-\d+$/.test(h)) || [""])[0]).slice(1);
  const cats = crumbs.filter(([h]) => /^\/cat-\d+$/.test(h)).map(([h, t]) => [+h.slice(5), t]);
  return { section, cats };
}

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ar" } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) { await sleep(30000 * (i + 1)); continue; }   // the site is busy: back off
      if (!r.ok) return null;
      return await r.text();
    } catch { await sleep(10000 * (i + 1)); }
  }
  return null;
}

async function readJSON(f, d) { try { return JSON.parse(await fs.readFile(f, "utf8")); } catch { return d; } }

export async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const stateFile = path.join(OUT, "state.json");
  const state = await readJSON(stateFile, { next: 1, maxSeen: 0, done: false, lastFull: 0, misses: 0 });
  const tracksFile = path.join(OUT, "_all.json");
  const all = await readJSON(tracksFile, { cats: {}, tracks: {} });

  // Highest album number right now, from the newest albums on the home page.
  const home = await get(BASE + "/");
  if (!home) throw new Error("home page unreachable — not touching the catalog");
  if (!state.lastFull && state.lastRun) state.lastFull = state.lastRun;
  const WEEK = 7 * 864e5;
  // 1) Newest recordings, from the site's "new" list: only the ones we do not have yet.
  let fresh = 0;
  if (state.done) fresh = await newRecordings(all);
  // 2) Once a week walk every album again (new recordings in old albums, renamed titles).
  if (state.done && Date.now() - (state.lastFull || 0) > WEEK) { state.done = false; state.next = 1; state.fullWalk = true; console.log("weekly full walk"); }
  const newest = home ? Math.max(0, ...[...home.matchAll(/href="\/cat-(\d+)"/g)].map((m) => +m[1])) : 0;
  const target = Math.max(newest, state.maxSeen);
  // After the first full pass, only walk the new albums (and re-check the last 300).
  if (state.done) state.next = Math.max(1, Math.min(state.next, state.maxSeen - 20));   // new albums only

  let fetched = 0;
  while (!timeUp()) {
    const n = state.next;
    if (n > target + 50) { state.done = true; break; }        // 50 empty numbers past the newest: finished
    const html = await get(`${BASE}/cat-${n}`);
    fetched++;
    if (html) {
      const c = parseCat(html);
      let rows = c.rows;
      for (let p = 2; p <= Math.min(c.lastPage, 200) && !timeUp(); p++) {
        await sleep(DELAY_MS);
        const h2 = await get(`${BASE}/cat-${n}/page-${p}`); fetched++;
        if (!h2) break;
        const more = parseCat(h2).rows; if (!more.length) break;
        rows = rows.concat(more);
      }
      all.cats[n] = [c.title, c.section, c.parent ? +c.parent : 0];
      for (const r of rows) all.tracks[r.id] = [r.title, r.artist, r.dur, n];
      state.maxSeen = Math.max(state.maxSeen, n);
    }
    state.next = n + 1;
    if (fetched % 200 === 0) { await fs.writeFile(tracksFile, JSON.stringify(all)); await fs.writeFile(stateFile, JSON.stringify(state)); console.log(`cat ${n}/${target}, tracks ${Object.keys(all.tracks).length}`); }
    await sleep(DELAY_MS);
  }
  if (state.done && !Object.keys(all.tracks).length) state.done = false;   // nothing read: never call that finished
  if (state.done) { state.lastRun = Date.now(); if (state.fullWalk || !state.lastFull) { state.lastFull = Date.now(); state.fullWalk = false; } }
  state.lastNew = Date.now();
  await fs.writeFile(tracksFile, JSON.stringify(all));
  await fs.writeFile(stateFile, JSON.stringify(state));
  await writeShards(all, state.done || !!state.lastRun);
  console.log(`done=${state.done} next=${state.next} tracks=${Object.keys(all.tracks).length} fetched=${fetched} new=${fresh}`);
}

/* ShiaVoice's /new pages list the latest recordings, newest first. Read until a page brings nothing new;
   look up each new recording's section and album on its own page. */
async function newRecordings(all) {
  let added = 0;
  for (let p = 1; p <= 50 && !timeUp(); p++) {
    const html = await get(p === 1 ? `${BASE}/new` : `${BASE}/new/page-${p}`);
    if (!html) break;
    const rows = parseCat(html).rows;
    const unknown = rows.filter((r) => !all.tracks[r.id]);
    if (!rows.length || !unknown.length) break;
    for (const r of unknown) {
      if (timeUp()) break;
      await sleep(DELAY_MS);
      const ph = await get(`${BASE}/play-${r.id}`);
      if (!ph) continue;
      const { section, cats } = parsePlay(ph);
      const [cat, title] = cats.length ? cats[cats.length - 1] : [0, ""];
      const key = cat || "x" + (section || "other");
      if (!all.cats[key]) all.cats[key] = [title, section, cats.length > 1 ? cats[cats.length - 2][0] : 0];
      else if (!all.cats[key][1] && section) all.cats[key][1] = section;
      all.tracks[r.id] = [r.title, r.artist, r.dur, key];
      added++;
    }
    await sleep(DELAY_MS);
  }
  return added;
}

/* The app downloads one small file per section. Each row: [id, title, artistIndex, seconds, album]. */
async function writeShards(all, complete) {
  const sectionOf = (cat) => {
    let c = all.cats[cat], guard = 0;
    while (c && !c[1] && c[2] && guard++ < 6) c = all.cats[c[2]];
    return (c && c[1]) || "other";
  };
  const by = {};
  for (const [id, [title, artist, dur, cat]] of Object.entries(all.tracks)) {
    const s = sectionOf(cat);
    (by[s] = by[s] || { artists: [], aIdx: new Map(), albums: {}, rows: [] });
    const b = by[s];
    if (!b.aIdx.has(artist)) { b.aIdx.set(artist, b.artists.length); b.artists.push(artist); }
    if (!b.albums[cat]) b.albums[cat] = (all.cats[cat] || [""])[0];
    b.rows.push([id, title, b.aIdx.get(artist), dur, +cat || 0]);
  }
  const manifest = { updated: new Date().toISOString(), complete: !!complete, sections: {} };
  for (const [s, b] of Object.entries(by)) {
    const file = `sv-${s}.json`;
    const body = JSON.stringify({ section: s, artists: b.artists, albums: b.albums, rows: b.rows });
    await fs.writeFile(path.join(OUT, file), body);
    // The phone re-downloads a section only when its fingerprint changes.
    manifest.sections[s] = { file, count: b.rows.length, hash: crypto.createHash("sha1").update(body).digest("hex").slice(0, 12) };
  }
  await fs.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
}

if (process.argv[1] && process.argv[1].endsWith("crawl.mjs")) main().catch((e) => { console.error(e); process.exit(1); });
