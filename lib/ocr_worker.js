/* 扫描识别 Worker：PP-OCRv3 检测+识别，离线 */
importScripts('ort/ort.wasm.min.js', 'model_cache.js', 'ocr_core.js');
let det = null, rec = null, keys = null, initP = null;
function init() {
  if (initP) return initP;
  initP = (async () => {
    setupOrt();
    keys = await fetch('../models/ocr_keys.json').then(r => r.json());
    let a = 0, b = 0; const up = () => postMessage({type: 'progress', p: Math.round((a * 2.4 + b * 10.7) / 13.1 * 90)});
    const [d, r] = await Promise.all([getModel('../models/ocr_det.onnx', p => { a = p; up(); }), getModel('../models/ocr_rec.onnx', p => { b = p; up(); })]);
    det = await ort.InferenceSession.create(d, {executionProviders: ['wasm']});
    rec = await ort.InferenceSession.create(r, {executionProviders: ['wasm']});
    postMessage({type: 'ready'});
  })().catch(e => { initP = null; postMessage({type: 'error', e: String(e && e.message || e)}); throw e; });
  return initP;
}
onmessage = async ev => {
  const m = ev.data;
  if (m.cmd === 'init') { init().catch(() => {}); return; }
  if (m.cmd === 'frame') {
    try { await init(); const t0 = Date.now(); const r = await MeterOCR.readFrame(ort, det, rec, keys, m.img, m.k, m.prev);
      postMessage({type: 'frame', id: m.id, best: r.best, cands: r.cands.slice(0, 5), els: r.els, ms: Date.now() - t0}); }
    catch (e) { postMessage({type: 'frameerror', id: m.id, e: String(e && e.message || e)}); }
  }
};
