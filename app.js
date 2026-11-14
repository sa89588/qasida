(() => {
"use strict";
const M = window.QMatch, S = window.QSmart;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const abs = (p) => new URL(p, location.href).href;
const LS = { local: "qasida.localPoems.v1", extra: "qasida.extraRecordings.v1", pos: "qasida.audioPos.v1", hist: "qasida.history.v1", theme: "qasida.theme", lists: "qasida.lists.v1", play: "qasida.play.v1" };

const state = {
  base: [], poems: [], temp: null, view: "scan", poemId: null, page: null,
  stream: null, track: null, torch: false, scanning: false, busy: false, frames: 0, textyFrames: 0,
  worker: null, workerP: null, ctl: null, deferredInstall: null, saved: new Set()
};

/* ---------- storage ---------- */
function lsGet(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

/* ---------- DOM ---------- */
function el(tag, attrs, ...kids){
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const IC = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  save: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12 5 5 9-10"/></svg>',
  film: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"/></svg>'
};
const ar = M.toArabicDigits;
const fmtTime = (s) => { if (!isFinite(s)) return "٠:٠٠"; s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return ar((h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0")); };
function safeUrl(u){ try { const x = new URL(String(u)); return (x.protocol === "https:" || x.protocol === "http:") ? x.href : null; } catch { return null; } }
const ytSearchUrl = (...p) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(p.filter(Boolean).join(" "));

/* ---------- index ---------- */
async function loadIndex(){
  try { const r = await fetch("poems.json", { cache: "no-cache" }); const j = await r.json(); state.base = Array.isArray(j.poems) ? j.poems : []; }
  catch { state.base = []; }
  rebuild();
}
function rebuild(){
  const extra = lsGet(LS.extra, {}), local = lsGet(LS.local, []);
  const join = (p, isLocal) => ({ ...p, local: isLocal, recordings: [...(p.recordings || []), ...(extra[p.id] || [])] });
  state.poems = [...state.base.map((p) => join(p, false)), ...local.map((p) => join(p, true))];
  renderIndex(); renderRecent(); renderMine();
}
const poemById = (id) => (state.temp && state.temp.id === id) ? state.temp : state.poems.find((p) => p.id === id);
const playable = (p) => (p.recordings || []).filter((r) => (r.type === "audio" && safeUrl(r.src)) || (r.type === "file" && /^file:/.test(r.key || "")) || (r.type === "shiavoice" && /^[A-Za-z0-9]{3,12}$/.test(r.id || "")) || (r.type === "youtube" && /^[\w-]{11}$/.test(r.id || "")))
  .map((r, i) => ({ r, i, o: r.type === "youtube" ? 1 : 0 })).sort((a, b) => (a.o - b.o) || (a.i - b.i)).map((x) => x.r);

function renderIndex(){
  const box = $("#index");
  const f = M.compact($("#q").value);
  let list = state.poems.slice().sort((a, b) => String(a.title).localeCompare(String(b.title), "ar"));
  if (f.length >= 2) list = list.filter((p) => M.compact([p.title, p.poet, p.opening, p.refrain, ...(p.reciters || [])].join(" ")).includes(f));
  $("#idxCount").textContent = ar(state.poems.length) + " قصيدة";
  $("#searchMore").hidden = true;
  if (!list.length){
    box.replaceChildren(el("p", { class: "muted", text: state.poems.length ? "لا توجد قصيدة في الفهرس تطابق ما كتبت." : "تعذّر تحميل الفهرس. تحقّق من الاتصال ثم أعد فتح التطبيق." }));
    if (f.length >= 3) renderSearchMore($("#q").value.trim());
    return;
  }
  box.replaceChildren(...list.map((p) => {
    const n = playable(p).length;
    return el("button", { type: "button", class: "item", onclick: () => go("p-" + p.id) },
      el("span", { class: "mark", "aria-hidden": "true", text: (p.title || "؟").replace(/^يا\s*/, "").trim().charAt(0) }),
      el("span", { class: "tx" }, el("span", { class: "tt", text: p.title }), el("span", { class: "sub", text: [p.poet, (p.reciters || []).join("، ")].filter(Boolean).join(" · ") || "—" })),
      el("span", { class: "cnt" }, el("span", { text: n ? ar(n) + " تسجيل" : "بلا تسجيل" }), (p.recordings || []).some(isSaved) ? el("span", { class: "loc", text: "دون إنترنت ✓" }) : p.local ? el("span", { class: "loc", text: "على هاتفك" }) : null));
  }));
}
function renderSearchMore(q){
  const box = $("#searchMore"); box.hidden = false; box.replaceChildren();
  if (S.hasYouTube()){
    box.append(el("button", { type: "button", class: "btn primary", onclick: () => textSearch(q) }, "ابحث عن «" + q + "» في يوتيوب"));
  } else {
    box.append(el("a", { class: "btn", href: ytSearchUrl(q), target: "_blank", rel: "noopener" }, "ابحث في يوتيوب"),
      el("p", { class: "small muted" }, "فعّل التعرّف الذكي من ", el("a", { href: "#settings" }, "الإعدادات"), " ليعمل البحث داخل التطبيق."));
  }
}

/* ---------- history ---------- */
function pushHistory(p){
  if (!p || p.id === "tmp") return;
  const h = lsGet(LS.hist, []).filter((x) => x !== p.id); h.unshift(p.id); lsSet(LS.hist, h.slice(0, 10)); renderRecent();
}
function renderRecent(){
  const ids = lsGet(LS.hist, []).filter((id) => state.poems.some((p) => p.id === id));
  $("#recentBox").hidden = !ids.length;
  $("#recent").replaceChildren(...ids.map((id) => { const p = poemById(id); return el("button", { type: "button", class: "rc", onclick: () => go("p-" + id) }, el("b", { text: p.title }), el("span", { text: (p.reciters || [])[0] || p.poet || "" })); }));
}

/* ---------- routing ---------- */
function go(h){ if (location.hash === "#" + h) route(); else location.hash = h; }
window.addEventListener("hashchange", route);
function route(){
  const h = location.hash.replace(/^#/, "");
  const m = h.match(/^p-([\w-]+)$/);
  let view = "scan";
  const ml = h.match(/^list-([\w-]+)$/);
  if (m && poemById(m[1])){ view = "poem"; renderPoem(m[1]); }
  else if (ml && lists().some((x) => x.id === ml[1])){ view = "lists"; if (state.listOpen !== ml[1] || !$("#view-lists .lstage")) renderList(ml[1]); }
  else if (h === "lists"){ view = "lists"; renderLists(); }
  else if (h === "index" || h === "settings") view = h;
  if (view !== "scan" && state.stream) stopCamera();
  if (view !== "poem" && !(view === "lists" && ml)) pauseMedia();
  if (!(view === "lists" && ml)) state.listOpen = null;
  for (const v of ["scan", "poem", "index", "settings", "lists"]) $("#view-" + v).hidden = v !== view;
  const tab = view === "poem" ? null : view;
  $$(".tabbar a").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (state.view !== view) window.scrollTo({ top: 0, behavior: "auto" });
  state.view = view;
  if (view === "settings"){ fillSettings(); if (!S.ready()) $("#keysCard").open = true; }
  if (view === "scan") renderSmartCard();
}

/* ---------- on-device reader ---------- */
function getWorker(){
  if (state.worker) return Promise.resolve(state.worker);
  if (state.workerP) return state.workerP;
  state.workerP = Tesseract.createWorker("ara", 1, {
    workerPath: abs("vendor/tesseract/worker.min.js"), corePath: abs("vendor/core/"), langPath: abs("vendor/lang"),
    workerBlobURL: false, gzip: true
  }).then((w) => { state.worker = w; return w; })
    .catch((e) => { state.workerP = null; throw e; });
  return state.workerP;
}
function scaleCanvas(src, w, h, maxSide){
  const s = Math.min(1, maxSide / Math.max(w, h)) || 1;
  const c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}
/* Uneven light: divide by a blurred copy of the page so the paper becomes evenly white.
   (v13 stretched contrast instead, which turned paper grain into ink on clean pages.) */
function flatten(src){
  const W = src.width, H = src.height;
  const sm = document.createElement("canvas"); sm.width = Math.max(1, W >> 4); sm.height = Math.max(1, H >> 4);
  const sctx = sm.getContext("2d"); sctx.imageSmoothingQuality = "high"; sctx.drawImage(src, 0, 0, sm.width, sm.height);
  const bg = document.createElement("canvas"); bg.width = W; bg.height = H;
  const bctx = bg.getContext("2d", { willReadFrequently: true }); bctx.imageSmoothingQuality = "high"; bctx.drawImage(sm, 0, 0, W, H);
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const octx = out.getContext("2d", { willReadFrequently: true }); octx.drawImage(src, 0, 0);
  const img = octx.getImageData(0, 0, W, H), d = img.data, b = bctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < d.length; i += 4){
    const g = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114, bgv = Math.max(40, b[i] * .299 + b[i + 1] * .587 + b[i + 2] * .114);
    const v = Math.min(255, (g / bgv) * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v;
  }
  octx.putImageData(img, 0, 0); return out;
}
/* Read the photo as it is; if little comes out, read it again with the light evened out. */
async function ocr(colorCanvas, quick){
  const w = await getWorker();
  const t1 = (await w.recognize(colorCanvas)).data.text || "";
  if (quick || arabicLetters(t1) >= 40) return t1;
  const t2 = (await w.recognize(flatten(colorCanvas))).data.text || "";
  return arabicLetters(t2) > arabicLetters(t1) ? t2 : t1;
}
const arabicLetters = (t) => (String(t).match(/[ء-ي]/g) || []).length;

/* ---------- work card ---------- */
function work(title, sub){
  const w = $("#work");
  if (title == null){ w.hidden = true; return; }
  w.hidden = false; $("#workTitle").textContent = title; $("#workSub").textContent = sub || "";
}
let noteTimer = null;
function note(text, isErr){
  const n = $("#camNote"); clearTimeout(noteTimer);
  n.hidden = !text; $("#noteText").textContent = text || ""; n.className = "note" + (isErr ? " err" : "");
  if (text) noteTimer = setTimeout(() => { n.hidden = true; }, isErr ? 9000 : 5000);
}
$("#noteX").addEventListener("click", () => note(null));
$("#cancelBtn").addEventListener("click", () => { state.ctl?.abort(); work(null); });

/* ---------- camera ---------- */
function camStatus(t){ const s = $("#camStatus"); s.hidden = !t; s.textContent = t || ""; }
async function startCamera(){
  note(null);
  if (!navigator.mediaDevices?.getUserMedia){ note("هذا المتصفح لا يتيح الكاميرا داخل الصفحة. استخدم «اختر صورة من المعرض»، أو افتح التطبيق في كروم أو سفاري.", true); return; }
  getWorker().catch(() => {});
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
    state.stream = stream; state.track = stream.getVideoTracks()[0];
    const v = $("#video"); v.srcObject = stream; await v.play().catch(() => {});
    $("#stage").classList.add("on"); $("#camBar").hidden = false;
    let caps = {}; try { caps = state.track.getCapabilities ? state.track.getCapabilities() : {}; } catch {}
    $("#torchBtn").hidden = !caps.torch;
    try { if (caps.focusMode?.includes("continuous")) await state.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch {}
    state.scanning = true; state.frames = 0; state.textyFrames = 0;
    camStatus("ثبّت الهاتف فوق الصفحة…");
    scanLoop(); outlineLoop();
  } catch (e){
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    note(denied ? "لم يُسمح باستخدام الكاميرا. امنح التطبيق إذن الكاميرا من إعدادات المتصفح أو الهاتف، أو استخدم «اختر صورة من المعرض»." : "تعذّر فتح الكاميرا على هذا الجهاز. استخدم «اختر صورة من المعرض».", true);
  }
}
/* While the camera is on: find the page's edges a few times a second and outline them
   (gold while searching, green when steady), so the person sees what will be read. */
async function outlineLoop(){
  const v = $("#video"), ov = $("#pageLine");
  let last = null, steady = 0;
  while (state.scanning){
    await sleep(350);
    if (!state.scanning || document.hidden || !window.QScanner) continue;
    let r = null; try { r = QScanner.detectPage(v); } catch {}
    const q = r && r.quad;
    if (q && last){ const move = Math.max(...q.map((p, i) => Math.hypot(p[0] - last[i][0], p[1] - last[i][1]))); steady = move < Math.max(v.videoWidth, v.videoHeight) * 0.025 ? steady + 1 : 0; }
    else steady = 0;
    last = q;
    QScanner.drawQuad(ov, v, q, steady >= 2);
    if (!state.busy && state.frames < 1) camStatus(q ? (steady >= 2 ? "وجدت الصفحة — أقرأها…" : "وجدت حدود الصفحة… ثبّت الهاتف") : "اجعل الصفحة كاملة داخل الإطار");
  }
  try { QScanner.drawQuad(ov, v, null); } catch {}
}
function stopCamera(){
  state.scanning = false;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null; state.track = null; state.torch = false;
  $("#video").srcObject = null;
  $("#stage").classList.remove("on", "reading"); $("#camBar").hidden = true;
  $("#torchBtn").setAttribute("aria-pressed", "false");
  camStatus("");
}
function grabFrame(maxSide){ const v = $("#video"); return v.videoWidth ? scaleCanvas(v, v.videoWidth, v.videoHeight, maxSide) : null; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function scanLoop(){
  while (state.scanning){
    if (state.busy || document.hidden){ await sleep(300); continue; }
    const raw = grabFrame(1600); if (!raw){ await sleep(250); continue; }
    const c = straighten(raw) || raw;
    state.busy = true; $("#stage").classList.add("reading");
    try {
      const text = await ocr(c, state.frames % 2 === 0);   // live frames: every other one gets the evened-light second look
      if (!state.scanning) break;
      state.frames++;
      const m = M.findMatches(state.poems, text, false);
      if (m.best){ buzz(); stopCamera(); openPoem(m.best.p, { raw: text }); break; }
      if (arabicLetters(text) >= 30){
        const lib = await libLookup(text, false, 1500);
        if (!state.scanning) break;
        if (lib && lib.best && lib.best.score >= 0.9){ buzz(); stopCamera(); const c2 = new AbortController(); state.ctl?.abort(); state.ctl = c2; await openFromLibrary(lib.best, { raw: text }, c2); break; }
      }
      if (arabicLetters(text) >= 60) state.textyFrames++;
      if (S.ready() && state.textyFrames >= 1){ buzz(); const hi = grabFrame(1400) || c; stopCamera(); await smartFromFrame(hi, text); break; }
      if (m.candidates.length) camStatus("قد تكون «" + m.candidates[0].p.title + "»… قرّب الكاميرا قليلاً");
      else if (state.frames >= 3 && !S.ready()) camStatus("ليست في الفهرس. فعّل التعرّف الذكي من الإعدادات، أو اضغط زر الالتقاط");
      else camStatus(state.textyFrames ? "أقرأ الصفحة…" : "ثبّت الهاتف واجعل الصفحة كاملة داخل الإطار");
    } catch {
      camStatus("تعذّر تشغيل قارئ النص. في أول استخدام يلزم اتصال بالإنترنت.");
      await sleep(2500);
    } finally {
      state.busy = false; $("#stage").classList.remove("reading");
    }
    await sleep(200);
  }
}
function buzz(){ try { navigator.vibrate && navigator.vibrate(60); } catch {} }
/* The page, straightened (edges found → perspective and tilt corrected), else the photo as it is. */
function straighten(c){
  try { const p = window.QScanner && QScanner.pageOf(c, 1600); if (p && p.canvas) return p.canvas; } catch {}
  return null;
}
async function snapNow(){ const c = grabFrame(1800); if (!c) return; stopCamera(); const page = straighten(c); await recognize(page || c, page ? c : null); }
async function pickImage(file){
  if (!file) return;
  stopCamera(); note(null);
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; h = src.height; }
  catch {
    try { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); w = src.naturalWidth; h = src.naturalHeight; }
    catch { note("تعذّر فتح هذه الصورة. جرّب صورة بصيغة JPG أو PNG.", true); return; }
  }
  const c = scaleCanvas(src, w, h, 1800), page = straighten(c);
  await recognize(page || c, page ? c : null);
}

async function smartFromFrame(canvas, raw){
  state.ctl?.abort(); const ctl = new AbortController(); state.ctl = ctl;
  work("أتعرّف على القصيدة…", "قراءة ذكية");
  try { const info = await S.identify({ kind: "image", canvas }, ctl.signal); await smartFlow(info, raw, ctl); }
  catch (e){ if (e.code === "cancelled") return; work(null); note(SMART_ERR[e.code] || "تعذّر التعرّف الذكي الآن.", true); showUnknown({ raw, candidates: [] }); }
}

/* ---------- recognition ---------- */
async function recognize(colorCanvas, original){
  state.ctl?.abort(); const ctl = new AbortController(); state.ctl = ctl;
  work("أتعرّف على القصيدة…", S.ready() ? "قراءة على الهاتف وقراءة ذكية معاً" : "على هاتفك");
  // Start the smart reading at once, in parallel with the on-device reading; whichever answers first wins.
  const smartP = S.ready() ? S.identify({ kind: "image", canvas: colorCanvas }, ctl.signal) : null;
  if (smartP) smartP.catch(() => {});
  let text = "";
  try {
    text = await ocr(colorCanvas);
    if (original && arabicLetters(text) < 60){ const t2 = await ocr(original); if (arabicLetters(t2) > arabicLetters(text)) text = t2; }   // straightening misjudged: the whole photo
  } catch { /* reader unavailable: the smart reading can still answer */ }
  if (ctl.signal.aborted) return;
  const m = M.findMatches(state.poems, text, false);
  if (m.best){ ctl.abort(); work(null); openPoem(m.best.p, { raw: text }); return; }
  const lib = M.compact(text).length >= 12 ? await libLookup(text, false, 2500) : null;
  if (ctl.signal.aborted) return;
  if (lib && lib.best && lib.best.score >= 0.9){
    ctl.abort(); work(null);
    const c2 = new AbortController(); state.ctl = c2;
    const pg = { raw: text, alts: lib.list.filter((x) => x !== lib.best && x.score >= 0.75).slice(0, 6) };
    whenOutside(pg, outsideSearch(M.guessTitle(text) || text.split("\n").slice(0, 2).join(" "), c2.signal));
    await openFromLibrary(lib.best, pg, c2); return;
  }
  if (!smartP){ work(null); if (lib && lib.list.length) showLibChoices(M.guessTitle(text) || text.slice(0, 40), lib.list); else showUnknown({ raw: text, candidates: m.candidates.map((c) => c.p) }); return; }
  let info;
  try { info = await smartP; }
  catch (e){ if (e.code === "cancelled") return; work(null); note(SMART_ERR[e.code] || "تعذّر التعرّف الذكي الآن. أعد المحاولة.", true); showUnknown({ raw: text, candidates: m.candidates.map((c) => c.p) }); return; }
  await smartFlow(info, text, ctl);
}

const SMART_ERR = {
  no_key: "أضف مفتاح Gemini من الإعدادات.",
  bad_key: "مفتاح Gemini غير صحيح. راجعه في الإعدادات.",
  quota: "انتهى الحد المجاني لهذا اليوم أو الدقيقة. أعد المحاولة بعد قليل.",
  region: "خدمة Gemini غير متاحة من شبكتك الحالية.",
  offline: "لا يوجد اتصال بالإنترنت. التعرّف الذكي يحتاج اتصالاً.",
  network: "تعذّر الاتصال بالخدمة. تحقّق من الإنترنت ثم أعد المحاولة.",
  forbidden: "المفتاح لا يملك صلاحية هذه الخدمة. راجع الإعدادات.",
  bad_reply: "لم تكتمل القراءة. أعد المحاولة.",
  no_yt_key: "أضف مفتاح YouTube من الإعدادات ليبحث التطبيق عن التسجيل."
};

/* ---------- the on-phone library: ShiaVoice catalog + poem words (shared with the no-key version) ----------
   Text → poem by its words, title → recordings, all on the phone and in a fraction of a second.
   Gemini is then only needed to READ a photo or a voice clip, and as a fallback when the library has no answer. */
const L = window.QLib;
const nf = (n) => ar(Number(n).toLocaleString("en-US").replace(/,/g, "٬"));
/* Arabic count agreement: 1, 2, 3–10, 11+ */
const countAr = (n, [one, two, few, many]) => n === 1 ? one : n === 2 ? two : nf(n) + " " + (n % 100 >= 3 && n % 100 <= 10 ? few : many);
const W_TRACKS = ["تسجيل واحد", "تسجيلان", "تسجيلات", "تسجيلاً"], W_POEMS = ["قصيدة واحدة", "قصيدتان", "قصائد", "قصيدة"];
function libStatus(){
  if (!L) return;
  const i = L.info, li = i.lyricsIndex;
  const when = (d) => d ? new Date(d).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const line = i.loaded ? `على هاتفك ${countAr(i.tracks, W_TRACKS)} و${countAr(i.poems, W_POEMS)} بكلماتها` : "أجهّز الفهرس على هاتفك…";
  const a = $("#libLine"); if (a) a.textContent = line;
  const b = $("#libInfo"); if (b) b.textContent = line + ` · آخر جمع للتسجيلات: ${when(i.manifest?.updated)} · للكلمات: ${when(li?.updated)}` +
    (li?.telegram && Object.values(li.telegram).includes("collecting") ? " · ما زالت قصائد قنوات تيليگرام القديمة تُجمع." : "");
}
async function checkNew(btn, msg){
  btn.disabled = true; const say = (t) => { if (msg) msg.textContent = t; else note(t); };
  say("أتحقق من الجديد…");
  try {
    const r = await L.checkNow();
    libStatus();
    const bits = [];
    if (r.newTracks) bits.push(countAr(r.newTracks, ["تسجيل جديد", "تسجيلان جديدان", "تسجيلات جديدة", "تسجيلاً جديداً"]));
    if (r.newPoems) bits.push(countAr(r.newPoems, ["قصيدة جديدة", "قصيدتان جديدتان", "قصائد جديدة", "قصيدة جديدة"]) + " بكلماتها");
    say(bits.length ? "أُضيف: " + bits.join(" و") + "." : "لا جديد منذ آخر تحديث. يجمع الخادم الجديد كل بضع ساعات.");
  } catch { say("تعذّر التحقق الآن. تأكد من الاتصال."); }
  btn.disabled = false;
}
if (L){
  L.onChange(libStatus);
  L.load(false).then(libStatus).catch(() => {});
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - (L.info.checked || 0) > 30 * 60e3) L.checkNow().catch(() => {}); });
  libStatus();
  $("#newBtn")?.addEventListener("click", () => checkNew($("#newBtn"), null));
  $("#libCheck")?.addEventListener("click", () => checkNew($("#libCheck"), $("#libMsg")));
  $("#libAll")?.addEventListener("click", async () => { const b = $("#libAll"); b.disabled = true; $("#libMsg").textContent = "أنزّل الفهرس كله…"; try { await L.load(true, (t) => { $("#libMsg").textContent = t; }); $("#libMsg").textContent = "تم."; libStatus(); } catch { $("#libMsg").textContent = "تعذّر التنزيل الآن."; } b.disabled = false; });
}
const libSv = (x) => ({ id: x.id, title: x.title, artist: x.artist, duration: L.clock(x.dur), album: x.album || "", section: x.section || "", score: 0.9 });
async function libLookup(text, typed, waitMs){
  if (!L || !text || !String(text).trim()) return null;
  try {
    const res = await Promise.race([L.load(false).then(() => L.ask(text, typed)), new Promise((r) => setTimeout(() => r(null), waitMs ?? 3000))]);
    if (!res) return null;
    const list = (res.results || []).filter((r) => !r.book);
    const [a, b] = list;
    const best = a && a.score >= 0.85 && (!b || a.score - b.score >= 0.05 || (a.lyric && !b.lyric)) ? a : null;
    return { best, list };
  } catch { return null; }
}
/* Recordings of a known title from the library (empty if none). */
async function libRecordings(title, reciter){
  const r = await libLookup(title + (reciter ? " " + reciter : ""), true, 4000);
  const t = M.compact(title);
  const hit = r && r.list.find((x) => x.recs.length && (M.dice(t, M.compact(x.title)) >= 0.85 || M.compact(x.title).startsWith(t) || t.startsWith(M.compact(x.title))));
  return hit ? hit.recs.slice(0, 30).map(libSv) : [];
}
/* Open a poem found in the library: its recordings are already known; YouTube is looked up in parallel. */
async function openFromLibrary(r, page, ctl){
  const reciter = r.lyric?.reciter || r.recs[0]?.artist || "";
  const poem = newPoem({ title: r.title.slice(0, 120), poet: r.lyric?.poet || "", reciters: reciter ? [reciter] : [],
    keywords: page.query ? [page.query.slice(0, 60)] : [], lyricUrl: r.lyric?.url || "", titleInferred: false, confidence: "high" });
  const known = M.findMatches(state.poems, poem.title, true);
  if (known.best && known.best.s >= 0.9){ if (page.query) rememberFragment(known.best.p, page.query); openPoem(known.best.p, page); return; }
  page.alts = (page.alts || []).filter((x) => M.compact(x.title) !== M.compact(r.title));
  poem.libSv = r.recs.slice(0, 30).map(libSv);
  page.lib = true;
  await openAndFill(poem, page, [], null, ctl);
}
/* Beyond the catalog: YouTube searched with the person's own words, in parallel with the catalog.
   Only full recitations pass (no shorts, clips or songs); shown apart from the poem's own recordings. */
function outsideSearch(text, signal){
  if (!S.hasYouTube() || !text || !String(text).trim()) return Promise.resolve([]);
  const t = String(text).replace(/\s+/g, " ").trim().slice(0, 90);
  return S.findVideos({ title: "", queries: [t], verses: [[t, ""]], refrain: "", opening: t, reciter: "" }, signal, { max: 1, noExtra: true })
    .then((v) => v.filter((x) => x.verdict !== "short" && x.verdict !== "bad").slice(0, 8)).catch(() => []);
}
function whenOutside(page, outP){
  if (!outP) return;
  page.outsideP = outP;
  outP.then((v) => {
    page.outside = v;
    if (state.page === page && state.view === "poem" && !playerBusy()) renderPoem(state.poemId);
  });
}
function outsideCard(p, page){
  const have = new Set((p.recordings || []).map((r) => r.id));
  const vids = ((page && page.outside) || []).filter((v) => !have.has(v.id)).slice(0, 6);
  if (!vids.length) return null;
  const stage = el("div"); stage.hidden = true;
  const rows = el("div", { class: "recs" });
  const queue = vids.map((v) => ({ rec: { ...ytRec(v, false), match: "" }, title: v.title, poem: { title: v.title, temp: true } }));
  vids.forEach((v, k) => {
    rows.append(el("button", { type: "button", class: "rec", onclick: () => { rows.remove(); stage.hidden = false; playerFor(stage, queue, k, true, { queueTitle: "من خارج الفهرس" }); } },
      el("span", { class: "th", style: "background-image:url('https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg')" }),
      el("span", { class: "tx" }, el("b", { text: v.title }), el("span", { text: [v.channel, "يوتيوب", v.dur ? QP.clock(v.dur) : ""].filter(Boolean).join(" · ") }))));
  });
  return el("div", { class: "card" }, el("h3", { class: "sec", text: "من خارج الفهرس" }),
    el("p", { class: "muted small", text: "تسجيلات كاملة وجدها البحث في يوتيوب بكلماتك نفسها؛ قد تكون هذه القصيدة بأداء آخر، أو قصيدة غيرها." }), stage, rows);
}

/* Several poems fit (e.g. one word that appears in many): let the person choose. */
const recWord = (n) => n === 1 ? "تسجيل واحد" : n === 2 ? "تسجيلان" : ar(n) + (n <= 10 ? " تسجيلات" : " تسجيلاً");
function showLibChoices(q, list, outP){
  if (list.length === 1){ const c = new AbortController(); state.ctl?.abort(); state.ctl = c; const pg = { query: q }; whenOutside(pg, outP); openFromLibrary(list[0], pg, c); return; }
  state.temp = null;
  const v = $("#view-poem"); v.replaceChildren();
  v.append(el("button", { type: "button", class: "back", onclick: () => go("scan") }, el("span", { html: IC.back }), "رجوع"));
  v.append(el("div", { class: "hero" }, el("span", { class: "pill", text: "قصائد فيها ما أعطيت" }), el("h2", { text: "«" + q.slice(0, 60) + "»" }),
    el("p", { class: "by", text: "اختر القصيدة لتظهر تسجيلاتها." })));
  v.append(el("div", { class: "card" }, el("div", { class: "cands" }, list.slice(0, 12).map((r) => {
    const who = r.lyric?.reciter || r.recs[0]?.artist || "";
    return el("button", { type: "button", class: "btn", onclick: () => { const c = new AbortController(); state.ctl?.abort(); state.ctl = c; openFromLibrary(r, { query: q, alts: list.filter((x) => x !== r).slice(0, 6) }, c); } },
      r.title + (who ? " — " + who : "") + (r.total ? " · " + recWord(r.total) : ""));
  }))));
  if (outP){
    const slot = el("div"); v.append(slot);
    outP.then((vids) => { if (!slot.isConnected) return; const c = outsideCard({ recordings: [], title: q }, { outside: vids }); if (c) slot.replaceWith(c); });
  }
  for (const x of ["scan", "index", "settings"]) $("#view-" + x).hidden = true;
  v.hidden = false; state.view = "poem";
  $$(".tabbar a").forEach((a) => a.removeAttribute("aria-current"));
  window.scrollTo({ top: 0 });
}

/* After Gemini identified the poem: open it at once, then fill in the recordings. */
/* ---------- from a part of a poem to the poem, then its recordings ---------- */
const svRec = (x) => ({ type: "shiavoice", id: x.id, source: "صوت الشيعة", reciter: x.artist, note: x.title, duration: x.duration, album: x.album || "", section: x.section || "", match: x.score >= 0.75 ? "good" : "maybe" });
const ytRec = (v, good) => ({ type: "youtube", id: v.id, source: "يوتيوب", reciter: v.channel, note: v.title, dur: v.dur || 0, published: v.published || "", match: good ? "good" : "maybe" });

/* Step 1: which poem is this part from? Look the part up once, and let Gemini name the poem from the real results. */
async function namePart(fragment, info, signal){
  let evidence = [];
  try { evidence = await S.findVideos({ title: "", queries: [(info && info.queries && info.queries[0]) || fragment], verses: (info && info.verses) || [[fragment, ""]], refrain: (info && info.refrain) || "", opening: (info && info.opening) || fragment, reciter: "" }, signal, { max: 1, noExtra: true }); }
  catch (e){ if (e.code === "cancelled") throw e; }
  let named = null;
  try { named = await S.namePoem(fragment, evidence, signal); } catch (e){ if (e.code === "cancelled") throw e; }
  return { evidence, named };
}

/* Step 2: with the poem's real title, look for ITS recordings.
   Audio: ShiaVoice (a Husayni library). Video: YouTube, but only complete performances of this poem. */
function videoFits(v, title, reciter){
  if (v.verdict === "short" || v.verdict === "bad") return false;   // clips, reels, songs, unrelated videos
  const t = M.compact(title), vt = M.compact(v.title);
  const titleOk = (t.length >= 4 && vt.includes(t)) || M.fuzzyContains(vt, t) >= 0.82 || v.score >= 0.9;
  if (!titleOk) return false;
  const r = M.poetKey(reciter || "");
  const byReciter = r.length >= 4 && M.poetKey(v.title + " " + v.channel + " " + (v.desc || "").slice(0, 300)).includes(r);
  if (v.verdict === "unknown" && !byReciter) return false;     // nothing says it is a Husayni recitation
  if (r.length >= 4 && !byReciter && v.score < 0.95) return false;
  return true;
}
async function findRecordings(poem, evidence, named, signal, onPart){
  const title = poem.title, reciter = (poem.reciters || [])[0] || "";
  const full = named && named.full ? new Set(named.full) : null;
  const matched = new Set((named && named.matches) || []);
  // From the first search: what Gemini confirmed is this poem, performed in full.
  const evHits = (evidence || []).filter((v, i) => matched.has(i + 1) && (!full || full.has(i + 1)) && v.verdict !== "short" && v.verdict !== "bad");
  const out = { sv: [], yt: [] };
  const merge = () => {
    // Audio first (up to 30), then videos (up to 6): one source must never crowd out the other.
    const seen = new Set(), list = out.sv.slice(0, 30).map(svRec);
    let nv = 0;
    for (const v of [...evHits, ...out.yt]) { if (seen.has(v.id) || nv >= 6) continue; seen.add(v.id); list.push(ytRec(v, true)); nv++; }
    return list;
  };
  const ytP = S.hasYouTube() ? S.findVideos({ title, reciter, poet: poem.poet || "", queries: [], verses: [], refrain: poem.refrain || "", opening: poem.opening || "" }, signal, { max: 1, noExtra: true })
    .then((v) => { out.yt = v.filter((x) => videoFits(x, title, reciter)).slice(0, 6); onPart && onPart(merge()); }).catch(() => {}) : Promise.resolve();
  const viaGemini = () => window.QSources && QSources.available() ? QSources.findShiavoice({ title, opening: poem.opening || "", refrain: poem.refrain || "", reciter, queries: [], verses: [] }, signal)
    .then((x) => { out.sv = x; onPart && onPart(merge()); }).catch(() => {}) : Promise.resolve();
  let svP;
  if (poem.libSv && poem.libSv.length){ out.sv = poem.libSv; svP = Promise.resolve(); }
  else svP = libRecordings(title, reciter).then((x) => { if (x.length){ out.sv = x; onPart && onPart(merge()); } else return viaGemini(); }).catch(() => viaGemini());
  if (onPart && (evHits.length || out.sv.length)) onPart(merge());
  await Promise.all([ytP, svP]);
  return merge();
}

/* Open the poem now, then fill in its recordings as each source answers. */
async function openAndFill(poem, page, evidence, named, ctl){
  if (poem.temp) state.temp = poem;
  else { const local = lsGet(LS.local, []); local.push(poem); lsSet(LS.local, local); rebuild(); }
  page.searching = true;
  openPoem(poemById(poem.id), page);
  const save = (recs) => {
    if (!recs.length) return;
    if (poem.temp){ state.temp.recordings = recs; }
    else { const l2 = lsGet(LS.local, []); const it = l2.find((x) => x.id === poem.id); if (it){ it.recordings = recs; lsSet(LS.local, l2); } rebuild(); }
    if (state.poemId === poem.id && state.view === "poem" && !playerBusy()) renderPoem(poem.id);
  };
  const recs = await findRecordings(poem, evidence, named, ctl.signal, save);
  page.searching = false;
  save(recs);
  if (state.poemId === poem.id && state.view === "poem" && !playerBusy()) renderPoem(poem.id);
}

function cleanVideoTitle(t){
  const parts = String(t || "").split(/\s*[|\-–—_:#(\[«»"]+\s*/).map((x) => x.replace(/[^\u0621-\u064A\s]/g, " ").replace(/\s+/g, " ").trim()).filter((x) => x.length >= 4);
  return parts[0] || "";
}
function newPoem(fields){
  return { id: "local-" + Date.now().toString(36), aliases: [], poet: "", opening: "", refrain: "", keywords: [], subject: "", reciters: [], books: [], recordings: [], smart: true, ...fields };
}
function rememberFragment(p, q){
  if (!p.local || !q) return;
  const local = lsGet(LS.local, []); const it = local.find((x) => x.id === p.id);
  if (it && !(it.keywords || []).some((k) => M.compact(k) === M.compact(q))){ it.keywords = [...(it.keywords || []), q.slice(0, 60)].slice(-12); lsSet(LS.local, local); rebuild(); }
}

/* A page photo or a recording, read by Gemini. */
async function smartFlow(info, raw, ctl){
  if (!info.is_poem){ work(null); note("لم أتعرّف على قصيدة في هذا. صوّر الصفحة كاملة أو أسمِعني مقطعاً أوضح.", true); return; }
  const clean = [info.title, info.refrain, info.opening, ...info.verses.map((v) => v.join(" "))].join("\n");
  const lm = M.findMatches(state.poems, clean, false);
  if (lm.best){ work(null); openPoem(lm.best.p, { verses: info.verses, raw }); return; }
  const fragment = [info.refrain, ...info.verses.slice(0, 3).map((v) => v.join(" "))].filter(Boolean).join(" / ") || info.opening || info.title;
  {
    work("أبحث في كلمات القصائد…", "على هاتفك");
    const lib = (await libLookup(clean, false, 4000)) || null;
    const lib2 = lib && lib.best ? lib : await libLookup(fragment, true, 2000);
    const hit = (lib && lib.best) || (lib2 && lib2.best);
    if (ctl.signal.aborted) return;
    if (hit && (!info.title_printed || M.dice(M.compact(info.title), M.compact(hit.title)) >= 0.7 || hit.lyric)){
      const pool = [...((lib && lib.list) || []), ...((lib2 && lib2.list) || [])].filter((x) => x !== hit && x.score >= 0.75);
      const pg = { verses: info.verses, raw, smartNew: true, alts: pool.slice(0, 6) };
      whenOutside(pg, outsideSearch(fragment, ctl.signal));
      work(null); await openFromLibrary(hit, pg, ctl); return;
    }
  }
  let title = info.title, poet = info.poet, reciter = info.reciter, confidence = info.confidence, evidence = [], named = null;
  if (!info.title_printed && S.hasYouTube()){
    work("أتعرّف على القصيدة…", "من الأبيات");
    try { ({ evidence, named } = await namePart(fragment, info, ctl.signal)); } catch { return; }
    if (named && named.title){ title = named.title; poet = poet || named.poet; reciter = reciter || named.reciter; confidence = named.confidence; }
  }
  work(null);
  if (title){
    const known = M.findMatches(state.poems, title, true);
    if (known.best && known.best.s >= 0.8){ rememberFragment(known.best.p, fragment); openPoem(known.best.p, { verses: info.verses, raw }); return; }
  }
  const poem = newPoem({ title: (title || info.opening || fragment || "قصيدة").slice(0, 120), poet, opening: info.opening, refrain: info.refrain,
    keywords: [info.refrain, ...info.verses.slice(0, 4).map((v) => v[0])].filter((s) => s && s.length >= 8).map((s) => s.slice(0, 60)),
    subject: info.subject, reciters: reciter ? [reciter] : [], books: info.page ? [{ book: "", page: info.page }] : [],
    titleInferred: !info.title_printed, confidence });
  await openAndFill(poem, { verses: info.verses, raw, smartNew: true }, evidence, named, ctl);
}

/* Typed or dictated part of a poem. */
async function textSearch(q){
  q = q.trim(); if (q.length < 2) return;
  const m = M.findMatches(state.poems, q, true);
  if (m.best){ openPoem(m.best.p, { query: q }); return; }
  state.ctl?.abort(); const ctl = new AbortController(); state.ctl = ctl;
  work("أبحث في الكلمات والعناوين…", "على هاتفك");
  const outP = outsideSearch(q, ctl.signal);                // the wider web, in parallel
  const lib = await libLookup(q, true);
  if (ctl.signal.aborted) return;
  if (lib && lib.best){ work(null); const pg = { query: q, alts: lib.list.filter((x) => x !== lib.best && x.score >= 0.75).slice(0, 6) }; whenOutside(pg, outP); await openFromLibrary(lib.best, pg, ctl); return; }
  const fewWords = q.split(/\s+/).length <= 2;
  if (lib && lib.list.length && (fewWords || !S.hasYouTube() || !S.ready())){ work(null); showLibChoices(q, lib.list, outP); return; }
  if (!S.hasYouTube() || !S.ready()){
    work(null); go("index"); $("#q").value = q; renderIndex(); renderSearchMore(q); return;
  }
  work("أتعرّف على القصيدة…", "من الجزء الذي أعطيته");
  let evidence = [], named = null;
  try { ({ evidence, named } = await namePart(q, null, ctl.signal)); } catch { return; }
  if (ctl.signal.aborted) return;
  work(null);
  if (!(named && named.title)){
    // Gemini could not name it: if the search found something, show it clearly marked as unsure.
    const guess = cleanVideoTitle((evidence[0] || {}).title);
    if (!guess){ note("لم أتعرّف على القصيدة من «" + q + "». جرّب بيتاً أطول أو أوضح، أو المطلع.", true); return; }
    named = { title: guess, poet: "", reciter: "", opening: "", matches: [1], confidence: "low" };
  }
  const known = M.findMatches(state.poems, named.title, true);
  if (known.best && known.best.s >= 0.8){ rememberFragment(known.best.p, q); openPoem(known.best.p, { query: q }); return; }
  const poem = newPoem({ title: named.title.slice(0, 120), poet: named.poet, opening: named.opening, keywords: [q.slice(0, 60)],
    reciters: named.reciter ? [named.reciter] : [], titleInferred: true, confidence: named.confidence });
  if (named.confidence === "low"){ poem.id = "tmp"; poem.temp = true; }
  await openAndFill(poem, { query: q, unsure: named.confidence === "low" }, evidence, named, ctl);
}

async function moreFromShiavoice(p, btn, msg){
  btn.disabled = true; msg.textContent = "أبحث في صوت الشيعة…";
  try {
    const found = await QSources.findShiavoice({ title: p.title, opening: p.opening, refrain: p.refrain, reciter: (p.reciters || [])[0] || "", queries: [], verses: [] });
    const have = new Set((p.recordings || []).map((r) => r.id));
    const add = found.filter((x) => !have.has(x.id)).map((x) => ({ type: "shiavoice", id: x.id, source: "صوت الشيعة", reciter: x.artist, note: x.title, duration: x.duration }));
    if (!add.length){ msg.textContent = have.size ? "لا تسجيلات أخرى لها في صوت الشيعة غير المعروضة." : "لم أجد لها تسجيلاً في صوت الشيعة."; btn.disabled = false; return; }
    if (p.temp) p.recordings = [...add, ...p.recordings];
    else { const ex = lsGet(LS.extra, {}); ex[p.id] = [...add, ...(ex[p.id] || [])]; lsSet(LS.extra, ex); rebuild(); }
    renderPoem(p.id);
  } catch (e){
    btn.disabled = false;
    msg.textContent = e.code === "quota" ? "انتهى الحد المؤقت، أعد المحاولة بعد دقيقة." : "تعذّر البحث في صوت الشيعة الآن.";
  }
}

/* ---------- voice ---------- */
const V = window.QVoice;
async function voiceSearch(){
  note(null);
  if (!S.ready()){
    if (V.canDictate()){ dictateInto(document.getElementById(state.view === "index" ? "q" : "qq"), null); return; }
    note("البحث بالصوت يحتاج تفعيل التعرّف الذكي: أضف مفتاح Gemini من الإعدادات.", true); return;
  }
  if (!V.canRecord()){ if (V.canDictate()){ dictateInto($("#qq"), $("#quickForm .mic")); return; } note("هذا المتصفح لا يتيح التسجيل الصوتي.", true); return; }
  stopCamera(); pauseMedia();
  const sheet = $("#voiceSheet"), meter = $("#meter");
  if (!meter.children.length) for (let i = 0; i < 28; i++) meter.append(el("i"));
  const bars = [...meter.children]; const hist = new Array(bars.length).fill(0);
  sheet.hidden = false; $("#vsTime").textContent = "جاري تشغيل الميكروفون…";
  let rec;
  try {
    rec = await V.record({ maxMs: 12000,
      onLevel: (lv) => { hist.push(lv); hist.shift(); bars.forEach((b, i) => { b.style.height = Math.max(8, Math.round(hist[i] * 100)) + "%"; }); },
      onTick: (ms, max) => { $("#vsTime").textContent = fmtTime(ms / 1000) + " / " + fmtTime(max / 1000); } });
  } catch (e){
    sheet.hidden = true;
    note(e.code === "denied" ? "لم يُسمح باستخدام الميكروفون. امنح التطبيق الإذن من إعدادات المتصفح." : "تعذّر تشغيل الميكروفون على هذا الجهاز.", true);
    return;
  }
  $("#vsDone").onclick = () => rec.stop();
  $("#vsCancel").onclick = () => rec.cancel();
  let clip;
  try { clip = await rec.done; } catch { sheet.hidden = true; return; }
  sheet.hidden = true;
  if (clip.ms < 1500){ note("المقطع قصير جداً. سجّل ثلاث ثوانٍ على الأقل.", true); return; }
  if (clip.metered && clip.peak < 0.02){ note("لم يصل أي صوت من الميكروفون. تأكد أن التطبيق مسموح له باستخدام الميكروفون، وأن الميكروفون غير مستخدم في تطبيق آخر.", true); return; }
  state.ctl?.abort(); const ctl = new AbortController(); state.ctl = ctl;
  work("أستمع إلى المقطع…", "تعرّف ذكي بالصوت");
  let audio;
  try { audio = await V.toWavBase64(clip.blob); }
  catch { audio = { b64: await V.blobToB64(clip.blob), mime: (clip.blob.type || "audio/mp4").split(";")[0] }; }
  let info;
  try { info = await S.identify({ kind: "audio", b64: audio.b64, mime: audio.mime }, ctl.signal); }
  catch (e){ if (e.code === "cancelled") return; work(null); note(SMART_ERR[e.code] || "تعذّر التعرّف على المقطع. أعد المحاولة.", true); return; }
  await smartFlow(info, "", ctl);
}
let dictating = null;
async function dictateInto(input, btn){
  if (dictating){ dictating.stop && dictating.stop(); return; }
  btn && btn.classList.add("on");
  const before = input.value;
  input.value = ""; input.placeholder = "تكلّم الآن…";
  note("أستمع… تكلّم الآن بعنوان القصيدة أو بيت منها.");
  const p = V.dictate({ onInterim: (t) => { input.value = t; } });
  dictating = p;
  let text = "", failed = null;
  try { text = await p; } catch (e){ failed = e.code || "error"; }
  dictating = null; btn && btn.classList.remove("on");
  input.placeholder = input.id === "qq" ? "اكتب العنوان أو بيتاً من القصيدة" : "العنوان، المطلع، الشاعر أو الرادود";
  text = (text || input.value || "").trim();
  if (!text){
    input.value = before;
    const DM = { denied: "لم يُسمح باستخدام الميكروفون. امنح الإذن من إعدادات المتصفح أو الهاتف.", "no-speech": "لم أسمع كلاماً. اضغط الميكروفون وتكلّم مباشرة.",
      "audio-capture": "لا يوجد ميكروفون متاح، أو يستخدمه تطبيق آخر.", network: "الإملاء الصوتي يحتاج اتصالاً بالإنترنت.",
      "service-not-allowed": "الإملاء الصوتي غير متاح داخل التطبيق المثبّت على هذا الهاتف.", timeout: "لم يستجب الإملاء الصوتي في هذا المتصفح." };
    if (failed && failed !== "aborted") note((DM[failed] || "تعذّر الإملاء الصوتي.") + (S.ready() ? "" : " فعّل التعرّف الذكي ليعمل البحث بالصوت بطريقة أخرى."), true);
    else if (!failed) note("لم أسمع كلاماً. اضغط الميكروفون وتكلّم مباشرة.", true);
    return;
  }
  input.value = text;
  if (input.id === "q") renderIndex();
  textSearch(text);
}

/* ---------- poem view ---------- */
function openPoem(p, page){ state.page = page || null; state.pageFor = p.id; go("p-" + p.id); }

function renderPoem(id){
  const p = poemById(id); if (!p) return;
  if (state.poemId !== id || !$("#view-poem").firstChild){ pauseMedia(); }
  const page = state.pageFor === id ? state.page : null;
  state.poemId = id;
  pushHistory(p);
  const v = $("#view-poem"); v.replaceChildren();

  v.append(el("button", { type: "button", class: "back", onclick: () => (history.length > 1 ? history.back() : go("scan")) }, el("span", { html: IC.back }), "رجوع"));

  const pill = page && page.lib ? (page.query ? "وجدناها من الكلمات التي أعطيتها" : "تعرّفنا عليها من كلماتها") : page && page.query ? (page.unsure ? "تعرّف غير مؤكد" : "تعرّفنا عليها من الجزء الذي أعطيته") : p.temp ? "نتائج البحث" : page && page.smartNew ? (p.titleInferred ? "تعرّف ذكي · العنوان مستنتج" : "تعرّف ذكي") : page && (page.raw || page.verses) ? "تعرّفنا على القصيدة" : p.local ? "محفوظة على هاتفك" : "من الفهرس";
  const by = el("p", { class: "by" });
  if (p.poet) by.append("شعر ", el("b", { text: p.poet }));
  const chips = el("div", { class: "chips" }, (p.reciters || []).map((r) => el("span", { text: "بصوت " + r })), p.subject ? el("span", { text: p.subject }) : null,
    (p.books || []).filter((b) => b.page).map((b) => el("span", { text: (b.book ? b.book + " · " : "") + "ص " + ar(b.page) })));
  const shareMsg = el("span", { class: "small", "aria-live": "polite" });
  const acts = el("div", { class: "acts" },
    p.temp ? el("button", { type: "button", onclick: () => saveTemp() }, "احفظ في الفهرس") : el("button", { type: "button", onclick: () => sharePoem(p, shareMsg) }, el("span", { html: IC.share }), "مشاركة"),
    p.lyricUrl && safeUrl(p.lyricUrl) ? el("a", { href: safeUrl(p.lyricUrl), target: "_blank", rel: "noopener" }, "اقرأ الكلمات") : null,
    el("a", { href: ytSearchUrl(p.title, (p.reciters || [])[0]), target: "_blank", rel: "noopener" }, "أداءات أخرى"), shareMsg);
  v.append(el("div", { class: "hero" }, el("span", { class: "pill", text: pill }), el("h2", { text: p.title }), (p.poet ? by : null), chips,
    page && page.query ? el("p", { class: "by", text: "أعطيتَ: «" + page.query.slice(0, 80) + "»" }) : null, acts));

  const recs = playable(p);
  if (!recs.length && page && page.searching){
    v.append(el("div", { class: "card" }, el("div", { class: "searching" }, el("div", { class: "spin", "aria-hidden": "true" }), el("div", { class: "work-t" }, el("strong", { text: "أبحث عن التسجيل…" }), el("span", { text: "يوتيوب" })))));
  } else if (recs.length){
    // One player for every source: the recordings are its queue.
    let yn = 0, an = 0;
    const queue = recs.map((r) => ({ rec: r, poem: p,
      title: r.type === "youtube" ? (r.note || "مقطع يوتيوب " + ar(++yn)) : r.type === "file" ? (r.name || "ملف من هاتفي") : r.type === "shiavoice" ? (r.note || p.title) : p.title + (an++ ? " (" + ar(an) + ")" : ""),
      badge: r.match === "good" ? "مطابق" : r.match === "maybe" ? "محتمل" : "" }));
    const card = el("div", { class: "card" });
    v.append(card);
    // Autoplay: asked for by the page, or the setting is on and this page is a search result (once per result).
    const fromSearch = !!(page && (page.query || page.raw || page.verses || page.lib || page.smartNew));
    let auto = !!(page && page.autoplay);
    if (!auto && fromSearch && playPrefs().autoplay && !page.autoplayed) auto = true;
    if (page) page.autoplay = false;
    let first = 0;
    if (auto){
      if (page) page.autoplayed = true;
      const k = recs.findIndex((x) => x.type !== "shiavoice");        // ShiaVoice's player cannot start by itself
      if (k > 0) first = k;
    }
    playerFor(card, queue, first, auto);
  } else {
    const c = el("div", { class: "card" }, el("h3", { class: "card-t", text: "لا يوجد تسجيل بعد" }));
    if (page && page.ytErr === "quota") c.append(el("p", { class: "muted small", text: "انتهى حد بحث يوتيوب المجاني لليوم. يمكنك البحث يدوياً ثم لصق الرابط أدناه." }));
    else if (page && page.smartNew && !S.hasYouTube()) c.append(el("p", { class: "muted small" }, "أضف مفتاح YouTube من ", el("a", { href: "#settings" }, "الإعدادات"), " ليبحث التطبيق عن التسجيل ويشغّله هنا تلقائياً."));
    else c.append(el("p", { class: "muted small", text: "ابحث عن القصيدة في يوتيوب، ثم الصق رابطها في «أضف تسجيلاً» ليعمل هنا." }));
    c.append(el("div", { class: "row gap" }, el("a", { class: "btn", href: ytSearchUrl(p.title, p.poet), target: "_blank", rel: "noopener" }, "ابحث في يوتيوب")));
    v.append(c);
  }

  if (window.QSources && QSources.available() && !(page && page.searching)){
    const hasSv = (p.recordings || []).some((r) => r.type === "shiavoice");
    const m2 = el("span", { class: "small muted", "aria-live": "polite" });
    const b2 = el("button", { type: "button", class: "chip", onclick: () => moreFromShiavoice(p, b2, m2) }, el("span", { html: IC.note }),
      hasSv ? "ابحث عن تسجيلات أخرى في صوت الشيعة مباشرة" : "ابحث عن تسجيلاتها في صوت الشيعة");
    v.append(el("div", { class: "row gap" }, b2, m2));
  }
  const oc = outsideCard(p, page);
  if (oc) v.append(oc);
  const alts = (page && page.alts) || [];
  if (alts.length){
    v.append(el("div", { class: "card" }, el("h3", { class: "sec", text: "قد تقصد أيضاً" }),
      el("div", { class: "cands" }, alts.map((r) => {
        const who = r.lyric?.reciter || r.recs[0]?.artist || "";
        return el("button", { type: "button", class: "btn", onclick: () => { const c = new AbortController(); state.ctl?.abort(); state.ctl = c;
          openFromLibrary(r, { query: page.query, raw: page.raw, alts: alts.filter((x) => x !== r).concat([{ title: p.title, recs: (p.recordings || []).filter((x) => x.type === "shiavoice").map((x) => ({ id: x.id, title: x.note || p.title, artist: x.reciter, dur: 0 })), lyric: p.lyricUrl ? { url: p.lyricUrl, poet: p.poet, reciter: (p.reciters || [])[0] || "" } : null, total: 0 }]).slice(0, 6) }, c); } },
          r.title + (who ? " — " + who : "") + (r.total ? " · " + countAr(r.total, W_TRACKS) : ""));
      }))));
  }
  const links = (p.recordings || []).filter((r) => r.type === "link" && safeUrl(r.url));
  if (links.length) v.append(el("div", { class: "card" }, el("h3", { class: "sec", text: "مصادر أخرى" }),
    el("div", { class: "ext" }, links.map((r) => el("a", { href: safeUrl(r.url), target: "_blank", rel: "noopener" }, r.source + (r.note ? " · " + r.note : ""))))));

  const verses = (page && page.verses && page.verses.length) ? page.verses : null;
  if (verses){
    const box = el("div", { class: "verses" });
    for (const [a, b] of verses){
      if (/^\s*[*٭✱❋]+\s*$/.test(a) && !b) { box.append(el("div", { class: "sep", text: "* * *" })); continue; }
      box.append(b ? el("div", { class: "v" }, el("span", { text: a }), el("span", { text: b })) : el("div", { class: "v one" }, el("span", { text: a })));
    }
    const cm = el("span", { class: "small muted", "aria-live": "polite" });
    v.append(el("div", { class: "card" }, el("div", { class: "row", style: "justify-content:space-between;gap:8px" }, el("h3", { class: "card-t", text: "نص الصفحة" }),
      el("button", { type: "button", class: "chip-btn", style: "color:var(--ink);border-color:var(--line)", onclick: () => copyText([p.title, ...verses.map(([a, b]) => b ? a + "    " + b : a)].join("\n"), cm) }, "نسخ")), box, cm));
  } else if (page && page.raw && page.raw.trim()){
    v.append(el("details", { class: "card" }, el("summary", { text: "النص كما قرأه الهاتف" }), el("pre", { class: "raw", text: page.raw.trim() }),
      el("p", { class: "small muted", text: "قراءة آلية سريعة وقد تخطئ في بعض الكلمات." })));
  }

  if (!p.temp) v.append(addForm(p));
  if (p.local && !p.temp) v.append(el("div", { class: "row" }, el("button", { type: "button", class: "btn", onclick: () => deleteLocal(p.id) }, "احذفها من هاتفي")));
}

/* ---------- the player (player.js): one face for ShiaVoice, YouTube, Rafed audio and the phone's own files ---------- */
const QP = window.QPlayer;
const { lists, saveLists, inList, addToList, removeFromList, newList, recKey } = QP.store;
const playPrefs = () => QP.prefs();
const setPlayPref = (k, v) => QP.setPref(k, v);
// Under the player: saving for offline / downloading (where the source allows it), favourites and lists.
const playerExtras = (item) => {
  const p = item.poem || { title: item.title }, r = item.rec;
  if (r.type === "shiavoice" || r.type === "youtube") return null;   // the player's own: favourites + the source's page
  return [mediaActions(p, r), QP.favRow(p, r)];
};
function playerFor(host, queue, index, autoplay, more){
  return QP.mount(host, Object.assign({ queue, index, autoplay, audio: $("#audio"), artwork: abs("icons/icon-512.png"),
    resolveAudio: (a, r) => setAudioSource(a, r),
    videoSrc: async (r) => { const item = await QM.get(r.key); if (!item || !item.blob) throw new Error("missing"); return URL.createObjectURL(item.blob); },
    extras: playerExtras }, more || {}));
}
/* Something is playing (or the person started ShiaVoice's own player): don't redraw the page under it. */
const playerBusy = () => QP.busy();
function pauseMedia(){ QP.stop(); try { $("#audio").pause(); } catch {} }

/* ---------- favourites and lists ---------- */
/* «قوائمي»: favourites and the person's lists. */
function renderLists(){
  const v = $("#view-lists"); v.replaceChildren();
  v.append(el("div", { class: "view-head" }, el("h2", { id: "listsH", text: "قوائمي" })), el("p", { class: "muted small", text: "المفضلة وقوائم التشغيل: تُشغَّل متتالية، تسجيلاً بعد تسجيل." }));
  for (const L of lists()){
    v.append(el("div", { class: "card listcard" },
      el("div", { class: "row", style: "justify-content:space-between;align-items:center;gap:8px" },
        el("a", { class: "lname", href: "#list-" + L.id }, el("b", { text: (L.id === "fav" ? "♥ " : "") + L.name }), el("span", { class: "small muted", text: L.items.length ? countAr(L.items.length, W_TRACKS) : "فارغة" })),
        L.items.length ? el("button", { type: "button", class: "btn primary", onclick: () => { state.autoStart = L.id; go("list-" + L.id); } }, "▶ شغّل الكل") : el("span"))));
  }
  const name = el("input", { type: "text", placeholder: "اسم القائمة", "aria-label": "اسم القائمة الجديدة" });
  v.append(el("form", { class: "card row gap", onsubmit: (e) => { e.preventDefault(); if (!name.value.trim()) { name.focus(); return; } newList(name.value); renderLists(); } },
    name, el("button", { type: "submit", class: "btn" }, "أنشئ قائمة")));
  v.append(el("p", { class: "muted small", text: "لإضافة تسجيل: افتح قصيدة، شغّل التسجيل، ثم «أضف إلى المفضلة» أو «أضف إلى قائمة» تحته." }));
}
/* One list, played in order by the same player; below it the list can be trimmed. */
function renderList(id){
  const L = lists().find((x) => x.id === id); if (!L) return;
  state.listOpen = id;
  const v = $("#view-lists"); v.replaceChildren();
  const stage = el("div", { class: "card lstage" });
  const edit = el("div", { class: "recs" });
  v.append(el("button", { type: "button", class: "back", onclick: () => go("lists") }, el("span", { html: IC.back }), "قوائمي"),
    el("div", { class: "view-head" }, el("h2", { text: (id === "fav" ? "♥ " : "") + L.name })), stage);
  if (!L.items.length) stage.append(el("p", { class: "muted small", text: "القائمة فارغة. افتح قصيدة وشغّل تسجيلاً، ثم «أضف إلى المفضلة» أو «أضف إلى قائمة» تحت المشغّل." }));
  else {
    const auto = state.autoStart === id; state.autoStart = null;
    playerFor(stage, QP.listQueue(L), 0, auto, { queueTitle: "القائمة" });
    L.items.forEach((it) => {
      edit.append(el("div", { class: "lrow" },
        el("span", { class: "tx" }, el("b", { text: it.title }), el("span", { class: "small muted", text: [it.rec.reciter, QP.describe(it.rec).source].filter(Boolean).join(" · ") })),
        el("button", { type: "button", class: "icon-x", "aria-label": "أزل «" + it.title + "» من القائمة", onclick: () => { removeFromList(id, it.k); renderList(id); } }, "×")));
    });
    v.append(el("details", { class: "card" }, el("summary", { text: "تعديل القائمة" }), edit));
  }
  if (id !== "fav") v.append(el("button", { type: "button", class: "btn", onclick: (e) => { const m = el("span", { class: "small" }); e.currentTarget.after(m); confirmInline(m, "ستُحذف القائمة «" + L.name + "».", () => { QP.store.deleteList(id); go("lists"); }); } }, "احذف القائمة"));
}

/* ---------- saved media (download / offline) ---------- */
const QM = window.QMedia;
const mediaKey = (r) => r.type === "file" ? r.key : (r.type === "audio" ? safeUrl(r.src) : null);
async function refreshSaved(){
  try { state.saved = new Set(await QM.keys()); } catch { state.saved = new Set(); }
  renderIndex(); renderStorage();
}
const isSaved = (r) => { const k = mediaKey(r); return !!(k && state.saved && state.saved.has(k)); };
const fileName = (p, r, blob) => {
  const ext = ((blob && blob.type) || r.mime || "audio/mpeg").includes("video") ? "mp4" : ((blob && blob.type) || "").includes("mp4") || ((blob && blob.type) || "").includes("aac") ? "m4a" : ((blob && blob.type) || "").includes("wav") ? "wav" : "mp3";
  const base = [p.title, r.reciter].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "قصيدة";
  return r.name && r.type === "file" ? r.name : base + "." + ext;
};
async function saveToPhone(blob, name){
  const file = new File([blob], name, { type: blob.type || "audio/mpeg" });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios && navigator.canShare && navigator.canShare({ files: [file] })){
    try { await navigator.share({ files: [file], title: name }); return "shared"; } catch (e){ if (e && e.name === "AbortError") return "cancel"; }
  }
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "downloaded";
}
let audioBlobUrl = null;
async function setAudioSource(a, r){
  const key = mediaKey(r);
  const wantLocal = state.saved.has(key);
  if (a.dataset.key === key && a.getAttribute("src") && (!wantLocal || a.src.startsWith("blob:"))) return;
  const resumeAt = a.dataset.key === key ? a.currentTime : 0, wasPlaying = a.dataset.key === key && !a.paused;
  let url = r.type === "audio" ? safeUrl(r.src) : null;
  try { const item = await QM.get(key); if (item && item.blob){ if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl); audioBlobUrl = url = URL.createObjectURL(item.blob); } } catch {}
  if (!url) throw new Error("missing");
  a.src = url; a.dataset.key = key; a.load();
  if (resumeAt){ a.addEventListener("loadedmetadata", () => { a.currentTime = resumeAt; if (wasPlaying) a.play().catch(() => {}); }, { once: true }); }
}
function mediaActions(p, r){
  const row = el("div", { class: "mact" });
  const msg = el("p", { class: "small muted", "aria-live": "polite" });
  const paint = () => {
    row.replaceChildren();
    if (r.type === "youtube"){
      row.append(el("button", { type: "button", class: "chip", onclick: () => {
        msg.replaceChildren("لا يسمح يوتيوب بتنزيل مقاطعه من خارج تطبيقه. افتح المقطع في تطبيق يوتيوب واضغط «تنزيل» تحته إن كان متاحاً في حسابك، أو أضف إلى هذه القصيدة ملفاً صوتياً من هاتفك. ",
          el("a", { href: "https://www.youtube.com/watch?v=" + r.id, target: "_blank", rel: "noopener" }, "افتح في يوتيوب"));
      } }, el("span", { html: IC.down }), "تنزيل"));
      return;
    }
    const saved = isSaved(r);
    if (saved) row.append(el("span", { class: "chip ok" }, el("span", { html: IC.check }), r.type === "file" ? "ملف على هاتفك" : "محفوظ للاستماع دون إنترنت"));
    else row.append(el("button", { type: "button", class: "chip", onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true; msg.textContent = "أحفظ التسجيل…";
      try {
        await QM.saveRemote(safeUrl(r.src), { title: p.title, reciter: r.reciter || "", poemId: p.id }, (got, total) => { msg.textContent = total ? "أحفظ التسجيل… " + ar(Math.round(got / total * 100)) + "٪" : "أحفظ التسجيل… " + ar((got / 1048576).toFixed(1)) + " م.ب"; });
        msg.textContent = "حُفظ. يعمل الآن دون إنترنت."; await refreshSaved(); paint();
        setAudioSource($("#audio"), r).catch(() => {});
      } catch (err){
        b.disabled = false;
        msg.textContent = err.code === "cors" ? "هذا المصدر لا يسمح بالحفظ داخل التطبيق. استخدم «تنزيل إلى الهاتف» لحفظ الملف في هاتفك." : err.code === "offline" ? "لا يوجد اتصال بالإنترنت." : err.name === "QuotaExceededError" ? "لا توجد مساحة كافية على الهاتف." : "تعذّر الحفظ الآن. أعد المحاولة.";
      }
    } }, el("span", { html: IC.save }), "احفظ دون إنترنت"));
    row.append(el("button", { type: "button", class: "chip", onclick: async () => {
      try {
        let blob = null;
        const item = await QM.get(mediaKey(r)).catch(() => null);
        if (item && item.blob) blob = item.blob;
        else {
          msg.textContent = "أجهّز الملف…";
          try { const res = await fetch(safeUrl(r.src), { mode: "cors" }); if (res.ok) blob = await res.blob(); } catch {}
        }
        if (blob){ const how = await saveToPhone(blob, fileName(p, r, blob)); msg.textContent = how === "cancel" ? "" : how === "shared" ? "اختر «حفظ في الملفات» لحفظه." : "بدأ التنزيل. ستجده في مجلد التنزيلات."; }
        else { msg.replaceChildren("سيُفتح الملف في المتصفح؛ اختر «تنزيل» من قائمته. ", el("a", { href: safeUrl(r.src), target: "_blank", rel: "noopener" }, "افتح الملف")); }
      } catch { msg.textContent = "تعذّر التنزيل."; }
    } }, el("span", { html: IC.down }), "تنزيل إلى الهاتف"));
    if (saved) row.append(el("button", { type: "button", class: "chip", onclick: async () => {
      if (r.type === "file"){
        if (!confirmInline(msg, "سيُحذف الملف وتسجيله من هذه القصيدة.", async () => { await removeFileRecording(p, r); })) return;
        return;
      }
      await QM.del(mediaKey(r)).catch(() => {}); await refreshSaved(); msg.textContent = "حُذف من الهاتف."; paint();
    } }, r.type === "file" ? "احذف الملف" : "احذف من الهاتف"));
  };
  paint();
  return el("div", { class: "mwrap" }, row, msg);
}
function confirmInline(msg, text, onYes){
  msg.replaceChildren(text + " ", el("button", { type: "button", class: "linkbtn", onclick: onYes }, "تأكيد الحذف"));
  return false;
}
async function removeFileRecording(p, r){
  await QM.del(r.key).catch(() => {});
  const ex = lsGet(LS.extra, {}); if (ex[p.id]) ex[p.id] = ex[p.id].filter((x) => x.key !== r.key); lsSet(LS.extra, ex);
  const local = lsGet(LS.local, []); const it = local.find((x) => x.id === p.id); if (it){ it.recordings = (it.recordings || []).filter((x) => x.key !== r.key); lsSet(LS.local, local); }
  rebuild(); await refreshSaved(); state.page = null; renderPoem(p.id);
}
async function renderStorage(){
  const box = $("#storeInfo"); if (!box) return;
  try { const u = await QM.usage(); box.textContent = u.count ? ar(u.count) + " تسجيل محفوظ على هاتفك · " + ar((u.bytes / 1048576).toFixed(1)) + " ميغابايت" : "لا توجد تسجيلات محفوظة بعد. افتح تسجيلاً صوتياً واضغط «احفظ دون إنترنت»."; $("#clearStore").hidden = !u.count; }
  catch { box.textContent = "التخزين غير متاح في هذا المتصفح."; }
}

function saveTemp(){
  const t = state.temp; if (!t) return;
  const p = { ...t, id: "local-" + Date.now().toString(36), temp: undefined, aliases: [], opening: t.title, keywords: [], books: [] };
  delete p.temp; delete p.local;
  const local = lsGet(LS.local, []); local.push(p); lsSet(LS.local, local); state.temp = null; rebuild(); go("p-" + p.id);
}
function deleteLocal(id){
  const pd = poemById(id); if (pd) for (const r of pd.recordings || []) if (r.type === "file") QM.del(r.key).catch(() => {});
  lsSet(LS.local, lsGet(LS.local, []).filter((p) => p.id !== id));
  const ex = lsGet(LS.extra, {}); delete ex[id]; lsSet(LS.extra, ex);
  lsSet(LS.hist, lsGet(LS.hist, []).filter((x) => x !== id));
  rebuild(); go("index");
}
async function copyText(t, msg){ try { await navigator.clipboard.writeText(t); msg.textContent = "نُسخ."; } catch { msg.textContent = "تعذّر النسخ."; } }
async function sharePoem(p, msg){
  const url = location.origin + location.pathname + (p.local ? "" : "#p-" + p.id);
  const text = p.title + (p.poet ? " — شعر " + p.poet : "") + ((p.reciters || [])[0] ? " — بصوت " + p.reciters[0] : "");
  const yt = playable(p).find((r) => r.type === "youtube");
  const body = text + (yt ? "\nhttps://youtu.be/" + yt.id : "");
  if (navigator.share){ try { await navigator.share({ title: p.title, text: body, url }); } catch {} return; }
  copyText(body + "\n" + url, msg);
}

/* ---------- unknown poem ---------- */
function showUnknown({ raw, candidates }){
  state.temp = null;
  const v = $("#view-poem"); v.replaceChildren();
  v.append(el("button", { type: "button", class: "back", onclick: () => go("scan") }, el("span", { html: IC.back }), "رجوع"));
  const guess = M.guessTitle(raw);
  v.append(el("div", { class: "hero" }, el("span", { class: "pill", text: candidates.length ? "مطابقة غير مؤكدة" : "لم نتعرّف عليها بعد" }), el("h2", { text: guess || "قصيدة غير معروفة" }),
    el("p", { class: "by", text: S.ready() ? "صوّرها مرة أخرى بإضاءة أوضح." : "هذه القصيدة ليست في الفهرس." })));
  if (candidates.length) v.append(el("div", { class: "card" }, el("h3", { class: "card-t", text: "هل هي إحدى هذه القصائد؟" }),
    el("div", { class: "cands" }, candidates.map((p) => el("button", { type: "button", class: "btn", onclick: () => go("p-" + p.id) }, p.title + (p.poet ? " — " + p.poet : ""))))));
  if (!S.ready()) v.append(el("a", { class: "smart-card", href: "#settings" }, el("span", { class: "dot off" }), el("div", null, el("b", { text: "فعّل التعرّف الذكي" }), el("small", { text: "ليتعرّف التطبيق على أي قصيدة ويجد تسجيلها، حتى بلا عنوان أو اسم شاعر." })), el("span", { class: "go", text: "الإعدادات" })));
  v.append(el("div", { class: "row gap" }, el("button", { type: "button", class: "btn primary", onclick: () => { go("scan"); startCamera(); } }, "صوّر مجدداً"),
    el("a", { class: "btn", href: ytSearchUrl(guess), target: "_blank", rel: "noopener" }, "ابحث في يوتيوب")));
  if (raw && raw.trim()) v.append(el("details", { class: "card" }, el("summary", { text: "النص كما قرأه الهاتف" }), el("pre", { class: "raw", text: raw.trim() })));
  v.append(addForm(null, guess));
  for (const x of ["scan", "index", "settings"]) $("#view-" + x).hidden = true;
  v.hidden = false; state.view = "poem";
  $$(".tabbar a").forEach((a) => a.removeAttribute("aria-current"));
  window.scrollTo({ top: 0 });
}

/* ---------- add a link (saved on this phone) ---------- */
function parseLink(url){
  const u = safeUrl(url); if (!u) return null;
  const x = new URL(u), h = x.hostname.replace(/^(www|m|music)\./, "");
  let yt = null;
  if (h === "youtu.be") yt = x.pathname.slice(1, 12);
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) yt = x.searchParams.get("v") || (x.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/) || [])[1] || null;
  if (yt && /^[\w-]{11}$/.test(yt)) return { type: "youtube", id: yt, source: "يوتيوب" };
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav)(\?|#|$)/i.test(x.pathname)) return { type: "audio", src: u, source: h };
  const names = { "shiavoice.com": "صوت الشيعة", "rafed.net": "شبكة رافد", "rawda.app": "تطبيق روضة", "shoaraa.com": "شعراء أهل البيت" };
  return { type: "link", url: u, source: names[h] || h };
}
function addForm(poem, guessTitle){
  const d = el("details", { class: "card" }, el("summary", { text: poem ? "أضف تسجيلاً آخر" : "أضف القصيدة مع رابط تسجيلها" }));
  const f = el("form", { class: "stack" });
  let tIn, pIn;
  if (!poem){
    tIn = el("input", { type: "text", id: "fTitle", required: true, value: guessTitle || "" });
    pIn = el("input", { type: "text", id: "fPoet" });
    f.append(el("label", { class: "f", for: "fTitle" }, el("span", { text: "عنوان القصيدة" }), tIn), el("label", { class: "f", for: "fPoet" }, el("span", { text: "الشاعر" }), pIn));
  }
  const uIn = el("input", { type: "url", id: "fUrl", placeholder: "https://youtu.be/…", dir: "ltr" });
  const fIn = el("input", { type: "file", id: "fFile", accept: "audio/*,video/*", class: "vh" });
  const fName = el("span", { class: "small muted", text: "" });
  fIn.addEventListener("change", () => { const f = fIn.files && fIn.files[0]; fName.textContent = f ? f.name + " · " + ar((f.size / 1048576).toFixed(1)) + " م.ب" : ""; });
  const rIn = el("input", { type: "text", id: "fRec", value: poem ? ((poem.reciters || [])[0] || "") : "" });
  const nIn = el("input", { type: "text", id: "fNote", placeholder: "مثال: ليلة ٧ محرم ١٤٣٤ هـ" });
  const msg = el("p", { class: "small", "aria-live": "polite" });
  f.append(el("label", { class: "f", for: "fUrl" }, el("span", { text: "رابط يوتيوب أو ملف mp3" }), uIn),
    el("div", { class: "row gap" }, el("label", { class: "btn", for: "fFile" }, el("span", { html: IC.note }), "أو اختر ملفاً صوتياً أو فيديو من هاتفك", fIn), fName),
    el("label", { class: "f", for: "fRec" }, el("span", { text: "الرادود" }), rIn),
    el("label", { class: "f", for: "fNote" }, el("span", { text: "المناسبة (اختياري)" }), nIn), el("div", { class: "row gap" }, el("button", { type: "submit", class: "btn primary" }, "احفظ"), msg));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = fIn.files && fIn.files[0];
    let rec;
    if (file){
      const key = "file:" + Date.now().toString(36);
      msg.className = "small muted"; msg.textContent = "أحفظ الملف على هاتفك…";
      try { await QM.put(key, file, { name: file.name, title: poem ? poem.title : "" }); try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {} }
      catch (err){ msg.className = "small err"; msg.textContent = err && err.name === "QuotaExceededError" ? "لا توجد مساحة كافية على الهاتف." : "تعذّر حفظ الملف."; return; }
      rec = { type: "file", key, kind: (file.type || "").startsWith("video") ? "video" : "audio", mime: file.type, name: file.name.slice(0, 120), source: "من هاتفي" };
    } else {
      rec = parseLink(uIn.value.trim());
      if (!rec){ msg.className = "small err"; msg.textContent = "الصق رابطاً يبدأ بـ https:// أو اختر ملفاً من هاتفك."; return; }
    }
    rec.reciter = rIn.value.trim().slice(0, 80); rec.note = nIn.value.trim().slice(0, 120);
    let id;
    if (poem){
      const ex = lsGet(LS.extra, {}); (ex[poem.id] = ex[poem.id] || []).push(rec);
      if (!lsSet(LS.extra, ex)){ msg.className = "small err"; msg.textContent = "تعذّر الحفظ على هذا الهاتف."; return; }
      id = poem.id;
    } else {
      const title = tIn.value.trim().slice(0, 120); if (!title){ msg.className = "small err"; msg.textContent = "اكتب عنوان القصيدة."; return; }
      id = "local-" + Date.now().toString(36);
      const local = lsGet(LS.local, []);
      local.push({ id, title, aliases: [], poet: pIn.value.trim().slice(0, 120), opening: "", keywords: [], subject: "", reciters: rec.reciter ? [rec.reciter] : [], books: [], recordings: [rec] });
      if (!lsSet(LS.local, local)){ msg.className = "small err"; msg.textContent = "تعذّر الحفظ على هذا الهاتف."; return; }
    }
    rebuild(); refreshSaved(); state.page = null; go("p-" + id);
  });
  d.append(f);
  return d;
}

