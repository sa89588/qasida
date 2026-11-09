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

QLib.onChange(() => showCatalog());
async function loadCatalog(force) {
  status("أجهّز الفهرس…");
  await QLib.load(force, (t, p) => { if (t == null) work(null); else if (!QLib.info.tracks) work(t, p); });
  work(null);
  showCatalog();
  if (!catalog.manifest) status("فهرس صوت الشيعة يُجمع الآن ولم يصل بعد — البحث الآن في قصائد الكتاب فقط.");
  else if (catalog.partial) status(`الفهرس ما زال يُجمع: على هاتفك ${recCount(catalog.tracks)} حتى الآن.`);
  else status("");
}

function showCatalog() {
  const m = catalog.manifest;
  $("#catInfo").textContent = m
    ? `على هاتفك ${recCount(catalog.tracks)} من صوت الشيعة` + (catalog.poems ? ` و${catalog.poems === 1 ? "قصيدة واحدة" : catalog.poems === 2 ? "قصيدتان" : ar(catalog.poems) + (catalog.poems % 100 >= 3 && catalog.poems % 100 <= 10 ? " قصائد" : " قصيدة")} يُبحث في كلماتها` : "") + ` — آخر تحديث ${new Date(m.updated).toLocaleDateString("ar-IQ")}.`
    : "فهرس صوت الشيعة غير متاح بعد؛ يعمل فهرس الكتاب وحده.";
  const li = QLib.info.lyricsIndex, when = (d) => d ? new Date(d).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" }) : "—";
  $("#updInfo").textContent = `آخر جمع للتسجيلات: ${when(m?.updated)} · للكلمات: ${when(li?.updated)}` + (li?.telegram && Object.values(li.telegram).includes("collecting") ? " · ما زالت قصائد قنوات تيليگرام القديمة تُجمع." : "");
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
    const photo = scaled(img, 2200);
    // The page's edges found → perspective and tilt corrected; the straightened page is read first.
    let page = photo;
    try { const sp = window.QScanner && QScanner.pageOf(photo, 2000); if (sp && sp.canvas) { page = sp.canvas; $("#thumb").src = sp.canvas.toDataURL("image/jpeg", 0.6); } } catch {}
    let text = tidy((await w.recognize(page)).data.text);
    showRead(text);
    let found = arabicCount(text) >= 8 ? await search(text) : Object.assign([], { list: [] });
    const top = (f) => (f.list && f.list[0] ? f.list[0].score : 0);
    if (page !== photo && top(found) < 0.85) {             // straightening misjudged: the photo as it is
      const t0 = tidy((await w.recognize(photo)).data.text);
      if (arabicCount(t0) >= 8) { const f0 = await search(t0); if (top(f0) > top(found)) { text = t0; found = f0; page = photo; showRead(text); } }
    }
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

function clearResults() { QPlayer.stop(); $("#results").replaceChildren(); status(""); }
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
      el("span", { class: "muted" }, (() => { const n = r.total + (p?.recordings?.filter((x) => x.type === "audio").length || 0); return n ? recCount(n) : "لا تسجيل في الفهرس بعد"; })())));
  const body = el("div", { class: "rbody" });
  if (p?.books?.length) body.append(el("p", { class: "muted small" }, "في: " + p.books.map((b) => b.book + (b.page ? " — ص " + QMatch.toArabicDigits(b.page) : "")).join("؛ ")));
  // Every recording of this poem is one queue for the shared player (player.js): tap any to start there.
  const cardTitle = p ? p.title : r.title, poet = p?.poet || r.lyric?.poet || "";
  const queue = [
    ...(p?.recordings || []).filter((x) => x.type === "audio" && x.src).map((a) => ({ rec: { type: "audio", src: a.src, reciter: a.reciter || "", source: a.source || "شبكة رافد" }, title: p.title, poem: { id: p.id, title: p.title, poet: p.poet || "" } })),
    ...r.recs.map((x) => ({ rec: { type: "shiavoice", id: x.id, reciter: x.artist, note: x.title, dur: x.dur, album: x.album || "", section: x.section || "" }, title: x.title, poem: { title: cardTitle, poet } }))];
  const slot = el("div", { class: "qpslot" });
  const recList = el("ol", { class: "recs" });
  const start = (k) => { recList.remove(); more && more.remove(); QPlayer.mount(slot, { queue, index: k, autoplay: true, queueTitle: "التسجيلات" }); };
  queue.slice(0, 6).forEach((it, k) => recList.append(recRow(it, () => start(k))));
  body.append(slot, recList);
  if (!queue.length)
    body.append(el("p", { class: "muted small" }, "لم أجد تسجيلاً بهذا العنوان في فهرس صوت الشيعة — جرّب «المزيد في صوت الشيعة» أو يوتيوب."));
  let more = null;
  if (queue.length > 6) {
    more = el("button", { class: "btn ghost small", type: "button", onclick: () => { queue.slice(6).forEach((it, k) => recList.append(recRow(it, () => start(k + 6)))); more.remove(); more = null; } },
      `عرض كل التسجيلات (${ar(queue.length)})`);
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

/* A recording before anything plays: tap to open the player on it. */
function recRow(it, onPlay) {
  const r = it.rec, d = QPlayer.describe(r);
  return el("li", { class: "rec" }, el("div", { class: "recmain" },
    el("button", { class: "play", type: "button", "aria-label": "تشغيل " + it.title + (r.reciter ? " — " + r.reciter : ""), onclick: onPlay }, playIcon()),
    el("div", { class: "rtext" }, el("strong", {}, it.title),
      el("small", { class: "muted" }, [r.reciter, d.source, d.kind, d.occasion || d.date, d.dur ? QPlayer.clock(d.dur) : ""].filter(Boolean).join(" · ")))));
}
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
/* «قوائمي»: favourites and lists — the same ones as the full app on this phone. */
function renderLists(openId) {
  const box = $("#lists"), S = QPlayer.store;
  box.replaceChildren(el("h2", { id: "listsT" }, "قوائمي"));
  const L = openId && S.lists().find((x) => x.id === openId);
  if (L) {
    box.append(el("button", { class: "btn ghost small", type: "button", onclick: () => { QPlayer.stop(); renderLists(); } }, "→ كل القوائم"),
      el("h3", { class: "lname" }, (L.id === "fav" ? "♥ " : "") + L.name));
    const slot = el("div", { class: "qpslot" });
    box.append(slot);
    if (!L.items.length) slot.append(el("p", { class: "muted small" }, "القائمة فارغة."));
    else QPlayer.mount(slot, { queue: QPlayer.listQueue(L), index: 0, autoplay: true, queueTitle: "القائمة" });
    const edit = el("ul", { class: "ledit" }, L.items.map((it) => el("li", {}, el("span", {}, it.title + (it.rec.reciter ? " — " + it.rec.reciter : "")),
      el("button", { class: "btn ghost small", type: "button", "aria-label": "أزل «" + it.title + "» من القائمة", onclick: () => { S.removeFromList(L.id, it.k); renderLists(L.id); } }, "إزالة"))));
    if (L.items.length) box.append(el("details", {}, el("summary", {}, "تعديل القائمة"), edit));
    if (L.id !== "fav") box.append(el("button", { class: "btn ghost small", type: "button", onclick: (e) => {
      const b = e.currentTarget; if (b.dataset.sure) { S.deleteList(L.id); QPlayer.stop(); renderLists(); return; }
      b.dataset.sure = "1"; b.textContent = "اضغط مرة أخرى لحذف «" + L.name + "»"; } }, "احذف القائمة"));
    return;
  }
  const ul = el("ul", { class: "lall" });
  for (const x of S.lists()) ul.append(el("li", {},
    el("span", {}, el("strong", {}, (x.id === "fav" ? "♥ " : "") + x.name), el("small", { class: "muted" }, " · " + (x.items.length ? recCount(x.items.length) : "فارغة"))),
    x.items.length ? el("button", { class: "btn small", type: "button", onclick: () => renderLists(x.id) }, "▶ شغّل") : null));
  box.append(ul, el("p", { class: "muted small" }, "للإضافة: شغّل تسجيلاً ثم «أضف إلى المفضلة» أو «أضف إلى قائمة» تحت المشغّل."));
}
$("#listsBtn").addEventListener("click", () => {
  const s = $("#lists"); s.hidden = !s.hidden; $("#listsBtn").setAttribute("aria-expanded", String(!s.hidden));
  if (!s.hidden) { renderLists(); s.scrollIntoView({ behavior: "smooth", block: "start" }); }
});
$("#setBtn").addEventListener("click", () => {
  const s = $("#settings"); s.hidden = !s.hidden; $("#setBtn").setAttribute("aria-expanded", String(!s.hidden));
  if (!s.hidden) s.scrollIntoView({ behavior: "smooth", block: "start" });
});
/* Check for new recordings and poems now: the server collects every few hours; this pulls its latest at once. */
async function checkNew(btn) {
  btn.disabled = true;
  status("أتحقق من الجديد…");
  try {
    const r = await QLib.checkNow((t, p) => work(t, p));
    work(null); showCatalog();
    const bits = [];
    const cnt = (n, w) => n === 1 ? w[0] : n === 2 ? w[1] : ar(n) + " " + (n % 100 >= 3 && n % 100 <= 10 ? w[2] : w[3]);
    if (r.newTracks) bits.push(cnt(r.newTracks, ["تسجيل جديد", "تسجيلان جديدان", "تسجيلات جديدة", "تسجيلاً جديداً"]));
    if (r.newPoems) bits.push(cnt(r.newPoems, ["قصيدة جديدة", "قصيدتان جديدتان", "قصائد جديدة", "قصيدة جديدة"]) + " بكلماتها");
    status(bits.length ? "أُضيف: " + bits.join(" و") + "." : "لا جديد منذ آخر تحديث. يجمع الخادم الجديد كل بضع ساعات.");
  } catch { work(null); status("تعذّر التحقق الآن. تأكد من الاتصال.", true); }
  btn.disabled = false;
}
$("#newBtn").addEventListener("click", () => checkNew($("#newBtn")));
$("#updBtn").addEventListener("click", () => checkNew($("#updBtn")));
$("#allBtn").addEventListener("click", async () => { $("#allBtn").disabled = true; await QLib.load(true, (t, p) => work(t, p)).catch(() => {}); work(null); location.reload(); });

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

/* Listen to a recording playing nearby (TV, another phone, a majlis): the browser turns what it hears
   into words as they come, and the poem-words index is searched every few seconds until a poem fits. */
let listening = null;
$("#listenBtn").addEventListener("click", () => { if (listening) listening.stop(); else listen(); });
function listen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { status("الاستماع غير متاح في هذا المتصفح. جرّب Chrome، أو اكتب سطراً سمعته.", true); return; }
  const btn = $("#listenBtn"), started = Date.now(), LIMIT = 30000;
  let heard = "", searched = "", done = false, best = null;
  const r = new SR(); r.lang = "ar-IQ"; r.continuous = true; r.interimResults = true;
  r.onresult = (ev) => { heard = [...ev.results].map((x) => x[0].transcript).join(" ").trim(); $("#q").value = heard; };
  r.onerror = (ev) => { if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { finish(); status("لم يُسمح باستخدام الميكروفون. امنح الإذن من إعدادات المتصفح.", true); } };
  r.onend = () => { if (!done && Date.now() - started < LIMIT) { try { r.start(); } catch {} } };   // the browser pauses on silence: keep listening
  const tick = setInterval(async () => {
    const secs = Math.round((Date.now() - started) / 1000);
    if (!done) status(`أستمع… ${QMatch.toArabicDigits(secs)} ث` + (heard ? " — «" + heard.split(/\s+/).slice(-8).join(" ") + "»" : " — قرّب الهاتف من الصوت"));
    if (Date.now() - started > LIMIT) { finish(); return; }
    if (heard && heard !== searched && heard.split(/\s+/).length >= 3) {
      searched = heard;
      const res = await ask(heard, true).catch(() => null);
      const top = res && res.results[0];
      if (top && (!best || top.score > best.score)) best = { ...top, all: res.results };
      if (top && top.score >= 0.85 && heard.split(/\s+/).length >= 4) finish();
    }
  }, 2500);
  function finish() {
    if (done) return; done = true; clearInterval(tick); listening = null;
    try { r.stop(); } catch {}
    btn.classList.remove("live");
    if (best) { status(""); $("#readBox").hidden = true; render(best.all, heard, true, null); }
    else status(heard ? "سمعت كلاماً لكن لم أجد قصيدة تطابقه. اكتب سطراً أوضح أو جرّب مرة أخرى أقرب إلى الصوت." : "لم أسمع شيئاً واضحاً. قرّب الهاتف من الصوت وجرّب مرة أخرى.", !best);
  }
  try { r.start(); } catch { status("تعذّر تشغيل الميكروفون.", true); return; }
  btn.classList.add("live"); clearResults(); listening = { stop: finish };
}

