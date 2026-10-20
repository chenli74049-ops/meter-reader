/* 离线数字语音识别核心：Kaldi fbank(80) + LFR(7,6) + CMVN + Paraformer（onnxruntime）。浏览器 Worker 和 Node 测试共用 */
(function (G) {
  'use strict';
  const NFFT = 512, FL = 400, FS = 160, NB = 80, SR = 16000;
  let melW = null, win = null;
  function setup() {
    if (melW) return;
    win = new Float32Array(FL);
    for (let i = 0; i < FL; i++) win[i] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FL - 1)), 0.85);
    const mel = f => 1127 * Math.log(1 + f / 700), lo = mel(20), hi = mel(SR / 2 - 400), d = (hi - lo) / (NB + 1);
    melW = [];
    for (let b = 0; b < NB; b++) {
      const l = lo + b * d, c = l + d, r = c + d, w = new Float32Array(NFFT / 2); let s = -1, e = -1;
      for (let k = 0; k < NFFT / 2; k++) {
        const m = mel(k * SR / NFFT); let v = 0;
        if (m > l && m < r) v = m <= c ? (m - l) / (c - l) : (r - m) / (r - c);
        if (v > 0) { if (s < 0) s = k; e = k; } w[k] = v;
      }
      melW.push({s, e, w});
    }
  }
  // 原地 FFT（radix-2）
  const cosT = new Float64Array(NFFT / 2), sinT = new Float64Array(NFFT / 2);
  for (let i = 0; i < NFFT / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / NFFT); sinT[i] = -Math.sin(2 * Math.PI * i / NFFT); }
  function fft(re, im) {
    const n = NFFT;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const h = len >> 1, st = n / len;
      for (let i = 0; i < n; i += len) for (let k = 0; k < h; k++) {
        const wr = cosT[k * st], wi = sinT[k * st], a = i + k, b = a + h;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
  /** samples: Float32Array，取值范围 [-32768,32767]（paraformer 不归一化） */
  function fbank(x) {
    setup();
    const n = x.length, T = Math.floor((n + FS / 2) / FS), out = new Float32Array(T * NB);
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT), fr = new Float64Array(FL);
    for (let t = 0; t < T; t++) {
      const st = t * FS + FS / 2 - FL / 2;
      let mean = 0;
      for (let i = 0; i < FL; i++) { let k = st + i; while (k < 0 || k >= n) k = k < 0 ? -k - 1 : 2 * n - 1 - k; fr[i] = x[k]; mean += fr[i]; }
      mean /= FL;
      for (let i = 0; i < FL; i++) fr[i] -= mean;
      for (let i = FL - 1; i > 0; i--) fr[i] -= 0.97 * fr[i - 1];
      fr[0] -= 0.97 * fr[0];
      re.fill(0); im.fill(0);
      for (let i = 0; i < FL; i++) re[i] = fr[i] * win[i];
      fft(re, im);
      const p = new Float64Array(NFFT / 2);
      for (let k = 0; k < NFFT / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
      for (let b = 0; b < NB; b++) { const {s, e, w} = melW[b]; let v = 0; for (let k = s; k <= e; k++) v += w[k] * p[k]; out[t * NB + b] = Math.log(Math.max(v, 1.1920929e-07)); }
    }
    return {data: out, T};
  }
  function lfrCmvn(f, negMean, invStd, m = 7, s = 6) {
    const T = f.T, D = NB; if (T < m) return null;
    const N = Math.floor((T - m) / s) + 1, out = new Float32Array(N * D * m);
    for (let i = 0; i < N; i++) for (let j = 0; j < D * m; j++) { const v = f.data[i * s * D + j]; out[i * D * m + j] = (v + negMean[j]) * invStd[j]; }
    return {data: out, N, dim: D * m};
  }
  /** 音量太小时放大（最多 8 倍），和安卓版一致；输入 [-1,1] 浮点 */
  function gain(f) {
    const n = Math.min(f.length, 16000), stp = Math.max(1, Math.floor(f.length / n)), a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.abs(f[Math.min(f.length - 1, i * stp)]);
    a.sort(); const k = Math.max(0, Math.floor(n * 0.999) - 1), pk = a[k];
    const g = pk > 1e-4 ? Math.min(8, Math.max(1, 0.3 / pk)) : 1;
    const o = new Float32Array(f.length); for (let i = 0; i < f.length; i++) o[i] = Math.max(-1, Math.min(1, f[i] * g)) * 32768;
    return o;
  }
  function parseMeta(meta) {
    const nm = String(meta.neg_mean).split(',').map(Number), is = String(meta.inv_stddev).split(',').map(Number);
    return {negMean: Float32Array.from(nm), invStd: Float32Array.from(is), m: +meta.lfr_window_size || 7, s: +meta.lfr_window_shift || 6};
  }
  /** ort: onnxruntime 模块；sess: InferenceSession；cfg: parseMeta 结果；tokens: id→字符；pcm: [-1,1] 16k Float32Array */
  async function recognize(ort, sess, cfg, tokens, pcm) {
    const x = gain(pcm), f = fbank(x), l = lfrCmvn(f, cfg.negMean, cfg.invStd, cfg.m, cfg.s);
    if (!l) return '';
    const r = await sess.run({speech: new ort.Tensor('float32', l.data.slice(), [1, l.N, l.dim]), speech_lengths: new ort.Tensor('int32', Int32Array.from([l.N]), [1])});
    const lg = r.logits, [, L, V] = lg.dims, d = lg.data, tn = r.token_num ? Number(r.token_num.data[0]) : L;
    let txt = '';
    for (let i = 0; i < Math.min(L, tn); i++) {
      let bi = 0, bv = -Infinity; for (let k = 0; k < V; k++) { const v = d[i * V + k]; if (v > bv) { bv = v; bi = k; } }
      const t = tokens[bi]; if (t == null || t === '</s>' || t === '<s>' || t === '<blank>' || t === '<unk>') continue;
      txt += t.replace(/@@$/, '');
    }
    return txt;
  }
  function parseTokens(text) { const t = []; for (const line of text.split('\n')) { const p = line.trim().split(/\s+/); if (p.length === 2) t[+p[1]] = p[0]; } return t; }
  G.MeterASR = {fbank, lfrCmvn, recognize, parseTokens, parseMeta, gain};
})(typeof self !== 'undefined' ? self : globalThis);
