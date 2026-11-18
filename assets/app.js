(() => {
'use strict';
const API = 'api.php';
const $ = (sel, root = document) => root.querySelector(sel);
const SVGNS = 'http://www.w3.org/2000/svg';
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k);
  return n;
}
function s(tag, attrs) { const n = document.createElementNS(SVGNS, tag); if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; }
function rnd() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SPEED = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.15 : 1;
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800); }
function confirmClick(btn, label, fn) {
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; fn(); return; }
    btn.dataset.orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 3500);
  });
}

/* ---------- API ---------- */
const st = { view: 'entry', pub: null, pubErr: null, admin: null, isAdmin: false, csrf: null, meChecked: false };
async function api(action, body) {
  const opt = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'fetch' } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (st.csrf) opt.headers['X-CSRF-Token'] = st.csrf;
  let res, j;
  try { res = await fetch(`${API}?a=${encodeURIComponent(action)}`, opt); } catch { throw { status: 0, message: 'サーバーに接続できません。通信環境を確認してください。' }; }
  try { j = await res.json(); } catch { throw { status: res.status, message: 'サーバーの応答を読み取れませんでした。' }; }
  if (!res.ok || !j.ok) {
    if (res.status === 401 && action !== 'login') { st.isAdmin = false; st.csrf = null; }
    throw { status: res.status, message: j.error || 'エラーが発生しました。' };
  }
  return j;
}

/* ---------- 設定まわり ---------- */
const cfg = () => (st.admin && st.admin.config) || { top: [], lower: [] };
function prizes() {
  const c = cfg();
  const top = (c.top || []).filter(p => p.name).map(p => ({ id: p.id, name: p.name, note: p.note || '', tier: 'top', count: 1 }));
  const low = (c.lower || []).filter(p => p.name).map(p => ({ id: p.id, name: p.name, tier: 'lower', count: Math.min(3, Math.max(1, Number(p.count) || 1)) }));
  return c.order === 'lower-first' ? [...low, ...top] : [...top, ...low];
}
const topPrizes = () => prizes().filter(p => p.tier === 'top');
const entries = () => (st.admin ? st.admin.entries : []);
const draws = () => (st.admin ? st.admin.draws : {});
function prizeName(id) { const p = prizes().find(x => x.id === id); return p ? p.name : '（削除された賞品）'; }
const entryUrl = () => location.origin + location.pathname;

/* ---------- ルーティングと定期更新 ---------- */
let pollT = null;
function route() {
  const v = (location.hash || '#entry').slice(1);
  const name = ['entry', 'admin', 'stage'].includes(v) ? v : 'entry';
  for (const m of document.querySelectorAll('.view')) m.classList.toggle('on', m.id === 'view-' + name);
  const prev = st.view; st.view = name;
  if (name === 'stage' && prev !== 'stage') stage.enter();
  if (name !== 'stage' && prev === 'stage') stage.leave();
  render();
  refresh();
}
async function refresh() {
  clearTimeout(pollT);
  try {
    if (st.view === 'entry') { st.pub = await api('state'); st.pubErr = null; }
    else {
      if (!st.meChecked) { const me = await api('me'); st.isAdmin = me.admin; st.csrf = me.csrf; st.meChecked = true; }
      if (st.isAdmin) st.admin = await api('admin_state');
    }
  } catch (e) {
    if (st.view === 'entry') st.pubErr = e.message;
  }
  render();
  pollT = setTimeout(() => { if (document.hidden) { pollT = setTimeout(refresh, 2000); return; } refresh(); }, st.view === 'entry' ? 5000 : 4000);
}
function render() {
  if (st.view === 'entry') renderEntry();
  else { renderLogin(); if (st.view === 'admin') renderAdmin(); else stage.refresh(); }
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

/* ---------- 幹事ログイン ---------- */
function renderLogin() {
  const view = $('#view-' + st.view), slot = $('.login-slot', view);
  const need = st.meChecked && !st.isAdmin;
  if (need && !slot.firstElementChild) {
    const form = $('#tpl-login').content.firstElementChild.cloneNode(true);
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const msg = $('[role=status]', form), btn = $('button', form);
      btn.disabled = true; msg.textContent = '確認中…';
      try {
        const r = await api('login', { password: form.password.value });
        st.csrf = r.csrf; st.isAdmin = true; form.password.value = ''; msg.textContent = '';
        slot.replaceChildren(); refresh();
      } catch (e) { msg.textContent = e.message; }
      finally { btn.disabled = false; }
    });
    slot.replaceChildren(form);
    setTimeout(() => form.password.focus(), 0);
  }
  if (!need) slot.replaceChildren();
}

