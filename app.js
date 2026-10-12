import * as R from './rules.js';
import { load, save, ledger, sanitize } from './store.js';
import * as FX from './fx.js';
import * as NV from './native.js';
import * as CH from './chars.js';
import * as VO from './voices.js';
import * as SYNC from './sync.js';
import * as VIEW from './viewer.js';
import * as BGM from './bgm.js';

// ---------- 状态 ----------
let state = load(globalThis.localStorage, window.__fakeNow ? new Date(window.__fakeNow) : new Date());
let tab = 'home';
let parentUnlocked = false;
let draft = null;      // 打卡草稿 {mode:'tonight'|'makeup', day:Date, answers, result}
let stretch = null;    // 拉伸跟练状态
let pin = null;        // 密码盘 {title, subtitle, input, overlay, onDone}
let firstPin = null;   // 设置密码第一次输入

const $ = (sel) => document.querySelector(sel);
const now = () => (window.__fakeNow ? new Date(window.__fakeNow) : new Date());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 查看模式（家长手机）绝不写本机修炼数据；孩子设备登录后每次保存都会触发自动同步
const persist = () => { if (SYNC.isViewer()) return; save(state); SYNC.onPersist(); };
const isEmpty = () => !state.profile.name && !Object.keys(state.logs).length && !state.bodies.length && !state.redemptions.length && !state.bonuses.length;
const childName = () => state.profile.name || '小剑士';
const rankTitle = (r) => (r.name === '柱' ? `${childName()}柱` : r.title);

// ---------- 小组件 ----------
const seal = (rank, size = 56, locked = false) =>
  `<div class="seal ${locked ? 'locked' : ''}" style="width:${size}px;height:${size}px;font-size:${size * 0.5}px">${rank.name}</div>`;

const star = (n, cls = '') => `<span class="star ${cls}">⭐<b>${n}</b></span>`;