/* ---------- settings ---------- */
let savedKeysExist = null;                     // checked once: are this owner's keys saved in the repository?
function renderSmartCard(){
  const c = $("#smartCard"); c.replaceChildren();
  const on = S.ready(), yt = S.hasYouTube();
  if (!on && savedKeysExist){
    c.append(el("span", { class: "dot off" }), el("div", null, el("b", { text: "مفاتيحك محفوظة" }),
      el("small", { text: "استرجعها على هذا الجهاز بكلمة السر ليعمل التعرّف الذكي هنا." })), el("span", { class: "go", text: "استرجعها" }));
    return;
  }
  c.append(el("span", { class: "dot " + (on ? "on" : "off") }),
    el("div", null, el("b", { text: on ? "التعرّف الذكي مفعّل" : "التعرّف الذكي غير مفعّل" }),
      el("small", { text: on ? (yt ? "يتعرّف على أي قصيدة ويبحث عن تسجيلها." : "يقرأ أي قصيدة. أضف مفتاح يوتيوب ليجد تسجيلها.") : "حالياً يتعرّف على قصائد الفهرس فقط. فعّله ليتعرّف على أي قصيدة." })),
    el("span", { class: "go", text: on ? "الإعدادات" : "فعّله" }));
}
/* ---------- keys on every device ---------- */
const KS = window.QKeySync;
if (KS && !S.ready()) KS.latest().then((f) => { savedKeysExist = !!f; renderSmartCard(); }).catch(() => {});
if (KS){
  const msg = $("#syncMsg"), say = (t, cls) => { msg.className = "small " + (cls || "muted"); msg.textContent = t; };
  $("#syncSave").addEventListener("click", async () => {
    const k = S.keys(), p1 = $("#syncPass").value, row2 = $("#syncPass2Row");
    if (!k.gemini && !k.youtube){ say("لا مفاتيح على هذا الجهاز لحفظها. أضفها أعلاه أولاً.", "err"); return; }
    if (p1.length < 12){ say("كلمة السر قصيرة: ١٢ حرفاً على الأقل.", "err"); $("#syncPass").focus(); return; }
    if (row2.hidden){ row2.hidden = false; $("#syncPass2").focus(); say("أعد كتابة كلمة السر للتأكيد، ثم اضغط «احفظ» مرة أخرى."); return; }
    if ($("#syncPass2").value !== p1){ say("كلمتا السر غير متطابقتين.", "err"); return; }
    say("أشفّر المفاتيح…");
    const blob = await KS.seal(k, p1);
    const url = KS.saveUrl(blob);
    window.open(url, "_blank", "noopener");
    say("فُتحت صفحة GitHub وفيها الملف المشفّر: اضغط «Commit changes» هناك. إن لم تُفتح الصفحة، اضغط هنا.", "ok");
    msg.append(" ", el("a", { href: url, target: "_blank", rel: "noopener" }, "افتح صفحة الحفظ"));
    row2.hidden = true; $("#syncPass2").value = "";
  });
  $("#syncLoad").addEventListener("click", async () => {
    const p1 = $("#syncPass").value;
    if (!p1){ say("اكتب كلمة السر أولاً.", "err"); $("#syncPass").focus(); return; }
    const b = $("#syncLoad"); b.disabled = true; say("أجلب الملف المشفّر وأفك تشفيره…");
    try {
      const f = await KS.latest();
      if (!f){ say("لا توجد مفاتيح محفوظة بعد. احفظها أولاً من الجهاز الذي فيه المفاتيح.", "err"); return; }
      const k = await KS.open(f.blob, p1);
      S.saveKeys(k); fillSettings(); renderSmartCard(); savedKeysExist = true;
      $("#syncPass").value = "";
      say("استُرجعت المفاتيح وحُفظت على هذا الجهاز ✓ (حُفظت في " + new Date(k.at).toLocaleDateString("ar-IQ") + ").", "ok");
    } catch (e){
      say(e.code === "wrong" ? "كلمة السر غير صحيحة." : e.code === "limit" ? "GitHub رفض الطلب مؤقتاً، أعد المحاولة بعد قليل." : "تعذّر جلب الملف الآن. تأكد من الاتصال.", "err");
    } finally { b.disabled = false; }
  });
}
$("#autoPlay").addEventListener("change", (e) => setPlayPref("autoplay", e.target.checked));
function fillSettings(){
  $("#autoPlay").checked = !!playPrefs().autoplay;
  const k = S.keys(); $("#kGemini").value = k.gemini; $("#kYoutube").value = k.youtube;
  let t = "auto"; try { t = localStorage.getItem(LS.theme) || "auto"; } catch {}
  $$("#themeSeg button").forEach((b) => b.setAttribute("aria-checked", String(t === b.dataset.v)));
  $$("#modeSeg button").forEach((b) => b.setAttribute("aria-checked", String(S.mode() === b.dataset.v)));
  renderStorage();
}
$("#kShow").addEventListener("change", (e) => { const t = e.target.checked ? "text" : "password"; $("#kGemini").type = t; $("#kYoutube").type = t; });
$("#keysForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const k = { gemini: $("#kGemini").value, youtube: $("#kYoutube").value };
  S.saveKeys(k); renderSmartCard();
  const msg = $("#keysMsg");
  if (!k.gemini.trim()){ msg.className = "small muted"; msg.textContent = "حُذف المفتاح. التعرّف الذكي متوقف."; return; }
  msg.className = "small muted"; msg.textContent = "أختبر المفاتيح…";
  const r = await S.test(S.keys());
  const say = { ok: "يعمل", bad_key: "غير صحيح", forbidden: "لا يملك الصلاحية (فعّل الخدمة على المشروع)", quota: "تجاوز الحد المؤقت", region: "غير متاح من شبكتك", offline: "لا يوجد اتصال", network: "تعذّر الاتصال" };
  const g = say[r.gemini] || r.gemini, y = r.youtube ? (say[r.youtube] || r.youtube) : "لم يُضف";
  msg.className = "small " + (r.gemini === "ok" ? "ok" : "err");
  msg.textContent = "Gemini: " + g + " · YouTube: " + y;
});
$$("#themeSeg button").forEach((b) => b.addEventListener("click", () => {
  const v = b.dataset.v;
  try { if (v === "auto") localStorage.removeItem(LS.theme); else localStorage.setItem(LS.theme, v); } catch {}
  if (v === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
  $$("#themeSeg button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
}));
function renderMine(){
  const local = lsGet(LS.local, []), ex = lsGet(LS.extra, {});
  const n = Object.values(ex).reduce((a, b) => a + b.length, 0);
  $("#mineInfo").textContent = local.length || n ? ar(local.length) + " قصيدة و" + ar(n) + " تسجيل أضفتها أنت. شاركها ليضيفها المشرف إلى الفهرس العام." : "لم تضف شيئاً بعد. كل قصيدة يتعرّف عليها التعرّف الذكي تُحفظ هنا تلقائياً.";
}
$("#exportBtn").addEventListener("click", () => {
  const noFiles = (list) => (list || []).filter((r) => r.type !== "file");
  const ex0 = lsGet(LS.extra, {}); const exOut = {}; for (const k of Object.keys(ex0)){ const l = noFiles(ex0[k]); if (l.length) exOut[k] = l; }
  const data = { localPoems: lsGet(LS.local, []).map((p) => ({ ...p, recordings: noFiles(p.recordings) })), extraRecordings: exOut };
  const box = $("#exportBox"), msg = $("#exportMsg");
  if (!data.localPoems.length && !Object.keys(data.extraRecordings).length){ msg.textContent = "لم تضف شيئاً بعد."; return; }
  const txt = JSON.stringify(data); box.value = txt; box.hidden = false;
  if (navigator.share) navigator.share({ title: "إضافات قارئ القصائد", text: txt }).catch(() => {});
  else navigator.clipboard?.writeText(txt).then(() => { msg.textContent = "نُسخت. أرسلها لمشرف الفهرس."; }).catch(() => { box.select(); });
});

/* ---------- install & offline ---------- */
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.deferredInstall = e; if (!standalone()) $("#installBtn").hidden = false; });
$("#installBtn").addEventListener("click", async () => { const e = state.deferredInstall; if (!e) return; e.prompt(); try { await e.userChoice; } catch {} state.deferredInstall = null; $("#installBtn").hidden = true; });
window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; });
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone()) $("#iosHint").hidden = false;
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => { const nw = reg.installing; nw && nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) $("#updateHint").hidden = false; }); });
  }).catch(() => {});
}
$("#reloadBtn").addEventListener("click", () => location.reload());
// When a new version takes over, reload once so the page and its code always match.
if ("serviceWorker" in navigator){
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded){ reloaded = true; location.reload(); } });
}

