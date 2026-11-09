// Рисунки и анимации дуэлей: руки для «Камень, ножницы, бумага», объёмные кости, фишки крестиков-ноликов,
// конфетти и тучка. Тот же стиль, что у кораблей морского боя: вид чуть сверху, свет слева сверху,
// снизу видна «толщина» предмета.

// Цвет: осветлить/затемнить hex на k (−1…1)
function tone(hex, k) {
  const n = parseInt(String(hex || '#E8B48A').replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k)));
  return '#' + ch.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}
let gid = 0;

// Общие градиенты — один раз на экран. Фишки: «я» — фиолетовые, соперник — оранжевые, как рукава
export const DUEL_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="dg-die-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF0F7"/></linearGradient>
  <linearGradient id="dg-die-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E4E7F1"/><stop offset="1" stop-color="#CDD2E2"/></linearGradient>
  <linearGradient id="dg-die-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C6CCDD"/><stop offset="1" stop-color="#AAB2C8"/></linearGradient>
  <linearGradient id="dg-me" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C7B2FF"/><stop offset="1" stop-color="#6D3FD6"/></linearGradient>
  <linearGradient id="dg-opp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC48A"/><stop offset="1" stop-color="#E8780F"/></linearGradient>
</defs></svg>`;
export const SIDE = { me: { c: '#6D3FD6', dark: '#3A1E8C' }, opp: { c: '#E8780F', dark: '#8A4206' } };

// Палец: сужается к кончику, кончик скруглён, сверху ноготь
function finger(x1, y1, x2, y2, w1, w2, P) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const a = [x1 + nx * w1 / 2, y1 + ny * w1 / 2], b = [x2 + nx * w2 / 2, y2 + ny * w2 / 2], c = [x2 - nx * w2 / 2, y2 - ny * w2 / 2], d = [x1 - nx * w1 / 2, y1 - ny * w1 / 2];
  const f = (p) => p.map((v) => Math.round(v * 10) / 10).join(' ');
  const tip = [x2 + dx / L * w2 * 0.55, y2 + dy / L * w2 * 0.55];
  const nl = [x2 - dx / L * w2 * 0.15 + nx * w2 * 0.12, y2 - dy / L * w2 * 0.15 + ny * w2 * 0.12];
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  return `<path d="M${f(a)} L${f(b)} Q${f(tip)} ${f(c)} L${f(d)} Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.3" stroke-linejoin="round"/>
    <ellipse cx="${f([nl[0]])}" cy="${f([nl[1]])}" rx="${Math.round(w2 * 0.34 * 10) / 10}" ry="${Math.round(w2 * 0.24 * 10) / 10}" transform="rotate(${Math.round(ang)} ${f(nl)})" fill="${P.nail}" opacity=".9"/>
    <path d="M${f([x1 + nx * w1 * 0.28, y1 + ny * w1 * 0.28])} L${f([x2 + nx * w2 * 0.26, y2 + ny * w2 * 0.26])}" stroke="${P.hi}" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>`;
}
// Согнутый палец (фаланга смотрит вперёд): скруглённый брусок с бликом на костяшке
const curl = (x, y, w, P) => `<rect x="${x}" y="${y}" width="${w}" height="9.5" rx="4.75" fill="url(#${P.g2})" stroke="${P.line}" stroke-width="1.3"/>
  <path d="M${x + w - 7} ${y + 2.3} q4 0 4.6 3" stroke="${P.hi}" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".8"/>`;
const sleeve = (c) => `<path d="M-4 25 L28 23.5 C31.5 32 31.5 50 28 58.5 L-4 60 Z" fill="${c}"/>
  <path d="M-4 25 L28 23.5 C31.5 32 31.5 50 28 58.5 L-4 60 Z" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="1.2"/>
  <path d="M22 24 L29 23.6 C32.6 32 32.6 50 29 58.4 L22 58.8 C25 50 25 32 22 24 Z" fill="rgba(0,0,0,.22)"/>
  <path d="M-2 31 L20 30" stroke="rgba(255,255,255,.3)" stroke-width="1.8" stroke-linecap="round"/>`;
const palm = (P, wide = 0) => `<path d="M28 27 C40 21.5 62 20.5 ${74 + wide} 24 C${82 + wide} 27 ${85 + wide} 34 ${85 + wide} 42 C${85 + wide} 50 ${81 + wide} 56 ${73 + wide} 58.5 C60 61 40 60 28 56 Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M34 51 C46 55 62 55.5 72 53.5" stroke="${P.lo}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".55"/>`;
const thumbOver = (P, x2 = 80, y2 = 30) => `<path d="M44 29 C52 20.5 68 20 ${x2 - 2} ${y2 - 6} C${x2 + 4} ${y2 - 3} ${x2 + 3} ${y2 + 3} ${x2 - 3} ${y2 + 3} C66 ${y2 + 3} 56 33 46 34 Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.3" stroke-linejoin="round"/>
  <ellipse cx="${x2 - 1.5}" cy="${y2 - 1.5}" rx="3" ry="2.2" fill="${P.nail}" transform="rotate(-10 ${x2 - 1.5} ${y2 - 1.5})"/>
  <path d="M50 26 C57 22 66 21.5 74 23.5" stroke="${P.hi}" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".8"/>`;
