/* 语音识别 Worker：离线 Paraformer（只认 0-9 和 确定/确认/删除） */
importScripts('ort/ort.wasm.min.js', 'model_cache.js', 'asr_core.js');
let sess = null, cfg = null, tokens = null, initP = null;
function init() {
  if (initP) return initP;
  initP = (async () => {
    setupOrt();
    const [tt, meta] = await Promise.all([fetch('../models/asr_tokens.txt').then(r => r.text()), fetch('../models/asr_meta.json').then(r => r.json())]);
    tokens = MeterASR.parseTokens(tt); cfg = MeterASR.parseMeta(meta);
    const buf = await getModel('../models/asr_digits.int8.onnx', p => postMessage({type: 'progress', p: Math.round(p * 90)}));
    postMessage({type: 'progress', p: 92});
    sess = await ort.InferenceSession.create(buf, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
    // 预热一次，第一次识别更快
    try { await MeterASR.recognize(ort, sess, cfg, tokens, new Float32Array(16000)); } catch (e) {}
    postMessage({type: 'ready'});
  })().catch(e => { initP = null; postMessage({type: 'error', e: String(e && e.message || e)}); throw e; });
  return initP;
}
onmessage = async ev => {
  const m = ev.data;
  if (m.cmd === 'init') { init().catch(() => {}); return; }
  if (m.cmd === 'rec') {
    try { await init(); const t0 = Date.now(); const text = await MeterASR.recognize(ort, sess, cfg, tokens, m.pcm); postMessage({type: 'result', id: m.id, text, ms: Date.now() - t0}); }
    catch (e) { postMessage({type: 'recerror', id: m.id, e: String(e && e.message || e)}); }
  }
};
