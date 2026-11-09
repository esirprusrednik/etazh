// Рисунки и анимации дуэлей: руки для «Камень, ножницы, бумага», объёмные кости, фишки крестиков-ноликов,
// конфетти и тучка. Тот же стиль, что у кораблей морского боя: вид чуть сверху, свет слева сверху,
// снизу видна «толщина» предмета.

const SKIN = { hi: '#FFE0C2', mid: '#F4BF92', lo: '#D9925F', line: '#8A5634', nail: '#FFE9DA' };

// Общие градиенты — один раз на экран
export const DUEL_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="dg-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKIN.hi}"/><stop offset=".55" stop-color="${SKIN.mid}"/><stop offset="1" stop-color="${SKIN.lo}"/></linearGradient>
  <linearGradient id="dg-skin2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKIN.mid}"/><stop offset="1" stop-color="${SKIN.lo}"/></linearGradient>
  <linearGradient id="dg-die-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF0F7"/></linearGradient>
  <linearGradient id="dg-die-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E4E7F1"/><stop offset="1" stop-color="#CDD2E2"/></linearGradient>
  <linearGradient id="dg-die-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C6CCDD"/><stop offset="1" stop-color="#AAB2C8"/></linearGradient>
  <linearGradient id="dg-x" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF9CC5"/><stop offset="1" stop-color="#E23D82"/></linearGradient>
  <linearGradient id="dg-o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7FEAFF"/><stop offset="1" stop-color="#0FA3C7"/></linearGradient>
</defs></svg>`;

const OL = `stroke="${SKIN.line}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"`;
const capsule = (x1, y1, x2, y2, w, fill = 'url(#dg-skin)') => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${SKIN.line}" stroke-width="${w + 3.6}" stroke-linecap="round"/><path d="M${x1} ${y1} L${x2} ${y2}" stroke="${fill}" stroke-width="${w}" stroke-linecap="round"/>`;
const nail = (x, y, r = 0) => `<ellipse cx="${x}" cy="${y}" rx="3.6" ry="2.6" fill="${SKIN.nail}" stroke="${SKIN.line}" stroke-width=".8" transform="rotate(${r} ${x} ${y})"/>`;

// Рукав: цвет — игрока. Манжета со строчкой и тенью
const sleeve = (c) => `<path d="M-6 22 L30 20 C34 30 34 52 30 62 L-6 64 Z" fill="${c}" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>
  <path d="M24 20.5 L32 20 C36 30 36 52 32 62 L24 62.5 C28 52 28 30 24 20.5 Z" fill="rgba(0,0,0,.22)"/>
  <path d="M-4 30 L22 29" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-linecap="round"/>
  <path d="M27 24 C30 34 30 48 27 58" stroke="rgba(255,255,255,.4)" stroke-width="1" stroke-dasharray="2 2.5" fill="none"/>`;

// Кулак сбоку: костяшки смотрят вправо, большой палец сверху
const curled = (ys, x0, x1) => ys.slice().reverse().map((y, i, a) => { const k = a.length - 1 - i; const w = x1 - x0 - k * 1.5;
  return `<rect x="${x0}" y="${y}" width="${w}" height="11" rx="5.5" fill="url(#dg-skin2)" ${OL}/><path d="M${x0 + w - 9} ${y + 2.6} C${x0 + w - 4} ${y + 2.4} ${x0 + w - 2.4} ${y + 4} ${x0 + w - 2.4} ${y + 5.5}" stroke="rgba(255,255,255,.6)" stroke-width="1.5" fill="none" stroke-linecap="round"/>`; }).join('');
