// Гербы банд: щит из частей — форма, деление поля, два цвета, фигура, навершие и лента с девизом.
// Щит векторный и «лепится» градиентами; фигуры, навершия и лента — вылепленные картинки (tools/art/README.md).
// Ключи частей совпадают с CREST в server/catalog.js — сервер проверяет, что пришли только они.
// Если банда герб не собирала, он собирается сам из того, что объединяет банду, интересов и id — у каждой банды свой.

export const TINCTURES = {
  gold: ['#F2B705', '#A87C00'], silver: ['#E9EDF3', '#9AA3B5'], red: ['#D7263D', '#8E1424'], blue: ['#2563C9', '#173E80'],
  green: ['#1F8A4C', '#11552E'], purple: ['#7B3FE4', '#4B2295'], black: ['#1E2433', '#05070C'], orange: ['#F97316', '#A44508'],
  sky: ['#38BDF8', '#0E7DB0'], pink: ['#EC4899', '#9D1B5E']
};
export const TINCTURE_NAMES = { gold: 'Золото', silver: 'Серебро', red: 'Червлень', blue: 'Лазурь', green: 'Зелень', purple: 'Пурпур', black: 'Чернь', orange: 'Апельсин', sky: 'Небо', pink: 'Фуксия' };

// Формы щита в квадрате 100×120
const SHAPES = {
  heater: 'M10 10 H90 V55 C90 86 70 101 50 111 C30 101 10 86 10 55 Z',
  french: 'M10 10 H90 V82 Q90 97 74 99 H60 Q52 100 50 110 Q48 100 40 99 H26 Q10 97 10 82 Z',
  round: 'M10 10 H90 V64 A40 46 0 0 1 10 64 Z',
  kite: 'M50 6 C73 8 90 18 90 38 C90 70 69 96 50 113 C31 96 10 70 10 38 C10 18 27 8 50 6 Z',
  badge: 'M50 5 L89 19 V62 C89 87 71 103 50 113 C29 103 11 87 11 62 V19 Z',
  swiss: 'M10 12 Q50 2 90 12 V58 C90 88 68 102 50 112 C32 102 10 88 10 58 Z'
};
export const SHAPE_NAMES = { heater: 'Классика', french: 'Французский', round: 'Испанский', kite: 'Миндаль', badge: 'Шеврон', swiss: 'Швейцарский' };

// Деления поля: что закрашивается вторым цветом
const DIVS = {
  plain: () => '',
  pale: (c) => `<rect x="50" y="0" width="60" height="130" fill="${c}"/>`,
  fess: (c) => `<rect x="0" y="58" width="110" height="70" fill="${c}"/>`,
  bend: (c) => `<polygon points="0,0 34,0 110,92 110,130 76,130 0,38" fill="${c}"/>`,
  perbend: (c) => `<polygon points="100,0 100,130 0,130" fill="${c}"/>`,
  quarterly: (c) => `<rect x="50" y="0" width="60" height="58" fill="${c}"/><rect x="0" y="58" width="50" height="70" fill="${c}"/>`,
  chevron: (c) => `<polygon points="0,96 50,46 100,96 100,120 50,70 0,120" fill="${c}"/>`,
  chief: (c) => `<rect x="0" y="0" width="110" height="34" fill="${c}"/>`,
  cross: (c) => `<rect x="42" y="0" width="16" height="130" fill="${c}"/><rect x="0" y="46" width="110" height="16" fill="${c}"/>`,
  saltire: (c) => `<polygon points="0,0 14,0 110,116 110,130 96,130 0,14" fill="${c}"/><polygon points="100,0 86,0 -10,116 -10,130 4,130 100,14" fill="${c}"/>`,
  bars: (c) => [26, 50, 74, 98].map((y) => `<rect x="0" y="${y}" width="110" height="11" fill="${c}"/>`).join(''),
  paly: (c) => [18, 42, 66].map((x) => `<rect x="${x}" y="0" width="12" height="130" fill="${c}"/>`).join(''),
  checky: (c) => { let s = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 7; x++) if ((x + y) % 2) s += `<rect x="${x * 15}" y="${y * 15}" width="15" height="15" fill="${c}"/>`; return s; },
  bordure: (c) => `<path d="SHAPE" fill="none" stroke="${c}" stroke-width="14"/>`
};
export const DIV_NAMES = { plain: 'Без деления', pale: 'Рассечён', fess: 'Пересечён', bend: 'Перевязь', perbend: 'Скошен', quarterly: 'Четверочастный', chevron: 'Стропило', chief: 'Глава', cross: 'Крест', saltire: 'Андреевский', bars: 'Пояса', paly: 'Столбы', checky: 'Шахматы', bordure: 'Кайма' };