/* Installing: the browser's own prompt where it offers one (Android, desktop); instructions otherwise. */
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let deferredInstall = null;
function paintInstall() {
  const can = !!deferredInstall && !standalone();
  $("#installBtn").hidden = !can; $("#installBtn2").hidden = !can;
  if (standalone()) { $("#installState").textContent = "التطبيق مثبّت ويعمل الآن كتطبيق مستقل ✓"; $(".howlist").hidden = true; }
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; paintInstall(); });
window.addEventListener("appinstalled", () => { deferredInstall = null; paintInstall(); status("ثُبّت التطبيق. ستجده على الشاشة الرئيسية باسم «قصائد خفيفة»."); });
async function install() {
  if (!deferredInstall) { $("#settings").hidden = false; $("#installBox").scrollIntoView({ behavior: "smooth" }); return; }
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch {}
  deferredInstall = null; paintInstall();
}
$("#installBtn").addEventListener("click", install);
$("#installBtn2").addEventListener("click", install);
paintInstall();

if ("serviceWorker" in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js?v=1", { scope: "./" }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) location.reload(); });
}
document.addEventListener("visibilitychange", () => {          // back to the app: pick up what the server collected meanwhile
  if (document.visibilityState === "visible" && Date.now() - (QLib.info.checked || 0) > 30 * 60e3) QLib.checkNow().catch(() => {});
});
loadCatalog(false).catch(() => { work(null); status("تعذّر تحميل الفهرس. تحقق من الاتصال ثم أعد فتح التطبيق.", true); });