/* ---------- wiring ---------- */
$("#camBtn").addEventListener("click", startCamera);
// The whole waiting area opens the camera, not only the round button.
$("#idle").addEventListener("click", (e) => { if (!e.target.closest("#camBtn")) $("#camBtn").click(); });
$("#stopBtn").addEventListener("click", stopCamera);
$("#shotBtn").addEventListener("click", snapNow);
$("#torchBtn").addEventListener("click", async () => {
  if (!state.track) return; state.torch = !state.torch;
  try { await state.track.applyConstraints({ advanced: [{ torch: state.torch }] }); $("#torchBtn").setAttribute("aria-pressed", String(state.torch)); }
  catch { state.torch = false; $("#torchBtn").hidden = true; }
});
$$("input.pick").forEach((i) => i.addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; pickImage(f); }));
$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault(); const q = $("#q").value.trim(); if (q.length < 2) return;
  const m = M.findMatches(state.poems, q, true);
  if (m.best) openPoem(m.best.p, {}); else textSearch(q);
});
$("#quickForm").addEventListener("submit", (e) => { e.preventDefault(); $("#qq").blur(); textSearch($("#qq").value); });
$("#voiceBtn").addEventListener("click", voiceSearch);
$$(".search .mic").forEach((b) => b.addEventListener("click", () => {
  const input = document.getElementById(b.dataset.for);
  if (S.ready() && V.canRecord()) voiceSearch();
  else if (V.canDictate()) dictateInto(input, b);
  else note("البحث بالصوت يحتاج تفعيل التعرّف الذكي: أضف مفتاح Gemini من الإعدادات.", true);
}));
$$("#modeSeg button").forEach((b) => b.addEventListener("click", () => { S.setMode(b.dataset.v); $$("#modeSeg button").forEach((x) => x.setAttribute("aria-checked", String(x === b))); }));
let qt; $("#q").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(renderIndex, 150); });
$$(".tabbar a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.tab); }));
document.addEventListener("visibilitychange", () => { if (document.hidden && state.stream) stopCamera(); });

$("#clearStore").addEventListener("click", (e) => {
  const b = e.currentTarget;
  if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "اضغط مرة أخرى للتأكيد"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "احذف التسجيلات المحفوظة للاستماع دون إنترنت"; }, 4000); return; }
  b.dataset.sure = "";
  QM.list().then(async (items) => { for (const it of items) if (!String(it.key).startsWith("file:")) await QM.del(it.key); await refreshSaved(); b.textContent = "احذف التسجيلات المحفوظة للاستماع دون إنترنت"; });
});

renderSmartCard();
loadIndex().then(() => { route(); refreshSaved(); });
})();
