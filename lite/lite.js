/* قارئ القصائد — the no-key version.
   Photo → on-device OCR (Tesseract) → match against the ShiaVoice catalog held on the phone → recordings.
   No API keys, no accounts. Nothing autoplays: every recording has its own play button. */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const { SECTIONS, store, fetchData, chosen, ask } = QLib;
const catalog = QLib.info;
const ar = (n) => QMatch.toArabicDigits(Number(n).toLocaleString("en-US")).replace(/,/g, "٬");
const recCount = (n) => n === 1 ? "تسجيل واحد" : n === 2 ? "تسجيلان" : n <= 10 ? ar(n) + " تسجيلات" : ar(n) + " تسجيلاً";
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}
const status = (t, err) => { const s = $("#status"); s.textContent = t || ""; s.classList.toggle("err", !!err); };
function work(t, pct) {
  const w = $("#work"); if (t == null) { w.hidden = true; return; }
  w.hidden = false; $("#workT").textContent = t; $("#workP").style.width = pct == null ? "0" : Math.round(pct * 100) + "%";
  $("#workP").parentElement.hidden = pct == null;
}

async function loadCatalog(force) {
  status("أجهّز الفهرس…");
  await QLib.load(force, (t, p) => work(t, p));
  work(null);
  showCatalog();
  if (!catalog.manifest) status("فهرس صوت الشيعة يُجمع الآن ولم يصل بعد — البحث الآن في قصائد الكتاب فقط.");
  else if (catalog.partial) status(`الفهرس ما زال يُجمع: على هاتفك ${recCount(catalog.tracks)} حتى الآن.`);
  else status("");
}

function showCatalog() {
  const m = catalog.manifest;
  $("#catInfo").textContent = m
    ? `على هاتفك ${recCount(catalog.tracks)} من صوت الشيعة` + (catalog.poems ? ` و${ar(catalog.poems)} قصيدة يُبحث في كلماتها` : "") + ` — آخر تحديث ${new Date(m.updated).toLocaleDateString("ar-IQ")}.`
    : "فهرس صوت الشيعة غير متاح بعد؛ يعمل فهرس الكتاب وحده.";
  const list = $("#secList"); list.replaceChildren();
  const on = new Set(chosen(m));
  for (const [s, info] of Object.entries(m?.sections || {})) {
    const id = "sec-" + s;
    list.append(el("label", { class: "sec", for: id },
      el("input", { type: "checkbox", id, checked: on.has(s), onchange: onSections }),
      el("span", {}, SECTIONS[s]?.[0] || s), el("small", { class: "muted" }, ar(info.count))));
  }
}
function onSections() {
  const picked = [...document.querySelectorAll("#secList input:checked")].map((i) => i.id.slice(4));
  store.set("sections", picked);
  location.reload();
}

/* ---------- reading a photo on the phone ---------- */
let ocrWorker = null;
const abs = (p) => new URL(p, location.href).href;
async function getOcr(onProgress) {
  if (ocrWorker) return ocrWorker;
  ocrWorker = Tesseract.createWorker("ara", 1, {
    workerPath: abs("../vendor/tesseract/worker.min.js"), corePath: abs("../vendor/core/"), langPath: abs("../vendor/lang"),
    workerBlobURL: false, gzip: true,
    logger: (m) => onProgress && onProgress(m)
  }).catch((e) => { ocrWorker = null; throw e; });
  return ocrWorker;
}
let progressHook = null;
function scaled(img, maxSide) {
  const w = img.width, h = img.height, s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c;
}
/* Second try for photos with shadows or uneven light: divide by a blurred copy of the page
   so the paper becomes evenly white. (A plain contrast stretch would turn paper grain into ink.) */
