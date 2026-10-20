/* 离线缓存：程序文件预缓存；大模型由识别 Worker 自己下载并存到 ylj-models-v1（带进度） */
const CACHE = 'ylj-meter-ios-v1';
const ASSETS = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './lib/xlsx.full.min.js', './lib/jszip.min.js', './lib/ocr_core.js', './lib/web_media.js', './lib/asr_core.js', './lib/model_cache.js',
  './lib/asr_worker.js', './lib/ocr_worker.js', './lib/ort/ort.wasm.min.js', './lib/ort/ort-wasm-simd-threaded.mjs', './lib/ort/ort-wasm-simd-threaded.wasm',
  './models/asr_tokens.txt', './models/asr_meta.json', './models/ocr_keys.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'ylj-models-v1').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  if (/\/models\/.*\.onnx$/.test(u.pathname)) return; // 大模型：交给 Worker 处理（它有自己的缓存）
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(r => r ||
    fetch(e.request).then(resp => {
      if (resp.ok) { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return resp;
    }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
