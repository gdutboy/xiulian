// 背景音乐：默认播放程序实时合成的原创和风配乐（热血 / 安静两段），
// 家长可在家长页导入自己的歌曲（只存在这台手机的 IndexedDB 里，不上传）。
// 共用 fx.js 的 AudioContext；角色说话时自动压低；静音或页面切到后台时停止。
// 体验原则：默认音量偏低、淡入淡出不突兀；家长页不放；打完卡换安静曲准备睡觉；
// 5 分钟没人碰屏幕就淡出，再点一下接着放；自己的歌暂停后从原处继续。
import * as FX from './fx.js';

const KEY = 'xiulian.bgm';
const loadSet = () => { try { return { on: true, vol: 0.4, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return { on: true, vol: 0.4 }; } };
let set = loadSet();
const saveSet = () => { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch { /* 忽略 */ } };

let master = null;       // 总音量 GainNode
let duckGain = null;     // 说话时压低
let scene = 'main';      // 'main' | 'calm' | 'off'
let unlocked = false;
let playing = null;      // { kind: 'synth'|'custom', scene, stop() }
let customName = '';
let customUrl = '';
let customEl = null, customSrc = null;   // 自己的歌：同一个 <audio> 反复暂停/继续，保留播放位置
let idle = false, lastTouch = Date.now();
const IDLE_MS = 5 * 60e3;
export const state = { get scene() { return scene; }, get playing() { return playing ? `${playing.kind}:${playing.scene}` : ''; } };
window.__bgmState = state;

// 内置歌曲（只有自用安卓包里有，由 build-native 注入）
let builtin = window.__xiulianBuiltinBgm || null;   // 安卓自用包内置；网页版登录后从家里服务器下载（见 ensureAccountSong）
let accountUrl = '';
const mainUrl = () => customUrl || builtin?.url || accountUrl || '';
const SONG_LEVEL = 0.45;   // 成品歌曲本身很响，压到和角色语音协调的程度

export const settings = () => ({ ...set, customName, builtinName: builtin?.name || '' });

function graph() {
  const ctx = FX.audioCtx();
  if (!ctx) return null;
  if (!master || master.context !== ctx) {
    master = ctx.createGain(); duckGain = ctx.createGain();
    master.connect(duckGain).connect(ctx.destination);
  }
  master.gain.value = set.vol * 0.6;
  return ctx;
}

// ---------- 自己导入的歌曲（IndexedDB） ----------
function db() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('xiulian-bgm', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((ok, no) => {
    const tx = d.transaction('files', mode); const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => ok(req?.result); tx.onerror = () => no(tx.error);
  });
}

async function loadCustom() {
  try {
    const rec = await idb('readonly', (s) => s.get('main'));
    if (rec?.blob) { customName = rec.name; if (customUrl) URL.revokeObjectURL(customUrl); customUrl = URL.createObjectURL(rec.blob); }
    const acc = await idb('readonly', (s) => s.get('account'));
    if (acc?.blob && !builtin) { builtin = { name: acc.name }; accountUrl = URL.createObjectURL(acc.blob); }
  } catch { /* 不支持 IndexedDB 就只用原创配乐 */ }
}

/** 网页版：登录后从家里服务器取账号专属歌曲，存进本机，只下载一次。fetcher() → { blob, name } | null */
export async function ensureAccountSong(fetcher) {
  if (builtin) return;
  try {
    const got = await fetcher();
    if (!got?.blob || got.blob.size < 100000) return;
    await idb('readwrite', (s) => s.put({ name: got.name, blob: got.blob }, 'account'));
    builtin = { name: got.name }; accountUrl = URL.createObjectURL(got.blob);
    restart();
    return got.name;
  } catch { /* 离线或没有授权就继续用原创配乐 */ }
}

/** 导入一首歌：先试播能不能解码，能才保存。返回 'ok' | 'ncm' | 'big' | 'bad' */
export async function importSong(file) {
  if (/\.(ncm|qmc\w*|kgm|kwm)$/i.test(file.name)) return 'ncm';
  if (file.size > 40 * 1024 * 1024) return 'big';
  const url = URL.createObjectURL(file);
  const okToPlay = await new Promise((res) => {
    const a = new Audio(); a.preload = 'metadata';
    const t = setTimeout(() => res(false), 8000);
    a.onloadedmetadata = () => { clearTimeout(t); res(Number.isFinite(a.duration) && a.duration > 3); };
    a.onerror = () => { clearTimeout(t); res(false); };
    a.src = url;
  });
  URL.revokeObjectURL(url);
  if (!okToPlay) return 'bad';
  await idb('readwrite', (s) => s.put({ name: file.name.replace(/\.[^.]+$/, ''), blob: file }, 'main'));
  await loadCustom();
  restart();
  return 'ok';
}

export async function clearSong() {
  try { await idb('readwrite', (s) => s.delete('main')); } catch { /* 忽略 */ }
  customName = ''; if (customUrl) URL.revokeObjectURL(customUrl); customUrl = '';
  restart();
}

function fadeBus(ctx, on, secs, level = 1) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(level, ctx.currentTime + secs);
  g.connect(master);
  return g;
}
const fadeOut = (ctx, g, secs, then) => { g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setTargetAtTime(0.0001, ctx.currentTime, secs / 4); setTimeout(then, secs * 1000 + 50); };

