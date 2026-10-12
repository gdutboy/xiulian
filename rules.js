// 修炼日记 · 纯规则逻辑（与 iOS 版 Rules.swift 保持一致），可在 Node 中单测。

export const pad2 = (n) => String(n).padStart(2, '0');

export function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  return d;
}

export const minutesOfDay = (date) => date.getHours() * 60 + date.getMinutes();
export const timeText = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

// ---------- 打卡时段 ----------

export const DEFAULT_START = 18 * 60;
export const DEFAULT_END = 23 * 60 + 30;

/** 返回 {state:'notYet'|'open'|'closed', at:Date} */
export function windowState(now, start, end) {
  const base = startOfDay(now);
  const m = minutesOfDay(now);
  if (m < start) return { state: 'notYet', at: new Date(base.getTime() + start * 60000) };
  if (m < end) return { state: 'open', at: new Date(base.getTime() + end * 60000) };
  return { state: 'closed', at: null };
}

/** 结束不早于开始 + 60 分钟，且不跨午夜。 */
export function sanitizeWindow(start, end) {
  const s = Math.min(Math.max(start, 12 * 60), 22 * 60);
  const e = Math.min(Math.max(end, s + 60), 23 * 60 + 59);
  return { start: s, end: e };
}

// ---------- 星星 ----------

export const ITEMS = [
  { key: 'water', title: '喝水够 8 杯', short: '喝水', icon: '💧' },
  { key: 'noSugar', title: '今天没喝甜饮料', short: '无糖', icon: '🚫' },
  { key: 'veggies', title: '吃了两拳头蔬菜', short: '蔬菜', icon: '🥬' },
  { key: 'exercise', title: '运动满 60 分钟', short: '运动', icon: '🏃' },
  { key: 'stairs', title: '爬楼梯两次', short: '爬楼', icon: '🪜' },
];
export const ITEM_COUNT = ITEMS.length + 1; // + 跳绳
export const ALL_DONE_BONUS = 2;
export const EARLY_BED_BONUS = 1;
export const EARLY_BED_MINUTES = 21 * 60 + 30;
export const MAX_EXTRA_STARS = 3;
export const MAX_PER_DAY = ITEM_COUNT + ALL_DONE_BONUS + EARLY_BED_BONUS + MAX_EXTRA_STARS;

export function emptyAnswers() {
  return { water: false, noSugar: false, veggies: false, exercise: false, stairs: false, ropeCount: 0, mood: 2, extras: [] };
}

export function itemsDone(a) {
  return ITEMS.filter((i) => a[i.key]).length + (a.ropeCount > 0 ? 1 : 0);
}

export const extraStars = (a) => Math.min(new Set(a.extras || []).size, MAX_EXTRA_STARS);

export const isEarlyBed = (submittedAt, isMakeup) => !isMakeup && minutesOfDay(submittedAt) < EARLY_BED_MINUTES;

export function stars(a, submittedAt, isMakeup) {
  let s = itemsDone(a);
  if (s === ITEM_COUNT) s += ALL_DONE_BONUS;
  s += extraStars(a);
  if (isEarlyBed(submittedAt, isMakeup)) s += EARLY_BED_BONUS;
  return s;
}

// ---------- 阶级 ----------

export const RANKS = [
  ['癸', '新入队剑士', 0], ['壬', '初露锋芒', 10], ['辛', '呼吸入门', 25], ['庚', '坚持不懈', 45],
  ['己', '全集中', 70], ['戊', '常中修炼', 100], ['丁', '剑技精进', 140], ['丙', '斩鬼能手', 190],
  ['乙', '队中精英', 250], ['甲', '最强剑士', 320], ['柱', '柱', 400],
].map(([name, title, threshold], index) => ({ index, name, title, threshold }));

export function rankFor(earned) {
  let r = RANKS[0];
  for (const x of RANKS) if (earned >= x.threshold) r = x;
  return r;
}

export const nextRank = (r) => RANKS[r.index + 1] || null;

export function rankProgress(earned) {
  const r = rankFor(earned);
  const n = nextRank(r);
  if (!n) return 1;
  return (earned - r.threshold) / (n.threshold - r.threshold);
}

// ---------- 连续打卡 / 勋章 ----------

