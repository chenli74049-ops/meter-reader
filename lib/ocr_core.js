/* 离线水表读数识别核心：PP-OCRv3 检测 + 识别（onnxruntime），规则与安卓版 Pick.java / CaptureActivity 一致 */
(function (G) {
  'use strict';
  // ---- 图像预处理：输入 {data:RGBA Uint8ClampedArray, width, height} ----
  function gray(img) { const {data, width: w, height: h} = img, g = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g[i] = data[4 * i] * 0.299 + data[4 * i + 1] * 0.587 + data[4 * i + 2] * 0.114; return g; }
  /** 增强：灰度 + 拉伸对比度（忽略顶部 3% 反光）+ 锐化；inv 反色。返回 RGBA */
  function enhance(img, inv) {
    const w = img.width, h = img.height, g = gray(img), hs = new Uint32Array(256);
    for (const v of g) hs[Math.min(255, v | 0)]++;
    let lo = 0, hi = 255, acc = 0; const n = w * h;
    for (let i = 0; i < 256; i++) { acc += hs[i]; if (acc < n * 0.02) lo = i; if (acc < n * 0.97) hi = i; }
    if (hi <= lo + 10) hi = lo + 10;
    // 轻度模糊后反锐化
    const b = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) { s += g[yy * w + xx]; c++; } } b[y * w + x] = s / c; }
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { let v = 1.6 * g[i] - 0.6 * b[i]; v = (v - lo) * 255 / (hi - lo); if (inv) v = 255 - v; out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = v; out[4 * i + 3] = 255; }
    return {data: out, width: w, height: h};
  }
  function resize(img, W, H) { // 双线性
    const {data: s, width: w, height: h} = img, o = new Uint8ClampedArray(W * H * 4), sx = w / W, sy = h / H;
    for (let y = 0; y < H; y++) { const fy = Math.max(0, (y + 0.5) * sy - 0.5), y0 = Math.min(h - 1, fy | 0), y1 = Math.min(h - 1, y0 + 1), ay = fy - y0;
      for (let x = 0; x < W; x++) { const fx = Math.max(0, (x + 0.5) * sx - 0.5), x0 = Math.min(w - 1, fx | 0), x1 = Math.min(w - 1, x0 + 1), ax = fx - x0;
        for (let c = 0; c < 3; c++) { const v = (s[(y0 * w + x0) * 4 + c] * (1 - ax) + s[(y0 * w + x1) * 4 + c] * ax) * (1 - ay) + (s[(y1 * w + x0) * 4 + c] * (1 - ax) + s[(y1 * w + x1) * 4 + c] * ax) * ay; o[(y * W + x) * 4 + c] = v; }
        o[(y * W + x) * 4 + 3] = 255; } }
    return {data: o, width: W, height: H};
  }
  function crop(img, X, Y, W, H) { const o = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) o.set(img.data.subarray(((Y + y) * img.width + X) * 4, ((Y + y) * img.width + X + W) * 4), y * W * 4); return {data: o, width: W, height: H}; }
  /** 按旋转矩形取图（双线性），输出高度 48 的正向小图 */
  function warp(img, b) {
    const H = 48, W = Math.max(8, Math.min(1600, Math.ceil(H * b.w / Math.max(1, b.h)))), o = new Uint8ClampedArray(W * H * 4), {data: s, width: w, height: h} = img;
    const ux = Math.cos(b.th), uy = Math.sin(b.th), sx = b.w / W, sy = b.h / H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x + 0.5) * sx - b.w / 2, v = (y + 0.5) * sy - b.h / 2;
      const X = Math.min(w - 1.001, Math.max(0, b.cx + u * ux - v * uy - 0.5)), Y = Math.min(h - 1.001, Math.max(0, b.cy + u * uy + v * ux - 0.5));
      const x0 = X | 0, y0 = Y | 0, ax = X - x0, ay = Y - y0, i00 = (y0 * w + x0) * 4, i01 = i00 + 4, i10 = i00 + w * 4, i11 = i10 + 4;
      for (let c = 0; c < 3; c++) o[(y * W + x) * 4 + c] = (s[i00 + c] * (1 - ax) + s[i01 + c] * ax) * (1 - ay) + (s[i10 + c] * (1 - ax) + s[i11 + c] * ax) * ay;
      o[(y * W + x) * 4 + 3] = 255;
    }
    return {data: o, width: W, height: H};
  }
  // ---- 检测 ----
  async function detect(ort, sess, img) {
    const sc = (G.__detSide || 960) / Math.max(img.width, img.height);
    const W = Math.max(32, Math.round(img.width * sc / 32) * 32), H = Math.max(32, Math.round(img.height * sc / 32) * 32);
    const r = resize(img, W, H), t = new Float32Array(3 * W * H), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) t[c * W * H + i] = (r.data[i * 4 + (2 - c)] / 255 - mean[c]) / std[c]; // BGR
    const out = await sess.run({x: new ort.Tensor('float32', t, [1, 3, H, W])});
    const p = out[sess.outputNames[0]].data, bm = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (p[i] > 0.3) { bm[i] = 1; }
    const dil = new Uint8Array(W * H); // 2x2 膨胀
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bm[y * W + x] || (x > 0 && bm[y * W + x - 1]) || (y > 0 && bm[(y - 1) * W + x]) || (x > 0 && y > 0 && bm[(y - 1) * W + x - 1])) dil[y * W + x] = 1;
    const lab = new Int32Array(W * H), boxes = []; let id = 0; const st = [], fx = img.width / W, fy = img.height / H;
    for (let i = 0; i < W * H; i++) {
      if (!dil[i] || lab[i]) continue; id++; lab[i] = id; st.push(i);
      const px = []; let s = 0;
      while (st.length) { const k = st.pop(), x = k % W, y = (k / W) | 0; px.push(x, y); s += p[k];
        if (x > 0 && dil[k - 1] && !lab[k - 1]) { lab[k - 1] = id; st.push(k - 1); }
        if (x < W - 1 && dil[k + 1] && !lab[k + 1]) { lab[k + 1] = id; st.push(k + 1); }
        if (y > 0 && dil[k - W] && !lab[k - W]) { lab[k - W] = id; st.push(k - W); }
        if (y < H - 1 && dil[k + W] && !lab[k + W]) { lab[k + W] = id; st.push(k + W); } }
      const n = px.length / 2; if (n < 10 || s / n < 0.5) continue;
      // 主方向（PCA）→ 旋转矩形
      let mx = 0, my = 0; for (let j = 0; j < n; j++) { mx += px[2 * j] * fx; my += px[2 * j + 1] * fy; } mx /= n; my /= n;
      let sxx = 0, syy = 0, sxy = 0; for (let j = 0; j < n; j++) { const dx = px[2 * j] * fx - mx, dy = px[2 * j + 1] * fy - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      let th = 0.5 * Math.atan2(2 * sxy, sxx - syy); if (Math.abs(th) > Math.PI / 4 && sxx < syy) th = 0; // 竖排的不处理
      const ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (let j = 0; j < n; j++) { const dx = (px[2 * j] + 0.5) * fx - mx, dy = (px[2 * j + 1] + 0.5) * fy - my, u = dx * ux + dy * uy, v = dx * vx + dy * vy; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
      u0 -= fx / 2; u1 += fx / 2; v0 -= fy / 2; v1 += fy / 2;
      const bw = u1 - u0, bh = v1 - v0; if (Math.min(bw, bh) < 3 * Math.min(fx, fy)) continue;
      const d = bw * bh * 1.6 / (2 * (bw + bh)); u0 -= d; u1 += d; v0 -= d; v1 += d;
      const cx = mx + (u0 + u1) / 2 * ux + (v0 + v1) / 2 * vx, cy = my + (u0 + u1) / 2 * uy + (v0 + v1) / 2 * vy;
      const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [mx + u * ux + v * vx, my + u * uy + v * vy]);
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      boxes.push({cx, cy, w: u1 - u0, h: v1 - v0, th, x: Math.min(...xs), y: Math.min(...ys), bw: Math.max(...xs) - Math.min(...xs), bh: Math.max(...ys) - Math.min(...ys)});
    }
    return boxes;
  }
  // ---- 识别 ----
  async function recognize(ort, sess, keys, img) {
    const H = 48, rw = Math.max(8, Math.ceil(H * img.width / img.height)), W = Math.max(320, rw);
    const r = resize(img, Math.min(rw, 1600), H), t = new Float32Array(3 * H * W), rW = r.width;
    for (let y = 0; y < H; y++) for (let x = 0; x < rW; x++) for (let c = 0; c < 3; c++) t[c * H * W + y * W + x] = (r.data[(y * rW + x) * 4 + (2 - c)] / 255 - 0.5) / 0.5;
    const out = await sess.run({x: new ort.Tensor('float32', t, [1, 3, H, W])}), o = out[sess.outputNames[0]], [, T, C] = o.dims, d = o.data;
    let txt = '', last = 0, ps = 0, pn = 0;
    for (let i = 0; i < T; i++) { let bi = 0, bv = -1; for (let k = 0; k < C; k++) if (d[i * C + k] > bv) { bv = d[i * C + k]; bi = k; }
      if (bi !== 0 && bi !== last) { txt += bi - 1 < keys.length ? keys[bi - 1] : ' '; ps += bv; pn++; } last = bi; }
    return {t: txt, score: pn ? ps / pn : 0};
  }
  // ---- 规则（与 Pick.java 一致）----
  const FROM = 'OoDUIli|LTZzSsBGbgq', TO = '0001111117225586699', WANT = 5;
  function norm(t) {
    if (t == null || /[=\/:.,Qq]/.test(t)) return [];
    t = t.replace(/[mM]\S*$/, '').replace(/^[Hh]+/, '').trim();
    let dig = 0, len = 0; for (const c of t) { if (c !== ' ') len++; if (c >= '0' && c <= '9') dig++; }
    if (!dig || dig < 0.6 * len) return [];
    let o = ''; for (const c of t) { if (c >= '0' && c <= '9') o += c; else { const k = FROM.indexOf(c); o += k >= 0 ? TO[k] : ' '; } }
    return o.trim().split(/\s+/).filter(Boolean);
  }
  function pick(els, prev) {
    const toks = []; for (const e of els) for (const g of norm(e.t)) toks.push({g, h: +e.h || 0, x: +e.x || 0, y: +e.y || 0});
    toks.sort((a, b) => a.x - b.x);
    const rows = [];
    for (const t of toks) { const r = rows.find(r => { const m = Math.max(r.h, t.h); return Math.abs(r.y - t.y) < m * 0.6 && Math.abs(r.h - t.h) < m * 0.5; }); if (r) r.items.push(t); else rows.push({y: t.y, h: t.h, items: [t]}); }
    const sc = new Map(), pv = prev != null && /^\d+$/.test(String(prev)) ? +prev : null;
    for (const r of rows) {
      const s = r.items.map(t => t.g).join(''), h = r.h || 1; let c = null, v = 0;
      if (s.length === WANT) { c = s; v = h * 2; } else if (s.length > WANT) { c = s.slice(0, WANT); v = h * 0.8; }
      if (!c) continue;
      if (pv != null) { const x = +c; if (x >= pv && x - pv <= 300) v *= 2; else if (x < pv || x - pv > 2000) v *= 0.3; }
      if (!sc.has(c) || sc.get(c) < v) sc.set(c, v);
    }
    return [...sc.keys()].sort((a, b) => sc.get(b) - sc.get(a));
  }
  function plausible(s, prev) { if (!s || s.length !== WANT) return false; if (prev == null || !/^\d+$/.test(String(prev))) return true; const x = +s, p = +prev; return x >= p && x - p <= 2000; }
  /** 最近 5 帧投票：同一读数 ≥3 次，或逐位多数（每位 ≥3 票） */
  function vote(hist) {
    const cnt = {}; let valid = 0; for (const h of hist) if (h) { valid++; cnt[h] = (cnt[h] || 0) + 1; }
    for (const k in cnt) if (cnt[k] >= 3) return k;
    if (valid >= 3) { let s = ''; for (let i = 0; i < WANT; i++) { const v = new Array(10).fill(0); for (const h of hist) if (h && h.length === WANT) v[+h[i]]++; let bi = 0; for (let d = 1; d < 10; d++) if (v[d] > v[bi]) bi = d; if (v[bi] < 3) return null; s += bi; } return s; }
    return null;
  }
  /** 一帧：k 决定增强方式（原图/增强/反色 轮换） */
  async function readFrame(ort, det, rec, keys, img, k, prev) {
    const sc = Math.min(1, 640 / Math.max(img.width, img.height));
    let v = sc < 1 ? resize(img, Math.round(img.width * sc), Math.round(img.height * sc)) : img;
    if (k % 3 === 1) v = enhance(v, false); else if (k % 3 === 2) v = enhance(v, true);
    const boxes = await detect(ort, det, v), els = [];
    for (const b of boxes.slice(0, 12)) { const r = await recognize(ort, rec, keys, warp(v, b)); if (r.score >= 0.5 && r.t) els.push({t: r.t, x: b.x, y: b.y, w: b.bw, h: b.h}); }
    const c = pick(els, prev);
    return {best: c[0] || null, cands: c, els};
  }
  G.MeterOCR = {readFrame, warp, pick, plausible, vote, enhance, resize, crop, detect, recognize, norm};
})(typeof self !== 'undefined' ? self : globalThis);