function countdown(from, to) {
  const m = Math.max(0, Math.floor((to - from) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`;
}

function logSummary(log) {
  const rows = R.ITEMS.map((i) => `<li class="${log[i.key] ? 'ok' : ''}">${log[i.key] ? '✅' : '⚪️'} ${i.title}</li>`);
  rows.push(`<li class="${log.ropeCount > 0 ? 'ok' : ''}">${log.ropeCount > 0 ? '✅' : '⚪️'} 跳绳 ${log.ropeCount} 下</li>`);
  if (log.extras?.length) rows.push(`<li class="ok">➕ ${log.extras.map(esc).join('、')}</li>`);
  return `<ul class="summary">${rows.join('')}</ul>`;
}

// ---------- 页面：首次设置 ----------
function setupView() {
  return `
  <div class="setup">
    <img src="icons/icon-192.png" class="setup-icon" alt="">
    <h1>欢迎来到修炼日记</h1>
    <p class="sub">每天晚上记录喝水、蔬菜、运动和早睡，攒星星、升阶级、换奖励。</p>
    <div class="card">
      <label class="lbl">孩子的昵称</label>
      <input id="setup-name" maxlength="8" placeholder="例如：棒棒" autocomplete="off">
      <button class="btn red" data-action="setup-save">开始修炼</button>
    </div>
    <p class="hint">数据保存在这台手机里；注册账号后会自动备份到家里的服务器。</p>
    ${SYNC.setupHTML()}
  </div>`;
}

// ---------- 页面：首页 ----------
function installHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!ios || standalone || localStorage.getItem('xiulian.hideInstall')) return '';
  return `<div class="card hintcard">📲 <b>先添加到主屏幕</b>：点 Safari 底部的「分享」按钮，选「添加到主屏幕」。这样用起来像 App，数据也更不容易丢。
    <button class="link" data-action="hide-install">知道了</button></div>`;
}

function homeView() {
  const t = now();
  const L = ledger(state);
  const rank = R.rankFor(L.earned);
  const keys = new Set(Object.keys(state.logs));
  const log = state.logs[R.dayKey(t)];
  const { start, end } = state.settings;
  let today;
  if (log) {
    today = `
      <h3 class="green">✅ 今晚修炼完成！</h3>
      <div class="flex"><span>获得 ${star(log.stars, 'big')}</span><span class="mood">${R.MOODS[log.mood]?.[0] || '🙂'}</span></div>
      ${logSummary(log)}
      <button class="btn green" data-action="stretch">🌙 全集中·睡前修炼（${Math.round(R.STRETCH_TOTAL / 60)} 分钟）</button>
      <p class="hint">修炼日记今天已经交了，明天晚上再来～</p>`;
  } else {
    const w = R.windowState(t, start, end);
    if (w.state === 'notYet') {
      today = `<h3>⏳ 修炼时间还没到</h3>
        <p class="sub">今晚 ${R.timeText(start)} 开放，还有 ${countdown(t, w.at)}</p>
        <p class="hint">白天记得：多喝水、爬楼梯、跳跳绳、吃蔬菜，晚上来记录！</p>`;
    } else if (w.state === 'open') {
      today = `<h3 class="red">🔥 修炼日记开放中</h3>
        <p class="sub">${R.timeText(end)} 截止，还剩 ${countdown(t, w.at)}；${R.timeText(R.EARLY_BED_MINUTES)} 前交还有早睡奖励⭐</p>
        <button class="btn red" data-action="checkin">✍️ 开始今晚的修炼日记</button>`;
    } else {
      today = `<h3>🌙 今晚的修炼已结束</h3>
        <p class="sub">明天 ${R.timeText(start)} 再来吧，早点睡觉才能长高变强！</p>`;
    }
  }
  return `
    ${installHint()}
    <div class="hero-wrap">
    <button class="bgm-quick" data-action="bgm-quick" aria-label="背景音乐">${BGM.isOn() ? '🎵' : '🔇'}</button>
    <header class="hero">
      <div class="checker"></div>
      <div class="hero-in">${seal(rank, 62)}
        <div><h1>${esc(childName())}的修炼日记</h1><p class="gold">鬼杀队 · ${rank.name}级 · ${esc(rankTitle(rank))}</p></div>
      </div>
    </header>
    ${dutyHTML(t, !!log)}
    </div>
    <div class="row">
      <div class="card stat"><span class="gold small">⭐ 可用星星</span><b>${L.available}</b></div>
      <div class="card stat"><span class="red small">🔥 连续修炼</span><b>${R.currentStreak(keys, t)} 天</b></div>
    </div>
    <div class="card today">${today}</div>
    ${bodyCard(t)}
    ${raidCard(t)}
    <p class="quote">「${R.wordFor(t)}」</p>`;
}

// 孩子看到的「身体修炼」：只有正向变化量，不出现任何绝对数值
function bodyCard(t) {
  const rows = [];
  const p = R.bodyProgress(state.bodies, t);
  if (p) {
    rows.push(p.type === 'waist'
      ? `🎉 腰围比 ${p.weeks} 周前细了 ${p.cm} 厘米，全集中的成果！`
      : `🌱 ${p.weeks} 周长高了 ${p.cm} 厘米，身体越来越结实！`);
  }
  const streak = R.measureWeeksStreak(state.bodies, t);
  if (streak >= 2) rows.push(`📏 已经连续 ${streak} 周坚持身体测量`);
  if (!R.measuredThisWeek(state.bodies, t)) rows.push('📏 这周还没量腰围和体重哦，请爸爸妈妈帮忙记录，完成 +1 ⭐');
  if (!rows.length) return '';
  return `<div class="card body-card"><h3>💪 身体修炼</h3>${rows.map((r, i) => `<p class="${i === 0 && p ? 'gold progress' : 'sub'}">${r}</p>`).join('')}</div>`;
}

// 今日值班角色：21:30 后已打卡换成睡觉的祢豆子
function dutyHTML(t, logged) {
  const sleep = logged && R.minutesOfDay(t) >= R.EARLY_BED_MINUTES;
  const id = sleep ? 'nezuko' : R.dutyFor(t);
  if (!sleep) VO.preload([0, 1, 2].map((i) => `line-${id}-${i}`));
  return `<div class="duty" data-action="duty" data-id="${id}" data-sleep="${sleep ? 1 : ''}">${CH.charHTML(id, sleep ? 'sleep' : 'idle')}</div>`;
}

function raidCard(t) {
  const r = R.raidState(state, t);
  const c = CH.CHARS[r.boss];
  const pct = Math.round((r.hp / r.target) * 100);
  return `<div class="card"><h3>⚔️ 本周讨伐</h3><div class="raid ${r.defeated ? 'down' : ''}">${CH.charHTML(r.boss)}
    <div class="grow"><b>${c.name}</b><div class="hp"><i style="width:${pct}%"></i></div>
    <p class="small ${r.defeated ? 'gold' : 'sub'}">${r.defeated ? '🎉 讨伐成功！额外获得 3 ⭐' : `剩余血量 ${r.hp} / ${r.target}，每颗星都是一刀！`}</p></div></div></div>`;
}

// 鎹鸦：每天每条消息只来一次
function crowSeen(t) {
  try { const v = JSON.parse(localStorage.getItem('xiulian.crowSeen')); if (v?.day === R.dayKey(t)) return v.ids || []; } catch { /* 忽略 */ }
  return [];
}
function maybeCrow() {
  if (tab !== 'home' || !state.profile.name || $('#overlay').innerHTML || document.querySelector('.crow')) return;
  const t = now();
  const seen = crowSeen(t);
  const m = R.crowMessage({ now: t, start: state.settings.start, end: state.settings.end, logged: !!state.logs[R.dayKey(t)],
    measured: R.measuredThisWeek(state.bodies, t), raid: R.raidState(state, t) }, seen);
  if (!m) return;
  localStorage.setItem('xiulian.crowSeen', JSON.stringify({ day: R.dayKey(t), ids: [...seen, m.id] }));
  setTimeout(() => { if (tab === 'home' && !$('#overlay').innerHTML) { CH.crowBubble(m.text); VO.play(`crow-${m.id}`); } }, 600);
}

function celebrateProgress() {
  if (tab !== 'home' || !state.profile.name) return;
  const p = R.bodyProgress(state.bodies, now());
  if (!p || localStorage.getItem('xiulian.seenProgress') === p.key) return;
  localStorage.setItem('xiulian.seenProgress', p.key);
  FX.confetti(60);
  FX.burst($('.body-card .progress'), { n: 10, dist: 90 });
  CH.cutIn('rengoku', 'idle', '心中燃起火焰吧！', 'fire', 'right');
  VO.play('breath-fire');
}

// ---------- 页面：阶级 ----------
function ranksView() {
  const L = ledger(state);
  const rank = R.rankFor(L.earned);
  const next = R.nextRank(rank);
  const longest = R.longestStreak(new Set(Object.keys(state.logs)));
  const badges = R.BADGES.map((b) => {
    const ok = longest >= b.days;
    return `<div class="badge ${ok ? '' : 'locked'}"><div class="bicon">${ok ? b.icon : '🔒'}</div><b>${b.name}</b><small>连续 ${b.days} 天</small></div>`;
  }).join('');
  const ladder = [...R.RANKS].reverse().map((r) => `
    <div class="ladder">${seal(r, 36, r.index > rank.index)}<div><b>${r.name} · ${esc(rankTitle(r))}</b><small>${r.threshold} 颗星</small></div>${r.index === rank.index ? '<span class="gold small">当前</span>' : ''}</div>`).join('');
  return `
    <h2 class="title">鬼杀队阶级</h2>
    <div class="card center">
      ${seal(rank, 96)}
      <h2>「${rank.name}」级 · ${esc(rankTitle(rank))}</h2>
      <p class="sub">累计获得 ${L.earned} 颗星</p>
      ${next ? `<div class="bar"><i style="width:${Math.round(R.rankProgress(L.earned) * 100)}%"></i></div>
        <p class="gold">再拿 ${next.threshold - L.earned} 颗星晋级「${next.name}」</p>` : '<p class="gold">你已经是柱了！继续保持！</p>'}
    </div>
    <div class="card"><h3>呼吸法勋章</h3><p class="hint">最长连续修炼 ${longest} 天</p><div class="badges">${badges}</div></div>
    <div class="card"><h3>讨伐记录</h3>${raidWall()}</div>
    <div class="card"><h3>晋级之路</h3>${ladder}</div>`;
}

function raidWall() {
  const raids = state.bonuses.filter((b) => b.kind === 'raid').sort((a, b) => b.week.localeCompare(a.week));
  if (!raids.length) return '<p class="hint">每周把大鬼的血条打空，就会记录在这里。</p>';
  return `<p class="hint">已讨伐 ${raids.length} 只大鬼</p><div class="raidwall">${raids.map((b) =>
    `<span class="w">${CH.charHTML(b.boss)}<br>${CH.CHARS[b.boss].name}<br>${b.week.slice(5).replace('-', '/')}</span>`).join('')}</div>`;
}

// ---------- 页面：奖励 ----------
function rewardsView() {
  const L = ledger(state);
  const list = [...state.rewards].sort((a, b) => a.cost - b.cost).map((r) => {
    const enough = L.available >= r.cost;
    return `<div class="card reward"><span class="gift">🎁</span><div class="grow"><b>${esc(r.name)}</b><div>${star(r.cost)}</div></div>
      <button class="pill ${enough ? 'red' : 'gray'}" data-action="redeem" data-id="${esc(r.id)}" ${enough ? '' : 'disabled'}>${enough ? '兑换' : `还差 ${r.cost - L.available}`}</button></div>`;
  }).join('') || '<div class="card sub">还没有奖励，请家长在「家长」页添加。</div>';
  const hist = [...state.redemptions].reverse().slice(0, 20).map((d) =>
    `<div class="flex small"><span>${esc(d.name)}</span><span class="sub">-${d.cost}⭐ ${new Date(d.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span></div>`).join('');
  return `
    <h2 class="title">奖励兑换</h2>
    <div class="card flex"><b>可用星星</b>${star(L.available, 'big')}</div>
    ${list}
    ${hist ? `<div class="card"><h3>兑换记录</h3>${hist}</div>` : ''}`;
}

// ---------- 页面：家长 ----------
function pinPadHTML() {
  const dots = [0, 1, 2, 3].map((i) => `<i class="${i < pin.input.length ? 'on' : ''}"></i>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) =>
    k ? `<button class="key" data-action="pin-key" data-k="${k}">${k}</button>` : '<span></span>').join('');
  return `<div class="pinpad"><div class="lock">🔐</div><h3>${esc(pin.title)}</h3><p class="hint">${esc(pin.subtitle || '')}</p>
    <div class="dots ${pin.shake ? 'shake' : ''}">${dots}</div><div class="keys">${keys}</div>
    ${pin.overlay ? '<button class="link" data-action="pin-cancel">取消</button>' : ''}</div>`;
}

function parentGate() {
  if (!pin || pin.overlay) {
    const setting = !state.settings.pin;
    pin = {
      overlay: false, input: '',
      title: setting ? (firstPin ? '再输入一次确认' : '设置家长密码') : '家长专区',
      subtitle: setting ? '家长页和奖励兑换都需要这个密码，请不要告诉孩子哦' : '请输入家长密码',
      onDone: (v) => {
        if (state.settings.pin) {
          if (v !== state.settings.pin) return false;
        } else if (!firstPin) {
          firstPin = v; pin = null; render(); return true;
        } else if (firstPin !== v) {
          firstPin = null; pin = null; render(); return false;
        } else {
          state.settings.pin = v; firstPin = null; persist();
        }
        parentUnlocked = true; pin = null; render(); return true;
      },
    };
  }
  return `<h2 class="title">家长</h2>${pinPadHTML()}`;
}

function lineChart(points, color, unit, ref = null, digits = 1) {
  points = points.filter((p) => Number.isFinite(p.y)).slice(-16);
  if (points.length < 1) return `<p class="hint">${unit}：还没有记录</p>`;
  const W = 320, H = 120, P = 24;
  const ys = points.map((p) => p.y).concat(ref != null ? [ref] : []);
  let min = Math.min(...ys), max = Math.max(...ys);
  const span = digits > 1 ? 0.02 : 1;
  if (max - min < span) { min -= span / 2; max += span / 2; }
  const x = (i) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1));
  const y = (v) => H - P - ((v - min) * (H - 2 * P)) / (max - min);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3.5" fill="${color}"/>`).join('');
  const labels = points.map((p, i) => `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${p.label}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><text x="2" y="12">${unit}</text>
    <text x="${W - 2}" y="12" text-anchor="end">${max.toFixed(digits)}</text><text x="${W - 2}" y="${H - P + 4}" text-anchor="end">${min.toFixed(digits)}</text>
    ${ref != null ? `<line x1="${P}" x2="${W - P}" y1="${y(ref)}" y2="${y(ref)}" stroke="#f2b84d" stroke-dasharray="4 4" stroke-width="1"/><text x="${P}" y="${y(ref) - 3}" fill="#f2b84d">${ref}</text>` : ''}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}${labels}</svg>`;
}

function parentView() {
  if (!parentUnlocked) return parentGate();
  const s = state.settings;
  const bodies = [...state.bodies].sort((a, b) => a.date.localeCompare(b.date));
  const lbl = (d) => d.slice(5).replace('-', '/');
  const pts = (f) => bodies.filter((b) => b[f] != null).map((b) => ({ y: b[f], label: lbl(b.date) }));
  const whtPts = bodies.map((b) => ({ y: R.waistToHeight(bodies, b), label: lbl(b.date) })).filter((p) => p.y != null);
  const lastOf = (f) => [...bodies].reverse().find((b) => b[f] != null);
  const lw = lastOf('w'), lwa = lastOf('waist'), lh = lastOf('h');
  const bmi = R.bmiOf(bodies, lw), wht = R.waistToHeight(bodies, lwa);
  const fmtB = (b) => [b.w != null ? `${b.w} kg` : '', b.waist != null ? `腰 ${b.waist} cm` : '', b.h != null ? `${b.h} cm` : ''].filter(Boolean).join(' · ');
  const measured = R.measuredThisWeek(bodies, now());
  const keys = new Set(Object.keys(state.logs));
  const mk = new Set(Object.entries(state.logs).filter(([, l]) => l.isMakeup).map(([k]) => k));
  const cands = R.makeupCandidates(keys, mk, now());
  const logs = Object.values(state.logs).sort((a, b) => b.dayKey.localeCompare(a.dayKey)).slice(0, 14);
  const today = R.dayKey(now());

  return `
  <div class="flex"><h2 class="title">家长</h2><button class="pill gray" data-action="lock">🔒 锁定</button></div>

  <div class="card"><h3>孩子昵称</h3>
    <div class="flex gap"><input id="p-name" maxlength="8" value="${esc(state.profile.name)}"><button class="pill red" data-action="save-name">保存</button></div></div>

  <div class="card"><h3>成长记录（仅家长可见）</h3>
    <p class="${measured ? 'green' : 'gold'}">${measured ? '本周已测量 ✅' : '本周还没测量（记齐体重和腰围，孩子 +1 ⭐）'}</p>
    <div class="form2b"><input id="b-date" type="date" value="${today}" max="${today}"><input id="b-w" inputmode="decimal" placeholder="体重 kg"><input id="b-waist" inputmode="decimal" placeholder="腰围 cm"><input id="b-h" inputmode="decimal" placeholder="身高 cm（可不填）"></div>
    <button class="btn green" data-action="add-body">保存本次测量</button>
    <p class="hint">每周固定一次：周日早上起床后、空腹，腰围在肚脐那一圈量。身高每月量一次即可。留空的项会保留当天已记的数据。</p>
    ${bodies.length ? `
      <p><b>最新：</b>${lw ? `体重 ${lw.w} kg（${lbl(lw.date)}）` : ''}${lwa ? ` · 腰围 ${lwa.waist} cm（${lbl(lwa.date)}）` : ''}${lh ? ` · 身高 ${lh.h} cm（${lbl(lh.date)}）` : ''}
        ${bmi != null ? `<br>BMI ${bmi.toFixed(1)}` : ''}${wht != null ? `${bmi != null ? ' · ' : '<br>'}腰围/身高 ${wht.toFixed(2)}` : ''}</p>
      ${lineChart(pts('waist'), '#f2b84d', '腰围 cm')}${lineChart(whtPts, '#4d9ef2', '腰围/身高', 0.5, 2)}${lineChart(pts('w'), '#cc1a33', '体重 kg')}${lineChart(pts('h'), '#1f8561', '身高 cm')}
      <p class="hint">腰围/身高：一般认为儿童低于 0.5 较理想；儿童 BMI 要按年龄和性别对照。都仅供参考，以儿保医生评估为准。理想趋势：身高在长、腰围不变或变细。</p>
      ${[...bodies].reverse().map((b) => `<div class="flex small"><span>${b.date}</span><span>${fmtB(b)} <button class="x" data-action="del-body" data-date="${b.date}">✕</button></span></div>`).join('')}`
      : '<p class="sub">还没有记录。</p>'}</div>

  <div class="card"><h3>补卡（每周最多 1 次，无早睡奖励）</h3>
    ${cands.length ? cands.map((d) => `<button class="row-btn" data-action="makeup" data-day="${R.dayKey(d)}">📅 补登 ${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}</button>`).join('') : '<p class="sub">最近 7 天没有可补的日子（或本周已补过）。</p>'}</div>

  <div class="card"><h3>奖励设置</h3>
    ${state.rewards.map((r) => `<div class="flex small"><span>${esc(r.name)}</span><span>${star(r.cost)} <button class="x" data-action="del-reward" data-id="${esc(r.id)}">✕</button></span></div>`).join('')}
    <div class="form2"><input id="r-name" maxlength="20" placeholder="奖励，例如：周末去游泳"><input id="r-cost" inputmode="numeric" placeholder="星星数" value="30"></div>
    <button class="btn green" data-action="add-reward">添加奖励</button></div>

  <div class="card"><h3>加分运动选项</h3><p class="hint">孩子打卡时可多选，每项 +1 星，每天最多算 ${R.MAX_EXTRA_STARS} 项。「爬楼梯两次」是必做项，不在这里。</p>
    ${s.exercises.map((e, i) => `<div class="flex small"><span>${esc(e)}</span><span>${i ? `<button class="x" data-action="up-ex" data-i="${i}">↑</button>` : ''}<button class="x" data-action="del-ex" data-i="${i}">✕</button></span></div>`).join('')}
    <div class="flex gap"><input id="ex-name" maxlength="12" placeholder="新运动，例如：做家务 30 分钟"><button class="pill red" data-action="add-ex">添加</button></div>
    <button class="link" data-action="reset-ex">恢复默认选项</button></div>

  <div class="card"><h3>最近打卡</h3>
    ${logs.length ? logs.map((l) => `<div class="loghead"><b>${l.dayKey}</b>${l.isMakeup ? '<span class="tag">补</span>' : ''}<span class="grow"></span>${R.MOODS[l.mood]?.[0] || ''} ${star(l.stars)}</div>
      <p class="hint">${R.ITEMS.map((i) => `${i.short}${l[i.key] ? '✓' : '✗'}`).join(' · ')} · 跳绳${l.ropeCount}${l.extras?.length ? ' · ' + l.extras.map(esc).join('、') : ''}</p>`).join('') : '<p class="sub">还没有打卡记录</p>'}</div>

  <div class="card"><h3>设置</h3>
    <div class="flex"><span>打卡开始</span><input id="s-start" type="time" value="${R.timeText(s.start)}"></div>
    <div class="flex"><span>打卡截止</span><input id="s-end" type="time" value="${R.timeText(s.end)}"></div>
    <p class="hint">截止最晚 23:59，且至少比开始晚 1 小时。${NV.has('reminder') ? '' : '网页版没有定时推送提醒，记得每晚提醒孩子打开。'}</p>
    <button class="btn green" data-action="save-time">保存时间</button>
    ${reminderRow()}
    <div class="flex"><span>每周讨伐目标</span><span class="flex gap"><input id="s-raid" inputmode="numeric" style="width:70px" value="${state.settings.raidTarget}"> 颗星 <button class="pill red" data-action="save-raid">保存</button></span></div>
    <p class="hint">10–80 颗星，一周内得到的星星就是对大鬼的伤害，打空血条额外 +3 ⭐。</p>
    <div class="flex"><span>动画音效</span><button class="pill ${FX.muted() ? 'gray' : 'red'}" data-action="toggle-sound">${FX.muted() ? '🔇 已关闭' : '🔊 已开启'}</button></div></div>

  ${bgmCard()}

  ${SYNC.cardHTML()}

  <div class="card"><h3>数据备份</h3>
    <p class="hint">${NV.isNative() ? '数据只存在这台手机的 App 里。卸载 App 或换手机会丢失，建议每月导出一次备份；重新安装/升级前一定先导出。' : '数据只存在这台手机的浏览器里。清除 Safari 数据或换手机会丢失，建议每月导出一次备份。'}</p>
    ${!NV.isNative() || NV.has('export') ? '<button class="btn green" data-action="export">导出备份文件</button>' : '<p class="hint">此版本暂不支持导出备份。</p>'}
    <label class="btn gray file">从备份恢复<input type="file" id="import-file" accept="application/json,.json"></label>
    <button class="btn danger" data-action="reset-pin">重设家长密码</button></div>`;
}

function bgmCard() {
  const b = BGM.settings();
  return `<div class="card"><h3>🎵 背景音乐</h3>
    <div class="flex"><span>背景音乐</span><button class="pill ${b.on ? 'red' : 'gray'}" data-action="bgm-toggle">${b.on ? '🎵 已开启' : '🔇 已关闭'}</button></div>
    <div class="flex"><span>音量</span><input id="bgm-vol" type="range" min="0" max="100" value="${Math.round(b.vol * 100)}" style="width:60%"></div>
    <p class="small">平时播放：<b>${esc(b.customName || b.builtinName || '原创和风配乐')}</b>（打完卡和睡前拉伸时换成安静的曲子）</p>
    <label class="btn gray file">选择自己的歌曲<input type="file" id="bgm-file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac"></label>
    ${b.customName ? `<button class="btn gray" data-action="bgm-clear">换回${b.builtinName ? esc(b.builtinName) : '原创配乐'}</button>` : ''}
    <p class="hint">支持 mp3、m4a 等普通音乐文件，只保存在这台手机里。网易云、QQ 音乐会员下载的加密文件（.ncm 等）放不出来。「动画音效」关闭时背景音乐也不播放。</p></div>`;
}

function reminderRow() {
  if (!NV.has('reminder')) return '';
  const m = NV.getReminder();
  const on = m >= 0;
  const shown = on ? m : Math.min(state.settings.start + 30, 1439);
  return `<div class="flex"><span>每晚提醒</span><span class="flex gap"><input id="s-remind" type="time" value="${R.timeText(shown)}">
    <button class="pill ${on ? 'red' : 'gray'}" data-action="remind-toggle">${on ? '🔔 已开启' : '🔕 已关闭'}</button></span></div>
    ${on && NV.has('autostartHint') ? '<p class="hint">如果收不到提醒：请到系统设置里允许本 App 自启动、后台运行和通知。</p>' : ''}`;
}

async function applyReminder(minutes, okMsg) {
  const r = await NV.setReminder(minutes);
  const msg = { ok: okMsg, denied: '没有通知权限，请到系统设置里允许本 App 发通知', invalid: '提醒时间不对' }[r] || '设置提醒失败，请重试';
  toast(msg);
  if (tab === 'parent' && parentUnlocked && !$('#overlay').innerHTML) render();
  return r;
}

// 跳绳从 0 变成有数时，风柱登场一次
function ropeStarted(before) {
  if (before === 0 && draft.answers.ropeCount > 0) { const b = CH.BREATH.rope; CH.cutIn(b.char, 'idle', b.title, b.fx, 'right'); FX.sfx.slash(); VO.play('breath-rope'); }
}

// 选心情时祢豆子在表情旁冒出来
function moodBuddy(face) {
  if (!face || FX.reduced()) return;
  const r = face.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'mood-buddy';
  d.style.left = `${Math.min(innerWidth - 60, r.left + r.width / 2 - 20)}px`;
  d.style.top = `${r.top - 76}px`;
  d.innerHTML = CH.charHTML('nezuko', 'cheer');
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), 1000);
}

