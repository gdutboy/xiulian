// 动画与音效：只在点击、提交等时刻触发；系统开了「减弱动态效果」就跳过动画。
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const layer = () => document.getElementById('fx');

function spawn(html, cls, style, life) {
  const el = document.createElement('span');
  el.className = cls;
  el.innerHTML = html;
  for (const [k, v] of Object.entries(style)) {
    if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v;
  }
  layer().appendChild(el);
  setTimeout(() => el.remove(), life);
  return el;
}

// 从某个元素中心向外迸出小星星
export function burst(target, { items = ['⭐', '✨', '🌟'], n = 8, dist = 70 } = {}) {
  if (reduced() || !target) return;
  const r = target.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const d = dist * (0.6 + Math.random() * 0.6);
    spawn(items[i % items.length], 'fx-burst', {
      left: `${cx}px`, top: `${cy}px`, fontSize: `${14 + Math.random() * 10}px`,
      '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d}px`,
    }, 900);
  }
}

// 满屏撒彩带和星星
export function confetti(n = 70) {
  if (reduced()) return;
  const colors = ['#cc1a33', '#f2b84d', '#2fbf86', '#4d9ef2', '#ff8fb1', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const isStar = i % 4 === 0;
    const life = 2200 + Math.random() * 1600;
    spawn(isStar ? '⭐' : '', isStar ? 'fx-fall fx-star' : 'fx-fall', {
      left: `${Math.random() * 100}vw`,
      background: isStar ? 'none' : colors[i % colors.length],
      animationDuration: `${life}ms`,
      animationDelay: `${Math.random() * 400}ms`,
      '--drift': `${(Math.random() - 0.5) * 160}px`,
      '--spin': `${(Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 720)}deg`,
    }, life + 500);
  }
}

// 数字从 0 滚到目标值
export function countUp(el, to, ms = 900) {
  if (!el) return;
  if (reduced() || to <= 0) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = '0';
  requestAnimationFrame(step);
}

// 让元素重新播放一次动画
export function replay(el, cls) {
  if (!el || reduced()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// 兑换成功：礼物盒弹开
export function giftOpen(name) {
  if (reduced()) return;
  const box = spawn('<span class="fx-giftbox">🎁</span><b>' + name.replace(/[&<>"']/g, '') + '</b>', 'fx-gift', {}, 2100);
  setTimeout(() => {
    const g = box.querySelector('.fx-giftbox');
    if (!g) return;
    g.textContent = '🎉';
    g.classList.add('open');
    burst(g, { n: 12, dist: 120, items: ['⭐', '✨', '💖', '🌟'] });
  }, 700);
}

// 夜空萤火虫（只建一次，跟页面刷新无关）
export function fireflies(n = 14) {
  const sky = document.getElementById('sky');
  if (!sky || sky.childElementCount) return;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${5 + Math.random() * 55}%`;
    s.style.animationDuration = `${6 + Math.random() * 8}s, ${2 + Math.random() * 3}s`;
    s.style.animationDelay = `${-Math.random() * 10}s, ${-Math.random() * 3}s`;
    sky.appendChild(s);
  }
}

// ---------- 音效（浏览器合成，不需要声音文件）----------
let ctx = null;
export const muted = () => localStorage.getItem('xiulian.mute') === '1';
export const setMuted = (m) => (m ? localStorage.setItem('xiulian.mute', '1') : localStorage.removeItem('xiulian.mute'));

function audio() {
  if (muted()) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq, at, dur = 0.15, type = 'sine', vol = 0.18) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(at, dur, f0, f1, vol = 0.25, q = 1.2) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t); src.stop(t + dur + 0.05);
}

export const sfx = {
  slash: () => { noise(0, 0.28, 4000, 600, 0.35, 0.8); tone(1568, 0.25, 0.25, 'triangle', 0.08); },
  thunder: () => { noise(0, 0.5, 300, 80, 0.4, 0.6); noise(0.05, 0.15, 3000, 1500, 0.2); },
  water: () => noise(0, 0.5, 900, 300, 0.25, 0.7),
  caw: () => { tone(520, 0, 0.12, 'sawtooth', 0.06); tone(470, 0.15, 0.14, 'sawtooth', 0.06); },
  bossDown: () => [196, 147, 98].forEach((f, i) => tone(f, i * 0.18, 0.4, 'square', 0.07)),
  pop: () => { tone(660, 0, 0.09, 'triangle'); tone(990, 0.05, 0.12, 'triangle'); },
  off: () => tone(330, 0, 0.08, 'triangle', 0.1),
  ding: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, 0.25)),
  levelUp: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.12, i === 6 ? 0.6 : 0.2, 'square', 0.08)),
  gift: () => [880, 1109, 1319, 1760].forEach((f, i) => tone(f, 0.7 + i * 0.07, 0.3)),
  tick: () => tone(1046, 0, 0.08, 'sine', 0.12),
  night: () => [784, 659, 523, 392].forEach((f, i) => tone(f, i * 0.25, 0.5, 'sine', 0.12)),
};