function fist(P) {
  return palm(P) + [24, 32.5, 41, 49.5].map((y, i) => [y, i]).reverse().map(([y, i]) => curl(70, y, 22 - i * 1.4, P)).join('') + thumbOver(P);
}
function paper(P) {
  return palm(P, -6) + finger(66, 53, 94, 57, 8, 6.4, P) + finger(68, 46, 102, 47.5, 8.6, 7, P) + finger(68, 38.5, 104, 37.5, 8.8, 7.2, P) + finger(66, 31, 98, 26, 8.4, 6.8, P)
    + `<path d="M72 26 L72 56" stroke="url(#${P.g})" stroke-width="6"/>` + finger(52, 29, 66, 12, 9, 7.4, P);
}
function scissors(P) {
  return finger(70, 33, 102, 18, 8.6, 7, P) + finger(70, 41, 104, 50, 8.6, 7, P) + palm(P, -2) + [41, 49.5].map((y, i) => [y, i]).reverse().map(([y, i]) => curl(68, y, 20 - i * 1.4, P)).join('') + thumbOver(P, 76, 38);
}
const SHAPE = { rock: fist, paper, scissors };
function palette(skin) {
  const id = 'dgs' + (++gid);
  const P = { g: id, g2: id + 'b', hi: tone(skin, 0.45), lo: tone(skin, -0.25), line: tone(skin, -0.5), nail: tone(skin, 0.55) };
  P.defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone(skin, 0.28)}"/><stop offset=".55" stop-color="${skin}"/><stop offset="1" stop-color="${tone(skin, -0.16)}"/></linearGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone(skin, 0.12)}"/><stop offset="1" stop-color="${tone(skin, -0.2)}"/></linearGradient></defs>`;
  return P;
}
// Рука игрока смотрит вправо (у соперника зеркалит CSS). skin — тон кожи с аватара, color — рукав
export function handSvg(kind, color = SIDE.me.c, skin = '#E8B48A', cls = '') {
  const P = palette(skin);
  return `<svg class="hand ${cls}" viewBox="-6 4 120 66" aria-hidden="true">${P.defs}<ellipse cx="56" cy="66" rx="40" ry="3.6" fill="rgba(0,0,0,.25)" class="h-shadow"/><g class="h-body">${sleeve(color)}${(SHAPE[kind] || fist)(P)}</g></svg>`;
}
// Рука для раунда: кулак качается три раза, на третий — фигура
export function handDuo(kind, color = SIDE.me.c, skin = '#E8B48A', cls = '') {
  const P = palette(skin);
  return `<svg class="hand ${cls}" viewBox="-6 4 120 66" aria-hidden="true">${P.defs}<ellipse cx="56" cy="66" rx="40" ry="3.6" fill="rgba(0,0,0,.25)" class="h-shadow"/>
    <g class="h-body"><g class="h-fist">${sleeve(color)}${fist(P)}</g><g class="h-final">${sleeve(color)}${(SHAPE[kind] || fist)(P)}</g></g></svg>`;
}

// ----- Кости: кубик в изометрии. Сверху — выпавшее число, по бокам — соседние грани -----
const PIP = { 1: [[0.5, 0.5]], 2: [[0.25, 0.25], [0.75, 0.75]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]], 4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]], 6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]] };
// Соседи грани (противоположные дают 7): что видно слева и справа
const SIDES = { 1: [2, 3], 2: [3, 1], 3: [1, 2], 4: [5, 1], 5: [1, 3], 6: [4, 5] };
const r1 = (n) => Math.round(n * 10) / 10;
function face(n, o, a, b, rx, ry, rot, red) {
  return (PIP[n] || []).map(([s, t]) => {
    const x = o[0] + a[0] * s + b[0] * t, y = o[1] + a[1] * s + b[1] * t;
    return `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${r1(x)} ${r1(y)})" fill="${red && n === 1 ? '#E0263B' : '#1F2740'}"/>`;
  }).join('');
}
function cube(n) {
  const [l, r] = SIDES[n] || [2, 3];
  return `<polygon points="50,8 90,30 50,52 10,30" fill="url(#dg-die-top)" stroke="#9AA3BC" stroke-width="2.2" stroke-linejoin="round"/>
    <polygon points="10,30 50,52 50,94 10,72" fill="url(#dg-die-l)" stroke="#9AA3BC" stroke-width="2.2" stroke-linejoin="round"/>
    <polygon points="50,52 90,30 90,72 50,94" fill="url(#dg-die-r)" stroke="#9AA3BC" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M14 30 L50 10 L86 30" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>
    ${face(n, [50, 8], [40, 22], [-40, 22], n === 1 ? 8.5 : 6.2, n === 1 ? 5 : 3.6, 0, true)}
    ${face(l, [10, 30], [40, 22], [0, 42], 3.4, 5.6, 28, false)}
    ${face(r, [50, 52], [40, -22], [0, 42], 3.4, 5.6, -28, false)}`;
}
// state: '' — лежит, 'roll' — летит и крутится, 'land' — приземлился (подскок), 'blank' — ещё не брошен
export function dieSvg(n, state = '', delay = 0) {
  if (state === 'blank') return `<span class="die3 blank"><svg viewBox="0 0 100 108" aria-hidden="true"><ellipse cx="50" cy="100" rx="34" ry="6" fill="rgba(0,0,0,.25)"/><g opacity=".22">${cube(1).replace(/<ellipse[^>]*\/>/g, '')}</g><text x="50" y="40" text-anchor="middle" font-size="22" font-weight="900" fill="rgba(255,255,255,.7)">?</text></svg></span>`;
  const spin = state === 'roll' ? `<g class="d-faces">${[3, 5, 2, 6, 1, 4].map((k, i) => `<g class="d-f" style="animation-delay:${-i * 0.06}s">${cube(k)}</g>`).join('')}</g>` : cube(n);
  return `<span class="die3 ${state}" style="--dd:${delay}s" aria-label="${n || ''}"><svg viewBox="0 0 100 108" aria-hidden="true"><ellipse cx="50" cy="100" rx="34" ry="6" fill="rgba(0,0,0,.3)" class="d-shadow"/><g class="d-body">${spin}</g></svg></span>`;
}

