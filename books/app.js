/* مكتبة الكتب — one catalogue of several libraries: browse by field, find a book by title, author or topic,
   open it (read, or download its PDF) at each library that has it, and search inside the books' text with
   «مكتبة مدرسة الفقاهة»'s own engine. */
(function () {
  "use strict";
  const B = window.QBooks, M = window.QMatch;
  const $ = (s, r) => (r || document).querySelector(s);
  const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  const num = (n) => ar(Number(n).toLocaleString("en-US").replace(/,/g, "٬"));
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const count = (n, w) => n === 1 ? w[0] : n === 2 ? w[1] : num(n) + " " + (n % 100 >= 3 && n % 100 <= 10 ? w[2] : w[3]);
  const W_BOOK = ["كتاب واحد", "كتابان", "كتب", "كتاباً"], W_VOL = ["جزء واحد", "جزءان", "أجزاء", "جزءاً"], W_FILE = ["ملف واحد", "ملفان", "ملفات", "ملفاً"];
  const status = (t, bad) => { const s = $("#status"); s.textContent = t || ""; s.classList.toggle("bad", !!bad); };
  const work = (t) => { $("#work").hidden = !t; $("#workT").textContent = t || ""; };
  const LS = "qasida.books.v1";
  const prefs = () => { try { return Object.assign({ allLangs: false }, JSON.parse(localStorage.getItem(LS)) || {}); } catch { return { allLangs: false }; } };
  const setPref = (k, v) => { const p = prefs(); p[k] = v; try { localStorage.setItem(LS, JSON.stringify(p)); } catch {} };
  const shown = (b) => prefs().allLangs || !b.lang || b.lang.startsWith("ar");
  const S = B.state;
  const SRC = { e: { short: "مدرسة الفقاهة", act: "اقرأه", cls: "e" }, a: { short: "مكتبة أهل البيت", act: "اقرأه", cls: "e" },
    f: { short: "شبكة الفكر", act: "حمّل PDF", cls: "f" }, s: { short: "كتب شيعية", act: "حمّل PDF", cls: "s" },
    h: { short: "الإمامين الحسنين", act: "اقرأه", cls: "f" }, i: { short: "العتبة الحسينية", act: "حمّل PDF", cls: "s" }, k: { short: "مكتبة الإمام الكاظم", act: "اقرأه", cls: "f" } };
  const srcOf = (k) => SRC[k] || { short: k, act: "افتحه", cls: "" };
  const diedText = (b) => b.died ? "ت " + ar(b.died) + " هـ" : "";

  /* ---------- routing: #q=… · #b=KEY · #c=N ---------- */
  const params = () => new URLSearchParams(location.hash.slice(1));
  function go(p) { const u = new URLSearchParams(p).toString(); if (location.hash.slice(1) === u) route(); else location.hash = u; }
  function route() {
    const p = params();
    if (p.get("q")) { $("#q").value = p.get("q"); return results(p.get("q")); }
    if (p.get("b")) return bookView(p.get("b"));
    if (p.get("c")) return fieldView(+p.get("c"), +(p.get("n") || 60));
    $("#q").value = "";
    home();
  }

  /* ---------- home ---------- */
  function home() {
    const v = $("#view"); v.replaceChildren(); status("");
    const counts = new Map();
    for (const b of S.books) if (shown(b)) counts.set(b.field, (counts.get(b.field) || 0) + 1);
    const grid = el("div", { class: "cats" });
    S.fields.forEach((name, i) => { if (counts.get(i)) grid.append(el("a", { class: "cat", href: "#c=" + i }, el("b", { text: name }), el("span", { text: count(counts.get(i), W_BOOK) }))); });
    const langs = el("label", { class: "check" }, el("input", { type: "checkbox", onchange: (e) => { setPref("allLangs", e.target.checked); home(); } }), "أظهر الكتب الفارسية والإنجليزية أيضاً");
    langs.firstChild.checked = prefs().allLangs;
    v.append(el("div", { class: "card" }, el("h2", { class: "sec", text: "تصفّح حسب العلم" }), grid, langs),
      el("div", { class: "card tips" }, el("h2", { class: "sec", text: "كيف تبحث" }),
        el("ul", {},
          el("li", {}, "اسم كتاب أو مؤلف أو موضوع: ", el("i", { text: "جواهر الكلام" }), " · ", el("i", { text: "الشيخ المفيد" }), " · ", el("i", { text: "المواريث" })),
          el("li", {}, "وللبحث داخل نصوص الكتب: اكتب الكلمات ثم «ابحث داخل نصوص الكتب»، فيبحث فيها محرك مكتبة مدرسة الفقاهة."),
          el("li", {}, "كل كتاب يظهر مرة واحدة ومعه كل المكتبات التي فيها: للقراءة أو لتنزيل ملفه."))));
    paintStats();
  }
  function paintStats() {
    const src = S.sources || {};
    const parts = Object.values(src).filter((s) => s.count).map((s) => num(s.count) + " من " + s.name);
    $("#stats").textContent = S.books.length ? "في الفهرس " + count(S.books.length, W_BOOK) + " من " + (parts.length === 1 ? "مكتبة واحدة" : ar(parts.length) + " مكتبات") +
      " (" + parts.join("، ") + "؛ الكتاب الموجود في أكثر من مكتبة يُحسب مرة)" + (S.catalog && S.catalog.updated ? " · آخر تحديث " + new Date(S.catalog.updated).toLocaleDateString("ar-IQ-u-nu-arab") : "") + "." : "";
  }

  /* ---------- a field ---------- */
  function fieldView(fi, n) {
    const v = $("#view"); v.replaceChildren(); status("");
    const list = S.books.filter((b) => b.field === fi && shown(b)).sort((a, b) => b.sources.length - a.sources.length || a.title.localeCompare(b.title, "ar"));
    v.append(el("a", { class: "back", href: "#" }, "→ كل العلوم"), el("h2", { class: "title", text: S.fields[fi] || "" }), el("p", { class: "muted small", text: count(list.length, W_BOOK) }));
    const ul = el("ul", { class: "books" });
    list.slice(0, n).forEach((b) => ul.append(bookRow(b)));
    v.append(ul);
    if (list.length > n) v.append(el("a", { class: "btn ghost more", href: "#c=" + fi + "&n=" + (n + 120) }, "عرض المزيد (" + num(list.length - n) + ")"));
  }
  function badges(b) { return el("span", { class: "srcs" }, b.sources.filter((s, i, a) => a.findIndex((x) => x.src === s.src) === i).map((s) => el("span", { class: "src " + srcOf(s.src).cls, text: srcOf(s.src).short }))); }
  function bookRow(b) {
    return el("li", {}, el("a", { class: "brow", href: "#b=" + b.key },
      el("b", { text: b.title }),
      el("span", { class: "muted small", text: [b.author, diedText(b)].filter(Boolean).join(" · ") }),
      badges(b)));
  }

  /* ---------- a book ---------- */
  function bookView(key) {
    const v = $("#view"); v.replaceChildren(); status("");
    const b = B.get(key);
    if (!b) { v.append(el("p", { class: "card", text: "لم أجد هذا الكتاب في الفهرس." })); return; }
    const eshia = b.sources.find((s) => s.src === "e");
    const vols = Math.max(0, ...b.sources.map((s) => s.vols || 0));
    // One row per library; a library holding the book in several files (volumes, editions) lists them inside.
    const where = el("ul", { class: "where" });
    const groups = new Map();
    for (const s of b.sources) { const g = groups.get(s.src); if (g) g.push(s); else groups.set(s.src, [s]); }
    let first = true;
    for (const [src, list] of groups) {
      const name = S.sources[src] ? S.sources[src].name : src, act = srcOf(src).act;
      list.sort((x, y) => (x.label || "").localeCompare(y.label || "", "ar", { numeric: true }) || x.id - y.id);
      const vols = Math.max(0, ...list.map((s) => s.vols || 0));
      const head = el("span", { class: "wh" }, el("b", { text: name }),
        list.length > 1 ? el("span", { class: "muted small", text: count(list.length, W_FILE) }) : vols > 1 ? el("span", { class: "muted small", text: count(vols, W_VOL) }) : null,
        list.length === 1 && list[0].label ? el("span", { class: "lbl", text: list[0].label }) : null);
      const li = el("li", {}, head, el("a", { class: "btn" + (first ? " primary" : ""), href: B.sourceUrl(list[0]), target: "_blank", rel: "noopener" }, act + " ↗"));
      first = false;
      where.append(li);
      if (list.length > 1) {
        const items = el("ol", { class: "files" }, list.map((s, k) => el("li", {}, el("a", { href: B.sourceUrl(s), target: "_blank", rel: "noopener" }, s.label && s.label !== b.title ? s.label : "الملف " + ar(k + 1)))));
        where.append(el("li", { class: "sub" }, el("details", {}, el("summary", {}, "كل ما في " + name + " (" + num(list.length) + ")"), items)));
      }
    }
    const inside = eshia ? el("form", { class: "inside", onsubmit: (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) window.open(B.textSearchUrl(q, eshia.id), "_blank", "noopener"); } },
      el("label", { class: "sec", for: "inq" }, "ابحث داخل هذا الكتاب"),
      el("div", { class: "search" }, el("input", { id: "inq", name: "q", type: "search", placeholder: "كلمات من نص الكتاب…", enterkeyhint: "search" }), el("button", { class: "go", type: "submit" }, "ابحث")),
      el("p", { class: "muted small", text: "يبحث في نص الكتاب كاملاً بمحرك مكتبة مدرسة الفقاهة، وتظهر النتائج هناك." })) : null;
    v.append(el("a", { class: "back", href: "javascript:history.back()" }, "→ رجوع"),
      el("article", { class: "card book" },
        el("h2", { class: "title", text: b.title }),
        el("dl", { class: "facts" },
          b.author ? [el("dt", {}, "المؤلف"), el("dd", {}, b.author + (b.died ? " (ت " + ar(b.died) + " هـ)" : ""))] : null,
          b.fullAuthor && M.compact(b.fullAuthor) !== M.compact(b.author) ? [el("dt", {}, "الاسم الكامل"), el("dd", {}, b.fullAuthor)] : null,
          el("dt", {}, "العلم"), el("dd", {}, S.fields[b.field] || "—"),
          b.topics ? [el("dt", {}, "مواضيعه"), el("dd", {}, b.topics)] : null,
          vols > 1 ? [el("dt", {}, "الأجزاء"), el("dd", {}, num(vols))] : null),
        el("h3", { class: "sec", text: "أين تجده" }), where, inside));
  }

  /* ---------- search ---------- */
  function results(q) {
    const v = $("#view"); v.replaceChildren();
    const found = B.search(q, shown);
    v.append(el("section", { class: "card inside-all" },
      el("h2", { class: "sec", text: "ابحث عن «" + q.slice(0, 40) + "» داخل نصوص الكتب" }),
      el("ul", { class: "engines" }, B.TEXT_ENGINES.map((e, i) => el("li", {},
        el("a", { class: "btn" + (i === 0 ? " primary" : ""), href: e.url(q), target: "_blank", rel: "noopener" }, e.name + " ↗"),
        el("span", { class: "muted small", text: e.note })))),
      el("p", { class: "muted small", text: "كل مكتبة تبحث بمحركها وتعرض النتائج عندها." })));
    if (!found.length) { status(""); v.append(el("p", { class: "card muted", text: "لا كتاب بهذا العنوان أو لهذا المؤلف في الفهرس." })); return; }
    status(count(found.length, W_BOOK) + " بهذا العنوان أو لهذا المؤلف أو في هذا الموضوع.");
    const ul = el("ul", { class: "books" });
    found.slice(0, 30).forEach((b) => ul.append(bookRow(b)));
    const sec = el("section", { class: "card" }, el("h2", { class: "sec", text: "الكتب (" + num(found.length) + ")" }), ul);
    if (found.length > 30) sec.append(el("button", { class: "btn ghost more", type: "button", onclick: (e) => { found.slice(30, 200).forEach((b) => ul.append(bookRow(b))); e.currentTarget.remove(); } }, "عرض المزيد"));
    v.prepend(sec);
  }

  /* ---------- wiring ---------- */
  $("#form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#q").value.trim(); if (!q) { $("#q").focus(); return; }
    $("#q").blur(); go({ q });
  });
  window.addEventListener("hashchange", route);
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("#installBtn").hidden = false; });
  $("#installBtn").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $("#installBtn").hidden = true; });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  (async () => {
    work("أجهّز المكتبة…");
    try { await B.load((t) => work(t)); }
    catch { work(null); status("فهرس الكتب الجديد يُجهَّز الآن ويصل خلال ساعة تقريباً. أعد فتح الصفحة بعدها.", true); return; }
    work(null);
    B.onChange(() => { paintStats(); if (!params().toString()) home(); });
    route();
  })();
})();
