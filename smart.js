/* Smart recognition: Gemini reads the page (even without a title or poet),
   then the YouTube Data API finds real recordings. Keys stay on this phone. */
(function (root) {
  "use strict";
  const M = root.QMatch;
  const LS_KEYS = "qasida.keys.v1";
  const LS_MODEL = "qasida.geminiModel.v1";
  const LS_YTCACHE = "qasida.ytCache.v1";
  const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
  const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  };

  function keys() { const k = ls.get(LS_KEYS, {}); return { gemini: (k.gemini || "").trim(), youtube: (k.youtube || "").trim() }; }
  function saveKeys(k) { return ls.set(LS_KEYS, { gemini: (k.gemini || "").trim(), youtube: (k.youtube || "").trim() }); }
  const ready = () => !!keys().gemini;
  const ytKey = () => keys().youtube || keys().gemini;

  class SmartError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

  async function fetchJSON(url, opts = {}, timeoutMs = 60000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    if (opts.signal) opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });
    let res;
    try { res = await fetch(url, { ...opts, signal: ctl.signal }); }
    catch (e) { throw new SmartError(opts.signal && opts.signal.aborted ? "cancelled" : (navigator.onLine === false ? "offline" : "network")); }
    finally { clearTimeout(t); }
    let body = null; try { body = await res.json(); } catch {}
    if (!res.ok) {
      const msg = body && body.error && (body.error.message || body.error.status) || "";
      const reason = JSON.stringify(body && body.error || "");
      if (res.status === 429 || /quota|RESOURCE_EXHAUSTED|rateLimit/i.test(reason)) throw new SmartError("quota", msg);
      if (/API_KEY_INVALID|API key not valid|keyInvalid/i.test(reason)) throw new SmartError("bad_key", msg);
      if (res.status === 403) throw new SmartError("forbidden", msg);
      if (res.status === 404) throw new SmartError("not_found", msg);
      if (/location is not supported|FAILED_PRECONDITION/i.test(reason)) throw new SmartError("region", msg);
      throw new SmartError("http_" + res.status, msg);
    }
    return body;
  }

  /* ---------- Gemini ---------- */
  async function modelCandidates(key) {
    const cached = ls.get(LS_MODEL, null);
    const list = [];
    if (cached && cached.key === key.slice(-6)) list.push(cached.model);
    try {
      const j = await fetchJSON(GEMINI + "/models?pageSize=200", { headers: { "x-goog-api-key": key } }, 15000);
      const names = (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => String(m.name || "").replace(/^models\//, ""))
        .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n) || n === "gemini-flash-latest");
      const ver = (n) => { const m = n.match(/gemini-([\d.]+)/); return m ? parseFloat(m[1]) : 99; };
      names.sort((a, b) => (a.includes("lite") - b.includes("lite")) || (ver(b) - ver(a)));
      list.push(...names);
    } catch (e) { if (e.code === "bad_key" || e.code === "region") throw e; }
    list.push(...FALLBACK_MODELS);
    return [...new Set(list)];
  }

  const PROMPT = `الصورة صفحة من كتاب أو ورقة فيها قصيدة حسينية (غالباً شعر شعبي عراقي، وقد تكون فصيحة). الهدف التعرّف على القصيدة لتشغيل تسجيلها بصوت الرادود.
1. انسخ الأبيات الظاهرة في الصفحة بالترتيب، بلهجتها وإملائها كما طُبعت، دون تشكيل زائد. كل بيت [الشطر الأيمن، الشطر الأيسر]، والبيت ذو الشطر الواحد [النص، ""].
2. العنوان والشاعر والرادود: إن كانت مطبوعة فانقلها (الشاعر يأتي غالباً في حاشية أسفل الصفحة مثل «للشاعر ...»).
3. إن كانت الصفحة من وسط القصيدة بلا عنوان: اذكر العنوان أو المطلع المشهور والشاعر والرادود فقط إن كنت تعرف هذه القصيدة يقيناً، وإلا اتركها فارغة. لا تخمّن أسماء.
4. refrain: البيت المتكرر (اللازمة أو الردة) إن ظهر.
5. queries: من 2 إلى 4 عبارات بحث في يوتيوب، كل عبارة من 3 إلى 7 كلمات مأخوذة من أوضح بيت أو من اللازمة أو العنوان، وأضف اسم الرادود إن عُرف.
6. تجاهل العلامات المائية وشعارات القنوات المتراكبة على الصورة.
أجب بكائن JSON واحد فقط بهذه المفاتيح:
{"is_poem":true,"title":"","title_printed":false,"poet":"","reciter":"","refrain":"","opening":"","subject":"","page":"","verses":[["",""]],"queries":[""],"confidence":"high|medium|low"}`;

  async function identify(canvas, signal) {
    const key = keys().gemini;
    if (!key) throw new SmartError("no_key");
    const b64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: b64 } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
    });
    const models = await modelCandidates(key);
    let lastErr = null;
    for (const model of models.slice(0, 5)) {
      try {
        const j = await fetchJSON(GEMINI + "/models/" + encodeURIComponent(model) + ":generateContent", {
          method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body, signal
        }, 90000);
        const text = ((j.candidates || [])[0]?.content?.parts || []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
        const data = parseLoose(text);
        if (!data) { lastErr = new SmartError("bad_reply"); continue; }
        ls.set(LS_MODEL, { key: key.slice(-6), model });
        return clean(data);
      } catch (e) {
        lastErr = e;
        if (["bad_key", "cancelled", "offline", "region"].includes(e.code)) throw e;
        // not_found / quota / forbidden on one model: try the next one
      }
    }
    throw lastErr || new SmartError("failed");
  }
  function parseLoose(t) {
    if (!t) return null;
    try { return JSON.parse(t); } catch {}
    const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
    return null;
  }
  const str = (v, n = 200) => String(v == null ? "" : v).trim().slice(0, n);
  function clean(d) {
    const verses = Array.isArray(d.verses) ? d.verses.filter(Array.isArray).slice(0, 80).map((v) => [str(v[0], 300), str(v[1], 300)]).filter((v) => v[0] || v[1]) : [];
    const queries = (Array.isArray(d.queries) ? d.queries : []).map((q) => str(q, 120)).filter(Boolean).slice(0, 4);
    return {
      is_poem: d.is_poem !== false, title: str(d.title, 120), title_printed: !!d.title_printed,
      poet: str(d.poet, 120), reciter: str(d.reciter, 80), refrain: str(d.refrain, 200), opening: str(d.opening, 200),
      subject: str(d.subject, 120), page: str(d.page, 10), verses, queries,
      confidence: /^(high|medium|low)$/.test(d.confidence) ? d.confidence : "low"
    };
  }

  /* ---------- YouTube ---------- */
  function decodeEntities(s) { const t = document.createElement("textarea"); t.innerHTML = s || ""; return t.value; }
  async function ytSearch(q, signal) {
    const cache = ls.get(LS_YTCACHE, {});
    const ck = M.compact(q);
    if (cache[ck] && Date.now() - cache[ck].t < 7 * 864e5) return cache[ck].items;
    const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&relevanceLanguage=ar&safeSearch=none&q=" + encodeURIComponent(q) + "&key=" + encodeURIComponent(ytKey());
    const j = await fetchJSON(url, { signal }, 20000);
    const items = (j.items || []).filter((it) => it.id && it.id.videoId).map((it) => ({
      id: it.id.videoId,
      title: decodeEntities(it.snippet.title),
      channel: decodeEntities(it.snippet.channelTitle),
      desc: decodeEntities(it.snippet.description || "")
    }));
    cache[ck] = { t: Date.now(), items };
    const keysArr = Object.keys(cache); if (keysArr.length > 60) for (const k of keysArr.slice(0, keysArr.length - 60)) delete cache[k];
    ls.set(LS_YTCACHE, cache);
    return items;
  }
  function rankVideo(v, info) {
    const hay = M.compact(v.title + " " + v.desc + " " + v.channel);
    const needles = [info.title, info.refrain, info.opening, ...(info.verses || []).slice(0, 8).map((x) => x[0] + " " + x[1])]
      .map((s) => M.compact(s).slice(0, 34)).filter((s) => s.length >= 8);
    let s = 0;
    for (const n of needles) s = Math.max(s, M.fuzzyContains(hay, n));
    if (info.title && M.compact(info.title).length >= 5 && M.compact(v.title).includes(M.compact(info.title))) s = Math.max(s, 0.95);
    const rec = M.poetKey(info.reciter || "");
    if (rec.length >= 4 && M.poetKey(v.title + " " + v.channel).includes(rec)) s += 0.1;
    return Math.min(s, 1.1);
  }
  async function findVideos(info, signal) {
    if (!ytKey()) throw new SmartError("no_yt_key");
    const qs = [];
    if (info.title) qs.push([info.title, info.reciter || info.poet].filter(Boolean).join(" "));
    qs.push(...info.queries);
    if (info.refrain) qs.push(info.refrain);
    const seen = new Map();
    let calls = 0;
    for (const q of [...new Set(qs.filter(Boolean))]) {
      if (calls >= 3) break;
      calls++;
      const items = await ytSearch(q, signal);
      for (const v of items) if (!seen.has(v.id)) seen.set(v.id, { ...v, score: rankVideo(v, info) });
      const good = [...seen.values()].filter((v) => v.score >= 0.7);
      if (good.length >= 3) break;
    }
    return [...seen.values()].sort((a, b) => b.score - a.score);
  }

  /* ---------- key test ---------- */
  async function test(k) {
    const out = { gemini: null, youtube: null };
    if (k.gemini) {
      try { const j = await fetchJSON(GEMINI + "/models?pageSize=5", { headers: { "x-goog-api-key": k.gemini } }, 15000); out.gemini = (j.models || []).length ? "ok" : "empty"; }
      catch (e) { out.gemini = e.code; }
    }
    const y = k.youtube || k.gemini;
    if (y) {
      try { await fetchJSON("https://www.googleapis.com/youtube/v3/videos?part=id&id=q0yBD7C9OSg&key=" + encodeURIComponent(y), {}, 15000); out.youtube = "ok"; }
      catch (e) { out.youtube = e.code; }
    }
    return out;
  }

  root.QSmart = { keys, saveKeys, ready, hasYouTube: () => !!ytKey(), identify, findVideos, test, SmartError };
})(self);