// ----- Крестики-нолики: фишки с объёмом, цвет — по игроку (я — фиолетовый, соперник — оранжевый) -----
export function tttMark(mark, fresh = false, who = 'me') {
  const g = `url(#dg-${who})`, dk = SIDE[who].dark;
  if (mark === 'x') return `<svg viewBox="0 0 40 40" class="tm x ${fresh ? 'fresh' : ''}" aria-hidden="true">
    <path d="M11 12 L29 30 M29 12 L11 30" stroke="${dk}" stroke-width="7" stroke-linecap="round" transform="translate(0 2.2)"/>
    <path class="s1" d="M11 11 L29 29" stroke="${g}" stroke-width="6.5" stroke-linecap="round"/>
    <path class="s2" d="M29 11 L11 29" stroke="${g}" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M13 12 L18 17 M27 12 L24 15" stroke="rgba(255,255,255,.7)" stroke-width="1.8" stroke-linecap="round" class="gl"/></svg>`;
  if (mark === 'o') return `<svg viewBox="0 0 40 40" class="tm o ${fresh ? 'fresh' : ''}" aria-hidden="true">
    <circle cx="20" cy="22.2" r="10" stroke="${dk}" stroke-width="7" fill="none"/>
    <circle class="s1" cx="20" cy="20" r="10" stroke="${g}" stroke-width="6.5" fill="none"/>
    <path d="M13 15.5 A9 9 0 0 1 20 11" stroke="rgba(255,255,255,.75)" stroke-width="1.8" fill="none" stroke-linecap="round" class="gl"/></svg>`;
  return '';
}
// Линия победы поверх поля 3×3: из центра первой клетки в центр последней
export function tttLine(line) {
  if (!line) return '';
  const c = (i) => [(i % 3) * 100 + 50, Math.floor(i / 3) * 100 + 50];
  const [a, b] = [c(line[0]), c(line[2])];
  const dx = b[0] - a[0], dy = b[1] - a[1], k = 0.18;
  return `<svg class="ttt-line" viewBox="0 0 300 300" aria-hidden="true"><path d="M${a[0] - dx * k} ${a[1] - dy * k} L${b[0] + dx * k} ${b[1] + dy * k}" stroke="#FFD84D" stroke-width="12" stroke-linecap="round" pathLength="100"/></svg>`;
}

// ----- Праздник и огорчение -----
const CONF = ['#FFC93C', '#FF6FA8', '#22D3EE', '#7CFFB2', '#B79CFF', '#FF8A3C'];
export function confetti(n = 26) {
  let o = '';
  for (let i = 0; i < n; i++) {
    const x = (i * 37) % 100, dx = ((i * 53) % 60) - 30, d = ((i * 29) % 40) / 100, r = (i * 71) % 360;
    o += `<i style="left:${x}%;--dx:${dx}px;--r:${r}deg;animation-delay:${d}s;background:${CONF[i % CONF.length]};${i % 3 ? '' : 'border-radius:50%;'}"></i>`;
  }
  return `<div class="confetti" aria-hidden="true">${o}</div>`;
}
export function raincloud() {
  return `<div class="raincloud" aria-hidden="true"><svg viewBox="0 0 80 60"><path d="M18 34 a12 12 0 0 1 4-23 a16 16 0 0 1 30 2 a11 11 0 0 1 10 21 Z" fill="#A9B4CC" stroke="#7C88A3" stroke-width="2"/>
    ${[22, 34, 46, 58].map((x, i) => `<path class="drop" style="animation-delay:${i * 0.18}s" d="M${x} 40 l-3 8" stroke="#7FC4FF" stroke-width="2.6" stroke-linecap="round"/>`).join('')}</svg></div>`;
}
