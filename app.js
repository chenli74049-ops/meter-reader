'use strict';
/* 英伦金沙 十月抄水表 PWA 原型 */
let D = null;               // 从导入的 Excel 得到：D[b] = {title, header, rows:[[房号,十二月,二月]]}
const BN = {1: '一栋', 2: '二栋', 3: '三栋'};
const KEY = 'ylj_meter_oct_v1', DKEY = 'ylj_meter_data_v1';
const $ = s => document.querySelector(s);
const view = $('#view');

// ---- 数据索引 ----
let INFO = {}, FLOORS = {};  // INFO[b][room] = {dec, feb}; FLOORS[b][f] = [room...]
function rebuild() {
  INFO = {}; FLOORS = {};
  for (const b of [1, 2, 3]) {
    INFO[b] = {}; FLOORS[b] = {};
    for (const r of (D && D[b] ? D[b].rows : [])) {
      INFO[b][r[0]] = {dec: r[1], feb: r[2]};
      const f = Math.floor(r[0] / 100);
      (FLOORS[b][f] = FLOORS[b][f] || []).push(r[0]);
    }
    for (const f in FLOORS[b]) FLOORS[b][f].sort((a, c) => a - c);
  }
}
try { D = JSON.parse(localStorage.getItem(DKEY)); } catch (e) { D = null; }
rebuild();

// ---- 存储 ----
let S = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.r) return s; } catch (e) {}
  return {r: {}, b: 1, created: Date.now()};
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('保存失败：手机存储空间不足？'); } }
const rec = (b, room) => S.r[b + '-' + room];