// Фигуры: линейные значки 40×40. Рисуем дважды — тёмная подложка и цвет, чтобы читались на любом поле
const C = {
  chart: 'M6 34 H34 M9 33 V24 M17 33 V16 M25 33 V20 M33 33 V8 M8 18 L16 11 L24 15 L33 5',
  search: 'M17 6 a11 11 0 1 0 0.01 0 M25 25 L35 35',
  gear: 'M20 13 a7 7 0 1 0 0.01 0 M20 3 V8 M20 32 V37 M3 20 H8 M32 20 H37 M8 8 L11.5 11.5 M28.5 28.5 L32 32 M32 8 L28.5 11.5 M11.5 28.5 L8 32',
  code: 'M13 10 L4 20 L13 30 M27 10 L36 20 L27 30 M23 5 L17 35',
  coin: 'M20 4 a16 16 0 1 0 0.01 0 M16 29 V11 H22 a5 5 0 0 1 0 10 H13 M13 25 H23',
  megaphone: 'M5 16 V24 H11 L30 33 V7 L11 16 Z M11 24 L14 34 H19 L17 26 M34 15 V25',
  scales: 'M20 5 V35 M12 35 H28 M6 11 H34 M6 11 L1 23 H11 Z M34 11 L29 23 H39 Z M20 5 a2 2 0 1 0 0.01 0',
  tower: 'M20 15 L12 36 M20 15 L28 36 M14.5 29 H25.5 M17 22 H23 M20 15 a2.5 2.5 0 1 0 0.01 0 M12 8 a10 10 0 0 0 0 14 M28 8 a10 10 0 0 1 0 14 M7 4 a16 16 0 0 0 0 22 M33 4 a16 16 0 0 1 0 22',
  briefcase: 'M4 13 H36 V33 H4 Z M14 13 V8 H26 V13 M4 21 H36 M18 21 V25 H22 V21',
  bag: 'M7 13 H33 L31 36 H9 Z M14 17 V10 a6 6 0 0 1 12 0 V17',
  headset: 'M7 24 V20 a13 13 0 0 1 26 0 V24 M5 22 H10 V32 H5 Z M30 22 H35 V32 H30 Z M33 32 Q33 37 24 37 H21',
  people: 'M14 9 a5 5 0 1 0 0.01 0 M4 33 a10 10 0 0 1 20 0 M27 11 a4 4 0 1 0 0.01 0 M23 22 a9 9 0 0 1 13 9',
  lock: 'M9 18 H31 V36 H9 Z M14 18 V12 a6 6 0 0 1 12 0 V18 M20 25 V29',
  crown: 'M5 30 L3 11 L13 19 L20 7 L27 19 L37 11 L35 30 Z M5 35 H35',
  star: 'M20 3 L25 14.5 L37.5 15.5 L28 24 L31 36.5 L20 30 L9 36.5 L12 24 L2.5 15.5 L15 14.5 Z',
  bolt: 'M23 3 L8 23 H19 L16 37 L32 16 H21 Z',
  cup: 'M7 15 H29 V27 a8 8 0 0 1 -8 8 H15 a8 8 0 0 1 -8 -8 Z M29 18 H32 a4 4 0 0 1 0 8 H29 M13 5 Q11 8 13 11 M19 4 Q17 7 19 10 M25 5 Q23 8 25 11',
  book: 'M20 9 Q13 5 4 7 V33 Q13 31 20 35 Q27 31 36 33 V7 Q27 5 20 9 Z M20 9 V35',
  note: 'M15 30 V7 L33 4 V27 M15 30 a5 4 0 1 1 -0.01 0 M33 27 a5 4 0 1 1 -0.01 0 M15 13 L33 10',
  plane: 'M20 3 Q23 3 23 9 V16 L37 24 V28 L23 23 V31 L28 35 V37 L20 35 L12 37 V35 L17 31 V23 L3 28 V24 L17 16 V9 Q17 3 20 3 Z',
  ball: 'M20 4 a16 16 0 1 0 0.01 0 M20 13 L27 18 L24.5 26 H15.5 L13 18 Z M20 13 V4 M27 18 L35 15 M24.5 26 L29 33 M15.5 26 L11 33 M13 18 L5 15',
  rocket: 'M20 3 Q30 11 28 26 H12 Q10 11 20 3 Z M20 12 a3 3 0 1 0 0.01 0 M12 21 L6 28 L12 30 M28 21 L34 28 L28 30 M16 30 Q20 38 24 30',
  flame: 'M20 3 Q30 13 28 24 Q30 20 31 18 Q36 26 31 32 Q27 37 20 37 Q13 37 9 32 Q5 26 10 17 Q12 22 14 23 Q12 13 20 3 Z',
  tree: 'M20 3 L32 17 H26 L35 28 H5 L14 17 H8 Z M20 28 V37',
  heart: 'M20 34 L7 21 a7.5 7.5 0 0 1 13 -9 a7.5 7.5 0 0 1 13 9 Z',
  dice: 'M5 5 H35 V35 H5 Z M13 13 a1.5 1.5 0 1 0 0.01 0 M27 13 a1.5 1.5 0 1 0 0.01 0 M20 20 a1.5 1.5 0 1 0 0.01 0 M13 27 a1.5 1.5 0 1 0 0.01 0 M27 27 a1.5 1.5 0 1 0 0.01 0',
  film: 'M5 8 H35 V32 H5 Z M11 8 V32 M29 8 V32 M5 14 H11 M5 20 H11 M5 26 H11 M29 14 H35 M29 20 H35 M29 26 H35 M16 15 L24 20 L16 25 Z',
  pizza: 'M20 36 L4 8 Q20 1 36 8 Z M6 12 Q20 6 34 12 M15 17 a2 2 0 1 0 0.01 0 M23 15 a2 2 0 1 0 0.01 0 M20 25 a2 2 0 1 0 0.01 0',
  medal: 'M13 3 L20 15 L27 3 M8 3 L15 15 M32 3 L25 15 M20 15 a10 10 0 1 0 0.01 0 M20 21 L21.8 24.5 L25.6 25 L22.8 27.6 L23.5 31.3 L20 29.5 L16.5 31.3 L17.2 27.6 L14.4 25 L18.2 24.5 Z',
  globe: 'M20 4 a16 16 0 1 0 0.01 0 M4 20 H36 M20 4 Q11 20 20 36 M20 4 Q29 20 20 36 M7 12 H33 M7 28 H33',
  snake: 'M30 8 a4 4 0 1 0 -6 3 Q10 14 12 22 Q14 28 26 26 Q34 25 32 32 Q30 37 14 35 L8 34 M31 7 a0.8 0.8 0 1 0 0.01 0',
  wolf: 'M6 6 L13 15 H27 L34 6 L33 22 L27 32 L20 36 L13 32 L7 22 Z M14 21 L17 23 M26 21 L23 23 M18 30 H22',
  owl: 'M8 8 L13 12 H27 L32 8 V28 Q32 36 20 36 Q8 36 8 28 Z M15 18 a4 4 0 1 0 0.01 0 M25 18 a4 4 0 1 0 0.01 0 M18 25 L20 28 L22 25',
  anchor: 'M20 10 a3 3 0 1 0 0.01 0 M20 10 V35 M13 17 H27 M5 24 Q7 35 20 35 Q33 35 35 24 M5 24 L3 28 M5 24 L9 27 M35 24 L37 28 M35 24 L31 27',
  sword: 'M28 4 H36 V12 L15 33 L11 29 Z M9 24 L20 35 M6 31 L3 34 L6 37 L9 34'
};
export const CHARGE_NAMES = { chart: 'График', search: 'Лупа', gear: 'Шестерня', code: 'Код', coin: 'Рубль', megaphone: 'Рупор', scales: 'Весы', tower: 'Вышка связи', briefcase: 'Портфель', bag: 'Пакет', headset: 'Гарнитура', people: 'Команда', lock: 'Замок', crown: 'Корона', star: 'Звезда', bolt: 'Молния', cup: 'Кофе', book: 'Книга', note: 'Нота', plane: 'Самолёт', ball: 'Мяч', rocket: 'Ракета', flame: 'Пламя', tree: 'Ель', heart: 'Сердце', dice: 'Кубик', film: 'Кино', pizza: 'Пицца', medal: 'Медаль', globe: 'Глобус', snake: 'Питон', wolf: 'Волк', owl: 'Сова', anchor: 'Якорь', sword: 'Меч' };

