/* QPlayer — one player for every source (ShiaVoice, YouTube, Rafed and other audio, files on the phone).
   The same face for all: what is playing (reciter, kind, occasion, date, length), previous / play / next,
   a seek bar, what happens at the end (stop, next, repeat this, repeat all), the queue, favourites and lists.
   Each source is an "engine"; where a source does not let a page control it (ShiaVoice's embedded player),
   its own play button is shown inside and the rest of the player still works around it.
   Shared by the full app and the light app (same site, so favourites and lists are shared too). */
(function (root) {
  "use strict";
  const LS = { lists: "qasida.lists.v1", play: "qasida.play.v1", pos: "qasida.audioPos.v1" };
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const AR = "٠١٢٣٤٥٦٧٨٩";
  const ar = (x) => String(x).replace(/\d/g, (d) => AR[d]);
  const clock = (s) => {
    if (!isFinite(s) || s <= 0) return "";
    s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return ar((h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"));
  };
  const toSec = (v) => {
    if (typeof v === "number") return v;
    const t = String(v || "").replace(/[٠-٩]/g, (d) => AR.indexOf(d));
    return /^\d+(:\d+){0,2}$/.test(t) ? t.split(":").reduce((a, b) => a * 60 + +b, 0) : 0;
  };
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
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
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    // In a right-to-left page "previous" points right and "next" points left.
    prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6zM9.5 12 18 6v12z" transform="matrix(-1 0 0 1 24 0)"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6zM9.5 12 18 6v12z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
  };

  /* ---------- what happens at the end, autoplay ---------- */
  const AFTER = { stop: ["يتوقف بعد الانتهاء", "⏹"], next: ["التالي تلقائياً", "⏭"], one: ["كرّر هذا", "🔂"], all: ["كرّر الكل", "🔁"] };
  const ORDER = ["next", "one", "all", "stop"];
  function prefs() {
    const p = Object.assign({ autoplay: false }, lsGet(LS.play, {}));
    if (!AFTER[p.after]) p.after = p.repeat === "one" ? "one" : p.repeat === "all" ? "all" : "next";
    return p;
  }
  function setPref(k, v) {
    const p = prefs(); p[k] = v;
    if (k === "after") p.repeat = v === "one" ? "one" : v === "all" ? "all" : "off";   // older versions read `repeat`
    lsSet(LS.play, p);
  }

  /* ---------- favourites and lists (one store for both apps) ---------- */
  const recKey = (r) => r.type + ":" + (r.id || r.key || r.src || r.url || "");
  function lists() {
    const l = lsGet(LS.lists, null) || [];
    if (!l.some((x) => x.id === "fav")) l.unshift({ id: "fav", name: "المفضلة", items: [] });
    return l;
  }
  const saveLists = (l) => lsSet(LS.lists, l);
  const inList = (id, r) => { const L = lists().find((x) => x.id === id); return !!(L && L.items.some((it) => it.k === recKey(r))); };
  function addToList(id, p, r) {
    const l = lists(), L = l.find((x) => x.id === id), k = recKey(r);
    if (!L || L.items.some((it) => it.k === k)) return false;
    const rec = Object.assign({}, r); delete rec.blob;
    L.items.push({ k, rec, title: p.title, poet: p.poet || "", poemId: p.temp || !p.id ? null : p.id, at: Date.now() });
    saveLists(l); return true;
  }
  function removeFromList(id, k) { const l = lists(), L = l.find((x) => x.id === id); if (!L) return; L.items = L.items.filter((it) => it.k !== k); saveLists(l); }
  function newList(name) { const l = lists(); const L = { id: "l" + Date.now().toString(36), name: String(name).trim().slice(0, 40) || "قائمة جديدة", items: [] }; l.push(L); saveLists(l); return L; }
  function deleteList(id) { if (id !== "fav") saveLists(lists().filter((x) => x.id !== id)); }
  /* A list as a queue for the player. */
  const listQueue = (L) => L.items.map((it) => ({ rec: it.rec, title: it.title, poem: { id: it.poemId || null, title: it.title, poet: it.poet, temp: !it.poemId }, listKey: it.k }));

  /* ---------- describing a recording ---------- */
  const SECTION = { letmiat: "لطمية", qesaed: "قصيدة", enashid: "أنشودة", ed3ie: "دعاء", zeyarat: "زيارة", afrah: "مولد وأفراح", quran: "قرآن", mohadarat: "محاضرة" };
  const OCCASIONS = [["عاشوراء", "عاشوراء"], ["محرم", "محرم"], ["الأربعين", "الأربعين"], ["اربعين", "الأربعين"], ["صفر", "صفر"], ["فاطمي", "الفاطمية"],
    ["رمضان", "رمضان"], ["شعبان", "شعبان"], ["رجب", "رجب"], ["الغدير", "الغدير"], ["مواليد", "مواليد"], ["مولد", "مولد"], ["استشهاد", "استشهاد"], ["وفاة", "وفاة"]];
  const ytDate = (iso) => { try { return new Date(iso).toLocaleDateString("ar-IQ-u-nu-arab", { year: "numeric", month: "long" }); } catch { return ""; } };
  function describe(r) {
    const source = r.type === "shiavoice" ? "صوت الشيعة" : r.type === "youtube" ? "يوتيوب" : r.type === "file" ? "من هاتفي" : (r.source || "تسجيل صوتي");
    const rawAlbum = String(r.album || "");
    const hay = rawAlbum + " " + (r.note || "") + " " + (r.title || "");
    const occ = OCCASIONS.find(([w]) => hay.includes(w));
    const hy = rawAlbum.match(/(1[34]\d\d)\s*(?:هـ|ه)?/), gy = rawAlbum.match(/\b(19[89]\d|20[0-4]\d)\b/);
    const date = hy ? ar(hy[1]) + " هـ" : gy ? ar(gy[1]) : r.published ? ytDate(r.published) : "";
    // "إصدار X - reciter" is an album; "reciter - لطميات" is only the reciter's shelf.
    const album = /^إصدار\s+/.test(rawAlbum) ? rawAlbum.replace(/^إصدار\s+/, "").replace(/\s+-\s+[^-]+$/, "").trim() : "";
    return { source, kind: SECTION[r.section] || "", occasion: occ ? occ[1] : "", date, album, dur: toSec(r.dur || r.duration) };
  }
  const thumbOf = (r) => r.type === "youtube" ? "https://i.ytimg.com/vi/" + r.id + "/mqdefault.jpg" : "";
  const posKey = (r) => r.type === "audio" ? r.src : r.type === "file" ? r.key : r.type === "youtube" ? "yt:" + r.id : null;

  /* ---------- engines ---------- */
  let ytApiP = null;
  function ytApi() {
    if (root.YT && root.YT.Player) return Promise.resolve(root.YT);
    if (ytApiP) return ytApiP;
    ytApiP = new Promise((res, rej) => {
      const prev = root.onYouTubeIframeAPIReady;
      root.onYouTubeIframeAPIReady = () => { prev && prev(); res(root.YT); };
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = () => { ytApiP = null; rej(new Error("yt")); };
      document.head.append(s);
      setTimeout(() => { if (!(root.YT && root.YT.Player)) { ytApiP = null; rej(new Error("timeout")); } }, 9000);
    });
    return ytApiP;
  }
  let sharedAudio = null;
  function audioEl(o) {
    if (o.audio) return o.audio;
    if (!sharedAudio) { sharedAudio = el("audio", { preload: "metadata", hidden: true }); document.body.append(sharedAudio); }
    return sharedAudio;
  }
  const ENGINES = {
    audio(item, ctx, o) {
      const a = audioEl(o), r = item.rec;
      a.onplay = a.onpause = a.ondurationchange = a.ontimeupdate = a.onloadedmetadata = ctx.changed;
      a.onended = ctx.ended; a.onerror = () => ctx.fail();
      const setSrc = o.resolveAudio ? () => o.resolveAudio(a, r) : async () => { if (a.getAttribute("src") !== r.src) { a.src = r.src; a.load(); } };
      return {
        control: true, media: a, ready: Promise.resolve().then(setSrc),
        play: () => a.play(), pause: () => a.pause(), seek: (t) => { a.currentTime = t; }, rate: (x) => { a.playbackRate = x; },
        state: () => ({ playing: !a.paused, t: a.currentTime, d: a.duration }),
        destroy: () => { a.pause(); a.onplay = a.onpause = a.ondurationchange = a.ontimeupdate = a.onloadedmetadata = a.onended = a.onerror = null; }
      };
    },
    video(item, ctx, o) {
      const v = el("video", { playsinline: true, preload: "metadata", class: "qp-video", controls: true });
      v.onplay = v.onpause = v.ondurationchange = v.ontimeupdate = v.onloadedmetadata = ctx.changed;
      v.onended = ctx.ended; v.onerror = () => ctx.fail();
      let url = null;
      const ready = Promise.resolve(o.videoSrc ? o.videoSrc(item.rec) : item.rec.src).then((u) => { if (!u) throw new Error("missing"); url = u; v.src = u; });
      return {
        el: v, control: true, ready,
        play: () => v.play(), pause: () => v.pause(), seek: (t) => { v.currentTime = t; }, rate: (x) => { v.playbackRate = x; },
        state: () => ({ playing: !v.paused, t: v.currentTime, d: v.duration }),
        destroy: () => { v.pause(); if (url && url.startsWith("blob:")) URL.revokeObjectURL(url); v.removeAttribute("src"); }
      };
    },
    youtube(item, ctx) {
      const r = item.rec, box = el("div", { class: "qp-yt" }), slot = el("div");
      box.append(slot);
      let pl = null, timer = null, alive = true, fallback = false;
      let readyRes; const ready = new Promise((res) => { readyRes = res; });
      const eng = {
        el: box, control: false, ready,
        play: () => { try { pl && pl.playVideo(); } catch {} return Promise.resolve(); },
        pause: () => { try { pl && pl.pauseVideo(); } catch {} },
        seek: (t) => { try { pl && pl.seekTo(t, true); } catch {} },
        rate: (x) => { try { pl && pl.setPlaybackRate(x); } catch {} },
        state: () => { try { const st = pl.getPlayerState(); return { playing: st === 1 || st === 3, t: pl.getCurrentTime(), d: pl.getDuration() }; } catch { return { playing: false, t: 0, d: NaN }; } },
        destroy: () => { alive = false; clearInterval(timer); try { pl && pl.destroy(); } catch {} box.remove(); }
      };
      ytApi().then((YT) => {
        if (!alive) return;
        pl = new YT.Player(slot, {
          videoId: r.id, host: "https://www.youtube-nocookie.com",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: ctx.autoplay ? 1 : 0 },
          events: {
            onReady: () => { eng.control = true; timer = setInterval(() => { if (alive) ctx.changed(); }, 500); readyRes(); ctx.changed(); },
            onStateChange: (e) => { if (e.data === 0) ctx.ended(); ctx.changed(); },
            onError: () => ctx.fail()
          }
        });
      }).catch(() => {
        if (!alive) return;
        fallback = true;
        box.replaceChildren(el("iframe", { src: "https://www.youtube-nocookie.com/embed/" + r.id + "?playsinline=1&rel=0" + (ctx.autoplay ? "&autoplay=1" : ""), title: item.title,
          allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin" }));
        readyRes(); ctx.changed();
      });
      eng.own = () => fallback;
      return eng;
    },
    shiavoice(item) {
      const r = item.rec;
      // ShiaVoice's player needs ~600px; laid out wide, the part with its play button and progress bar shows.
      const box = el("div", { class: "qp-sv" }, el("div", { class: "svwrap" },
        el("iframe", { class: "svframe", src: "https://shiavoice.com/embed-" + encodeURIComponent(r.id), title: item.title + " — صوت الشيعة", referrerpolicy: "strict-origin-when-cross-origin" })));
      return { el: box, control: false, own: () => true, ready: Promise.resolve(), play: () => Promise.reject(new Error("embed")), pause() {}, seek() {}, rate() {},
        state: () => ({ playing: false, t: 0, d: NaN }), destroy: () => box.remove() };
    }
  };
  const engineFor = (r) => r.type === "youtube" ? "youtube" : r.type === "shiavoice" ? "shiavoice" : r.type === "file" && r.kind === "video" ? "video" : "audio";

  /* ---------- the player ---------- */
  let current = null;
  const SPEEDS = [1, 1.25, 1.5, 0.75];
  /* o: { queue: [{rec, title, poem:{id,title,poet,temp}}], index, autoplay, audio, resolveAudio(a, rec), videoSrc(rec),
          extras(item) → nodes or null (null: favourites + the source's own download), artwork, showAutoplay, queueTitle, onIndex(i) } */
  function mount(host, o) {
    stop();
    const queue = o.queue || [];
    const P = { i: -1, eng: null, resumed: false, lastSave: 0, speed: 1, alive: true, touched: false };
    const art = el("div", { class: "qp-art" });
    const title = el("b", { class: "qp-title" }), who = el("span", { class: "qp-who" }), meta = el("div", { class: "qp-meta" });
    const count = el("span", { class: "qp-count" });
    const surface = el("div", { class: "qp-surface" });
    const cur = el("span", { text: "٠:٠٠" }), dur = el("span", { text: "--:--" });
    const seek = el("input", { type: "range", min: "0", max: "1000", value: "0", "aria-label": "موضع التشغيل" });
    const seekRow = el("div", { class: "qp-seek", dir: "ltr" }, cur, seek, dur);
    const bPrev = el("button", { type: "button", class: "qp-b", "aria-label": "السابق", html: IC.prev });
    const bNext = el("button", { type: "button", class: "qp-b", "aria-label": "التالي", html: IC.next });
    const bBack = el("button", { type: "button", class: "qp-b qp-s", "aria-label": "رجوع ١٠ ثوانٍ", text: "١٠-" });
    const bFwd = el("button", { type: "button", class: "qp-b qp-s", "aria-label": "تقديم ١٠ ثوانٍ", text: "+١٠" });
    const bPlay = el("button", { type: "button", class: "qp-play", "aria-label": "تشغيل", html: IC.play });
    const bSpeed = el("button", { type: "button", class: "qp-chip", "aria-label": "السرعة", text: "١×" });
    const bAfter = el("button", { type: "button", class: "qp-chip" });
    const resume = el("p", { class: "qp-resume", hidden: true });
    const note = el("p", { class: "qp-note", hidden: true });
    const err = el("p", { class: "qp-err", hidden: true });
    const extras = el("div", { class: "qp-extras" });
    const qlist = el("ol", { class: "qp-queue" });
    const autoBox = o.showAutoplay ? el("label", { class: "qp-switch" }, el("input", { type: "checkbox", onchange: (e) => setPref("autoplay", e.target.checked) }), "شغّل عند ظهور النتيجة") : null;
    if (autoBox) autoBox.firstChild.checked = !!prefs().autoplay;
    const rootEl = el("section", { class: "qp", "aria-label": "المشغّل" },
      el("div", { class: "qp-now" }, art, el("div", { class: "qp-info" }, title, who, meta), count),
      surface, seekRow,
      el("div", { class: "qp-ctrl" }, bPrev, bBack, bPlay, bFwd, bNext),
      el("div", { class: "qp-modes" }, bAfter, bSpeed, autoBox),
      resume, note, err, extras,
      queue.length > 1 ? el("div", { class: "qp-qhead" }, el("h3", { text: (o.queueTitle || "التسجيلات") + " (" + ar(queue.length) + ")" })) : null,
      queue.length > 1 ? qlist : null);
    host.replaceChildren(rootEl);

    const paintAfter = () => {
      let v = prefs().after; if (queue.length < 2 && v === "all") v = "one";
      bAfter.replaceChildren(el("span", { "aria-hidden": "true", text: AFTER[v][1] + " " }), AFTER[v][0]);
      bAfter.setAttribute("aria-label", "بعد انتهاء التسجيل: " + AFTER[v][0]);
    };
    bAfter.addEventListener("click", () => {
      const order = queue.length > 1 ? ORDER : ["stop", "one"];
      let v = prefs().after; if (!order.includes(v)) v = queue.length > 1 ? "next" : "stop";
      setPref("after", order[(order.indexOf(v) + 1) % order.length]); paintAfter();
    });
    paintAfter();

    const savePos = (force) => {
      const e = P.eng, item = queue[P.i]; if (!e || !item) return;
      const k = posKey(item.rec); if (!k) return;
      const s = e.state(); if (!isFinite(s.d) || s.d < 60) return;
      if (!force && Math.abs(s.t - P.lastSave) < 5) return;
      P.lastSave = s.t;
      const ps = lsGet(LS.pos, {});
      if (s.t > 10 && s.t < s.d - 10) ps[k] = Math.floor(s.t); else delete ps[k];
      lsSet(LS.pos, ps);
    };
    const sync = () => {
      if (!P.alive) return;
      const e = P.eng; if (!e) return;
      const ctrl = e.control && !(e.own && e.own());
      const s = ctrl ? e.state() : { playing: false, t: 0, d: NaN };
      bPlay.innerHTML = s.playing ? IC.pause : IC.play;
      bPlay.setAttribute("aria-label", s.playing ? "إيقاف مؤقت" : "تشغيل");
      bPlay.disabled = !ctrl; bBack.disabled = bFwd.disabled = !ctrl;
      seekRow.hidden = !ctrl || engineFor(queue[P.i].rec) === "video";
      cur.textContent = clock(s.t) || "٠:٠٠";
      dur.textContent = isFinite(s.d) && s.d > 0 ? clock(s.d) : "--:--";
      if (isFinite(s.d) && s.d > 0 && document.activeElement !== seek) seek.value = String(Math.round((s.t || 0) / s.d * 1000));
      // Resume where the person stopped last time (once per recording).
      if (ctrl && !P.resumed && isFinite(s.d) && s.d > 0) {
        P.resumed = true;
        const k = posKey(queue[P.i].rec), at = k ? lsGet(LS.pos, {})[k] : 0;
        if (at && at > 10 && at < s.d - 10) {
          e.seek(at);
          resume.hidden = false;
          resume.replaceChildren("أكملتُ من حيث توقفت (" + clock(at) + "). ",
            el("button", { type: "button", class: "qp-link", onclick: () => { e.seek(0); resume.hidden = true; } }, "من البداية"));
        }
      }
      if (s.playing) savePos(false);
      if ("mediaSession" in navigator) {
        try { navigator.mediaSession.playbackState = s.playing ? "playing" : "paused"; } catch {}
        try { if (ctrl && isFinite(s.d) && s.d > 0) navigator.mediaSession.setPositionState({ duration: s.d, position: Math.min(s.t, s.d), playbackRate: P.speed }); } catch {}
      }
    };
    const ended = () => {
      const k = posKey(queue[P.i].rec);
      if (k) { const ps = lsGet(LS.pos, {}); delete ps[k]; lsSet(LS.pos, ps); }
      let a = prefs().after; if (queue.length < 2 && a === "all") a = "one";
      // Going on by itself starts each recording from its beginning.
      if (a === "one") load(P.i, true, true);
      else if ((a === "next" || a === "all") && P.i + 1 < queue.length) load(P.i + 1, true, true);
      else if (a === "all") load(0, true, true);
      else sync();
    };
    const fail = () => {
      const r = queue[P.i] && queue[P.i].rec; if (!r) return;
      err.hidden = false;
      err.replaceChildren("تعذّر التشغيل من المصدر الآن. ",
        r.type === "youtube" ? el("a", { href: "https://www.youtube.com/watch?v=" + r.id, target: "_blank", rel: "noopener" }, "افتحه في يوتيوب") :
        r.page ? el("a", { href: r.page, target: "_blank", rel: "noopener" }, "افتح صفحته") : "",
        queue.length > 1 ? el("button", { type: "button", class: "qp-link", onclick: () => load(P.i + 1, true) }, " التالي") : "");
    };

    const setSession = (item) => {
      if (!("mediaSession" in navigator)) return;
      const r = item.rec, d = describe(r), th = thumbOf(r);
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: r.reciter || "", album: [d.source, d.album || d.occasion].filter(Boolean).join(" · "),
          artwork: th ? [{ src: th, sizes: "320x180", type: "image/jpeg" }] : o.artwork ? [{ src: o.artwork, sizes: "512x512", type: "image/png" }] : [] });
      } catch {}
      const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
      const ok = () => P.eng && P.eng.control && !(P.eng.own && P.eng.own());
      h("play", () => { if (ok()) P.eng.play(); });
      h("pause", () => { if (ok()) P.eng.pause(); });
      h("previoustrack", queue.length > 1 ? () => prev() : null);
      h("nexttrack", queue.length > 1 ? () => next() : null);
      h("seekbackward", () => { if (ok()) P.eng.seek(Math.max(0, P.eng.state().t - 10)); });
      h("seekforward", () => { if (ok()) P.eng.seek(P.eng.state().t + 10); });
      h("seekto", (e) => { if (ok() && e && isFinite(e.seekTime)) P.eng.seek(e.seekTime); });
    };

    const paintHead = (item) => {
      const r = item.rec, d = describe(r), th = thumbOf(r);
      art.replaceChildren(); art.className = "qp-art" + (th ? " ph" : "");
      if (th) art.style.backgroundImage = "url('" + th + "')"; else { art.style.backgroundImage = ""; art.innerHTML = engineFor(r) === "video" ? IC.film : IC.note; }
      title.textContent = item.title;
      who.textContent = [r.reciter, item.poem && item.poem.poet && item.poem.title === item.title ? "شعر " + item.poem.poet : ""].filter(Boolean).join(" · ");
      meta.replaceChildren(...[d.source, d.kind, d.occasion, d.date, d.album ? "إصدار «" + d.album + "»" : "", d.dur ? clock(d.dur) : ""].filter(Boolean).map((t) => el("span", { text: t })));
      count.textContent = queue.length > 1 ? ar(P.i + 1) + " / " + ar(queue.length) : "";
      count.hidden = queue.length < 2;
    };
    const QMAX = 12;
    let showAll = false;
    const paintQueue = () => {
      if (queue.length < 2) return;
      qlist.replaceChildren();
      const upto = showAll ? queue.length : Math.max(QMAX, P.i + 1);
      queue.slice(0, upto).forEach((it, k) => {
        const r = it.rec, d = describe(r), th = thumbOf(r);
        qlist.append(el("li", {}, el("button", { type: "button", class: "qp-row", "aria-current": String(k === P.i), onclick: () => load(k, true) },
          th ? el("span", { class: "qp-th", style: "background-image:url('" + th + "')" }) : el("span", { class: "qp-th au", html: IC.note }),
          el("span", { class: "qp-tx" }, el("b", { text: it.title }),
            el("span", { text: [r.reciter, d.source, d.kind, d.occasion || d.date, d.dur ? clock(d.dur) : ""].filter(Boolean).join(" · ") })),
          it.badge ? el("span", { class: "qp-tag" + (it.badge === "محتمل" ? " maybe" : ""), text: it.badge }) : null)));
      });
      if (upto < queue.length) qlist.append(el("li", {}, el("button", { type: "button", class: "qp-more", onclick: () => { showAll = true; paintQueue(); } }, "عرض الكل (" + ar(queue.length) + ")")));
    };

    function defaultExtras(item) {
      const r = item.rec, p = item.poem || { title: item.title };
      const nodes = [favRow(p, r)];
      if (r.type === "shiavoice") nodes.push(el("p", { class: "qp-dl" }, el("a", { class: "qp-chip", href: "https://shiavoice.com/play-" + encodeURIComponent(r.id), target: "_blank", rel: "noopener" }, el("span", { html: IC.down }), "تنزيل من صوت الشيعة"),
        el("span", { class: "qp-small", text: "يفتح صفحة الملف، وفيها زر التحميل." })));
      else if (r.type === "youtube") nodes.push(el("p", { class: "qp-dl" }, el("a", { class: "qp-chip", href: "https://www.youtube.com/watch?v=" + r.id, target: "_blank", rel: "noopener" }, "افتح في يوتيوب")));
      else if (r.type === "audio" && r.src) nodes.push(el("p", { class: "qp-dl" }, el("a", { class: "qp-chip", href: r.src, download: "", target: "_blank", rel: "noopener" }, el("span", { html: IC.down }), "تنزيل")));
      return nodes;
    }

    function load(i, auto, fresh) {
      if (!queue.length) return;
      if (!P.alive) revive();
      if (auto) P.touched = true;
      i = ((i % queue.length) + queue.length) % queue.length;
      savePos(true);
      if (P.eng) { try { P.eng.destroy(); } catch {} P.eng = null; }
      P.i = i; P.resumed = !!fresh; P.lastSave = 0;
      const item = queue[i], r = item.rec, kind = engineFor(r);
      resume.hidden = true; err.hidden = true; note.hidden = true;
      paintHead(item); paintQueue();
      surface.replaceChildren(); surface.hidden = kind === "audio";
      const ctx = { autoplay: !!auto, changed: sync, ended: () => ended(), fail };
      const eng = ENGINES[kind](item, ctx, o);
      P.eng = eng;
      if (eng.el) surface.append(eng.el);
      if (kind === "shiavoice") {
        note.hidden = false;
        note.textContent = "مشغّل صوت الشيعة يُدار من داخله: اضغط ▶ فيه." + (queue.length > 1 ? " لا يخبرنا بانتهاء التسجيل، فاضغط «التالي» للانتقال." : "");
      }
      const ex = (o.extras && o.extras(item)) || defaultExtras(item);
      extras.replaceChildren(...[].concat(ex).filter(Boolean));
      setSession(item);
      eng.ready.then(() => {
        if (P.eng !== eng) return;
        try { eng.rate(P.speed); } catch {}
        if (auto && kind !== "shiavoice") Promise.resolve(eng.play()).catch(() => {});
        sync();
      }).catch(() => fail());
      o.onIndex && o.onIndex(i);
      sync();
    }
    const prev = () => {
      const e = P.eng;
      if (e && e.control && !(e.own && e.own()) && e.state().t > 5) { e.seek(0); return; }   // like any player: first back to the start
      load(P.i - 1, true);
    };
    const next = () => load(P.i + 1, true);
    bPrev.addEventListener("click", prev);
    bNext.addEventListener("click", next);
    bPrev.disabled = bNext.disabled = queue.length < 2;
    bPlay.addEventListener("click", () => { P.touched = true; if (!P.alive) { load(P.i, true); return; } const e = P.eng; if (!e) return; if (e.state().playing) e.pause(); else { setSession(queue[P.i]); Promise.resolve(e.play()).catch(() => fail()); } });
    bBack.addEventListener("click", () => { const e = P.eng; if (e) e.seek(Math.max(0, e.state().t - 10)); });
    bFwd.addEventListener("click", () => { const e = P.eng; if (e) e.seek(e.state().t + 10); });
    seek.addEventListener("input", () => { const e = P.eng; if (!e) return; const s = e.state(); if (isFinite(s.d)) e.seek(seek.value / 1000 * s.d); });
    bSpeed.addEventListener("click", () => {
      P.speed = SPEEDS[(SPEEDS.indexOf(P.speed) + 1) % SPEEDS.length];
      bSpeed.textContent = ar(P.speed) + "×"; bSpeed.setAttribute("aria-label", "السرعة " + ar(P.speed));
      try { P.eng && P.eng.rate(P.speed); } catch {}
    });
    const onHide = () => savePos(true);
    // A tap inside an embedded player (ShiaVoice) moves focus into its frame: the person started it.
    const onBlur = () => setTimeout(() => { const a = document.activeElement; if (a && a.tagName === "IFRAME" && rootEl.contains(a)) P.touched = true; }, 0);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    function revive() {
      if (current && current !== api) current.stop();
      P.alive = true; current = api;
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("blur", onBlur);
      rootEl.classList.remove("qp-idle");
    }

    const api = {
      el: rootEl, load, next, prev,
      get index() { return P.i; },
      busy() { if (!P.alive || !P.eng) return false; if (P.touched) return true; try { return !!P.eng.state().playing; } catch { return false; } },
      stop() {
        if (!P.alive) return;
        savePos(true); P.alive = false; P.touched = false;
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("blur", onBlur);
        if (P.eng) { try { P.eng.destroy(); } catch {} P.eng = null; }
        // Stopped because another recording started: this one waits, ▶ picks it up again.
        rootEl.classList.add("qp-idle");
        bPlay.disabled = false; bPlay.innerHTML = IC.play; bPlay.setAttribute("aria-label", "تشغيل");
        surface.replaceChildren(); seekRow.hidden = true;
        if ("mediaSession" in navigator) for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward", "seekto"]) { try { navigator.mediaSession.setActionHandler(a, null); } catch {} }
        if (current === api) current = null;
      }
    };
    current = api;
    load(o.index || 0, !!o.autoplay);
    return api;
  }
  function stop() { if (current) current.stop(); }
  const busy = () => !!(current && current.busy());

  /* ---------- favourites row and the list picker ---------- */
  function favRow(p, r) {
    const row = el("div", { class: "qp-fav" });
    const msg = el("span", { class: "qp-small", "aria-live": "polite" });
    const heart = el("button", { type: "button", class: "qp-chip" });
    const paint = () => { const on = inList("fav", r); heart.replaceChildren(el("span", { "aria-hidden": "true", text: on ? "♥ " : "♡ " }), on ? "في المفضلة" : "أضف إلى المفضلة"); heart.setAttribute("aria-pressed", String(on)); heart.classList.toggle("on", on); };
    heart.addEventListener("click", () => { if (inList("fav", r)) { removeFromList("fav", recKey(r)); msg.textContent = "أُزيلت من المفضلة."; } else { addToList("fav", p, r); msg.textContent = "أُضيفت إلى المفضلة."; } paint(); });
    paint();
    row.append(heart, el("button", { type: "button", class: "qp-chip", onclick: () => pickList(p, r, msg) }, el("span", { "aria-hidden": "true", text: "＋ " }), "أضف إلى قائمة"), msg);
    return row;
  }
  function pickList(p, r, msg) {
    const close = () => { sheet.remove(); document.removeEventListener("keydown", esc); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    const name = el("input", { type: "text", placeholder: "اسم قائمة جديدة، مثلاً: محرم ١٤٤٨", "aria-label": "اسم القائمة الجديدة" });
    const add = (L) => { const ok = addToList(L.id, p, r); msg.textContent = ok ? "أُضيفت إلى «" + L.name + "»." : "موجودة في «" + L.name + "» من قبل."; close(); };
    const sheet = el("div", { class: "qp-sheet", role: "dialog", "aria-modal": "true", "aria-label": "أضف إلى قائمة", onclick: (e) => { if (e.target === sheet) close(); } },
      el("div", { class: "qp-sheet-in" }, el("h2", { text: "أضف إلى قائمة" }),
        el("div", { class: "qp-lists" }, lists().map((L) => el("button", { type: "button", class: "qp-chip", onclick: () => add(L) }, (L.id === "fav" ? "♥ " : "") + L.name + " · " + ar(L.items.length)))),
        el("form", { class: "qp-newlist", onsubmit: (e) => { e.preventDefault(); if (!name.value.trim()) { name.focus(); return; } add(newList(name.value)); } },
          name, el("button", { type: "submit", class: "qp-chip primary" }, "أنشئ وأضف")),
        el("button", { type: "button", class: "qp-chip", onclick: close }, "إلغاء")));
    document.body.append(sheet); document.addEventListener("keydown", esc); name.focus();
  }

  root.QPlayer = { mount, stop, busy, describe, clock, toSec, prefs, setPref, favRow, pickList, listQueue,
    store: { lists, saveLists, inList, addToList, removeFromList, newList, deleteList, recKey } };
})(self);