// ---------- 打卡弹层 ----------
function openCheckIn(mode, day) {
  draft = { mode, day, answers: R.emptyAnswers(), result: null, error: '' };
  renderOverlay();
}

function presenterHTML(rank) {
  const id = CH.RANK_PRESENTER[rank.name];
  if (!id) return '';
  const who = rank.name === '柱' ? CH.charHTML('tanjiro', 'cheer') + CH.charHTML('nezuko', 'cheer') : CH.charHTML(id);
  return `<div class="present">${who}</div>`;
}

function checkInHTML() {
  const a = draft.answers;
  const isMakeup = draft.mode === 'makeup';
  if (draft.result) {
    const r = draft.result;
    return `<div class="celebrate"><div class="spark">✨</div><div class="plus">+<span id="plusn">${r.stars}</span> ⭐</div>
      ${r.newRank ? `${presenterHTML(r.newRank)}${seal(r.newRank, 90).replace('class="seal ', 'class="seal stamp ')}<h2 class="gold">晋级啦！现在是「${r.newRank.name}」级 · ${esc(rankTitle(r.newRank))}</h2>` : `<h2>${isMakeup ? '补卡完成' : '今晚的修炼完成，辛苦啦！'}</h2>`}
      <button class="btn green" data-action="close-overlay">好的</button></div>`;
  }
  const toggles = R.ITEMS.map((i) => `
    <button class="toggle ${a[i.key] ? 'on' : ''}" data-action="toggle" data-k="${i.key}">
      <span class="ticon">${i.icon}</span><span class="grow">${i.title}</span><span class="check">${a[i.key] ? '✅' : '⚪️'}</span></button>`).join('');
  const chips = state.settings.exercises.map((e, i) => {
    const on = a.extras.includes(e);
    return `<button class="chip ${on ? 'on' : ''}" data-action="extra" data-i="${i}">${on ? '✓' : '+'} ${esc(e)}</button>`;
  }).join('');
  const moods = R.MOODS.map(([f, l], i) => `<button class="moodbtn ${a.mood === i ? 'on' : ''}" data-action="mood" data-i="${i}"><span>${f}</span><small>${l}</small></button>`).join('');
  return `
    <div class="ohead"><button class="pill gray" data-action="close-overlay">先不写</button><b>${isMakeup ? `补卡：${R.dayKey(draft.day)}` : '今晚的修炼日记'}</b><span></span></div>
    <p class="sub center">一项一项认真回答，诚实的剑士才最厉害！</p>
    ${toggles}
    <div class="card"><h3>🪢 今天跳绳多少下？</h3>
      <div class="rope"><button class="pill gold" data-action="rope" data-d="-100">-100</button><button class="pill gold" data-action="rope" data-d="-10">-10</button>
      <input id="rope" inputmode="numeric" value="${a.ropeCount || ''}" placeholder="0"><button class="pill gold" data-action="rope" data-d="10">+10</button><button class="pill gold" data-action="rope" data-d="100">+100</button></div></div>
    <div class="card"><h3>➕ 加分运动（选做）</h3><p class="hint">每项 +1 ⭐，每天最多算 ${R.MAX_EXTRA_STARS} 项</p><div class="chips">${chips}</div></div>
    <div class="card"><h3>💗 今天心情怎么样？</h3><div class="moods">${moods}</div></div>
    <p class="center">这样提交能拿到 <span id="preview">${star(R.stars(a, now(), isMakeup), 'big')}</span></p>
    ${draft.error ? `<p class="red center">${esc(draft.error)}</p>` : ''}
    <button class="btn red" data-action="submit">✈️ 提交修炼日记</button>`;
}

