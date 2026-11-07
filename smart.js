/* Smart recognition: Gemini reads a page photo or listens to a recording,
   then the YouTube Data API finds real recordings. Keys stay on this phone.
   Tuned for speed: fast "lite" models first, minimal thinking, no model listing
   unless every known model name fails, YouTube queries in parallel. */
(function (root) {
  "use strict";
  const M = root.QMatch;
  const LS_KEYS = "qasida.keys.v1";
  const LS_MODEL = "qasida.geminiModel.v2";
  const LS_NOTHINK = "qasida.noThinkingCfg.v1";
  const LS_YTCACHE = "qasida.ytCache.v1";
  const LS_MODE = "qasida.smartMode.v1";
  const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
  const FAST = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"];
  const SMART = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash"];

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  };
  function keys() { const k = ls.get(LS_KEYS, {}); return { gemini: (k.gemini || "").trim(), youtube: (k.youtube || "").trim() }; }
  function saveKeys(k) { return ls.set(LS_KEYS, { gemini: (k.gemini || "").trim(), youtube: (k.youtube || "").trim() }); }
  const ready = () => !!keys().gemini;
  const ytKey = () => keys().youtube || keys().gemini;
  const mode = () => ls.get(LS_MODE, "fast");
  const setMode = (m) => ls.set(LS_MODE, m === "accurate" ? "accurate" : "fast");

  class SmartError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

  async function fetchJSON(url, opts = {}, timeoutMs = 45000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const outer = opts.signal;
    if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener("abort", () => ctl.abort(), { once: true }); }
    let res;
    try { res = await fetch(url, { ...opts, signal: ctl.signal }); }
    catch { throw new SmartError(outer && outer.aborted ? "cancelled" : (navigator.onLine === false ? "offline" : "network")); }
    finally { clearTimeout(t); }
    let body = null; try { body = await res.json(); } catch {}
    if (!res.ok) {
      const msg = (body && body.error && (body.error.message || body.error.status)) || "";
      const reason = JSON.stringify((body && body.error) || "");
      if (res.status === 429 || /quota|RESOURCE_EXHAUSTED|rateLimit/i.test(reason)) throw new SmartError("quota", msg);
      if (/API_KEY_INVALID|API key not valid|keyInvalid/i.test(reason)) throw new SmartError("bad_key", msg);
      if (/location is not supported|User location/i.test(reason)) throw new SmartError("region", msg);
      if (res.status === 403) throw new SmartError("forbidden", msg);
      if (res.status === 404) throw new SmartError("not_found", msg);
      if (res.status === 400) throw new SmartError("bad_request", msg);
      throw new SmartError("http_" + res.status, msg);
    }
    return body;
  }

  /* ---------- Gemini ---------- */
  async function listModels(key) {
    try {
      const j = await fetchJSON(GEMINI + "/models?pageSize=200", { headers: { "x-goog-api-key": key } }, 12000);
      const names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => String(m.name || "").replace(/^models\//, ""))
        .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n) || /^gemini-flash(-lite)?-latest$/.test(n));
      const ver = (n) => { const m = n.match(/gemini-([\d.]+)/); return m ? parseFloat(m[1]) : 99; };
      const lite = mode() === "fast";
      return names.sort((a, b) => ((lite ? b.includes("lite") - a.includes("lite") : a.includes("lite") - b.includes("lite")) || (ver(b) - ver(a))));
    } catch (e) { if (e.code === "bad_key" || e.code === "region") throw e; return []; }
  }

  const COMMON = `
- الأبيات: بالترتيب وباللهجة والإملاء نفسيهما، بلا تشكيل زائد، وحتى 14 بيتاً فقط. كل بيت [الشطر الأول، الشطر الثاني]، والبيت ذو الشطر الواحد [النص، ""].
- إن عرفت هذه القصيدة يقيناً فاذكر عنوانها وشاعرها والرادود، وإلا فاتركها فارغة. لا تخمّن أسماء.
- refrain: البيت المتكرر (اللازمة أو الردة) إن وُجد.
- queries: عبارتان أو ثلاث للبحث في يوتيوب، كل عبارة من 3 إلى 7 كلمات من أوضح بيت أو من اللازمة أو العنوان، وأضف اسم الرادود إن عُرف.
أجب بكائن JSON واحد فقط بهذه المفاتيح:
{"is_poem":true,"title":"","title_printed":false,"poet":"","reciter":"","refrain":"","opening":"","subject":"","page":"","verses":[["",""]],"queries":[""],"confidence":"high|medium|low"}`;

  const PROMPT_IMAGE = `الصورة صفحة من كتاب أو ورقة فيها قصيدة حسينية (غالباً شعر شعبي عراقي، وقد تكون فصيحة). المطلوب التعرّف عليها بسرعة لتشغيل تسجيلها.
- انقل العنوان والشاعر والرادود إن كانت مطبوعة (الشاعر غالباً في حاشية أسفل الصفحة)، واجعل title_printed صحيحاً إن كان العنوان مطبوعاً.
- قد تكون الصفحة من وسط القصيدة بلا عنوان.
- تجاهل العلامات المائية وشعارات القنوات المتراكبة على الصورة.
- إن لم تكن في الصورة قصيدة فاجعل is_poem = false.` + COMMON;

  const PROMPT_AUDIO = `التسجيل الصوتي المرفق مقطع من قصيدة حسينية (لطمية أو نعي أو قصيدة)، وقد يكون بصوت رادود مع لطم وجمهور، أو شخص يقرأ أو يردد بيتاً منها، أو يقول اسمها.
- اكتب في verses الكلمات التي تسمعها بدقة.
- إن قال المتحدث عنوان القصيدة أو اسم الرادود أو الشاعر فضعها في حقولها.
- إن لم تسمع كلاماً مفهوماً أو لم يكن التسجيل قصيدة فاجعل is_poem = false.` + COMMON;

  function mediaPart(input) {
    if (input.kind === "image") return { inline_data: { mime_type: "image/jpeg", data: input.canvas.toDataURL("image/jpeg", 0.8).split(",")[1] } };
    return { inline_data: { mime_type: input.mime, data: input.b64 } };
  }

  async function identify(input, signal) {
    const key = keys().gemini;
    if (!key) throw new SmartError("no_key");
    const parts = [mediaPart(input), { text: input.kind === "image" ? PROMPT_IMAGE : PROMPT_AUDIO }];
    const cached = ls.get(LS_MODEL, null);
    const order = mode() === "fast" ? [...FAST, ...SMART] : [...SMART, ...FAST];
    let models = [...new Set([cached && cached.key === key.slice(-6) && cached.mode === mode() ? cached.model : null, ...order].filter(Boolean))];
    const noThink = ls.get(LS_NOTHINK, {});
    let listed = false, lastErr = null;
    for (let i = 0; i < models.length && i < 8; i++) {
      const model = models[i];
      const gen = { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 2048 };
      if (!noThink[model]) gen.thinkingConfig = { thinkingLevel: "minimal" };
      const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: gen });
      try {
        const j = await fetchJSON(GEMINI + "/models/" + encodeURIComponent(model) + ":generateContent", {
          method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body, signal
        }, 45000);
        const text = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        const data = parseLoose(text.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join(""));
        if (!data) { lastErr = new SmartError("bad_reply"); continue; }
        ls.set(LS_MODEL, { key: key.slice(-6), model, mode: mode() });
        return clean(data);
      } catch (e) {
        lastErr = e;
        if (["bad_key", "cancelled", "offline", "region"].includes(e.code)) throw e;
        if (e.code === "bad_request" && gen.thinkingConfig) { noThink[model] = 1; ls.set(LS_NOTHINK, noThink); i--; continue; } // retry same model without the thinking setting
        if (e.code === "not_found" && !listed && i === models.length - 1) {
          listed = true; models = [...models, ...(await listModels(key)).filter((m) => !models.includes(m))];
        }
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
    const verses = Array.isArray(d.verses) ? d.verses.filter(Array.isArray).slice(0, 40).map((v) => [str(v[0], 300), str(v[1], 300)]).filter((v) => v[0] || v[1]) : [];
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
    const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&relevanceLanguage=ar&q=" + encodeURIComponent(q) + "&key=" + encodeURIComponent(ytKey());
    const j = await fetchJSON(url, { signal }, 15000);
    const items = (j.items || []).filter((it) => it.id && it.id.videoId).map((it) => ({
      id: it.id.videoId, title: decodeEntities(it.snippet.title), channel: decodeEntities(it.snippet.channelTitle), desc: decodeEntities(it.snippet.description || "")
    }));
    const c2 = ls.get(LS_YTCACHE, {}); c2[ck] = { t: Date.now(), items };
    const ks = Object.keys(c2); if (ks.length > 80) for (const k of ks.slice(0, ks.length - 80)) delete c2[k];
    ls.set(LS_YTCACHE, c2);
    return items;
  }
  function rankVideo(v, info) {
    const hay = M.compact(v.title + " " + v.desc + " " + v.channel);
    const needles = [info.title, info.refrain, info.opening, ...(info.verses || []).slice(0, 8).map((x) => x[0] + " " + x[1])]
      .map((s) => M.compact(s).slice(0, 34)).filter((s) => s.length >= 8);
    let s = 0;
    for (const n of needles) s = Math.max(s, M.fuzzyContains(hay, n));
    const t = M.compact(info.title || "");
    if (t.length >= 5 && M.compact(v.title).includes(t)) s = Math.max(s, 0.95);
    const rec = M.poetKey(info.reciter || "");
    if (rec.length >= 4 && M.poetKey(v.title + " " + v.channel).includes(rec)) s += 0.1;
    return Math.min(s, 1.1);
  }
  /* opts.max: how many search calls at most (each costs 100 of the 10,000 daily units). */
  async function findVideos(info, signal, opts = {}) {
    if (!ytKey()) throw new SmartError("no_yt_key");
    const qs = [];
    if (info.title) qs.push([info.title, info.reciter || info.poet].filter(Boolean).join(" "));
    qs.push(...(info.queries || []));
    if (info.refrain) qs.push(info.refrain);
    const uniq = [...new Set(qs.map((q) => q.trim()).filter(Boolean))];
    const max = opts.max || 2;
    const seen = new Map();
    const add = (items) => { for (const v of items) if (!seen.has(v.id)) seen.set(v.id, { ...v, score: rankVideo(v, info) }); };
    // First batch in parallel for speed.
    const first = uniq.slice(0, max);
    const res = await Promise.allSettled(first.map((q) => ytSearch(q, signal)));
    for (const r of res) if (r.status === "fulfilled") add(r.value);
    if (!seen.size) { const err = res.find((r) => r.status === "rejected"); if (err) throw err.reason; }
    // One more only if nothing matched well.
    if (![...seen.values()].some((v) => v.score >= 0.7) && uniq[max] && !opts.noExtra) {
      try { add(await ytSearch(uniq[max], signal)); } catch {}
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

  root.QSmart = { keys, saveKeys, ready, hasYouTube: () => !!ytKey(), identify, findVideos, test, mode, setMode, SmartError };
})(self);
