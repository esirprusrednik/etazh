// Эффекты морского боя: взрывы, всплески, огонь, дым, тряска и вспышки.
// Экран боя перерисовывается целиком (innerHTML) каждую секунду, поэтому эффекты живут отдельно — на одном холсте
// поверх страницы, и перерисовка их не обрывает. Клетки находим по их месту на экране в момент выстрела.
// Уважает «уменьшить движение»: тогда холст не создаётся вовсе.

const still = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const R = Math.random;
const rnd = (a, b) => a + R() * (b - a);
const TAU = Math.PI * 2;
const MAX = 520;

let cv = null; let ctx = null; let raf = 0; let dpr = 1;
let parts = [];
let timers = [];
let active = false;
let lastFresh = null;
let lastWin = null;
let ambientAt = 0;
let last = 0;
// Живность: когда в следующий раз появится чайка, рыба, плавник
const due = { gull: 0, fish: 0, fin: 0, bolt: 0, cloud: 0, rare: 0 };
// Частицы, которые рождаются прямо во время кадра (дым за снарядом, брызги за дельфином): добавляются после прохода
let born = [];
const addLate = (p) => { p.t = 0; born.push(p); };
// Замедление: в момент гибели корабля время эффектов на полсекунды течёт втрое медленнее
let slowUntil = 0;
// «Кино»: чёрные полосы сверху и снизу, виньетка и лёгкий наезд на поле — на гибель корабля
let cine = null;
function cinema(ms) {
  if (!cine) { cine = document.createElement('div'); cine.className = 'cine'; cine.setAttribute('aria-hidden', 'true'); cine.innerHTML = '<i></i><i></i><b></b>'; document.body.appendChild(cine); }
  cine.classList.add('on'); document.body.classList.add('fx-kill');
  clearTimeout(cinema.t); cinema.t = setTimeout(() => { cine.classList.remove('on'); document.body.classList.remove('fx-kill'); }, ms);
}
function punch() { const b = document.body; b.classList.remove('fx-punch'); void b.offsetWidth; b.classList.add('fx-punch'); clearTimeout(punch.t); punch.t = setTimeout(() => b.classList.remove('fx-punch'), 260); }

function ensure() {
  if (cv) return;
  cv = document.createElement('canvas');
  cv.className = 'seafx';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  ctx = cv.getContext('2d');
  size();
  window.addEventListener('resize', size);
}
function size() {
  if (!cv) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(window.innerWidth * dpr);
  cv.height = Math.round(window.innerHeight * dpr);
}

// Частица живёт в координатах страницы: прокрутка её не сдвигает относительно поля
function add(p) {
  if (parts.length >= MAX) parts.splice(0, parts.length - MAX + 1);
  p.t = 0; p.x += window.scrollX; p.y += window.scrollY;
  parts.push(p);
}
const later = (ms, fn) => { timers.push(setTimeout(() => { if (active) fn(); }, ms)); };

// ---------- пластилиновые спрайты ----------
// Два атласа 4×2 (160 px на клетку), нарисованы в стиле кораблей.
// sea_life: 0 чайка, 1 чайка со взмахом, 2 дельфин, 3 плавник, 4 хвост кита, 5 щупальце, 6 черепаха, 7 облако.
// sea_fx:   0 взрыв, 1 огненный шар, 2 всплеск, 3 дым, 4 молния, 5 туча, 6 кольцо пены, 7 обломки.
const IMG = {};
function img(name) {
  if (!IMG[name]) { IMG[name] = new Image(); IMG[name].decoding = 'async'; IMG[name].src = `/art/sea_${name}.webp`; }
  return IMG[name];
}
function drawSpr(atlas, i, x, y, size, rot = 0, alpha = 1, flip = 1, sy = 1) {
  const im = img(atlas); if (!im.complete || !im.naturalWidth || alpha <= 0.01) return;
  const c = im.naturalWidth / 4;
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); if (flip < 0 || sy !== 1) ctx.scale(flip < 0 ? -1 : 1, sy); ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(im, (i % 4) * c, Math.floor(i / 4) * c, c, c, -size / 2, -size / 2, size, size);
  ctx.restore(); ctx.globalAlpha = 1;
}
const spr = (a, i, o) => add({ k: 'spr', a, i, ...o });

// ---------- что где на экране ----------
const boardEl = (pre) => document.querySelector(`.board-wrap.${pre === 'o' ? 'opp' : 'me'} .board`);
function cellAt(pre, x, y) {
  const b = boardEl(pre);
  if (!b) return null;
  const el = b.children[y * 10 + x];
  if (!el || !el.classList.contains('bc')) return null;
  const r = el.getBoundingClientRect();
  return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, s: r.width };
}
// Все клетки потопленного корабля: идём от клетки по соседям с тем же состоянием
function shipCells(pre, x, y) {
  const seen = new Set([x * 10 + y]); const out = [[x, y]]; const q = [[x, y]];
  while (q.length) {
    const [a, b] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = a + dx; const ny = b + dy; const k = nx * 10 + ny;
      if (nx < 0 || ny < 0 || nx > 9 || ny > 9 || seen.has(k)) continue;
      const c = cellAt(pre, nx, ny);
      if (c && c.el.classList.contains('sunk')) { seen.add(k); out.push([nx, ny]); q.push([nx, ny]); }
    }
  }
  return out;
}

