// Корабли «Морского боя»: вид сверху с лёгким наклоном камеры (псевдо-3D).
// Каждая клетка — 100 единиц. Корабль рисуется в своих координатах: u — от носа к корме, v — поперёк.
// Высоту надстроек показываем сдвигом вверх по экрану: снизу видна боковая стенка — так свет и тени
// одинаковые и у горизонтальных, и у вертикальных кораблей.
// Огонь и дым всегда тянутся вверх по экрану, поэтому рисуются в экранных координатах поверх корабля.

const C = {
  side: '#26344B', sideLo: '#1A2436', water: '#A63A2C',
  deck: '#9DACC2', deckLo: '#7B8AA3', plank: '#B9895A', plankLo: '#93683F',
  sup: '#D9E1EC', supSide: '#8995AA', supTop2: '#EEF2F7',
  tur: '#65748F', turSide: '#3B4860', gun: '#2E394D', glass: '#3C5A86',
  fun: '#4A5770', funSide: '#323C50', mts: '#E30611', boat: '#F28A2E', boatSide: '#B45E17', line: 'rgba(255,255,255,.55)'
};

const f1 = (n) => Math.round(n * 10) / 10;

// Отображение из координат корабля в экранные
function mapper(vertical) {
  const P = (u, v) => (vertical ? [v, u] : [u, v]);
  const pt = (u, v) => P(u, v).map(f1).join(' ');
  const rect = (u, v, lu, lv, fill, extra = '') => {
    const [x, y] = P(u, v), [w, h] = vertical ? [lv, lu] : [lu, lv];
    return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${fill}" ${extra}/>`;
  };
  // Поднятый блок: боковая стенка + крыша, сдвинутая вверх на hgt
  const block = (u, v, lu, lv, hgt, top, side, rx = 3, win = false) => {
    const [x, y] = P(u, v), [w, h] = vertical ? [lv, lu] : [lu, lv];
    let o = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="${rx}" fill="${side}"/>`;
    // Иллюминаторы на видимой стенке (полоса высотой hgt под крышей)
    if (win && hgt >= 6) { const n = Math.max(2, Math.floor(w / 6)); for (let i = 0; i < n; i++) o += `<rect x="${f1(x + 2 + i * (w - 4) / n)}" y="${f1(y + h - hgt * 0.62)}" width="${f1((w - 4) / n * 0.55)}" height="${f1(Math.min(3.2, hgt * 0.3))}" rx=".6" fill="#1D2B42" opacity=".85"/>`; }
    o += `<rect x="${f1(x)}" y="${f1(y - hgt)}" width="${f1(w)}" height="${f1(h)}" rx="${rx}" fill="${top}"/>
      <rect x="${f1(x + 1)}" y="${f1(y - hgt + 1)}" width="${f1(Math.max(0, w - 2))}" height="1.4" rx=".7" fill="${C.line}"/>
      <rect x="${f1(x)}" y="${f1(y - hgt + h - 1.2)}" width="${f1(w)}" height="1.2" fill="rgba(0,0,0,.18)"/>`;
    return o;
  };
  const circle = (u, v, r, fill, dy = 0, extra = '') => { const [x, y] = P(u, v); return `<circle cx="${f1(x)}" cy="${f1(y + dy)}" r="${f1(r)}" fill="${fill}" ${extra}/>`; };
  const ellipse = (u, v, ru, rv, fill, dy = 0, extra = '') => { const [x, y] = P(u, v); const [rx, ry] = vertical ? [rv, ru] : [ru, rv]; return `<ellipse cx="${f1(x)}" cy="${f1(y + dy)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="${fill}" ${extra}/>`; };
  const line = (u1, v1, u2, v2, stroke, w, dy = 0, extra = '') => { const [a, b] = P(u1, v1), [c, d] = P(u2, v2); return `<line x1="${f1(a)}" y1="${f1(b + dy)}" x2="${f1(c)}" y2="${f1(d + dy)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`; };
  return { P, pt, rect, block, circle, ellipse, line };
}

// Корпус: острый нос, скруглённая корма. hw — полуширина
function hullPath(m, L, hw, dy = 0) {
  const W = L * 100, c = 50, a = c - hw, b = c + hw;
  const bowLen = Math.min(78, W * 0.5);
  const p = (u, v) => { const [x, y] = m.P(u, v); return `${f1(x)} ${f1(y + dy)}`; };
  return `M ${p(5, c)} C ${p(bowLen * 0.35, a + hw * 0.25)}, ${p(bowLen * 0.7, a)}, ${p(bowLen, a)}
    L ${p(W - 12, a)} Q ${p(W - 4, a)} ${p(W - 4, a + 9)} L ${p(W - 4, b - 9)} Q ${p(W - 4, b)} ${p(W - 12, b)}
    L ${p(bowLen, b)} C ${p(bowLen * 0.7, b)}, ${p(bowLen * 0.35, b - hw * 0.25)}, ${p(5, c)} Z`;
}

// Башня орудия: погон, башня, стволы к носу (dir = -1) или к корме (dir = 1)
function turret(m, u, r, n, dir, len) {
  let s = m.circle(u, 50, r + 2, C.turSide, 3.5) + m.circle(u, 50, r + 1, '#2B364A', 1) + m.circle(u, 50, r, 'url(#sg-tur)');
  const gap = n === 1 ? [0] : n === 2 ? [-3.2, 3.2] : [-5, 0, 5];
  for (const g of gap) {
    s += m.line(u + dir * (r * 0.6), 50 + g, u + dir * (r + len), 50 + g, '#141C2A', 3.4, 0.6) + m.line(u + dir * (r * 0.6), 50 + g, u + dir * (r + len), 50 + g, C.gun, 2.4, -1);
    s += m.line(u + dir * (r + len - 1), 50 + g, u + dir * (r + len), 50 + g, '#111A28', 3.4, -1);
  }
  s += m.circle(u - dir * r * 0.25, 50 - r * 0.35, r * 0.28, 'rgba(255,255,255,.25)');
  return s;
}

function funnel(m, u, ru, rv, h) {
  return m.ellipse(u, 50, ru, rv, C.funSide) +
    m.ellipse(u, 50, ru, rv, C.fun, -h) + m.ellipse(u, 50, ru * 0.92, rv * 0.92, 'none', -h + 0.4, `stroke="${C.mts}" stroke-width="2.2"`) +
    m.ellipse(u, 50, ru * 0.55, rv * 0.55, '#0B0F17', -h);
}

const lifeboat = (m, u, v, lu = 16) => m.block(u, v, lu, 6, 2.5, C.boat, C.boatSide, 3);
const railing = (m, u1, u2, v) => m.line(u1, v, u2, v, 'rgba(255,255,255,.35)', 0.9, 0, 'stroke-dasharray="2 2.5"');

// Палубы по типам кораблей
function details(L, m) {
  if (L === 1) { // Катер: деревянная палуба, рубка, носовой пулемёт, флажок
    let s = '';
    s += turret(m, 26, 5, 1, -1, 10);
    s += m.block(48, 38, 22, 24, 8, C.sup, C.supSide, 3, true);
    s += m.rect(48, 38, 4, 24, C.glass, `transform="translate(0,-8)" opacity=".9"`);
    s += m.line(88, 50, 88, 50, '#1C2433', 2.4, -10) + m.line(88, 46, 96, 42, C.mts, 3, -6);
    return s;
  }
  if (L === 2) { // Эсминец: носовая башня, мостик, труба, торпедные аппараты, кормовое орудие
    let s = railing(m, 40, 190, 26) + railing(m, 40, 190, 74);
    s += turret(m, 38, 8, 2, -1, 14);
    s += m.block(60, 36, 26, 28, 10, C.sup, C.supSide, 3, true);
    s += m.rect(60, 37, 5, 26, C.glass, `transform="translate(0,-10)"`);
    s += m.line(80, 44, 80, 56, '#2A3446', 1.6, -16) + m.circle(80, 50, 2.2, '#2A3446', -16);
    s += funnel(m, 106, 9, 7, 9);
    s += m.block(128, 33, 24, 6, 3, '#55637C', '#343F53', 3) + m.block(128, 61, 24, 6, 3, '#55637C', '#343F53', 3);
    s += lifeboat(m, 98, 30, 14) + lifeboat(m, 98, 64, 14);
    s += turret(m, 170, 7, 1, 1, 14);
    return s;
  }
  if (L === 3) { // Крейсер: две носовые башни, ступенчатая надстройка, две трубы, радар, кормовая башня
    let s = railing(m, 46, 290, 23) + railing(m, 46, 290, 77);
    s += turret(m, 44, 9, 2, -1, 16) + turret(m, 72, 9.5, 2, -1, 16);
    s += m.block(94, 34, 52, 32, 10, C.sup, C.supSide, 3, true);
    s += m.block(100, 38, 26, 24, 19, C.supTop2, C.supSide, 3, true);
    s += m.rect(100, 39, 5, 22, C.glass, `transform="translate(0,-19)"`);
    s += `<g class="radar">${m.line(116, 42, 116, 58, '#1E2A3D', 2.4, -27)}</g>` + m.circle(116, 50, 2, '#1E2A3D', -27);
    s += funnel(m, 160, 10, 8, 11) + funnel(m, 186, 9, 7, 10);
    s += lifeboat(m, 152, 27, 16) + lifeboat(m, 152, 67, 16) + lifeboat(m, 178, 27, 14) + lifeboat(m, 178, 67, 14);
    s += m.circle(212, 34, 3.5, C.turSide, 2) + m.circle(212, 34, 3, C.tur) + m.circle(212, 66, 3.5, C.turSide, 2) + m.circle(212, 66, 3, C.tur);
    s += turret(m, 252, 9.5, 2, 1, 16);
    return s;
  }
  // Линкор: две носовые башни главного калибра, высокая надстройка, большая труба, ПВО, кормовая башня, вертолётная площадка
  let s = railing(m, 50, 392, 20) + railing(m, 50, 392, 80);
  s += turret(m, 52, 11, 3, -1, 20) + turret(m, 86, 12, 3, -1, 20);
  s += m.block(112, 31, 84, 38, 10, C.sup, C.supSide, 3, true);
  s += m.block(120, 35, 46, 30, 19, C.supTop2, C.supSide, 3, true);
  s += m.block(126, 39, 20, 22, 28, '#F4F6FA', C.supSide, 3, true);
  s += m.rect(126, 40, 5, 20, C.glass, `transform="translate(0,-28)"`);
  s += `<g class="radar">${m.line(152, 41, 152, 59, '#1E2A3D', 2.6, -36)}</g>` + m.circle(152, 50, 2.3, '#1E2A3D', -36);
  s += funnel(m, 182, 13, 10, 14);
  for (const u of [208, 228]) for (const v of [30, 70]) s += m.circle(u, v, 4.2, C.turSide, 2) + m.circle(u, v, 3.6, C.tur) + m.line(u, v, u + 7, v, C.gun, 1.4, -1);
  s += lifeboat(m, 120, 24, 18) + lifeboat(m, 120, 70, 18) + lifeboat(m, 170, 24, 14) + lifeboat(m, 170, 70, 14);
  s += turret(m, 270, 12, 3, 1, 20) + turret(m, 306, 11, 2, 1, 18);
  s += m.circle(362, 50, 16, 'none', 0, 'stroke="#E9EDF3" stroke-width="1.6"');
  const [hx, hy] = m.P(362, 50);
  s += `<text x="${f1(hx)}" y="${f1(hy + 6)}" text-anchor="middle" font-size="17" font-weight="800" fill="#E9EDF3" font-family="sans-serif">H</text>`;
  return s;
}

const HW = { 1: 21, 2: 27, 3: 30, 4: 33 };
let clipN = 0;

// Огонь: три языка разного цвета, качаются в своём ритме
function flame(x, y, s, k) {
  const d = (k * 0.17) % 0.6;
  const path = 'M0 0 C-13 -3 -15 -19 -8 -30 C-6 -22 -2 -21 -2 -26 C-2 -37 4 -41 7 -48 C8 -37 16 -30 14 -16 C13 -6 8 0 0 0 Z';
  return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s})">
    <ellipse cx="0" cy="-4" rx="20" ry="9" fill="#FF7A1A" opacity=".35" class="fl-glow" style="animation-delay:-${d}s"/>
    <path d="${path}" fill="#E8401C" class="fl fl1" style="animation-delay:-${d}s"/>
    <path d="${path}" fill="#FF9A1F" transform="scale(.72)" class="fl fl2" style="animation-delay:-${d + 0.13}s"/>
    <path d="${path}" fill="#FFE27A" transform="scale(.42)" class="fl fl3" style="animation-delay:-${d + 0.27}s"/>
  </g>`;
}
function smoke(x, y, s, k) {
  let o = '';
  for (let i = 0; i < 3; i++) o += `<circle cx="${f1(x + (i - 1) * 4)}" cy="${f1(y - 30 * s)}" r="${f1(9 * s)}" class="smk" style="animation-delay:-${f1((k * 0.7 + i * 0.85) % 2.6)}s"/>`;
  for (let i = 0; i < 2; i++) o += `<circle cx="${f1(x + (i ? 6 : -5))}" cy="${f1(y - 20 * s)}" r="1.6" class="emb" style="animation-delay:-${f1((k * 0.5 + i * 0.9) % 1.8)}s"/>`;
  return o;
}

// Корабль. state: 'ok' — целый, 'ghost' — показан после партии, 'sunk' — потоплен и горит.
// hits — номера палуб (0 — нос), в которые попали, для целого корабля на своём поле
export function shipSvg(L, vertical, state = 'ok', hits = []) {
  const m = mapper(vertical);
  const W = L * 100, hw = HW[L];
  const [vw, vh] = vertical ? [100, W] : [W, 100];
  const sunk = state === 'sunk';
  const teak = L !== 2;
  const deckFill = teak ? `url(#sg-teak-${vertical ? 'v' : 'h'})` : `url(#sg-deck-${vertical ? 'v' : 'h'})`;
  const cid = `shc${++clipN}`;
  let art = '';
  // Тень на воде и пена у носа
  art += `<path d="${hullPath(m, L, hw + 3, 9)}" fill="rgba(0,0,0,.28)"/>`;
  if (!sunk) art += `<path d="${hullPath(m, L, hw + 5, 2)}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.4" stroke-dasharray="6 5"/>`;
  else art += m.ellipse(W / 2, 50, W / 2 - 8, hw + 12, 'rgba(10,12,16,.35)', 6);
  // Борт с ватерлинией и палуба
  art += `<path d="${hullPath(m, L, hw, 9)}" fill="${C.water}"/>`;
  art += `<path d="${hullPath(m, L, hw, 6.5)}" fill="${C.side}"/>`;
  art += `<path d="${hullPath(m, L, hw)}" fill="${deckFill}"/>`;
  art += `<clipPath id="${cid}"><path d="${hullPath(m, L, hw - 1)}"/></clipPath>`;
  if (teak) { let pl = ''; for (let v = 50 - hw + 4; v < 50 + hw - 2; v += 4.5) pl += m.line(0, v, W, v, C.plankLo, 0.5); for (let u = 30; u < W; u += 37) for (let v = 50 - hw + 4, k = 0; v < 50 + hw - 2; v += 4.5, k++) pl += m.line(u + (k % 3) * 12, v - 2.2, u + (k % 3) * 12, v + 2.2, 'rgba(70,45,20,.35)', 0.5); art += `<g clip-path="url(#${cid})">${pl}</g>`; }
  art += `<path d="${hullPath(m, L, hw - 2.5)}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1"/>`;
  if (L > 1) for (let u = 120; u < W - 20; u += 100) art += m.line(u, 50 - hw + 3, u, 50 + hw - 3, 'rgba(30,40,60,.25)', 0.8);
  art += details(L, m);
  // Якорь у носа
  art += m.circle(20, 50 - hw * 0.45, 1.8, '#1C2433') + m.circle(20, 50 + hw * 0.45, 1.8, '#1C2433');
  let fx = '';
  if (sunk) {
    // Пробоины и копоть по всей длине, огонь на каждой палубе
    for (let i = 0; i < L; i++) {
      const u = i * 100 + 50 + (i % 2 ? 8 : -6);
      art += m.ellipse(u, 50 + (i % 2 ? 6 : -5), 17, 13, 'rgba(15,10,8,.75)') + m.ellipse(u + 3, 50, 7, 5, '#0A0605');
    }
    for (let i = 0; i < L; i++) {
      const [x, y] = m.P(i * 100 + 50 + (i % 2 ? 8 : -6), 50);
      fx += smoke(x, y, 1, i) + flame(x, y + 4, L === 1 ? 0.75 : 0.95, i);
    }
  } else if (hits.length) {
    for (const i of hits) {
      const u = i * 100 + 50;
      art += m.ellipse(u, 50, 15, 12, 'rgba(15,10,8,.7)') + m.ellipse(u, 50, 6, 4.5, '#0A0605');
      const [x, y] = m.P(u, 50);
      fx += smoke(x, y, 0.7, i) + flame(x, y + 3, 0.6, i);
    }
  }
  const cls = `ship-art ${state}`;
  return `<svg class="${cls}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none" aria-hidden="true"><g class="hull-g">${art}</g>${fx}</svg>`;
}

