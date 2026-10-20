'use strict';
/* 英伦金沙 抄水表（按导入表格的月份列抄表） */
// D = {src, months:[{c, col, label, raw}], b:{1:{sheet, rows:[{room, row, vals:{c:v}}]}}}
let D = null;
const BN = {1: '一栋', 2: '二栋', 3: '三栋'};
const KEY = 'ylj_meter_rec_v2', DKEY = 'ylj_meter_data_v2', FKEY = 'ylj_meter_file_v2';
const $ = s => document.querySelector(s);
const view = $('#view');

// ---- 数据索引 ----
let INFO = {}, FLOORS = {};  // INFO[b][room] = {row, vals}; FLOORS[b][f] = [room...]（按表格行顺序 = 从左到右）
function rebuild() {
  INFO = {}; FLOORS = {};
  for (const b of [1, 2, 3]) {
    INFO[b] = {}; FLOORS[b] = {};
    for (const r of (D && D.b[b] ? D.b[b].rows : [])) {
      INFO[b][r.room] = r;
      const f = Math.floor(r.room / 100);
      (FLOORS[b][f] = FLOORS[b][f] || []).push(r.room);
    }
  }
}
try { D = JSON.parse(localStorage.getItem(DKEY)); if (D && !D.months) D = null; } catch (e) { D = null; }
rebuild();
const curMonth = () => D && D.months.find(m => m.c === S.month);
const ML = () => { const m = curMonth(); return m ? m.label : '本次'; };
// 上次读数：本月列左边最近的有数的列（先看本机录入，再看表格）
function prevOf(b, room) {
  const inf = INFO[b][room]; if (!inf || !D) return {v: null, label: ''};
  const idx = D.months.findIndex(m => m.c === S.month);
  for (let k = idx - 1; k >= 0; k--) {
    const m = D.months[k], loc = S.m && S.m[m.c] && S.m[m.c][b + '-' + room] && !S.m[m.c][b + '-' + room].pre ? S.m[m.c][b + '-' + room].v : null;
    const v = loc != null ? loc : inf.vals[m.c];
    if (v != null) return {v, label: m.label};
  }
  return {v: null, label: ''};
}

// ---- 存储 ----（S.m[月份列] = {"栋-房号": {v, n, t, pre}}；S.r 指向当前月份）
let S = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.m) { s.r = s.m[s.month] || (s.m[s.month] = {}); return s; } } catch (e) {}
  return {m: {}, r: {}, month: null, b: 1, created: Date.now()};
}
function save() { try { const r = S.r; delete S.r; localStorage.setItem(KEY, JSON.stringify(S)); S.r = r; } catch (e) { toast('保存失败：手机存储空间不足？'); } }
function setMonth(c) {
  S.month = c; if (!S.m[c]) {
    const r = {}; for (const b of [1, 2, 3]) for (const x of (D.b[b] ? D.b[b].rows : [])) if (x.vals[c] != null) r[b + '-' + x.room] = {v: x.vals[c], n: '', t: 0, pre: 1};
    S.m[c] = r;
  }
  S.r = S.m[c]; save();
}
const rec = (b, room) => S.r[b + '-' + room];
const localCount = c => Object.values(S.m[c] || {}).filter(x => !x.pre).length;

// ---- 校验 ----
function median(b) {
  const u = [];
  for (const k in S.r) if (k[0] == b) { const room = +k.slice(2), p = prevOf(b, room).v; if (p == null || !INFO[b][room]) continue; const x = S.r[k].v - p; if (x >= 0) u.push(x); }
  if (u.length < 5) return null;
  u.sort((a, c) => a - c); const m = u.length >> 1;
  return u.length % 2 ? u[m] : (u[m - 1] + u[m]) / 2;
}
function check(b, room, v) {
  const w = [], p = prevOf(b, room), prev = p.v;
  if (prev == null) return w;
  const use = v - prev;
  if (v < prev) w.push('读数小于' + p.label + '读数（' + prev + '），可能抄错或换表');
  else {
    if (use > 300) w.push('用量 ' + use + ' 超过 300，偏大');
    const md = median(b);
    if (md && md > 0 && use > md * 3 && use > 30) w.push('用量是本栋中位数（' + md + '）的 ' + (use / md).toFixed(1) + ' 倍');
  }
  return w;
}
function floorStat(b, f) {
  const rooms = FLOORS[b][f] || []; let done = 0, bad = 0;
  for (const r of rooms) { const x = rec(b, r); if (x) { done++; if (check(b, r, x.v).length) bad++; } }
  return {n: rooms.length, done, bad};
}
function bStat(b) { let n = 0, d = 0, w = 0; for (const f in FLOORS[b]) { const s = floorStat(b, +f); n += s.n; d += s.done; w += s.bad; } return {n, d, w}; }

// ---- 通用 ----
let tt;
function toast(m, ms = 2200) { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(tt); tt = setTimeout(() => t.classList.add('hidden'), ms); }
function setHeader(title, back) { $('#title').textContent = title; $('#btnBack').classList.toggle('hidden', !back); $('#btnBack').onclick = back || null; }
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }


// ---- 语音播报（Web Speech API）----
const TKEY = 'ylj_tts_v1';
const CN = '零一二三四五六七八九';
let T = (() => { try { return Object.assign({on: true, rate: 1.1, room: false}, JSON.parse(localStorage.getItem(TKEY)) || {}); } catch (e) { return {on: true, rate: 1.1, room: false}; } })();
function saveT() { try { localStorage.setItem(TKEY, JSON.stringify(T)); } catch (e) {} }
const AB = window.AndroidBridge || null; // 安卓 APK 内的原生接口
const WEB = !AB && !!window.WebASR; // 网页版（iPhone 等）：浏览器里离线识别
const synth = ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) ? window.speechSynthesis : null;
let zhVoice = null, voicesLoaded = false, ttsUnlocked = false;
function pickVoice() {
  if (!synth) return;
  let vs = []; try { vs = synth.getVoices() || []; } catch (e) {}
  if (!vs.length) return;
  voicesLoaded = true;
  const norm = v => String(v.lang || '').replace('_', '-').toLowerCase();
  zhVoice = vs.find(v => norm(v) === 'zh-cn') || vs.find(v => norm(v).startsWith('zh-hans')) || vs.find(v => norm(v) === 'cmn-hans-cn')
    || vs.find(v => /^zh|^cmn/.test(norm(v)) && !/hk|tw|yue/.test(norm(v))) || vs.find(v => /^zh|^cmn/.test(norm(v))) || null;
}
if (synth) { pickVoice(); try { synth.addEventListener ? synth.addEventListener('voiceschanged', pickVoice) : (synth.onvoiceschanged = pickVoice); } catch (e) {} }
// 可用：有 speechSynthesis，且（语音列表还没加载 或 有中文语音）
function ttsAvailable() { if (AB) { try { return !!AB.ttsReady(); } catch (e) { return false; } } return !!synth && (!voicesLoaded || !!zhVoice); }
function ttsReason() { return AB ? '这部手机没有可用的中文语音引擎（可在系统设置 → 文字转语音 里安装/下载中文语音）' : !synth ? '这部手机的浏览器不支持语音播报' : '这部手机没有中文语音包，无法播报（可在系统设置 → 文字转语音 里下载中文语音）'; }
function speak(text, queue) {
  if (!T.on || !ttsAvailable() || !text) return;
  if (AB) { try { AB.speak(String(text), Math.min(2, Math.max(0.5, +T.rate || 1)), !!queue); } catch (e) {} return; }
  try {
    if (!queue) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; if (zhVoice) u.voice = zhVoice;
    u.rate = Math.min(2, Math.max(0.5, +T.rate || 1)); u.pitch = 1; u.volume = 1;
    synth.speak(u);
    if (synth.paused) synth.resume();
  } catch (e) {}
}
// iOS Safari：必须在用户点击里第一次调用 speak，之后才能正常播报
function unlockTTS() {
  if (ttsUnlocked || !synth || AB) return; ttsUnlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'zh-CN'; synth.speak(u); } catch (e) {}
  ['touchend', 'click'].forEach(ev => document.removeEventListener(ev, unlockTTS, true));
}
['touchend', 'click'].forEach(ev => document.addEventListener(ev, unlockTTS, true));
// 数字逐位读：303 → 三零三
const digitsCN = n => String(n).replace(/\d/g, d => CN[d]);
// 整数读成数值：1221 → 一千二百二十一；1036 → 一千零三十六；10 → 十
function numCN(n) {
  n = Math.floor(Math.abs(+n)); if (!n) return '零';
  const sec = x => { // 0..9999
    const u = ['', '十', '百', '千']; let out = '', zero = false;
    for (let p = 3; p >= 0; p--) {
      const d = Math.floor(x / Math.pow(10, p)) % 10;
      if (d) { if (zero) out += '零'; zero = false; out += CN[d] + u[p]; }
      else if (out) zero = true;
    }
    return out;
  };
  const wan = Math.floor(n / 10000), low = n % 10000;
  let s = wan ? sec(wan) + '万' : '';
  if (low) s += (wan && low < 1000 ? '零' : '') + sec(low);
  s = s.replace(/^一十/, '十');            // 一十五 → 十五，一十万 → 十万
  s = s.replace(/^二(千|万)/, '两$1');      // 二千 → 两千
  return s;
}
function stopSpeak() { if (AB) { try { AB.stop(); } catch (e) {} } else if (synth) synth.cancel(); }
window.__tts = {numCN, digitsCN, speak, T, ttsAvailable}; // 测试用