/* ---------- 応募画面 ---------- */
let entrySel = null, nameTouched = false, saving = false;
$('#e-name').addEventListener('input', () => { nameTouched = true; });
$('#e-choices').addEventListener('change', e => { if (e.target.name === 'choice') entrySel = e.target.value; });
function renderEntry() {
  const p = st.pub, stEl = $('#e-status');
  stEl.className = 'msg'; stEl.textContent = '';
  let lock = false;
  if (!p) {
    if (st.pubErr) { stEl.classList.add('warn'); stEl.textContent = st.pubErr; } else stEl.textContent = '読み込み中です…';
    for (const i of $('#e-form').querySelectorAll('input,button')) i.disabled = true;
    return;
  }
  if (st.pubErr) { stEl.classList.add('warn'); stEl.textContent = st.pubErr; }
  $('#e-title').textContent = p.title; document.title = p.title;
  const mine = p.mine;
  if (mine && !nameTouched && !$('#e-name').value) $('#e-name').value = mine.name;
  if (mine && entrySel == null) entrySel = mine.choice;
  $('#e-no').textContent = p.no ? String(p.no).padStart(3, '0') : '---';

  const box = $('#e-choices'); box.replaceChildren();
  if (!p.top.length) box.append(h('p', { class: 'fine' }, '景品はただいま準備中です。'));
  for (const t of p.top) {
    box.append(h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'choice', value: t.id, checked: entrySel === t.id }),
      h('span', { class: 'c-name' }, t.name),
      h('span', { class: 'c-count' }, `希望 ${p.counts[t.id] || 0}人`),
      t.note ? h('span', { class: 'c-note' }, t.note) : null));
  }
  const lb = $('#e-lower'); lb.replaceChildren();
  if (p.lower.length) lb.append(h('h2', null, '下位賞品は全員が抽選対象'), h('ul', null, p.lower.map(l => h('li', null, `${l.name}（${l.count}名）`))));

  if (!st.pubErr) {
    if (!p.entryOpen) { stEl.classList.add('warn'); stEl.textContent = mine ? `受付は締め切りました。あなたの希望は「${p.top.find(t => t.id === mine.choice)?.name || '—'}」です。` : '受付は締め切りました。'; lock = true; }
    else if (mine) { stEl.classList.add('ok'); stEl.textContent = `応募済みです。希望：${p.top.find(t => t.id === mine.choice)?.name || '—'}`; }
  } else if (!p.entryOpen) lock = true;
  for (const i of $('#e-form').querySelectorAll('input,button')) i.disabled = lock || saving;
  $('#e-submit').textContent = mine ? '希望を変更する' : 'この賞品で応募する';

  const wb = $('#e-win'); wb.replaceChildren();
  for (const r of p.results.filter(r => r.mine)) wb.append(h('div', { class: 'win' }, h('span', { class: 'hanko' }, '当選'), h('p', null, `「${r.prizeName}」が当たりました`)));
  const bb = $('#e-board'); bb.replaceChildren();
  if (p.results.length) bb.append(h('h2', null, '当選者発表'), h('dl', null, p.results.map(r => [h('dt', null, r.prizeName), h('dd', null, r.names.join('、'))])));
}
$('#e-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#e-name').value.trim();
  if (!name) { toast('お名前を入力してください'); $('#e-name').focus(); return; }
  if (!entrySel) { toast('上位賞品をひとつ選んでください'); return; }
  saving = true; renderEntry();
  try { await api('entry', { name, choice: entrySel }); nameTouched = false; toast('応募しました'); await refresh(); }
  catch (err) { toast(err.message); }
  finally { saving = false; renderEntry(); }
});

