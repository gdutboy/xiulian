// 账号同步：注册 / 登录后，孩子设备的数据自动备份到家里的 HB 服务器；本机数据丢了可以登录取回。
// 家长手机以「家长查看」登录时只读（见 viewer.js）。未登录时本模块什么都不做。
import { sanitize } from './store.js';

const KEY = 'xiulian.sync';
export const API = window.__xiulianSyncApi || 'https://xiulian-sync.gdutboy.xyz';

const blank = () => ({ username: '', token: '', role: '', serverRev: 0, lastSyncAt: null, lastError: '', localGen: 0, uploadedGen: 0, uploadedHash: '', conflict: null, authError: false });
function loadCfg() {
  try { return { ...blank(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return blank(); }
}
let cfg = loadCfg();
const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* 空间不足时忽略 */ } };

let hooks = null;       // { getState, replaceState, isEmpty, render, toast }
let ui = null;          // 界面子状态：{ mode: 'login'|'register'|'parent'|'merge'|'history'|'password'|'delete', ... }
let busy = false;
let bootToken = 0;

export const isViewer = () => !!cfg.token && cfg.role === 'parent';
export const loggedIn = () => !!cfg.token && cfg.role === 'child';
export const account = () => ({ username: cfg.username, role: cfg.role });
export const token = () => cfg.token;

// 内容哈希（不依赖 crypto.subtle，鸿蒙 rawfile 等非安全上下文也能用）
export function hashOf(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** 调用同步服务。返回 { status, data }；网络错误/超时抛异常。 */
export async function api(method, path, body, { timeout = 15000, keepalive = false, auth = true, signal } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, keepalive, cache: 'no-store' });
    let data = null;
    try { data = await r.json(); } catch { /* 无内容 */ }
    return { status: r.status, data };
  } finally { clearTimeout(timer); }
}

const errText = (r) => r?.data?.error || `服务器返回 ${r?.status}`;
const timeText = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s) => document.querySelector(s);

// ---------- 自动上传 ----------
let inFlight = false, again = false, debounce = null, retryTimer = null, backoff = 0;
const BACKOFF = [30e3, 120e3, 600e3];

function stateJSON() { return JSON.stringify(hooks.getState()); }
const pending = () => cfg.localGen > cfg.uploadedGen;

/** 请求一次同步（串行；在飞时只标记再来一次）。 */
export function requestSync(opts = {}) {
  if (!loggedIn() || !hooks || cfg.conflict || cfg.authError) return;
  if (inFlight) { again = true; return; }
  if (!pending()) return;
  upload(opts);
}

async function upload({ keepalive = false } = {}) {
  inFlight = true; again = false;
  clearTimeout(retryTimer); retryTimer = null;
  const gen = cfg.localGen;
  const json = stateJSON();
  try {
    const body = { baseRev: cfg.serverRev, data: JSON.parse(json) };
    const r = await api('PUT', '/v1/data', body, { keepalive: keepalive && json.length < 60000 });
    if (r.status === 200) {
      cfg.serverRev = r.data.rev; cfg.uploadedGen = Math.max(cfg.uploadedGen, gen); cfg.uploadedHash = hashOf(json);
      cfg.lastSyncAt = new Date().toISOString(); cfg.lastError = ''; backoff = 0;
    } else if (r.status === 409) {
      cfg.conflict = { rev: r.data?.rev, updatedAt: r.data?.updatedAt };
    } else if (r.status === 401) {
      cfg.authError = true; cfg.lastError = '登录已失效，请重新登录';
    } else {
      throw new Error(errText(r));
    }
  } catch (e) {
    cfg.lastError = e?.name === 'AbortError' ? '连接服务器超时' : (e?.message || '连不上服务器');
    retryTimer = setTimeout(() => requestSync(), BACKOFF[Math.min(backoff++, BACKOFF.length - 1)]);
  } finally {
    saveCfg();
    inFlight = false;
    refreshCard();
  }
  if (again || (pending() && !cfg.conflict && !cfg.authError && !retryTimer)) requestSync();
}

/** app.js 每次 persist() 后调用。 */
export function onPersist() {
  if (!loggedIn()) return;
  cfg.localGen++; saveCfg();
  clearTimeout(debounce);
  debounce = setTimeout(() => requestSync(), 3000);
}