// ---- 首页：选栋/楼 ----
function home() {
  stopTorch();
  if (!D) return importScreen();
  const b = S.b || 1; const st = bStat(b);
  if (!curMonth()) return monthScreen();
  setHeader('英伦金沙 · ' + ML() + '抄表', null);
  let h = '<div class="tabs">' + [1, 2, 3].map(i => `<button class="tab ${i == b ? 'on' : ''}" data-b="${i}">${i}栋</button>`).join('') + '</div>';
  h += `<div class="sum"><div style="flex:1">${BN[b]}：已抄 <b>${st.d}</b> / ${st.n} 户${st.w ? `，<span style="color:#dc2626">异常 ${st.w}</span>` : ''}<div class="bar"><i style="width:${(st.d / st.n * 100).toFixed(1)}%"></i></div></div></div>`;
  h += '<div class="floors">';
  for (let f = 24; f >= 1; f--) {
    const s = floorStat(b, f); if (!s.n) continue;
    const cls = s.done === s.n ? 'done' : s.done ? 'part' : '';
    h += `<button class="fl ${cls} ${s.bad ? 'warn' : ''}" data-f="${f}">${f}楼<small>${s.done}/${s.n}${s.bad ? ' ⚠' + s.bad : ''}</small></button>`;
  }
  h += '</div><div class="legend">白色＝未抄　黄色＝抄了一部分　绿色＝本层抄完　红框＝有异常读数<br>点楼层进入，按表格里的顺序从左到右一只一只抄。数据只存在本机，记得定期“菜单 → 导出 Excel”备份。</div>';
  view.innerHTML = h;
  view.querySelectorAll('.tab').forEach(e => e.onclick = () => { S.b = +e.dataset.b; save(); home(); });
  view.querySelectorAll('.fl').forEach(e => e.onclick = () => {
    const f = +e.dataset.f, rooms = FLOORS[b][f];
    let i = rooms.findIndex(r => !rec(b, r)); if (i < 0) i = 0;
    entry(b, f, i);
  });
  window.scrollTo(0, 0);
}

// ---- 录入页：一屏一只表 ----
let cur = null, buf = '';
function entry(b, f, i) {
  cur = {b, f, i}; buf = '';
  const rooms = FLOORS[b][f], room = rooms[i], pv = prevOf(b, room), r = rec(b, room);
  setHeader(`${b}栋 ${f}楼`, home);
  let dots = rooms.map((rm, k) => { const x = rec(b, rm); const c = x ? (check(b, rm, x.v).length ? 'bad' : 'ok') : '';
    return `<button class="dot ${c} ${k == i ? 'cur' : ''}" data-i="${k}">${String(rm % 100).padStart(2, '0')}</button>`; }).join('');
  view.innerHTML = `
  <div class="where"><span class="room">${room}室</span><span class="pos">第 ${i + 1} 只（从左数）/ 共 ${rooms.length} 只</span></div>
  <div class="dots">${dots}</div>
  <div class="card">
    <div class="row"><span>上次（${pv.label || '无'}）读数</span><span class="prev">${pv.v == null ? '—' : pv.v}</span></div>
    <div class="row" style="margin-top:4px"><span>${ML()}读数</span><span id="state"></span></div>
    <div id="disp" class="disp"></div>
    <div class="row"><span>用量（${ML()}−${pv.label || '上次'}）</span><span id="use" class="usage">—</span></div>
  </div>
  <div id="alert" class="alert hidden"></div>
  <button id="note" class="notebtn"></button>
  <div class="mrow"><button id="mic" class="mic ${micAvailable() ? '' : 'hidden'}">🎤 按住说话</button><button id="cam" class="cam ${ocrAvailable() ? '' : 'hidden'}">📷 扫描读数</button></div>
  <div id="asr" class="asr hidden"></div>
  <div class="pad">
    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
    <button class="fn" data-k="del">⌫</button><button data-k="0">0</button><button class="ok" data-k="ok">确认 ›</button>
  </div>
  <div class="nav">
    <button id="prev">‹ 上一只</button>
    <button id="torch" class="torch ${torchOn ? 'on' : ''} ${torchAvailable() ? '' : 'hidden'}">🔦 手电</button>
    <button id="chk">本层核对</button>
    <button id="next">下一只 ›</button>
  </div>`;
  view.querySelectorAll('.dot').forEach(e => e.onclick = () => entry(b, f, +e.dataset.i));
  view.querySelectorAll('.pad button').forEach(e => e.onclick = () => key(e.dataset.k));
  bindMic();
  $('#cam').onclick = startOcr;
  $('#prev').onclick = () => i > 0 ? entry(b, f, i - 1) : toast('已经是本层第一只');
  $('#next').onclick = () => i < rooms.length - 1 ? entry(b, f, i + 1) : floorCheck(b, f);
  $('#chk').onclick = () => floorCheck(b, f);
  $('#torch').onclick = toggleTorch;
  $('#note').onclick = () => noteSheet(b, room);
  refresh();
}
function refresh() {
  const {b, f, i} = cur, room = FLOORS[b][f][i], prev = prevOf(b, room).v, r = rec(b, room);
  const d = $('#disp'), showV = buf !== '' ? +buf : (r ? r.v : null);
  d.textContent = buf !== '' ? buf : (r ? r.v : '请输入');
  d.className = 'disp ' + (buf === '' ? (r ? 'saved' : 'empty') : '');
  $('#state').innerHTML = r && buf === '' ? `<span style="color:#15803d">✓ 已保存${r.pre ? '（之前录入）' : ''}</span>` : (r ? '<span style="color:#b45309">正在修改…</span>' : '');
  const u = $('#use'), a = $('#alert');
  const partial = buf !== '' && buf.length < String(prev == null ? '' : prev).length;
  if (showV == null) { u.textContent = '—'; u.style.color = ''; a.classList.add('hidden'); }
  else {
    const w = check(b, room, showV); u.textContent = prev == null ? '—' : (showV - prev) + ' 吨';
    u.style.color = w.length ? '#dc2626' : '#15803d';
    a.innerHTML = w.map(x => '⚠ ' + esc(x)).join('<br>'); a.classList.toggle('hidden', !w.length || partial);
    if (partial) u.style.color = '#94a3b8';
  }
  const n = r && r.n; $('#note').textContent = n ? '📝 备注：' + n : '＋ 添加备注（可选，如：表面模糊、字轮翻转）';
}
function key(k) {
  vibrate(10);
  if (k === 'del') { buf = buf.slice(0, -1); return refresh(); }
  if (k === 'ok') return confirmV();
  if (buf.length >= 6) { return toast('最多 6 位数'); }
  speak(CN[k]);
  if (buf === '0') buf = '';
  buf += k; refresh();
}
function confirmV() {
  const {b, f, i} = cur, rooms = FLOORS[b][f], room = rooms[i], r = rec(b, room);
  if (buf === '') {
    if (r) { return advance(); }
    return toast('请先输入读数');
  }
  const v = +buf, w = check(b, room, v);
  const doSave = note => {
    S.r[b + '-' + room] = {v, n: note != null ? note : (r ? r.n : ''), t: Date.now()};
    save(); vibrate(w.length ? [40, 60, 40] : 20); buf = ''; advance();
  };
  if (!w.length) return doSave();
  vibrate([80, 50, 80]);
  sheet(`<div class="big anom" style="color:#dc2626">⚠ 读数异常</div><div style="color:#7c3aed;font-size:14px">核对无误可再说一次“确定”保存，说“删除”重新输入</div>
    <div style="font-size:16px;line-height:1.6">${room}室　${prevOf(b, room).label} ${prevOf(b, room).v} → ${ML()} <b>${v}</b><br>${w.map(esc).join('<br>')}</div>
    <div class="chips">${['已复核，读数无误', '表面模糊', '字轮翻转', '疑似换表', '空置/无人'].map(c => `<button>${c}</button>`).join('')}</div>
    <textarea id="nt" placeholder="备注（可选）">${esc(r ? r.n : '')}</textarea>
    <button class="btn" id="s1">保存（带备注）</button>
    <button class="btn sec" id="s2">重新输入</button>`, m => {
    m.querySelectorAll('.chips button').forEach(c => c.onclick = () => { const t = m.querySelector('#nt'); t.value = (t.value ? t.value + '；' : '') + c.textContent; });
    m.querySelector('#s1').onclick = () => { const n = m.querySelector('#nt').value.trim(); m.remove(); doSave(n); };
    m.querySelector('#s2').onclick = () => { m.remove(); buf = ''; refresh(); };
  });
}
function advance() {
  const {b, f, i} = cur, rooms = FLOORS[b][f];
  if (i < rooms.length - 1) entry(b, f, i + 1); else floorCheck(b, f);
}
function sheet(html, bind) {
  const m = document.createElement('div'); m.className = 'mask';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m); bind && bind(m); return m;
}
function noteSheet(b, room) {
  const r = rec(b, room);
  if (!r && buf === '') return toast('请先输入并确认读数，再加备注');
  sheet(`<div class="big">${room}室 备注</div>
    <div class="chips">${['表面模糊', '字轮翻转', '表被遮挡', '疑似换表', '空置/无人', '需复查'].map(c => `<button>${c}</button>`).join('')}</div>
    <textarea id="nt">${esc(r ? r.n : '')}</textarea><button class="btn" id="s1">保存备注</button>`, m => {
    m.querySelectorAll('.chips button').forEach(c => c.onclick = () => { const t = m.querySelector('#nt'); t.value = (t.value ? t.value + '；' : '') + c.textContent; });
    m.querySelector('#s1').onclick = () => {
      const n = m.querySelector('#nt').value.trim();
      if (buf !== '') S.r[b + '-' + room] = {v: +buf, n, t: Date.now()}, buf = '';
      else r.n = n;
      save(); m.remove(); refresh();
    };
  });
}