// ---- 校验 ----
function median(b) {
  const u = [];
  for (const k in S.r) if (k[0] == b) { const room = +k.slice(2), x = S.r[k].v - INFO[b][room].feb; if (x >= 0) u.push(x); }
  if (u.length < 5) return null;
  u.sort((a, c) => a - c); const m = u.length >> 1;
  return u.length % 2 ? u[m] : (u[m - 1] + u[m]) / 2;
}
function check(b, room, v) {
  const w = [], feb = INFO[b][room].feb, use = v - feb;
  if (v < feb) w.push('读数小于二月读数（' + feb + '），可能抄错或换表');
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
function ttsAvailable() { return !!synth && (!voicesLoaded || !!zhVoice); }
function ttsReason() { return !synth ? '这部手机的浏览器不支持语音播报' : '这部手机没有中文语音包，无法播报（可在系统设置 → 文字转语音 里下载中文语音）'; }
function speak(text, queue) {
  if (!T.on || !ttsAvailable() || !text) return;
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
  if (ttsUnlocked || !synth) return; ttsUnlocked = true;
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
window.__tts = {numCN, digitsCN, speak, T, ttsAvailable}; // 测试用

// ---- 首页：选栋/楼 ----
function home() {
  stopTorch();
  if (!D) return importScreen();
  const b = S.b || 1; const st = bStat(b);
  setHeader('英伦金沙 · 十月抄表', null);
  let h = '<div class="tabs">' + [1, 2, 3].map(i => `<button class="tab ${i == b ? 'on' : ''}" data-b="${i}">${i}栋</button>`).join('') + '</div>';
  h += `<div class="sum"><div style="flex:1">${BN[b]}：已抄 <b>${st.d}</b> / ${st.n} 户${st.w ? `，<span style="color:#dc2626">异常 ${st.w}</span>` : ''}<div class="bar"><i style="width:${(st.d / st.n * 100).toFixed(1)}%"></i></div></div></div>`;
  h += '<div class="floors">';
  for (let f = 24; f >= 1; f--) {
    const s = floorStat(b, f); if (!s.n) continue;
    const cls = s.done === s.n ? 'done' : s.done ? 'part' : '';
    h += `<button class="fl ${cls} ${s.bad ? 'warn' : ''}" data-f="${f}">${f}楼<small>${s.done}/${s.n}${s.bad ? ' ⚠' + s.bad : ''}</small></button>`;
  }
  h += '</div><div class="legend">白色＝未抄　黄色＝抄了一部分　绿色＝本层抄完　红框＝有异常读数<br>点楼层进入，从左到右依次是 01、02、03… 号表。数据只存在本机，记得定期“菜单 → 导出 Excel”备份。</div>';
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
  const rooms = FLOORS[b][f], room = rooms[i], inf = INFO[b][room], r = rec(b, room);
  setHeader(`${b}栋 ${f}楼`, home);
  let dots = rooms.map((rm, k) => { const x = rec(b, rm); const c = x ? (check(b, rm, x.v).length ? 'bad' : 'ok') : '';
    return `<button class="dot ${c} ${k == i ? 'cur' : ''}" data-i="${k}">${String(rm % 100).padStart(2, '0')}</button>`; }).join('');
  view.innerHTML = `
  <div class="where"><span class="room">${room}室</span><span class="pos">第 ${i + 1} / ${rooms.length} 只（从左数）</span></div>
  <div class="dots">${dots}</div>
  <div class="card">
    <div class="row"><span>二月读数</span><span class="prev">${inf.feb}</span></div>
    <div class="row" style="margin-top:4px"><span>十月读数</span><span id="state"></span></div>
    <div id="disp" class="disp"></div>
    <div class="row"><span>用量（十月−二月）</span><span id="use" class="usage">—</span></div>
  </div>
  <div id="alert" class="alert hidden"></div>
  <button id="note" class="notebtn"></button>
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
  $('#prev').onclick = () => i > 0 ? entry(b, f, i - 1) : toast('已经是本层第一只');
  $('#next').onclick = () => i < rooms.length - 1 ? entry(b, f, i + 1) : floorCheck(b, f);
  $('#chk').onclick = () => floorCheck(b, f);
  $('#torch').onclick = toggleTorch;
  $('#note').onclick = () => noteSheet(b, room);
  if (T.room) speak(digitsCN(room) + '室', true);
  refresh();
}
function refresh() {
  const {b, f, i} = cur, room = FLOORS[b][f][i], inf = INFO[b][room], r = rec(b, room);
  const d = $('#disp'), showV = buf !== '' ? +buf : (r ? r.v : null);
  d.textContent = buf !== '' ? buf : (r ? r.v : '请输入');
  d.className = 'disp ' + (buf === '' ? (r ? 'saved' : 'empty') : '');
  $('#state').innerHTML = r && buf === '' ? `<span style="color:#15803d">✓ 已保存${r.pre ? '（之前录入）' : ''}</span>` : (r ? '<span style="color:#b45309">正在修改…</span>' : '');
  const u = $('#use'), a = $('#alert');
  const partial = buf !== '' && buf.length < String(inf.feb).length;
  if (showV == null) { u.textContent = '—'; u.style.color = ''; a.classList.add('hidden'); }
  else {
    const w = check(b, room, showV); u.textContent = (showV - inf.feb) + ' 吨';
    u.style.color = w.length ? '#dc2626' : '#15803d';
    a.innerHTML = w.map(x => '⚠ ' + esc(x)).join('<br>'); a.classList.toggle('hidden', !w.length || partial);
    if (partial) u.style.color = '#94a3b8';
  }
  const n = r && r.n; $('#note').textContent = n ? '📝 备注：' + n : '＋ 添加备注（可选，如：表面模糊、字轮翻转）';
}
function key(k) {
  vibrate(10);
  if (k === 'del') { speak('删除'); buf = buf.slice(0, -1); return refresh(); }
  if (k === 'ok') return confirmV();
  if (buf.length >= 6) { speak('最多六位'); return toast('最多 6 位数'); }
  speak(CN[k]);
  if (buf === '0') buf = '';
  buf += k; refresh();
}
function confirmV() {
  const {b, f, i} = cur, rooms = FLOORS[b][f], room = rooms[i], r = rec(b, room);
  if (buf === '') {
    if (r) { speak(digitsCN(room) + '室，' + numCN(r.v) + (check(b, room, r.v).length ? '，读数异常，请复核' : '')); return advance(); }
    speak('请先输入读数'); return toast('请先输入读数');
  }
  const v = +buf, w = check(b, room, v);
  speak(digitsCN(room) + '室，' + numCN(v) + (w.length ? '，读数异常，请复核' : ''));
  const doSave = note => {
    S.r[b + '-' + room] = {v, n: note != null ? note : (r ? r.n : ''), t: Date.now()};
    save(); vibrate(w.length ? [40, 60, 40] : 20); buf = ''; advance();
  };
  if (!w.length) return doSave();
  vibrate([80, 50, 80]);
  sheet(`<div class="big" style="color:#dc2626">⚠ 读数异常</div>
    <div style="font-size:16px;line-height:1.6">${room}室　二月 ${INFO[b][room].feb} → 十月 <b>${v}</b><br>${w.map(esc).join('<br>')}</div>
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
  let rows = rooms.map((rm, k) => { const x = rec(b, rm), feb = INFO[b][rm].feb;
    if (!x) return `<tr class="miss" data-i="${k}"><td>${rm}</td><td>${feb}</td><td>未抄</td><td>—</td><td></td></tr>`;
    const w = check(b, rm, x.v);
    return `<tr class="${w.length ? 'bad' : ''}" data-i="${k}"><td>${rm}</td><td>${feb}</td><td><b>${x.v}</b></td><td>${x.v - feb}</td><td style="font-size:12px;text-align:left">${w.length ? '⚠ ' : ''}${esc(x.n)}</td></tr>`; }).join('');
  const ok = s.done === s.n;
  const up = FLOORS[b][f + 1] ? f + 1 : null, dn = FLOORS[b][f - 1] ? f - 1 : null;
  view.innerHTML = `<div class="card"><div class="big" style="color:${ok ? '#15803d' : '#b45309'}">${ok ? '✓' : '!'} 本层应抄 ${s.n} 只，已抄 ${s.done} 只</div>
    ${ok ? '' : `<div style="color:#b45309">还差 ${s.n - s.done} 只（黄色行），点该行补录。</div>`}
    ${s.bad ? `<div style="color:#dc2626">有 ${s.bad} 只读数异常（红色行），请复核。</div>` : ''}</div>
    <table><tr><th>房号</th><th>二月</th><th>十月</th><th>用量</th><th>备注</th></tr>${rows}</table>
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
function parseWorkbook(wb) {
  const out = {}; let n = 0;
  for (const b of [1, 2, 3]) {
    const nm = wb.SheetNames.find(x => x === BN[b]) || wb.SheetNames.find(x => x.includes(BN[b]) && !x.includes('模版') && !x.includes('模板'));
    if (!nm) throw new Error('文件里找不到“' + BN[b] + '”工作表');
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nm], {header: 1, raw: true, defval: null});
    const rows = [], oct = [];
    const num = x => (x === null || x === '' || isNaN(+x)) ? null : +x;
    for (let i = 2; i < aoa.length; i++) {
      const a = aoa[i] || [], room = num(a[0]);
      if (!room || room < 100 || room % 1) continue;
      const feb = num(a[2]);
      rows.push([room, num(a[1]), feb]);
      if (num(a[6]) != null) oct.push([room, num(a[6]), a[9] == null ? '' : String(a[9])]);
    }
    if (!rows.length) throw new Error('“' + nm + '”里没有读到房号');
    const hdr = (aoa[1] || []).slice(0, 8).map(x => x == null ? null : String(x));
    out[b] = {title: aoa[0] && aoa[0][0] ? String(aoa[0][0]) : '英伦金沙' + BN[b] + '水表', header: hdr, rows, oct};
    n += rows.length;
  }
  return {data: out, n};
}
function importScreen() {
  stopTorch();
  setHeader('导入水表 Excel', D ? home : null);
  view.innerHTML = `<div class="card" style="font-size:16px;line-height:1.7">
    <div class="big">第一步：导入水表表格</div>
    请选择手机里的 <b>英伦金沙水表 .xlsx</b> 文件（需包含“一栋、二栋、三栋”工作表，A 列房号、C 列二月读数）。<br>
    文件只在这部手机里读取和保存，<b>不会上传</b>到任何地方。表格里已有的十月读数和备注会一起带入。
    ${D ? '<br><span style="color:#b45309">当前已导入：' + esc(S.src || '') + '，共 ' + [1, 2, 3].map(b => bStat(b).n).reduce((a, c) => a + c, 0) + ' 户。重新导入会更新房号和二月读数。</span>' : ''}
  </div>
  <input type="file" id="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" class="hidden">
  <button class="btn" id="pick">选择 Excel 文件</button>
  ${D ? '<button class="btn sec" id="cancel">取消</button>' : ''}
  <div id="impmsg" style="margin-top:10px;font-size:15px"></div>`;
  $('#pick').onclick = () => $('#file').click();
  if (D) $('#cancel').onclick = home;
  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const msg = $('#impmsg'); msg.textContent = '正在读取…';
    try {
      await waitXLSX();
      const wb = XLSX.read(await f.arrayBuffer(), {type: 'array'});
      const {data, n} = parseWorkbook(wb);
      const fileOct = []; for (const b of [1, 2, 3]) for (const o of data[b].oct) fileOct.push([b, ...o]);
      const apply = keep => {
        const newR = {};
        for (const [b, room, v, note] of fileOct) newR[b + '-' + room] = {v, n: note, t: 0, pre: 1};
        if (keep) for (const k in S.r) { const [b, room] = k.split('-').map(Number); if (data[b] && data[b].rows.some(r => r[0] === room)) newR[k] = S.r[k]; }
        for (const b of [1, 2, 3]) delete data[b].oct;
        D = data; localStorage.setItem(DKEY, JSON.stringify(D)); rebuild();
        S.r = newR; S.src = f.name; S.imported = Date.now(); save();
        toast(`导入成功：${n} 户，带入十月读数 ${Object.keys(newR).length} 条`, 3000); home();
      };
      const local = Object.keys(S.r).filter(k => !S.r[k].pre).length;
      if (D && local) {
        msg.textContent = '';
        sheet(`<div class="big">本机已有 ${local} 条手动录入的十月读数</div>
          <div style="font-size:16px;line-height:1.6">新文件共 ${n} 户，含十月读数 ${fileOct.length} 条。要怎么处理本机已录的读数？</div>
          <button class="btn" id="k1">保留本机读数（推荐）</button>
          <button class="btn danger" id="k2">丢弃本机读数，只用文件里的</button>
          <button class="btn sec" id="k3">取消导入</button>`, m => {
          m.querySelector('#k1').onclick = () => { m.remove(); apply(true); };
          m.querySelector('#k2').onclick = () => { if (confirm('确定丢弃本机已录的 ' + local + ' 条读数？')) { m.remove(); apply(false); } };
          m.querySelector('#k3').onclick = () => m.remove();
        });
      } else apply(false);
    } catch (err) { msg.innerHTML = '<span style="color:#dc2626">导入失败：' + esc(err.message || err) + '</span>'; }
    e.target.value = '';
  };
  window.scrollTo(0, 0);
}
function waitXLSX() { return new Promise((res, rej) => { let k = 0; const t = setInterval(() => { if (window.XLSX) { clearInterval(t); res(); } else if (++k > 100) { clearInterval(t); rej(new Error('表格组件加载失败')); } }, 100); }); }

// ---- 导出 Excel ----
function buildWorkbook() {
  const XL = window.XLSX, wb = XL.utils.book_new();
  for (const b of [1, 2, 3]) {
    const src = D[b], aoa = [[src.title], src.header.concat(['用量(十月-二月)', '备注'])];
    src.rows.forEach((r, k) => {
      const x = rec(b, r[0]), row = [r[0], r[1], r[2], null, null, null, null, null, null, null];
      if (x) {
        const n = k + 3, w = check(b, r[0], x.v);
        row[6] = x.v; row[8] = {t: 'n', v: x.v - r[2], f: `G${n}-C${n}`};
        row[9] = [w.length ? '【异常】' + w.join('；') : '', x.n].filter(Boolean).join(' ') || null;
      }
      aoa.push(row);
    });
    const ws = XL.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [{s: {r: 0, c: 0}, e: {r: 0, c: 6}}];
    ws['!cols'] = [{wch: 9}, {wch: 10}, {wch: 12}, {wch: 8}, {wch: 8}, {wch: 8}, {wch: 10}, {wch: 12}, {wch: 16}, {wch: 40}];
    XL.utils.book_append_sheet(wb, ws, BN[b]);
  }
  const ov = [['英伦金沙十月抄表进度总览', '', '', '', '导出时间：' + new Date().toLocaleString('zh-CN')], ['楼层', '一栋', '二栋', '三栋', '异常户数']];
  for (let f = 24; f >= 1; f--) {
    let bad = 0; const row = [f + '楼'];
    for (const b of [1, 2, 3]) { const s = floorStat(b, f); bad += s.bad; row.push(s.n ? `${s.done}/${s.n}` : '—'); }
    row.push(bad || ''); ov.push(row);
  }
  const tot = ['合计']; let tw = 0; for (const b of [1, 2, 3]) { const s = bStat(b); tw += s.w; tot.push(`${s.d}/${s.n}`); } tot.push(tw); ov.push(tot);
  const ws = XL.utils.aoa_to_sheet(ov); ws['!cols'] = [{wch: 8}, {wch: 10}, {wch: 10}, {wch: 10}, {wch: 26}];
  XL.utils.book_append_sheet(wb, ws, '进度总览');
  return wb;
}
async function exportXlsx() {
  if (!window.XLSX) return toast('导出组件还没加载好，请稍等再试');
  const d = new Date(), name = `英伦金沙水表_十月抄表_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.xlsx`;
  const wb = buildWorkbook();
  const data = XLSX.write(wb, {bookType: 'xlsx', type: 'array'});
  const blob = new Blob([data], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  try {
    const file = new File([blob], name, {type: blob.type});
    if (navigator.canShare && navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: name}); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  toast('已生成 ' + name);
}
window.__buildWorkbook = buildWorkbook; // 测试用

function menu() {
  if (!D) return importScreen();
  const st = [1, 2, 3].map(bStat), d = st.reduce((a, s) => a + s.d, 0), n = st.reduce((a, s) => a + s.n, 0);
  sheet(`<div class="big">菜单</div><div style="color:#475569">全部已抄 ${d} / ${n} 户</div>
    <button class="btn" id="m1">导出 Excel（含进度总览）</button>
    <button class="btn sec" id="m2">查看全部楼层进度</button>
    <button class="btn sec" id="m5">导入 Excel（更新房号/二月读数）</button>
    ${ttsAvailable() ? `<div class="tts">
      <button class="btn sec" id="mt">语音播报：${T.on ? '开' : '关'}</button>
      <div id="ttsOpts" class="${T.on ? '' : 'hidden'}">
        <label class="ttsrow">语速 <input type="range" id="mr" min="0.6" max="1.8" step="0.1" value="${T.rate}"> <span id="mrv">${(+T.rate).toFixed(1)}</span></label>
        <label class="ttsrow"><input type="checkbox" id="mroom" ${T.room ? 'checked' : ''}> 打开新表时播报房号</label>
      </div></div>` : `<div class="ttstip">🔇 ${ttsReason()}</div>`}
    <button class="btn danger" id="m3">清空本机全部十月读数</button>
    <button class="btn sec" id="m4">关闭</button>`, m => {
    m.querySelector('#m1').onclick = () => { m.remove(); exportXlsx(); };
    m.querySelector('#m2').onclick = () => { m.remove(); overview(); };
    m.querySelector('#m3').onclick = () => {
      if (!confirm('确定清空本机所有十月读数？建议先导出 Excel 备份。')) return;
      if (!confirm('再次确认：清空后无法恢复。')) return;
      S = {r: {}, b: 1, created: Date.now()}; save(); m.remove(); home(); toast('已清空十月读数（房号和二月读数保留）');
    };
    m.querySelector('#m4').onclick = () => m.remove();
    m.querySelector('#m5').onclick = () => { m.remove(); importScreen(); };
    const mt = m.querySelector('#mt');
    if (mt) {
      mt.onclick = () => { T.on = !T.on; saveT(); mt.textContent = '语音播报：' + (T.on ? '开' : '关'); m.querySelector('#ttsOpts').classList.toggle('hidden', !T.on); if (T.on) speak('语音播报已打开'); else if (synth) synth.cancel(); };
      const mr = m.querySelector('#mr');
      mr.oninput = () => { T.rate = +mr.value; m.querySelector('#mrv').textContent = T.rate.toFixed(1); saveT(); };
      mr.onchange = () => speak('一千二百二十一');
      m.querySelector('#mroom').onchange = e => { T.room = e.target.checked; saveT(); };
    }
  });
}
$('#btnMenu').textContent = '菜单';
$('#btnMenu').onclick = menu;

// ---- 手电筒（安卓 Chrome 支持；iPhone 浏览器不支持，自动隐藏）----
let torchTrack = null, torchOn = false;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function torchAvailable() { return !isIOS && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext && localStorage.getItem('ylj_torch_no') !== '1'; }
async function toggleTorch() {
  const btn = $('#torch');
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
  if (torchTrack) { try { torchTrack.stop(); } catch (e) {} }
  torchTrack = null; torchOn = false; const v = $('#torchVideo'); if (v) v.srcObject = null;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopTorch(); });

// ---- 离线 ----
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

D ? home() : importScreen();
