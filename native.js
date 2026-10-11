// 原生外壳（安卓 / 鸿蒙）桥接。网页版里没有 window.XiulianNative，全部走浏览器原有能力。
// 每次调用都现查桥对象，不在启动时缓存，避免注入时序问题。
const bridge = () => window.XiulianNative;

export const isNative = () => !!bridge();

export function has(cap) {
  const n = bridge();
  if (!n || typeof n.caps !== 'function') return false;
  try { return JSON.parse(n.caps()).includes(cap); } catch { return false; }
}

// 需要等用户操作的方法：原生受理后，在结果出来时调用 window.__xiulianNativeCb(cbId, result)
const pending = new Map();
let seq = 0;
window.__xiulianNativeCb = (id, result) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  p.resolve(String(result));
};

function call(method, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const id = `cb${Date.now()}_${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); resolve('timeout'); }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      bridge()[method](JSON.stringify(args), id);
    } catch {
      clearTimeout(timer); pending.delete(id); resolve('error');
    }
  });
}

/** 朗读；返回 false 表示原生没有中文语音。 */
export function speak(text) {
  if (has('speak')) {
    try { return bridge().speak(text) !== false; } catch { return false; }
  }
  if (!('speechSynthesis' in window)) return true;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeak() {
  if (has('speak')) { try { bridge().stopSpeak(); } catch { /* 忽略 */ } }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

let wakeLock = null;
export async function keepAwake(on) {
  if (has('keepAwake')) { try { bridge().keepAwake(!!on); } catch { /* 忽略 */ } return; }
  try {
    if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* 不支持就算了 */ }
}

/** 每晚提醒（分钟数，-1 = 关闭）。只存在原生侧。 */
export function getReminder() {
  if (!has('reminder')) return -1;
  try { const v = Number(bridge().getReminder()); return v >= 0 && v < 1440 ? v : -1; } catch { return -1; }
}
export const setReminder = (minutes) => call('setReminder', { minutes });

/** 原生导出备份：'ok' | 'cancel' | 'error' | 'timeout' */
export const exportBackup = (name, json) => call('exportBackup', { name, json });

export function setCanGoBack(v) {
  const n = bridge();
  if (n && typeof n.setCanGoBack === 'function') { try { n.setCanGoBack(!!v); } catch { /* 忽略 */ } }
}
