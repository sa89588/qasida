import { parseCat } from "./crawl.mjs";
const html = `<html><head><title>الأيام الفاطمية 1448 هـ - الشيخ حسين الأكرف — صوت الشيعة</title></head><body>
<ol class="breadcrumb m-0"><li><a href="/">الرئيسية</a></li><li><a href="/letmiat">لطميات</a></li><li><a href="/cat-76">الشيخ حسين الأكرف</a></li></ol>
<div class="d-flex align-items-center border-bottom py-1 track-row">
  <button type="button" class="track-thumb play-track me-2" data-url="/stream-n5iiFQ" data-uniqid="n5iiFQ" data-title="لا ينكسر قلبك" data-artist="الشيخ حسين الأكرف" data-href="/play-n5iiFQ" data-duration="13:07" aria-label="استماع">
</div>
<div class="d-flex align-items-center border-bottom py-1 track-row">
  <button type="button" class="track-thumb play-track me-2" data-uniqid="TsS73" data-title="غضب رب العباد &amp; x" data-artist="باسم الكربلائي" data-duration="1:39:06">
</div>
<button type="button" class="play-cover-btn play-track" data-uniqid="SIDE1" data-title="sidebar">
<a class="page-link" href="/cat-13501/page-3">3</a>
</body></html>`;
const r = parseCat(html);
console.log(JSON.stringify(r));
if (r.section !== "letmiat" || r.parent !== "76" || r.rows.length !== 2 || r.rows[1].dur !== 5946 || r.lastPage !== 3 || r.title !== "الأيام الفاطمية 1448 هـ - الشيخ حسين الأكرف") { console.error("FAIL"); process.exit(1); }
console.log("PASS");
