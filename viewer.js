// 家长查看模式（家长自己的手机，只读）：从服务器拉孩子的数据显示，不写本机的修炼数据。
import * as R from './rules.js';
import { ledger, sanitize } from './store.js';
import * as SYNC from './sync.js';
import * as CH from './chars.js';

const CACHE = 'xiulian.viewCache';
let view = null;          // 孩子的数据（sanitize 后）
let meta = { updatedAt: null, fetchedAt: null, offline: false, empty: false };
export let tab = 'overview';
let H = null;             // app.js 传入的小组件：{ lineChart, star, seal, esc, logSummary, toast, now }
let loading = false;

const $ = (s) => document.querySelector(s);
const hm = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${R.pad2(d.getHours())}:${R.pad2(d.getMinutes())}`; };

export function start(helpers) {
  H = helpers;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE));
    if (c?.data) { view = sanitize(c.data, H.now()); meta = { updatedAt: c.updatedAt, fetchedAt: c.fetchedAt, offline: true, empty: false }; }
  } catch { /* 没缓存 */ }
  render();
  refresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
}

export async function refresh(manual = false) {
  if (loading) return;
  loading = true;
  try {
    const r = await SYNC.api('GET', '/v1/data');
    if (r.status === 401) { meta.authError = true; return; }
    if (r.status !== 200) throw new Error();
    meta = { updatedAt: r.data.updatedAt, fetchedAt: new Date().toISOString(), offline: false, empty: !r.data.data };
    view = r.data.data ? sanitize(r.data.data, H.now()) : null;
    try { localStorage.setItem(CACHE, JSON.stringify({ data: r.data.data, updatedAt: r.data.updatedAt, fetchedAt: meta.fetchedAt })); } catch { /* 空间不足就不缓存 */ }
    if (manual) H.toast('已刷新');
  } catch {
    meta.offline = true;
    if (manual) H.toast('连不上服务器，显示的是上次的数据');
  } finally {
    loading = false;
    render();
  }
}

function banner() {
  const name = view?.profile?.name || '孩子';
  const st = meta.authError ? '<span class="red">登录已失效，请到「设置」退出后重新登录</span>'
    : meta.offline ? `<span class="gold">离线，显示的是 ${hm(meta.fetchedAt) || '之前'} 的数据</span>`
      : `更新于 ${hm(meta.updatedAt) || '—'}`;
  return `<div class="card viewbar"><div class="flex"><b>👀 家长查看：${H.esc(name)}</b><button class="pill gray" data-action="view-refresh">刷新</button></div>
    <p class="hint">只读，不能在这里打卡或修改。${st}</p></div>`;
}

function overview() {
  const t = H.now();
  const s = view;
  const L = ledger(s);
  const rank = R.rankFor(L.earned);
  const keys = new Set(Object.keys(s.logs));
  const log = s.logs[R.dayKey(t)];
  const raid = R.raidState(s, t);
  const id = R.dutyFor(t);
  return `
    <div class="card center">${H.seal(rank, 72)}<h2>${H.esc(s.profile.name || '孩子')}</h2><p class="gold">${rank.name}级 · ${H.esc(rank.name === '柱' ? `${s.profile.name}柱` : rank.title)}</p>
      <div class="duty" data-action="duty" data-id="${id}">${CH.charHTML(id)}</div></div>
    <div class="row">
      <div class="card stat"><span class="gold small">⭐ 可用星星</span><b>${L.available}</b></div>
      <div class="card stat"><span class="red small">🔥 连续修炼</span><b>${R.currentStreak(keys, t)} 天</b></div>
    </div>
    <div class="card"><h3>今天（${R.dayKey(t)}）</h3>
      ${log ? `<div class="flex"><span>已打卡 ${H.star(log.stars)}</span><span class="mood">${R.MOODS[log.mood]?.[0] || ''}</span></div>${H.logSummary(log)}<p class="hint">提交时间 ${hm(log.submittedAt)}</p>`
        : '<p class="sub">今天还没打卡。</p>'}</div>
    <div class="card"><h3>⚔️ 本周讨伐</h3><p>${CH.CHARS[raid.boss].name}：${raid.defeated ? '🎉 已讨伐成功' : `剩余血量 ${raid.hp} / ${raid.target}`}</p>
      <p class="hint">累计获得 ${L.earned} 颗星，已兑换 ${L.spent} 颗；本周${R.measuredThisWeek(s.bodies, t) ? '已' : '还没'}测量身体。</p></div>`;
}

function logsTab() {
  const s = view;
  const logs = Object.values(s.logs).sort((a, b) => b.dayKey.localeCompare(a.dayKey)).slice(0, 30);
  const red = [...s.redemptions].reverse().slice(0, 20);
  return `<div class="card"><h3>最近 30 天打卡</h3>
    ${logs.length ? logs.map((l) => `<div class="loghead"><b>${l.dayKey}</b>${l.isMakeup ? '<span class="tag">补</span>' : ''}<span class="grow"></span>${R.MOODS[l.mood]?.[0] || ''} ${H.star(l.stars)}</div>
      <p class="hint">${R.ITEMS.map((i) => `${i.short}${l[i.key] ? '✓' : '✗'}`).join(' · ')} · 跳绳${l.ropeCount}${l.extras?.length ? ' · ' + l.extras.map(H.esc).join('、') : ''}</p>`).join('') : '<p class="sub">还没有打卡记录</p>'}</div>
    <div class="card"><h3>兑换记录</h3>
    ${red.length ? red.map((r) => `<div class="flex small"><span>${H.esc(r.name)}</span><span>${H.esc(String(r.date || '').slice(0, 10))} · ${r.cost} ⭐</span></div>`).join('') : '<p class="sub">还没有兑换过</p>'}</div>`;
}

function growthTab() {
  const bodies = [...view.bodies].sort((a, b) => a.date.localeCompare(b.date));
  if (!bodies.length) return '<div class="card"><h3>成长记录</h3><p class="sub">还没有测量记录（在孩子的手机「家长」页录入）。</p></div>';
  const lbl = (d) => d.slice(5).replace('-', '/');
  const pts = (f) => bodies.filter((b) => b[f] != null).map((b) => ({ y: b[f], label: lbl(b.date) }));
  const whtPts = bodies.map((b) => ({ y: R.waistToHeight(bodies, b), label: lbl(b.date) })).filter((p) => p.y != null);
  const lastOf = (f) => [...bodies].reverse().find((b) => b[f] != null);
  const lw = lastOf('w'), lwa = lastOf('waist'), lh = lastOf('h');
  const bmi = R.bmiOf(bodies, lw), wht = R.waistToHeight(bodies, lwa);
  return `<div class="card"><h3>成长记录</h3>
    <p><b>最新：</b>${lw ? `体重 ${lw.w} kg（${lbl(lw.date)}）` : ''}${lwa ? ` · 腰围 ${lwa.waist} cm（${lbl(lwa.date)}）` : ''}${lh ? ` · 身高 ${lh.h} cm（${lbl(lh.date)}）` : ''}
      ${bmi != null ? `<br>BMI ${bmi.toFixed(1)}` : ''}${wht != null ? `${bmi != null ? ' · ' : '<br>'}腰围/身高 ${wht.toFixed(2)}` : ''}</p>
    ${H.lineChart(pts('waist'), '#f2b84d', '腰围 cm')}${H.lineChart(whtPts, '#4d9ef2', '腰围/身高', 0.5, 2)}${H.lineChart(pts('w'), '#cc1a33', '体重 kg')}${H.lineChart(pts('h'), '#1f8561', '身高 cm')}
    <p class="hint">腰围/身高：一般认为儿童低于 0.5 较理想，仅供参考。</p></div>`;
}

function settingsTab() {
  const a = SYNC.account();
  return `<div class="card"><h3>家长查看设置</h3><div class="flex"><span>登录账号</span><b>${H.esc(a.username)}</b></div>
    <p class="hint">这台手机是家长查看模式，只能看不能改。打卡、录入测量、设置奖励请在孩子的手机上操作。</p>
    <button class="btn gray" data-action="view-refresh">立即刷新</button>
    <button class="btn danger" data-action="view-logout">退出登录</button></div>`;
}

export function render() {
  const views = { overview, logs: logsTab, growth: growthTab, settings: settingsTab };
  let body;
  if (!view) body = meta.empty ? '<div class="card"><p class="sub">孩子的手机还没有上传过数据。请在孩子手机的「家长」页登录同一个账号。</p></div>'
    : (tab === 'settings' ? settingsTab() : '<div class="card"><p class="sub">正在读取…</p></div>');
  else body = views[tab]();
  $('#app').innerHTML = banner() + body;
  const t = [['overview', '👀', '概览'], ['logs', '📅', '打卡'], ['growth', '📈', '成长'], ['settings', '⚙️', '设置']];
  $('#tabs').innerHTML = t.map(([k, i, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-action="view-tab" data-tab="${k}"><span>${i}</span>${l}</button>`).join('');
  document.title = `${view?.profile?.name || '孩子'}的修炼日记 · 家长查看`;
  H.afterRender?.();
}

export const actions = {
  'view-tab': (el) => { tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  'view-refresh': () => refresh(true),
  'view-logout': async () => {
    if (!confirm('退出家长查看吗？')) return;
    await SYNC.logout();
    try { localStorage.removeItem(CACHE); } catch { /* 忽略 */ }
    location.reload();
  },
};

/** 返回键：不在概览就回概览。 */
export function back() {
  if (tab !== 'overview') { tab = 'overview'; render(); return true; }
  return false;
}
export const canGoBack = () => tab !== 'overview';