// Попадание по чужому кораблю, который ещё на плаву: только взрыв, без корабля
export function boomSvg(k = 0) {
  const pts = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 22 : 40 + ((i * 7 + k) % 3) * 4; pts.push(`${f1(50 + Math.cos(a) * r)},${f1(50 + Math.sin(a) * r)}`); }
  const pts2 = pts.map((p) => p.split(',').map((n) => f1(50 + (n - 50) * 0.6)).join(','));
  return `<svg class="boom-art" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="52" r="34" fill="rgba(12,8,6,.55)"/>
    <polygon points="${pts.join(' ')}" fill="#E8401C" class="bm1"/>
    <polygon points="${pts2.join(' ')}" fill="#FFB52E" class="bm2"/>
    <circle cx="50" cy="50" r="9" fill="#FFF3C4" class="bm3"/>
    ${[[18, 22], [80, 26], [24, 80], [78, 76]].map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="4" fill="#2A1C14" transform="rotate(${x} ${x} ${y})"/>`).join('')}
    ${smoke(50, 50, 0.55, k)}${flame(50, 56, 0.45, k)}
  </svg>`;
}

// Общие градиенты — один раз на экран
export const SHIP_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="sg-deck-h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.deck}"/><stop offset="1" stop-color="${C.deckLo}"/></linearGradient>
  <linearGradient id="sg-deck-v" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.deck}"/><stop offset="1" stop-color="${C.deckLo}"/></linearGradient>
  <linearGradient id="sg-teak-h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C99A64"/><stop offset="1" stop-color="#9C7144"/></linearGradient>
  <linearGradient id="sg-teak-v" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C99A64"/><stop offset="1" stop-color="#9C7144"/></linearGradient>
  <radialGradient id="sg-tur" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#93A2BC"/><stop offset=".55" stop-color="#66758F"/><stop offset="1" stop-color="#46536B"/></radialGradient>
</defs></svg>`;