function submitCheckIn() {
  const t = now();
  const isMakeup = draft.mode === 'makeup';
  const key = R.dayKey(draft.day);
  const keys = new Set(Object.keys(state.logs));
  if (!isMakeup) {
    if (R.windowState(t, state.settings.start, state.settings.end).state !== 'open') {
      draft.error = '现在不在修炼时间里，提交不了哦。'; return renderOverlay();
    }
  } else {
    const mk = new Set(Object.entries(state.logs).filter(([, l]) => l.isMakeup).map(([k]) => k));
    if (R.makeupCheck(draft.day, keys, mk, t) !== 'allowed') {
      draft.error = '这一天不能补卡（可能已打卡或本周已补过）。'; return renderOverlay();
    }
  }
  if (keys.has(key)) { draft.error = '这一天已经打过卡了。'; return renderOverlay(); }
  if (!confirm('确定提交吗？提交以后今天就不能再改啦。')) return;
  const before = ledger(state).earned;
  const stars = R.stars(draft.answers, t, isMakeup);
  state.logs[key] = { dayKey: key, ...draft.answers, extras: [...draft.answers.extras], stars, submittedAt: t.toISOString(), isMakeup };
  persist();
  const r0 = R.rankFor(before), r1 = R.rankFor(before + stars);
  const raid = R.syncRaid(state, t);
  if (raid) { state.bonuses.push(raid); persist(); }
  draft.result = { stars, newRank: r1.index > r0.index ? r1 : null };
  renderOverlay();
  const res = draft.result;
  $('#plusn').textContent = '0';
  VO.play('slash', '全集中！斩！');
  CH.slashScene(R.impsFor(state.logs[key], t, isMakeup), () => {
    if (draft?.result !== res) return;
    FX.countUp($('#plusn'), stars);
    FX.confetti(res.newRank ? 110 : 70);
    if (res.newRank) { FX.sfx.levelUp(); CH.crowBubble('晋级！晋级！'); } else FX.sfx.ding();
    if (raid) { FX.sfx.bossDown(); toast(`讨伐成功！打败了${CH.CHARS[raid.boss].name}，额外 +3 ⭐`, true); }
    rankVoices(res.newRank, !!raid);
  });
}

