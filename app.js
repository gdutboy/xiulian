import * as R from './rules.js';
import { load, save, ledger, sanitize } from './store.js';

// ---------- 状态 ----------
let state = load();
let tab = 'home';
let parentUnlocked = false;
let draft = null;      // 打卡草稿 {mode:'tonight'|'makeup', day:Date, answers, result}
let stretch = null;    // 拉伸跟练状态
let pin = null;        // 密码盘 {title, subtitle, input, overlay, onDone}
let firstPin = null;   // 设置密码第一次输入

const $ = (sel) => document.querySelector(sel);
const now = () => (window.__fakeNow ? new Date(window.__fakeNow) : new Date());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const persist = () => save(state);
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
    <p class="hint">所有数据只保存在这台手机里，不会上传。</p>
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
    <header class="hero">
      <div class="checker"></div>
      <div class="hero-in">${seal(rank, 62)}
        <div><h1>${esc(childName())}的修炼日记</h1><p class="gold">鬼杀队 · ${rank.name}级 · ${esc(rankTitle(rank))}</p></div>
      </div>
    </header>
    <div class="row">
      <div class="card stat"><span class="gold small">⭐ 可用星星</span><b>${L.available}</b></div>
      <div class="card stat"><span class="red small">🔥 连续修炼</span><b>${R.currentStreak(keys, t)} 天</b></div>
    </div>
    <div class="card today">${today}</div>
    <p class="quote">「${R.wordFor(t)}」</p>`;
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
    <div class="card"><h3>晋级之路</h3>${ladder}</div>`;
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

function lineChart(points, color, unit) {
  if (points.length < 1) return '';
  const W = 320, H = 120, P = 24;
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < 1) { min -= 0.5; max += 0.5; }
  const x = (i) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1));
  const y = (v) => H - P - ((v - min) * (H - 2 * P)) / (max - min);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3.5" fill="${color}"/>`).join('');
  const labels = points.map((p, i) => `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${p.label}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><text x="2" y="12">${unit}</text>
    <text x="${W - 2}" y="12" text-anchor="end">${max.toFixed(1)}</text><text x="${W - 2}" y="${H - P + 4}" text-anchor="end">${min.toFixed(1)}</text>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}${labels}</svg>`;
}

function parentView() {
  if (!parentUnlocked) return parentGate();
  const s = state.settings;
  const bodies = [...state.bodies].sort((a, b) => a.date.localeCompare(b.date));
  const pts = (f) => bodies.map((b) => ({ y: b[f], label: b.date.slice(5).replace('-', '/') }));
  const last = bodies[bodies.length - 1];
  const bmi = last ? last.w / ((last.h / 100) ** 2) : 0;
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
    ${bodies.length ? `${lineChart(pts('w'), '#cc1a33', '体重 kg')}${lineChart(pts('h'), '#1f8561', '身高 cm')}
      <p><b>最新：${last.h} cm / ${last.w} kg，BMI ${bmi.toFixed(1)}</b></p>` : '<p class="sub">还没有记录。建议每月固定一天早上空腹称一次。</p>'}
    <p class="hint">儿童 BMI 要按年龄和性别对照，以儿保医生评估为准。理想趋势：身高在长、体重基本稳定。</p>
    ${[...bodies].reverse().map((b) => `<div class="flex small"><span>${b.date}</span><span>${b.h} cm · ${b.w} kg <button class="x" data-action="del-body" data-date="${b.date}">✕</button></span></div>`).join('')}
    <div class="form3"><input id="b-date" type="date" value="${today}" max="${today}"><input id="b-h" inputmode="decimal" placeholder="身高 cm"><input id="b-w" inputmode="decimal" placeholder="体重 kg"></div>
    <button class="btn green" data-action="add-body">记录身高体重</button></div>

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
    <p class="hint">截止最晚 23:59，且至少比开始晚 1 小时。网页版没有定时推送提醒，记得每晚提醒孩子打开。</p>
    <button class="btn green" data-action="save-time">保存时间</button></div>

  <div class="card"><h3>数据备份</h3>
    <p class="hint">数据只存在这台手机的浏览器里。清除 Safari 数据或换手机会丢失，建议每月导出一次备份。</p>
    <button class="btn green" data-action="export">导出备份文件</button>
    <label class="btn gray file">从备份恢复<input type="file" id="import-file" accept="application/json,.json"></label>
    <button class="btn danger" data-action="reset-pin">重设家长密码</button></div>`;
}

// ---------- 打卡弹层 ----------
function openCheckIn(mode, day) {
  draft = { mode, day, answers: R.emptyAnswers(), result: null, error: '' };
  renderOverlay();
}

function checkInHTML() {
  const a = draft.answers;
  const isMakeup = draft.mode === 'makeup';
  if (draft.result) {
    const r = draft.result;
    return `<div class="celebrate"><div class="spark">✨</div><div class="plus">+${r.stars} ⭐</div>
      ${r.newRank ? `${seal(r.newRank, 90)}<h2 class="gold">晋级啦！现在是「${r.newRank.name}」级 · ${esc(rankTitle(r.newRank))}</h2>` : `<h2>${isMakeup ? '补卡完成' : '今晚的修炼完成，辛苦啦！'}</h2>`}
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
  draft.result = { stars, newRank: r1.index > r0.index ? r1 : null };
  renderOverlay();
}

