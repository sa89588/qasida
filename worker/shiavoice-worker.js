// خادم بحث صغير لتطبيق «قارئ القصائد الحسينية».
// يقرأ صفحة البحث العامة في موقع صوت الشيعة ويعيد النتائج للتطبيق (العنوان، المنشد، المدة، المعرّف).
// لا يخزّن شيئاً، ولا ينقل الملفات الصوتية؛ التشغيل يتم بمشغّل صوت الشيعة الرسمي.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (url.pathname !== "/shiavoice") return new Response("qasida search: ok", { headers: cors });

    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    if (!q) return Response.json({ items: [] }, { headers: cors });

    const res = await fetch("https://shiavoice.com/search?q=" + encodeURIComponent(q), {
      headers: { "Accept-Language": "ar", "User-Agent": "Mozilla/5.0 (qasida-reader search)" },
      cf: { cacheTtl: 21600, cacheEverything: true }
    });
    if (!res.ok) return Response.json({ items: [], error: res.status }, { status: 502, headers: cors });
    const html = await res.text();

    const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const items = [], seen = new Set();
    const re = /<button[^>]*class="[^"]*play-track[^"]*"[^>]*>/g;
    let m;
    while ((m = re.exec(html)) && items.length < 24) {
      const tag = m[0];
      const attr = (n) => { const x = tag.match(new RegExp(n + '="([^"]*)"')); return x ? decode(x[1]) : ""; };
      const id = attr("data-uniqid");
      if (!/^[A-Za-z0-9]{3,12}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, title: attr("data-title"), artist: attr("data-artist"), duration: attr("data-duration") });
    }
    return Response.json({ items }, { headers: { ...cors, "Cache-Control": "public, max-age=3600" } });
  }
};