// ---------- эффекты ----------
function splash(c) {
  const s = c.s;
  spr('fx', 6, { x: c.cx, y: c.cy, size: s * 1.7, m: 'grow', life: 0.9 });
  spr('fx', 2, { x: c.cx, y: c.cy, size: s * 1.9, m: 'pop', life: 0.55, rot: rnd(0, TAU) });
  for (let i = 0; i < 3; i++) add({ k: 'ring', x: c.cx, y: c.cy, r: s * 0.12, vr: s * (2.1 - i * 0.45), life: 0.75 + i * 0.22, w: 2.4 - i * 0.6, col: '225,240,255', delay: i * 0.09 });
  add({ k: 'glow', x: c.cx, y: c.cy, r: s * 0.9, life: 0.28, col: '200,230,255', a: 0.55 });
  for (let i = 0; i < 16; i++) {
    const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05); const v = rnd(60, 190) * (s / 30);
    add({ k: 'drop', x: c.cx + rnd(-3, 3), y: c.cy, vx: Math.cos(a) * v * 0.55, vy: Math.sin(a) * v, g: 520 * (s / 30), life: rnd(0.45, 0.8), r: rnd(1.2, 2.6) * (s / 30) });
  }
  // столб воды
  for (let i = 0; i < 5; i++) add({ k: 'drop', x: c.cx + rnd(-2, 2), y: c.cy, vx: rnd(-10, 10), vy: -rnd(180, 260) * (s / 30), g: 620 * (s / 30), life: 0.6, r: rnd(2.2, 3.4) * (s / 30), col: '255,255,255' });
}

function boom(c, power = 1) {
  const s = c.s * power;
  spr('fx', power > 1.2 ? 0 : 1, { x: c.cx, y: c.cy, size: s * (power > 1.2 ? 2.9 : 2.2), m: 'pop', life: 0.5, rot: rnd(-0.5, 0.5) });
  later(140, () => spr('fx', 3, { x: c.cx, y: c.cy - s * 0.2, vx: rnd(-8, 8), vy: -rnd(22, 36), size: s * 1.5, m: 'rise', life: 1.3, rot: rnd(0, TAU) }));
  add({ k: 'glow', x: c.cx, y: c.cy, r: s * 3.2, life: 0.22, col: '255,244,214', a: 0.95 });
  add({ k: 'ring', x: c.cx, y: c.cy, r: s * 0.2, vr: s * 4.6, life: 0.42, w: 3.2, col: '255,214,150' });
  for (let i = 0; i < 9; i++) {
    const a = rnd(0, TAU); const d = rnd(0, s * 0.35);
    add({ k: 'fire', x: c.cx + Math.cos(a) * d, y: c.cy + Math.sin(a) * d, vx: Math.cos(a) * rnd(10, 60), vy: Math.sin(a) * rnd(10, 60) - 30, r: rnd(0.45, 0.85) * s, life: rnd(0.35, 0.7), hot: R() < 0.5 });
  }
  for (let i = 0; i < Math.round(22 * power); i++) {
    const a = rnd(0, TAU); const v = rnd(120, 420) * (c.s / 30);
    add({ k: 'spark', x: c.cx, y: c.cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, g: 480, drag: 2.2, life: rnd(0.3, 0.75), w: rnd(1, 2.2) });
  }
  for (let i = 0; i < Math.round(7 * power); i++) {
    const a = rnd(-Math.PI, 0); const v = rnd(120, 300) * (c.s / 30);
    add({ k: 'chip', x: c.cx, y: c.cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 760, life: rnd(0.6, 1), r: rnd(2, 4.2) * (c.s / 30), rot: rnd(0, TAU), vrot: rnd(-12, 12) });
  }
  for (let i = 0; i < 6; i++) add({ k: 'smoke', x: c.cx + rnd(-s * 0.25, s * 0.25), y: c.cy + rnd(-s * 0.2, s * 0.2), vx: rnd(-14, 14), vy: -rnd(26, 60), r: rnd(0.35, 0.6) * s, grow: s * 0.9, life: rnd(1, 1.9), delay: rnd(0.05, 0.3) });
}

// Снаряд летит по дуге: вспышка у стрелка, тень бежит по воде, за снарядом тянется дымок.
// Свой — снизу экрана, чужой — сверху. Долетает за FLIGHT секунд — тогда и взрыв
const FLIGHT = 0.34;
function tracer(c, mine) {
  const fromY = mine ? window.innerHeight - 30 : 30;
  const fromX = c.cx + rnd(-90, 90);
  add({ k: 'glow', x: fromX, y: fromY, r: 46, life: 0.16, col: '255,230,170', a: 0.9 });
  add({ k: 'shell', x: fromX, y: fromY, x0: fromX, y0: fromY, tx: c.cx, ty: c.cy, h: Math.min(150, Math.abs(c.cy - fromY) * 0.3 + 40), s: c.s, life: FLIGHT });
}