function playCustom(ctx) {
  const url = mainUrl();
  if (!customEl || customEl.dataset.url !== url) {
    try { customEl?.pause(); customSrc?.disconnect(); } catch { /* 忽略 */ }
    customEl = new Audio(url); customEl.dataset.url = url; customEl.loop = true;
    customSrc = null;
  }
  const bus = fadeBus(ctx, true, 1.5, SONG_LEVEL);
  try { customSrc ||= ctx.createMediaElementSource(customEl); customSrc.disconnect(); customSrc.connect(bus); } catch { customEl.volume = set.vol * SONG_LEVEL; }
  customEl.play()?.catch?.(() => {});
  const el = customEl;
  return { kind: 'custom', scene: 'main', stop: () => fadeOut(ctx, bus, 0.8, () => { if (customEl === el && playing?.kind !== 'custom') el.pause(); try { bus.disconnect(); } catch { /* 忽略 */ } }) };
}

// ---------- 原创合成配乐 ----------
// 和风音阶（都节：E F A B C），热血段 132 BPM 加太鼓；安静段 70 BPM 古筝风拨弦 + 长音。
const N = (n) => 440 * 2 ** ((n - 69) / 12);
const E3 = 52, MIYAKO = [0, 1, 5, 7, 8]; // E F A B C
const deg = (d, oct = 0) => E3 + 12 * (oct + Math.floor(d / 5)) + MIYAKO[((d % 5) + 5) % 5];

const SONGS = {
  main: {
    bpm: 132,
    // 每拍一格（八分音符为 0.5 拍）：[拍位, 音级, 时值]
    lead: [
      [0, 10, 0.5], [0.5, 11, 0.5], [1, 12, 1], [2, 11, 0.5], [2.5, 10, 0.5], [3, 9, 1],
      [4, 10, 0.5], [4.5, 9, 0.5], [5, 8, 1], [6, 7, 1], [7, 8, 1],
      [8, 10, 0.5], [8.5, 11, 0.5], [9, 12, 1], [10, 13, 0.5], [10.5, 12, 0.5], [11, 11, 1],
      [12, 12, 1.5], [13.5, 11, 0.5], [14, 10, 2],
      [16, 13, 1], [17, 12, 0.5], [17.5, 13, 0.5], [18, 14, 1], [19, 13, 1],
      [20, 12, 0.5], [20.5, 11, 0.5], [21, 10, 1], [22, 11, 1], [23, 12, 1],
      [24, 13, 0.5], [24.5, 14, 0.5], [25, 15, 1], [26, 14, 0.5], [26.5, 13, 0.5], [27, 12, 1],
      [28, 11, 1], [29, 12, 1], [30, 10, 2],
      // B 段：低一点、节奏更舒展
      [32, 7, 1], [33, 8, 1], [34, 10, 2], [36, 9, 1], [37, 8, 1], [38, 7, 2],
      [40, 8, 0.5], [40.5, 9, 0.5], [41, 10, 1], [42, 11, 1], [43, 12, 1], [44, 13, 3],
      [48, 12, 1], [49, 11, 1], [50, 12, 2], [52, 10, 1], [53, 9, 1], [54, 8, 2],
      [56, 10, 0.5], [56.5, 11, 0.5], [57, 12, 0.5], [57.5, 13, 0.5], [58, 15, 2], [60, 15, 4],
    ],
    bass: [0, 0, 0, 0, 3, 3, 2, 2, 0, 0, 0, 0, 3, 3, 4, 4, 2, 2, 2, 2, 0, 0, 3, 3, 2, 2, 2, 2, 3, 3, 0, 0,
      3, 3, 3, 3, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 2, 2, 2, 2, 0, 0, 0, 0, 3, 3, 4, 4, 0, 0, 0, 0],
    len: 64,
  },
  calm: {
    bpm: 70,
    lead: [
      [0, 7, 1], [1, 8, 1], [2, 10, 2], [4, 9, 1], [5, 8, 1], [6, 7, 2],
      [8, 5, 1], [9, 7, 1], [10, 8, 1.5], [11.5, 7, 0.5], [12, 5, 4],
      [16, 7, 1], [17, 10, 1], [18, 9, 2], [20, 8, 1], [21, 7, 1], [22, 8, 2],
      [24, 7, 1], [25, 5, 1], [26, 4, 2], [28, 5, 4],
    ],
    bass: [0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0],
    len: 32,
  },
};