function markPending() { cfg.localGen = cfg.uploadedGen + 1; saveCfg(); }

/** 用服务器/历史/文件里的数据替换本机。source: 'server-latest' | 'server-history' */
function replaceLocal(data, source, rev) {
  hooks.replaceState(sanitize(data));
  if (source === 'server-latest') {
    cfg.serverRev = rev; cfg.uploadedGen = cfg.localGen; cfg.uploadedHash = hashOf(stateJSON()); cfg.conflict = null;
  } else {
    markPending();
  }
  cfg.lastSyncAt = new Date().toISOString(); cfg.lastError = '';
  saveCfg();
  hooks.render();
  if (source !== 'server-latest') requestSync();
}

// 只在替换本机前用：把本机数据留一份，防误选
function backupLocal() {
  try { localStorage.setItem('xiulian.preSyncBackup', JSON.stringify({ at: new Date().toISOString(), state: hooks.getState() })); return true; } catch { return false; }
}

// ---------- 启动 ----------
export function initSync(h) {
  hooks = h;
  // 监听总是挂上（登录可能发生在启动之后）；requestSync 内部会判断是否已登录
  window.addEventListener('online', () => { clearTimeout(retryTimer); retryTimer = null; backoff = 0; requestSync(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) requestSync({ keepalive: true }); });
  if (!loggedIn()) return;
  // 防崩溃漏传：内容和上次成功上传的不一样，就补传
  if (!hooks.isEmpty() && hashOf(stateJSON()) !== cfg.uploadedHash && !pending()) markPending();
  setTimeout(() => requestSync(), 1000);
}

function waitingPage(text) {
  $('#app').innerHTML = `<div class="setup"><img src="icons/icon-192.png" class="setup-icon" alt=""><h2>${text}</h2><p class="sub">请稍等…</p></div>`;
  $('#tabs').innerHTML = '';
}

/** 启动时：已登录且本机没有数据 → 先从服务器取回。在第一次 render() 之前调用。 */
export async function bootRestore() {
  if (!loggedIn() || !hooks.isEmpty()) return;
  const my = ++bootToken;
  waitingPage('正在从服务器恢复…');
  try {
    const r = await api('GET', '/v1/data');
    if (my !== bootToken) return;
    if (r.status === 200 && r.data?.data) {
      hooks.replaceState(sanitize(r.data.data));
      cfg.serverRev = r.data.rev; cfg.uploadedGen = cfg.localGen; cfg.uploadedHash = hashOf(stateJSON());
      cfg.lastSyncAt = new Date().toISOString(); saveCfg();
      setTimeout(() => hooks.toast('已从服务器恢复数据'), 300);
    } else if (r.status === 401) {
      cfg.authError = true; saveCfg();
    } else if (r.status !== 200) {
      setTimeout(() => hooks.toast('服务器备份读取失败，可在下方重新登录恢复'), 300);
    }
  } catch {
    if (my === bootToken) setTimeout(() => hooks.toast('暂时连不上服务器，可在下方点「登录恢复数据」重试'), 300);
  } finally {
    if (my === bootToken) bootToken++;
  }
}

// ---------- 界面 ----------
function formHTML(kind) {
  const reg = kind === 'register';
  const title = { login: '登录账号', register: '注册账号', parent: '家长登录查看' }[kind];
  return `<div class="syncform"><h3>${title}</h3>
    <input id="sy-user" maxlength="20" placeholder="用户名（字母或数字）" autocomplete="username" autocapitalize="off" value="${esc(ui?.user || '')}">
    <input id="sy-pw" type="password" maxlength="64" placeholder="密码（至少 6 位）" autocomplete="${reg ? 'new-password' : 'current-password'}">
    ${reg ? '<input id="sy-pw2" type="password" maxlength="64" placeholder="再输一次密码" autocomplete="new-password"><input id="sy-invite" maxlength="40" placeholder="家庭注册码" autocapitalize="characters">' : ''}
    ${ui?.error ? `<p class="red small">${esc(ui.error)}</p>` : ''}
    <button class="btn ${kind === 'parent' ? 'green' : 'red'}" data-action="sync-submit" data-kind="${kind}" ${busy ? 'disabled' : ''}>${busy ? '请稍等…' : (reg ? '注册并开始同步' : '登录')}</button>
    <button class="link" data-action="sync-cancel">取消</button>
    ${reg ? '<p class="hint">注册码由家长保管。密码忘了可以找管理员在服务器上重置，数据不会丢。</p>' : ''}</div>`;
}