// ---- 本层核对 ----
function floorCheck(b, f) {
  stopTorch();
  const rooms = FLOORS[b][f], s = floorStat(b, f);
  setHeader(`${b}栋 ${f}楼 · 核对`, home);
  let rows = rooms.map((rm, k) => { const x = rec(b, rm), feb = prevOf(b, rm).v == null ? '—' : prevOf(b, rm).v;
    if (!x) return `<tr class="miss" data-i="${k}"><td>${rm}</td><td>${feb}</td><td>未抄</td><td>—</td><td></td></tr>`;
    const w = check(b, rm, x.v);
    return `<tr class="${w.length ? 'bad' : ''}" data-i="${k}"><td>${rm}</td><td>${feb}</td><td><b>${x.v}</b></td><td>${feb === '—' ? '—' : x.v - feb}</td><td style="font-size:12px;text-align:left">${w.length ? '⚠ ' : ''}${esc(x.n)}</td></tr>`; }).join('');
  const ok = s.done === s.n;
  const up = FLOORS[b][f + 1] ? f + 1 : null, dn = FLOORS[b][f - 1] ? f - 1 : null;
  view.innerHTML = `<div class="card"><div class="big" style="color:${ok ? '#15803d' : '#b45309'}">${ok ? '✓' : '!'} 本层应抄 ${s.n} 只，已抄 ${s.done} 只</div>
    ${ok ? '' : `<div style="color:#b45309">还差 ${s.n - s.done} 只（黄色行），点该行补录。</div>`}
    ${s.bad ? `<div style="color:#dc2626">有 ${s.bad} 只读数异常（红色行），请复核。</div>` : ''}</div>
    <table><tr><th>房号</th><th>上次</th><th>${ML()}</th><th>用量</th><th>备注</th></tr>${rows}</table>
    <div style="font-size:13px;color:#64748b;margin:6px 2px">点任意一行可回去修改。</div>
    ${dn ? `<button class="btn" id="dn">下楼：去 ${dn} 楼</button>` : ''}
    ${up ? `<button class="btn sec" id="up">上楼：去 ${up} 楼</button>` : ''}
    <button class="btn sec" id="hm">返回楼层列表</button>`;
  view.querySelectorAll('tr[data-i]').forEach(e => e.onclick = () => entry(b, f, +e.dataset.i));
  const go = ff => { const rs = FLOORS[b][ff]; let i = rs.findIndex(r => !rec(b, r)); entry(b, ff, i < 0 ? 0 : i); };
  if (dn) $('#dn').onclick = () => go(dn);
  if (up) $('#up').onclick = () => go(up);
  $('#hm').onclick = home;
  window.scrollTo(0, 0);
}

// ---- 总览 ----
function overview() {
  stopTorch();
  setHeader('全部楼层进度', home);
  let h = '<div class="card">' + [1, 2, 3].map(b => { const s = bStat(b); return `${BN[b]}：${s.d}/${s.n}${s.w ? ` <span style="color:#dc2626">⚠${s.w}</span>` : ''}`; }).join('　') + '</div>';
  h += '<table class="ov"><tr><th>楼层</th><th>一栋</th><th>二栋</th><th>三栋</th></tr>';
  for (let f = 24; f >= 1; f--) {
    h += `<tr><td><b>${f}楼</b></td>` + [1, 2, 3].map(b => { const s = floorStat(b, f); if (!s.n) return '<td>—</td>';
      return `<td class="${s.done === s.n ? 'd' : s.done ? 'p' : ''} ${s.bad ? 'w' : ''}" data-b="${b}" data-f="${f}">${s.done}/${s.n}${s.bad ? ' ⚠' + s.bad : ''}</td>`; }).join('') + '</tr>';
  }
  view.innerHTML = h + '</table><div class="legend">绿色＝抄完　黄色＝部分　⚠＝异常数。点格子直接进入该层核对。</div>';
  view.querySelectorAll('td[data-b]').forEach(e => e.onclick = () => floorCheck(+e.dataset.b, +e.dataset.f));
  window.scrollTo(0, 0);
}


