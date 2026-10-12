// 鬼灭角色：清单、台词、切入特效、斩鬼过场、鎹鸦气泡。图片在 chars/ 下，缺图时用剪影。
import * as FX from './fx.js';

const P = (idle, more = {}) => ({ idle, ...more });
export const CHARS = {
  tanjiro: { name: '炭治郎', group: 'hero', color: '#1f8561', poses: P('tanjiro-idle', { action: 'tanjiro-slash', cheer: 'tanjiro-cheer' }) },
  nezuko: { name: '祢豆子', group: 'hero', color: '#e98fb0', poses: P('nezuko-idle', { cheer: 'nezuko-cheer', sleep: 'nezuko-sleep' }) },
  zenitsu: { name: '善逸', group: 'hero', color: '#f2c94c', poses: P('zenitsu-idle', { action: 'zenitsu-thunder' }) },
  inosuke: { name: '伊之助', group: 'hero', color: '#8aa1b1', poses: P('inosuke-idle', { action: 'inosuke-charge' }) },
  giyu: { name: '富冈义勇', group: 'hashira', color: '#2f6fb3', poses: P('giyu') },
  rengoku: { name: '炼狱杏寿郎', group: 'hashira', color: '#f2741f', poses: P('rengoku') },
  shinobu: { name: '蝴蝶忍', group: 'hashira', color: '#9b6bd3', poses: P('shinobu') },
  mitsuri: { name: '甘露寺蜜璃', group: 'hashira', color: '#f28cb8', poses: P('mitsuri') },
  muichiro: { name: '时透无一郎', group: 'hashira', color: '#6fc7c2', poses: P('muichiro') },
  tengen: { name: '宇髄天元', group: 'hashira', color: '#c9a2e8', poses: P('tengen') },
  gyomei: { name: '悲鸣屿行冥', group: 'hashira', color: '#8f8a5c', poses: P('gyomei') },
  sanemi: { name: '不死川实弥', group: 'hashira', color: '#6fbf73', poses: P('sanemi') },
  obanai: { name: '伊黑小芭内', group: 'hashira', color: '#7b7f99', poses: P('obanai') },
  crow: { name: '鎹鸦', group: 'crow', color: '#333', poses: P('crow') },
  rui: { name: '累', group: 'boss', color: '#e8e8f0', poses: P('oni-rui') },
  akaza: { name: '猗窝座', group: 'boss', color: '#e86a9a', poses: P('oni-akaza') },
  doma: { name: '童磨', group: 'boss', color: '#d9c38f', poses: P('oni-doma') },
  kokushibo: { name: '黑死牟', group: 'boss', color: '#7a3b6b', poses: P('oni-kokushibo') },
  muzan: { name: '鬼舞辻无惨', group: 'boss', color: '#b3263e', poses: P('oni-muzan') },
  'imp-soda': { name: '甜饮料鬼', group: 'imp', color: '#9b59d0', poses: P('imp-soda') },
  'imp-night': { name: '熬夜鬼', group: 'imp', color: '#2c3e7a', poses: P('imp-night') },
  'imp-lazy': { name: '赖床鬼', group: 'imp', color: '#7fa37a', poses: P('imp-lazy') },
  'imp-phone': { name: '手机鬼', group: 'imp', color: '#e0412f', poses: P('imp-phone') },
};

/** 所有清单里引用的文件名（构建自检用）。 */
export const ALL_FILES = [...new Set(Object.values(CHARS).flatMap((c) => Object.values(c.poses)))].map((f) => `chars/${f}.webp`);

export function charSrc(id, pose = 'idle') {
  const p = CHARS[id]?.poses || {};
  const f = p[pose] || p.idle;
  return f ? `chars/${f}.webp` : null;
}