function flatten(c) {
  const W = c.width, H = c.height;
  const sm = document.createElement("canvas"); sm.width = Math.max(1, W >> 4); sm.height = Math.max(1, H >> 4);
  const sctx = sm.getContext("2d"); sctx.imageSmoothingQuality = "high"; sctx.drawImage(c, 0, 0, sm.width, sm.height);
  const bg = document.createElement("canvas"); bg.width = W; bg.height = H;
  const bctx = bg.getContext("2d", { willReadFrequently: true }); bctx.imageSmoothingQuality = "high"; bctx.drawImage(sm, 0, 0, W, H);
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const octx = out.getContext("2d", { willReadFrequently: true }); octx.drawImage(c, 0, 0);
  const img = octx.getImageData(0, 0, W, H), d = img.data, b = bctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114, bgv = Math.max(40, b[i] * .299 + b[i + 1] * .587 + b[i + 2] * .114);
    const v = Math.min(255, (g / bgv) * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v;
  }
  octx.putImageData(img, 0, 0); return out;
}
const arabicCount = (t) => (String(t).match(/[ء-ي]/g) || []).length;
function tidy(text) {
  return String(text).split(/\n+/).map((l) => l.replace(/[|_~^*#<>{}\[\]\\]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => arabicCount(l) >= 3).join("\n");
}

async function readPhoto(file) {
  if (!file) return;
  clearResults();
  const url = URL.createObjectURL(file);
  $("#thumb").src = url; $("#thumb").hidden = false;
  let img;
  try { img = await createImageBitmap(file); }
  catch { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
  work("أجهّز القارئ على الهاتف…", 0);
  const stages = { "loading tesseract core": 0.05, "initializing tesseract": 0.1, "loading language traineddata": 0.15, "initializing api": 0.25 };
  progressHook = (m) => {
    if (m.status === "recognizing text") work("أقرأ الصفحة…", 0.3 + 0.7 * (m.progress || 0));
    else if (m.status in stages) work(m.status.includes("language") ? "أنزّل قارئ العربية (مرة واحدة)…" : "أجهّز القارئ على الهاتف…", stages[m.status]);
  };
  try {
    const w = await getOcr((m) => progressHook && progressHook(m));
    const page = scaled(img, 2200);
    let text = tidy((await w.recognize(page)).data.text);
    showRead(text);
    let found = arabicCount(text) >= 8 ? await search(text) : Object.assign([], { list: [] });
    const top = (f) => (f.list && f.list[0] ? f.list[0].score : 0);
    if (top(found) < 0.85) {                               // shadows or a curved page: read once more, evened out
      work("أعيد القراءة بإضاءة مصحَّحة…", 0.5);
      const t2 = tidy((await w.recognize(flatten(page))).data.text);
      if (arabicCount(t2) >= 8) {
        const f2 = await search(t2);
        if (top(f2) > top(found) || (!top(found) && arabicCount(t2) > arabicCount(text))) { text = t2; found = f2; showRead(text); }
      }
    }
    work(null);
    if (arabicCount(text) < 8) {
      status("لم أستطع قراءة نص عربي واضح. قرّب الهاتف من الصفحة واجعل الإضاءة جيدة، أو اكتب العنوان.", true);
      return;
    }
    render(found.list || [], text, false, null);
  } catch (e) {
    work(null);
    status("تعذّر تشغيل القارئ على هذا الهاتف. اكتب العنوان أو سطراً من القصيدة.", true);
  }
}
function showRead(text) { $("#readBox").hidden = false; $("#readText").value = text; }

/* ---------- searching ---------- */
/* Page text → matching poems. A page with nothing recognised: try its first real line as a typed query. */
async function search(text) {
  const res = await ask(text, false);
  let list = res.results;
  if (!list.length) {
    const line = QMatch.guessTitle(text);
    // A single line is weak evidence: these stay "possible" matches.
    if (line) list = (await ask(line, true)).results.filter((r) => r.score >= 0.7).map((r) => ({ ...r, score: r.score * 0.82 }));
  }
  const out = list.slice(); out.list = list; return out;
}
async function runSearch(text, typed) {
  if (catalog.manifest && !catalog.partial) status("");
  work("أبحث في الفهرس…");
  try {
    if (typed) { const res = await ask(text, true); work(null); render(res.results, text, true, res.artist); }
    else { const f = await search(text); work(null); render(f.list, text, false, null); }
  } catch { work(null); status("حدث خطأ أثناء البحث.", true); }
}

function clearResults() { $("#results").replaceChildren(); status(""); }
const fmt = (s) => { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return QMatch.toArabicDigits((h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0")); };
const yt = (q) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);

function render(list, text, typed, artist) {
  const box = $("#results"); box.replaceChildren();
  if (!list.length) {
    const q = typed ? text : QMatch.guessTitle(text) || text.slice(0, 60);
    box.append(el("div", { class: "card empty" },
      el("h2", {}, "لم أجد القصيدة في الفهرس"),
      !catalog.manifest ? el("p", { class: "warnline" }, "فهرس صوت الشيعة يُجمع الآن ولم يصل إلى هاتفك بعد، فالبحث الآن في قصائد الكتاب فقط. يصل أول جزء منه خلال ساعة تقريباً ويكتمل خلال يوم؛ أعد فتح التطبيق لاحقاً.") :
        catalog.partial ? el("p", { class: "warnline" }, `الفهرس ما زال يُجمع (${ar(catalog.tracks)} تسجيلاً حتى الآن)؛ قد تكون القصيدة في جزء لم يصل بعد.`) : null,
      el("p", { class: "muted" }, typed ? "جرّب عنوان القصيدة أو مطلعها، أو اسم الرادود." : "صحّح العنوان في مربع «قرأت من الصفحة» ثم أعد البحث، أو صوّر الصفحة أقرب إلى العنوان."),
      artist ? el("p", {}, "يبدو أنك تبحث عن الرادود ", el("strong", {}, artist.name), ". ",
        el("a", { href: "https://shiavoice.com/search?q=" + encodeURIComponent(artist.name), target: "_blank", rel: "noopener" }, "تسجيلاته في صوت الشيعة ↗")) : null,
      el("div", { class: "row" },
        el("a", { class: "btn ghost", href: "https://shiavoice.com/search?q=" + encodeURIComponent(q), target: "_blank", rel: "noopener" }, "ابحث في موقع صوت الشيعة ↗"),
        el("a", { class: "btn ghost", href: yt(q + " لطمية"), target: "_blank", rel: "noopener" }, "يوتيوب ↗"))));
    return;
  }
  const strong = list[0].score >= 0.85 && (!list[1] || list[0].score - list[1].score >= 0.05);
  status(strong ? "" : "عدة قصائد محتملة — اختر الصحيحة.");
  list.slice(0, 8).forEach((r, i) => box.append(card(r, i === 0)));
}

function card(r, open) {
  const p = r.book;
  const top = r.recs[0];
  const conf = r.score >= 0.88 ? ["مطابقة قوية", "good"] : r.score >= 0.75 ? ["مطابقة جيدة", "ok"] : ["محتملة", "maybe"];
  const head = el("div", { class: "rhead" },
    el("h2", { class: "ptitle" }, p ? p.title : r.title),
    el("div", { class: "meta" },
      el("span", { class: "chip " + conf[1] }, conf[0]),
      p?.poet ? el("span", {}, "كلمات: " + p.poet) : r.lyric?.poet ? el("span", {}, "كلمات: " + r.lyric.poet) : null,
      !top && r.lyric?.reciter ? el("span", {}, "بصوت: " + r.lyric.reciter) : null,
      top?.artist ? el("span", {}, (p ? "بصوت: " : "") + [...new Set(r.recs.map((x) => x.artist))].slice(0, 3).join("، ")) : null,
      el("span", { class: "muted" }, recCount(r.total + (p?.recordings?.filter((x) => x.type === "audio").length || 0)))));
  const body = el("div", { class: "rbody" });
  if (p?.books?.length) body.append(el("p", { class: "muted small" }, "في: " + p.books.map((b) => b.book + (b.page ? " — ص " + QMatch.toArabicDigits(b.page) : "")).join("؛ ")));
  const recList = el("ol", { class: "recs" });
  for (const a of (p?.recordings || []).filter((x) => x.type === "audio")) recList.append(bookAudio(a, p));
  const shown = r.recs.slice(0, 6);
  for (const x of shown) recList.append(svRow(x));
  body.append(recList);
  if (!r.recs.length && !(p?.recordings || []).length)
    body.append(el("p", { class: "muted small" }, "لم أجد تسجيلاً بهذا العنوان في فهرس صوت الشيعة — جرّب «المزيد في صوت الشيعة» أو يوتيوب."));
  if (r.recs.length > shown.length) {
    const more = el("button", { class: "btn ghost small", type: "button", onclick: () => { for (const x of r.recs.slice(shown.length)) recList.append(svRow(x)); more.remove(); } },
      `عرض كل التسجيلات (${ar(r.recs.length)})`);
    body.append(more);
  }
  const q = (p ? p.title : r.title) + (top?.artist ? " " + top.artist : r.lyric?.reciter ? " " + r.lyric.reciter : "");
  body.append(el("div", { class: "row side" },
    r.lyric ? el("a", { class: "btn ghost small", href: r.lyric.url, target: "_blank", rel: "noopener" }, "اقرأ الكلمات ↗") : null,
    el("a", { class: "btn ghost small", href: yt(q), target: "_blank", rel: "noopener" }, "فيديو على يوتيوب ↗"),
    el("a", { class: "btn ghost small", href: "https://shiavoice.com/search?q=" + encodeURIComponent(p ? p.title : r.title), target: "_blank", rel: "noopener" }, "المزيد في صوت الشيعة ↗")));
  if (open) return el("article", { class: "card result" }, head, body);
  const d = el("details", { class: "card result" }, el("summary", {}, head), body);
  return d;
}

function bookAudio(a, p) {
  const li = el("li", { class: "rec" });
  const main = el("div", { class: "recmain" },
    el("button", { class: "play", type: "button", "aria-label": "تشغيل " + p.title + (a.reciter ? " — " + a.reciter : ""), onclick: () => {
      stopAll();
      const au = el("audio", { controls: true, preload: "none", src: a.src });
      li.append(el("div", { class: "player" }, au,
        el("div", { class: "row pact" },
          el("a", { class: "btn small", href: a.src, download: "", target: "_blank", rel: "noopener" }, dlIcon(), "تنزيل"),
          el("button", { class: "btn ghost small", type: "button", onclick: stopAll }, "إيقاف"))));
      au.play().catch(() => {});   // the person pressed play: start it
      main.querySelector(".play").hidden = true;
    } }, playIcon()),
    el("div", { class: "rtext" }, el("strong", {}, a.reciter || p.title), el("small", { class: "muted" }, a.source || "شبكة رافد")));
  li.append(main); return li;
}
function svRow(x) {
  const li = el("li", { class: "rec" });
  const btn = el("button", { class: "play", type: "button", "aria-label": "تشغيل " + x.title + " — " + x.artist, onclick: () => {
    stopAll();
    // ShiaVoice's player needs ~600px; on a phone its play button falls off-screen. Lay it out wide and
    // show the part that holds the play button and progress bar (title and reciter are already in our row).
    li.append(el("div", { class: "player" },
      el("div", { class: "svwrap" },
        el("iframe", { class: "svframe", src: "https://shiavoice.com/embed-" + encodeURIComponent(x.id), title: x.title + " — صوت الشيعة", referrerpolicy: "strict-origin-when-cross-origin" })),
      el("div", { class: "row pact" },
        el("a", { class: "btn small", href: "https://shiavoice.com/play-" + encodeURIComponent(x.id), target: "_blank", rel: "noopener" }, dlIcon(), "تنزيل"),
        el("span", { class: "muted small" }, "يفتح صفحة الملف في صوت الشيعة، وفيها زر التحميل"),
        el("button", { class: "btn ghost small", type: "button", onclick: stopAll }, "إيقاف"))));
    btn.hidden = true; li.classList.add("on");
  } }, playIcon());
  li.append(el("div", { class: "recmain" }, btn,
    el("div", { class: "rtext" }, el("strong", {}, x.title),
      el("small", { class: "muted" }, [x.artist, fmt(x.dur), x.album].filter(Boolean).join(" · "))),
    el("a", { class: "icon ext", href: "https://shiavoice.com/play-" + encodeURIComponent(x.id), target: "_blank", rel: "noopener", "aria-label": "صفحة الملف في صوت الشيعة (للتحميل)", title: "صفحة الملف والتحميل" }, "↗")));
  return li;
}
/* One recording at a time: closing the others stops their sound. */
function stopAll() {
  for (const p of document.querySelectorAll(".player")) { const li = p.closest("li"); p.remove(); li.classList.remove("on"); const b = li.querySelector(".play"); if (b) b.hidden = false; }
}
function dlIcon() { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "18"); s.setAttribute("height", "18"); s.setAttribute("aria-hidden", "true"); s.innerHTML = '<path fill="currentColor" d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V3ZM5 18h14v2H5z"/>'; return s; }
function playIcon() { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "20"); s.setAttribute("height", "20"); s.setAttribute("aria-hidden", "true"); s.innerHTML = '<path fill="currentColor" d="M8 5v14l11-7z"/>'; return s; }

/* ---------- wiring ---------- */
$("#camIn").addEventListener("change", (e) => { readPhoto(e.target.files[0]); e.target.value = ""; });
$("#galIn").addEventListener("change", (e) => { readPhoto(e.target.files[0]); e.target.value = ""; });
$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("#q").value.trim(); if (!t) { $("#q").focus(); return; }
  $("#readBox").hidden = true; $("#q").blur();
  runSearch(t, true);
});
$("#reBtn").addEventListener("click", () => { const t = $("#readText").value.trim(); if (t) runSearch(t, t.length < 60 && !t.includes("\n")); });
$("#clearBtn").addEventListener("click", () => { $("#readBox").hidden = true; $("#thumb").hidden = true; clearResults(); });
$("#setBtn").addEventListener("click", () => {
  const s = $("#settings"); s.hidden = !s.hidden; $("#setBtn").setAttribute("aria-expanded", String(!s.hidden));
  if (!s.hidden) s.scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#updBtn").addEventListener("click", async () => { $("#updBtn").disabled = true; await loadCatalog(true).catch(() => {}); location.reload(); });

let dict = null;
$("#micBtn").addEventListener("click", async () => {
  const mic = $("#micBtn");
  if (dict) { dict.stop(); return; }
  if (!QVoice.canDictate()) { status("الإملاء الصوتي غير متاح في هذا المتصفح. اضغط على مربع البحث واستخدم زر الميكروفون في لوحة المفاتيح.", true); $("#q").focus(); return; }
  mic.classList.add("live"); status("تكلّم الآن… اقرأ سطراً من القصيدة أو عنوانها.");
  dict = QVoice.dictate({ onInterim: (t) => { $("#q").value = t; } });
  try {
    const t = await dict;
    if (t) { $("#q").value = t; status(""); runSearch(t, true); } else status("لم أسمع شيئاً. حاول مرة أخرى.", true);
  } catch (e) {
    status(e.code === "denied" ? "لم يُسمح باستخدام الميكروفون. امنح الإذن من إعدادات المتصفح." :
      "لم يعمل الإملاء هنا. اضغط على مربع البحث واستخدم ميكروفون لوحة المفاتيح.", true);
    $("#q").focus();
  } finally { dict = null; mic.classList.remove("live"); }
});

if ("serviceWorker" in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js?v=1", { scope: "./" }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) location.reload(); });
}
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !(catalog.partial || !catalog.manifest)) return;
  const m = await fetchData("manifest.json", true);
  if (m && m.updated !== catalog.updated) { store.set("manifest", m); location.reload(); }
});
loadCatalog(false).catch(() => { work(null); status("تعذّر تحميل الفهرس. تحقق من الاتصال ثم أعد فتح التطبيق.", true); });