// ---------- 拉伸弹层 ----------
// 晋级：鎹鸦先喊，播完再由授阶的柱说一句；讨伐成功鎹鸦报喜（晋级时接在后面）
async function rankVoices(newRank, raidWon) {
  if (newRank) {
    const id = CH.RANK_PRESENTER[newRank.name];
    if (!(await VO.play('crow-rankup', '晋级！晋级！'))) return;
    if (id && !(await VO.play(`present-${id}`))) return;
  }
  if (raidWon) VO.play('crow-raidwin', '讨伐成功！');
}

// 拉伸旁白：优先播预生成语音，失败时系统朗读
const speak = (key, text) => VO.play(key, text);
const keepAwake = (on) => NV.keepAwake(on);

function openStretch() {
  stretch = { i: 0, left: R.STRETCH[0].seconds, running: false, started: false, done: false, timer: null };
  VO.preload([...R.STRETCH.map((_, i) => `stretch-${i}`), 'stretch-321', 'stretch-done']);
  BGM.setScene('calm');
  renderOverlay();
}

function closeStretch() {
  if (!stretch) return;
  clearInterval(stretch.timer);
  keepAwake(false);
  VO.stop();
  stretch = null;
  bgmScene();
}

function stretchAdvance() {
  if (stretch.i + 1 >= R.STRETCH.length) {
    stretch.done = true; stretch.running = false; clearInterval(stretch.timer);
    speak('stretch-done', '修炼完成！好好睡觉，明天会更强。');
    setTimeout(FX.sfx.night, 300);
    return renderOverlay();
  }
  stretch.i++;
  stretch.left = R.STRETCH[stretch.i].seconds;
  const m = R.STRETCH[stretch.i];
  if (stretch.started) speak(`stretch-${stretch.i}`, `下一个动作，${m.name}。${m.tip}`);
  renderOverlay();
}