// ---------- 拉伸弹层 ----------
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

async function keepAwake(on) {
  try {
    if (on && navigator.wakeLock) stretch.lock = await navigator.wakeLock.request('screen');
    else if (!on && stretch?.lock) { await stretch.lock.release(); stretch.lock = null; }
  } catch { /* 不支持就算了 */ }
}

function openStretch() {
  stretch = { i: 0, left: R.STRETCH[0].seconds, running: false, started: false, done: false, timer: null };
  renderOverlay();
}

function closeStretch() {
  if (!stretch) return;
  clearInterval(stretch.timer);
  keepAwake(false);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  stretch = null;
}

function stretchAdvance() {
  if (stretch.i + 1 >= R.STRETCH.length) {
    stretch.done = true; stretch.running = false; clearInterval(stretch.timer);
    speak('修炼完成！好好睡觉，明天会更强。');
    return renderOverlay();
  }
  stretch.i++;
  stretch.left = R.STRETCH[stretch.i].seconds;
  const m = R.STRETCH[stretch.i];
  if (stretch.started) speak(`下一个动作，${m.name}。${m.tip}`);
  renderOverlay();
}

function stretchToggle() {
  if (!stretch.started) {
    stretch.started = true;
    const m = R.STRETCH[0];
    speak(`全集中！第一个动作，${m.name}。${m.tip}`);
    keepAwake(true);
  }
  stretch.running = !stretch.running;
  clearInterval(stretch.timer);
  if (stretch.running) {
    stretch.timer = setInterval(() => {
      stretch.left--;
      if (stretch.left === 3) speak('三，二，一');
      if (stretch.left <= 0) stretchAdvance(); else renderOverlay();
    }, 1000);
  }
  renderOverlay();
}

function stretchHTML() {
  const close = '<div class="ohead"><b>全集中·睡前修炼</b><span></span><button class="pill gray" data-action="close-overlay" aria-label="关闭">✕</button></div>';
  if (stretch.done) {
    return `${close}<div class="celebrate"><div class="spark">🌙</div><h2>修炼完成！</h2><p class="sub">身体放松好了，快去睡觉吧。<br>睡得好，明天会更强！</p>
      <button class="btn green" data-action="close-overlay">晚安</button></div>`;
  }
  const m = R.STRETCH[stretch.i];
  const pct = stretch.left / m.seconds;
  const C = 2 * Math.PI * 100;
  return `${close}
    <p class="sub center">第 ${stretch.i + 1} / ${R.STRETCH.length} 个动作</p>
    <div class="ring"><svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="100" class="track"/>
      <circle cx="120" cy="120" r="100" class="prog" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
      <div class="ring-in"><div class="ricon">${m.icon}</div><b>${stretch.left}</b><small>秒</small></div></div>
    <h2 class="center">${m.name}</h2><p class="sub center tip">${m.tip}</p>
    <div class="row"><button class="btn ${stretch.running ? 'gray' : 'green'}" data-action="stretch-toggle">${stretch.running ? '⏸ 暂停' : stretch.started ? '▶️ 继续' : '▶️ 开始'}</button>
      <button class="btn gray" data-action="stretch-next">⏭ 下一个</button></div>`;
}

