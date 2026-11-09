/* Page scanner, on the phone, no libraries:
   - detectPage(source): finds the page's four corners (a light page against a darker surround)
   - warpPage(source, quad): straightens it — perspective and tilt — into an upright rectangle
   - drawQuad(overlay, video, quad): outlines the detected page on the live camera view
   Used before reading the text, so the reader sees only the page, flat and upright. */
(function (root) {
  "use strict";
  const DET = 320;                                     // detection works on a small copy: fast enough for live video

  function smallGray(src, sw, sh) {
    const s = DET / Math.max(sw, sh), w = Math.max(8, Math.round(sw * s)), h = Math.max(8, Math.round(sh * s));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return { g, w, h, s };
  }
  function blur3(g, w, h) {                            // box blur: text strokes melt into the page
    const o = new Uint8Array(g.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; sum += g[yy * w + xx]; n++; } }
      o[y * w + x] = sum / n;
    }
    return o;
  }
  function otsu(g) {
    const hist = new Uint32Array(256); for (const v of g) hist[v]++;
    const total = g.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, t = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; t = i; }
    }
    return t;
  }
  const area = (q) => Math.abs(q.reduce((a, p, i) => { const n = q[(i + 1) % 4]; return a + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;

  /* → { quad: [tl, tr, br, bl] in source pixels, cover: page share of the frame } or null */
  function detectPage(src, sw, sh) {
    sw = sw || src.videoWidth || src.width; sh = sh || src.videoHeight || src.height;
    if (!sw || !sh) return null;
    const { g, w, h, s } = smallGray(src, sw, sh);
    const b = blur3(g, w, h), t = otsu(b);
    // the largest connected bright region
    const lab = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h);
    let bestN = 0, bestId = -1, id = 0;
    for (let i = 0; i < w * h; i++) {
      if (lab[i] !== -1 || b[i] <= t) continue;
      let sp = 0, n = 0; stack[sp++] = i; lab[i] = id;
      while (sp) {
        const k = stack[--sp]; n++;
        const x = k % w, y = (k / w) | 0;
        if (x > 0 && lab[k - 1] === -1 && b[k - 1] > t) { lab[k - 1] = id; stack[sp++] = k - 1; }
        if (x < w - 1 && lab[k + 1] === -1 && b[k + 1] > t) { lab[k + 1] = id; stack[sp++] = k + 1; }
        if (y > 0 && lab[k - w] === -1 && b[k - w] > t) { lab[k - w] = id; stack[sp++] = k - w; }
        if (y < h - 1 && lab[k + w] === -1 && b[k + w] > t) { lab[k + w] = id; stack[sp++] = k + w; }
      }
      if (n > bestN) { bestN = n; bestId = id; }
      id++;
    }
    if (bestId < 0 || bestN < w * h * 0.12) return null;
    // corners: the region's extreme points along the two diagonals
    let tl, tr, br, bl, mTL = Infinity, mBR = -Infinity, mTR = -Infinity, mBL = Infinity;
    for (let k = 0; k < w * h; k++) {
      if (lab[k] !== bestId) continue;
      const x = k % w, y = (k / w) | 0, sPlus = x + y, sMinus = x - y;
      if (sPlus < mTL) { mTL = sPlus; tl = [x, y]; }
      if (sPlus > mBR) { mBR = sPlus; br = [x, y]; }
      if (sMinus > mTR) { mTR = sMinus; tr = [x, y]; }
      if (sMinus < mBL) { mBL = sMinus; bl = [x, y]; }
    }
    const quad = [tl, tr, br, bl], A = area(quad), cover = A / (w * h);
    if (cover < 0.18) return null;                     // too small to be the page
    if (bestN / A < 0.72) return null;                  // not a solid four-sided shape (background clutter)
    // corners touching the frame edges on all sides: the page fills the photo — nothing to straighten
    // corners on the frame's edge: the page runs past the photo (or a shadow split it) — read the photo as it is
    const edge = (p) => p[0] <= 3 || p[1] <= 3 || p[0] >= w - 4 || p[1] >= h - 4;
    if (quad.filter(edge).length >= 2 || cover > 0.85) return { quad: null, cover };
    return { quad: quad.map(([x, y]) => [(x + 0.5) / s, (y + 0.5) / s]), cover };
  }

  /* Solve the homography that maps the output rectangle onto the page's quad (8×8 linear system). */
  function homography(srcPts, dstPts) {
    const A = [], bv = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = srcPts[i], [u, v] = dstPts[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bv.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bv.push(v);
    }
    for (let c = 0; c < 8; c++) {                      // Gaussian elimination with partial pivoting
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [bv[c], bv[p]] = [bv[p], bv[c]];
      for (let r = c + 1; r < 8; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; bv[r] -= f * bv[c]; }
    }
    const hv = new Array(8);
    for (let r = 7; r >= 0; r--) { let sum = bv[r]; for (let k = r + 1; k < 8; k++) sum -= A[r][k] * hv[k]; hv[r] = sum / A[r][r]; }
    return hv;
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /* The page, flat and upright. maxSide caps the output size. */
  function warpPage(src, quad, maxSide) {
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    const [tl, tr, br, bl] = quad;
    let W = Math.max(dist(tl, tr), dist(bl, br)), H = Math.max(dist(tl, bl), dist(tr, br));
    const k = Math.min(1, (maxSide || 1600) / Math.max(W, H)); W = Math.round(W * k); H = Math.round(H * k);
    const sc = document.createElement("canvas"); sc.width = sw; sc.height = sh;
    const sx = sc.getContext("2d", { willReadFrequently: true }); sx.drawImage(src, 0, 0, sw, sh);
    const sd = sx.getImageData(0, 0, sw, sh).data;
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const ox = out.getContext("2d"), od = ox.createImageData(W, H), o = od.data;
    const hm = homography([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], quad);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const den = hm[6] * x + hm[7] * y + 1, u = (hm[0] * x + hm[1] * y + hm[2]) / den, v = (hm[3] * x + hm[4] * y + hm[5]) / den;
        const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0, j = (y * W + x) * 4;
        if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = 255; continue; }
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        for (let c = 0; c < 3; c++) {
          const a = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx, b = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
          o[j + c] = a + (b - a) * fy;
        }
        o[j + 3] = 255;
      }
    }
    ox.putImageData(od, 0, 0);
    return out;
  }

  /* The page as the reader should see it: straightened when its edges were found, else the frame as it is. */
  function pageOf(src, maxSide) {
    const r = detectPage(src);
    if (!r || !r.quad) return { canvas: null, found: !!r, straightened: false };
    return { canvas: warpPage(src, r.quad, maxSide), found: true, straightened: true, quad: r.quad };
  }

  /* Outline the detected page on top of the live video (which is shown with object-fit: cover). */
  function drawQuad(overlay, video, quad, steady) {
    const cw = overlay.clientWidth, ch = overlay.clientHeight, dpr = Math.min(2, root.devicePixelRatio || 1);
    if (overlay.width !== Math.round(cw * dpr) || overlay.height !== Math.round(ch * dpr)) { overlay.width = Math.round(cw * dpr); overlay.height = Math.round(ch * dpr); }
    const x = overlay.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, cw, ch);
    if (!quad || !video.videoWidth) return;
    const vw = video.videoWidth, vh = video.videoHeight, k = Math.max(cw / vw, ch / vh), ox = (cw - vw * k) / 2, oy = (ch - vh * k) / 2;
    const pts = quad.map(([u, v]) => [ox + u * k, oy + v * k]);
    x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath();
    x.fillStyle = steady ? "rgba(46,160,103,.16)" : "rgba(212,174,98,.12)"; x.fill();
    x.lineWidth = 3; x.strokeStyle = steady ? "#2ea067" : "#d4ae62"; x.stroke();
    for (const [a, b] of pts) { x.beginPath(); x.arc(a, b, 6, 0, Math.PI * 2); x.fillStyle = steady ? "#2ea067" : "#d4ae62"; x.fill(); }
  }

  root.QScanner = { detectPage, warpPage, pageOf, drawQuad };
})(window);