function stretchToggle() {
  if (!stretch.started) {
    stretch.started = true;
    const m = R.STRETCH[0];
    speak('stretch-0', `全集中！第一个动作，${m.name}。${m.tip}`);
    keepAwake(true);
  }
  stretch.running = !stretch.running;
  clearInterval(stretch.timer);
  if (stretch.running) {
    stretch.timer = setInterval(() => {
      stretch.left--;
      if (stretch.left === 3) speak('stretch-321', '三，二，一');
      if (stretch.left <= 3 && stretch.left > 0) FX.sfx.tick();
      if (stretch.left <= 0) stretchAdvance(); else renderOverlay();
    }, 1000);
  }
  renderOverlay();
}

function stretchHTML() {
  const close = '<div class="ohead"><b>全集中·睡前修炼</b><span></span><button class="pill gray" data-action="close-overlay" aria-label="关闭">✕</button></div>';
  if (stretch.done) {
    return `${close}<div class="celebrate"><div class="sleepy">${CH.charHTML('nezuko', 'sleep')}</div><div class="spark"><span class="moon">🌙</span></div><div class="zzz"><span>z</span><span>Z</span><span>Z</span></div><h2>修炼完成！</h2><p class="sub">身体放松好了，快去睡觉吧。<br>睡得好，明天会更强！</p>
      <button class="btn green" data-action="close-overlay">晚安</button></div>`;
  }
  const m = R.STRETCH[stretch.i];
  const pct = stretch.left / m.seconds;
  const C = 2 * Math.PI * 100;
  return `${close}
    <p class="sub center">第 ${stretch.i + 1} / ${R.STRETCH.length} 个动作</p>
    <div class="ring"><svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="100" class="track"/>
      <circle cx="120" cy="120" r="100" class="prog" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
      <div class="ring-in"><div class="ricon">${m.icon}</div><b class="${stretch.running && stretch.left <= 3 ? 'beat' : ''}">${stretch.left}</b><small>秒</small></div></div>
    <h2 class="center">${m.name}</h2><p class="sub center tip">${m.tip}</p>
    <div class="row"><button class="btn ${stretch.running ? 'gray' : 'green'}" data-action="stretch-toggle">${stretch.running ? '⏸ 暂停' : stretch.started ? '▶️ 继续' : '▶️ 开始'}</button>
      <button class="btn gray" data-action="stretch-next">⏭ 下一个</button></div>
    <div class="stretch-buddy">${CH.charHTML(stretch.i % 2 ? 'nezuko' : 'tanjiro', 'cheer')}</div>`;
}