// ---- 导入 Excel ----
// 按表头找列：表头行含“房号”；月份列＝表头含“月”的列；重复的月份（如两个十二月）前面那个叫“上年xx”
function parseWorkbook(wb) {
  const XL = window.XLSX, out = {b: {}, months: null}; let n = 0; const odd = [];
  for (const b of [1, 2, 3]) {
    const nm = wb.SheetNames.find(x => x === BN[b]) || wb.SheetNames.find(x => x.includes(BN[b]) && !/模版|模板/.test(x));
    if (!nm) throw new Error('文件里找不到“' + BN[b] + '”工作表');
    const ws = wb.Sheets[nm]; if (!ws['!ref']) throw new Error('“' + nm + '”是空的');
    const rg = XL.utils.decode_range(ws['!ref']), cell = (r, c) => { const x = ws[XL.utils.encode_cell({r, c})]; return x ? x.v : null; };
    let hr = -1, rc = -1;
    for (let r = rg.s.r; r <= Math.min(rg.e.r, rg.s.r + 15) && hr < 0; r++) for (let c = rg.s.c; c <= rg.e.c; c++) { const v = cell(r, c); if (v != null && String(v).replace(/\s/g, '').includes('房号')) { hr = r; rc = c; break; } }
    if (hr < 0) throw new Error('“' + nm + '”里找不到含“房号”的表头');
    const ms = [];
    for (let c = rc + 1; c <= rg.e.c; c++) { const v = cell(hr, c); if (v != null && /月/.test(String(v))) ms.push({c, col: XL.utils.encode_col(c), raw: String(v).replace(/\s/g, '')}); }
    if (!ms.length) throw new Error('“' + nm + '”表头里没有月份列');
    ms.forEach((m, k) => { m.label = ms.slice(k + 1).some(x => x.raw === m.raw) ? '上年' + m.raw : m.raw; });
    if (!out.months) out.months = ms;
    else if (ms.map(m => m.col + m.label).join() !== out.months.map(m => m.col + m.label).join()) throw new Error('“' + nm + '”的月份列和“一栋”不一致');
    const rows = [], seen = {};
    const num = x => (x === null || x === '' || isNaN(+x)) ? null : +x;
    for (let r = hr + 1; r <= rg.e.r; r++) {
      const room = num(cell(r, rc));
      if (!room || room < 100 || room % 1) continue;
      if (seen[room]) { odd.push(nm + ' ' + room + ' 重复（第 ' + seen[room] + ' 行和第 ' + (r + 1) + ' 行），只用第一行'); continue; }
      seen[room] = r + 1;
      const vals = {}; for (const m of ms) { const v = num(cell(r, m.c)); if (v != null) vals[m.c] = v; }
      rows.push({room, row: r + 1, vals});
    }
    if (!rows.length) throw new Error('“' + nm + '”里没有读到房号');
    out.b[b] = {sheet: nm, title: cell(rg.s.r, rg.s.c) ? String(cell(rg.s.r, rg.s.c)) : '', rows};
    n += rows.length;
  }
  return {data: out, n, odd};
}
// 默认月份：大多数行有数的最后一列之后的第一列
function defaultMonth(d) {
  const tot = [1, 2, 3].reduce((a, b) => a + d.b[b].rows.length, 0); let last = -1;
  d.months.forEach((m, k) => { const cnt = [1, 2, 3].reduce((a, b) => a + d.b[b].rows.filter(r => r.vals[m.c] != null).length, 0); if (cnt > tot / 2) last = k; });
  return d.months[Math.min(last + 1, d.months.length - 1)].c;
}
function monthScreen(fromMenu) {
  stopTorch();
  setHeader('选择本次抄表月份', fromMenu ? home : null);
  const def = S.month != null && D.months.some(m => m.c === S.month) ? S.month : defaultMonth(D);
  const fill = m => [1, 2, 3].reduce((a, b) => a + D.b[b].rows.filter(r => r.vals[m.c] != null).length, 0);
  const tot = [1, 2, 3].reduce((a, b) => a + D.b[b].rows.length, 0);
  view.innerHTML = `<div class="card" style="font-size:16px;line-height:1.7">
    <div class="big">本次抄表月份</div>
    <select id="msel" style="font-size:22px;width:100%;padding:10px;margin:8px 0">${D.months.map(m => `<option value="${m.c}" ${m.c === def ? 'selected' : ''}>${m.label}（${m.col} 列，表里已有 ${fill(m)}/${tot}）</option>`).join('')}</select>
    <div id="mhint" style="color:#475569"></div></div>
    <button class="btn" id="mok">确定</button>`;
  const hint = () => { const c = +$('#msel').value, k = D.months.findIndex(m => m.c === c), left = D.months.slice(0, k).reverse().find(m => fill(m) > 0);
    $('#mhint').innerHTML = (left ? '上次读数默认取左边最近有数的列（大多数是 <b>' + left.label + '</b>）。' : '左边没有可比的读数，不算用量。') + (fill(D.months[k]) ? '<br>这一列表里已有的读数会一起带入。' : '') + (localCount(c) ? `<br><span style="color:#b45309">本机已录这个月 ${localCount(c)} 条，会继续保留。</span>` : ''); };
  $('#msel').onchange = hint; hint();
  $('#mok').onclick = () => {
    const c = +$('#msel').value;
    if (fromMenu && S.month != null && c !== S.month && localCount(S.month) && !confirm(`本机已录 ${ML()} ${localCount(S.month)} 条读数。切换月份后它们仍保存在本机（切回来还在），但导出只会写当前月份。确定切换？`)) return;
    setMonth(c); toast('本次抄表：' + ML()); home();
  };
  window.scrollTo(0, 0);
}
function importScreen() {
  stopTorch();
  setHeader('导入水表 Excel', D ? home : null);
  view.innerHTML = `<div class="card" style="font-size:16px;line-height:1.7">
    <div class="big">第一步：导入水表表格</div>
    请选择手机里的 <b>英伦金沙水表 .xlsx</b> 文件（需包含“一栋、二栋、三栋”工作表，表头有“房号”和各月份）。<br>
    文件只在这部手机里读取和保存，<b>不会上传</b>到任何地方。导出时会把读数填回这份表格。
    ${D ? '<br><span style="color:#b45309">当前已导入：' + esc(S.src || '') + '，共 ' + [1, 2, 3].map(b => bStat(b).n).reduce((a, c) => a + c, 0) + ' 户。重新导入会更新房号和各月读数。</span>' : ''}
  </div>
  <input type="file" id="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" class="hidden">
  <button class="btn" id="pick">选择 Excel 文件</button>
  ${D ? '<button class="btn sec" id="cancel">取消</button>' : ''}
  <div id="impmsg" style="margin-top:10px;font-size:15px"></div>`;
  $('#pick').onclick = () => {
    if (AB && AB.pickFile) {
      let nf = null;
      window.__nfBegin = (name) => { nf = {name, parts: []}; $('#impmsg').textContent = '正在读取…'; };
      window.__nfChunk = (c) => { if (nf) nf.parts.push(c); };
      window.__nfEnd = () => {
        if (!nf) return; const b64 = nf.parts.join(''), name = nf.name; nf = null;
        let buf; try { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); buf = u8.buffer; }
        catch (err) { $('#impmsg').innerHTML = '<span style="color:#dc2626">导入失败：文件数据解码出错（' + esc(err.message || err) + '）</span>'; return; }
        doImport(name, buf);
      };
      window.__nfError = (m) => { nf = null; $('#impmsg').innerHTML = '<span style="color:#dc2626">导入失败：' + esc(m) + '</span>'; };
      window.__nfCancel = () => { nf = null; };
      try { AB.pickFile(); } catch (err) { $('#file').click(); }
    } else $('#file').click();
  };
  if (D) $('#cancel').onclick = home;
  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $('#impmsg').textContent = '正在读取…';
    let buf; try { buf = await f.arrayBuffer(); } catch (err) { $('#impmsg').innerHTML = '<span style="color:#dc2626">导入失败：读不到这个文件（' + esc(err.message || err) + '）</span>'; e.target.value = ''; return; }
    e.target.value = ''; doImport(f.name, buf);
  };
  async function doImport(fname, buf) {
    const f = {name: fname};
    const msg = $('#impmsg'); msg.textContent = '正在读取…';
    try {
      await waitXLSX();
      const wb = XLSX.read(buf, {type: 'array'});
      const {data, n, odd} = parseWorkbook(wb);
      data.src = f.name;
      const u8 = new Uint8Array(buf); let bin = ''; for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
      const apply = keep => {
        const oldM = S.m || {}, ok = (k) => { const [b, room] = k.split('-').map(Number); return data.b[b] && data.b[b].rows.some(r => r.room === room); };
        try { localStorage.setItem(FKEY, btoa(bin)); localStorage.setItem(DKEY, JSON.stringify(data)); } catch (e) { msg.innerHTML = '<span style="color:#dc2626">导入失败：手机存储空间不足</span>'; return; }
        D = data; rebuild();
        S.m = {}; S.src = f.name; S.imported = Date.now();
        if (keep) for (const c in oldM) if (data.months.some(m => m.c === +c)) for (const k in oldM[c]) if (!oldM[c][k].pre && ok(k)) (S.m[c] = S.m[c] || {})[k] = oldM[c][k];
        // 表格里有、本机没改的读数，作为“之前录入”带入
        for (const m of data.months) if (S.m[m.c]) for (const b of [1, 2, 3]) for (const x of data.b[b].rows) { const k = b + '-' + x.room; if (x.vals[m.c] != null && !S.m[m.c][k]) S.m[m.c][k] = {v: x.vals[m.c], n: '', t: 0, pre: 1}; }
        const keepMonth = keep && S.month != null && data.months.some(m => m.c === S.month) ? S.month : null;
        S.month = null; S.r = {};
        toast(`导入成功：${n} 户` + (odd.length ? `，注意：${odd.join('；')}` : ''), odd.length ? 6000 : 3000);
        if (keepMonth != null) { setMonth(keepMonth); home(); } else { save(); monthScreen(); }
      };
      const local = Object.keys(S.m || {}).reduce((a, c) => a + localCount(c), 0);
      if (D && local) {
        msg.textContent = '';
        sheet(`<div class="big">本机已有 ${local} 条手动录入的读数</div>
          <div style="font-size:16px;line-height:1.6">新文件共 ${n} 户。要怎么处理本机已录的读数？</div>
          <button class="btn" id="k1">保留本机读数（推荐）</button>
          <button class="btn danger" id="k2">丢弃本机读数，只用文件里的</button>
          <button class="btn sec" id="k3">取消导入</button>`, m => {
          m.querySelector('#k1').onclick = () => { m.remove(); apply(true); };
          m.querySelector('#k2').onclick = () => { if (confirm('确定丢弃本机已录的 ' + local + ' 条读数？')) { m.remove(); apply(false); } };
          m.querySelector('#k3').onclick = () => m.remove();
        });
      } else apply(false);
    } catch (err) { msg.innerHTML = '<span style="color:#dc2626">导入失败：' + esc(err.message || err) + '</span>'; }
  }
  window.scrollTo(0, 0);
}
function waitXLSX() { return new Promise((res, rej) => { let k = 0; const t = setInterval(() => { if (window.XLSX) { clearInterval(t); res(); } else if (++k > 100) { clearInterval(t); rej(new Error('表格组件加载失败')); } }, 100); }); }