export const TOP_NAMES = { none: 'Без навершия', crown: 'Корона', laurel: 'Лавры', wings: 'Крылья', stars: 'Звёзды', helm: 'Шлем' };

// Направления и интересы → фигура для автогерба
const AREA_CHARGE = { 'Кофейный клуб': 'cup', 'Обеденный отряд': 'pizza', 'Соседи по этажу': 'tower', 'Проектная тусовка': 'rocket', 'Спорт и движ': 'medal',
  'Настолки и игры': 'dice', 'Учимся вместе': 'book', 'Мемы и болтовня': 'wolf', 'После работы': 'owl', 'Добрые дела': 'heart', 'Просто свои': 'people' };
const INTEREST_CHARGE = { 'Кофе': 'cup', 'Обеды': 'pizza', 'Настолки': 'dice', 'Спорт': 'medal', 'Бег': 'bolt', 'Йога': 'flame', 'Футбол': 'ball', 'Кино': 'film', 'Музыка': 'note',
  'Книги': 'book', 'Путешествия': 'plane', 'Кулинария': 'pizza', 'Викторины': 'owl', 'Excel': 'chart', 'SQL': 'chart', 'Python': 'snake', 'Data Science': 'chart', 'Agile': 'rocket',
  'Продукты': 'rocket', 'Английский': 'globe', 'Волонтёрство': 'heart', 'Мемы': 'wolf' };