function shake(level, quiet) {
  const b = document.body;
  b.classList.remove('fx-shake-s', 'fx-shake-l');
  void b.offsetWidth;
  b.classList.add(level === 2 ? 'fx-shake-l' : 'fx-shake-s');
  clearTimeout(shake.t);
  shake.t = setTimeout(() => b.classList.remove('fx-shake-s', 'fx-shake-l'), level === 2 ? 620 : 340);
  // quiet — тряска от живности и грома: экран вздрагивает, но телефон не вибрирует
  if (!quiet) try { if (navigator.vibrate) navigator.vibrate(level === 2 ? [30, 40, 90] : 25); } catch { /* вибрации нет — не беда */ }
}

function fireworks() {
  const W = window.innerWidth; const H = window.innerHeight;
  for (let n = 0; n < 6; n++) later(n * 260, () => {
    const x = rnd(W * 0.15, W * 0.85); const y = rnd(H * 0.15, H * 0.5);
    const hue = Math.floor(rnd(0, 360));
    add({ k: 'glow', x, y, r: 90, life: 0.25, col: '255,255,255', a: 0.6 });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * TAU + rnd(-0.06, 0.06); const v = rnd(90, 250);
      add({ k: 'star', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 150, drag: 1.5, life: rnd(0.8, 1.4), hue: hue + rnd(-20, 20), w: rnd(1.6, 2.8) });
    }
  });
}

function impact(pre, x, y) {
  const c = cellAt(pre, x, y);
  if (!c) return;
  const cls = c.el.classList;
  if (cls.contains('auto')) return;   // клетки вокруг потопленного корабля закрываются сами — без выстрела
  const mine = pre === 'o';
  // Мини-карта (клетка меньше 16 px): полный взрыв закрыл бы её целиком — только вспышка, кольцо и лёгкая тряска
  if (c.s < 16) {
    const hit = !cls.contains('miss');
    add({ k: 'glow', x: c.cx, y: c.cy, r: c.s * (hit ? 2.2 : 1.4), life: 0.25, col: hit ? '255,214,150' : '220,240,255', a: 0.8 });
    add({ k: 'ring', x: c.cx, y: c.cy, r: c.s * 0.2, vr: c.s * 5, life: 0.4, w: 1.6, col: hit ? '255,214,150' : '220,240,255' });
    if (hit) shake(cls.contains('sunk') ? 2 : 1);
    return;
  }
  tracer(c, mine);
  later(FLIGHT * 1000, () => {
    const c2 = cellAt(pre, x, y) || c;
    if (cls.contains('miss')) { splash(c2); return; }
    if (cls.contains('sunk')) {
      const cells = shipCells(pre, x, y);
      boom(c2, 1.35); shake(2);
      add({ k: 'veil', x: 0, y: 0, life: 0.3, col: '255,236,200', a: 0.34 });
      slowUntil = performance.now() + 620; cinema(1500);
      for (let i = 0; i < 3; i++) add({ k: 'ring', x: c2.cx, y: c2.cy, r: c2.s * 0.4, vr: c2.s * (5.5 - i * 1.2), life: 0.9 + i * 0.25, w: 3 - i * 0.7, col: '255,240,220', delay: i * 0.1 });
      cells.forEach(([a, b], i) => later(90 + i * 110, () => { const cc = cellAt(pre, a, b); if (cc) { boom(cc, 1.05); if (i % 2 === 0) shake(1); } }));
      // На месте потопленного корабля несколько секунд плавают обломки
      later(700, () => { const cc = cellAt(pre, x, y); if (cc) spr('fx', 7, { x: cc.cx, y: cc.cy, vx: rnd(-3, 3), vy: rnd(-2, 2), size: cc.s * 1.5, m: 'float', al: 0.95, life: 5.5 }); });
      return;
    }
    boom(c2, 1); shake(1); punch();
  });
}

// Постоянный огонь и дым на подбитых палубах, блики на воде
function ambient() {
  const hits = document.querySelectorAll('.board .bc.hit, .board .bc.sunk');
  let n = 0;
  for (const el of hits) {
    if (++n > 28) break;
    const r = el.getBoundingClientRect();
    if (r.bottom < -40 || r.top > window.innerHeight + 40) continue;
    const s = r.width; const cx = r.left + s / 2; const cy = r.top + s / 2;
    const sunk = el.classList.contains('sunk');
    if (!sunk || R() < 0.45) add({ k: 'fire', x: cx + rnd(-s * 0.16, s * 0.16), y: cy + rnd(-s * 0.05, s * 0.12), vx: rnd(-6, 6), vy: -rnd(18, 42), r: rnd(0.2, 0.36) * s, life: rnd(0.35, 0.6), hot: R() < 0.4 });
    if (R() < (sunk ? 0.5 : 0.28)) add({ k: 'smoke', x: cx + rnd(-s * 0.15, s * 0.15), y: cy - s * 0.1, vx: rnd(-8, 10), vy: -rnd(16, 34), r: rnd(0.16, 0.26) * s, grow: s * 0.75, life: rnd(1.1, 2), soft: true });
    if (R() < 0.1) add({ k: 'spark', x: cx, y: cy, vx: rnd(-40, 40), vy: -rnd(60, 130), g: 200, drag: 1, life: rnd(0.4, 0.8), w: 1.2 });
  }
  scene();
  for (const b of document.querySelectorAll('.board')) {
    if (R() > 0.35) continue;
    const r = b.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    add({ k: 'glint', x: rnd(r.left + 8, r.right - 8), y: rnd(r.top + 8, r.bottom - 8), life: rnd(0.5, 0.9), r: rnd(0.8, 1.6) * Math.min(1, r.width / 300) });
  }
}

