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

// ===== Руки — фронтально, как в эмодзи ✊ ✋ ✌. viewBox 100×130, запястье внизу по центру =====
const rr = (n) => Math.round(n * 10) / 10;
// Палец: от основания (x1,y1) к кончику (x2,y2), ширина w у основания и w2 у кончика. Суставы — короткие дуги
function digit(x1, y1, x2, y2, w, w2, P, joints = 2) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const a = [x1 + nx * w / 2, y1 + ny * w / 2], b = [x2 + nx * w2 / 2, y2 + ny * w2 / 2], c = [x2 - nx * w2 / 2, y2 - ny * w2 / 2], d = [x1 - nx * w / 2, y1 - ny * w / 2];
  const t1 = [x2 + ux * w2 * 0.62 + nx * w2 * 0.38, y2 + uy * w2 * 0.62 + ny * w2 * 0.38], t2 = [x2 + ux * w2 * 0.62 - nx * w2 * 0.38, y2 + uy * w2 * 0.62 - ny * w2 * 0.38];
  const f = (p) => `${rr(p[0])} ${rr(p[1])}`;
  let o = `<path d="M${f(d)} L${f(a)} L${f(b)} C${f(t1)} ${f(t2)} ${f(c)} Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.2" stroke-linejoin="round"/>`;
  // ноготь у кончика
  const nc = [x2 - ux * w2 * 0.05, y2 - uy * w2 * 0.05], ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  o += `<ellipse cx="${rr(nc[0])}" cy="${rr(nc[1])}" rx="${rr(w2 * 0.3)}" ry="${rr(w2 * 0.36)}" transform="rotate(${rr(ang)} ${rr(nc[0])} ${rr(nc[1])})" fill="${P.nail}" stroke="${P.lo}" stroke-width=".6" opacity=".95"/>`;
  // складки суставов
  for (let k = 1; k <= joints; k++) {
    const t = k / (joints + 1) * 0.9, cx = x1 + dx * t, cy = y1 + dy * t, ww = (w + (w2 - w) * t) * 0.3;
    o += `<path d="M${rr(cx + nx * ww)} ${rr(cy + ny * ww)} Q${rr(cx - ux * 1.6)} ${rr(cy - uy * 1.6)} ${rr(cx - nx * ww)} ${rr(cy - ny * ww)}" stroke="${P.lo}" stroke-width=".9" fill="none" stroke-linecap="round" opacity=".7"/>`;
  }
  // блик вдоль пальца
  o += `<path d="M${rr(x1 + nx * w * 0.22 + dx * 0.1)} ${rr(y1 + ny * w * 0.22 + dy * 0.1)} L${rr(x2 + nx * w2 * 0.2 - ux * 2)} ${rr(y2 + ny * w2 * 0.2 - uy * 2)}" stroke="${P.hi}" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>`;
  return o;
}
// Манжета рукава внизу
const cuff = (c) => `<path d="M30 112 C30 106 70 106 70 112 L72 132 L28 132 Z" fill="${c}"/>
  <path d="M29.5 113 C36 109 64 109 70.5 113 L71 118 C64 114.5 36 114.5 29 118 Z" fill="rgba(0,0,0,.22)"/>
  <path d="M33 122 L67 122" stroke="rgba(255,255,255,.25)" stroke-width="1.6" stroke-linecap="round"/>`;
// Ладонь с запястьем
const palmF = (P) => `<path d="M33 112 C31 100 24 92 24 78 C24 64 30 56 50 56 C70 56 77 63 77 76 C77 92 70 100 67 112 Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M38 98 C44 94 56 94 62 98" stroke="${P.lo}" stroke-width="1" fill="none" stroke-linecap="round" opacity=".6"/>
  <path d="M34 80 C42 84 52 82 60 76" stroke="${P.lo}" stroke-width="1" fill="none" stroke-linecap="round" opacity=".5"/>`;
