(() => {
"use strict";
const M = window.QMatch;
const $ = (s) => document.querySelector(s);
const abs = (p) => new URL(p, location.href).href;
const LS_LOCAL = "qasida.localPoems.v1";
const LS_EXTRA = "qasida.extraRecordings.v1";
const LS_POS = "qasida.audioPos.v1";

const state = {
  base: [], poems: [], current: null,
  stream: null, track: null, torch: false, scanning: false, busy: false, frames: 0,
  worker: null, workerP: null, deferredInstall: null
};

/* ---------- storage ---------- */
function lsGet(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

/* ---------- DOM helper ---------- */
function el(tag, attrs, ...kids){
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const ICON = {
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>'
};
function svg(name){ const s = el("span", { "aria-hidden": "true", style: "display:inline-flex" }); s.innerHTML = ICON[name]; return s; }

/* ---------- index ---------- */
async function loadIndex(){
  try {
    const r = await fetch("poems.json", { cache: "no-cache" });
    const j = await r.json();
    state.base = Array.isArray(j.poems) ? j.poems : [];
  } catch {
    state.base = [];
  }
  rebuild();
}
function rebuild(){
  const extra = lsGet(LS_EXTRA, {});
  const local = lsGet(LS_LOCAL, []);
  const all = state.base.map((p) => ({ ...p, recordings: [...(p.recordings || []), ...((extra[p.id]) || [])] }));
  for (const p of local) all.push({ ...p, local: true, recordings: [...(p.recordings || []), ...((extra[p.id]) || [])] });
  state.poems = all;
  renderIndex();
}
const poemById = (id) => state.poems.find((p) => p.id === id);

function renderIndex(){
  const box = $("#index");
  const f = M.compact($("#q").value);
  let list = state.poems.slice().sort((a, b) => String(a.title).localeCompare(String(b.title), "ar"));
  if (f.length >= 2) list = list.filter((p) => M.compact([p.title, p.poet, p.opening, ...(p.reciters || [])].join(" ")).includes(f));
  $("#idxCount").textContent = M.toArabicDigits(state.poems.length) + " قصيدة";
  if (!list.length){
    box.replaceChildren(el("p", { class: "muted", text: state.poems.length ? "لا توجد قصيدة تطابق ما كتبت." : "تعذّر تحميل الفهرس. تحقّق من الاتصال ثم أعد فتح التطبيق." }));
    return;
  }
  box.replaceChildren(...list.map((p) => {
    const playable = (p.recordings || []).filter((r) => r.type === "audio" || r.type === "youtube").length;
    return el("button", { type: "button", class: "btn item", onclick: () => go(p.id) },
      el("span", { class: "tt", text: p.title }),
      el("span", { class: "cnt", text: playable ? M.toArabicDigits(playable) + " تسجيل" : "بلا تسجيل" }),
      el("span", { class: "sub", text: [p.poet, (p.reciters || []).join("، "), p.local ? "أضفتها أنت" : ""].filter(Boolean).join(" · ") }));
  }));
}

/* ---------- routing ---------- */
function go(id){ if (location.hash !== "#p-" + id) location.hash = "p-" + id; else showPoem(id, null, true); }
window.addEventListener("hashchange", route);
function route(){
  const m = location.hash.match(/^#p-([\w-]+)$/);
  if (m && poemById(m[1])) showPoem(m[1], state.current && state.current.poemId === m[1] ? state.current.scanText : null, true);
}

/* ---------- reader (on-device OCR) ---------- */
function showProgress(text, frac){
  const p = $("#progress");
  if (text == null){ p.hidden = true; return; }
  p.hidden = false; $("#progText").textContent = text;
  $("#bar").style.setProperty("--p", Math.round((frac || 0) * 100) + "%");
}
function getWorker(){
  if (state.worker) return Promise.resolve(state.worker);
  if (state.workerP) return state.workerP;
  showProgress("تجهيز قارئ النص لأول مرة…", 0.05);
  state.workerP = Tesseract.createWorker("ara", 1, {
    workerPath: abs("vendor/tesseract/worker.min.js"),
    corePath: abs("vendor/core/"),
    langPath: abs("vendor/lang"),
    workerBlobURL: false,
    gzip: true,
    logger: (m) => {
      if (m.status && /load|initializ/i.test(m.status) && !state.worker) showProgress("تجهيز قارئ النص لأول مرة…", m.progress || 0);
    }
  }).then(async (w) => {
    try { await w.setParameters({ preserve_interword_spaces: "1" }); } catch {}
    state.worker = w; showProgress(null); return w;
  }).catch((e) => {
    state.workerP = null; showProgress(null);
    throw e;
  });
  return state.workerP;
}

/* Grayscale + contrast stretch; long side scaled to ~1800px. Returns a canvas. */
function prepare(src, w, h, maxSide = 1800){
  const s = Math.min(1, maxSide / Math.max(w, h)) || 1;
  const cw = Math.round(w * s), ch = Math.round(h * s);
  const c = document.createElement("canvas"); c.width = cw; c.height = ch;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, cw, ch);
  const img = ctx.getImageData(0, 0, cw, ch); const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4){ const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = g; hist[g]++; }
  const total = cw * ch; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++){ acc += hist[v]; if (acc > total * 0.02){ lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--){ acc += hist[v]; if (acc > total * 0.02){ hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4){ let g = ((d[i] - lo) * 255 / range) | 0; g = g < 0 ? 0 : g > 255 ? 255 : g; d[i] = d[i + 1] = d[i + 2] = g; }
  ctx.putImageData(img, 0, 0);
  return c;
}
async function readCanvas(canvas){
  const w = await getWorker();
  const { data } = await w.recognize(canvas);
  return data.text || "";
}

/* ---------- camera ---------- */
function camStatus(t){ const s = $("#camStatus"); s.hidden = !t; s.textContent = t || ""; }
async function startCamera(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    $("#camNote").textContent = "هذا المتصفح لا يتيح الكاميرا داخل الصفحة. استخدم «اختر صورة»، أو افتح التطبيق في كروم أو سفاري.";
    $("#camNote").className = "small err"; return;
  }
  getWorker().catch(() => {});
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
    state.stream = stream; state.track = stream.getVideoTracks()[0];
    const v = $("#video"); v.srcObject = stream; await v.play().catch(() => {});
    $("#cam").classList.add("on");
    $("#camBtn").hidden = true; $("#shotBtn").hidden = false; $("#stopBtn").hidden = false;
    let caps = {}; try { caps = state.track.getCapabilities ? state.track.getCapabilities() : {}; } catch {}
    $("#torchBtn").hidden = !caps.torch;
    try { if (caps.focusMode && caps.focusMode.includes("continuous")) await state.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch {}
    $("#camNote").className = "small muted";
    $("#camNote").textContent = "ثبّت الهاتف فوق الصفحة. سيتعرّف التطبيق عليها تلقائياً، أو اضغط «التقط الآن».";
    state.scanning = true; state.frames = 0;
    camStatus("جاري تجهيز القارئ…");
    scanLoop();
  } catch (e){
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    $("#camNote").className = "small err";
    $("#camNote").textContent = denied
      ? "لم يُسمح باستخدام الكاميرا. افتح إعدادات المتصفح وامنح هذا الموقع إذن الكاميرا، أو استخدم «اختر صورة»."
      : "تعذّر فتح الكاميرا على هذا الجهاز. استخدم «اختر صورة».";
  }
}
function stopCamera(){
  state.scanning = false;
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null; state.track = null; state.torch = false;
  $("#video").srcObject = null;
  $("#cam").classList.remove("on", "reading");
  $("#camBtn").hidden = false; $("#shotBtn").hidden = true; $("#stopBtn").hidden = true; $("#torchBtn").hidden = true;
  $("#torchBtn").setAttribute("aria-pressed", "false");
  camStatus("");
}
function frameCanvas(maxSide){
  const v = $("#video");
  if (!v.videoWidth) return null;
  return prepare(v, v.videoWidth, v.videoHeight, maxSide);
}
async function scanLoop(){
  while (state.scanning){
    if (state.busy || document.hidden){ await sleep(400); continue; }
    const c = frameCanvas(1600);
    if (!c){ await sleep(300); continue; }
    state.busy = true; $("#cam").classList.add("reading");
    try {
      const text = await readCanvas(c);
      if (!state.scanning) break;
      state.frames++;
      const m = M.findMatches(state.poems, text, false);
      if (m.best){
        try { navigator.vibrate && navigator.vibrate(60); } catch {}
        stopCamera();
        state.current = { poemId: m.best.p.id, scanText: text };
        go(m.best.p.id);
        break;
      }
      if (m.candidates.length) camStatus("أقرأ الصفحة… قد تكون «" + m.candidates[0].p.title + "». قرّب الكاميرا من العنوان.");
      else if (state.frames >= 3) camStatus("لم أتعرّف عليها بعد. اجعل العنوان والأبيات الأولى واضحة، أو اضغط «التقط الآن».");
      else camStatus("أقرأ الصفحة…");
    } catch {
      camStatus("تعذّر تشغيل قارئ النص. تحقّق من الاتصال في أول استخدام ثم أعد المحاولة.");
      state.busy = false; $("#cam").classList.remove("reading");
      await sleep(2500);
      continue;
    }
    state.busy = false; $("#cam").classList.remove("reading");
    await sleep(250);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snapNow(){
  const c = frameCanvas(2000); if (!c) return;
  stopCamera();
  await readAndShow(c);
}
async function readAndShow(canvas){
  showProgress("أقرأ الصفحة…", 0.5);
  try {
    const text = await readCanvas(canvas);
    showProgress(null);
    const m = M.findMatches(state.poems, text, false);
    if (m.best){ state.current = { poemId: m.best.p.id, scanText: text }; go(m.best.p.id); }
    else showNotFound({ text, candidates: m.candidates.map((c) => c.p.id) });
  } catch {
    showProgress(null);
    $("#camNote").className = "small err";
    $("#camNote").textContent = "تعذّرت قراءة الصورة. تحقّق من الاتصال في أول استخدام ثم أعد المحاولة.";
  }
}
async function pickImage(file){
  if (!file) return;
  stopCamera();
  let src, w, h;
  try {
    if (window.createImageBitmap){ src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; h = src.height; }
    else throw 0;
  } catch {
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  await readAndShow(prepare(src, w, h, 2000));
}

/* ---------- poem card ---------- */
function addMeta(dl, k, v){ if (v) dl.append(el("div", null, el("dt", { text: k + ":" }), el("dd", { text: v }))); }
function headBlock(pillCls, pillText, title, dl){
  return el("div", { style: "display:flex;flex-direction:column;gap:6px" }, el("span", { class: "pill " + pillCls, text: pillText }), el("h2", { class: "ptitle", text: title }), dl);
}

function showPoem(id, scanText, scroll){
  const p = poemById(id); if (!p) return;
  stopAllMedia();
  state.current = { poemId: id, scanText: scanText || null };
  const box = $("#result"); box.hidden = false; box.replaceChildren();
  const dl = el("dl", { class: "meta" });
  addMeta(dl, "الشاعر", p.poet);
  addMeta(dl, "الرادود", (p.reciters || []).join("، "));
  addMeta(dl, "الموضوع", p.subject);
  box.append(headBlock("good", scanText ? "تعرّفنا على القصيدة" : (p.local ? "أضفتها أنت" : "من الفهرس"), p.title, dl));
  if (Array.isArray(p.books) && p.books.length)
    box.append(el("p", { class: "small muted", text: "وردت في: " + p.books.map((b) => b.book + (b.page ? "، ص " + M.toArabicDigits(b.page) : "")).join("؛ ") }));

  const playable = (p.recordings || []).filter((r) => (r.type === "audio" && safeUrl(r.src)) || (r.type === "youtube" && /^[\w-]{11}$/.test(r.id || "")));
  const links = (p.recordings || []).filter((r) => r.type === "link" && safeUrl(r.url));
  if (playable.length){
    const tabs = el("div", { class: "tabs", role: "tablist", "aria-label": "التسجيلات" });
    const stage = el("div", { class: "player", role: "tabpanel" });
    let ytN = 0, auN = 0;
    playable.forEach((r, i) => {
      const label = r.type === "youtube" ? "يوتيوب " + M.toArabicDigits(++ytN) : "صوت " + M.toArabicDigits(++auN);
      const t = el("button", { type: "button", class: "tab", role: "tab", "aria-selected": i === 0 ? "true" : "false",
        onclick: () => { tabs.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", "false")); t.setAttribute("aria-selected", "true"); mount(stage, p, r); } },
        svg(r.type === "youtube" ? "youtube" : "audio"), label);
      tabs.append(t);
    });
    box.append(el("div", { class: "group", style: "display:flex;flex-direction:column;gap:8px" }, el("h3", { text: "استمع وشاهد" }), tabs, stage));
    mount(stage, p, playable[0]);
  } else {
    box.append(el("p", { class: "muted", text: "لا يوجد تسجيل قابل للتشغيل لهذه القصيدة بعد. أضف رابط يوتيوب أو ملف صوتي من الأسفل." }));
  }
  if (links.length){
    box.append(el("div", { style: "display:flex;flex-direction:column;gap:6px" }, el("h3", { text: "مصادر أخرى" }),
      el("div", { class: "ext" }, links.map((r) => el("a", { class: "btn", href: safeUrl(r.url), target: "_blank", rel: "noopener" }, r.source + (r.note ? " · " + r.note : ""))))));
  }
  const shareMsg = el("span", { class: "small muted", "aria-live": "polite" });
  box.append(el("div", { class: "row" },
    el("button", { type: "button", class: "btn", onclick: () => sharePoem(p, shareMsg) }, "شارك القصيدة"),
    el("a", { class: "btn", href: ytSearch(p.title, p.poet, (p.reciters || [])[0]), target: "_blank", rel: "noopener" }, "أداءات أخرى على يوتيوب"),
    shareMsg));
  if (scanText) box.append(scanDetails(scanText));
  box.append(addForm(p, null));
  if (scroll) box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function mount(stage, p, r){
  stopAllMedia();
  stage.replaceChildren();
  const cap = el("p", { class: "cap", text: [r.reciter, r.source, r.note].filter(Boolean).join(" · ") });
  if (r.type === "youtube"){
    const holder = el("div", { class: "yt" });
    const btn = el("button", { type: "button", "aria-label": "شغّل المقطع", style: "background-image:url('https://i.ytimg.com/vi/" + r.id + "/hqdefault.jpg')", onclick: () => {
      holder.replaceChildren(el("iframe", {
        src: "https://www.youtube-nocookie.com/embed/" + r.id + "?autoplay=1&playsinline=1&rel=0",
        title: p.title + " — " + (r.reciter || "يوتيوب"),
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin"
      }));
    } }, el("span"));
    holder.append(btn);
    stage.append(holder, cap, el("p", { class: "small muted" }, "إن لم يعمل المقطع هنا ", el("a", { href: "https://www.youtube.com/watch?v=" + r.id, target: "_blank", rel: "noopener" }, "افتحه في يوتيوب"), "."));
  } else {
    const a = el("audio", { controls: true, preload: "metadata", src: safeUrl(r.src) });
    const key = r.src;
    const pos = lsGet(LS_POS, {});
    a.addEventListener("loadedmetadata", () => { if (pos[key] && pos[key] < a.duration - 5) a.currentTime = pos[key]; }, { once: true });
    let last = 0;
    a.addEventListener("timeupdate", () => { if (Math.abs(a.currentTime - last) > 5){ last = a.currentTime; const ps = lsGet(LS_POS, {}); ps[key] = Math.floor(a.currentTime); lsSet(LS_POS, ps); } });
    a.addEventListener("play", () => {
      if ("mediaSession" in navigator){
        try { navigator.mediaSession.metadata = new MediaMetadata({ title: p.title, artist: r.reciter || "", album: p.poet ? "شعر " + p.poet : "", artwork: [{ src: abs("icons/icon-512.png"), sizes: "512x512", type: "image/png" }] }); } catch {}
      }
    });
    const err = el("p", { class: "small err", hidden: true }, "تعذّر تشغيل الملف من مصدره الآن. ", r.page ? el("a", { href: safeUrl(r.page), target: "_blank", rel: "noopener" }, "افتح صفحته") : null);
    a.addEventListener("error", () => { err.hidden = false; });
    const speeds = el("div", { class: "speeds", role: "group", "aria-label": "سرعة التشغيل" });
    [0.75, 1, 1.25, 1.5].forEach((v) => {
      const b = el("button", { type: "button", "aria-pressed": v === 1 ? "true" : "false", onclick: () => { a.playbackRate = v; speeds.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); } }, M.toArabicDigits(v) + "×");
      speeds.append(b);
    });
    const big = el("button", { type: "button", class: "btn primary", onclick: () => { a.play().catch(() => { err.hidden = false; }); } }, "▶ تشغيل");
    a.addEventListener("play", () => { big.hidden = true; });
    stage.append(big, a, el("div", { class: "row between" }, cap, speeds), err);
  }
}
function stopAllMedia(){
  document.querySelectorAll("#result audio").forEach((a) => { try { a.pause(); } catch {} });
  document.querySelectorAll("#result .yt iframe").forEach((f) => f.remove());
}

function scanDetails(text){
  return el("details", null, el("summary", { text: "النص كما قرأه التطبيق من الصفحة" }),
    el("pre", { class: "verses", text: text.trim() }),
    el("p", { class: "small muted", text: "القراءة آلية وقد تخطئ في بعض الكلمات؛ المرجع هو الصفحة المطبوعة." }));
}

function showNotFound({ text, candidates }){
  stopAllMedia();
  state.current = { poemId: null, scanText: text };
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  const box = $("#result"); box.hidden = false; box.replaceChildren();
  const guess = M.guessTitle(text);
  box.append(headBlock(candidates.length ? "warn" : "none", candidates.length ? "مطابقة غير مؤكدة" : "لم نتعرّف عليها بعد", guess || "قصيدة غير معروفة", null));
  if (candidates.length){
    box.append(el("div", { style: "display:flex;flex-direction:column;gap:6px" }, el("h3", { text: "هل هي إحدى هذه القصائد؟" }),
      el("div", { class: "cands" }, candidates.map((id) => { const p = poemById(id); return p ? el("button", { type: "button", class: "btn", onclick: () => go(p.id) }, p.title + (p.poet ? " — " + p.poet : "")) : null; }))));
  }
  box.append(el("p", { text: "هذه القصيدة ليست في الفهرس بعد. صوّرها مرة أخرى بإضاءة أوضح، أو ابحث عنها في يوتيوب ثم الصق رابطها هنا لتعمل داخل التطبيق في المرات القادمة." }));
  box.append(el("div", { class: "row" },
    el("a", { class: "btn", href: ytSearch(guess), target: "_blank", rel: "noopener" }, "ابحث عنها في يوتيوب"),
    el("button", { type: "button", class: "btn", onclick: () => { $("#cam").scrollIntoView({ behavior: "smooth" }); startCamera(); } }, "صوّر مجدداً")));
  if (text && text.trim()) box.append(scanDetails(text));
  box.append(addForm(null, guess));
  box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function showTyped(q){
  const m = M.findMatches(state.poems, q, true);
  if (m.best){ go(m.best.p.id); return; }
  const box = $("#result"); box.hidden = false; box.replaceChildren();
  box.append(headBlock(m.candidates.length ? "warn" : "none", m.candidates.length ? "نتائج البحث" : "لا نتائج في الفهرس", q, null));
  if (m.candidates.length) box.append(el("div", { class: "cands" }, m.candidates.map((c) => el("button", { type: "button", class: "btn", onclick: () => go(c.p.id) }, c.p.title + (c.p.poet ? " — " + c.p.poet : "")))));
  else box.append(el("div", { class: "row" }, el("a", { class: "btn", href: ytSearch(q), target: "_blank", rel: "noopener" }, "ابحث في يوتيوب")));
  box.append(addForm(null, q));
}

/* ---------- adding links (saved on this phone) ---------- */
function parseLink(url){
  const u = safeUrl(url); if (!u) return null;
  const x = new URL(u); const h = x.hostname.replace(/^(www|m|music)\./, "");
  let yt = null;
  if (h === "youtu.be") yt = x.pathname.slice(1, 12);
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) yt = x.searchParams.get("v") || (x.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/) || [])[1] || null;
  if (yt && /^[\w-]{11}$/.test(yt)) return { type: "youtube", id: yt, source: "يوتيوب" };
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav)(\?|#|$)/i.test(x.pathname)) return { type: "audio", src: u, source: h };
  const names = { "shiavoice.com": "صوت الشيعة", "rafed.net": "شبكة رافد", "rawda.app": "تطبيق روضة", "shoaraa.com": "شعراء أهل البيت" };
  return { type: "link", url: u, source: names[h] || h };
}
function addForm(poem, guessTitle){
  const f = el("form", { style: "display:flex;flex-direction:column;gap:10px" });
  f.append(el("div", { class: "divider" }), el("h3", { text: poem ? "أضف تسجيلاً آخر لهذه القصيدة" : "أضف القصيدة مع رابط تسجيلها" }));
  const row = el("div", { class: "row", style: "align-items:flex-end" });
  let tIn, pIn;
  if (!poem){
    tIn = el("input", { type: "text", id: "fTitle", required: true, value: guessTitle || "" });
    pIn = el("input", { type: "text", id: "fPoet" });
    row.append(el("label", { class: "f", for: "fTitle" }, "عنوان القصيدة", tIn), el("label", { class: "f", for: "fPoet" }, "الشاعر", pIn));
  }
  const uIn = el("input", { type: "url", id: "fUrl", required: true, placeholder: "رابط يوتيوب أو ملف mp3", dir: "ltr" });
  const rIn = el("input", { type: "text", id: "fRec", value: poem ? ((poem.reciters || [])[0] || "") : "" });
  const nIn = el("input", { type: "text", id: "fNote", placeholder: "مثال: ليلة ٧ محرم ١٤٣٤ هـ" });
  row.append(el("label", { class: "f", for: "fUrl", style: "flex-basis:100%" }, "الرابط", uIn), el("label", { class: "f", for: "fRec" }, "الرادود", rIn), el("label", { class: "f", for: "fNote" }, "المناسبة (اختياري)", nIn));
  const msg = el("p", { class: "small", "aria-live": "polite" });
  f.append(row, el("div", { class: "row" }, el("button", { type: "submit", class: "btn" }, "احفظ"), msg));
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const rec = parseLink(uIn.value.trim());
    if (!rec){ msg.className = "small err"; msg.textContent = "الرابط غير صالح. الصق رابطاً يبدأ بـ https://"; return; }
    rec.reciter = rIn.value.trim().slice(0, 80); rec.note = nIn.value.trim().slice(0, 120);
    let id;
    if (poem){
      const extra = lsGet(LS_EXTRA, {}); (extra[poem.id] = extra[poem.id] || []).push(rec);
      if (!lsSet(LS_EXTRA, extra)){ msg.className = "small err"; msg.textContent = "تعذّر الحفظ على هذا الهاتف."; return; }
      id = poem.id;
    } else {
      const title = tIn.value.trim().slice(0, 120);
      if (!title){ msg.className = "small err"; msg.textContent = "اكتب عنوان القصيدة."; return; }
      const local = lsGet(LS_LOCAL, []);
      id = "local-" + Date.now().toString(36);
      local.push({ id, title, aliases: [], poet: pIn.value.trim().slice(0, 120), opening: "", keywords: [], subject: "", reciters: rec.reciter ? [rec.reciter] : [], books: [], recordings: [rec] });
      if (!lsSet(LS_LOCAL, local)){ msg.className = "small err"; msg.textContent = "تعذّر الحفظ على هذا الهاتف."; return; }
    }
    rebuild();
    const scan = state.current && state.current.scanText;
    showPoem(id, scan, false);
  });
  return f;
}

function exportMine(){
  const data = { localPoems: lsGet(LS_LOCAL, []), extraRecordings: lsGet(LS_EXTRA, {}) };
  const n = data.localPoems.length + Object.values(data.extraRecordings).reduce((a, b) => a + b.length, 0);
  const box = $("#exportBox"), msg = $("#exportMsg");
  if (!n){ msg.textContent = "لم تضف شيئاً بعد."; box.hidden = true; return; }
  const txt = JSON.stringify(data, null, 1);
  box.value = txt; box.hidden = false;
  if (navigator.share){ navigator.share({ title: "إضافات قارئ القصائد", text: txt }).then(() => { msg.textContent = "تمت المشاركة."; }).catch(() => {}); }
  else if (navigator.clipboard){ navigator.clipboard.writeText(txt).then(() => { msg.textContent = "نُسخت الإضافات. أرسلها لمشرف الفهرس."; }).catch(() => { msg.textContent = "انسخ النص من المربع وأرسله."; box.select(); }); }
}

/* ---------- misc ---------- */
function safeUrl(u){ try { const x = new URL(String(u)); return (x.protocol === "https:" || x.protocol === "http:") ? x.href : null; } catch { return null; } }
function ytSearch(...parts){ return "https://www.youtube.com/results?search_query=" + encodeURIComponent(parts.filter(Boolean).join(" ")); }
async function sharePoem(p, msg){
  const url = location.origin + location.pathname + "#p-" + p.id;
  const text = p.title + (p.poet ? " — " + p.poet : "") + ((p.reciters || [])[0] ? " — بصوت " + p.reciters[0] : "");
  if (navigator.share){ try { await navigator.share({ title: p.title, text, url }); } catch {} return; }
  try { await navigator.clipboard.writeText(text + "\n" + url); msg.textContent = "نُسخ الرابط."; } catch { msg.textContent = url; }
}

/* ---------- install & offline ---------- */
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.deferredInstall = e; if (!standalone()) $("#installBtn").hidden = false; });
$("#installBtn").addEventListener("click", async () => {
  const e = state.deferredInstall; if (!e) return;
  e.prompt(); try { await e.userChoice; } catch {}
  state.deferredInstall = null; $("#installBtn").hidden = true;
});
window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; });
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone()) $("#iosHint").hidden = false;

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) $("#updateHint").hidden = false; });
    });
  }).catch(() => {});
}
$("#reloadBtn").addEventListener("click", () => location.reload());

/* ---------- wiring ---------- */
$("#camBtn").addEventListener("click", startCamera);
$("#stopBtn").addEventListener("click", stopCamera);
$("#shotBtn").addEventListener("click", snapNow);
$("#torchBtn").addEventListener("click", async () => {
  if (!state.track) return;
  state.torch = !state.torch;
  try { await state.track.applyConstraints({ advanced: [{ torch: state.torch }] }); $("#torchBtn").setAttribute("aria-pressed", String(state.torch)); }
  catch { state.torch = false; $("#torchBtn").hidden = true; }
});
$("#pickIn").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; pickImage(f); });
$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#q").value.trim(); if (v.length >= 2) showTyped(v); });
let qt; $("#q").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(renderIndex, 150); });
$("#exportBtn").addEventListener("click", exportMine);
document.addEventListener("visibilitychange", () => { if (document.hidden && state.stream) stopCamera(); });

loadIndex().then(route);
})();