// ---------- погода и живность ----------
// Только украшение: на игру не влияет и о кораблях ничего не говорит — места случайные. Живёт на большом поле;
// на мини-карте и на экране итога ничего не рисуем. Погоду задаёт экран боя (data-wx у .b-stage)
function scene() {
  const stage = document.querySelector('.b-stage.play, .b-stage.setup');
  const board = stage && stage.querySelector('.b-sea > .board-wrap .board');
  if (!board) return;
  const r = board.getBoundingClientRect(); if (r.width < 120) return;
  const s = r.width / 10, k = s / 30, wx = stage.dataset.wx || 'clear', now = performance.now();
  const wet = wx === 'rain' || wx === 'storm';
  if (wet) {
    const n = wx === 'storm' ? 5 : 3;
    for (let i = 0; i < n; i++) add({ k: 'rain', x: rnd(r.left + 6, r.right + 10), y: rnd(r.top - 6, r.bottom - 46 * k), vx: -70 * k, vy: rnd(420, 520) * k, life: rnd(0.16, 0.3), len: rnd(9, 15) * k });
    if (R() < 0.5) add({ k: 'ring', x: rnd(r.left + 8, r.right - 8), y: rnd(r.top + 8, r.bottom - 8), r: 1, vr: s * 0.9, life: 0.5, w: 1, col: '200,225,255' });
  } else if (wx === 'snow') {
    for (let i = 0; i < 2; i++) add({ k: 'snow', x: rnd(r.left, r.right), y: rnd(r.top - 4, r.bottom - 60 * k), vx: rnd(-10, 10), vy: rnd(18, 36) * k, life: rnd(1.6, 2.8), r: rnd(1, 2.4) * k, ph: rnd(0, TAU) });
  }
  // Облака плывут над полем и бросают тень; в дождь и шторм — тучи. В шторм из тучи бьёт молния
  if (now > due.cloud) {
    if (due.cloud && wx !== 'fog') {
      const ltr = R() < 0.5, sp = rnd(9, 15) * k, size = s * rnd(2.6, 3.6), dark = wet || wx === 'snow';
      spr(dark ? 'fx' : 'life', dark ? 5 : 7, { x: ltr ? r.left - size * 0.2 : r.right + size * 0.2, y: rnd(r.top + s * 1.5, r.bottom - s * 1.5), vx: ltr ? sp : -sp, vy: 0, size, m: 'cloud', al: dark ? 0.5 : 0.4, life: (r.width + size * 0.4) / sp });
    }
    due.cloud = now + (wet ? rnd(5000, 9000) : rnd(12000, 22000));
  }
  if (wx === 'storm' && now > due.bolt) {
    if (due.bolt) {
      const bx = rnd(r.left + s * 2, r.right - s * 2), by = rnd(r.top + s * 2, r.bottom - s * 3);
      spr('fx', 4, { x: bx, y: by, size: s * 3.4, m: 'flash', life: 0.5, rot: rnd(-0.25, 0.25) });
      add({ k: 'veil', x: 0, y: 0, life: 0.12, col: '235,240,255', a: 0.42 });
      later(170, () => { add({ k: 'veil', x: 0, y: 0, life: 0.34, col: '225,235,255', a: 0.24 }); shake(1, true); });
      add({ k: 'glow', x: bx, y: by, r: s * 5, life: 0.5, col: '255,240,170', a: 0.7 });
    }
    due.bolt = now + rnd(7000, 15000);
  }
  // Чайка: закладывает дугу над полем — снижается к воде и уходит вверх. Чем выше, тем дальше от неё тень
  if (now > due.gull) {
    if (due.gull) {
      const ltr = R() < 0.5, y0 = rnd(r.top + s, r.bottom - s * 2), y1 = rnd(r.top + s, r.bottom - s * 2);
      const x0 = ltr ? r.left - s * 1.5 : r.right + s * 1.5, x1 = ltr ? r.right + s * 1.5 : r.left - s * 1.5;
      add({ k: 'gull', x: x0, y: y0, x0, y0, x1, y1, cx: (x0 + x1) / 2 + rnd(-s, s), cy: (y0 + y1) / 2 + rnd(-s * 3.5, s * 3.5), size: s * 1.55, life: rnd(3.4, 4.6), ph: rnd(0, 9) });
    }
    due.gull = now + rnd(11000, 24000);
  }
  // Свободная клетка — для тех, кто выныривает: не там, куда стреляли, и не под своим кораблём
  const freeCell = () => {
    const free = [...board.children].filter((el) => el.classList.contains('bc') && !/\b(miss|hit|sunk|under|lastshot)\b/.test(el.className));
    const el = free[Math.floor(R() * free.length)]; if (!el) return null;
    const c = el.getBoundingClientRect(); return { cx: c.left + c.width / 2, cy: c.top + c.height / 2 };
  };
  const bubbles = (c, n, spread) => { for (let i = 0; i < n; i++) later(i * 110, () => add({ k: 'ring', x: c.cx + rnd(-spread, spread), y: c.cy + rnd(-spread, spread), r: 1, vr: s * rnd(0.5, 0.9), life: 0.55, w: 1.1, col: '220,240,255' })); };
  // Дельфин: сначала вода «закипает», потом прыжок дугой с брызгами — вытягивается на взлёте, сжимается в верхней точке
  if (now > due.fish) {
    if (due.fish) {
      const c = freeCell();
      if (c) {
        const dir = c.cx < r.left + r.width / 2 ? 1 : -1;
        bubbles(c, 4, s * 0.25);
        later(420, () => {
          spr('fx', 2, { x: c.cx, y: c.cy, size: s * 1.3, m: 'pop', life: 0.45 });
          spr('life', 2, { x: c.cx, y: c.cy, vx: dir * s * 1.6, vy: -s * 5, g: s * 10.4, size: s * 1.8, m: 'leap', dir, life: 0.97, trail: true });
          for (let i = 0; i < 12; i++) add({ k: 'drop', x: c.cx + rnd(-4, 4), y: c.cy, vx: dir * rnd(10, 90) * k, vy: -rnd(120, 300) * k, g: 620 * k, life: rnd(0.5, 0.9), r: rnd(1.2, 2.6) * k, col: '225,242,255' });
        });
        later(420 + 930, () => {
          const ex = c.cx + dir * s * 1.55;
          spr('fx', 2, { x: ex, y: c.cy, size: s * 1.7, m: 'pop', life: 0.55 }); spr('fx', 6, { x: ex, y: c.cy, size: s * 2, m: 'grow', life: 1.1 });
          for (let i = 0; i < 2; i++) add({ k: 'ring', x: ex, y: c.cy, r: s * 0.2, vr: s * (2.6 - i), life: 0.9 + i * 0.3, w: 2 - i * 0.6, col: '225,240,255', delay: i * 0.12 });
        });
      }
    }
    due.fish = now + rnd(7000, 14000);
  }
  // Плавник: режет воду вверх по полю, оставляя расходящийся след, и уходит на глубину
  if (now > due.fin) {
    if (due.fin) spr('life', 3, { x: rnd(r.left + s * 1.5, r.right - s * 1.5), y: rnd(r.top + s * 4.5, r.bottom - s), vx: 0, vy: -s * 0.62, size: s * 1.5, m: 'glide', life: 4.8, wake: 0 });
    due.fin = now + rnd(22000, 45000);
  }
  // Редкие гости: кит бьёт хвостом, спрут высовывает щупальце, черепаха плывёт по своим делам
  if (now > due.rare) {
    if (due.rare) {
      const pick = R();
      if (pick < 0.7) {
        const c = freeCell(), whale = pick < 0.4;
        if (c) {
          bubbles(c, 7, s * 0.5);
          later(800, () => {
            spr('fx', 6, { x: c.cx, y: c.cy + s * 0.3, size: s * 2.4, m: 'grow', life: 1.4 });
            spr('life', whale ? 4 : 5, { x: c.cx, y: c.cy, size: s * (whale ? 2.3 : 1.9), m: 'surface', wag: whale ? 0.1 : 0.22, ws: whale ? 2.6 : 4.5, slap: whale, life: whale ? 3.6 : 4 });
            for (let i = 0; i < 10; i++) add({ k: 'drop', x: c.cx + rnd(-s * 0.5, s * 0.5), y: c.cy, vx: rnd(-50, 50) * k, vy: -rnd(90, 220) * k, g: 520 * k, life: rnd(0.5, 0.9), r: rnd(1.2, 2.4) * k, col: '225,242,255' });
          });
          // Уход под воду: кит напоследок шлёпает хвостом — всплеск, круги, экран чуть вздрагивает
          later(800 + (whale ? 2700 : 3100), () => {
            spr('fx', 2, { x: c.cx, y: c.cy + s * 0.2, size: s * (whale ? 2.6 : 1.8), m: 'pop', life: 0.6 });
            for (let i = 0; i < 3; i++) add({ k: 'ring', x: c.cx, y: c.cy + s * 0.2, r: s * 0.3, vr: s * (3.4 - i * 0.8), life: 1 + i * 0.3, w: 2.4 - i * 0.6, col: '225,240,255', delay: i * 0.12 });
            if (whale) { shake(1, true); for (let i = 0; i < 16; i++) add({ k: 'drop', x: c.cx, y: c.cy, vx: rnd(-140, 140) * k, vy: -rnd(120, 320) * k, g: 640 * k, life: rnd(0.5, 1), r: rnd(1.4, 3) * k, col: '235,246,255' }); }
          });
        }
      } else { const ltr = R() < 0.5, vx = (ltr ? 1 : -1) * s * 0.42, vy = rnd(-0.12, 0.12) * s; spr('life', 6, { x: rnd(r.left + s * 2, r.right - s * 2), y: rnd(r.top + s * 2, r.bottom - s * 2), vx, vy, size: s * 1.15, m: 'swim', rot: Math.atan2(vy, vx) + Math.PI / 2, life: 9, wake: 0 }); }
    }
    due.rare = now + rnd(26000, 55000);
  }
}