// ---------- 渲染 ----------
function tabsHTML() {
  const t = [['home', '🔥', '修炼'], ['ranks', '🛡️', '阶级'], ['rewards', '🎁', '奖励'], ['parent', '🔒', '家长']];
  return t.map(([k, i, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-action="tab" data-tab="${k}"><span>${i}</span>${l}</button>`).join('');
}

// 背景音乐场景：家长页不放；拉伸或今天已打卡（准备睡觉）放安静曲；其余放热血曲/自己的歌
function bgmScene() {
  if (SYNC.isViewer() || !state.profile.name || tab === 'parent') return BGM.setScene('off');
  BGM.setScene(stretch || state.logs[R.dayKey(now())] ? 'calm' : 'main');
}

function render() {
  if (SYNC.isViewer()) { BGM.setScene('off'); VIEW.render(); return; }
  bgmScene();
  if (!state.profile.name) {
    $('#app').innerHTML = setupView();
    $('#tabs').innerHTML = '';
    syncBack();
    return;
  }
  const raid = R.syncRaid(state, now());
  if (raid) { state.bonuses.push(raid); persist(); toast(`讨伐成功！打败了${CH.CHARS[raid.boss].name}，额外 +3 ⭐`, true); VO.play('crow-raidwin', '讨伐成功！'); }
  const views = { home: homeView, ranks: ranksView, rewards: rewardsView, parent: parentView };
  $('#app').innerHTML = views[tab]();
  $('#tabs').innerHTML = tabsHTML();
  document.title = `${childName()}的修炼日记`;
  const hs = $('.hero .seal');
  if (hs) hs.style.animationDelay = `-${(performance.now() % 3000) / 1000}s`;
  FX.fireflies();
  syncBack();
  celebrateProgress();
  if (tab !== 'home') document.querySelector('.crow')?.remove();
  maybeCrow();
}

// 告诉原生外壳：现在按返回键是否由网页处理（有弹层或不在首页）
function syncBack() {
  if (SYNC.isViewer()) return NV.setCanGoBack(!!$('#overlay').innerHTML || VIEW.canGoBack());
  NV.setCanGoBack(!!$('#overlay').innerHTML || (!!state.profile.name && tab !== 'home'));
}

// 原生返回键：先关弹层，再回首页；都没有则返回 false 交给系统
function back() {
  if (SYNC.isViewer()) return VIEW.back();
  if ($('#overlay').innerHTML) { closeOverlay(); return true; }
  if (state.profile.name && tab !== 'home') { actions.tab({ dataset: { tab: 'home' } }); return true; }
  return false;
}

function renderOverlay() {
  const el = $('#overlay');
  const scroll = el.scrollTop;
  let html = '';
  if (pin?.overlay) html = pinPadHTML();
  else if (draft) html = checkInHTML();
  else if (stretch) html = stretchHTML();
  el.innerHTML = html;
  el.classList.toggle('show', !!html);
  document.body.classList.toggle('noscroll', !!html);
  el.scrollTop = scroll;
  syncBack();
}

function closeOverlay() {
  if (pin?.overlay) { pin = null; return renderOverlay(); }
  draft = null;
  closeStretch();
  renderOverlay();
  render();
}

// 提示：重要提示（如讨伐成功）不会被普通提示覆盖，普通提示排在它后面
const toastQ = [];
let toastImportant = false;
function toast(msg, important = false) {
  if (toastImportant) { toastQ.push([msg, important]); return; }
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  toastImportant = important;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    t.classList.remove('show');
    toastImportant = false;
    const next = toastQ.shift();
    if (next) setTimeout(() => toast(...next), 200);
  }, important ? 3000 : 2200);
}

// ---------- 事件 ----------
function pinKey(k) {
  if (!pin) return;
  pin.shake = false;
  if (k === '⌫') pin.input = pin.input.slice(0, -1);
  else if (pin.input.length < 4) pin.input += k;
  const rerender = () => (pin?.overlay ? renderOverlay() : render());
  rerender();
  if (pin.input.length === 4) {
    const p = pin, v = pin.input;
    setTimeout(() => {
      const ok = p.onDone(v);
      if (!ok && pin === p) { p.input = ''; p.shake = true; rerender(); }
      else if (!ok && pin === null) { toast('两次输入不一致，请重新设置'); }
    }, 150);
  }
}

const actions = {
  'setup-save': () => {
    const name = $('#setup-name').value.trim();
    if (!name) return toast('请填写孩子的昵称');
    state.profile.name = name.slice(0, 8); persist(); render();
  },
  'hide-install': () => { localStorage.setItem('xiulian.hideInstall', '1'); render(); },
  tab: (el) => { tab = el.dataset.tab; if (tab !== 'parent') { parentUnlocked = false; pin = null; firstPin = null; } render(); window.scrollTo(0, 0); FX.replay($('#app'), 'enter'); },
  checkin: () => { CH.preload(CH.PRELOAD_CHECKIN); VO.preload([...Object.keys(CH.BREATH).map((k) => `breath-${k}`), 'slash', 'mood']); openCheckIn('tonight', now()); },
  duty: (el) => {
    if (el.dataset.sleep) { CH.crowBubble('嘘……祢豆子睡着了。'); VO.play('crow-sleep'); return; }
    const id = el.dataset.id;
    el.innerHTML = CH.charHTML(id, CH.CHARS[id].poses.action ? 'action' : (CH.CHARS[id].poses.cheer ? 'cheer' : 'idle'));
    FX.replay(el, 'act');
    document.querySelector('.say')?.remove();
    const [li, line] = CH.pickLine(id);
    const b = document.createElement('div'); b.className = 'say'; b.textContent = line;
    el.parentNode.appendChild(b);
    VO.play(`line-${id}-${li}`, line);
    clearTimeout(actions.duty.timer);
    actions.duty.timer = setTimeout(() => { b.remove(); if (el.isConnected) el.innerHTML = CH.charHTML(id); }, 2500);
  },
  stretch: () => openStretch(),
  'close-overlay': () => closeOverlay(),
  toggle: (el) => {
    const k = el.dataset.k, on = !draft.answers[k];
    draft.answers[k] = on; renderOverlay();
    const icon = $(`#overlay .toggle[data-k="${k}"] .ticon`);
    FX.replay(icon, on ? 'wiggle' : 'pop');
    if (on) {
      FX.burst(icon); FX.sfx.pop();
      const b = CH.BREATH[k];
      if (b) { VO.play(`breath-${k}`); CH.cutIn(b.char, b.pose || 'idle', b.title, b.fx); if (b.fx === 'thunder') FX.sfx.thunder(); else if (b.fx === 'water') FX.sfx.water(); else FX.sfx.slash(); }
    } else FX.sfx.off();
  },
  extra: (el) => {
    const name = state.settings.exercises[+el.dataset.i];
    const ex = draft.answers.extras;
    const on = !ex.includes(name);
    draft.answers.extras = on ? [...ex, name] : ex.filter((x) => x !== name);
    renderOverlay();
    const chip = $(`#overlay .chip[data-i="${el.dataset.i}"]`);
    FX.replay(chip, 'pop');
    if (on) { FX.burst(chip, { n: 6, dist: 50 }); FX.sfx.pop(); const b = CH.BREATH.extra; CH.cutIn(b.char, 'idle', b.title, b.fx, 'right'); VO.play('breath-extra'); } else FX.sfx.off();
  },
  mood: (el) => {
    draft.answers.mood = +el.dataset.i; renderOverlay();
    const face = $(`#overlay .moodbtn[data-i="${el.dataset.i}"] span`);
    FX.replay(face, 'wiggle'); FX.burst(face, { items: ['💖', '✨'], n: 6, dist: 45 }); FX.sfx.pop();
    moodBuddy(face);
    VO.play('mood');
  },
  rope: (el) => {
    const before = draft.answers.ropeCount;
    draft.answers.ropeCount = Math.max(0, Math.min(99999, draft.answers.ropeCount + +el.dataset.d)); renderOverlay();
    FX.replay($('#rope'), 'pop');
    ropeStarted(before);
  },
  'save-raid': () => {
    const v = R.cleanRaidTarget(Number($('#s-raid').value.trim()));
    if (v == null) return toast('讨伐目标要填 10–80 之间的整数');
    state.settings.raidTarget = v; persist(); render(); toast(`每周讨伐目标：${v} 颗星`);
  },
  submit: () => submitCheckIn(),
  'stretch-toggle': () => stretchToggle(),
  'stretch-next': () => stretchAdvance(),
  redeem: (el) => {
    const r = state.rewards.find((x) => x.id === el.dataset.id);
    if (!r) return;
    if (!state.settings.pin) return toast('请家长先到「家长」页设置密码');
    pin = {
      overlay: true, input: '', title: '请家长输入密码', subtitle: `确认兑换「${r.name}」，扣除 ${r.cost} 颗星`,
      onDone: (v) => {
        if (v !== state.settings.pin) return false;
        if (ledger(state).available >= r.cost) {
          state.redemptions.push({ name: r.name, cost: r.cost, date: now().toISOString() });
          persist(); toast(`兑换成功：${r.name}`);
          FX.giftOpen(r.name); FX.sfx.gift();
        }
        pin = null; renderOverlay(); render(); return true;
      },
    };
    renderOverlay();
  },
  'pin-key': (el) => pinKey(el.dataset.k),
  'pin-cancel': () => { pin = null; renderOverlay(); },
  lock: () => { parentUnlocked = false; pin = null; render(); },
  'save-name': () => {
    const v = $('#p-name').value.trim();
    if (!v) return toast('昵称不能为空');
    state.profile.name = v.slice(0, 8); persist(); render(); toast('已保存');
  },
  'add-body': () => {
    const t = now();
    const date = $('#b-date').value;
    if (!R.isRealDayKey(date) || date > R.dayKey(t)) return toast('请选择正确的日期（不能晚于今天）');
    const entry = { date };
    const names = { w: '体重（15–150 kg）', waist: '腰围（40–150 cm）', h: '身高（80–220 cm）' };
    for (const [f, id] of [['w', '#b-w'], ['waist', '#b-waist'], ['h', '#b-h']]) {
      const raw = $(id).value.trim().replace(',', '.');
      if (!raw) continue;
      const v = R.cleanBodyValue(f, Number(raw));
      if (v == null) return toast(`请填写正确的${names[f]}`);
      entry[f] = v;
    }
    if (Object.keys(entry).length === 1) return toast('体重、腰围、身高至少填一项');
    state.bodies = R.mergeBody(state.bodies, entry);
    const bonus = R.measureBonusFor(state.bodies, state.bonuses, date, t);
    if (bonus) state.bonuses.push(bonus);
    persist(); render();
    toast(bonus ? '已记录，孩子获得 1 颗星 ⭐' : '已记录');
  },
  'del-body': (el) => { if (confirm('删除这一天的全部测量记录？（已经给孩子的星星不会收回）')) { state.bodies = state.bodies.filter((b) => b.date !== el.dataset.date); persist(); render(); } },
  makeup: (el) => openCheckIn('makeup', R.dateFromKey(el.dataset.day)),
  'add-reward': () => {
    const name = $('#r-name').value.trim(), cost = parseInt($('#r-cost').value, 10);
    if (!name || !(cost >= 1 && cost <= 999)) return toast('请填写奖励内容和星星数（1–999）');
    state.rewards.push({ id: `r${Date.now()}`, name, cost }); persist(); render();
  },
  'del-reward': (el) => { state.rewards = state.rewards.filter((r) => r.id !== el.dataset.id); persist(); render(); },
  'add-ex': () => {
    const v = $('#ex-name').value.trim();
    if (!v) return;
    state.settings.exercises = R.normalizeList([...state.settings.exercises, v]); persist(); render();
  },
  'del-ex': (el) => { state.settings.exercises.splice(+el.dataset.i, 1); persist(); render(); },
  'up-ex': (el) => {
    const i = +el.dataset.i, l = state.settings.exercises;
    [l[i - 1], l[i]] = [l[i], l[i - 1]]; persist(); render();
  },
  'reset-ex': () => { state.settings.exercises = [...R.DEFAULT_EXERCISES]; persist(); render(); },
  'save-time': () => {
    const toMin = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
    const { start, end } = R.sanitizeWindow(toMin($('#s-start').value), toMin($('#s-end').value));
    state.settings.start = start; state.settings.end = end; persist(); render();
    toast(`打卡时间：${R.timeText(start)}–${R.timeText(end)}`);
    const rm = NV.getReminder();
    if (rm >= 0 && (rm < start || rm > end - 30)) {
      const nm = Math.min(start + 30, 1439);
      applyReminder(nm, `提醒时间已跟着调整为 ${R.timeText(nm)}`);
    }
  },
  'remind-toggle': () => {
    if (NV.getReminder() >= 0) return applyReminder(-1, '已关闭每晚提醒');
    const [h, m] = ($('#s-remind').value || '').split(':').map(Number);
    const v = h * 60 + m;
    if (!(v >= 0 && v < 1440)) return toast('请先选好提醒时间');
    applyReminder(v, `每晚 ${R.timeText(v)} 会提醒打卡`);
  },
  export: async () => {
    if (NV.isNative()) {
      if (!NV.has('export')) return toast('此版本暂不支持导出');
      const r = await NV.exportBackup(`修炼日记备份-${R.dayKey(now())}.json`, JSON.stringify(state, null, 1));
      return toast({ ok: '备份已保存', cancel: '已取消导出', timeout: '可能已保存，请到「文件」里确认' }[r] || '保存失败，请重试');
    }
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const name = `修炼日记备份-${R.dayKey(now())}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch { /* 用户取消则走下载 */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  'toggle-sound': () => { FX.setMuted(!FX.muted()); if (FX.muted()) VO.stop(); BGM.refresh(); render(); if (!FX.muted()) FX.sfx.pop(); },
  'bgm-toggle': () => { BGM.setOn(!BGM.settings().on); render(); },
  'bgm-quick': () => {
    if (FX.muted()) return toast('动画音效已关闭，请到家长页打开');
    BGM.setOn(!BGM.settings().on); render(); toast(BGM.settings().on ? '🎵 背景音乐已打开' : '🔇 背景音乐已关闭');
  },
  'bgm-clear': async () => { await BGM.clearSong(); render(); toast(`已换回${BGM.settings().builtinName || '原创配乐'}`); },
  'reset-pin': () => {
    if (!confirm('会清除当前家长密码并退出家长页，下次进入时重新设置。确定吗？')) return;
    state.settings.pin = ''; persist(); parentUnlocked = false; pin = null; render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  // 查看模式只允许查看页自己的动作和点角色听语音
  const fn = SYNC.isViewer() ? (VIEW.actions[a] || (a === 'duty' ? actions.duty : null)) : (actions[a] || SYNC.actions[a]);
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'rope' && draft) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
    if (digits !== e.target.value) e.target.value = digits;
    const before = draft.answers.ropeCount;
    draft.answers.ropeCount = Number(digits) || 0;
    ropeStarted(before);
    const p = $('#preview');
    if (p) p.innerHTML = star(R.stars(draft.answers, now(), draft.mode === 'makeup'), 'big');
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 's-remind') {
    const [h, m] = e.target.value.split(':').map(Number);
    if (NV.getReminder() >= 0 && h * 60 + m >= 0) applyReminder(h * 60 + m, `每晚 ${e.target.value} 会提醒打卡`);
    return;
  }
  if (e.target.id === 'bgm-vol') { BGM.setVolume(e.target.value / 100); return; }
  if (e.target.id === 'bgm-file' && e.target.files[0]) {
    toast('正在读取歌曲…');
    const r = await BGM.importSong(e.target.files[0]).catch(() => 'bad');
    toast({ ok: '已设为背景音乐', ncm: '这是会员加密格式（.ncm 等），放不出来，请换 mp3 或 m4a 文件', big: '文件太大了（超过 40MB）', bad: '这个文件放不出来，请换 mp3 或 m4a 文件' }[r]);
    if (r === 'ok') render();
    return;
  }
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  try {
    const data = sanitize(JSON.parse(await e.target.files[0].text()), now());
    if (!confirm(`备份里有 ${Object.keys(data.logs).length} 天打卡记录，恢复后会覆盖这台手机上现在的数据。确定吗？`)) return;
    state = data; persist(); parentUnlocked = false; render(); toast('已从备份恢复');
  } catch {
    toast('备份文件读取失败');
  }
});

// 首页倒计时每 30 秒刷新（有弹层或在输入时不刷新）
setInterval(() => {
  if (tab === 'home' && !$('#overlay').classList.contains('show') && state.profile.name) render();
}, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && tab === 'home' && !draft && !stretch) render(); });

// 只在网页版的域名注册离线缓存；原生外壳的虚拟域名一律不注册
if ('serviceWorker' in navigator && ['gdutboy.github.io', 'localhost'].includes(location.hostname)) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.();

if (SYNC.isViewer()) {
  VIEW.start({ lineChart, star, seal, esc, logSummary, toast, now, afterRender: syncBack });
  syncBack();
} else {
  SYNC.initSync({ getState: () => state, replaceState: (s) => { state = s; save(state); }, isEmpty, render, toast });
  SYNC.bootRestore().catch(() => {}).then(render);
}
window.__xiulian = { get state() { return state; }, render, back };
