/* مكتبة الكتب — the books app: browse by field, find a book by title or author, and find pages by their words. */
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
  const W_BOOK = ["كتاب واحد", "كتابان", "كتب", "كتاباً"], W_BOOK_IN = ["كتاب واحد", "كتابين", "كتب", "كتاباً"], W_PAGE = ["صفحة واحدة", "صفحتان", "صفحات", "صفحة"], W_VOL = ["جزء واحد", "جزءان", "أجزاء", "جزءاً"];
  const status = (t, bad) => { const s = $("#status"); s.textContent = t || ""; s.classList.toggle("bad", !!bad); };
  const work = (t) => { $("#work").hidden = !t; $("#workT").textContent = t || ""; };
  const LS = "qasida.books.v1";
  const prefs = () => { try { return Object.assign({ allLangs: false }, JSON.parse(localStorage.getItem(LS)) || {}); } catch { return { allLangs: false }; } };
  const setPref = (k, v) => { const p = prefs(); p[k] = v; try { localStorage.setItem(LS, JSON.stringify(p)); } catch {} };
  const shown = (b) => prefs().allLangs || !b.lang || b.lang.startsWith("ar");
  const S = B.state;

  /* ---------- routing: #q=…&in=ID · #b=ID · #c=N ---------- */
  const params = () => new URLSearchParams(location.hash.slice(1));
  function go(p) { const u = new URLSearchParams(p).toString(); if (location.hash.slice(1) === u) route(); else location.hash = u; }
  let scope = null;   // a book to search inside
  function paintScope() {
    const s = $("#scope");
    const b = scope && S.byId.get(scope);
    s.hidden = !b;
    if (!b) return;
    s.replaceChildren(el("span", {}, "البحث داخل: ", el("b", { text: b.title })), el("button", { type: "button", class: "x", "aria-label": "ابحث في كل الكتب", onclick: () => { scope = null; paintScope(); $("#q").placeholder = "اسم كتاب، مؤلف، أو كلمات من داخل الكتب…"; } }, "×"));
    $("#q").placeholder = "كلمات من داخل هذا الكتاب…";
  }
  async function route() {
    const p = params(), v = $("#view");
    if (p.get("in")) scope = +p.get("in");
    paintScope();
    if (p.get("q")) { $("#q").value = p.get("q"); return results(p.get("q"), p.get("in") ? +p.get("in") : null); }
    if (p.get("b")) return bookView(+p.get("b"));
    if (p.get("c")) return categoryView(+p.get("c"), +(p.get("n") || 60));
    home();
  }

  /* ---------- home: the fields ---------- */
  function home() {
    const v = $("#view"); v.replaceChildren();
    status("");
    const counts = new Map();
    for (const b of S.books) if (shown(b)) counts.set(b.cat, (counts.get(b.cat) || 0) + 1);
    const grid = el("div", { class: "cats" });
    S.cats.forEach((name, i) => { if (counts.get(i)) grid.append(el("a", { class: "cat", href: "#c=" + i }, el("b", { text: name }), el("span", { text: count(counts.get(i), W_BOOK) }))); });
    if (counts.get(-1)) grid.append(el("a", { class: "cat", href: "#c=-1" }, el("b", { text: "غير مصنّفة" }), el("span", { text: count(counts.get(-1), W_BOOK) })));
    const langs = el("label", { class: "check" }, el("input", { type: "checkbox", onchange: (e) => { setPref("allLangs", e.target.checked); home(); } }), "أظهر الكتب الفارسية والإنجليزية أيضاً");
    langs.firstChild.checked = prefs().allLangs;
    v.append(el("div", { class: "card" }, el("h2", { class: "sec", text: "تصفّح حسب العلم" }), grid, langs),
      el("div", { class: "card tips" }, el("h2", { class: "sec", text: "كيف تبحث" }),
        el("ul", {},
          el("li", {}, "اسم كتاب أو مؤلف: ", el("i", { text: "جواهر الكلام" }), " · ", el("i", { text: "الشيخ الطوسي" })),
          el("li", {}, "كلمات من داخل الكتب، وكلما زادت الكلمات دقّت النتائج: ", el("i", { text: "لا صلاة إلا بطهور" })),
          el("li", {}, "من صفحة أي كتاب: «ابحث داخل هذا الكتاب»."))));
    paintStats();
  }
  function paintStats() {
    const known = S.books.filter((b) => b.lang).length, ar_ = known > S.books.length * 0.95 ? S.books.filter((b) => b.lang && b.lang.startsWith("ar")).length : 0;
    const indexed = new Set(S.vols.map((x) => x[0])).size;
    $("#stats").textContent = S.books.length ? "في الفهرس " + count(S.books.length, W_BOOK) + (ar_ ? " (منها " + num(ar_) + " بالعربية)" : "") +
      " · البحث في النصوص يشمل الآن " + count(indexed, W_BOOK) + " (" + count((S.index && S.index.docs) || 0, W_PAGE) + ")" + "، ويزداد كل يوم" +
      (S.index && S.index.updated ? " · آخر تحديث " + new Date(S.index.updated).toLocaleDateString("ar-IQ-u-nu-arab") : "") + "." : "";
  }

  /* ---------- a field ---------- */
  function categoryView(ci, n) {
    const v = $("#view"); v.replaceChildren();
    const list = S.books.filter((b) => b.cat === ci && shown(b)).sort((a, b) => a.title.localeCompare(b.title, "ar"));
    const name = ci === -1 ? "غير مصنّفة" : S.cats[ci] || "";
    v.append(el("a", { class: "back", href: "#" }, "→ كل العلوم"), el("h2", { class: "title", text: name }), el("p", { class: "muted small", text: count(list.length, W_BOOK) }));
    const ul = el("ul", { class: "books" });
    list.slice(0, n).forEach((b) => ul.append(bookRow(b)));
    v.append(ul);
    if (list.length > n) v.append(el("a", { class: "btn ghost more", href: "#c=" + ci + "&n=" + (n + 120) }, "عرض المزيد (" + num(list.length - n) + ")"));
    status("");
  }
  function bookRow(b, extra) {
    const cov = B.coverage(b.id);
    return el("li", {}, el("a", { class: "brow", href: "#b=" + b.id },
      el("b", { text: b.title }),
      el("span", { class: "muted small", text: [b.author, b.died ? "ت " + ar(b.died) + " هـ" : "", b.volumes > 1 ? count(b.volumes, W_VOL) : "", cov.pages ? "يُبحث في نصه" : ""].filter(Boolean).join(" · ") }),
      extra || null));
  }

  /* ---------- a book ---------- */
  function bookView(id) {
    const v = $("#view"); v.replaceChildren();
    const b = S.byId.get(id);
    if (!b) { v.append(el("p", { class: "card", text: "لم أجد هذا الكتاب في الفهرس." })); return; }
    const cov = B.coverage(id);
    const covText = !b.lang ? "لم تُقرأ بطاقة هذا الكتاب بعد؛ سيُفهرس قريباً." :
      !b.lang.startsWith("ar") ? "الكتاب " + (b.lang === "fa" ? "بالفارسية" : "بغير العربية") + "؛ البحث في نصوص الكتب العربية فقط، ويُبحث فيه بعنوانه ومؤلفه." :
      cov.pages ? "يُبحث في نصه: " + count(cov.pages, W_PAGE) + (b.volumes > 1 ? " من " + (cov.volumes.length >= b.volumes ? "كل أجزائه" : count(cov.volumes.length, W_VOL) + " من " + num(b.volumes)) : "") + "." :
      "لم تُفهرس صفحاته بعد؛ الفهرسة جارية بترتيب أهمية الكتب في الحوزة.";
    v.append(el("a", { class: "back", href: "javascript:history.back()" }, "→ رجوع"),
      el("article", { class: "card book" },
        el("h2", { class: "title", text: b.title }),
        b.fullTitle && M.compact(b.fullTitle) !== M.compact(b.title) ? el("p", { class: "full", text: b.fullTitle }) : null,
        el("dl", { class: "facts" },
          el("dt", {}, "المؤلف"), el("dd", {}, b.author + (b.died ? " (ت " + ar(b.died) + " هـ)" : "")),
          b.fullAuthor && M.compact(b.fullAuthor) !== M.compact(b.author) ? [el("dt", {}, "الاسم الكامل"), el("dd", {}, b.fullAuthor)] : null,
          el("dt", {}, "العلم"), el("dd", {}, [S.cats[b.cat], b.subject].filter(Boolean).join(" · ") || "—"),
          el("dt", {}, "الأجزاء"), el("dd", {}, num(b.volumes))),
        el("p", { class: "cov" + (cov.pages ? " ok" : ""), text: covText }),
        el("div", { class: "row" },
          el("a", { class: "btn primary", href: B.bookUrl(id), target: "_blank", rel: "noopener" }, "اقرأ الكتاب ↗"),
          cov.pages ? el("button", { class: "btn", type: "button", onclick: () => { scope = id; paintScope(); $("#q").value = ""; $("#q").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); } }, "ابحث داخل هذا الكتاب") : null),
        b.volumes > 1 ? el("details", { class: "vols" }, el("summary", {}, "الأجزاء"),
          el("div", { class: "chips" }, Array.from({ length: Math.min(b.volumes, 120) }, (_, k) => el("a", { class: "chip", href: B.pageUrl(id, k + 1, 1), target: "_blank", rel: "noopener" }, "ج " + ar(k + 1))))) : null));
    status("");
  }

  /* ---------- search ---------- */
  let seq = 0;
  async function results(q, inBook) {
    const my = ++seq;
    const v = $("#view"); v.replaceChildren();
    const titles = inBook ? [] : B.searchTitles(q, shown);
    if (titles.length) {
      const ul = el("ul", { class: "books" });
      titles.slice(0, 6).forEach((b) => ul.append(bookRow(b)));
      const sec = el("section", { class: "card" }, el("h2", { class: "sec", text: "كتب بهذا الاسم أو لهذا المؤلف (" + num(titles.length) + ")" }), ul);
      if (titles.length > 6) sec.append(el("button", { class: "btn ghost more", type: "button", onclick: (e) => { titles.slice(6, 60).forEach((b) => ul.append(bookRow(b))); e.currentTarget.remove(); } }, "عرض المزيد"));
      v.append(sec);
    }
    const box = el("section", { class: "card" }, el("h2", { class: "sec", text: inBook ? "في صفحات «" + (S.byId.get(inBook) || {}).title + "»" : "في نصوص الكتب" }));
    v.append(box);
    if (!S.index || !S.index.docs) { box.append(el("p", { class: "muted", text: "فهرسة نصوص الكتب بدأت للتو؛ يصل أول جزء منها خلال ساعات. البحث بالعناوين والمؤلفين يعمل الآن." })); return; }
    work("أبحث في صفحات الكتب…");
    let r;
    try { r = await B.searchText(q, { book: inBook }); }
    catch { work(null); if (my === seq) box.append(el("p", { class: "bad", text: "تعذّر البحث في النصوص الآن. تأكد من الاتصال وأعد المحاولة." })); return; }
    work(null);
    if (my !== seq) return;
    if (!r.words.length) { box.append(el("p", { class: "muted", text: "اكتب كلمات لها معنى (لا حروف الجر وحدها)." })); return; }
    if (r.common.length) box.append(el("p", { class: "muted small", text: "كلمة «" + r.common.join("» و«") + "» في أكثر الصفحات، فلا تضيّق البحث؛ أضف كلمات أخرى." }));
    if (!r.hits.length) { box.append(el("p", { class: "muted", text: r.common.length === r.words.length ? "الكلمات شائعة جداً. أضف كلمة أقل شيوعاً." : "لم أجد صفحة فيها هذه الكلمات في ما فُهرس حتى الآن." })); status(""); return; }
    if (r.mode === "most") box.append(el("p", { class: "warn small", text: "لا صفحة فيها كل الكلمات؛ هذه صفحات فيها أكثرها." }));
    status(count(r.total, W_PAGE) + " في " + count(r.hits.length, W_BOOK_IN) + ".");
    const ul = el("ul", { class: "hits" });
    const paint = (from, to) => r.hits.slice(from, to).forEach((g) => ul.append(hitRow(g, r.words.length)));
    paint(0, 25);
    box.append(ul);
    if (r.hits.length > 25) box.append(el("button", { class: "btn ghost more", type: "button", onclick: (e) => { paint(25, 200); e.currentTarget.remove(); } }, "كتب أخرى (" + num(r.hits.length - 25) + ")"));
  }
  function hitRow(g, nWords) {
    const b = S.byId.get(g.book) || { id: g.book, title: "كتاب " + g.book, author: "", volumes: 1 };
    const chips = el("div", { class: "chips" });
    const many = b.volumes > 1 || g.pages.some((p) => p.vol > 1);
    const add = (from, to) => g.pages.slice(from, to).forEach((p) => chips.append(el("a", { class: "chip" + (p.n < nWords ? " part" : ""), href: B.pageUrl(g.book, p.vol, p.page), target: "_blank", rel: "noopener",
      "aria-label": "افتح " + b.title + (many ? " الجزء " + p.vol : "") + " صفحة " + p.page }, (many ? "ج" + ar(p.vol) + " " : "") + "ص" + ar(p.page))));
    add(0, 8);
    if (g.pages.length > 8) chips.append(el("button", { class: "chip more", type: "button", onclick: (e) => { e.currentTarget.remove(); add(8, 80); } }, "+" + num(g.pages.length - 8)));
    return el("li", { class: "hit" },
      el("a", { class: "hbook", href: "#b=" + g.book }, el("b", { text: b.title }), el("span", { class: "muted small", text: [b.author, b.died ? "ت " + ar(b.died) + " هـ" : "", count(g.pages.length, W_PAGE)].filter(Boolean).join(" · ") })),
      chips);
  }

  /* ---------- wiring ---------- */
  $("#form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#q").value.trim(); if (!q) { $("#q").focus(); return; }
    $("#q").blur();
    go(scope ? { q, in: scope } : { q });
  });
  window.addEventListener("hashchange", route);
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("#installBtn").hidden = false; });
  $("#installBtn").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $("#installBtn").hidden = true; });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  (async () => {
    work("أجهّز المكتبة…");
    try { await B.load((t) => work(t)); }
    catch { work(null); status("تعذّر تنزيل فهرس الكتب. تأكد من الاتصال ثم أعد فتح الصفحة.", true); return; }
    work(null);
    B.onChange(() => { paintStats(); if (!params().toString()) home(); });
    route();
  })();
})();
