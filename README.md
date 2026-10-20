# 英伦金沙抄水表 · 网页版（iPhone Safari，添加到主屏幕）

纯静态网站，全部相对路径，放到任意 HTTPS 静态主机的任意子目录即可。

- 程序外壳 ~13 MB（首次打开即缓存，Service Worker 离线可用）
- 离线模型 ~92 MB（进入抄表页时自动下载并存入 Cache Storage `ylj-models-v1`；菜单里也可手动下载）
  - models/asr_digits.int8.onnx 78 MB：Paraformer，只认 0–9 和 确定/确认/删除（与安卓 1.4.3 同一模型）
  - models/ocr_det.onnx + ocr_rec.onnx 13 MB：PP-OCRv3 检测+识别
- onnxruntime-web 1.20.1，单线程 WASM（SIMD），**不需要 COOP/COEP**

## 主机要求
- 必须 HTTPS（相机/麦克风/Service Worker 需要安全上下文）
- `.mjs` 必须以 `text/javascript` 返回（lib/ort/ort-wasm-simd-threaded.mjs 会被动态 import）；`.wasm` 最好是 `application/wasm`
- 单个文件最大 78 MB（GitHub Pages 允许，<100 MB）
- 不需要任何服务器端程序，不需要 COOP/COEP 头

## iPhone 要求
iOS 16.4 以上（WASM SIMD；主屏幕 App 里可用相机/麦克风）。Safari 打开 → 分享 → 添加到主屏幕。

同一份 app.js 在安卓 APK 里有 window.AndroidBridge 时仍走原生功能，行为不变。