/* ---------- 幹事画面 ---------- */
let adminDirty = false, adminFilled = false, lastQr = null, lastCfg = '';
const newId = p => p + Date.now().toString(36) + Math.floor(rnd() * 1e4).toString(36);
function topRow(p, i) {
  return h('div', { class: 'row top', 'data-id': p.id },
    h('span', { class: 'idx' }, String(i + 1)),
    h('input', { type: 'text', class: 'p-name', value: p.name || '', placeholder: '賞品名', 'aria-label': `上位賞品${i + 1} 賞品名`, maxlength: '30' }),
    h('input', { type: 'text', class: 'p-note', value: p.note || '', placeholder: 'ひとこと説明（任意）', 'aria-label': `上位賞品${i + 1} 説明`, maxlength: '40' }),
    h('button', { class: 'btn small', type: 'button', onclick: e => { e.target.closest('.row').remove(); renumber(); adminDirty = true; } }, '削除'));
}
function lowRow(p) {
  return h('div', { class: 'row low', 'data-id': p.id },
    h('input', { type: 'text', class: 'p-name', value: p.name || '', placeholder: '賞品名', 'aria-label': '下位賞品 賞品名', maxlength: '30' }),
    h('select', { class: 'p-count', 'aria-label': '当選人数' }, [1, 2, 3].map(n => h('option', { value: n, selected: Number(p.count || 1) === n }, `当選 ${n}名`))),
    h('button', { class: 'btn small', type: 'button', onclick: e => { e.target.closest('.row').remove(); adminDirty = true; } }, '削除'));
}
function renumber() { [...$('#a-top').children].forEach((r, i) => { r.querySelector('.idx').textContent = String(i + 1); }); }
function fillAdminForm() {
  const c = cfg();
  $('#a-title').value = c.title || '';
  $('#a-top').replaceChildren(...(c.top || []).map(topRow));
  $('#a-low').replaceChildren(...(c.lower || []).map(lowRow));
  $('#a-order').value = c.order || 'top-first';
  $('#a-open').checked = !!c.entryOpen; $('#a-excl').checked = !!c.excludeWinners; $('#a-fall').checked = !!c.topFallbackAll;
}
$('#view-admin').addEventListener('input', e => { if (e.target.closest('[aria-labelledby="a-set-h"]')) adminDirty = true; });
$('#a-add-top').addEventListener('click', () => { $('#a-top').append(topRow({ id: newId('t') }, $('#a-top').children.length)); adminDirty = true; });
$('#a-add-low').addEventListener('click', () => { $('#a-low').append(lowRow({ id: newId('l'), count: 1 })); adminDirty = true; });
$('#a-save').addEventListener('click', async () => {
  const config = {
    title: $('#a-title').value.trim(), order: $('#a-order').value,
    entryOpen: $('#a-open').checked, excludeWinners: $('#a-excl').checked, topFallbackAll: $('#a-fall').checked,
    top: [...$('#a-top').children].map(r => ({ id: r.dataset.id, name: r.querySelector('.p-name').value.trim(), note: r.querySelector('.p-note').value.trim() })),
    lower: [...$('#a-low').children].map(r => ({ id: r.dataset.id, name: r.querySelector('.p-name').value.trim(), count: Number(r.querySelector('.p-count').value) })),
  };
  $('#a-save').disabled = true; $('#a-save-st').textContent = '保存中…';
  try { const r = await api('save_config', { config }); st.admin.config = r.config; adminDirty = false; fillAdminForm(); $('#a-save-st').textContent = '保存しました'; }
  catch (e) { $('#a-save-st').textContent = e.message; }
  finally { $('#a-save').disabled = false; }
});
$('#a-logout').addEventListener('click', async () => { try { await api('logout', {}); } catch {} st.isAdmin = false; st.csrf = null; st.admin = null; adminFilled = false; render(); });
function makeQr(box, size) {
  box.replaceChildren();
  if (window.QRCode) new window.QRCode(box, { text: entryUrl(), width: size, height: size, colorDark: '#1C2B22', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
  else box.append(h('p', { class: 'fine' }, 'QRコードを表示できませんでした。'));
}
$('#a-qr-big').addEventListener('click', () => {
  $('#qr-full-title').textContent = cfg().title || 'スマホで読み取って応募';
  makeQr($('#qr-full-code'), Math.min(window.innerWidth, window.innerHeight) * 0.55);
  $('#qr-full').hidden = false; $('#qr-close').focus();
});
$('#qr-close').addEventListener('click', () => { $('#qr-full').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#qr-full').hidden = true; });
$('#m-add').addEventListener('click', async () => {
  const name = $('#m-name').value.trim(), choice = $('#m-choice').value;
  if (!name) { toast('お名前を入力してください'); return; }
  try { await api('add_manual', { name, choice }); $('#m-name').value = ''; toast(`${name}さんを追加しました`); refresh(); }
  catch (e) { toast(e.message); }
});
confirmClick($('#a-reset-all'), '本当に消す（もう一度押す）', async () => { try { await api('reset_all', {}); toast('抽選結果を消しました'); refresh(); } catch (e) { toast(e.message); } });
confirmClick($('#a-purge'), '本当に削除する（もう一度押す）', async () => { try { await api('purge', {}); toast('応募データと結果を削除しました'); refresh(); } catch (e) { toast(e.message); } });

function renderAdmin() {
  $('#a-body').hidden = !st.isAdmin || !st.admin;
  if (!st.isAdmin || !st.admin) return;
  const cfgJson = JSON.stringify(st.admin.config);
  if (!adminFilled || (!adminDirty && cfgJson !== lastCfg)) { fillAdminForm(); adminFilled = true; }
  lastCfg = cfgJson;
  if (lastQr !== entryUrl()) {
    const wrap = $('#a-qr-wrap'), box = h('div', { class: 'qrbox' });
    wrap.replaceChildren(box, h('p', { class: 'url' }, entryUrl()));
    makeQr(box, 220); lastQr = entryUrl();
  }
  const list = entries(), tops = topPrizes();
  $('#a-count').textContent = `${list.length}名`;
  const counts = new Map(); for (const e of list) counts.set(e.choice, (counts.get(e.choice) || 0) + 1);
  $('#a-tally').replaceChildren(...tops.map(p => h('span', null, `${p.name}：${counts.get(p.id) || 0}人`)));
  $('#a-rows').replaceChildren(...list.map((e, i) => {
    const del = h('button', { class: 'btn small', type: 'button' }, '削除');
    confirmClick(del, 'もう一度押す', async () => { try { await api('delete_entry', { id: e.id }); refresh(); } catch (err) { toast(err.message); } });
    return h('tr', null, h('td', null, String(i + 1).padStart(3, '0')), h('td', null, e.name, e.manual ? h('span', { class: 'tag' }, '手入力') : null), h('td', null, prizeName(e.choice)), h('td', null, del));
  }));
  if (!list.length) $('#a-rows').append(h('tr', null, h('td', { colspan: '4' }, 'まだ応募はありません。QRコードを案内してください。')));
  const mc = $('#m-choice'), keep = mc.value;
  mc.replaceChildren(...tops.map(p => h('option', { value: p.id }, p.name)));
  if (keep && tops.some(p => p.id === keep)) mc.value = keep;

  $('#a-res').replaceChildren(...prizes().map(p => {
    const d = draws()[p.id];
    const status = !d ? '未抽選' : d.status === 'revealed' ? '発表済み' : 'あみだ作成済み（未発表）';
    const kids = [h('span', { class: 'who' }, p.name), h('span', { class: 'st' }, status)];
    if (d && d.status === 'revealed') kids.push(h('span', null, (d.winners || []).map(w => w.name).join('、')));
    if (d) {
      const b = h('button', { class: 'btn small', type: 'button' }, 'やり直す');
      confirmClick(b, 'もう一度押す', async () => { try { await api('reset', { prizeId: p.id }); toast(`${p.name}の結果を消しました`); refresh(); } catch (e) { toast(e.message); } });
      kids.push(b);
    }
    return h('li', null, kids);
  }));
}

/* ---------- あみだくじの形 ---------- */
const rowsFor = n => Math.max(9, Math.min(22, Math.round(n * 0.5) + 9));
function geom(n, rows) {
  const laneW = n <= 6 ? 150 : n <= 12 ? 104 : n <= 24 ? 74 : 58;
  const fs = Math.min(34, laneW * 0.52);
  const pad = 30, nameH = fs * 8.6 + 20, top = nameH + 18, rowH = 46;
  const bottom = top + rows * rowH + 24, slotH = 120;
  return { laneW, fs, pad, nameH, top, rowH, bottom, slotH, W: n * laneW + pad * 2, H: bottom + slotH, x: i => pad + laneW * (i + 0.5) };
}
const rungY = (g, rg) => g.top + 12 + rg.r * g.rowH + (0.15 + 0.7 * rg.y) * g.rowH;
function walk(d, g, start) {
  const map = new Map(); for (const rg of d.rungs) map.set(rg.r * 1000 + rg.i, rg);
  let pos = start; const pts = [[g.x(pos), g.top - 6]];
  for (let r = 0; r < d.rows; r++) {
    const right = map.get(r * 1000 + pos), left = pos > 0 ? map.get(r * 1000 + pos - 1) : undefined;
    const rg = right || left; if (!rg) continue;
    const y = rungY(g, rg); pts.push([g.x(pos), y]); pos = right ? pos + 1 : pos - 1; pts.push([g.x(pos), y]);
  }
  pts.push([g.x(pos), g.bottom]);
  return { end: pos, pts };
}
function winnerStarts(d) {
  const g = geom(d.candidates.length, d.rows);
  const ends = d.candidates.map((_, i) => walk(d, g, i).end);
  return d.slots.map(b => ends.indexOf(b));
}

/* ---------- 抽選会画面 ---------- */
const stage = (() => {
  const S = { idx: 0, phase: 'idle', draw: null, busy: false, excluded: new Set(), sig: '', g: null };
  const svg = $('#s-svg');
  const list = () => prizes();
  function cur() { const l = list(); if (S.idx >= l.length) S.idx = Math.max(0, l.length - 1); return l[S.idx]; }
  function pool(p) {
    const c = cfg(), base = entries();
    const taken = new Set();
    if (c.excludeWinners) for (const [pid, d] of Object.entries(draws())) if (pid !== p.id) for (const w of d.winners || []) taken.add(w.id);
    let cands = (p.tier === 'top' ? base.filter(e => e.choice === p.id) : base).filter(e => !taken.has(e.id));
    let fallback = false;
    if (p.tier === 'top' && !cands.length && c.topFallbackAll) { cands = base.filter(e => !taken.has(e.id)); fallback = true; }
    return { all: cands, cands: cands.filter(e => !S.excluded.has(e.id)), fallback };
  }
  function defs() {
    const d = s('defs'), f = s('filter', { id: 'chalk', x: '-5%', y: '-5%', width: '110%', height: '110%' });
    f.append(s('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.8', numOctaves: '2', seed: '3', result: 'n' }));
    f.append(s('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: '3.2' }));
    d.append(f); return d;
  }
  const FONT = "'Yusei Magic','Hiragino Maru Gothic ProN',sans-serif";
  // 縦書き用に1マスずつ分ける（2桁までの英数字は1マスにまとめる）
  function nameCells(name) {
    const cells = [];
    for (const m of String(name || '').matchAll(/[0-9A-Za-z]{1,2}|./gu)) {
      const ch = m[0];
      if (/^\s$/u.test(ch)) continue;
      cells.push(ch === 'ー' || ch === '－' || ch === '-' ? '｜' : ch);
    }
    return cells.slice(0, 8);
  }
  function draw(d, mode) {
    svg.replaceChildren(); $('#s-empty').hidden = true;
    const n = d.candidates.length;
    if (!n) { $('#s-empty').hidden = false; $('#s-empty').textContent = mode.emptyText || '抽選の対象になる人がいません'; return 0; }
    const g = geom(n, d.rows); S.g = g;
    svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
    svg.append(defs());
    const chalkLine = { stroke: 'var(--chalk)', 'stroke-width': 4, 'stroke-linecap': 'round', filter: 'url(#chalk)', opacity: '.9' };
    const lanes = s('g', chalkLine);
    const names = s('g', { fill: 'var(--chalk)', 'font-family': FONT, 'font-size': g.fs, 'text-anchor': 'middle' });
    d.candidates.forEach((c, i) => {
      lanes.append(s('line', { x1: g.x(i), y1: g.top - 6, x2: g.x(i), y2: g.bottom }));
      const chars = nameCells(c.name);
      chars.forEach((ch, j) => { const t = s('text', { x: g.x(i), y: g.top - 16 - (chars.length - 1 - j) * g.fs * 1.04 }); t.textContent = ch; names.append(t); });
    });
    svg.append(names, lanes);
    const rg = s('g', chalkLine); svg.append(rg);
    let ms = 0;
    if (mode.rungs !== 'none') {
      const order = mode.rungs === 'animate' ? shuffle(d.rungs) : d.rungs;
      const stagger = Math.min(30, 3200 / Math.max(order.length, 1)) * SPEED;
      order.forEach((r, k) => {
        const y = rungY(g, r), len = g.laneW;
        const ln = s('line', { x1: g.x(r.i), y1: y, x2: g.x(r.i + 1), y2: y }); rg.append(ln);
        if (mode.rungs === 'animate') {
          ln.style.strokeDasharray = len; ln.style.strokeDashoffset = len;
          ln.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 220 * SPEED + 1, delay: k * stagger, fill: 'forwards', easing: 'ease-out' });
        }
      });
      ms = order.length * stagger + 260 * SPEED;
      const slotG = s('g', { 'font-family': FONT, 'text-anchor': 'middle' }), win = new Set(d.slots || []);
      for (let i = 0; i < n; i++) {
        const cy = g.bottom + 52, x = g.x(i);
        if (win.has(i)) {
          const r = Math.min(g.laneW * 0.42, 40);
          slotG.append(s('circle', { cx: x, cy, r, fill: 'none', stroke: 'var(--chalk-pink)', 'stroke-width': 5, filter: 'url(#chalk)' }));
          const t = s('text', { x, y: cy + r * 0.42, fill: 'var(--chalk-yellow)', 'font-size': r * 1.2 }); t.textContent = '当'; slotG.append(t);
        } else slotG.append(s('line', { x1: x - 10, y1: cy, x2: x + 10, y2: cy, stroke: 'var(--chalk-dim)', 'stroke-width': 4, 'stroke-linecap': 'round', filter: 'url(#chalk)' }));
      }
      svg.append(slotG);
    }
    S.traceG = s('g', { fill: 'none', stroke: 'var(--chalk-pink)', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: 'url(#chalk)' });
    S.stampG = s('g'); svg.append(S.traceG, S.stampG);
    if (mode.rungs !== 'none' && !mode.revealed) {
      const cov = s('g', { id: 'cover' });
      const y0 = g.bottom + 6, hh = g.slotH - 12, x0 = g.pad - 10, ww = g.W - g.pad * 2 + 20;
      cov.append(s('rect', { x: x0, y: y0, width: ww, height: hh, fill: 'var(--cover)', rx: 3 }));
      for (const tx of [x0 + 20, x0 + ww - 80]) cov.append(s('rect', { x: tx, y: y0 - 12, width: 60, height: 24, fill: 'var(--tape)', transform: `rotate(${tx < g.W / 2 ? -6 : 6} ${tx + 30} ${y0})` }));
      const t = s('text', { x: g.W / 2, y: y0 + hh / 2 + 18, 'text-anchor': 'middle', fill: 'var(--cover-ink)', 'font-size': 48, 'font-family': FONT, 'letter-spacing': 12 });
      t.textContent = 'どこが当たり？'; cov.append(t); svg.append(cov);
    }
    S.draw = d;
    if (mode.traces) winnerStarts(d).forEach(i => { S.traceG.append(traceEl(d, i)); stampEl(i, false); });
    return ms;
  }
  function traceEl(d, start) {
    const pts = walk(d, S.g, start).pts.slice().reverse();
    return s('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') });
  }
  function stampEl(i, animate) {
    // 当選者の名前を赤チョークで囲む
    const g = S.g, x = g.x(i), n = nameCells(S.draw ? S.draw.candidates[i].name : '').length || 1;
    const y1 = g.top - 16 - (n - 1) * g.fs * 1.04 - g.fs * 1.05, y2 = g.top - 4;
    const w = Math.min(g.laneW * 0.86, g.fs * 1.9);
    const grp = s('g');
    grp.append(s('rect', { x: x - w / 2, y: y1, width: w, height: y2 - y1, rx: w / 2, fill: 'rgba(224,71,58,.16)', stroke: 'var(--stamp)', 'stroke-width': 6, filter: 'url(#chalk)' }));
    S.stampG.append(grp);
    if (animate) {
      grp.style.transformBox = 'fill-box'; grp.style.transformOrigin = 'center';
      grp.animate([{ transform: 'scale(1.8)', opacity: 0 }, { transform: 'scale(.95)', opacity: 1, offset: 0.75 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420 * SPEED + 1, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' });
    }
  }
  function head(p, info) {
    $('#s-tier').textContent = p ? (p.tier === 'top' ? '上位賞品' : '下位賞品') : '';
    $('#s-prize').textContent = p ? p.name : '景品が設定されていません';
    $('#s-meta').textContent = info || '';
  }
  function chips() {
    const box = $('#s-chips'); box.replaceChildren();
    list().forEach((p, i) => box.append(h('button', { class: 'chip' + (draws()[p.id]?.status === 'revealed' ? ' done' : ''), type: 'button', role: 'tab', 'aria-current': i === S.idx ? 'true' : 'false', onclick: () => select(i) }, h('small', null, p.tier === 'top' ? '上位' : '下位'), p.name)));
  }
  function candList(p) {
    const box = $('#s-cand-list'); box.replaceChildren();
    if (!p || S.phase !== 'idle') { $('#s-cands').hidden = true; return; }
    $('#s-cands').hidden = false;
    const { all } = pool(p);
    if (!all.length) box.append(h('p', { class: 'fine' }, '対象者がいません'));
    for (const e of all) box.append(h('label', null, h('input', { type: 'checkbox', checked: !S.excluded.has(e.id), onchange: ev => { if (ev.target.checked) S.excluded.delete(e.id); else S.excluded.add(e.id); S.sig = ''; refreshStage(); } }), e.name));
  }
  function controls() {
    const p = cur(), a = $('#s-action'), last = S.idx >= list().length - 1;
    $('#s-prev').disabled = S.busy || S.idx === 0; $('#s-next').disabled = S.busy || last;
    a.disabled = S.busy || !p;
    if (S.phase === 'idle') { a.textContent = 'あみだを引く'; if (p && !pool(p).cands.length) a.disabled = true; }
    else if (S.phase === 'drawn') a.textContent = '結果をめくる';
    else { a.textContent = last ? '抽選はすべて終了' : '次の景品へ'; if (last) a.disabled = true; }
  }
  function sigOf(p) {
    if (!p) return 'none';
    const d = draws()[p.id];
    if (d) return d.status + ':' + p.id + ':' + d.at;
    const pl = pool(p);
    return 'i:' + p.id + ':' + p.name + ':' + pl.cands.map(e => e.id + e.name).join(',') + ':' + pl.fallback;
  }
  function load() {
    const p = cur(); chips(); $('#s-banner').hidden = true;
    if (!p) { head(null, ''); svg.replaceChildren(); $('#s-empty').hidden = false; $('#s-empty').textContent = '幹事画面で景品を登録してください'; S.phase = 'idle'; controls(); candList(null); return; }
    const d = draws()[p.id];
    if (d && d.status === 'revealed') {
      S.phase = 'done'; S.draw = d;
      head(p, `当選 ${d.slots.length}名 ／ 候補 ${d.candidates.length}名`);
      draw(d, { rungs: 'static', revealed: true, traces: true });
      $('#s-names').textContent = (d.winners || []).map(w => w.name + ' さん').join('　'); $('#s-banner').hidden = false;
    } else if (d) {
      S.phase = 'drawn'; S.draw = d;
      head(p, `当選 ${d.slots.length}名 ／ 候補 ${d.candidates.length}名`);
      draw(d, { rungs: 'static', revealed: false });
    } else {
      S.phase = 'idle'; S.draw = null;
      const pl = pool(p), k = Math.min(p.count, pl.cands.length);
      head(p, pl.cands.length ? `当選 ${k}名 ／ 候補 ${pl.cands.length}名` + (pl.fallback ? '（希望者がいないため全員から）' : '') : '');
      draw({ candidates: pl.cands, rows: rowsFor(pl.cands.length), rungs: [], slots: [] }, { rungs: 'none', emptyText: p.tier === 'top' ? 'この賞品の希望者はいません' : '抽選の対象になる人がいません' });
    }
    S.sig = sigOf(p); candList(p); controls();
  }
  function refreshStage() {
    const ok = st.isAdmin && st.admin;
    for (const sel of ['.stage-top', '.frame', '.controls']) $('#view-stage ' + sel).hidden = !ok;
    if (!ok) return;
    if (S.busy) { chips(); return; }
    if (sigOf(cur()) !== S.sig) load(); else { chips(); controls(); }
  }
  function select(i) { if (S.busy) return; S.idx = Math.max(0, Math.min(i, list().length - 1)); S.excluded.clear(); S.sig = ''; load(); BGM.play('wait'); }
  async function doDraw() {
    const p = cur(); if (!p) return;
    S.busy = true; controls(); $('#s-cands').open = false;
    let d;
    try { d = (await api('draw', { prizeId: p.id, excluded: [...S.excluded] })).draw; }
    catch (e) { toast(e.message); S.busy = false; S.sig = ''; refresh(); return; }
    st.admin.draws[p.id] = d; S.draw = d; candList(null);
    head(p, `当選 ${d.slots.length}名 ／ 候補 ${d.candidates.length}名` + (d.fallback ? '（希望者がいないため全員から）' : ''));
    BGM.play('draw');
    const ms = draw(d, { rungs: d.status === 'revealed' ? 'static' : 'animate', revealed: d.status === 'revealed', traces: d.status === 'revealed' });
    await sleep(ms);
    BGM.play('wait');
    S.busy = false; S.phase = d.status === 'revealed' ? 'done' : 'drawn'; S.sig = sigOf(p); controls();
  }
  async function doReveal() {
    const p = cur(), d = S.draw; if (!p || !d) return;
    S.busy = true; controls();
    BGM.play('trace');
    const cov = svg.querySelector('#cover');
    if (cov) { cov.style.transformBox = 'fill-box'; cov.style.transformOrigin = 'top right'; await cov.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(40px, 160px) rotate(8deg)', opacity: 0 }], { duration: 700 * SPEED + 1, easing: 'ease-in', fill: 'forwards' }).finished; }
    await sleep(500 * SPEED);
    const starts = winnerStarts(d), names = [];
    for (let k = 0; k < starts.length; k++) {
      const path = traceEl(d, starts[k]); S.traceG.append(path);
      const L = path.getTotalLength();
      path.style.strokeDasharray = L; path.style.strokeDashoffset = L;
      await path.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: Math.min(6500, 2600 + L * 0.9) * SPEED + 1, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' }).finished;
      stampEl(starts[k], true);
      BGM.sting(k < starts.length - 1 ? 'trace' : 'wait');
      names.push(d.candidates[starts[k]].name + ' さん');
      $('#s-names').textContent = names.join('　'); $('#s-banner').hidden = false;
      await sleep(2500 * SPEED);
    }
    try { await api('reveal', { prizeId: p.id }); d.status = 'revealed'; d.revealedAt = Date.now(); }
    catch (e) { toast('結果を保存できませんでした：' + e.message); }
    S.busy = false; S.phase = 'done'; S.sig = sigOf(p); chips(); controls(); refresh();
  }
  function action() {
    if (S.busy) return;
    if (S.phase === 'idle') doDraw(); else if (S.phase === 'drawn') doReveal(); else select(S.idx + 1);
  }
  $('#s-action').addEventListener('click', action);
  $('#s-prev').addEventListener('click', () => select(S.idx - 1));
  $('#s-next').addEventListener('click', () => select(S.idx + 1));
  $('#s-bgm').addEventListener('click', e => { const on = !BGM.enabled; BGM.setEnabled(on); if (on) BGM.play('wait'); e.target.setAttribute('aria-pressed', String(on)); e.target.textContent = on ? 'BGMあり' : 'BGMなし'; });
  $('#s-vol').addEventListener('input', e => BGM.setVolume(e.target.value / 100));
  $('#s-full').addEventListener('click', () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    const v = $('#view-stage');
    if (v.requestFullscreen) v.requestFullscreen().catch(() => toast('全画面にできませんでした。F11キーなどをお使いください。'));
  });
  document.addEventListener('keydown', e => {
    if (st.view !== 'stage' || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'Enter' || e.key === ' ') { if (/BUTTON|A|SUMMARY/.test(e.target.tagName)) return; e.preventDefault(); action(); }
    else if (e.key === 'ArrowRight') select(S.idx + 1);
    else if (e.key === 'ArrowLeft') select(S.idx - 1);
  });
  return {
    enter() { S.sig = ''; BGM.play('wait'); },
    leave() { BGM.stop(); },
    refresh: refreshStage,
  };
})();

route();
})();
