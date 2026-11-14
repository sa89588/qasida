/* Telegram, through the public web previews of channels (t.me/s/<channel>) — only channels that show their posts
   on the web; files stay in Telegram and the app opens the post there.
   Two things are collected:
   - files (PDF and other documents) posted in book channels: their name, size and the post's first line;
   - Hawza lesson channels listed by directory channels («قنوات الدروس الحوزوية»…): the channel's username and the
     line that describes it («شرح المكاسب المحرمة | الشيخ …»), so a book's page can show lessons on that book.
   Each channel is read from its newest post back to its first, a part each run; later runs add only new posts. */
import { plain, unent } from "./eshia.mjs";

export const CHANNELS = [
  // links: it lists other channels (lessons, libraries); files: it posts books and papers.
  { ch: "Qa_droos", name: "قنوات الدروس الحوزوية", links: true, files: true },
  { ch: "dfrbkyedhlhcvjmvf", name: "مدينة العلم للقنوات الحوزوية", links: true, files: true },
  { ch: "bhbgcx", name: "الدروس الحوزوية في النجف الأشرف", links: true, files: true },
  { ch: "Qa_elmrejal", name: "قنوات الحديث والرجال", links: true, files: true },
  { ch: "Shia_Telegram_1", name: "تليكرام الشيعة", links: true, files: true },
  { ch: "storebooka", name: "مكتبات", links: true },
  { ch: "fawaedhawza", name: "فوائد حوزوية", files: true },
  { ch: "KutupNahwia", name: "مكتبة كنوز لغوية", files: true },
  { ch: "Karbala_Center", name: "مركز كربلاء للدراسات والبحوث", files: true },
  { ch: "kashkool_mb", name: "كشكول حوزوي", links: true, files: true }
];
/* Book libraries on Telegram. Most show no posts on the web, so only their page (name, members, description)
   is read; the app opens them in Telegram. */
export const LIBRARY_CHANNELS = [
  { u: "Books_Links", name: "النجف مكتبتي", note: "مكتبة رقمية متعددة الاختصاصات" },
  { u: "ktoobh", name: "مكتبة الإمامية", note: "كتب شيعية" },
  { u: "MishrefAqidah", name: "مكتبة العقيدة والمذاهب والأديان", note: "آلاف الكتب العقدية في مكان واحد" },
  { u: "Alhydry3", name: "كتب السيد كمال الحيدري", note: "" },
  { u: "kashkool_mb", name: "كشكول حوزوي", note: "فوائد حوزوية متفرقة" },
  { u: "bhbgcx", name: "الدروس الحوزوية في النجف الأشرف", note: "" },
  { u: "storebooka", name: "مكتبات", note: "دليل قنوات المكتبات" },
  { u: "fawaedhawza", name: "فوائد حوزوية", note: "" },
  { u: "KutupNahwia", name: "مكتبة كنوز لغوية", note: "" },
  { u: "Mak_altalib", name: "مكتبة الطالب الحوزوي", note: "" },
  { u: "alfekerpdf", name: "كتب مكتبة الفكر", note: "" },
  { u: "Karbala_Center", name: "مركز كربلاء للدراسات والبحوث", note: "" }
];
const SKIP_USER = /^(s|share|joinchat|addlist|iv|proxy|socks|c|addstickers|setlanguage|boost)$|bot$/i;

