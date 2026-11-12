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

// Снаряд: короткий яркий след от стрелка к клетке
function tracer(c, mine) {
  const fromY = mine ? window.innerHeight + 20 : -20;
  const fromX = c.cx + rnd(-60, 60);
  add({ k: 'trace', x: fromX, y: fromY, tx: c.cx, ty: c.cy, life: 0.13 });
}

function shake(level) {
  const b = document.body;
  b.classList.remove('fx-shake-s', 'fx-shake-l');
  void b.offsetWidth;
  b.classList.add(level === 2 ? 'fx-shake-l' : 'fx-shake-s');
  clearTimeout(shake.t);
  shake.t = setTimeout(() => b.classList.remove('fx-shake-s', 'fx-shake-l'), level === 2 ? 620 : 340);
  try { if (navigator.vibrate) navigator.vibrate(level === 2 ? [30, 40, 90] : 25); } catch { /* вибрации нет — не беда */ }
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
  tracer(c, mine);
  later(120, () => {
    const c2 = cellAt(pre, x, y) || c;
    if (cls.contains('miss')) { splash(c2); return; }
    if (cls.contains('sunk')) {
      const cells = shipCells(pre, x, y);
      boom(c2, 1.35); shake(2);
      add({ k: 'veil', x: 0, y: 0, life: 0.3, col: '255,236,200', a: 0.34 });
      cells.forEach(([a, b], i) => later(90 + i * 110, () => { const cc = cellAt(pre, a, b); if (cc) { boom(cc, 1.05); if (i % 2 === 0) shake(1); } }));
      return;
    }
    boom(c2, 1); shake(1);
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
  for (const b of document.querySelectorAll('.board')) {
    if (R() > 0.35) continue;
    const r = b.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    add({ k: 'glint', x: rnd(r.left + 8, r.right - 8), y: rnd(r.top + 8, r.bottom - 8), life: rnd(0.5, 0.9), r: rnd(0.8, 1.6) * Math.min(1, r.width / 300) });
  }
}

// ---------- кадр ----------
function frame(now) {
  raf = 0;
  if (!active && !parts.length) { if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); return; }
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
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
      case 'glint': {
        const a = Math.sin(u * Math.PI) * 0.55; const r = p.r * (0.6 + Math.sin(u * Math.PI) * 0.8);
        ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 1; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - r * 2, y); ctx.lineTo(x + r * 2, y); ctx.moveTo(x, y - r * 2); ctx.lineTo(x, y + r * 2); ctx.stroke();
        break;
      }
      default:
    }
  }
  parts = keep;
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
