// 自动备份（家庭模式）：不注册、不登录，全家共用家里 HB 上的一份数据。
// 打开就自动同步；换手机打开自动恢复；两台手机都改过时以最后修改的为准。
// 家长手机可切换为「家长查看」（只读，见 viewer.js）。
import { sanitize } from './store.js';

const KEY = 'xiulian.sync';
export const API = window.__xiulianSyncApi || 'https://xiulian-sync.gdutboy.xyz';
const BASE = '/v1/family';

const blank = () => ({ role: '', serverRev: 0, changedAt: null, lastSyncAt: null, lastError: '', localGen: 0, uploadedGen: 0, uploadedHash: '' });
function loadCfg() {
  try {
    const c = { ...blank(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
    if (c.token) return blank();      // 旧版账号模式留下的设置：作废，按家庭模式重新开始
    return c;
  } catch { return blank(); }
}
let cfg = loadCfg();
const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* 空间不足时忽略 */ } };

let hooks = null;   // { getState, replaceState, isEmpty, render, toast }

export const isViewer = () => cfg.role === 'parent';
export const loggedIn = () => !isViewer();
export const account = () => ({ username: '全家共用', role: cfg.role });

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

/** 调用同步服务（路径如 '/data'）。返回 { status, data }；网络错误/超时抛异常。 */
export async function api(method, path, body, { timeout = 15000, keepalive = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = body !== undefined ? { 'Content-Type': 'application/json' } : {};
    const r = await fetch(API + BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, keepalive, cache: 'no-store' });
    let data = null;
    try { data = await r.json(); } catch { /* 无内容 */ }
    return { status: r.status, data };
  } finally { clearTimeout(timer); }
}

/** 取家里服务器上的背景音乐。没有就返回 null。 */
export async function fetchSong() {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 120000);
  try {
    const r = await fetch(`${API}${BASE}/bgm/main`, { signal: ctl.signal });
    if (!r.ok) return null;
    return { blob: await r.blob(), name: decodeURIComponent(r.headers.get('X-Song-Name') || '背景音乐') };
  } catch { return null; } finally { clearTimeout(t); }
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
  const r = await api('PUT', '/data', { changedAt: cfg.changedAt || new Date().toISOString(), data: JSON.parse(json) }, { keepalive: keepalive && json.length < 60000 });
  if (r.status !== 200) throw new Error(errText(r));
  cfg.serverRev = r.data.rev; cfg.uploadedGen = Math.max(cfg.uploadedGen, gen); cfg.uploadedHash = hashOf(json);
}

// ---------- 同步（串行） ----------
let inFlight = false, again = false, debounce = null, retryTimer = null, backoff = 0;
const BACKOFF = [30e3, 120e3, 600e3];

/** 同步一次：先看服务器有没有别的手机的更新，再决定拉下来还是传上去。 */
export async function sync({ keepalive = false } = {}) {
  if (!loggedIn() || !hooks) return;
  if (inFlight) { again = true; return; }
  inFlight = true; again = false;
  clearTimeout(retryTimer); retryTimer = null;
  try {
    if (keepalive) {                       // 页面要被切走：只管把本机改动传上去
      if (pending() && cfg.serverRev) await put(true);
    } else {
      const g = await api('GET', '/data');
      if (g.status !== 200) throw new Error(errText(g));
      const srv = g.data;
      const otherUpdated = srv.data && srv.rev !== cfg.serverRev;
      // 从没跟服务器同步过的手机：两边都有数据时以「记录多的」为准（防止新手机上的空数据盖掉备份）；
      // 同步过的手机：以最后修改的为准
      const neverSynced = !cfg.serverRev;
      const size = (s) => Object.keys(s?.logs || {}).length + (s?.bodies?.length || 0) + (s?.redemptions?.length || 0);
      const serverWins = neverSynced
        ? (hooks.isEmpty() || size(srv.data) >= size(hooks.getState()))
        : !(pending() && cfg.changedAt > (srv.changedAt || srv.updatedAt));
      if (otherUpdated && serverWins) {
        takeServer(srv);                   // 别的手机改得更晚 → 用服务器的
        hooks.render();
      } else if (pending() || (!srv.data && !hooks.isEmpty())) {
        await put();                       // 本机改得更晚，或服务器还空着 → 传上去
      }
    }
    cfg.lastSyncAt = new Date().toISOString(); cfg.lastError = ''; backoff = 0;
  } catch (e) {
    cfg.lastError = e?.name === 'AbortError' ? '连接服务器超时' : (e instanceof TypeError || !e?.message ? '暂时连不上家里的服务器' : e.message);
    retryTimer = setTimeout(() => sync(), BACKOFF[Math.min(backoff++, BACKOFF.length - 1)]);
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
  // 本机有数据但和上次成功上传的不一样（含第一次启用自动备份）→ 待上传
  if (!hooks.isEmpty() && hashOf(stateJSON()) !== cfg.uploadedHash && !pending()) { cfg.localGen = cfg.uploadedGen + 1; saveCfg(); }
  setTimeout(() => sync(), 1000);
}

/** 启动时：本机没有数据 → 先从服务器取回。在第一次 render() 之前调用。 */
export async function bootRestore() {
  if (!loggedIn() || !hooks.isEmpty()) return;
  $('#app').innerHTML = '<div class="setup"><img src="icons/icon-192.png" class="setup-icon" alt=""><h2>正在读取备份…</h2><p class="sub">请稍等…</p></div>';
  $('#tabs').innerHTML = '';
  try {
    const r = await api('GET', '/data', undefined, { timeout: 10000 });
    if (r.status === 200 && r.data?.data) {
      takeServer(r.data); cfg.lastSyncAt = new Date().toISOString(); saveCfg();
      setTimeout(() => hooks.toast('已从家里的服务器恢复数据'), 300);
    }
  } catch { /* 连不上就正常进入，联网后会自动同步 */ }
}

// ---------- 界面 ----------
/** 首次设置页底部。 */
export function setupHTML() {
  return '<div class="card center"><button class="btn gray" data-action="sync-viewer">👀 这是家长的手机（只看孩子的情况）</button></div>';
}

/** 家长页「自动备份」卡片。 */
export function cardHTML() { return `<div class="card" id="sync-card">${cardInner()}</div>`; }
function refreshCard() { const c = document.getElementById('sync-card'); if (c) c.innerHTML = cardInner(); }
function cardInner() {
  const st = cfg.lastError ? `⚠️ ${esc(cfg.lastError)}（会自动重试）` : (pending() ? '⏳ 正在备份' : '✅ 已备份到家里的服务器');
  return `<h3>☁️ 自动备份</h3><p class="${cfg.lastError ? 'gold' : 'green'}">${st}</p>
    <p class="hint">上次同步：${cfg.lastSyncAt ? timeText(cfg.lastSyncAt) : '还没有'}。换手机直接打开网址，数据会自动回来。</p>
    <button class="btn gray" data-action="sync-viewer">👀 把这台手机切换为家长查看（只看不改）</button>`;
}

export const actions = {
  'sync-viewer': () => {
    if (!confirm('切换为家长查看后，这台手机只能看孩子的情况，不能打卡。确定吗？')) return;
    cfg = { ...blank(), role: 'parent' }; saveCfg(); location.reload();
  },
};

/** 退出家长查看，恢复成普通模式。 */
export async function logout() {
  cfg = blank(); saveCfg();
  clearTimeout(retryTimer); clearTimeout(debounce);
}