const HEX_TINCTURE = { '#E5484D': 'red', '#2563C9': 'blue', '#1F7A3A': 'green', '#8B5CF6': 'purple', '#F97316': 'orange' };

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (arr, n) => arr[n % arr.length];
const metal = (t) => t === 'gold' || t === 'silver';

// Автогерб: детерминированно из id и профиля банды. Правило геральдики «металл на цвете» соблюдаем: поле — цвет, фигура — металл
export function autoCrest(g) {
  const h = hash(`${g.id}:${g.name}`);
  const colorT = HEX_TINCTURE[g.color] || pick(['red', 'blue', 'green', 'purple', 'black', 'orange', 'sky'], h);
  const charge = AREA_CHARGE[g.area] || (g.interests && g.interests.map((i) => INTEREST_CHARGE[i]).find(Boolean)) || pick(Object.keys(C), h >> 3);
  const met = pick(['gold', 'silver'], h >> 5);
  return { shape: pick(['heater', 'heater', 'french', 'kite', 'badge', 'swiss'], h >> 7), div: pick(['plain', 'chief', 'pale', 'fess', 'bend', 'quarterly', 'chevron', 'bordure', 'plain'], h >> 11),
    c1: colorT, c2: pick(['black', 'blue', 'red', 'green', 'purple'].filter((x) => x !== colorT), h >> 13), charge, cc: met, top: pick(['none', 'none', 'crown', 'stars', 'laurel'], h >> 17), motto: true };
}
// Подобрать по тому, что объединяет, и интересам, остальное — случайно
export function randomCrest(g, keepCharge = false) {
  const r = () => Math.floor(Math.random() * 1e9);
  const colors = Object.keys(TINCTURES).filter((t) => !metal(t));
  const c1 = pick(colors, r());
  const charges = [AREA_CHARGE[g.area], ...((g.interests || []).map((i) => INTEREST_CHARGE[i]))].filter(Boolean);
  return { shape: pick(Object.keys(SHAPES), r()), div: pick(Object.keys(DIVS), r()), c1, c2: pick([...colors.filter((x) => x !== c1), 'gold', 'silver'], r()),
    charge: keepCharge && g.crest ? g.crest.charge : charges.length && Math.random() < 0.8 ? pick(charges, r()) : pick(Object.keys(C), r()),
    cc: pick(['gold', 'silver', 'gold'], r()), top: pick(Object.keys(TOP_NAMES), r()), motto: true };
}
export const crestOf = (g) => ({ ...autoCrest(g), ...(g.crest || {}) });

