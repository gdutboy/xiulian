// 账号同步（简化版）：登录后孩子手机的数据自动备份到家里的 HB；换手机登录就能取回。
// 规则：两台手机都改过时，以最后修改的为准。家长手机以「家长查看」登录时只读（见 viewer.js）。
import { sanitize } from './store.js';

const KEY = 'xiulian.sync';
export const API = window.__xiulianSyncApi || 'https://xiulian-sync.gdutboy.xyz';

const blank = () => ({ username: '', token: '', role: '', serverRev: 0, changedAt: null, lastSyncAt: null, lastError: '', localGen: 0, uploadedGen: 0, uploadedHash: '', authError: false });
function loadCfg() {
  try { return { ...blank(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return blank(); }
}
let cfg = loadCfg();
const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* 空间不足时忽略 */ } };

let hooks = null;   // { getState, replaceState, isEmpty, render, toast }
let form = null;    // 登录表单：{ user, role, error }
let busy = false;

export const isViewer = () => !!cfg.token && cfg.role === 'parent';
export const loggedIn = () => !!cfg.token && cfg.role === 'child';
export const account = () => ({ username: cfg.username, role: cfg.role });

// 内容哈希（不依赖 crypto.subtle）
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
export async function api(method, path, body, { timeout = 15000, keepalive = false, auth = true } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
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
const stateJSON = () => JSON.stringify(hooks.getState());
const pending = () => cfg.localGen > cfg.uploadedGen;

// 用服务器的数据替换本机（替换前把本机数据留一份底）
function takeServer(srv) {
  if (!hooks.isEmpty()) { try { localStorage.setItem('xiulian.preSyncBackup', JSON.stringify({ at: new Date().toISOString(), state: hooks.getState() })); } catch { /* 空间不足就算了 */ } }
  hooks.replaceState(sanitize(srv.data));
  cfg.serverRev = srv.rev; cfg.changedAt = srv.changedAt || srv.updatedAt;
  cfg.uploadedGen = cfg.localGen; cfg.uploadedHash = hashOf(stateJSON());
}

async function put(keepalive = false) {
  const gen = cfg.localGen, json = stateJSON();
  const r = await api('PUT', '/v1/data', { changedAt: cfg.changedAt || new Date().toISOString(), data: JSON.parse(json) }, { keepalive: keepalive && json.length < 60000 });
  if (r.status === 401) { cfg.authError = true; throw new Error('登录已失效，请退出后重新登录'); }
  if (r.status !== 200) throw new Error(errText(r));
  cfg.serverRev = r.data.rev; cfg.uploadedGen = Math.max(cfg.uploadedGen, gen); cfg.uploadedHash = hashOf(json);
}

// ---------- 同步（串行） ----------
let inFlight = false, again = false, debounce = null, retryTimer = null, backoff = 0;
const BACKOFF = [30e3, 120e3, 600e3];

/** 同步一次：先看服务器有没有别的手机的更新，再决定拉下来还是传上去。 */
export async function sync({ keepalive = false } = {}) {
  if (!loggedIn() || !hooks || cfg.authError) return;
  if (inFlight) { again = true; return; }
  inFlight = true; again = false;
  clearTimeout(retryTimer); retryTimer = null;
  try {
    if (keepalive) {                       // 页面要被切走：只管把本机改动传上去
      if (pending()) await put(true);
    } else {
      const g = await api('GET', '/v1/data');
      if (g.status === 401) { cfg.authError = true; throw new Error('登录已失效，请退出后重新登录'); }
      if (g.status !== 200) throw new Error(errText(g));
      const srv = g.data;
      const otherUpdated = srv.data && srv.rev !== cfg.serverRev;
      if (otherUpdated && !(pending() && cfg.changedAt > (srv.changedAt || srv.updatedAt))) {
        takeServer(srv);                   // 别的手机改得更晚 → 用服务器的
        hooks.render();
      } else if (pending() || (!srv.data && !hooks.isEmpty())) {
        await put();                       // 本机改得更晚，或服务器还空着 → 传上去
      }
    }
    cfg.lastSyncAt = new Date().toISOString(); cfg.lastError = ''; backoff = 0;
  } catch (e) {
    cfg.lastError = e?.name === 'AbortError' ? '连接服务器超时' : (e?.message || '连不上服务器');
    if (!cfg.authError) retryTimer = setTimeout(() => sync(), BACKOFF[Math.min(backoff++, BACKOFF.length - 1)]);
  } finally {
    saveCfg();
    inFlight = false;
    refreshCard();
  }
  if (again) sync();
}

/** app.js 每次 persist() 后调用。 */
export function onPersist() {
  if (!loggedIn()) return;
  cfg.localGen++; cfg.changedAt = new Date().toISOString(); saveCfg();
  clearTimeout(debounce);
  debounce = setTimeout(() => sync(), 3000);
}

// ---------- 启动 ----------
export function initSync(h) {
  hooks = h;
  window.addEventListener('online', () => { backoff = 0; sync(); });
  document.addEventListener('visibilitychange', () => sync({ keepalive: document.hidden }));
  if (!loggedIn()) return;
  // 防崩溃漏传：内容和上次成功上传的不一样，就补传
  if (!hooks.isEmpty() && hashOf(stateJSON()) !== cfg.uploadedHash && !pending()) { cfg.localGen = cfg.uploadedGen + 1; saveCfg(); }
  setTimeout(() => sync(), 1000);
}

/** 启动时：已登录且本机没有数据 → 先从服务器取回。在第一次 render() 之前调用。 */
export async function bootRestore() {
  if (!loggedIn() || !hooks.isEmpty()) return;
  $('#app').innerHTML = '<div class="setup"><img src="icons/icon-192.png" class="setup-icon" alt=""><h2>正在从服务器恢复…</h2><p class="sub">请稍等…</p></div>';
  $('#tabs').innerHTML = '';
  try {
    const r = await api('GET', '/v1/data');
    if (r.status === 200 && r.data?.data) {
      takeServer(r.data); cfg.lastSyncAt = new Date().toISOString(); saveCfg();
      setTimeout(() => hooks.toast('已从服务器恢复数据'), 300);
    } else if (r.status === 401) { cfg.authError = true; saveCfg(); }
  } catch {
    setTimeout(() => hooks.toast('暂时连不上服务器，联网后再打开即可恢复'), 300);
  }
}

// ---------- 界面 ----------
function formHTML(withRole) {
  const f = form || {};
  const role = f.role || 'child';
  return `<div class="syncform">
    <input id="sy-user" maxlength="20" placeholder="用户名（字母或数字）" autocomplete="username" autocapitalize="off" value="${esc(f.user || '')}">
    <input id="sy-pw" type="password" maxlength="64" placeholder="密码（至少 6 位）" autocomplete="current-password">
    ${withRole ? `<div class="flex gap" style="margin-top:8px">
      <button class="pill ${role === 'child' ? 'red' : 'gray'}" data-action="sync-role" data-role="child">孩子用这台手机</button>
      <button class="pill ${role === 'parent' ? 'red' : 'gray'}" data-action="sync-role" data-role="parent">家长查看</button></div>` : ''}
    ${f.error ? `<p class="red small">${esc(f.error)}</p>` : ''}
    <div class="flex gap"><button class="btn red" data-action="sync-go" data-kind="login" ${busy ? 'disabled' : ''}>${busy ? '请稍等…' : '登录'}</button>
    <button class="btn gray" data-action="sync-go" data-kind="register" ${busy ? 'disabled' : ''}>注册</button></div>
    <p class="hint">第一次用就点「注册」，以后其他手机用同一个用户名和密码点「登录」。</p></div>`;
}

/** 首次设置页底部。 */
export function setupHTML() {
  if (form) return `<div class="card"><h3>登录 / 注册</h3>${formHTML(true)}<button class="link" data-action="sync-cancel">取消</button></div>`;
  return '<div class="card center"><button class="btn gray" data-action="sync-open">已有账号？登录 / 注册</button></div>';
}

/** 家长页「账号同步」卡片。 */
export function cardHTML() { return `<div class="card" id="sync-card">${cardInner()}</div>`; }
function refreshCard() { const c = document.getElementById('sync-card'); if (c) c.innerHTML = cardInner(); }
function cardInner() {
  const h = '<h3>☁️ 账号同步</h3>';
  if (!loggedIn()) return `${h}<p class="hint">登录后数据自动备份到家里的服务器，换手机登录就能找回。家长用自己的手机登录同一账号可以查看。</p>${formHTML(false)}`;
  const st = cfg.lastError ? `⚠️ ${esc(cfg.lastError)}${cfg.authError ? '' : '（会自动重试）'}` : (pending() ? '⏳ 正在同步' : '✅ 已同步');
  return `${h}<div class="flex"><span>账号 <b>${esc(cfg.username)}</b></span><button class="pill gray" data-action="sync-logout">退出登录</button></div>
    <p class="${cfg.lastError ? 'gold' : 'green'}">${st}</p><p class="hint">上次同步：${cfg.lastSyncAt ? timeText(cfg.lastSyncAt) : '还没有'}</p>`;
}

const rerender = () => (document.getElementById('sync-card') ? refreshCard() : hooks.render());

export const actions = {
  'sync-open': () => { form = { role: 'child' }; hooks.render(); },
  'sync-cancel': () => { form = null; hooks.render(); },
  'sync-role': (el) => { form = { ...form, user: $('#sy-user').value, role: el.dataset.role }; rerender(); },
  'sync-go': async (el) => {
    const register = el.dataset.kind === 'register';
    const user = $('#sy-user').value.trim().toLowerCase(), pw = $('#sy-pw').value;
    const role = document.getElementById('sync-card') ? 'child' : (form?.role || 'child');
    form = { user, role };
    if (!/^[a-z0-9_]{3,20}$/.test(user)) { form.error = '用户名要 3–20 位字母、数字或下划线'; return rerender(); }
    if (pw.length < 6) { form.error = '密码至少 6 位'; return rerender(); }
    busy = true; rerender();
    try {
      const r = await api('POST', register ? '/v1/register' : '/v1/login', { username: user, password: pw, role }, { auth: false });
      if (r.status !== 200) { form.error = errText(r); return; }
      cfg = { ...blank(), username: r.data.username, token: r.data.token, role };
      saveCfg();
      if (role === 'parent') { location.reload(); return; }
      // 孩子手机：服务器有数据就用服务器的；服务器空着就把本机的传上去
      const g = await api('GET', '/v1/data');
      if (g.status === 200 && g.data?.data) { takeServer(g.data); hooks.toast('登录成功，已同步服务器上的数据'); }
      else { cfg.localGen = hooks.isEmpty() ? 0 : 1; cfg.changedAt = new Date().toISOString(); hooks.toast(register ? '注册成功' : '登录成功'); }
      saveCfg(); form = null;
      hooks.render();
      sync();
    } catch (e) {
      form.error = e?.name === 'AbortError' ? '连接服务器超时，请检查网络' : '连不上服务器，请检查网络';
    } finally {
      busy = false;
      if (form?.error) rerender();
    }
  },
  'sync-logout': async () => {
    if (!confirm('退出登录后这台手机不再自动备份（本机数据保留）。确定吗？')) return;
    await logout();
    hooks.render(); hooks.toast('已退出登录');
  },
};

export async function logout() {
  try { await api('POST', '/v1/logout', undefined, { timeout: 5000 }); } catch { /* 离线也照样退出 */ }
  cfg = blank(); saveCfg(); form = null;
  clearTimeout(retryTimer); clearTimeout(debounce);
}