/** 首次设置页底部。 */
export function setupHTML() {
  if (ui && ['login', 'parent', 'register'].includes(ui.mode)) return `<div class="card">${formHTML(ui.mode)}</div>`;
  return `<div class="card center">
    <button class="btn gray" data-action="sync-open" data-kind="login">已有账号？登录恢复数据</button>
    <button class="btn gray" data-action="sync-open" data-kind="parent">我是家长，登录查看孩子</button></div>`;
}

/** 家长页「账号同步」卡片。 */
export function cardHTML() {
  return `<div class="card" id="sync-card">${cardInner()}</div>`;
}
function refreshCard() {
  const c = document.getElementById('sync-card');
  if (c) c.innerHTML = cardInner();
}
function cardInner() {
  const h = '<h3>☁️ 账号同步</h3>';
  if (!loggedIn()) {
    if (ui && ['login', 'register'].includes(ui.mode)) return h + formHTML(ui.mode);
    return `${h}<p class="hint">注册账号后，数据会自动备份到家里的服务器；换手机或数据丢了，登录就能找回。家长用自己的手机登录同一账号，可以随时查看孩子的修炼情况。</p>
      <button class="btn green" data-action="sync-open" data-kind="register">注册账号</button>
      <button class="btn gray" data-action="sync-open" data-kind="login">已有账号，登录</button>`;
  }
  if (ui?.mode === 'merge') {
    return `${h}<p>服务器上已经有数据：<b>${ui.serverDays}</b> 天打卡（最后更新 ${timeText(ui.updatedAt)}）。<br>这台手机上有 <b>${ui.localDays}</b> 天打卡${pending() ? '，还有没上传的修改' : ''}。</p>
      <p class="hint">要用哪一份？另一份会被替换。</p>
      <button class="btn gray" data-action="sync-merge" data-pick="server">用服务器的（替换这台手机）</button>
      <button class="btn gray" data-action="sync-merge" data-pick="local">用这台手机的（覆盖服务器）</button>`;
  }
  if (ui?.mode === 'history') {
    const list = ui.list || [];
    return `${h}<p><b>从服务器历史恢复</b></p>
      ${list.length ? list.map((x) => `<button class="row-btn" data-action="sync-history-pick" data-date="${esc(x.date)}">📅 ${esc(x.date)} 当天最后的数据</button>`).join('') : '<p class="sub">服务器上还没有历史备份（每天第一次同步后才会产生）。</p>'}
      <button class="link" data-action="sync-cancel">返回</button>`;
  }
  if (ui?.mode === 'password') {
    return `${h}<div class="syncform"><input id="sy-old" type="password" maxlength="64" placeholder="原密码"><input id="sy-new" type="password" maxlength="64" placeholder="新密码（至少 6 位）">
      ${ui.error ? `<p class="red small">${esc(ui.error)}</p>` : ''}
      <button class="btn green" data-action="sync-password-save" ${busy ? 'disabled' : ''}>保存新密码</button><button class="link" data-action="sync-cancel">取消</button>
      <p class="hint">改密码后，其他已登录的手机（包括家长查看）需要重新登录。</p></div>`;
  }
  if (ui?.mode === 'delete') {
    return `${h}<p class="red">注销后服务器上的账号和全部备份都会删除，这台手机上的数据保留。</p>
      <div class="syncform"><input id="sy-delpw" type="password" maxlength="64" placeholder="输入密码确认">
      ${ui.error ? `<p class="red small">${esc(ui.error)}</p>` : ''}
      <button class="btn danger" data-action="sync-delete-confirm" ${busy ? 'disabled' : ''}>确认注销</button><button class="link" data-action="sync-cancel">取消</button></div>`;
  }
  const status = cfg.authError ? '<p class="red">登录已失效（可能改过密码），请退出后重新登录。</p>'
    : cfg.conflict ? `<p class="gold">服务器上有另一台设备的更新（${timeText(cfg.conflict.updatedAt)}），自动同步已暂停。</p>
      <button class="btn gray" data-action="sync-conflict" data-pick="server">用服务器数据替换本机</button>
      <button class="btn gray" data-action="sync-conflict" data-pick="local">用本机数据覆盖服务器</button>`
    : `<p class="${cfg.lastError ? 'gold' : 'green'}">${cfg.lastError ? `⚠️ ${esc(cfg.lastError)}（会自动重试）` : (pending() ? '⏳ 有修改等待上传' : '✅ 已同步')}</p>`;
  return `${h}<div class="flex"><span>账号</span><b>${esc(cfg.username)}</b></div>
    <p class="hint">上次同步：${cfg.lastSyncAt ? timeText(cfg.lastSyncAt) : '还没有'}</p>
    ${status}
    <button class="btn green" data-action="sync-now" ${busy ? 'disabled' : ''}>立即同步</button>
    <button class="btn gray" data-action="sync-history">从服务器历史恢复</button>
    <div class="flex gap" style="margin-top:10px"><button class="pill gray" data-action="sync-open" data-kind="password">修改密码</button><button class="pill gray" data-action="sync-logout">退出登录</button><button class="pill gray" data-action="sync-open" data-kind="delete">注销账号</button></div>
    <p class="hint">家长手机：打开同一个网址，在开始页点「我是家长，登录查看孩子」，用这个账号登录即可查看。</p>`;
}

