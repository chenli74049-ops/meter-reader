/* 网页版（iPhone Safari / 添加到主屏幕）用的麦克风语音识别和相机扫描。安卓 APK 里有 AndroidBridge 时不使用。 */
(function () {
  'use strict';
  const md = navigator.mediaDevices;
  const hasWasm = typeof WebAssembly === 'object' && typeof Worker === 'function';
  const call = (n, ...a) => { try { window[n] && window[n](...a); } catch (e) { console.error(e); } };

  // ================= 语音 =================
  let aw = null, aState = {s: 0, p: 0, e: ''}, reqId = 0;
  function asrWorker() {
    if (aw) return aw;
    aw = new Worker('lib/asr_worker.js');
    aw.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'progress') { aState = {s: 1, p: m.p, e: ''}; call('__asrModel', 1, m.p, ''); }
      else if (m.type === 'ready') { aState = {s: 2, p: 100, e: ''}; call('__asrModel', 2, 100, ''); }
      else if (m.type === 'error') { aState = {s: -1, p: 0, e: m.e}; aw.terminate(); aw = null; call('__asrModel', -1, 0, m.e); }
      else if (m.type === 'result') { window.__asrLastMs = m.ms; call('__asrResult', m.text); }
      else if (m.type === 'recerror') call('__asrError', '识别出错：' + m.e + '，请用数字键');
    };
    aw.onerror = e => { aState = {s: -1, p: 0, e: e.message || '语音组件加载失败'}; call('__asrModel', -1, 0, aState.e); };
    return aw;
  }
  let actx = null, stream = null, node = null, src = null, chunks = [], recOn = false, levelT = 0;
  // iOS：AudioContext 只能在 touchend/click 里解锁（pointerdown 不算），所以第一次点屏幕时就先建好
  function unlockAudio() {
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!actx) actx = new AC(); if (actx.state !== 'running') actx.resume(); } catch (e) {}
    if (actx && actx.state === 'running') ['touchend', 'click'].forEach(ev => document.removeEventListener(ev, unlockAudio, true));
  }
  ['touchend', 'click'].forEach(ev => document.addEventListener(ev, unlockAudio, true));
  async function start() {
    if (recOn) return;
    // AudioContext 必须在点击里创建/恢复（iOS）
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; actx = new AC(); }
    if (actx.state !== 'running') { try { await actx.resume(); } catch (e) {} }
    try { stream = await md.getUserMedia({audio: {channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true}, video: false}); }
    catch (e) { call('__asrError', e && e.name === 'NotAllowedError' ? '没有麦克风权限：请在 设置 → Safari → 麦克风 里允许，或点地址栏“aA”→网站设置→麦克风→允许' : '打不开麦克风：' + (e && e.message || e)); return; }
    chunks = []; recOn = true;
    src = actx.createMediaStreamSource(stream);
    node = actx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = ev => {
      if (!recOn) return; const d = ev.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
      let e = 0; for (let i = 0; i < d.length; i++) e += d[i] * d[i];
      const now = Date.now(); if (now - levelT > 150) { levelT = now; call('__asrLevel', Math.min(100, Math.sqrt(e / d.length) * 32768 / 60)); }
    };
    const mute = actx.createGain(); mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(actx.destination);
    call('__asrRec');
    clearTimeout(start._t); start._t = setTimeout(() => stop(), 60000); // 安全上限 60 秒
  }
  async function stop() {
    if (!recOn) return;
    clearTimeout(start._t);
    await new Promise(r => setTimeout(r, 350)); // 多录 0.35 秒，防止最后一个字被截掉
    recOn = false;
    try { src.disconnect(); node.disconnect(); } catch (e) {}
    try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    const sr = actx.sampleRate, n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n); let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; } chunks = [];
    if (n < sr / 4) { call('__asrResult', ''); return; }
    call('__asrBusy');
    const pcm = await resample(all, sr);
    asrWorker().postMessage({cmd: 'rec', id: ++reqId, pcm}, [pcm.buffer]);
  }
  async function resample(x, sr) {
    if (sr === 16000) return x;
    try {
      const len = Math.ceil(x.length * 16000 / sr), oc = new OfflineAudioContext(1, len, 16000), b = oc.createBuffer(1, x.length, sr);
      b.copyToChannel ? b.copyToChannel(x, 0) : b.getChannelData(0).set(x);
      const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
      const r = await oc.startRendering(); return new Float32Array(r.getChannelData(0));
    } catch (e) { // 兜底：均值抽取
      const ratio = sr / 16000, n = Math.floor(x.length / ratio), y = new Float32Array(n);
      for (let i = 0; i < n; i++) { const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)); let s = 0; for (let k = a; k < b; k++) s += x[k]; y[i] = s / (b - a); }
      return y;
    }
  }
  window.WebASR = {
    supported: () => !!(md && md.getUserMedia && hasWasm && window.isSecureContext),
    init: () => { if (aState.s === 0 || aState.s === -1) { aState = {s: 1, p: aState.p || 0, e: ''}; call('__asrModel', 1, aState.p, ''); asrWorker().postMessage({cmd: 'init'}); } },
    info: () => aState, start, stop,
    recognizePcm16k: pcm => asrWorker().postMessage({cmd: 'rec', id: ++reqId, pcm}), // 测试用
  };

  // ================= 扫描 =================
  let ow = null, oState = {s: 0, p: 0, e: ''}, oWait = {}, oId = 0;
  const MeterOCRRules = window.MeterOCR;
  function ocrWorker() {
    if (ow) return ow;
    ow = new Worker('lib/ocr_worker.js');
    ow.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'progress') { oState = {s: 1, p: m.p}; scanTip(); }
      else if (m.type === 'ready') { oState = {s: 2, p: 100}; scanTip(); }
      else if (m.type === 'error') { oState = {s: -1, p: 0, e: m.e}; ow.terminate(); ow = null; scanTip(); }
      else if (oWait[m.id]) { const w = oWait[m.id]; delete oWait[m.id]; w(m); }
    };
    return ow;
  }
  let sc = null; // 当前扫描界面
  function scanTip(t) {
    if (!sc) return; const el = sc.tip;
    if (t) { el.textContent = t; return; }
    if (oState.s === 1) el.textContent = '扫描准备中 ' + oState.p + '%（第一次要下载约 13MB）';
    else if (oState.s === -1) el.textContent = '扫描组件出错：' + oState.e;
    else if (oState.s === 2 && !sc.started) el.textContent = '把 5 位黑色读数对准黑框（不用管 H 和 m³），拿稳，会自动识别';
  }
  function beep() { try { const AC = window.AudioContext || window.webkitAudioContext; actx = actx || new AC(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 1200; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.15); } catch (e) {} }
  async function open(prev) {
    if (sc) return;
    const root = document.createElement('div'); root.className = 'scan';
    root.innerHTML = `<video playsinline muted autoplay></video><div class="sframe"></div><div class="stip"></div>
      <div class="scands hidden"></div>
      <div class="sbar"><button class="storch hidden">🔦 关手电</button><button class="sclose">✕ 关闭</button></div>`;
    document.body.appendChild(root);
    sc = {root, video: root.querySelector('video'), tip: root.querySelector('.stip'), frame: root.querySelector('.sframe'), prev, hist: [], seen: {}, k: 0, t0: Date.now(), done: false, started: false, torch: true, lastPick: null};
    const S = sc;
    // 实验：扫描界面打开时让 AudioContext 解锁（提示音）
    try { const AC = window.AudioContext || window.webkitAudioContext; actx = actx || new AC(); actx.resume(); } catch (e) {}
    root.querySelector('.sclose').onclick = () => close(null);
    ocrWorker().postMessage({cmd: 'init'}); scanTip();
    if (oState.s === 0) { oState = {s: 1, p: 0}; scanTip(); }
    try {
      S.stream = await md.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false});
    } catch (e) { scanTip(e && e.name === 'NotAllowedError' ? '没有相机权限：请在 设置 → Safari → 相机 里允许' : '打不开相机：' + (e && e.message || e)); return; }
    if (S.done) { S.stream.getTracks().forEach(t => t.stop()); return; }
    S.video.srcObject = S.stream; try { await S.video.play(); } catch (e) {}
    S.track = S.stream.getVideoTracks()[0];
    const caps = S.track.getCapabilities ? S.track.getCapabilities() : {};
    if (caps.torch) { const b = root.querySelector('.storch'); b.classList.remove('hidden'); const ap = () => { b.textContent = S.torch ? '🔦 关手电' : '🔦 开手电'; S.track.applyConstraints({advanced: [{torch: S.torch}]}).catch(() => {}); }; b.onclick = () => { S.torch = !S.torch; ap(); }; ap(); }
    S.candT = setInterval(() => cands(S), 1000);
    S.hintT = setInterval(() => { if (!S.done && oState.s === 2) scanTip('还没认出来：请靠近一点、对准黑框，打开手电，拿稳不动' + (S.lastPick ? '\n（看到的：' + S.lastPick + '）' : '')); }, 15000);
    loop(S);
  }
  function cropRect(S) { // 黑框在视频画面里的位置（视频是 object-fit: cover）
    const v = S.video, vw = v.videoWidth, vh = v.videoHeight, W = v.clientWidth, H = v.clientHeight;
    const f = S.frame.getBoundingClientRect(), r0 = v.getBoundingClientRect();
    const s = Math.max(W / vw, H / vh), ox = (vw * s - W) / 2, oy = (vh * s - H) / 2;
    const padX = f.width * 0.04, padY = f.height * 0.12;
    const l = Math.max(0, (f.left - r0.left - padX + ox) / s), t = Math.max(0, (f.top - r0.top - padY + oy) / s);
    const r = Math.min(vw, (f.right - r0.left + padX + ox) / s), b = Math.min(vh, (f.bottom - r0.top + padY + oy) / s);
    return {x: l, y: t, w: r - l, h: b - t};
  }
  async function loop(S) {
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', {willReadFrequently: true});
    while (!S.done) {
      if (oState.s !== 2 || !S.video.videoWidth) { await new Promise(r => setTimeout(r, 200)); if (oState.s === -1) return; continue; }
      if (!S.started) { S.started = true; scanTip(); }
      const t0 = Date.now(), r = cropRect(S); if (r.w < 20 || r.h < 10) { await new Promise(r => setTimeout(r, 200)); continue; }
      const k = Math.min(1, 640 / Math.max(r.w, r.h)); cv.width = Math.round(r.w * k); cv.height = Math.round(r.h * k);
      cx.drawImage(S.video, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height);
      const id = cx.getImageData(0, 0, cv.width, cv.height);
      const fid = ++oId, m = await new Promise(res => { oWait[fid] = res; ocrWorker().postMessage({cmd: 'frame', id: fid, img: {data: id.data, width: id.width, height: id.height}, k: S.k++, prev: S.prev}, [id.data.buffer]); });
      if (S.done) return;
      window.__scanLog = (window.__scanLog || []).concat([{best: m.best, ms: m.ms}]);
      onRead(S, m.type === 'frame' ? m.best : null);
      const wait = 350 - (Date.now() - t0); if (wait > 0) await new Promise(r => setTimeout(r, wait)); // 约 2–3 帧/秒
    }
  }
  function onRead(S, best) {
    S.hist.push(best || ''); while (S.hist.length > 5) S.hist.shift();
    if (best) { S.seen[best] = (S.seen[best] || 0) + 1; S.lastPick = best; }
    const n = best ? S.hist.filter(h => h === best).length : 0;
    if (best) scanTip('正在识别：' + best + '  ' + '●●●'.slice(0, Math.min(3, n)) + '○○○'.slice(0, Math.max(0, 3 - n)) + (MeterOCRRules.plausible(best, S.prev) ? '' : '\n（和上次读数对不上，继续对准）'));
    const win = MeterOCRRules.vote(S.hist);
    if (win && MeterOCRRules.plausible(win, S.prev)) close(win);
  }
  function cands(S) {
    if (S.done || Date.now() - S.t0 < 10000) return;
    const l = Object.entries(S.seen).sort((a, b) => b[1] - a[1]).slice(0, 3); if (!l.length) return;
    const box = S.root.querySelector('.scands'); box.classList.remove('hidden');
    box.innerHTML = '<span>认不准，点正确的：</span>' + l.map(([v]) => `<button data-v="${v}">${v}</button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => close(b.dataset.v));
  }
  function close(reading) {
    const S = sc; if (!S || S.done) return; S.done = true; sc = null;
    clearInterval(S.candT); clearInterval(S.hintT);
    try { S.track && S.torch && S.track.applyConstraints({advanced: [{torch: false}]}).catch(() => {}); } catch (e) {}
    try { S.stream && S.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    S.root.remove();
    oWait = {};
    if (reading) { try { navigator.vibrate && navigator.vibrate(80); } catch (e) {} beep(); call('__ocrResult', '[]', reading); }
    else call('__ocrResult', null);
  }
  window.WebScan = {supported: () => !!(md && md.getUserMedia && hasWasm && window.isSecureContext), open, close, preload: () => ocrWorker().postMessage({cmd: 'init'}), info: () => oState};
})();