export function currentStreak(keys, today) {
  let d = startOfDay(today);
  if (!keys.has(dayKey(d))) d = addDays(d, -1);
  let n = 0;
  while (keys.has(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

export function longestStreak(keys) {
  const sorted = [...keys].sort();
  let best = 0, run = 0, last = null;
  for (const k of sorted) {
    const d = dateFromKey(k);
    run = last && dayKey(addDays(last, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    last = d;
  }
  return best;
}

export const BADGES = [
  { days: 3, name: '壹之型·水面斩击', icon: '💧' },
  { days: 7, name: '贰之型·水车', icon: '🌀' },
  { days: 14, name: '叁之型·流流舞', icon: '🌊' },
  { days: 30, name: '肆之型·击打潮', icon: '🌊' },
  { days: 60, name: '拾之型·生生流转', icon: '🐉' },
  { days: 100, name: '火之神神乐·圆舞', icon: '🔥' },
];

// ---------- 补卡 ----------

export const MAKEUP_DAYS_BACK = 7;

/** 周一为一周起点，返回该周周一的 dayKey。 */
export function weekKey(date) {
  const d = startOfDay(date);
  const offset = (d.getDay() + 6) % 7;
  return dayKey(addDays(d, -offset));
}

export function makeupCheck(day, loggedKeys, makeupKeys, today) {
  const d = startOfDay(day), t = startOfDay(today);
  if (d >= t) return 'notPast';
  const diff = Math.round((t - d) / 86400000);
  if (diff > MAKEUP_DAYS_BACK) return 'tooOld';
  if (loggedKeys.has(dayKey(d))) return 'alreadyLogged';
  const wk = weekKey(d);
  for (const k of makeupKeys) if (weekKey(dateFromKey(k)) === wk) return 'weeklyLimitUsed';
  return 'allowed';
}

export function makeupCandidates(loggedKeys, makeupKeys, today) {
  const out = [];
  for (let i = 1; i <= MAKEUP_DAYS_BACK; i++) {
    const d = addDays(startOfDay(today), -i);
    if (makeupCheck(d, loggedKeys, makeupKeys, today) === 'allowed') out.push(d);
  }
  return out;
}

// ---------- 其他常量 ----------

export const DEFAULT_EXERCISES = ['快走 20 分钟', '开合跳 2 组', '仰卧起坐 20 个', '踢毽子', '骑自行车', '跳舞', '打羽毛球', '游泳', '户外跑跑跳跳'];

export function normalizeList(list) {
  const seen = new Set();
  return list.map((s) => String(s).trim()).filter((s) => s && !seen.has(s) && seen.add(s));
}

export const DEFAULT_REWARDS = [['一起看一部电影', 20], ['周末去公园玩', 30], ['买一套喜欢的贴纸', 40], ['周末自己决定去哪玩', 60]];

export const MOODS = [['😢', '难过'], ['😕', '一般'], ['🙂', '还行'], ['😄', '开心'], ['🤩', '超开心']];

export const WORDS = [
  '全集中！今天也一步一步变强。', '不要放弃，前进吧，就算慢也没关系。', '每一滴汗水，都在把你锻造成更厉害的剑士。',
  '喝够水的剑士，挥刀更有力！', '早睡早起，体力满格。', '今天的你，比昨天的你更强一点点。',
  '心要像水一样，平静又有力量。', '跳绳的每一下，都是一次挥刀练习。', '认真吃蔬菜，是剑士的基本修行。', '坚持下去，你就是下一位柱！',
];

export function wordFor(date) {
  const n = Math.floor(startOfDay(date).getTime() / 86400000);
  return WORDS[((n % WORDS.length) + WORDS.length) % WORDS.length];
}

export const STRETCH = [
  ['全集中呼吸', 30, '坐好，用鼻子慢慢吸气四秒，再用嘴巴慢慢呼气。', '🌬️'],
  ['脖子绕圈', 30, '慢慢转动脖子，先顺时针，再逆时针，动作要轻。', '🙆'],
  ['肩膀画圈', 30, '两只肩膀向后画大圈，放松一整天的紧张。', '💪'],
  ['左边体侧拉伸', 30, '右手举高，身体慢慢向左边弯，感觉右边被拉长。', '🤸'],
  ['右边体侧拉伸', 30, '左手举高，身体慢慢向右边弯，保持呼吸。', '🤸'],
  ['坐姿体前屈', 40, '坐在地上双腿伸直，手慢慢去够脚尖，不要用力弹。', '🧘'],
  ['蝴蝶式', 40, '脚心相对，膝盖像蝴蝶翅膀一样轻轻上下扇动。', '🦋'],
  ['猫牛式', 40, '跪趴在地上，吸气抬头塌腰，呼气低头弓背。', '🐱'],
  ['婴儿式', 40, '跪坐后身体向前趴下，手臂向前伸，额头贴地放松。', '🌙'],
  ['仰卧抱膝', 30, '躺下，双手抱住膝盖贴近胸口，轻轻左右摇一摇。', '🛏️'],
].map(([name, seconds, tip, icon]) => ({ name, seconds, tip, icon }));

export const STRETCH_TOTAL = STRETCH.reduce((s, m) => s + m.seconds, 0);

// ---------- 身体测量（每周体重 + 腰围；身高每月）----------

export const BODY_FIELDS = { h: [80, 220], w: [15, 150], waist: [40, 150] };
export const MEASURE_STARS = 1;
export const RAID_STARS = 3;
const BONUS_STARS = { measure: 1, raid: 3 };
const DAY = 86400000;
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
export const weeksOf = (days) => Math.max(1, Math.round(days / 7));
const round1 = (v) => Math.round(v * 10) / 10;

/** 真实存在的 YYYY-MM-DD。 */
export function isRealDayKey(k) {
  return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && dayKey(dateFromKey(k)) === k;
}

/** 单个测量值：有限 number 且在范围内 → 保留 1 位小数，否则 null。 */
export function cleanBodyValue(field, v) {
  const [lo, hi] = BODY_FIELDS[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const r = round1(v);
  return r >= lo && r <= hi ? r : null;
}

const sortBodies = (bodies) => [...bodies].sort((a, b) => a.date.localeCompare(b.date));

/** 把一条测量合并进列表：填了的字段覆盖，没填的保留；返回按日期排序的新数组。 */
export function mergeBody(bodies, entry) {
  const old = bodies.find((b) => b.date === entry.date) || { date: entry.date };
  const merged = { ...old };
  for (const f of Object.keys(BODY_FIELDS)) if (entry[f] != null) merged[f] = entry[f];
  return sortBodies([...bodies.filter((b) => b.date !== entry.date), merged]);
}

/** 清洗：真实日期、不晚于今天、数值合法；同日合并；排序。 */
export function cleanBodies(raw, today) {
  if (!Array.isArray(raw)) return [];
  const todayKey = dayKey(today);
  let out = [];
  for (const b of raw) {
    if (!b || !isRealDayKey(b.date) || b.date > todayKey) continue;
    const e = { date: b.date };
    for (const f of Object.keys(BODY_FIELDS)) { const v = cleanBodyValue(f, b[f]); if (v != null) e[f] = v; }
    if (Object.keys(e).length > 1) out = mergeBody(out, e);
  }
  return out;
}

/** 清洗奖励：measure（1 星）/ raid（3 星）；week 是周一且不晚于本周；按 kind+week 去重保留第一条。 */
export function cleanBonuses(raw, today) {
  if (!Array.isArray(raw)) return [];
  const thisWeek = weekKey(today);
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    if (!x || !BONUS_STARS[x.kind] || !isRealDayKey(x.week)) continue;
    if (weekKey(dateFromKey(x.week)) !== x.week || x.week > thisWeek) continue;
    const k = `${x.kind}:${x.week}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const b = { kind: x.kind, week: x.week, stars: BONUS_STARS[x.kind], date: typeof x.date === 'string' ? x.date : '' };
    if (x.kind === 'raid') b.boss = BOSSES.includes(x.boss) ? x.boss : bossForWeek(x.week);
    out.push(b);
  }
  return out;
}

const complete = (b) => b && b.w != null && b.waist != null;

/** 保存后是否该发测量星：合并后的当天记录有体重+腰围，记录所在周 = 保存时刻所在周，且该周还没发过。 */
export function measureBonusFor(bodies, bonuses, dateKey, savedAt) {
  const rec = bodies.find((b) => b.date === dateKey);
  const wk = weekKey(dateFromKey(dateKey));
  if (!complete(rec) || wk !== weekKey(savedAt) || bonuses.some((x) => x.kind === 'measure' && x.week === wk)) return null;
  return { kind: 'measure', week: wk, stars: MEASURE_STARS, date: savedAt.toISOString() };
}

export function measuredThisWeek(bodies, today) {
  const wk = weekKey(today);
  return bodies.some((b) => complete(b) && weekKey(dateFromKey(b.date)) === wk);
}

/** 从本周（本周没量则从上周）往前数，连续有完整测量的周数。 */
export function measureWeeksStreak(bodies, today) {
  const weeks = new Set(bodies.filter(complete).map((b) => weekKey(dateFromKey(b.date))));
  let d = startOfDay(today);
  if (!weeks.has(weekKey(d))) d = addDays(d, -7);
  let n = 0;
  while (weeks.has(weekKey(d))) { n++; d = addDays(d, -7); }
  return n;
}

/** 该日期前后 31 天内相隔最近的身高（同距离取较早），没有返回 null。 */
export function heightNear(bodies, date) {
  let best = null, bestD = Infinity;
  for (const b of sortBodies(bodies)) {
    if (b.h == null) continue;
    const d = Math.abs(daysBetween(dateFromKey(b.date), dateFromKey(date)));
    if (d <= 31 && d < bestD) { best = b.h; bestD = d; }
  }
  return best;
}

/** 腰围/身高比（2 位小数）；算不出返回 null。 */
export function waistToHeight(bodies, rec) {
  if (!rec || rec.waist == null) return null;
  const h = rec.h ?? heightNear(bodies, rec.date);
  return h ? Math.round((rec.waist / h) * 100) / 100 : null;
}

export function bmiOf(bodies, rec) {
  if (!rec || rec.w == null) return null;
  const h = rec.h ?? heightNear(bodies, rec.date);
  return h ? round1(rec.w / ((h / 100) ** 2)) : null;
}

/** 给孩子看的正向鼓励；没有进步返回 null（不提任何负面信息）。 */
export function bodyProgress(bodies, today) {
  const list = sortBodies(bodies);
  const t = startOfDay(today);
  const ws = list.filter((b) => b.waist != null);
  const L = ws[ws.length - 1];
  if (L && daysBetween(dateFromKey(L.date), t) <= 21) {
    const before = ws.filter((b) => b.date < L.date).map((b) => ({ b, d: daysBetween(dateFromKey(b.date), dateFromKey(L.date)) }));
    let P = before.filter((x) => x.d >= 21 && x.d <= 42).sort((x, y) => Math.abs(x.d - 28) - Math.abs(y.d - 28) || y.d - x.d)[0];
    if (!P) P = before.filter((x) => x.d >= 14).sort((x, y) => y.d - x.d)[0];
    if (P && round1(P.b.waist - L.waist) >= 0.5) {
      return { type: 'waist', cm: round1(P.b.waist - L.waist), weeks: weeksOf(P.d), key: `${L.date}:waist` };
    }
  }
  const hs = list.filter((b) => b.h != null);
  const Hn = hs[hs.length - 1];
  if (!Hn || daysBetween(dateFromKey(Hn.date), t) > 35) return null;
  const Hr = hs.filter((b) => b.date < Hn.date)
    .map((b) => ({ b, d: daysBetween(dateFromKey(b.date), dateFromKey(Hn.date)) }))
    .filter((x) => x.d >= 28 && x.d <= 120).sort((x, y) => x.d - y.d)[0];
  if (!Hr || round1(Hn.h - Hr.b.h) < 0.5) return null;
  const waistNear = (date) => {
    let best = null, bestD = Infinity;
    for (const b of ws) { const d = Math.abs(daysBetween(dateFromKey(b.date), dateFromKey(date))); if (d <= 14 && d < bestD) { best = b.waist; bestD = d; } }
    return best;
  };
  const wn = waistNear(Hn.date), wr = waistNear(Hr.b.date);
  if (wn != null && wr != null && wn > wr) return null;
  return { type: 'height', cm: round1(Hn.h - Hr.b.h), weeks: weeksOf(Hr.d), key: `${Hn.date}:height` };
}


// ---------- 每周讨伐 ----------

export const BOSSES = ['rui', 'akaza', 'doma', 'kokushibo', 'muzan'];
export const RAID_EPOCH = '2026-10-05';
export const RAID_DEFAULT = 30;
const utcDay = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };

/** 按日历日算周数差，避免夏令时错周。 */
export function bossForWeek(wk) {
  const n = Math.round((utcDay(wk) - utcDay(RAID_EPOCH)) / 7);
  return BOSSES[((n % BOSSES.length) + BOSSES.length) % BOSSES.length];
}

/** 讨伐目标：10–80 的整数，否则 null。 */
export function cleanRaidTarget(v) {
  return Number.isInteger(v) && v >= 10 && v <= 80 ? v : null;
}

export const safeStars = (v) => (Number.isFinite(v) && v >= 0 && v <= MAX_PER_DAY ? v : 0);

export function raidState(state, today) {
  const week = weekKey(today);
  const target = cleanRaidTarget(state.settings?.raidTarget) ?? RAID_DEFAULT;
  let damage = 0;
  for (const [k, l] of Object.entries(state.logs || {})) {
    if (isRealDayKey(k) && weekKey(dateFromKey(k)) === week) damage += safeStars(l?.stars);
  }
  for (const b of state.bonuses || []) if (b.kind === 'measure' && b.week === week) damage += b.stars;
  const rewarded = (state.bonuses || []).some((b) => b.kind === 'raid' && b.week === week);
  return { week, boss: bossForWeek(week), target, damage, hp: Math.max(0, target - damage), defeated: damage >= target, rewarded };
}

/** 幂等：当前周已打空血条且还没发奖，返回要追加的 raid 奖励，否则 null。 */
export function syncRaid(state, now) {
  const r = raidState(state, now);
  if (!r.defeated || r.rewarded) return null;
  return { kind: 'raid', week: r.week, boss: r.boss, stars: RAID_STARS, date: now.toISOString() };
}

// ---------- 角色 ----------

export const ALLIES = ['tanjiro', 'nezuko', 'zenitsu', 'inosuke', 'giyu', 'rengoku', 'shinobu', 'mitsuri', 'muichiro', 'tengen', 'gyomei', 'sanemi', 'obanai'];

/** 今日值班角色：按日期轮换，同一天固定。 */
export function dutyFor(date) {
  return ALLIES[((Math.round(utcDay(dayKey(date))) % ALLIES.length) + ALLIES.length) % ALLIES.length];
}

/** 提交时要斩的小鬼：按种类去重，固定顺序。 */
export function impsFor(log, submittedAt, isMakeup) {
  const out = [];
  if (log.noSugar) out.push('imp-soda');
  if (isEarlyBed(submittedAt, isMakeup)) out.push('imp-night');
  if (log.exercise || log.stairs || log.ropeCount > 0) out.push('imp-lazy');
  if (log.water || log.veggies || (log.extras || []).length) out.push('imp-phone');
  return out;
}

/** 鎹鸦消息（按优先级），已看过的跳过；返回 {id, text} 或 null。 */
export function crowMessage({ now, start, end, logged, measured, raid }, seenIds = []) {
  const w = windowState(now, start, end).state;
  const late = minutesOfDay(now) >= EARLY_BED_MINUTES;
  const list = [];
  if (w === 'open' && !logged && late) list.push({ id: 'late', text: '嘎！快去修炼，修炼完早点睡！' });
  if (w === 'open' && !logged && !late) list.push({ id: 'open', text: '嘎！今晚修炼开放啦！' });
  if (!measured) list.push({ id: 'measure', text: '嘎！这周还没量腰围和体重！' });
  if (raid && !raid.defeated && raid.damage * 2 >= raid.target) list.push({ id: 'raid', text: '嘎！大鬼快撑不住了，继续进攻！' });
  return list.find((m) => !seenIds.includes(m.id)) || null;
}

// ---------- 角色卡图鉴 ----------
// 拿卡方式：连续修炼每满 3 天抽 1 张（主角/柱）；每周身体测量抽 1 张；讨伐成功必得该周大鬼卡。
// 抽到哪张由「事件编号」的哈希决定（两台手机算出来一样，同步不冲突）；重复卡 +1⭐；集齐全套 +10⭐。
export const CARD_EPOCH = '2026-10-12';           // 上线日：之前的历史不补发
export const CARD_HEROES = ['tanjiro', 'nezuko', 'zenitsu', 'inosuke'];
export const CARD_HASHIRA = ['giyu', 'rengoku', 'shinobu', 'mitsuri', 'muichiro', 'tengen', 'gyomei', 'sanemi', 'obanai'];
export const CARD_ALL = [...CARD_HEROES, ...CARD_HASHIRA, ...BOSSES];
export const CARD_STREAK_EVERY = 3;
export const CARD_DUP_STARS = 1;
export const CARD_SET_STARS = 10;
const CARD_KEY = /^(streak|measure|raid):\d{4}-\d{2}-\d{2}$/;

function hashStr(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

/** 抽卡结果（确定性）：主角权重 3，柱权重 2。 */
export function cardFor(key) {
  const pool = [...CARD_HEROES.map((id) => [id, 3]), ...CARD_HASHIRA.map((id) => [id, 2])];
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = hashStr(key) % total;
  for (const [id, w] of pool) { if (r < w) return id; r -= w; }
  return pool[0][0];
}

/** 校验并去重已获得的卡。 */
export function cleanCards(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), out = [];
  for (const c of raw) {
    if (!c || typeof c.key !== 'string' || !CARD_KEY.test(c.key) || seen.has(c.key)) continue;
    const kind = c.key.split(':')[0];
    const ok = kind === 'raid' ? BOSSES.includes(c.card) : c.card === cardFor(c.key);
    if (!ok) continue;
    seen.add(c.key);
    out.push({ key: c.key, card: c.card, date: typeof c.date === 'string' ? c.date : '' });
  }
  return out;
}

/** 还没发的卡（幂等）：返回 [{ key, card, kind, n? }]，按时间顺序。 */
export function cardsDue(state, now) {
  const today = dayKey(now);
  const have = new Set((state.cards || []).map((c) => c.key));
  const due = [];
  // 连续修炼：按日期顺序算每天结束时的连续天数，满 3 的倍数发一张
  const days = Object.keys(state.logs || {}).filter((k) => isRealDayKey(k) && k <= today).sort();
  let run = 0, prev = null;
  for (const k of days) {
    run = prev && dayKey(addDays(dateFromKey(prev), 1)) === k ? run + 1 : 1;
    prev = k;
    if (k >= CARD_EPOCH && run % CARD_STREAK_EVERY === 0) due.push({ key: `streak:${k}`, card: cardFor(`streak:${k}`), kind: 'streak', n: run });
  }
  const epochWeek = weekKey(dateFromKey(CARD_EPOCH));
  for (const b of state.bonuses || []) {
    if (b.week < epochWeek) continue;
    if (b.kind === 'measure') due.push({ key: `measure:${b.week}`, card: cardFor(`measure:${b.week}`), kind: 'measure' });
    if (b.kind === 'raid' && BOSSES.includes(b.boss)) due.push({ key: `raid:${b.week}`, card: b.boss, kind: 'raid' });
  }
  return due.filter((d) => !have.has(d.key));
}

/** 图鉴：每张卡拥有几张。 */
export function cardCounts(state) {
  const m = {};
  for (const c of state.cards || []) m[c.card] = (m[c.card] || 0) + 1;
  return m;
}

/** 卡片带来的星星：重复卡每张 +1，集齐全套 +10。 */
export function cardStars(state) {
  const counts = cardCounts(state);
  const dup = Object.values(counts).reduce((s, n) => s + Math.max(0, n - 1), 0) * CARD_DUP_STARS;
  const full = CARD_ALL.every((id) => counts[id]) ? CARD_SET_STARS : 0;
  return dup + full;
}

// ---------- 体质测试（国家学生体质健康标准 2014 修订，小学单项评分表） ----------
// 来源：教体艺〔2014〕5号 附件表 1-5～1-10、1-13、1-14；4 份政府/学校网站全文转载交叉核对一致。
// 每格 [优秀(90分), 良好(80分), 及格(60分)]
export const FITNESS_ITEMS = {
  rope: { name: '1分钟跳绳', unit: '次', better: 'high', step: 1,
    m: { 1: [99, 87, 17], 2: [107, 95, 25], 3: [116, 104, 34], 4: [127, 115, 45], 5: [138, 126, 56], 6: [147, 135, 65] },
    f: { 1: [103, 87, 17], 2: [113, 97, 27], 3: [125, 109, 39], 4: [135, 119, 49], 5: [144, 128, 58], 6: [152, 136, 66] } },
  sitReach: { name: '坐位体前屈', unit: '厘米', better: 'high', step: 0.1,
    m: { 1: [13.0, 11.0, 0.0], 2: [13.2, 10.6, -0.4], 3: [13.4, 10.2, -0.8], 4: [13.6, 9.8, -2.2], 5: [13.8, 9.4, -2.6], 6: [14.0, 9.0, -4.0] },
    f: { 1: [16.0, 13.4, 2.4], 2: [16.3, 13.3, 2.3], 3: [16.6, 13.2, 2.2], 4: [16.9, 13.1, 2.1], 5: [17.2, 13.0, 2.0], 6: [17.5, 12.9, 1.9] } },
  situp: { name: '1分钟仰卧起坐', unit: '次', better: 'high', step: 1, grades: [3, 4, 5, 6],
    m: { 3: [42, 36, 16], 4: [43, 37, 17], 5: [44, 38, 18], 6: [45, 39, 19] },
    f: { 3: [42, 36, 16], 4: [43, 37, 17], 5: [44, 38, 18], 6: [45, 39, 19] } },
  run50: { name: '50米跑', unit: '秒', better: 'low', step: 0.1,
    m: { 1: [10.4, 10.6, 12.6], 2: [9.8, 10.0, 12.0], 3: [9.3, 9.5, 11.5], 4: [8.9, 9.1, 11.1], 5: [8.6, 8.8, 10.8], 6: [8.4, 8.6, 10.6] },
    f: { 1: [11.2, 11.8, 13.8], 2: [10.2, 10.8, 12.8], 3: [9.4, 10.0, 12.0], 4: [8.9, 9.5, 11.5], 5: [8.5, 9.1, 11.1], 6: [8.4, 9.0, 11.0] } },
};
export const FITNESS_LEVELS = ['优秀', '良好', '及格', '不及格'];
const FIT_RANGE = { rope: [0, 400], sitReach: [-30, 40], situp: [0, 100], run50: [5, 30] };

/** 每年 9 月 1 日升一个年级：按设置时的年级推算当前年级；超出 1–6 返回 null。 */
export function gradeAt(profile, date) {
  const g = Number(profile?.grade), set = profile?.gradeSetAt;
  if (!Number.isInteger(g) || g < 1 || g > 6 || !isRealDayKey(set)) return null;
  const sy = (d) => (d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1);
  const cur = g + sy(date) - sy(dateFromKey(set));
  return cur >= 1 && cur <= 6 ? cur : null;
}

/** 该年级/性别下这个项目是否计分。 */
export const fitnessApplies = (item, grade) => !!FITNESS_ITEMS[item] && !!grade && (!FITNESS_ITEMS[item].grades || FITNESS_ITEMS[item].grades.includes(grade));

/** 评级：返回 { level: 0优秀|1良好|2及格|3不及格, next: 下一档门槛|null } */
export function fitnessLevel(item, grade, gender, value) {
  const it = FITNESS_ITEMS[item];
  const row = it?.[gender === 'f' ? 'f' : 'm']?.[grade];
  if (!row || !Number.isFinite(value)) return null;
  const ok = (t) => (it.better === 'high' ? value >= t : value <= t);
  const level = row.findIndex(ok);
  const lv = level < 0 ? 3 : level;
  return { level: lv, next: lv > 0 ? row[lv - 1] : null, row };
}

/** 校验体测记录：[{ date, item, value, grade }] */
export function cleanFitness(raw, today) {
  if (!Array.isArray(raw)) return [];
  const tk = dayKey(today), out = [];
  for (const x of raw) {
    if (!x || !FITNESS_ITEMS[x.item] || !isRealDayKey(x.date) || x.date > tk) continue;
    const v = Number(x.value), [lo, hi] = FIT_RANGE[x.item];
    if (!Number.isFinite(v) || v < lo || v > hi) continue;
    const g = Number(x.grade);
    out.push({ date: x.date, item: x.item, value: Math.round(v * 10) / 10, grade: Number.isInteger(g) && g >= 1 && g <= 6 ? g : null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