const days = (s) => Object.keys(s?.logs || {}).length;
const rerender = () => (loggedIn() || !document.getElementById('sync-card') ? hooks.render() : refreshCard());

async function finishChildLogin(r) {
  cfg = { ...blank(), username: r.data.username, token: r.data.token, role: 'child', localGen: cfg.localGen, uploadedGen: cfg.localGen };
  if (!hooks.isEmpty()) cfg.localGen = cfg.uploadedGen + 1;
  saveCfg();
  const g = await api('GET', '/v1/data');
  if (g.status !== 200) throw new Error(errText(g));
  const srv = g.data;
  if (!srv.data) {                    // 服务器还没有数据
    cfg.serverRev = 0; saveCfg(); ui = null;
    hooks.render(); hooks.toast(hooks.isEmpty() ? '登录成功' : '登录成功，正在上传本机数据'); requestSync();
    return;
  }
  if (hooks.isEmpty()) { ui = null; replaceLocal(srv.data, 'server-latest', srv.rev); hooks.toast('已从服务器恢复数据'); return; }
  cfg.serverRev = srv.rev; saveCfg();
  ui = { mode: 'merge', serverDays: days(srv.data), localDays: days(hooks.getState()), updatedAt: srv.updatedAt };
  hooks.render();
}

export const actions = {
  'sync-open': (el) => { ui = { mode: el.dataset.kind }; rerender(); },
  'sync-cancel': () => { ui = null; rerender(); },
  'sync-submit': async (el) => {
    const kind = el.dataset.kind;
    const user = $('#sy-user').value.trim().toLowerCase(), pw = $('#sy-pw').value;
    ui = { mode: kind, user };
    if (!/^[a-z0-9_]{3,20}$/.test(user)) { ui.error = '用户名要 3–20 位字母、数字或下划线'; return rerender(); }
    if (pw.length < 6) { ui.error = '密码至少 6 位'; return rerender(); }
    let body;
    if (kind === 'register') {
      if ($('#sy-pw2').value !== pw) { ui.error = '两次密码不一样'; return rerender(); }
      body = { username: user, password: pw, inviteCode: $('#sy-invite').value, role: 'child' };
    } else body = { username: user, password: pw, role: kind === 'parent' ? 'parent' : 'child' };
    busy = true; rerender();
    try {
      const r = await api('POST', kind === 'register' ? '/v1/register' : '/v1/login', body, { auth: false });
      if (r.status !== 200) { ui.error = errText(r); return; }
      if (kind === 'parent') {
        cfg = { ...blank(), username: r.data.username, token: r.data.token, role: 'parent' };
        saveCfg(); location.reload(); return;
      }
      await finishChildLogin(r);
    } catch (e) {
      ui.error = e?.name === 'AbortError' ? '连接服务器超时，请检查网络' : (e?.message || '连不上服务器，请检查网络');
    } finally {
      busy = false;
      if (ui?.error) rerender();
    }
  },
  'sync-merge': async (el) => {
    if (el.dataset.pick === 'local') {
      ui = null; cfg.conflict = null; markPending(); hooks.render(); requestSync(); hooks.toast('正在用这台手机的数据覆盖服务器');
      return;
    }
    if (!backupLocal() && !confirm('这台手机的数据无法自动留底，仍要用服务器的数据替换吗？')) return;
    try {
      const g = await api('GET', '/v1/data');
      if (g.status !== 200 || !g.data?.data) throw new Error(errText(g));
      ui = null; replaceLocal(g.data.data, 'server-latest', g.data.rev); hooks.toast('已换成服务器上的数据');
    } catch { hooks.toast('读取服务器数据失败，请稍后重试'); }
  },
  'sync-conflict': async (el) => {
    if (el.dataset.pick === 'local') {
      cfg.serverRev = cfg.conflict?.rev ?? cfg.serverRev; cfg.conflict = null; markPending(); refreshCard(); requestSync();
      return;
    }
    if (!confirm('用服务器上的数据替换这台手机的数据吗？')) return;
    if (!backupLocal() && !confirm('这台手机的数据无法自动留底，仍要替换吗？')) return;
    try {
      const g = await api('GET', '/v1/data');
      if (g.status !== 200 || !g.data?.data) throw new Error(errText(g));
      replaceLocal(g.data.data, 'server-latest', g.data.rev); hooks.toast('已换成服务器上的数据');
    } catch { hooks.toast('读取服务器数据失败，请稍后重试'); }
  },
  'sync-now': () => {
    if (cfg.authError) return hooks.toast('登录已失效，请退出后重新登录');
    if (cfg.conflict) return hooks.toast('请先选择用哪一份数据');
    if (!pending()) markPending();
    clearTimeout(retryTimer); retryTimer = null; backoff = 0;
    requestSync(); hooks.toast('正在同步…');
  },
  'sync-history': async () => {
    try {
      const r = await api('GET', '/v1/history');
      if (r.status !== 200) throw new Error();
      ui = { mode: 'history', list: r.data }; refreshCard();
    } catch { hooks.toast('读取历史失败，请检查网络'); }
  },
  'sync-history-pick': async (el) => {
    const date = el.dataset.date;
    if (!confirm(`用 ${date} 的数据替换这台手机现在的数据吗？（替换后会作为最新版本上传）`)) return;
    try {
      const r = await api('GET', `/v1/history/${date}`);
      if (r.status !== 200 || !r.data?.data) throw new Error();
      backupLocal();
      ui = null; replaceLocal(r.data.data, 'server-history'); hooks.toast(`已恢复到 ${date}`);
    } catch { hooks.toast('备份读取失败'); }
  },
  'sync-password-save': async () => {
    const o = $('#sy-old').value, n = $('#sy-new').value;
    if (n.length < 6) { ui.error = '新密码至少 6 位'; return refreshCard(); }
    busy = true; refreshCard();
    try {
      const r = await api('POST', '/v1/password', { oldPassword: o, newPassword: n });
      if (r.status === 200) { ui = null; hooks.toast('密码已修改'); } else ui.error = errText(r);
    } catch { ui.error = '连不上服务器'; } finally { busy = false; refreshCard(); }
  },
  'sync-logout': async () => {
    if (!confirm('退出登录后这台手机不再自动备份（本机数据保留）。确定吗？')) return;
    await logout();
    hooks.render(); hooks.toast('已退出登录');
  },
  'sync-delete-confirm': async () => {
    busy = true; refreshCard();
    try {
      const r = await api('DELETE', '/v1/account', { password: $('#sy-delpw').value });
      if (r.status === 200) { cfg = blank(); saveCfg(); ui = null; hooks.render(); hooks.toast('账号已注销'); return; }
      ui.error = errText(r);
    } catch { ui.error = '连不上服务器'; } finally { busy = false; refreshCard(); }
  },
};

export async function logout() {
  try { await api('POST', '/v1/logout', undefined, { timeout: 5000 }); } catch { /* 离线也照样退出 */ }
  cfg = blank(); saveCfg(); ui = null;
  clearTimeout(retryTimer); clearTimeout(debounce);
}