// ----- Объёмный герб («пластилин») -----
// Щит, деления и цвета остаются векторными — любая из комбинаций собирается на лету; объём дают градиенты и фаска.
// Фигуры и навершия — вылепленные картинки из атласов /art/crest/*.webp. Фигура серая и красится фильтром в цвет cc.
const EM = { file: '/art/crest/em.webp', cell: 160, cols: 6, rows: 6,
  keys: ['chart', 'search', 'gear', 'code', 'coin', 'megaphone', 'scales', 'tower', 'briefcase', 'bag', 'headset', 'people', 'lock', 'crown', 'star', 'bolt', 'cup', 'book',
    'note', 'plane', 'ball', 'rocket', 'flame', 'tree', 'heart', 'dice', 'film', 'pizza', 'medal', 'globe', 'snake', 'wolf', 'owl', 'anchor', 'sword'] };
// Навершия и лента: [x, y, w, h в атласе, x, y, w, h на гербе]
const TOPS = { file: '/art/crest/tops.webp', w: 960, h: 640,
  crown: [0, 0, 320, 320, 25.5, -29.5, 49, 49], stars: [320, 0, 320, 320, 21.5, -32, 57, 57], helm: [640, 0, 320, 320, 27.5, -28.5, 45, 45],
  wings: [0, 320, 320, 320, -13.5, -25.5, 127, 127], laurel: [320, 320, 320, 320, -13.5, 2.5, 127, 127], ribbon: [640, 320, 320, 320, 0, 67, 100, 100] };
const atlasImg = (a, [sx, sy, sw, sh, x, y, w, h], extra = '') =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${sx} ${sy} ${sw} ${sh}" ${extra}><image href="${a.file}" width="${a.w}" height="${a.h}"/></svg>`;
const mix = (hex, to, k) => { const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (sh) => Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k);
  return '#' + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join(''); };

