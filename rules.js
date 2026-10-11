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