/** 角色图 HTML；没有图或加载失败时显示剪影。 */
export function charHTML(id, pose = 'idle', cls = '') {
  const c = CHARS[id];
  const src = charSrc(id, pose);
  const sil = `<span class="sil" style="--c:${c?.color || '#888'}"><i></i><b>${c?.name || ''}</b></span>`;
  if (!src) return `<span class="char ${cls}">${sil}</span>`;
  return `<span class="char ${cls}"><img src="${src}" alt="${c.name}" decoding="async" draggable="false" onerror="this.parentNode.classList.add('noimg')">${sil}</span>`;
}

export function preload(ids) {
  for (const [id, pose] of ids) { const s = charSrc(id, pose); if (s) { const i = new Image(); i.src = s; } }
}

// ---------- 打卡项 → 角色与呼吸法 ----------
export const BREATH = {
  water: { char: 'tanjiro', pose: 'action', title: '水之呼吸 · 壹之型', fx: 'water' },
  noSugar: { char: 'shinobu', title: '虫之呼吸 · 蝶之舞', fx: 'butterfly' },
  veggies: { char: 'mitsuri', title: '恋之呼吸', fx: 'love' },
  exercise: { char: 'inosuke', pose: 'action', title: '兽之呼吸', fx: 'beast' },
  stairs: { char: 'zenitsu', pose: 'action', title: '雷之呼吸 · 霹雳一闪', fx: 'thunder' },
  rope: { char: 'sanemi', title: '风之呼吸', fx: 'wind' },
  extra: { char: 'tengen', title: '音之呼吸 · 华丽登场', fx: 'sound' },
};
export const PRELOAD_CHECKIN = [['tanjiro', 'action'], ['shinobu'], ['mitsuri'], ['inosuke', 'action'], ['zenitsu', 'action'], ['sanemi'], ['tengen'], ['nezuko', 'cheer']];

// 阶级 → 授阶的柱
export const RANK_PRESENTER = { 壬: 'giyu', 辛: 'shinobu', 庚: 'mitsuri', 己: 'muichiro', 戊: 'tengen', 丁: 'obanai', 丙: 'sanemi', 乙: 'gyomei', 甲: 'rengoku', 柱: 'tanjiro' };

// 台词（原创短句）
export const LINES = {
  tanjiro: ['今天也要全集中！', '一起加油吧！', '我闻到了努力的味道！'],
  nezuko: ['唔嗯！', '嗯嗯～', '唔！唔！'],
  zenitsu: ['好可怕……但我会加油的！', '雷之呼吸，壹之型！', '喝水很重要的！'],
  inosuke: ['猪突猛进！', '来跟本大爷比赛跳绳！', '本大爷最强！'],
  giyu: ['……多喝水。', '不要放弃。', '保持冷静，继续修炼。'],
  rengoku: ['心中燃起火焰吧！', '蔬菜真好吃！', '唔姆！很好！'],
  shinobu: ['今天没喝甜饮料吗？真乖呢～', '要好好吃饭哦。', '啊啦啊啦～'],
  mitsuri: ['蔬菜好好吃！', '加油加油～', '心都跳起来啦！'],
  muichiro: ['……早点睡吧。', '雾散了就是晴天。', '今天也很棒。'],
  tengen: ['华丽地完成吧！', '这才叫华丽！', '动起来吧！'],
  gyomei: ['南无阿弥陀佛……好孩子。', '坚持就是力量。', '要互相帮助。'],
  sanemi: ['跳绳！再来一组！', '别偷懒！', '哼，还不错。'],
  obanai: ['不准挑食。', '按时睡觉。', '……做得不坏。'],
};
export const lineFor = (id) => pickLine(id)[1];
/** 随机一句台词，返回 [序号, 文本]，序号用来对应角色语音 line-<id>-<序号>。 */
export const pickLine = (id) => { const l = LINES[id] || ['加油！']; const i = Math.floor(Math.random() * l.length); return [i, l[i]]; };

// ---------- 特效 ----------
const layer = () => document.getElementById('fx');
const el = (html, cls) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; layer().appendChild(d); return d; };
const lowEnd = () => (navigator.hardwareConcurrency || 8) <= 4;