// Кулак: четыре согнутых пальца — валики с костяшками сверху, большой палец лежит поперёк
function fistF(P) {
  let o = `<path d="M33 112 C31 102 22 94 22 80 C22 64 28 52 50 50 C72 52 79 62 79 78 C79 94 70 102 67 112 Z" fill="url(#${P.g2})" stroke="${P.line}" stroke-width="1.2" stroke-linejoin="round"/>`;
  [[24.5, 46], [38.5, 42.5], [52.5, 42.5], [66, 46]].forEach(([x, y], i) => {
    const w = i === 3 ? 13 : 14.5;
    o += `<path d="M${x} ${y + 26} L${x} ${y + 7} C${x} ${y - 1} ${x + w} ${y - 1} ${x + w} ${y + 7} L${x + w} ${y + 26} Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M${x + 2.5} ${y + 14} Q${x + w / 2} ${y + 16.5} ${x + w - 2.5} ${y + 14}" stroke="${P.lo}" stroke-width=".9" fill="none" opacity=".75"/>
      <ellipse cx="${x + w / 2 - 1.5}" cy="${y + 5}" rx="${w * 0.22}" ry="1.8" fill="${P.hi}" opacity=".7"/>`;
  });
  // большой палец поперёк нижних фаланг
  o += `<path d="M22 80 C22 70 34 66 48 68 C58 69.5 64 72 63 77 C62 82 54 82 46 81 C38 80.5 32 84 29 90 Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.2" stroke-linejoin="round"/>
    <ellipse cx="58.5" cy="75.5" rx="4.2" ry="3.2" fill="${P.nail}" stroke="${P.lo}" stroke-width=".6"/>
    <path d="M28 76 C34 71 42 70 50 70.5" stroke="${P.hi}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".6"/>`;
  return o;
}
// Ладонь: пять пальцев чуть веером
function paperF(P) {
  return palmF(P)
    + digit(69, 68, 79, 38, 13.5, 11.5, P) + digit(59.5, 62, 63, 20, 15, 13, P) + digit(48.5, 61, 48.5, 14, 15.5, 13.5, P) + digit(37, 64, 33.5, 22, 15, 13, P)
    + digit(30, 88, 13, 67, 15.5, 13, P, 1);
}
// Знак «V»: указательный и средний разведены, безымянный и мизинец поджаты, большой палец сверху
function scissorsF(P) {
  let o = digit(56, 62, 68, 20, 15, 13, P) + digit(43, 62, 34, 18, 15, 13, P);
  o += `<path d="M33 112 C31 102 23 94 23 80 C23 66 29 58 50 57 C71 58 78 66 78 79 C78 94 70 102 67 112 Z" fill="url(#${P.g2})" stroke="${P.line}" stroke-width="1.2" stroke-linejoin="round"/>`;
  [[52, 56], [64, 59]].forEach(([x, y], i) => {
    const w = i ? 11.5 : 13;
    o += `<path d="M${x} ${y + 24} L${x} ${y + 7} C${x} ${y - 1} ${x + w} ${y - 1} ${x + w} ${y + 7} L${x + w} ${y + 24} Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.2" stroke-linejoin="round"/>
      <ellipse cx="${x + w / 2 - 1.5}" cy="${y + 5}" rx="${w * 0.22}" ry="1.8" fill="${P.hi}" opacity=".7"/>`;
  });
  o += `<path d="M23 84 C23 74 34 70 48 72 C60 73.5 70 75 69 80 C68 85 58 85 49 84.5 C40 84 33 88 30 94 Z" fill="url(#${P.g})" stroke="${P.line}" stroke-width="1.2" stroke-linejoin="round"/>
    <ellipse cx="64" cy="79" rx="4.2" ry="3.2" fill="${P.nail}" stroke="${P.lo}" stroke-width=".6"/>
    <path d="M29 80 C35 75 43 74 51 74.5" stroke="${P.hi}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".6"/>`;
  return o;
}
const SHAPE = { rock: fistF, paper: paperF, scissors: scissorsF };
function palette(skin) {
  const id = 'dgs' + (++gid);
  const P = { g: id, g2: id + 'b', hi: tone(skin, 0.5), lo: tone(skin, -0.28), line: tone(skin, -0.42), nail: tone(skin, 0.6) };
  P.defs = `<defs><radialGradient id="${id}" cx=".35" cy=".25" r=".95"><stop offset="0" stop-color="${tone(skin, 0.3)}"/><stop offset=".6" stop-color="${skin}"/><stop offset="1" stop-color="${tone(skin, -0.14)}"/></radialGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone(skin, -0.05)}"/><stop offset="1" stop-color="${tone(skin, -0.22)}"/></linearGradient></defs>`;
  return P;
}
const handBox = (inner, P, cls) => `<svg class="hand ${cls}" viewBox="0 0 100 134" aria-hidden="true">${P.defs}<ellipse cx="50" cy="131" rx="30" ry="3.4" fill="rgba(0,0,0,.28)" class="h-shadow"/><g class="h-body">${inner}</g></svg>`;
// Рука игрока. skin — тон кожи с аватара, color — рукав
export function handSvg(kind, color = SIDE.me.c, skin = '#E8B48A', cls = '') {
  const P = palette(skin);
  return handBox(cuff(color) + (SHAPE[kind] || fistF)(P), P, cls);
}
// Для раунда: кулак качается «раз-два-три», на третий — фигура
export function handDuo(kind, color = SIDE.me.c, skin = '#E8B48A', cls = '') {
  const P = palette(skin);
  return handBox(`${cuff(color)}<g class="h-fist">${fistF(P)}</g><g class="h-final">${(SHAPE[kind] || fistF)(P)}</g>`, P, cls);
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
export function tttLine(line, fresh = false) {
  if (!line) return '';
  const c = (i) => [(i % 3) * 100 + 50, Math.floor(i / 3) * 100 + 50];
  const [a, b] = [c(line[0]), c(line[2])];
  const dx = b[0] - a[0], dy = b[1] - a[1], k = 0.18;
  return `<svg class="ttt-line ${fresh ? 'fresh' : ''}" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true"><path d="M${a[0] - dx * k} ${a[1] - dy * k} L${b[0] + dx * k} ${b[1] + dy * k}" stroke="#FFD84D" stroke-width="12" stroke-linecap="round" pathLength="100"/></svg>`;
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