// Кулак сбоку: костяшки смотрят вправо, четыре согнутых пальца, большой палец сверху
function fist() {
  return `<path d="M30 25 C44 18 70 16 86 20 C96 23 100 33 100 42 C100 53 96 61 86 64 C70 68 44 65 30 59 Z" fill="url(#dg-skin)" ${OL}/>
    <path d="M36 54 C52 60 72 61 84 58" stroke="rgba(150,80,40,.35)" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${curled([23, 33, 43, 53], 76, 108)}
    <path d="M48 26 C58 14 82 14 94 22 C99 26 97 34 89 34 C76 33 62 33 50 34 Z" fill="url(#dg-skin)" ${OL}/>
    ${nail(91, 26, -12)}
    <path d="M54 23 C62 18 76 17 86 20" stroke="rgba(255,255,255,.6)" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
}
// Ладонь вперёд: четыре пальца веером, большой вверх
function paper() {
  return `<path d="M30 26 C44 20 64 20 76 24 L78 58 C64 63 44 62 30 57 Z" fill="url(#dg-skin)" ${OL}/>
    ${capsule(70, 55, 102, 60, 9)}${nail(102, 60, 8)}
    ${capsule(72, 47, 112, 49, 10)}${nail(112, 49, 3)}
    ${capsule(72, 38, 114, 37, 10)}${nail(114, 37, -2)}
    ${capsule(70, 29, 108, 24, 9.5)}${nail(108, 24, -8)}
    <path d="M78 26 L78 58" stroke="url(#dg-skin)" stroke-width="8"/>
    ${capsule(56, 27, 74, 8, 10)}${nail(74, 8, -55)}
    <path d="M40 30 C52 27 64 27 72 29" stroke="rgba(255,255,255,.55)" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M46 44 C54 47 62 47 70 45" stroke="rgba(150,80,40,.35)" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
}
// Ножницы: указательный и средний — буквой V, остальные поджаты
function scissors() {
  return `${capsule(78, 30, 114, 14, 9.5)}${nail(114, 14, -24)}
    ${capsule(78, 40, 116, 52, 9.5)}${nail(116, 52, 18)}
    <path d="M30 26 C44 19 70 18 82 24 C90 28 94 36 94 44 C94 53 90 60 82 62 C68 66 44 64 30 58 Z" fill="url(#dg-skin)" ${OL}/>
    ${curled([42, 52], 74, 102)}
    <path d="M50 34 C60 26 78 27 86 34 C90 38 87 44 80 43 C70 42 60 42 52 43 Z" fill="url(#dg-skin)" ${OL}/>
    ${nail(84, 37, -8)}
    <path d="M40 30 C52 25 66 24 78 27" stroke="rgba(255,255,255,.55)" stroke-width="2" fill="none" stroke-linecap="round"/>`;
}
const SHAPE = { rock: fist, paper, scissors };

// Рука игрока: смотрит вправо, у соперника — зеркально (CSS). Тень на столе под рукой
export function handSvg(kind, color = '#6D3FD6', cls = '') {
  return `<svg class="hand ${cls}" viewBox="-8 0 132 80" aria-hidden="true"><ellipse cx="60" cy="74" rx="44" ry="4.5" fill="rgba(0,0,0,.28)" class="h-shadow"/><g class="h-body">${sleeve(color)}${(SHAPE[kind] || fist)()}</g></svg>`;
}
// Рука для анимации раунда: кулак качается три раза, на третий превращается в выбранную фигуру
export function handDuo(kind, color, cls = '') {
  return `<svg class="hand ${cls}" viewBox="-8 0 132 80" aria-hidden="true"><ellipse cx="60" cy="74" rx="44" ry="4.5" fill="rgba(0,0,0,.28)" class="h-shadow"/>
    <g class="h-body"><g class="h-fist">${sleeve(color)}${fist()}</g><g class="h-final">${sleeve(color)}${(SHAPE[kind] || fist)()}</g></g></svg>`;
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

// ----- Крестики-нолики: фишки с объёмом -----
export function tttMark(mark, fresh = false) {
  if (mark === 'x') return `<svg viewBox="0 0 40 40" class="tm x ${fresh ? 'fresh' : ''}" aria-hidden="true">
    <path d="M10 11 L30 31 M30 11 L10 31" stroke="#7A1440" stroke-width="7.5" stroke-linecap="round" transform="translate(0 2.2)"/>
    <path class="s1" d="M10 10 L30 30" stroke="url(#dg-x)" stroke-width="7" stroke-linecap="round"/>
    <path class="s2" d="M30 10 L10 30" stroke="url(#dg-x)" stroke-width="7" stroke-linecap="round"/>
    <path d="M12 11 L18 17 M28 11 L24 15" stroke="rgba(255,255,255,.7)" stroke-width="2" stroke-linecap="round" class="gl"/></svg>`;
  if (mark === 'o') return `<svg viewBox="0 0 40 40" class="tm o ${fresh ? 'fresh' : ''}" aria-hidden="true">
    <circle cx="20" cy="22.2" r="11" stroke="#065C73" stroke-width="7.5" fill="none"/>
    <circle class="s1" cx="20" cy="20" r="11" stroke="url(#dg-o)" stroke-width="7" fill="none"/>
    <path d="M12.5 15 A10 10 0 0 1 20 10" stroke="rgba(255,255,255,.75)" stroke-width="2" fill="none" stroke-linecap="round" class="gl"/></svg>`;
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