// ---- 导出 Excel：直接改原表格 xlsx 里的工作表 XML，只填本月这一列，其它格式/工作表原样保留 ----
const xesc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const colNum = L => [...L].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
function patchSheetXml(xml, col, vals) {
  const done = new Set();
  xml = xml.replace(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (all, attrs, tail, inner) => {
    const rn = +((attrs.match(/\br="(\d+)"/) || [])[1]); if (!(rn in vals)) return all;
    done.add(rn); attrs = attrs.replace(/\s*\/$/, '');
    const ref = col + rn, v = vals[rn], re = new RegExp('<c\\b([^>]*?)\\br="' + ref + '"([^>]*?)(\\/>|>[\\s\\S]*?<\\/c>)');
    inner = inner || '';
    if (re.test(inner)) {
      inner = inner.replace(re, (m, a1, a2) => { const at = (a1 + ' ' + a2).replace(/\s*\/$/, '').replace(/\bt="[^"]*"/, '').replace(/\s+/g, ' ').trim(); return '<c r="' + ref + '"' + (at ? ' ' + at : '') + '><v>' + v + '</v></c>'; });
    } else {
      const target = colNum(col); let pos = inner.length, sty = '';
      const cre = /<c\b[^>]*?\br="([A-Z]+)\d+"[^>]*?(\/>|>[\s\S]*?<\/c>)/g; let m;
      while ((m = cre.exec(inner))) { if (colNum(m[1]) > target) { pos = m.index; break; } const sm = m[0].match(/\bs="(\d+)"/); sty = sm ? ' s="' + sm[1] + '"' : ''; }
      inner = inner.slice(0, pos) + '<c r="' + ref + '"' + sty + '><v>' + v + '</v></c>' + inner.slice(pos);
    }
    return '<row' + attrs + '>' + inner + '</row>';
  });
  return {xml, miss: Object.keys(vals).map(Number).filter(rn => !done.has(rn))};
}
async function buildExport() {
  const b64 = localStorage.getItem(FKEY); if (!b64) throw new Error('本机没有原表格，请重新导入一次 Excel');
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(u8);
  const wbx = await zip.file('xl/workbook.xml').async('string'), rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const m = curMonth(), col = m.col; let written = 0; const bad = [];
  const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sheetPath = name => {
    const sm = wbx.match(new RegExp('<sheet\\b[^>]*name="' + reEsc(xesc(name)) + '"[^>]*/>')); if (!sm) return null;
    const rid = (sm[0].match(/r:id="([^"]+)"/) || [])[1]; const rm = rels.match(new RegExp('<Relationship\\b[^>]*Id="' + reEsc(rid || '') + '"[^>]*/>'));
    const t = rm && (rm[0].match(/Target="([^"]+)"/) || [])[1]; if (!t) return null;
    return t.startsWith('/') ? t.slice(1) : 'xl/' + t;
  };
  for (const b of [1, 2, 3]) {
    const vals = {};
    for (const x of D.b[b].rows) { const r = rec(b, x.room); if (r) { vals[x.row] = r.v; const w = check(b, x.room, r.v); if (w.length || r.n) bad.push([BN[b], x.room, prevOf(b, x.room).v, r.v, w.join('；'), r.n || '']); } }
    const pth = sheetPath(D.b[b].sheet); if (!pth || !zip.file(pth)) throw new Error('原表格里找不到工作表“' + D.b[b].sheet + '”');
    const res = patchSheetXml(await zip.file(pth).async('string'), col, vals);
    if (res.miss.length) throw new Error(D.b[b].sheet + ' 第 ' + res.miss.join('、') + ' 行在原表格里不存在');
    zip.file(pth, res.xml); written += Object.keys(vals).length;
  }
  if (bad.length) await addListSheet(zip, wbx, rels, '异常清单' + m.label, [['栋', '房号', '上次读数', m.label + '读数', '用量', '异常', '备注'], ...bad.map(r => [r[0], r[1], r[2], r[3], r[2] == null ? '' : r[3] - r[2], r[4], r[5]])]);
  const data = await zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
  return {data, written, bad: bad.length};
}
async function addListSheet(zip, wbx, rels, name, aoa) {
  let n = 1; while (zip.file('xl/worksheets/sheet' + n + '.xml')) n++;
  const p = 'worksheets/sheet' + n + '.xml', rid = 'rIdYlj' + n;
  const sid = Math.max(0, ...[...wbx.matchAll(/sheetId="(\d+)"/g)].map(x => +x[1])) + 1;
  const cell = (v, r, c) => { const ref = String.fromCharCode(65 + c) + r; return v === '' || v == null ? '' : typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xesc(v)}</t></is></c>`; };
  const rows = aoa.map((row, i) => `<row r="${i + 1}">${row.map((v, c) => cell(v, i + 1, c)).join('')}</row>`).join('');
  zip.file('xl/' + p, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="5" width="10" customWidth="1"/><col min="6" max="7" width="40" customWidth="1"/></cols><sheetData>${rows}</sheetData></worksheet>`);
  zip.file('xl/workbook.xml', wbx.replace('</sheets>', `<sheet name="${xesc(name)}" sheetId="${sid}" r:id="${rid}"/></sheets>`));
  zip.file('xl/_rels/workbook.xml.rels', rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${p}"/></Relationships>`));
  const ct = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', ct.replace('</Types>', `<Override PartName="/xl/${p}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
}
window.__buildExport = buildExport; // 测试用
async function exportXlsx() {
  if (!window.JSZip) return toast('导出组件还没加载好，请稍等再试');
  if (!curMonth()) return toast('请先选择抄表月份');
  const name = `英伦金沙水表_${ML()}.xlsx`;
  let data, info; try { info = await buildExport(); data = info.data; } catch (e) { return toast('导出失败：' + (e.message || e), 5000); }
  if (AB && AB.saveFile) {
    let bin = ''; const u8 = new Uint8Array(data);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    let msg = ''; try { msg = AB.saveFile(btoa(bin), name); } catch (e) { msg = '保存失败：' + (e && e.message || e); }
    toast((msg || ('已保存到 下载/' + name)) + `（写入 ${info.written} 户${info.bad ? '，异常/备注 ' + info.bad + ' 条见“异常清单”表' : ''}）`, 4000); return;
  }
  const blob = new Blob([data], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  try {
    const file = new File([blob], name, {type: blob.type});
    if (navigator.canShare && navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: name}); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  toast('已生成 ' + name + `（写入 ${info.written} 户）`);
}

function menu() {
  if (!D) return importScreen();
  const st = [1, 2, 3].map(bStat), d = st.reduce((a, s) => a + s.d, 0), n = st.reduce((a, s) => a + s.n, 0);
  sheet(`<div class="big">菜单</div><div style="color:#475569">全部已抄 ${d} / ${n} 户</div>
    <button class="btn" id="m1">导出 Excel（填回原表格的${ML()}列）</button>
    <button class="btn sec" id="m6">更换抄表月份（当前：${ML()}）</button>
    <button class="btn sec" id="m2">查看全部楼层进度</button>
    <button class="btn sec" id="m5">导入 Excel（更新房号/二月读数）</button>
    ${ttsAvailable() ? `<div class="tts">
      <button class="btn sec" id="mt">语音播报：${T.on ? '开' : '关'}</button>
      <div id="ttsOpts" class="${T.on ? '' : 'hidden'}">
        <label class="ttsrow">语速 <input type="range" id="mr" min="0.6" max="1.8" step="0.1" value="${T.rate}"> <span id="mrv">${(+T.rate).toFixed(1)}</span></label>
      </div></div>` : `<div class="ttstip">🔇 ${ttsReason()}</div>`}
    ${AB ? `<button class="btn sec" id="msv">保存语音样本：${localStorage.getItem('ylj_savevoice') === '1' ? '开' : '关'}</button>
    <button class="btn sec" id="mss">保存扫描图片：${localStorage.getItem('ylj_savescan') === '1' ? '开' : '关'}</button>` : ''}
    ${WEB ? `<button class="btn sec" id="mdl">离线语音/扫描模型：${WebASR.info().s === 2 ? '已就绪' : '点这里下载（约 92MB，建议连 Wi-Fi）'}</button>` : ''}
    <button class="btn danger" id="m3">清空本机${ML()}读数</button>
    <button class="btn sec" id="m4">关闭</button>`, m => {
    m.querySelector('#m1').onclick = () => { m.remove(); exportXlsx(); };
    m.querySelector('#m2').onclick = () => { m.remove(); overview(); };
    m.querySelector('#m3').onclick = () => {
      if (!confirm('确定清空本机' + ML() + '读数？建议先导出 Excel 备份。')) return;
      if (!confirm('再次确认：清空后无法恢复。')) return;
      delete S.m[S.month]; setMonth(S.month); m.remove(); home(); toast('已清空' + ML() + '读数（表格里原有的读数保留）');
    };
    m.querySelector('#m4').onclick = () => m.remove();
    const tg = (id, key, label, fn, where) => { const x = m.querySelector(id); if (!x) return; x.onclick = () => { const on = localStorage.getItem(key) !== '1'; localStorage.setItem(key, on ? '1' : '0'); x.textContent = label + '：' + (on ? '开' : '关'); syncSave(); if (on) toast('已开启，文件保存在 手机存储/Download/' + where); }; };
    tg('#msv', 'ylj_savevoice', '保存语音样本', null, '抄水表语音样本/');
    tg('#mss', 'ylj_savescan', '保存扫描图片', null, '抄水表扫描样本/');
    m.querySelector('#m5').onclick = () => { m.remove(); importScreen(); };
    const mdl = m.querySelector('#mdl'); if (mdl) mdl.onclick = () => { WebASR.init(); WebScan.preload(); m.remove(); toast('正在后台下载语音和扫描模型，进度见“点击开始说话”按钮', 4000); };
    m.querySelector('#m6').onclick = () => { m.remove(); monthScreen(true); };
    const mt = m.querySelector('#mt');
    if (mt) {
      mt.onclick = () => { T.on = !T.on; saveT(); mt.textContent = '语音播报：' + (T.on ? '开' : '关'); m.querySelector('#ttsOpts').classList.toggle('hidden', !T.on); if (T.on) speak('语音播报已打开'); else stopSpeak(); };
      const mr = m.querySelector('#mr');
      mr.oninput = () => { T.rate = +mr.value; m.querySelector('#mrv').textContent = T.rate.toFixed(1); saveT(); };
      mr.onchange = () => speak('一二三');
    }
  });
}
$('#btnMenu').textContent = '菜单';
$('#btnMenu').onclick = menu;

// ---- 语音读数解析：一二二一 / 一千二百二十一 / 两千零一十 / 幺洞… ----
function parseSpoken(text) {
  let t = String(text || '').replace(/\s+/g, '').replace(/[，。,.、!！?？:：;；"'“”]/g, '');
  let cmd = null;
  const OK = /确定|确认|确订|却定|雀定|缺定|确的|好了|保存/, DEL = /删除|删掉|重来|重外|窗外|重新来|清除|清空|重说/, NEXT = /下一个|下一只|下一户|跳过/;
  if (DEL.test(t)) cmd = 'del'; else if (OK.test(t)) cmd = 'ok'; else if (NEXT.test(t)) cmd = 'next';
  t = t.replace(new RegExp([OK, DEL, NEXT].map(r => r.source).join('|'), 'g'), '').replace(/\[unk\]/g, '');
  t = t.replace(/[幺妖腰么夭]/g, '一').replace(/[洞〇oO令玲灵铃龄领]/g, '零').replace(/[两俩]/g, '二').replace(/[散伞]/g, '三')
       .replace(/[武舞午伍]/g, '五').replace(/[陆溜]/g, '六').replace(/拐/g, '七').replace(/[吧巴]/g, '八').replace(/[勾久酒]/g, '九')
       .replace(/[衣依医]/g, '一').replace(/[而儿尔耳]/g, '二').replace(/[山]/g, '三').replace(/[是死似寺]/g, '四').replace(/[期奇其起]/g, '七');
  t = t.replace(/\d/g, d => '零一二三四五六七八九'[d]);
  t = t.replace(/[^零一二三四五六七八九十百千万]/g, '');
  if (!t) return {digits: '', cmd};
  const D = '零一二三四五六七八九';
  if (!/[十百千万]/.test(t)) return {digits: [...t].map(c => D.indexOf(c)).join(''), cmd};
  const U = {'十': 10, '百': 100, '千': 1000};
  const sec = s => {
    let val = 0, pend = null, last = 0, zero = false;
    for (const c of s) {
      const d = D.indexOf(c);
      if (d === 0) { zero = true; pend = null; continue; }
      if (d > 0) { pend = d; continue; }
      const u = U[c]; val += (pend == null ? 1 : pend) * u; last = u; pend = null; zero = false;
    }
    if (pend != null) val += (last >= 100 && !zero) ? pend * last / 10 : pend; // 九百五 → 950；一千零五 → 1005
    return val;
  };
  const parts = t.split('万'); let n;
  if (parts.length > 2) return {digits: '', cmd, err: '听不懂'};
  if (parts.length === 2) { const lo = parts[1]; n = sec(parts[0] || '一') * 10000 + (lo && !/[十百千零]/.test(lo) && lo.length === 1 ? D.indexOf(lo) * 1000 : sec(lo)); }
  else n = sec(t);
  return {digits: String(n), cmd};
}
window.__parseSpoken = parseSpoken; // 测试用
// ---- 语音输入：APK 用 Vosk 离线识别（AndroidBridge.startListen/stopListen），网页用 webkitSpeechRecognition ----
const WSR = window.webkitSpeechRecognition || window.SpeechRecognition || null;
function micAvailable() { if (AB) { try { return !!(AB.asrAvailable && AB.asrAvailable()); } catch (e) { return false; } } if (WEB && WebASR.supported()) return true; return !!WSR; }
const WEBASR = () => WEB && WebASR.supported();
let listening = false, wsr = null, asrGot = false;
function asrShow(t, cls) { const a = $('#asr'); if (!a) return; a.classList.remove('hidden'); a.className = 'asr ' + (cls || ''); a.textContent = t; }
window.__asrStatus = t => asrShow(t);
window.__asrPartial = t => { if (listening) asrShow('🎤 ' + (String(t).replace(/\s+/g, '') || '正在听…')); };
window.__asrError = m => { listening = false; micState = 'idle'; micLabel(); asrShow('⚠ ' + m, 'err'); };
// 语音按钮状态：idle 空闲 / start 正在打开麦克风 / rec 正在听 / busy 识别中
let micState = 'idle', micModel = {s: 0, p: 0, e: ''}, micDownAt = 0, micStartTimer = null;
function micLabel() {
  const b = $('#mic'); if (!b) return;
  b.classList.toggle('on', micState === 'rec' || micState === 'start');
  b.classList.toggle('busy', micState === 'busy');
  const notReady = (AB || WEBASR()) && micModel.s !== 2;
  b.classList.toggle('wait', !!notReady && micState === 'idle');
  b.textContent = micState === 'rec' ? '🔴 录音中…点击结束'
    : micState === 'start' ? '🎤 正在打开麦克风…'
    : micState === 'busy' ? '⏳ 识别中…'
    : notReady ? (micModel.s === -1 ? '⚠ 语音不可用（点这里查看原因）' : '⏳ 语音准备中 ' + (micModel.p || 0) + '%')
    : '🎤 点击开始说话';
}
window.__asrModel = (s, p, e) => { micModel = {s, p, e}; micLabel(); if (s === -1) asrShow('⚠ 语音识别不可用：' + e + '。请用数字键，或退出 App 重新打开', 'err'); };
window.__asrRec = () => { clearTimeout(micStartTimer); micState = 'rec'; listening = true; micLabel(); asrShow('🎤 正在听…说读数（可再说“确定”），说完点一下按钮结束'); };
window.__asrLevel = lv => { if (micState !== 'rec') return; const n = Math.max(1, Math.round(lv / 12)); asrShow('🎤 正在听 ' + '▮'.repeat(Math.min(8, n)) + '▯'.repeat(Math.max(0, 8 - n)) + '  说完点一下按钮结束'); };
window.__asrBusy = () => { micState = 'busy'; micLabel(); asrShow('⏳ 识别中…'); };
window.__asrIdle = m => { clearTimeout(micStartTimer); listening = false; micState = 'idle'; micLabel(); if (m) asrShow(m); };
window.__asrResult = text => {
  listening = false; asrGot = true; micState = 'idle'; micLabel();
  if (!cur) return;
  const raw = String(text || '').replace(/\s+/g, ''), r = parseSpoken(raw);
  const anom = document.querySelector('.mask .anom');
  if (anom) { // 读数异常提示框开着：需要第二次“确定”才保存
    const m = anom.closest('.mask');
    if (r.cmd === 'ok' && !r.digits) { asrShow('听到：确定（已复核）→ 保存', 'ok'); m.querySelector('#s1').click(); }
    else if (r.cmd === 'del') { asrShow('听到：删除，请重新输入'); m.querySelector('#s2').click(); }
    else if (r.digits) { m.remove(); applyVoiceDigits(raw, r); }
    else asrShow(raw ? '没听清（' + raw + '）。读数无误请说“确定”，要重输请说“删除”' : '没听到声音', 'err');
    return;
  }
  if (r.digits) applyVoiceDigits(raw, r);
  else if (r.cmd === 'del') { buf = ''; refresh(); asrShow('听到：删除，已清空，请重新说读数'); speak('已清空'); }
  else if (r.cmd === 'ok') { asrShow('听到：确定'); confirmV(); }
  else if (r.cmd === 'next') { asrShow('听到：下一个'); const n = $('#next'); n && n.click(); }
  else asrShow(raw ? '没听清（' + raw + '），请再说一次' : '没听到声音，请按住按钮再说', 'err');
};
function applyVoiceDigits(raw, r) {
  const d = r.digits.slice(0, 6); buf = d; refresh();
  if (r.cmd === 'del') { buf = ''; refresh(); asrShow('听到：' + raw + ' → 已清空'); return; }
  if (r.cmd === 'ok') { asrShow('听到：' + raw + ' → ' + d + ' 并确定', 'ok'); speak(digitsCN(d)); confirmV(); return; }
  asrShow('听到：' + raw + ' → ' + d + '　核对无误请说“确定”或点“确认”', 'ok');
  speak(digitsCN(d));
}
// ---- 拍照识别：APK 内置离线文字识别（ML Kit），只取数字 ----
function ocrAvailable() { if (AB) { try { return !!(AB.ocrAvailable && AB.ocrAvailable()); } catch (e) { return false; } } return !!(window.WebScan && WebScan.supported()); }
function startOcr() { if (!AB) { if (!window.WebScan) return; let pv = null; try { pv = cur ? prevOf(cur.b, FLOORS[cur.b][cur.f][cur.i]).v : null; } catch (e) {} stopTorch(); stopSpeak(); asrShow('📷 打开扫描…'); WebScan.open(pv == null ? null : String(pv)); return; } asrShow('📷 打开扫描…'); let pv = null; try { pv = cur ? prevOf(cur.b, FLOORS[cur.b][cur.f][cur.i]).v : null; } catch (e) {} try { if (AB.startOcrPrev) AB.startOcrPrev(pv == null ? '' : String(pv)); else AB.startOcr(); } catch (e) { __ocrError('打不开相机：' + (e.message || e)); } }
window.__ocrError = m => asrShow('⚠ ' + m, 'err');
const OCRMAP = {O: '0', o: '0', D: '0', Q: '0', U: '0', I: '1', l: '1', i: '1', '|': '1', L: '1', T: '7', Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', b: '6', g: '9', q: '9'};
// 输入：识别出的文字块 [{t,h,x,y,w}]；输出：按可能性排序的数字串
function pickDigits(els, prev) {
  const toks = [];
  for (const e of els || []) {
    const t = String(e.t || ''); let dig = 0, out = '';
    for (const c of t) { if (/\d/.test(c)) { dig++; out += c; } else if (OCRMAP[c] != null) out += OCRMAP[c]; else if (/[.,:'’\-·]/.test(c)) out += ' '; else out += ' '; }
    if (!dig) continue;
    out.split(/\s+/).filter(Boolean).forEach(g => toks.push({g, h: +e.h || 0, x: +e.x || 0, y: +e.y || 0, w: +e.w || 0}));
  }
  // 同一行、高度相近、挨得近的数字拼起来（水表每个字轮可能被分开识别）
  toks.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const t of toks) {
    const r = rows.find(r => Math.abs(r.y - t.y) < Math.max(r.h, t.h) * 0.5 && Math.abs(r.h - t.h) < Math.max(r.h, t.h) * 0.45);
    if (r) r.items.push(t); else rows.push({y: t.y, h: t.h, items: [t]});
  }
  const groups = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x); let curG = null;
    for (const t of r.items) {
      const cw = t.w / Math.max(1, t.g.length);
      if (curG && t.x - curG.end < Math.max(cw, curG.cw) * 1.6) { curG.g += t.g; curG.end = t.x + t.w; curG.h = Math.max(curG.h, t.h); }
      else { curG = {g: t.g, end: t.x + t.w, h: t.h, cw}; groups.push(curG); }
    }
    groups.push(...r.items.map(t => ({g: t.g, h: t.h}))); // 单独的块也作为候选
  }
  const seen = {}, cands = [];
  // 水表一排里常是 黑色整数(4–5位)+红色小数：长串再拆出前 4/5 位（或和上次读数同样位数）作候选
  const pl = prev != null && prev !== '' ? String(+prev).length : 0;
  for (const g of groups.slice()) if (g.g.length >= 6) for (const k of [pl, 5, 4]) if (k >= 3 && k < g.g.length) groups.push({g: g.g.slice(0, k), h: g.h * 0.95, cut: 1});
  for (const g of groups) {
    const s = g.g; if (!s || seen[s]) continue; seen[s] = 1;
    const L = s.length; let sc = (g.h || 1) * (L >= 4 && L <= 5 ? 1.6 : L === 3 || L === 6 ? 1.1 : L > 6 ? 0.5 : 0.4);
    if (prev != null && prev !== '') { const v = +s, p = +prev; if (v >= p && v - p < 300) sc *= 2.5; else if (String(p).length === String(v).length) sc *= 1.2; }
    cands.push({s, sc});
  }
  cands.sort((a, b) => b.sc - a.sc);
  return cands.map(c => c.s);
}
window.__pickDigits = pickDigits;
window.__ocrResult = (json, reading) => {
  if (json == null) { asrShow('已取消拍照'); return; }
  if (!cur) return;
  let els = []; try { els = JSON.parse(json); } catch (e) {}
  const {b, f, i} = cur, room = FLOORS[b][f][i], pv = prevOf(b, room).v;
  const c = pickDigits(els, pv);
  if (reading) { const k = c.indexOf(reading); if (k > 0) c.splice(k, 1); if (k !== 0) c.unshift(reading); }
  if (!c.length) { asrShow('没认出数字。请靠近一点、对准黑框、打开手电再扫', 'err'); return; }
  buf = c[0].slice(0, 6); refresh(); speak(digitsCN(buf));
  const a = $('#asr'); asrShow('');
  a.className = 'asr ok';
  a.innerHTML = '扫描识别：<b>' + esc(buf) + '</b>　请核对，无误说“确定”或点确认；不对按数字键改，或点下面其它结果 / <button id="retake">重新扫描</button>' +
    (c.length > 1 ? '<div class="chips">' + c.slice(1, 5).map(x => '<button data-v="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div>' : '');
  a.querySelectorAll('.chips button').forEach(x => x.onclick = () => { buf = x.dataset.v.slice(0, 6); refresh(); speak(digitsCN(buf)); });
  const rt = a.querySelector('#retake'); rt && (rt.onclick = startOcr);
};
function syncSave() { if (!AB) return; try { AB.setSaveVoice && AB.setSaveVoice(localStorage.getItem('ylj_savevoice') === '1'); AB.setSaveScan && AB.setSaveScan(localStorage.getItem('ylj_savescan') === '1'); } catch (e) {} }
syncSave();
function startMic() {
  if (micState !== 'idle') return; asrGot = false;
  stopSpeak();
  if (AB) {
    try { if (AB.asrInfo) micModel = JSON.parse(AB.asrInfo()); } catch (e) {}
    if (micModel.s === -1) { micLabel(); asrShow('⚠ 语音识别不可用：' + (micModel.e || '未知原因') + '。请用数字键', 'err'); try { AB.startListen(); } catch (e) {} return; }
    if (micModel.s !== 2) { micLabel(); asrShow('⏳ 语音准备中 ' + (micModel.p || 0) + '%，第一次打开要等一会儿，可以先用数字键'); try { AB.startListen(); } catch (e) {} return; }
    micState = 'start'; listening = true; micLabel();
    clearTimeout(micStartTimer); micStartTimer = setTimeout(() => { if (micState === 'start') __asrIdle('麦克风没有打开，请再点一次'); }, 4000);
    try { AB.startListen(); } catch (e) { __asrError('启动语音识别失败：' + (e.message || e)); }
    return;
  }
  if (WEBASR()) {
    micModel = WebASR.info();
    if (micModel.s !== 2) { WebASR.init(); micModel = WebASR.info(); micLabel(); asrShow(micModel.s === -1 ? '⚠ 语音识别不可用：' + (micModel.e || '') : '⏳ 语音准备中 ' + (micModel.p || 0) + '%，第一次要下载约 79MB（建议连 Wi-Fi），可以先用数字键'); return; }
    micState = 'start'; listening = true; micLabel();
    WebASR.start().catch(e => __asrError('启动语音识别失败：' + (e.message || e)));
    return;
  }
  listening = true; micState = 'rec'; micLabel(); asrShow('🎤 正在听…');
  try {
    wsr = new WSR(); wsr.lang = 'zh-CN'; wsr.interimResults = true; wsr.continuous = false; let fin = '';
    wsr.onresult = e => { let it = ''; fin = ''; for (const r of e.results) { if (r.isFinal) fin += r[0].transcript; else it += r[0].transcript; } __asrPartial(fin + it); wsr.__last = fin + it; };
    wsr.onerror = e => { if (e.error === 'not-allowed') __asrError('没有麦克风权限，请在浏览器设置里允许使用麦克风'); else if (e.error !== 'aborted' && e.error !== 'no-speech') __asrError('语音识别出错：' + e.error); };
    wsr.onend = () => { if (!asrGot) __asrResult(wsr && wsr.__last || ''); };
    wsr.start();
  } catch (e) { __asrError('这个浏览器不支持语音输入'); }
}
function stopMic() {
  if (micState !== 'rec' && micState !== 'start') return;
  if (AB) { try { AB.stopListen(); } catch (e) {} return; }
  if (WEBASR()) { WebASR.stop(); return; }
  try { wsr && wsr.stop(); } catch (e) {}
}
// 点一下开始说话，再点一下结束（不会自动停，最长 60 秒）
function bindMic() {
  const b = $('#mic'); if (!b) return; try { if (AB && AB.asrInfo) micModel = JSON.parse(AB.asrInfo()); } catch (e) {} if (WEBASR()) { WebASR.init(); micModel = WebASR.info(); } micLabel();
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); b.classList.add('press');
    if (micState === 'rec' || micState === 'start') stopMic(); else if (micState === 'idle') startMic();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => b.classList.remove('press')));
  ['touchstart', 'touchmove'].forEach(ev => b.addEventListener(ev, e => e.preventDefault(), {passive: false}));
  b.addEventListener('contextmenu', e => e.preventDefault());
  b.addEventListener('selectstart', e => e.preventDefault());
}
if (AB) setInterval(() => { try { if (AB.asrInfo) { const m = JSON.parse(AB.asrInfo()); if (m.s !== micModel.s || m.p !== micModel.p) { micModel = m; micLabel(); } } } catch (e) {} }, 1000);

// ---- 手电筒（安卓 Chrome 支持；iPhone 浏览器不支持，自动隐藏）----
let torchTrack = null, torchOn = false;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function torchAvailable() { if (AB) { try { return !!AB.torchAvailable(); } catch (e) { return false; } } return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext && localStorage.getItem('ylj_torch_no') !== '1'; }
async function toggleTorch() {
  const btn = $('#torch');
  if (AB) { let ok = false; try { ok = AB.setTorch(!torchOn); } catch (e) {} if (ok) { torchOn = !torchOn; btn && btn.classList.toggle('on', torchOn); } else toast('打不开手电，请用系统下拉菜单的手电筒'); return; }
  try {
    if (!torchTrack) {
      const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}});
      torchTrack = stream.getVideoTracks()[0];
      const v = $('#torchVideo'); v.srcObject = stream; v.play().catch(() => {});
      const caps = torchTrack.getCapabilities ? torchTrack.getCapabilities() : {};
      if (!caps.torch) { stopTorch(); localStorage.setItem('ylj_torch_no', '1'); btn && btn.classList.add('hidden'); return toast('这部手机的浏览器不支持开手电，请用系统下拉菜单的手电筒'); }
    }
    torchOn = !torchOn;
    await torchTrack.applyConstraints({advanced: [{torch: torchOn}]});
    if (!torchOn) stopTorch();
    btn && btn.classList.toggle('on', torchOn);
  } catch (e) {
    stopTorch(); btn && btn.classList.remove('on');
    toast(e && e.name === 'NotAllowedError' ? '需要允许使用相机，才能打开手电' : '打不开手电：' + (e && e.message || e));
  }
}
function stopTorch() {
  if (AB) { if (torchOn) { try { AB.setTorch(false); } catch (e) {} } torchOn = false; const b = $('#torch'); b && b.classList.remove('on'); return; }
  if (torchTrack) { try { torchTrack.stop(); } catch (e) {} }
  torchTrack = null; torchOn = false; const v = $('#torchVideo'); if (v) v.srcObject = null;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopTorch(); });

// ---- 离线 ----
if (!AB && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

D ? home() : importScreen();
