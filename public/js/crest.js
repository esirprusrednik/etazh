// Гербы банд: векторный щит из частей — форма, деление поля, два цвета, фигура, навершие и лента с девизом.
// Ключи частей совпадают с CREST в server/catalog.js — сервер проверяет, что пришли только они.
// Если банда герб не собирала, он собирается сам из направления, интересов и id — у каждой банды свой.

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
const AREA_CHARGE = { 'Аналитика и данные': 'chart', 'Бизнес-анализ': 'search', 'ИТ и разработка': 'code', 'Сеть и техника': 'tower', 'Продукт и диджитал': 'rocket',
  'Маркетинг и бренд': 'megaphone', 'Продажи B2C': 'bag', 'Продажи B2B': 'briefcase', 'Клиентский сервис и КЦ': 'headset', 'Розница и салоны': 'bag', 'Финансы': 'coin',
  'Юристы': 'scales', 'HR и обучение': 'people', 'Закупки': 'briefcase', 'Безопасность': 'lock', 'PR и коммуникации': 'megaphone', 'Стратегия': 'crown', 'Администрация и АХО': 'gear', 'По интересам': 'star' };
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
// Подобрать по направлению и интересам, остальное — случайно
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

let uidN = 0;
function topLayer(top, gold) {
  const [g, gd] = TINCTURES.gold;
  if (top === 'crown') return `<path d="M30 9 L27 -6 L38 2 L50 -10 L62 2 L73 -6 L70 9 Z" fill="${g}" stroke="${gd}" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="-10" r="2.6" fill="#D7263D"/><circle cx="27" cy="-6" r="2" fill="${g}" stroke="${gd}"/><circle cx="73" cy="-6" r="2" fill="${g}" stroke="${gd}"/>`;
  if (top === 'stars') return [[30, 1, 4], [50, -6, 6], [70, 1, 4]].map(([x, y, r]) => `<path transform="translate(${x - 20 * r / 10} ${y - 20 * r / 10}) scale(${r / 10})" d="${C.star}" fill="${g}" stroke="${gd}" stroke-width="2.5"/>`).join('');
  if (top === 'helm') return `<path d="M34 10 Q34 -12 50 -12 Q66 -12 66 10 Z" fill="#C9D1DD" stroke="#6B7689" stroke-width="2"/><path d="M38 0 H62 M40 4 H60" stroke="#6B7689" stroke-width="2.2"/><path d="M50 -12 Q58 -24 70 -18 Q60 -16 56 -10" fill="#D7263D"/>`;
  if (top === 'wings') {
    const w = (f) => `<path transform="${f ? 'translate(100 0) scale(-1 1)' : ''}" d="M10 30 Q-6 22 -8 4 Q2 12 6 10 Q-2 2 -2 -6 Q8 4 12 4 Q8 -4 10 -10 Q16 2 18 12 Z" fill="#F4F6FA" stroke="#9AA3B5" stroke-width="1.6" stroke-linejoin="round"/>`;
    return w(false) + w(true);
  }
  if (top === 'laurel') {
    const leaf = (x, y, a) => `<ellipse cx="${x}" cy="${y}" rx="6" ry="2.6" transform="rotate(${a} ${x} ${y})" fill="#3E9B58" stroke="#22663A" stroke-width=".8"/>`;
    const side = (f) => [[8, 96, -60], [3, 82, -75], [1, 66, -88], [2, 50, -100], [5, 34, -112], [10, 20, -125]].map(([x, y, a]) => leaf(f ? 100 - x : x, y, f ? 180 - a : a)).join('');
    return side(false) + side(true);
  }
  return '';
}

// size — px; full — с навершием и лентой; motto — текст на ленте
export function crestSvg(crestIn, { size = 40, full = false, motto = '' } = {}) {
  const c = crestIn;
  const u = 'cr' + (++uidN);
  const shape = SHAPES[c.shape] || SHAPES.heater;
  const [f1, f1d] = TINCTURES[c.c1] || TINCTURES.blue;
  const [f2] = TINCTURES[c.c2] || TINCTURES.gold;
  const [cc, ccd] = TINCTURES[c.cc] || TINCTURES.gold;
  const div = (DIVS[c.div] || DIVS.plain)(f2).replace('SHAPE', shape);
  const icon = C[c.charge] || C.star;
  const fill = ['star', 'bolt', 'flame', 'heart', 'plane', 'crown'].includes(c.charge) ? cc : 'none';
  const charge = `<g transform="translate(26 36) scale(1.2)" stroke-linecap="round" stroke-linejoin="round">
      <path d="${icon}" fill="none" stroke="${ccd}" stroke-width="6.4" opacity=".85"/><path d="${icon}" fill="${fill}" stroke="${cc}" stroke-width="3.4"/></g>`;
  const showTop = full && c.top && c.top !== 'none';
  const hasRibbon = full && c.motto !== false && !!motto;
  const ribbon = hasRibbon ? `<g transform="translate(0 12)"><path d="M2 104 L14 98 H86 L98 104 L90 110 L98 116 H78 L74 112 H26 L22 116 H2 L10 110 Z" fill="${f1d}" stroke="#0D1220" stroke-opacity=".35" stroke-width="1"/>
      <path d="M14 98 H86 L84 112 H16 Z" fill="${TINCTURES.silver[0]}" stroke="#9AA3B5" stroke-width="1"/>
      <text x="50" y="108.4" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="${Math.min(8.5, 100 / Math.max(6, String(motto).length))}" fill="#1E2433">${String(motto).replace(/[&<>"]/g, '').slice(0, 22)}</text></g>` : '';
  const top0 = showTop ? -26 : 0, bottom = hasRibbon ? 130 : 118;
  const vb = full ? `-12 ${top0} 124 ${bottom - top0}` : '6 3 88 112';
  const w = size, h = Math.round(size * (full ? (bottom - top0) / 124 : 112 / 88));
  return `<svg class="crest" width="${w}" height="${h}" viewBox="${vb}" aria-hidden="true">
    <defs><clipPath id="${u}c"><path d="${shape}"/></clipPath>
      <linearGradient id="${u}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>
    ${showTop && c.top === 'wings' ? topLayer('wings') : ''}
    ${showTop && c.top === 'laurel' ? topLayer('laurel') : ''}
    <g clip-path="url(#${u}c)"><rect x="-10" y="-10" width="130" height="140" fill="${f1}"/>${div}${charge}<rect x="-10" y="-10" width="130" height="140" fill="url(#${u}g)"/></g>
    <path d="${shape}" fill="none" stroke="#0D1220" stroke-opacity=".55" stroke-width="${size < 50 ? 4 : 3}" stroke-linejoin="round"/>
    <path d="${shape}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2" transform="translate(50 58) scale(.94) translate(-50 -58)"/>
    ${showTop && !['wings', 'laurel'].includes(c.top) ? topLayer(c.top) : ''}
    ${ribbon}
  </svg>`;
}

export const CREST_PARTS = { shape: Object.keys(SHAPES), div: Object.keys(DIVS), tincture: Object.keys(TINCTURES), charge: Object.keys(C), top: Object.keys(TOP_NAMES) };