function note(ctx, out, t, freq, dur, type, vol, decay) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
  o.connect(g).connect(out); o.start(t); o.stop(t + (decay || dur) + 0.05);
}
function drum(ctx, out, t, kind) {
  if (kind === 'taiko') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
    return;
  }
  const len = kind === 'hat' ? 0.04 : 0.12;
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
  const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = b;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = kind === 'hat' ? 7000 : 1500;
  const g = ctx.createGain(); g.gain.setValueAtTime(kind === 'hat' ? 0.06 : 0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(f).connect(g).connect(out); s.start(t);
}

function playSynth(ctx, which) {
  const song = SONGS[which];
  const beat = 60 / song.bpm;
  const bus = fadeBus(ctx, true, 2);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = which === 'calm' ? 2400 : 4200; lp.connect(bus);
  let start = ctx.currentTime + 0.1, nextBeat = 0, loop = 0;
  const tick = () => {
    const horizon = ctx.currentTime + 0.3;
    while (start + nextBeat * beat < horizon) {
      const b = nextBeat % song.len, t = start + nextBeat * beat;
      if (which === 'main') {
        // 鼓：每拍太鼓，第 2、4 拍军鼓，八分踩镲；每 8 小节第 1 拍加重
        if (b % 2 === 0) drum(ctx, bus, t, 'taiko');
        if (b % 2 === 1) drum(ctx, bus, t, 'snare');
        drum(ctx, bus, t, 'hat'); drum(ctx, bus, t + beat / 2, 'hat');
        note(ctx, lp, t, N(deg(song.bass[b] ?? 0, -1)), beat * 0.9, 'sawtooth', 0.09);
        note(ctx, lp, t + beat / 2, N(deg(song.bass[b] ?? 0, -1)), beat * 0.4, 'sawtooth', 0.07);
      } else {
        if (b % 8 === 0) { note(ctx, lp, t, N(deg(song.bass[b] ?? 0, -1)), beat * 8, 'sine', 0.22, beat * 8); note(ctx, lp, t, N(deg((song.bass[b] ?? 0) + 2, -1)), beat * 8, 'sine', 0.12, beat * 8); }
      }
      for (const [at, d, dur] of song.lead) {
        if (at >= b && at < b + 1) {
          const tt = t + (at - b) * beat;
          const oct = which === 'calm' ? 1 : 0;
          if (which === 'main') { note(ctx, lp, tt, N(deg(d, oct)), dur * beat, 'triangle', 0.09, Math.min(dur * beat, 0.6)); note(ctx, lp, tt, N(deg(d, oct)) * 2, dur * beat, 'square', 0.02, 0.2); }
          else note(ctx, lp, tt, N(deg(d, oct)), dur * beat, 'triangle', 0.24, Math.max(1.2, dur * beat));
        }
      }
      nextBeat += 1;
      if (nextBeat % song.len === 0) loop++;
    }
  };
  tick();
  const timer = setInterval(tick, 100);
  return { kind: 'synth', scene: which, stop: () => { clearInterval(timer); fadeOut(ctx, bus, 0.8, () => { try { bus.disconnect(); } catch { /* 忽略 */ } }); } };
}

// ---------- 控制 ----------
function shouldPlay() { return unlocked && set.on && !FX.muted() && scene !== 'off' && !document.hidden && !idle; }

function restart() {
  const want = shouldPlay() ? (scene === 'main' && mainUrl() ? 'custom' : 'synth') : null;
  if (playing && (!want || playing.kind !== want || playing.scene !== scene)) { playing.stop(); playing = null; }
  if (!want || playing) return;
  const ctx = graph();
  if (!ctx) return;
  playing = want === 'custom' ? playCustom(ctx) : playSynth(ctx, scene);
}

/** 切换场景：'main'（平时/打卡）| 'calm'（睡前拉伸）| 'off'（家长查看等不放） */
export function setScene(s) { if (s !== scene) { scene = s; restart(); } }
export function refresh() { if (master) master.gain.value = set.vol * 0.6; restart(); }
export function setOn(on) { set.on = on; saveSet(); restart(); }
export const isOn = () => set.on && !FX.muted();
export function setVolume(v) { set.vol = Math.max(0, Math.min(1, v)); saveSet(); if (master) master.gain.value = set.vol * 0.6; }

/** 角色说话时压低背景音乐。 */
export function duck(on) {
  if (!duckGain) return;
  duckGain.gain.setTargetAtTime(on ? 0.25 : 1, duckGain.context.currentTime, 0.08);
}

// 第一次点击后才能出声（浏览器限制）
function onGesture() {
  lastTouch = Date.now();
  if (!unlocked || idle) { unlocked = true; idle = false; restart(); }
}
setInterval(() => { if (!idle && playing && Date.now() - lastTouch > IDLE_MS) { idle = true; restart(); } }, 30e3);
for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, onGesture, { capture: true, passive: true });
document.addEventListener('visibilitychange', restart);

loadCustom().then(restart);

/** 调试用：返回输出节点（试听录音、测试用）。 */
export const outputNode = () => duckGain;
