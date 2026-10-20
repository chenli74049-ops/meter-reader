/* 模型下载（带进度）并存入 Cache Storage，之后离线可用 */
self.MODEL_SIZES = {'../models/asr_digits.int8.onnx': 81862195, '../models/ocr_det.onnx': 2432880, '../models/ocr_rec.onnx': 10690752};
self.MODEL_CACHE = 'ylj-models-v1';
self.getModel = async function (url, onp) {
  const abs = new URL(url, self.location.href).href;
  let c = null; try { c = await caches.open(MODEL_CACHE); } catch (e) {}
  if (c) { const r = await c.match(abs); if (r) { const b = new Uint8Array(await r.arrayBuffer()); if (b.length === MODEL_SIZES[url] || !MODEL_SIZES[url]) { onp && onp(1); return b; } } }
  const resp = await fetch(abs, {cache: 'no-store'});
  if (!resp.ok) throw new Error('下载失败（' + resp.status + '）');
  const total = MODEL_SIZES[url] || +resp.headers.get('content-length') || 0;
  let buf;
  if (resp.body && resp.body.getReader) {
    const rd = resp.body.getReader(), parts = []; let got = 0;
    for (;;) { const {done, value} = await rd.read(); if (done) break; parts.push(value); got += value.length; if (total) onp && onp(Math.min(0.99, got / total)); }
    buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  } else buf = new Uint8Array(await resp.arrayBuffer());
  if (MODEL_SIZES[url] && buf.length !== MODEL_SIZES[url]) throw new Error('模型文件不完整（' + buf.length + '/' + MODEL_SIZES[url] + '），请在网络好的地方重试');
  if (c) { try { await c.put(abs, new Response(buf, {headers: {'Content-Type': 'application/octet-stream'}})); } catch (e) {} }
  onp && onp(1);
  return buf;
};
self.setupOrt = function () {
  ort.env.wasm.numThreads = 1;          // 单线程：不需要 SharedArrayBuffer / COOP / COEP
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL('ort/', self.location.href).href;
};