const toText = (html) => unent(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
  const t = plain(inner); return /^https?:\/\//.test(t) ? " " + href + " " : t + " " + href + " ";
}).replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ");
const tidy = (s) => String(s).replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍•▪️◾️♦️🔸🔹⬅️➡️👇]+/gu, " ").replace(/[*_#]+/g, " ").replace(/\s+/g, " ").replace(/^[\s:：\-–|•.]+|[\s:：\-–|•.]+$/g, "").trim();

/* One page of a channel's web preview → posts { id, text, docs: [{title, size}], links: [username] } */
export function parsePreview(html, ch) {
  const out = [];
  for (const part of String(html).split('<div class="tgme_widget_message_wrap').slice(1)) {
    const id = +((part.match(/data-post="[^"/]+\/(\d+)"/) || [])[1] || 0);
    if (!id) continue;
    const docs = [...part.matchAll(/tgme_widget_message_document_title[^>]*>([^<]*)<[\s\S]*?tgme_widget_message_document_extra[^>]*>([^<]*)</g)].map((m) => ({ title: unent(m[1]).trim(), size: unent(m[2]).trim() }));
    const tm = part.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text = tm ? toText(tm[1]) : "";
    out.push({ id, ch, text, docs });
  }
  return out;
}

/* A file's name as a title: «بين_المناهج_الحوزوية.pdf» → «بين المناهج الحوزوية». */
export function fileTitle(name, caption) {
  let t = String(name).replace(/\.(pdf|docx?|epub|rar|zip|djvu|txt|ppt|pptx)$/i, "").replace(/^(Noor[-_ ]?Book[-_ ]?com[-_ ]?\d*[-_ ]?|kotobati[-_ ]?)/i, "")
    .replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  const arabic = (s) => (s.match(/[؀-ۿ]/g) || []).length;
  const cap = tidy(String(caption || "").split("\n").map((l) => l.trim()).find((l) => arabic(l) >= 4) || "").replace(/https?:\/\/\S+/g, "").trim();
  if (arabic(t) < 4 && cap) t = cap;
  return t.slice(0, 160);
}

const GENERIC = /(رابط القناة|رابط قناة|الرابط|رابط|لینک دسترسی|لينك|تابعونا|للاشتراك|اشترك|انضم|للانضمام|اضغط هنا|القناة)\s*[:：]?/g;
const strip = (l) => l.replace(/(https?:\/\/)?t\.me\/\S+|https?:\/\/\S+/g, " ").replace(/@\w+/g, " ").replace(GENERIC, " ");
/* Lesson channels named in a post: each t.me/<username> with the line that describes it. */
export function lessonLinks(post) {
  const out = [];
  const lines = post.text.split("\n").map((l) => l.trim());
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/https?:\/\/t\.me\/([A-Za-z0-9_]{5,32})(?![A-Za-z0-9_/])/g)) {
      const u = m[1];
      if (SKIP_USER.test(u) || u.toLowerCase() === post.ch.toLowerCase()) continue;
      let d = tidy(strip(line));
      for (let k = i - 1; (d.match(/[؀-ۿ]/g) || []).length < 10 && k >= 0 && k >= i - 3; k--) {
        const prev = tidy(strip(lines[k]));
        if (prev && !/t\.me\//.test(lines[k])) d = (prev + " " + d).trim();
      }
      if ((d.match(/[؀-ۿ]/g) || []).length >= 6) out.push({ u, d: d.slice(0, 150), ch: post.ch, post: post.id });
    }
  });
  return out;
}

/* A channel's own page: its name, members, description; null when there is no such public channel. */
export function parseChannelPage(html) {
  const title = unent((html.match(/<div class="tgme_page_title"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
  if (!title) return null;
  const extra = plain((html.match(/<div class="tgme_page_extra">([\s\S]*?)<\/div>/) || [])[1] || "");
  const about = plain((html.match(/<div class="tgme_page_description[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
  const m = extra.match(/([\d.,\s]+[KMk]?)\s*(subscribers?|members?)/);
  const kind = /members?/.test(extra) && !/subscribers?/.test(extra) ? "group" : /subscribers?/.test(extra) ? "channel" : "user";
  return { title, about: about.replace(/\s+/g, " "), members: m ? m[1].replace(/\s+/g, "") : "", kind };
}

/* Read the channels (newest first, then further back each run). state: { channels: {ch: {top, bottom, done}}, files: [], lessons: {} } */
export async function telegram(get, log, state, budget) {
  state.channels = state.channels || {}; state.files = state.files || []; state.lessons = state.lessons || {};
  const haveFile = new Set(state.files.map((f) => f.ch + "/" + f.post));
  const take = (posts, chan) => {
    for (const p of posts) {
      if (chan.files) for (const d of p.docs) {
        const key = p.ch + "/" + p.id;
        if (haveFile.has(key)) continue;
        haveFile.add(key);
        const title = fileTitle(d.title, p.text);
        if ((title.match(/[\u0600-\u06ff]/g) || []).length >= 4) state.files.push({ ch: p.ch, post: p.id, title, size: d.size, file: d.title.slice(0, 120) });
      }
      if (chan.links) for (const l of lessonLinks(p)) {
        const cur = state.lessons[l.u.toLowerCase()];
        if (!cur || (cur.d.length < 25 && l.d.length > cur.d.length)) state.lessons[l.u.toLowerCase()] = l;
      }
    }
  };
  let requests = 0;
  for (const chan of CHANNELS) {
    const { ch } = chan;
    const st = state.channels[ch] || (state.channels[ch] = { top: 0, bottom: 0, done: false });
    // New posts since the last run (the first run reads only the newest page here, then goes back below).
    let before = 0, newest = st.top, pages = 0;
    for (;;) {
      if (requests >= budget) break;
      const h = await get(`https://t.me/s/${ch}` + (before ? `?before=${before}` : "")); requests++; pages++;
      const posts = h ? parsePreview(h, ch) : [];
      if (!posts.length) { log("telegram", ch, h ? "shows no posts" : "not readable"); break; }
      take(posts.filter((p) => p.id > st.top), chan);
      const low = Math.min(...posts.map((p) => p.id));
      newest = Math.max(newest, ...posts.map((p) => p.id));
      if (!st.top) { st.bottom = low; break; }
      if (low <= st.top + 1 || pages >= 40) break;
      before = low;
    }
    st.top = newest;
    // Further back, where the last run stopped.
    while (!st.done && requests < budget && st.bottom > 1) {
      const h = await get(`https://t.me/s/${ch}?before=${st.bottom}`); requests++;
      const posts = h ? parsePreview(h, ch) : [];
      if (!posts.length) { st.done = !!h; break; }
      take(posts, chan);
      const low = Math.min(...posts.map((p) => p.id));
      if (low >= st.bottom) { st.done = true; break; }
      st.bottom = low;
    }
    if (st.bottom <= 1) st.done = true;
  }
  // The book libraries' own pages: name, members, description (every run; a dozen requests).
  state.libs = state.libs || {};
  for (const c of LIBRARY_CHANNELS) {
    const h = await get("https://t.me/" + c.u);
    const page = h ? parseChannelPage(h) : null;
    if (page) state.libs[c.u] = { t: page.title.slice(0, 100), n: page.members, x: page.about.slice(0, 200) };
  }
  // Each listed channel's own name and size, from its public page (t.me/<username>), a part each run.
  let resolved = 0;
  const RESOLVE = Math.max(0, budget - requests + 600);
  for (const l of Object.values(state.lessons)) {
    if (resolved >= RESOLVE) break;
    if (l.r) continue;
    const h = await get("https://t.me/" + l.u); resolved++;
    if (!h) continue;
    const page = parseChannelPage(h);
    l.r = Date.now();
    if (!page) { l.dead = true; continue; }
    l.t = page.title.slice(0, 100); l.n = page.members; l.x = page.about.slice(0, 160); l.kind = page.kind;
  }
  if (resolved) log("telegram: channel pages read", resolved, "| still to read", Object.values(state.lessons).filter((l) => !l.r).length);
  log("telegram: requests", requests, "| files", state.files.length, "| lesson channels", Object.keys(state.lessons).length,
    "| channels done", Object.values(state.channels).filter((c) => c.done).length + "/" + CHANNELS.length);
}
