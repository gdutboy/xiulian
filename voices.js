// 角色语音：预先生成的 mp3（web/voice/<key>.mp3），用共享 AudioContext 播放。
// 同一时刻只播一段；静音时不播也不预加载；文件缺失或解码失败时退回系统朗读。
import * as FX from './fx.js';
import * as NV from './native.js';
import * as BGM from './bgm.js';

const raw = new Map();      // key -> Promise<ArrayBuffer>
const decoded = new Map();  // key -> AudioBuffer
let seq = 0;
let cur = null;             // { src, gain, done }
let unlocked = false;
const state = { active: 0 };
const log = [];
window.__voiceState = state;
window.__voiceLog = log;

const url = (key) => `voice/${key}.mp3`;

function fetchRaw(key) {
  if (!raw.has(key)) {
    const p = fetch(url(key)).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
    p.catch(() => raw.delete(key));
    raw.set(key, p);
  }
  return raw.get(key);
}

/** 预取 mp3 原始数据（不解码、不依赖 AudioContext）。静音时不预取。 */
export function preload(keys) {
  if (FX.muted()) return;
  for (const k of keys) fetchRaw(k).catch(() => {});
}

function stopCurrent() {
  if (cur) {
    const c = cur; cur = null;
    try { c.src.onended = null; c.src.stop(); } catch { /* 已停 */ }
    try { c.gain.disconnect(); } catch { /* 忽略 */ }
    state.active = Math.max(0, state.active - 1);
    BGM.duck(false);
    c.done(false);
  }
}

/** 停掉当前角色语音和系统朗读。 */
export function stop() {
  seq++;
  stopCurrent();
  NV.stopSpeak();
}

// 兜底：系统朗读。网页版用 onend 结束；原生没有回调，按字数估算时长。
function fallback(text, my) {
  if (!text || FX.muted()) return Promise.resolve(false);
  return new Promise((resolve) => {
    if (!NV.isNative() && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN'; u.rate = 0.95;
      u.onend = () => resolve(my === seq); u.onerror = () => resolve(false);
      speechSynthesis.speak(u);
      return;
    }
    NV.speak(text);
    setTimeout(() => resolve(my === seq), text.length * 280 + 500);
  });
}

/**
 * 播放一段角色语音。返回 Promise：正常播完 true；被打断、静音、跳过或失败 false。
 * fallbackText：mp3 不可用时用系统朗读这段文字。
 */
export async function play(key, fallbackText = '') {
  log.push(key);
  const my = ++seq;
  stopCurrent();
  NV.stopSpeak();
  if (FX.muted()) return false;
  const ctx = unlocked ? FX.audioCtx() : null;
  if (!ctx) {
    // 还没被点击解锁（定时触发的鎹鸦）：直接跳过，只显示气泡
    if (!unlocked) return false;
    return fallback(fallbackText, my);
  }
  let buf = decoded.get(key);
  try {
    if (!buf) {
      const ab = await fetchRaw(key);
      buf = await ctx.decodeAudioData(ab.slice(0));
      decoded.set(key, buf);
    }
  } catch {
    if (my !== seq) return false;
    return fallback(fallbackText, my);
  }
  if (my !== seq || FX.muted()) return false;
  NV.stopSpeak();
  return new Promise((resolve) => {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    src.connect(gain).connect(ctx.destination);
    const c = { src, gain, done: resolve };
    src.onended = () => {
      if (cur !== c) return;
      cur = null; state.active = Math.max(0, state.active - 1); BGM.duck(false);
      try { gain.disconnect(); } catch { /* 忽略 */ }
      resolve(true);
    };
    cur = c;
    state.active++;
    BGM.duck(true);
    src.start();
  });
}

// iOS 等需要在手势里解锁音频：第一次触摸时恢复 AudioContext 并播 1 帧静音（不出声，静音时也做）
function unlock() {
  const ctx = FX.audioCtx();
  if (!ctx) return;
  try {
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start();
  } catch { /* 忽略 */ }
  unlocked = true;
}
for (const ev of ['pointerdown', 'touchend', 'keydown']) {
  document.addEventListener(ev, () => {
    if (!unlocked) unlock();
    else { const c = FX.audioCtx(); if (c?.state === 'suspended') c.resume(); }
  }, { capture: true, passive: true });
}
