// 本地存储：所有数据只保存在这台设备的浏览器里。
import { DEFAULT_START, DEFAULT_END, DEFAULT_EXERCISES, DEFAULT_REWARDS, normalizeList } from './rules.js';

const KEY = 'xiulian.v1';

function fresh() {
  return {
    version: 1,
    profile: { name: '' },
    settings: { start: DEFAULT_START, end: DEFAULT_END, pin: '', exercises: [...DEFAULT_EXERCISES] },
    logs: {},          // dayKey -> log
    rewards: DEFAULT_REWARDS.map(([name, cost], i) => ({ id: `r${Date.now()}${i}`, name, cost })),
    redemptions: [],   // {name, cost, date}
    bodies: [],        // {date: dayKey, h, w}
  };
}

/** 校验并补齐数据结构（用于读取旧数据和导入备份）。 */
export function sanitize(raw) {
  const base = fresh();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.profile = { ...base.profile, ...(raw.profile || {}) };
  s.settings = { ...base.settings, ...(raw.settings || {}) };
  s.settings.exercises = normalizeList(Array.isArray(s.settings.exercises) ? s.settings.exercises : base.settings.exercises);
  s.logs = raw.logs && typeof raw.logs === 'object' ? raw.logs : {};
  s.rewards = Array.isArray(raw.rewards) ? raw.rewards : base.rewards;
  s.redemptions = Array.isArray(raw.redemptions) ? raw.redemptions : [];
  s.bodies = Array.isArray(raw.bodies) ? raw.bodies : [];
  return s;
}

export function load(storage = globalThis.localStorage) {
  try {
    return sanitize(JSON.parse(storage.getItem(KEY)));
  } catch {
    return fresh();
  }
}

export function save(state, storage = globalThis.localStorage) {
  storage.setItem(KEY, JSON.stringify(state));
}

export function ledger(state) {
  const earned = Object.values(state.logs).reduce((s, l) => s + (l.stars || 0), 0);
  const spent = state.redemptions.reduce((s, r) => s + (r.cost || 0), 0);
  return { earned, spent, available: Math.max(0, earned - spent) };
}

export const STORAGE_KEY = KEY;