// size — px; full — с навершием и лентой; motto — текст на ленте
export function crestSvg(crestIn, { size = 40, full = false, motto = '' } = {}) {
  const c = crestIn;
  const shape = SHAPES[c.shape] || SHAPES.heater;
  const [f1, f1d] = TINCTURES[c.c1] || TINCTURES.blue;
  const [f2] = TINCTURES[c.c2] || TINCTURES.gold;
  const div = (DIVS[c.div] || DIVS.plain)(f2).replace('SHAPE', shape);
  const ei = Math.max(0, EM.keys.indexOf(c.charge in C ? c.charge : 'star'));
  const cell = [(ei % EM.cols) * EM.cell, Math.floor(ei / EM.cols) * EM.cell, EM.cell, EM.cell, 22, 29, 56, 56];
  const charge = atlasImg({ file: EM.file, w: EM.cols * EM.cell, h: EM.rows * EM.cell }, cell);
  const showTop = full && c.top && c.top !== 'none' && TOPS[c.top];
  const hasRibbon = full && c.motto !== false && !!motto;
  const ribbon = hasRibbon ? `${atlasImg(TOPS, TOPS.ribbon)}
      <text x="50" y="113.2" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="${Math.min(8, 84 / Math.max(6, String(motto).length))}" fill="#3A2F1E">${String(motto).replace(/[&<>"]/g, '').slice(0, 22)}</text>` : '';
  const top0 = showTop && !['wings', 'laurel'].includes(c.top) ? -30 : 0, bottom = hasRibbon ? 137 : c.top === 'laurel' && showTop ? 124 : 120;
  const vb = full ? `-14 ${top0} 128 ${bottom - top0}` : '5 4 90 114';
  const w = size, h = Math.round(size * (full ? (bottom - top0) / 128 : 114 / 90));
  const back = showTop && ['wings', 'laurel'].includes(c.top);
  const side = mix(f1d, '#000000', 0.25);
  crestDefs();
  const sk = SHAPES[c.shape] ? c.shape : 'heater', tk = TINCTURES[c.cc] ? c.cc : 'gold';
  return `<svg class="crest" width="${w}" height="${h}" viewBox="${vb}" aria-hidden="true">
    ${back ? atlasImg(TOPS, TOPS[c.top]) : ''}
    <path d="${shape}" fill="${side}" transform="translate(0 4)"/>
    <g clip-path="url(#crc-${sk})"><rect x="-10" y="-10" width="130" height="140" fill="${f1}"/>${div}
      <rect x="-10" y="-10" width="130" height="140" fill="url(#crg)"/><rect x="-10" y="-10" width="130" height="140" fill="url(#crh)"/>
      <path d="${shape}" fill="none" stroke="url(#crb)" stroke-width="${size < 50 ? 9 : 7}" stroke-linejoin="round"/>
      <g filter="url(#crt-${tk})">${charge}</g></g>
    ${showTop && !back ? atlasImg(TOPS, TOPS[c.top]) : ''}
    ${ribbon}
  </svg>`;
}

// Общие для всех гербов градиенты, обрезки по форме щита и фильтры покраски фигуры — один раз на страницу, вне #root
function crestDefs() {
  if (typeof document === 'undefined' || document.getElementById('crest-defs')) return;
  const filt = (k, [cc, ccd]) => `<filter id="crt-${k}" x="-15%" y="-15%" width="130%" height="140%" color-interpolation-filters="sRGB">
      <feFlood flood-color="${cc}"/><feComposite in2="SourceAlpha" operator="in" result="flat"/>
      <feComponentTransfer in="SourceGraphic" result="sh"><feFuncR type="linear" slope="1.4"/><feFuncG type="linear" slope="1.4"/><feFuncB type="linear" slope="1.4"/></feComponentTransfer>
      <feBlend in="sh" in2="flat" mode="multiply" result="m"/>
      <feComponentTransfer in="SourceGraphic" result="hi"><feFuncR type="linear" slope="2.6" intercept="-1.9"/><feFuncG type="linear" slope="2.6" intercept="-1.9"/><feFuncB type="linear" slope="2.6" intercept="-1.9"/></feComponentTransfer>
      <feBlend in="hi" in2="m" mode="screen" result="lit"/><feComposite in="lit" in2="SourceAlpha" operator="in" result="fig"/>
      <feFlood flood-color="${mix(ccd, '#000000', 0.5)}" flood-opacity=".55"/><feComposite in2="SourceAlpha" operator="in"/><feOffset dx="1.2" dy="2.4" result="drop"/>
      <feMerge><feMergeNode in="drop"/><feMergeNode in="fig"/></feMerge></filter>`;
  const el = document.createElement('div');
  el.innerHTML = `<svg id="crest-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    ${Object.entries(SHAPES).map(([k, d]) => `<clipPath id="crc-${k}"><path d="${d}"/></clipPath>`).join('')}
    <linearGradient id="crg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
    <linearGradient id="crb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".4" stop-color="#fff" stop-opacity=".12"/><stop offset=".6" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
    <radialGradient id="crh" cx=".3" cy=".2" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    ${Object.entries(TINCTURES).map(([k, t]) => filt(k, t)).join('')}
  </defs></svg>`;
  document.body.appendChild(el.firstChild);
}

export const CREST_PARTS = { shape: Object.keys(SHAPES), div: Object.keys(DIVS), tincture: Object.keys(TINCTURES), charge: Object.keys(C), top: Object.keys(TOP_NAMES) };