// ---------- 渲染 ----------
function tabsHTML() {
  const t = [['home', '🔥', '修炼'], ['ranks', '🛡️', '阶级'], ['rewards', '🎁', '奖励'], ['parent', '🔒', '家长']];
  return t.map(([k, i, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-action="tab" data-tab="${k}"><span>${i}</span>${l}</button>`).join('');
}

function render() {
  if (!state.profile.name) {
    $('#app').innerHTML = setupView();
    $('#tabs').innerHTML = '';
    return;
  }
  const views = { home: homeView, ranks: ranksView, rewards: rewardsView, parent: parentView };
  $('#app').innerHTML = views[tab]();
  $('#tabs').innerHTML = tabsHTML();
  document.title = `${childName()}的修炼日记`;
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
}

function closeOverlay() {
  if (pin?.overlay) { pin = null; return renderOverlay(); }
  draft = null;
  closeStretch();
  renderOverlay();
  render();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
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
  tab: (el) => { tab = el.dataset.tab; if (tab !== 'parent') { parentUnlocked = false; pin = null; firstPin = null; } render(); window.scrollTo(0, 0); },
  checkin: () => openCheckIn('tonight', now()),
  stretch: () => openStretch(),
  'close-overlay': () => closeOverlay(),
  toggle: (el) => { draft.answers[el.dataset.k] = !draft.answers[el.dataset.k]; renderOverlay(); },
  extra: (el) => {
    const name = state.settings.exercises[+el.dataset.i];
    const ex = draft.answers.extras;
    draft.answers.extras = ex.includes(name) ? ex.filter((x) => x !== name) : [...ex, name];
    renderOverlay();
  },
  mood: (el) => { draft.answers.mood = +el.dataset.i; renderOverlay(); },
  rope: (el) => { draft.answers.ropeCount = Math.max(0, Math.min(99999, draft.answers.ropeCount + +el.dataset.d)); renderOverlay(); },
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
    const date = $('#b-date').value, h = parseFloat($('#b-h').value.replace(',', '.')), w = parseFloat($('#b-w').value.replace(',', '.'));
    if (!date || !(h >= 80 && h <= 220) || !(w >= 15 && w <= 150)) return toast('请填写正确的身高（80–220）和体重（15–150）');
    state.bodies = state.bodies.filter((b) => b.date !== date);
    state.bodies.push({ date, h: Math.round(h * 10) / 10, w: Math.round(w * 10) / 10 });
    persist(); render(); toast('已记录');
  },
  'del-body': (el) => { if (confirm('删除这条记录？')) { state.bodies = state.bodies.filter((b) => b.date !== el.dataset.date); persist(); render(); } },
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
  },
  export: async () => {
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
  'reset-pin': () => {
    if (!confirm('会清除当前家长密码并退出家长页，下次进入时重新设置。确定吗？')) return;
    state.settings.pin = ''; persist(); parentUnlocked = false; pin = null; render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'rope' && draft) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
    if (digits !== e.target.value) e.target.value = digits;
    draft.answers.ropeCount = Number(digits) || 0;
    const p = $('#preview');
    if (p) p.innerHTML = star(R.stars(draft.answers, now(), draft.mode === 'makeup'), 'big');
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  try {
    const data = sanitize(JSON.parse(await e.target.files[0].text()));
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

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.();

render();
window.__xiulian = { get state() { return state; }, render };