// ---------- кадр ----------
function frame(now) {
  raf = 0;
  if (!active && !parts.length) { if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); return; }
  let dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  if (now < slowUntil) dt *= 0.32;
  if (active && now - ambientAt > 95) { ambientAt = now; ambient(); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const sx = window.scrollX; const sy = window.scrollY;
  const keep = [];
  for (const p of parts) {
    if (p.delay > 0) { p.delay -= dt; keep.push(p); continue; }
    p.t += dt;
    if (p.t >= p.life) continue;
    keep.push(p);
    const u = p.t / p.life; const x = p.x - sx; const y = p.y - sy;
    if (p.vx !== undefined) {
      if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
      if (p.g) p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    switch (p.k) {
      case 'fire': {
        const r = p.r * (1 - u * 0.75);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const a = (1 - u) * 0.9;
        g.addColorStop(0, `rgba(255,${p.hot ? 246 : 214},${p.hot ? 190 : 110},${a})`);
        g.addColorStop(0.45, `rgba(255,${130 - u * 60},24,${a * 0.75})`);
        g.addColorStop(1, 'rgba(200,30,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'smoke': {
        const r = p.r + p.grow * u;
        const a = (p.soft ? 0.26 : 0.42) * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85);
        const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
        g.addColorStop(0, `rgba(40,40,48,${a})`); g.addColorStop(1, 'rgba(40,40,48,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        break;
      }
      case 'spark': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,${220 - u * 90},${120 - u * 100},${1 - u})`;
        ctx.lineWidth = p.w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.035, y - p.vy * 0.035); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'star': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `hsla(${p.hue},95%,${70 - u * 20}%,${1 - u * u})`;
        ctx.lineWidth = p.w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.05, y - p.vy * 0.05); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'chip':
        p.rot += p.vrot * dt;
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
        ctx.fillStyle = `rgba(42,30,24,${1 - u * u})`; ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
        ctx.restore();
        break;
      case 'drop':
        ctx.fillStyle = `rgba(${p.col || '214,236,255'},${(1 - u) * 0.95})`;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, TAU); ctx.fill();
        break;
      case 'ring':
        ctx.strokeStyle = `rgba(${p.col},${(1 - u) * 0.9})`;
        ctx.lineWidth = p.w * (1 - u * 0.6);
        ctx.beginPath(); ctx.ellipse(x, y, p.r + p.vr * u * p.life, (p.r + p.vr * u * p.life) * 0.86, 0, 0, TAU); ctx.stroke();
        break;
      case 'glow': {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x, y, 0, x, y, p.r);
        g.addColorStop(0, `rgba(${p.col},${p.a * (1 - u)})`); g.addColorStop(1, `rgba(${p.col},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, p.r, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'veil':
        ctx.fillStyle = `rgba(${p.col},${p.a * (1 - u)})`;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        break;
      case 'trace': {
        const tx = p.tx - sx + window.scrollX; const ty = p.ty - sy + window.scrollY;
        const hx = x + (tx - x) * u; const hy = y + (ty - y) * u;
        const bx = x + (tx - x) * Math.max(0, u - 0.35); const by = y + (ty - y) * Math.max(0, u - 0.35);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(bx, by, hx, hy);
        g.addColorStop(0, 'rgba(255,200,90,0)'); g.addColorStop(1, 'rgba(255,246,214,.95)');
        ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'rain':
        ctx.strokeStyle = `rgba(210,230,255,${0.5 * (1 - u * 0.5)})`; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.len * 0.16, y - p.len); ctx.stroke();
        break;
      case 'snow': {
        const a = Math.sin(Math.min(1, u * 4) * Math.PI / 2) * (1 - u * u) * 0.9;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(x + Math.sin(p.t * 2.2 + p.ph) * 5, y, p.r, 0, TAU); ctx.fill();
        break;
      }
      case 'spr': {
        const edge = Math.min(1, u * 7, (1 - u) * 7);
        switch (p.m) {
          case 'pop': { const sc = u < 0.3 ? 0.35 + (u / 0.3) * 0.9 : 1.25 - (u - 0.3) * 0.25; drawSpr(p.a, p.i, x, y, p.size * sc, p.rot || 0, u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45); break; }
          case 'rise': drawSpr(p.a, p.i, x, y, p.size * (0.55 + u * 0.75), (p.rot || 0) + u * 0.5, 0.8 * (1 - u) * Math.min(1, u * 8)); break;
          case 'grow': drawSpr(p.a, p.i, x, y, p.size * (0.35 + u * 0.95), 0, 0.85 * (1 - u)); break;
          case 'float': drawSpr(p.a, p.i, x, y + Math.sin(p.t * 2) * 1.5, p.size, Math.sin(p.t * 1.4) * 0.09, (p.al || 1) * Math.min(1, u * 8, (1 - u) * 3)); break;
          case 'cloud': {
            ctx.fillStyle = `rgba(0,14,40,${0.16 * edge})`; ctx.beginPath(); ctx.ellipse(x + p.size * 0.12, y + p.size * 0.3, p.size * 0.42, p.size * 0.2, 0, 0, TAU); ctx.fill();
            drawSpr(p.a, p.i, x, y, p.size, 0, (p.al || 0.6) * edge); break;
          }
          case 'fly': {
            ctx.fillStyle = `rgba(0,14,40,${0.2 * edge})`; ctx.beginPath(); ctx.ellipse(x + p.size * 0.22, y + p.size * 0.34, p.size * 0.3, p.size * 0.1, 0, 0, TAU); ctx.fill();
            drawSpr(p.a, Math.floor(p.t * 5 + p.ph) % 2, x, y, p.size * (1 + Math.sin(p.t * 5) * 0.04), p.rot, edge); break;
          }
          case 'leap': {
            // вытянут на взлёте и в падении, собран в верхней точке; за хвостом — капли
            const sp = Math.min(1, Math.hypot(p.vx, p.vy) / (p.size * 2.6)), st = 1 + sp * 0.16;
            ctx.fillStyle = `rgba(0,14,40,${0.16 * Math.sin(u * Math.PI)})`; ctx.beginPath(); ctx.ellipse(p.x - sx, (p.gy === undefined ? (p.gy = p.y - sy) : p.gy) + p.size * 0.1, p.size * 0.3, p.size * 0.09, 0, 0, TAU); ctx.fill();
            drawSpr(p.a, p.i, x, y, p.size * st, (-0.8 + u * 2) * p.dir, Math.min(1, u * 10, (1 - u) * 7), p.dir, 1 / st);
            if (R() < 0.55) addLate({ k: 'drop', x: p.x - p.dir * p.size * 0.3 + rnd(-4, 4), y: p.y + rnd(-4, 6), vx: -p.dir * rnd(5, 40), vy: rnd(-20, 40), g: 420, life: rnd(0.3, 0.55), r: rnd(1, 2.2), col: '225,242,255' });
            break;
          }
          case 'glide': {
            drawSpr(p.a, p.i, x + Math.sin(p.t * 1.7) * p.size * 0.06, y, p.size * (0.7 + 0.3 * Math.sin(u * Math.PI)), Math.sin(p.t * 1.7) * 0.08, Math.sin(u * Math.PI) * 1.4);
            if (p.t > p.wake && u > 0.1 && u < 0.85) { p.wake = p.t + 0.32; addLate({ k: 'ring', x: p.x, y: p.y + p.size * 0.25, r: p.size * 0.1, vr: p.size * 0.9, life: 1.1, w: 1.3, col: '225,240,255' }); }
            break;
          }
          case 'surface': {
            // выныривает с перелётом (чуть выше, чем нужно, и оседает), держится, перед уходом кит заносит хвост для удара
            const up = u < 0.22 ? u / 0.22 : u > 0.76 ? (1 - u) / 0.24 : 1;
            const e = u < 0.22 ? 1 + 2.2 * Math.pow(up - 1, 3) + 1.2 * Math.pow(up - 1, 2) : up * up * (3 - 2 * up);
            const wind = p.slap && u > 0.6 && u < 0.76 ? -Math.sin((u - 0.6) / 0.16 * Math.PI) * 0.35 : 0;
            ctx.fillStyle = `rgba(0,14,40,${0.18 * Math.min(1, e)})`; ctx.beginPath(); ctx.ellipse(x + p.size * 0.1, y + p.size * 0.36, p.size * 0.34, p.size * 0.1, 0, 0, TAU); ctx.fill();
            drawSpr(p.a, p.i, x, y + (1 - e) * p.size * 0.22, p.size * (0.4 + 0.6 * e), Math.sin(p.t * p.ws) * p.wag * Math.min(1, e) + wind, Math.min(1, e * 1.3));
            break;
          }
          case 'swim': {
            drawSpr(p.a, p.i, x, y, p.size * (1 + Math.sin(p.t * 3.2) * 0.03), p.rot + Math.sin(p.t * 3.2) * 0.14, Math.min(1, u * 5, (1 - u) * 5) * 0.92);
            if (p.t > p.wake) { p.wake = p.t + 0.9; addLate({ k: 'ring', x: p.x, y: p.y, r: p.size * 0.2, vr: p.size * 0.7, life: 1.4, w: 1, col: '225,240,255' }); }
            break;
          }
          case 'flash': drawSpr(p.a, p.i, x, y, p.size, p.rot || 0, u < 0.18 || (u > 0.3 && u < 0.5) ? 1 : 0.35 * (1 - u)); break;
          default: drawSpr(p.a, p.i, x, y, p.size, p.rot || 0, edge);
        }
        break;
      }
      case 'gull': {
        // дуга: точка на квадратичной кривой; высота над водой — синус: в середине пути чайка ниже всего и крупнее всего
        const e = u * u * (3 - 2 * u), q = 1 - e;
        const gx = q * q * p.x0 + 2 * q * e * p.cx + e * e * p.x1 - sx, gy = q * q * p.y0 + 2 * q * e * p.cy + e * e * p.y1 - sy;
        const tx = 2 * q * (p.cx - p.x0) + 2 * e * (p.x1 - p.cx), ty = 2 * q * (p.cy - p.y0) + 2 * e * (p.y1 - p.cy);
        const low = Math.sin(e * Math.PI), a = Math.min(1, u * 9, (1 - u) * 9), size = p.size * (0.85 + 0.4 * low), hgt = p.size * (0.75 - 0.5 * low);
        ctx.fillStyle = `rgba(0,14,40,${(0.1 + 0.16 * low) * a})`; ctx.beginPath(); ctx.ellipse(gx + hgt * 0.5, gy + hgt, size * (0.3 - 0.06 * low), size * 0.1, 0, 0, TAU); ctx.fill();
        // взмахи сериями: несколько быстрых — и парит; кадры перетекают друг в друга, а не щёлкают
        const beat = (p.t * 0.55 + p.ph) % 1 < 0.6 ? Math.sin(p.t * 13) : 0.9, mix = 0.5 + 0.5 * beat, rot = Math.atan2(ty, tx) + Math.PI / 2;
        drawSpr('life', 0, gx, gy, size, rot, a * mix, 1, 1); drawSpr('life', 1, gx, gy, size, rot, a * (1 - mix), 1, 1);
        break;
      }
      case 'shell': {
        // по земле — прямая, над землёй — парабола; снаряд крупнее в верхней точке, тень под ним бежит по воде
        const gx = p.x0 + (p.tx - p.x0) * u - sx, gy = p.y0 + (p.ty - p.y0) * u - sy, z = Math.sin(u * Math.PI), py = gy - p.h * z;
        ctx.fillStyle = `rgba(0,14,40,${0.28 * (1 - z * 0.5)})`; ctx.beginPath(); ctx.ellipse(gx, gy, 5 + z * 3, 2.4 + z, 0, 0, TAU); ctx.fill();
        const r2 = (2.6 + z * 2.6) * Math.max(1, p.s / 30), ang = Math.atan2((p.ty - p.y0) - p.h * Math.cos(u * Math.PI) * Math.PI, p.tx - p.x0);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(gx, py, 0, gx, py, r2 * 4); g.addColorStop(0, 'rgba(255,236,170,.75)'); g.addColorStop(1, 'rgba(255,170,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, py, r2 * 4, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(gx, py); ctx.rotate(ang); ctx.fillStyle = '#2A2F3E'; ctx.beginPath(); ctx.ellipse(0, 0, r2 * 1.7, r2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#FFE9A8'; ctx.beginPath(); ctx.ellipse(r2 * 0.9, 0, r2 * 0.6, r2 * 0.55, 0, 0, TAU); ctx.fill(); ctx.restore();
        addLate({ k: 'smoke', x: gx + sx, y: py + sy, vx: rnd(-6, 6), vy: rnd(-6, 6), r: r2 * 0.9, grow: r2 * 2.4, life: rnd(0.3, 0.5), soft: true });
        break;
      }
      case 'glint': {
        const a = Math.sin(u * Math.PI) * 0.55; const r = p.r * (0.6 + Math.sin(u * Math.PI) * 0.8);
        ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 1; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - r * 2, y); ctx.lineTo(x + r * 2, y); ctx.moveTo(x, y - r * 2); ctx.lineTo(x, y + r * 2); ctx.stroke();
        break;
      }
      default:
    }
  }
  parts = born.length ? keep.concat(born) : keep; born = [];
  if (active || parts.length) raf = requestAnimationFrame(frame);
}
const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

// Вызывается после каждой перерисовки экрана. on — открыт ли бой; fresh — набор новых выстрелов ('o:3,4' — по чужому полю,
// 'm:…' — по моему) и срок, до которого они «свежие»; win — id партии, которую я только что выиграл
export function seaFxSync({ on, fresh, freshUntil, win }) {
  if (still()) return;
  if (!on) {
    if (active) { active = false; timers.forEach(clearTimeout); timers = []; parts = parts.filter((p) => p.k !== 'glint'); lastFresh = null; }
    return;
  }
  ensure();
  if (!active) { img('life'); img('fx'); }
  active = true;
  if (fresh && fresh !== lastFresh && Date.now() < freshUntil) {
    lastFresh = fresh;
    for (const key of fresh) {
      const m = /^([om]):(\d),(\d)$/.exec(key);
      if (m) impact(m[1], Number(m[2]), Number(m[3]));
    }
  }
  if (win && win !== lastWin) { lastWin = win; later(700, fireworks); }
  kick();
}