function breathFX(kind) {
  if (FX.reduced()) return;
  const n = lowEnd() ? 6 : 12;
  const center = { getBoundingClientRect: () => ({ left: innerWidth / 2 - 10, top: innerHeight * 0.45, width: 20, height: 20 }) };
  const sets = {
    water: ['💧', '🌊', '💦'], butterfly: ['🦋', '✨'], love: ['💗', '🌸', '💕'], beast: ['💥', '⚡'],
    thunder: ['⚡', '✨'], wind: ['🍃', '🌀'], sound: ['🎆', '💥', '✨'], fire: ['🔥', '✨'],
  };
  FX.burst(center, { items: sets[kind] || ['✨'], n, dist: 140 });
  const art = {
    water: '<svg viewBox="0 0 400 200"><path d="M10 150 Q 120 20 220 110 T 390 60" /></svg>',
    thunder: '<svg viewBox="0 0 400 200"><polyline points="230,0 170,90 230,90 150,200" /></svg>',
    beast: '<svg viewBox="0 0 400 200"><path d="M60 40 L340 160 M60 80 L340 200 M60 0 L340 120"/></svg>',
    fire: '<svg viewBox="0 0 400 200"><path d="M10 170 Q 200 -40 390 170" /></svg>',
  }[kind];
  if (art) { const a = el(art, `bfx bfx-${kind}`); setTimeout(() => a.remove(), 1000); }
  if (kind === 'thunder') { const f = el('', 'flash'); setTimeout(() => f.remove(), 400); }
}

let lastCut = null;
/** 角色侧边切入 + 呼吸法特效 + 毛笔字横幅。同一时刻只保留最新一个。 */
export function cutIn(charId, pose, title, fxKind, side = 'left') {
  if (!layer()) return;
  lastCut?.remove();
  const d = el(`${charHTML(charId, pose, 'ci-img')}<div class="ci-title">${title}</div>`, `ci ci-${side}`);
  lastCut = d;
  setTimeout(() => { d.remove(); if (lastCut === d) lastCut = null; }, 1300);
  breathFX(fxKind);
}

/** 提交后的斩鬼过场；可点一下跳过。结束后调用 done。 */
export function slashScene(imps, done) {
  if (FX.reduced() || !layer() || !imps.length) { done(); return; }
  let finished = false;
  const d = el(`<div class="ss-imps">${imps.map((id) => charHTML(id, 'idle', 'ss-imp')).join('')}</div>
    <div class="ss-hero">${charHTML('tanjiro', 'action')}</div>
    <svg class="ss-arc" viewBox="0 0 400 300"><path d="M-20 260 Q 200 -40 420 120"/></svg>
    <div class="ss-title">全集中 · 斩！</div><button class="ss-skip">跳过 ›</button>`, 'ss');
  const end = () => { if (finished) return; finished = true; d.remove(); done(); };
  d.querySelector('.ss-skip').addEventListener('click', (e) => { e.stopPropagation(); end(); });
  d.addEventListener('click', end);
  FX.sfx.slash?.();
  setTimeout(() => {
    d.querySelectorAll('.ss-imp').forEach((x) => { x.classList.add('cut'); FX.burst(x, { items: ['✨', '⭐'], n: 6, dist: 70 }); });
  }, 650);
  setTimeout(end, 1500);
}

/** 鎹鸦飞入气泡，点一下收起。 */
export function crowBubble(text, onClose) {
  if (!layer()) return;
  document.querySelector('.crow')?.remove();
  const d = document.createElement('div');
  d.className = 'crow';
  d.innerHTML = `${charHTML('crow', 'idle', 'crow-img')}<div class="crow-say">${text}</div>`;
  const bye = () => { if (!d.isConnected) return; d.classList.add('bye'); setTimeout(() => d.remove(), 300); onClose?.(); };
  d.addEventListener('click', bye);
  setTimeout(bye, 8000);
  document.body.appendChild(d);
  FX.sfx.caw?.();
  return d;
}
