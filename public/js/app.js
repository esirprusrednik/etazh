// Клиент «Этажа»: без фреймворков, рендер строками + делегирование событий (CSP запрещает inline-обработчики).
import { officeSvg } from './building.js';

const $ = (sel) => document.querySelector(sel);
const root = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem('etazh:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('etazh:' + k, JSON.stringify(v)); } catch {} }
};

const S = {
  me: null, cat: null, vapidKey: null, domains: ['mts.ru'],
  state: null, gang: null, events: null, shop: null,
  tab: 'near', activeGang: store.get('activeGang', null), people: null, chats: null, chatGang: false,
  sheet: null, compose: null, signal: null,
  onb: { step: 'email', email: '', error: '', devLink: null, devCode: null, nicks: [] },
  error: '', busy: false,
  seenChat: store.get('seenChat', 0), seenFeed: store.get('seenFeed', 0),
  fx: null, gx: null, thanksTo: null, lunchTime: '13:00', sec: new Set(),
  crew: null, dm: null, dmView: null,
  battles: [], battle: null, bv: null, bFresh: new Set(), bFreshUntil: 0, bShout: null
};

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch {}
  if (res.status === 401) { S.me = null; render(); }
  if (!res.ok) throw new Error(json.error || 'Сервер не ответил. Проверь интернет.');
  return json;
}
const get = (u) => api('GET', u);
const post = (u, b = {}) => api('POST', u, b);

let toastTimer;
function toast(text) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------- Аватар ----------
const HOODIE = { red: '#E5484D', blue: '#2563C9', green: '#1F7A3A', violet: '#8B5CF6', navy: '#34405F', black: '#23252B', white: '#EEF1F6', beige: '#D8C3A5', yellow: '#F4C430', pink: '#F08BB4', orange: '#F28C28', khaki: '#7D7A4F', burgundy: '#7A1F34', grey: '#8A919E' };
const FRAMES = { fr_gold: '#FFC93C', fr_neon: '#22D3EE', fr_fire: '#F97316' };
// Аватар: слои сзади (длинные волосы, хвост, афро) → худи → лицо → передние пряди и аксессуары
// Лицо строится из параметров: ширина лба, скулы, ширина челюсти, подбородок, верх и низ.
// М — шире челюсть и квадратнее подбородок; Ж — уже челюсть, мягкий острый подбородок, выше скулы
const FACE_P = {
  oval: { W: 19.5, C: 19.5, J: 14.5, K: 6, top: 24, bot: 66 },
  round: { W: 21.5, C: 21.5, J: 18, K: 9.5, top: 24.5, bot: 67 },
  square: { W: 20.5, C: 20.5, J: 19.5, K: 11, top: 24, bot: 66 },
  long: { W: 16.5, C: 16.5, J: 13, K: 6, top: 20, bot: 68.5 },
  heart: { W: 20.5, C: 20, J: 11.5, K: 4, top: 24, bot: 67 }
};
function faceGeo(type, sex) {
  const p = { ...(FACE_P[type] || FACE_P.oval) };
  if (sex === 'f') { p.C = p.W + 0.3; p.J = Math.max(10.5, p.J - 1.2); p.K = Math.max(4, p.K - 0.6); p.bot -= 0.6; p.yj = 57.4; }
  else { p.C = p.W; p.J = Math.min(p.W - 1.2, p.J + 1.6); p.K += 2; p.bot += 0.4; p.yj = 57.6; }
  const { W, C, J, K, top, bot, yj } = p, y1 = 41;
  const head = `M${50 - W} ${y1} C${50 - W} ${top + 5} ${50 - W * 0.6} ${top} 50 ${top} C${50 + W * 0.6} ${top} ${50 + W} ${top + 5} ${50 + W} ${y1}`;
  // М: челюсть шире и подбородок крупнее, но линии плавные; Ж: уже челюсть, мягкий узкий подбородок
  const d = sex === 'f'
    ? head + ` C${50 + C} ${y1 + 7} ${50 + J + 1.2} ${yj - 4} ${50 + J} ${yj} C${50 + J - 1} ${bot - 3} ${50 + K + 3} ${bot} 50 ${bot}`
      + ` C${50 - K - 3} ${bot} ${50 - J + 1} ${bot - 3} ${50 - J} ${yj} C${50 - J - 1.2} ${yj - 4} ${50 - C} ${y1 + 7} ${50 - W} ${y1} Z`
    : head + ` C${50 + W + 0.2} ${y1 + 8} ${50 + J + 0.8} ${yj - 5} ${50 + J} ${yj} C${50 + J - 1} ${bot - 2} ${50 + K + 4} ${bot + 0.4} 50 ${bot + 0.4}`
      + ` C${50 - K - 4} ${bot + 0.4} ${50 - J + 1} ${bot - 2} ${50 - J} ${yj} C${50 - J - 0.8} ${yj - 5} ${50 - W - 0.2} ${y1 + 8} ${50 - W} ${y1} Z`;
  return { ...p, d };
}
// Затемнить или осветлить цвет #RRGGBB (k < 0 — темнее)
function shade(hex, k) {
  const n = parseInt(String(hex).slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('');
}
// Причёски. Каждая — задняя часть (за головой и плечами) и передняя (чёлка, пряди у лица).
// Рисуются под лицо шириной 19.5 и масштабируются по ширине выбранного лица.
// Пряди у лица (locks) закрывают уши и обрамляют лицо — так женские причёски не выглядят «шлемом».
const hd = (h) => shade(h, -0.22), hl = (h) => shade(h, 0.28);
const locks = (h, y = 62, w = 4) => `<path d="M31.5 36 Q26.6 47 28.6 ${y} Q30.4 ${y + 1.6} ${28.6 + w} ${y - 1.4} Q30.6 49 34.4 38 Z M68.5 36 Q73.4 47 71.4 ${y} Q69.6 ${y + 1.6} ${71.4 - w} ${y - 1.4} Q69.4 49 65.6 38 Z" fill="${h}"/>`
  + `<path d="M30.8 42 Q29.4 50 30.2 ${y - 3} M69.2 42 Q70.6 50 69.8 ${y - 3}" fill="none" stroke="${hd(h)}" stroke-width=".8" stroke-linecap="round" opacity=".7"/>`;
const strands = (h, d) => `<path d="${d}" fill="none" stroke="${hd(h)}" stroke-width=".9" stroke-linecap="round" opacity=".75"/>`;
const shineOn = (h, d) => `<path d="${d}" fill="none" stroke="${hl(h)}" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>`;
const CROWN = 'M30.5 42 Q29.6 22 50 20.5 Q70.4 22 69.5 42';
const HAIR_BACK = {
  long: (h) => `<path d="M27.4 46 Q25.4 19.6 50 18.6 Q74.6 19.6 72.6 46 L75.4 88 Q50 95 24.6 88 Z" fill="${h}"/>${strands(h, 'M30 60 L28.6 84 M70 60 L71.4 84')}`,
  waves: (h) => `<path d="M27 46 Q24.6 19.4 50 18.4 Q75.4 19.4 73 46 Q77.4 56 73.2 64 Q78 72 74.4 82 L76 92 Q50 99 24 92 L25.6 82 Q22 72 26.8 64 Q22.6 56 27 46 Z" fill="${h}"/>${strands(h, 'M27 64 Q30 70 27 78 M73 64 Q70 70 73 78')}`,
  bangs: (h) => `<path d="M27.4 46 Q25.4 19.6 50 18.6 Q74.6 19.6 72.6 46 L75 86 Q50 93 25 86 Z" fill="${h}"/>`,
  lob: (h) => `<path d="M27.4 46 Q25.4 19.6 50 18.6 Q74.6 19.6 72.6 46 L74.6 70 Q68 74.6 62.6 70.4 L37.4 70.4 Q32 74.6 25.4 70 Z" fill="${h}"/>`,
  bob: (h) => `<path d="M27 48 Q25 20 50 19.5 Q75 20 73 48 L74 63 Q68 66.4 63 62 L37 62 Q32 66.4 26 63 Z" fill="${h}"/>`,
  tail: (h) => `<path d="M66 30 Q80 30 78 46 Q77 58 72 66 Q74 54 71 44 Q69 36 64 34 Z" fill="${h}"/><rect x="64.6" y="29.6" width="4" height="4.4" rx="1.4" fill="#E5484D" transform="rotate(20 66.6 31.8)"/>`,
  ponytail: (h) => `<path d="M58 17.6 Q74 10 81 22 Q86 34 79 50 Q81 36 75 28 Q70 22 60 22 Z" fill="${h}"/>${strands(h, 'M70 18 Q78 24 79 36')}<ellipse cx="60" cy="18.8" rx="2.6" ry="2" fill="#7C4DFF"/>`,
  braid: (h) => `<g fill="${h}" stroke="${hd(h)}" stroke-width=".7">${[[67, 50], [68.4, 56], [69.4, 62], [70, 68], [70.4, 74], [70.6, 80]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="4" ry="3.6"/>`).join('')}</g><path d="M68.6 84 L72.6 84 L71.4 89 L69.6 89 Z" fill="${h}"/><rect x="68.4" y="82.6" width="4.6" height="2" rx="1" fill="#FF6FA8"/>`,
  buns: (h) => `<circle cx="34.6" cy="19" r="7.4" fill="${h}"/><circle cx="65.4" cy="19" r="7.4" fill="${h}"/>${strands(h, 'M30 17 Q34 13 38 16 M62 16 Q66 13 70 17')}`,
  bun: (h) => `<circle cx="50" cy="15.4" r="8.4" fill="${h}"/>${strands(h, 'M44 14 Q50 9 56 14')}`,
  manbun: (h) => `<circle cx="50" cy="16.6" r="6" fill="${h}"/>${strands(h, 'M46 15.6 Q50 12 54 15.6')}`,
  anime: (h) => `<path d="M24 44 L18 52 L26 50 L22 62 L30 54 L28 66 L34 54 Z M76 44 L82 52 L74 50 L78 62 L70 54 L72 66 L66 54 Z" fill="${h}"/>`,
  afro: (h) => `<g fill="${h}"><circle cx="50" cy="36" r="24"/>${[[28, 30], [33, 18], [44, 11], [56, 11], [67, 18], [72, 30], [74, 43], [26, 43]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10"/>`).join('')}</g>`
};
const HAIR_FRONT = {
  short: (h) => `<path d="M30.4 44 Q28.6 23.6 41 20.8 Q50 18.4 59 20.8 Q71.4 23.6 69.6 44 Q68.6 35 64 32 Q57 28.6 50 30.4 Q42.6 28.6 36.4 32 Q31.6 35.4 30.4 44 Z" fill="${h}"/>${strands(h, 'M42 22 Q45 26 44 30 M52 20.4 Q55 24 56 29')}${shineOn(h, 'M38 25 Q44 21.6 51 22')}`,
  undercut: (h) => `<path d="M30.4 44 Q29.6 33 33 31 L34.6 40.4 Z M69.6 44 Q70.4 33 67 31 L65.4 40.4 Z" fill="${h}" opacity=".45"/><path d="M32.6 33.6 Q31.4 17.6 50 15.6 Q67 15.4 69.6 26.6 Q70.6 31.6 66.6 33.4 Q61 25.6 51 27.6 Q41 28.6 32.6 33.6 Z" fill="${h}"/>${strands(h, 'M40 20 Q50 18 60 21 M38 25 Q50 22 63 25')}${shineOn(h, 'M42 19.6 Q50 17.6 57 18.6')}`,
  quiff: (h) => `<path d="M30.4 45 Q29.4 34 33 31 L35 41 Z M69.6 45 Q70.6 34 67 31 L65 41 Z" fill="${h}" opacity=".55"/><path d="M32 35.6 Q29.6 22 39.6 16.6 Q47.6 8.6 60 12.6 Q70.6 16.6 69 30 Q66 25.6 60 25.6 Q52 22.6 46 26.6 Q38 27.6 32 35.6 Z" fill="${h}"/>${strands(h, 'M42 15 Q52 10 62 14 M38 22 Q50 15 64 19')}${shineOn(h, 'M44 13.6 Q52 10.6 58 12.6')}`,
  buzz: (h) => `<path d="M30.6 41 Q30 22.4 50 21.6 Q70 22.4 69.4 41 Q66.4 30.4 50 29.2 Q33.6 30.4 30.6 41 Z" fill="${h}" opacity=".62"/>`,
  slick: (h) => `<path d="M30.2 42 Q29 21.6 50 19.6 Q71 21.6 69.8 42 Q68 30 62 27 Q55.4 24.6 50 25.6 Q44.6 24.6 38 27 Q32 30 30.2 42 Z" fill="${h}"/>${strands(h, 'M36 28 Q42 22 52 21.4 M40 30 Q48 25 60 24.4 M60 22 Q66 24 68 30')}${shineOn(h, 'M40 23.4 Q48 20.4 57 21.4')}`,
  crop: (h) => `<path d="M30.4 42 Q29.4 21.6 50 20.4 Q70.6 21.6 69.6 42 Q68.4 36.4 66.4 35.2 L64 35 L61 36.6 L58 35 L55 36.6 L52 35 L49 36.6 L46 35 L43 36.6 L40 35 L37 36.6 L34 35.2 Q31.6 36.4 30.4 42 Z" fill="${h}"/>${strands(h, 'M40 24 L41 34 M48 23 L48.6 34 M56 23.4 L56 34 M62 25 L61 34')}`,
  manbun: (h) => `<path d="M30.4 42 Q29.6 22 50 20.6 Q70.4 22 69.6 42 Q67 30.4 50 28.6 Q33 30.4 30.4 42 Z" fill="${h}"/>${strands(h, 'M36 30 Q44 23 50 21.6 M64 30 Q56 23 50 21.6')}`,
  side: (h) => `<path d="M30 47 Q26 20 53 20 Q74 21 70 44 Q61 28 43 34 Q35 37 30 47 Z" fill="${h}"/>${strands(h, 'M44 22 Q56 22 64 30')}${shineOn(h, 'M38 26 Q46 21.6 55 22')}`,
  mohawk: (h) => `<path d="M30.6 42 Q30 23 50 22 Q70 23 69.4 42 Q66 31 50 30 Q34 31 30.6 42 Z" fill="${h}" opacity=".35"/><path d="M44.5 33 Q43 13 50 6 Q57 13 55.5 33 Z" fill="${h}"/>`,
  // Женские: пробор и пряди, обрамляющие лицо
  long: (h) => `<path d="M30.2 46 Q28 21.6 50 20 Q72 21.6 69.8 46 Q67.4 32 56.6 29 Q52.4 28 50 31.4 Q47.6 28 43.4 29 Q32.6 32 30.2 46 Z" fill="${h}"/>${locks(h, 64)}${shineOn(h, 'M37 27 Q42 23 48 22.6')}`,
  waves: (h) => `<path d="M30.6 49 Q27.6 21.6 52 19.8 Q73 20.6 70 46 Q66.4 31 56 29.6 Q46 29.6 40 33.6 Q34 38 32.8 48 Z" fill="${h}"/><path d="M30.2 41 Q25.8 52 30.6 60 Q27.6 68 32.6 75 L35.6 73 Q32.6 66 35 58.6 Q31.6 51 34 41 Z M69.8 41 Q74.2 52 69.4 60 Q72.4 68 67.4 75 L64.4 73 Q67.4 66 65 58.6 Q68.4 51 66 41 Z" fill="${h}"/>${shineOn(h, 'M40 26 Q48 21.6 58 23')}`,
  bangs: (h) => `<path d="M30.2 46 Q28.4 21 50 19.8 Q71.6 21 69.8 46 L68 41.6 Q59 43.8 50 43 Q41 43.8 32 41.6 Z" fill="${h}"/>${strands(h, 'M38 34 L37 41 M44 33 L43.6 42.4 M50 33 L50 42.6 M56 33 L56.4 42.4 M62 34 L63 41')}${locks(h, 60, 3.6)}`,
  lob: (h) => `<path d="M30.2 46 Q28 21.6 50 20 Q72 21.6 69.8 46 Q67.4 32 56.6 29 Q52.4 28 50 31.4 Q47.6 28 43.4 29 Q32.6 32 30.2 46 Z" fill="${h}"/>${locks(h, 66, 4.6)}`,
  bob: (h) => `<path d="M29 46 Q28 21 50 21 Q72 21 71 46 L67.4 37 Q61 35.4 57 30.6 Q50 37.4 33 37 Z" fill="${h}"/>${locks(h, 60, 4)}${shineOn(h, 'M36 27 Q42 23 49 22.6')}`,
  pixie: (h) => `<path d="M30 46 Q27 21.6 50 19.4 Q73 21 71 44 Q68 33 60 32 Q52 33 44 37.6 Q38 41 33.4 42 Q31 44 30 46 Z" fill="${h}"/><path d="M30.4 44 Q29 50 31.6 54 L33.4 45 Z M69.6 44 Q71 50 68.4 54 L66.6 45 Z" fill="${h}"/>${strands(h, 'M44 22 Q58 22 66 32 M40 30 Q50 26 58 30')}${shineOn(h, 'M40 24 Q48 20.6 56 21.6')}`,
  ponytail: (h) => `<path d="M30.6 42 Q30 22 50 20.6 Q70 22 69.4 42 Q66 30.6 50 29 Q34 30.6 30.6 42 Z" fill="${h}"/>${strands(h, 'M36 32 Q44 24 56 22 M42 31 Q50 25 62 25')}${shineOn(h, 'M40 25 Q47 21.6 55 22')}`,
  braid: (h) => `<path d="M30.2 46 Q28 21.6 50 20 Q72 21.6 69.8 46 Q66 32 54 29.6 Q42 30.4 34 36 Q31 40 30.2 46 Z" fill="${h}"/><path d="M68.5 36 Q72 42 68 50 L65 48 Q68 42 65.6 38 Z" fill="${h}"/>${strands(h, 'M40 24 Q54 22 64 30')}`,
  buns: (h) => `<path d="M30.4 44 Q28.6 21.6 50 20.6 Q71.4 21.6 69.6 44 Q67 31 55 29.4 Q51.6 29.4 50 32 Q48.4 29.4 45 29.4 Q33 31 30.4 44 Z" fill="${h}"/>${locks(h, 52, 2.6)}`,
  tail: (h) => `<path d="M30.4 44 Q28.6 23.6 41 20.8 Q50 18.4 59 20.8 Q71.4 23.6 69.6 44 Q67 32 55 29.6 Q43 30 30.4 44 Z" fill="${h}"/>${strands(h, 'M40 24 Q52 21.4 62 27')}`,
  bun: (h) => `<path d="M30.4 43 Q29 22.4 50 21.4 Q71 22.4 69.6 43 Q66.4 30 50 28.6 Q33.6 30 30.4 43 Z" fill="${h}"/>${strands(h, 'M36 31 Q44 24 50 22.6 M64 31 Q56 24 50 22.6')}`,
  curly: (h) => `<g fill="${h}"><circle cx="33" cy="38" r="8"/><circle cx="40" cy="29" r="8"/><circle cx="50" cy="25" r="8.5"/><circle cx="60" cy="29" r="8"/><circle cx="67" cy="38" r="8"/></g><g fill="none" stroke="${hd(h)}" stroke-width=".9" opacity=".7"><circle cx="40" cy="29" r="3.4"/><circle cx="60" cy="29" r="3.4"/><circle cx="50" cy="24" r="3.6"/></g>`,
  afro: (h) => `<path d="M29 42 Q29 22 50 22 Q71 22 71 42 Q63 31 50 32 Q37 31 29 42 Z" fill="${h}"/>`,
  anime: (h) => `<path d="M28.6 50 L30 36 L24 32 L32 28 L28 18 L38 22 L40 10 L46 19 L52 6 L56 18 L64 10 L64 22 L74 18 L70 28 L78 32 L70 36 L71.4 50 Q68 36 62 34 L60 40 L56 33 L52 41 L48 33 L43 41 L40 34 Q32 37 28.6 50 Z" fill="${h}"/>${shineOn(h, 'M42 18 L48 14 M58 16 L62 13')}`,
  bald: () => '<path d="M41 29 Q47 26 52 27" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2.4" stroke-linecap="round"/>'
};
// Порядок в конструкторе: сначала то, что носят «М» или «Ж», но доступны все
const HAIR_ORDER = {
  m: ['short', 'undercut', 'quiff', 'crop', 'slick', 'buzz', 'side', 'curly', 'manbun', 'mohawk', 'afro', 'bald', 'tail', 'long', 'bob', 'pixie'],
  f: ['long', 'waves', 'bangs', 'lob', 'bob', 'pixie', 'ponytail', 'braid', 'buns', 'bun', 'tail', 'curly', 'afro', 'side', 'short', 'buzz']
};
// Какие причёски прячутся под шапкой целиком (макушка), а какие торчат из-под неё прядями
const HAIR_TALL = ['bun', 'afro', 'manbun', 'buns', 'ponytail', 'quiff', 'mohawk', 'anime'];
const HAIR_LONG = ['long', 'waves', 'bangs', 'lob', 'bob', 'braid', 'curly', 'afro'];
// Рот — нарисованные губы, без «смайликовых» линий. lip — цвет губ, line — линия смыкания
const lipsPath = (yl, yr, mid, low, top = 0.9) => `M44 ${yl} Q46.6 ${mid - top - 0.6} 48.6 ${mid - top} Q50 ${mid - top + 0.5} 51.4 ${mid - top} Q53.4 ${mid - top - 0.6} 56 ${yr} Q53.6 ${low} 50 ${low} Q46.4 ${low} 44 ${yl} Z`;
const MOUTHS = {
  smile: (lip, line) => `<path d="${lipsPath(55.4, 55.4, 56.4, 60.4)}" fill="${lip}"/><path d="M44 55.4 Q50 59 56 55.4" fill="none" stroke="${line}" stroke-width="1.1" stroke-linecap="round"/><path d="M47.6 58.8 Q50 59.6 52.4 58.8" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8" stroke-linecap="round"/>`,
  grin: (lip) => `<path d="M43.6 55 Q50 54.4 56.4 55 Q55.2 63.4 50 63.6 Q44.8 63.4 43.6 55 Z" fill="#6A2430" stroke="${lip}" stroke-width="1.6" stroke-linejoin="round"/><path d="M44.8 55.6 Q50 55.2 55.2 55.6 L54.6 57.6 Q50 58 45.4 57.6 Z" fill="#fff"/><path d="M47 61.2 Q50 59.6 53 61.2 Q50 62.6 47 61.2 Z" fill="#E86B7A"/>`,
  smirk: (lip, line) => `<path d="${lipsPath(57.4, 54.6, 56.6, 59.8)}" fill="${lip}"/><path d="M44 57.4 Q50 58.4 56 54.6" fill="none" stroke="${line}" stroke-width="1.1" stroke-linecap="round"/>`,
  neutral: (lip, line) => `<path d="${lipsPath(57, 57, 57, 59.6, 1)}" fill="${lip}"/><path d="M44.2 57 Q50 57.6 55.8 57" fill="none" stroke="${line}" stroke-width="1" stroke-linecap="round"/>`,
  sad: (lip, line) => `<path d="${lipsPath(59.2, 59.2, 57.2, 60, 1.1)}" fill="${lip}"/><path d="M44 59.2 Q50 56.4 56 59.2" fill="none" stroke="${line}" stroke-width="1.1" stroke-linecap="round"/>`,
  wow: (lip) => `<ellipse cx="50" cy="58" rx="3.2" ry="3.8" fill="#6A2430" stroke="${lip}" stroke-width="1.5"/>`
};
// Как рот двигает усы и бороду: lL/lR — подъём уголков усов, low — где кончается нижняя губа
const MOUTH_GEO = {
  smile: { lL: 1.8, lR: 1.8, low: 60.6 }, grin: { lL: 2.6, lR: 2.6, low: 63.8 }, smirk: { lL: 0, lR: 2.4, low: 60 },
  neutral: { lL: 0, lR: 0, low: 59.8 }, sad: { lL: -2.2, lR: -2.2, low: 60.2 }, wow: { lL: -0.4, lR: -0.4, low: 62.4 }
};
// Усы — между носом и верхней губой: не наезжают на нос и не закрывают рот; уголки следуют за улыбкой
function mustachePath(m) {
  const yl = 57.4 - m.lL * 0.9, yr = 57.4 - m.lR * 0.9;
  return `M41.8 ${yl} Q45.4 54 50 55.2 Q54.6 54 58.2 ${yr} Q55.4 ${yr - 0.4} 52.6 56.8 Q51.2 56.4 50 57 Q48.8 56.4 47.4 56.8 Q44.6 ${yl - 0.4} 41.8 ${yl} Z`;
}
// Борода строится по форме выбранного лица: по линии челюсти и подбородка, с вырезом под рот
function beardPath(m, g) {
  const { W, J, K, bot, yj } = g;
  const cl = 61.8 - m.lL * 0.7, cr = 61.8 - m.lR * 0.7, low = m.low + 2.3;
  return `M${50 - W - 0.4} 47 C${50 - W - 0.2} ${yj - 3} ${50 - J - 1.6} ${yj - 1} ${50 - J - 1} ${yj + 1.4} C${50 - J} ${bot} ${50 - K - 5} ${bot + 4.6} 50 ${bot + 4.6}`
    + ` C${50 + K + 5} ${bot + 4.6} ${50 + J} ${bot} ${50 + J + 1} ${yj + 1.4} C${50 + J + 1.6} ${yj - 1} ${50 + W + 0.2} ${yj - 3} ${50 + W + 0.4} 47`
    + ` Q${50 + W - 3} ${cr - 1} 58.6 ${cr} Q55.4 ${low - 0.6} 50 ${low} Q44.6 ${low - 0.6} 41.4 ${cl} Q${50 - W + 3} ${cl - 1} ${50 - W - 0.4} 47 Z`;
}
function goateePath(m, g) {
  const low = m.low + 2.3;
  return `M44.6 ${low - 0.4} Q50 ${low + 0.6} 55.4 ${low - 0.4} Q56 ${g.bot + 1} 50 ${g.bot + 2.6} Q44 ${g.bot + 1} 44.6 ${low - 0.4} Z`;
}
// Борода (под ртом) и усы (поверх рта) — отдельно, чтобы рот их не перекрывал
const BEARDS = {
  none: () => ({ under: '', over: '' }),
  stubble: (b, m, mg, g) => ({ under: `<path d="${beardPath(mg, g)}" fill="${b}" opacity=".22"/>`, over: `<path d="${mustachePath(mg)}" fill="${m}" opacity=".32"/>` }),
  beard: (b, m, mg, g) => ({ under: `<path d="${beardPath(mg, g)}" fill="${b}"/><path d="M${50 - g.K - 4} ${g.bot - 1} Q50 ${g.bot + 3} ${50 + g.K + 4} ${g.bot - 1}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.6" stroke-linecap="round"/>`, over: `<path d="${mustachePath(mg)}" fill="${m}"/>` }),
  mustache: (b, m, mg) => ({ under: '', over: `<path d="${mustachePath(mg)}" fill="${m}"/><path d="M45 53.6 Q47.6 52.6 49.4 54" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width=".9" stroke-linecap="round"/>` }),
  goatee: (b, m, mg, g) => ({ under: `<path d="${goateePath(mg, g)}" fill="${b}"/>`, over: `<path d="${mustachePath(mg)}" fill="${m}"/>` })
};

// ---- Слои одежды, шеи, головы, глаз и предметов. Каждый — отдельная функция: новые детали добавляются без переделки ----
function outfitLayer(o, hood, skin, sex) {
  // М — широкие прямые плечи и шея толще; Ж — плечи уже и покатые, шея тоньше
  const f = sex === 'f';
  const body = f ? 'M15 104 Q17 77 50 72 Q83 77 85 104 Z' : 'M8 104 Q9 72.5 50 70.5 Q91 72.5 92 104 Z';
  const shadeR = `<path d="${f ? 'M50 72 Q83 77 85 104 L62 104 Q66 86 50 80 Z' : 'M50 70.5 Q91 72.5 92 104 L62 104 Q66 86 50 80 Z'}" fill="#000" opacity=".1"/>`;
  const nw = f ? 10 : 13.5;
  const neck = `<rect x="${50 - nw / 2}" y="58" width="${nw}" height="17" rx="3" fill="${skin}"/><ellipse cx="50" cy="64.5" rx="${nw / 2 + 1}" ry="3.2" fill="#000" opacity=".12"/>`;
  if (o === 'tee' || o === 'dev') {
    const c = o === 'dev' ? '#262B36' : hood;
    return `<path d="${body}" fill="${c}"/>${shadeR}${neck}<path d="M41.5 72.5 Q50 80 58.5 72.5" fill="none" stroke="${shade(c, -0.3)}" stroke-width="2.6" stroke-linecap="round"/>`
      + (o === 'dev' ? '<text x="50" y="94" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="10" font-weight="900" fill="#7CFFB2">&lt;/&gt;</text>' : '');
  }
  if (o === 'shirt') {
    const c = shade(hood, 0.8);
    return `<path d="${body}" fill="${c}"/>${shadeR}${neck}<path d="M50 80 L50 104" stroke="${shade(c, -0.12)}" stroke-width="1.2"/>
      <circle cx="50" cy="86" r=".9" fill="${shade(c, -0.3)}"/><circle cx="50" cy="93" r=".9" fill="${shade(c, -0.3)}"/><circle cx="50" cy="100" r=".9" fill="${shade(c, -0.3)}"/>
      <path d="M43.5 71.5 L50 80 L40.5 79 Z M56.5 71.5 L50 80 L59.5 79 Z" fill="#fff" stroke="${shade(c, -0.18)}" stroke-width="1" stroke-linejoin="round"/>`;
  }
  if (o === 'suit') {
    const c = shade(hood, -0.45);
    return `<path d="${body}" fill="${c}"/>${shadeR}${neck}<path d="M42 72 L50 92 L58 72 Q54 71 50 71 Q46 71 42 72 Z" fill="#F4F6FA"/>
      <path d="M43.5 71.5 L50 79 L41.5 78.5 Z M56.5 71.5 L50 79 L58.5 78.5 Z" fill="#fff" stroke="#D5DAE5" stroke-width=".8"/>
      <path d="M41.5 72 L50 92 L45 99 L36 77 Z M58.5 72 L50 92 L55 99 L64 77 Z" fill="${shade(c, -0.25)}"/>
      <rect x="61" y="88" width="7" height="2.2" rx="1" fill="#fff" opacity=".85"/>`;
  }
  if (o === 'jacket') {
    // Бомбер: трикотажный воротник, молния, карман на рукаве
    const r = shade(hood, -0.35);
    return `<path d="${body}" fill="${hood}"/>${shadeR}${neck}<path d="M38.4 73.6 Q50 81 61.6 73.6 Q60 70.6 50 70.4 Q40 70.6 38.4 73.6 Z" fill="${r}"/><path d="M39.6 74 Q50 80 60.4 74" fill="none" stroke="${shade(r, 0.25)}" stroke-width=".7" stroke-dasharray="1 1"/>
      <path d="M50 79.4 L50 104" stroke="${shade(hood, -0.4)}" stroke-width="1.4"/><path d="M50 79.4 L50 104" stroke="#D5DAE5" stroke-width=".5" stroke-dasharray="1 .8"/><rect x="48.8" y="83" width="2.4" height="3.6" rx=".6" fill="#C9CED9"/>
      <rect x="${f ? 22 : 16}" y="84" width="7" height="5" rx="1" fill="${shade(hood, -0.18)}"/><path d="M${f ? 23 : 17} 86.4 h5" stroke="${shade(hood, 0.3)}" stroke-width=".7"/>`;
  }
  if (o === 'puffer') {
    // Пуховик: стёганые полосы, высокий воротник, блики
    const d = shade(hood, -0.25);
    return `<path d="${body}" fill="${hood}"/>${shadeR}${neck}<path d="M${f ? 18 : 11} 86 Q50 80 ${f ? 82 : 89} 86 M${f ? 16.6 : 9.6} 95 Q50 89 ${f ? 83.4 : 90.4} 95" fill="none" stroke="${d}" stroke-width="1.6"/>
      <path d="M${f ? 24 : 18} 81 Q34 77 40 78 M${f ? 21 : 14} 90 Q32 85.6 40 86.6" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M39 76 Q38.6 66 44 64.6 L56 64.6 Q61.4 66 61 76 Q50 79 39 76 Z" fill="${hood}" stroke="${d}" stroke-width="1"/><path d="M50 65 L50 104" stroke="${d}" stroke-width="1.2"/>`;
  }
  if (o === 'dress') {
    // Платье: круглый вырез и короткий рукав-фонарик
    return `<path d="${body}" fill="${hood}"/>${shadeR}${neck}<path d="M37.4 72.4 Q50 85 62.6 72.4 Q56 71 50 71 Q44 71 37.4 72.4 Z" fill="${skin}"/><path d="M37.4 72.4 Q50 85 62.6 72.4" fill="none" stroke="${shade(hood, -0.3)}" stroke-width="1.4"/>
      <path d="M${f ? 17 : 10} 92 Q${f ? 19 : 12} 80 ${f ? 28 : 22} 76.4" fill="none" stroke="${shade(hood, -0.22)}" stroke-width="1.2"/><path d="M${f ? 83 : 90} 92 Q${f ? 81 : 88} 80 ${f ? 72 : 78} 76.4" fill="none" stroke="${shade(hood, -0.22)}" stroke-width="1.2"/>
      <circle cx="44" cy="92" r="1.1" fill="#fff" opacity=".5"/><circle cx="56" cy="96" r="1.1" fill="#fff" opacity=".5"/><circle cx="50" cy="101" r="1.1" fill="#fff" opacity=".5"/><circle cx="38" cy="99" r="1.1" fill="#fff" opacity=".5"/><circle cx="62" cy="89" r="1.1" fill="#fff" opacity=".5"/>`;
  }
  if (o === 'cami') {
    // Блуза на бретельках: открытые плечи, тонкие бретели
    return `<path d="${body}" fill="${skin}"/><path d="${body}" fill="#000" opacity=".05"/>${neck}
      <path d="M${f ? 20 : 14} 104 Q${f ? 22 : 16} 89 34 84.4 Q42 87.4 50 87.4 Q58 87.4 66 84.4 Q${f ? 78 : 84} 89 ${f ? 80 : 86} 104 Z" fill="${hood}"/>
      <path d="M36 85 L39.4 72.6 M64 85 L60.6 72.6" stroke="${hood}" stroke-width="1.5" stroke-linecap="round"/><path d="M34 84.4 Q42 87.4 50 87.4 Q58 87.4 66 84.4" fill="none" stroke="${shade(hood, -0.25)}" stroke-width="1"/>
      <path d="M44 92 Q50 95 56 92" fill="none" stroke="${shade(hood, -0.18)}" stroke-width=".8"/>`;
  }
  if (o === 'biker') {
    // Косуха (легендарная): чёрная кожа, косая молния, широкие лацканы с заклёпками
    const k = '#1B1C22';
    return `<path d="${body}" fill="${k}"/>${neck}<path d="M42 72 L50 84 L58 72 Q50 70 42 72 Z" fill="#E9EBEF"/>
      <path d="M41 72 L36 84 L44 88 L50 84 Z" fill="#2C2E36" stroke="#000" stroke-width=".5"/><path d="M59 72 L64 84 L56 88 L50 84 Z" fill="#2C2E36" stroke="#000" stroke-width=".5"/>
      <path d="M56 88 L44 104" stroke="#C9CED9" stroke-width="1.2"/><path d="M56 88 L44 104" stroke="#555" stroke-width=".4" stroke-dasharray="1 .7"/>
      ${[[38, 80], [40.6, 84.6], [61.4, 80], [59, 84.6], [31, 76.6], [69, 76.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="#D5DAE5"/>`).join('')}
      <path d="M${f ? 22 : 15} 82 Q30 77 36 77" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/><rect x="60" y="92" width="9" height="1.4" rx=".7" fill="#C9CED9"/>`;
  }
  if (o === 'cyber') {
    // Киберпанк (легендарная): тёмная куртка с неоновыми швами и светящимся воротником
    return `<path d="${body}" fill="#13131C"/>${neck}<path d="M38 75 Q38 66 44 64 L56 64 Q62 66 62 75 Q50 78 38 75 Z" fill="#1E1E2C" stroke="#FF2FD0" stroke-width="1"/>
      <path d="M50 77 L50 104" stroke="#22D3EE" stroke-width="1.2"/><path d="M${f ? 20 : 13} 90 L32 84 L40 88 M${f ? 80 : 87} 90 L68 84 L60 88" fill="none" stroke="#FF2FD0" stroke-width="1.2"/>
      <path d="M${f ? 24 : 18} 98 L36 94 L42 98 L46 96 M${f ? 76 : 82} 98 L64 94 L58 98 L54 96" fill="none" stroke="#22D3EE" stroke-width=".9"/><circle cx="46" cy="96" r=".9" fill="#22D3EE"/><circle cx="54" cy="96" r=".9" fill="#22D3EE"/>
      <path d="M38 75 Q50 78 62 75" fill="none" stroke="#FF2FD0" stroke-width="2.6" opacity=".35"/>`;
  }
  return `<path d="${body}" fill="${hood}"/>${shadeR}<path d="M33 76 Q50 92 67 76 Q60 71.5 50 71.5 Q40 71.5 33 76 Z" fill="${shade(hood, -0.25)}"/>${neck}
    <path d="M45.5 80 L44.5 92 M54.5 80 L55.5 92" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="43.3" y="91" width="2.4" height="3.4" rx="1" fill="#fff" opacity=".85"/><rect x="54.3" y="91" width="2.4" height="3.4" rx="1" fill="#fff" opacity=".85"/>`;
}
function neckLayer(n) {
  const tie = (c, stripe) => `<path d="M47.4 73 L52.6 73 L51.6 77.2 L48.4 77.2 Z" fill="${shade(c, -0.2)}"/><path d="M48.4 77.2 L51.6 77.2 L54.2 93 L50 97.5 L45.8 93 Z" fill="${c}"/>`
    + (stripe ? `<path d="M47 84 L53 81 M46.5 89 L53.6 85.6 M47 94 L54 90.5" stroke="${stripe}" stroke-width="1.3"/>` : '');
  if (n === 'tie') return tie('#C2321F', 'rgba(255,255,255,.25)');
  if (n === 'tie_gold') return tie('#F4C430', '#C99A0E') + '<circle cx="50" cy="86" r="1.6" fill="#fff" opacity=".8"/>';
  if (n === 'tie_crooked') return `<g transform="rotate(24 50 74)">${tie('#2563C9', 'rgba(255,255,255,.3)')}</g>`;
  if (n === 'bow') return '<path d="M50 75.5 L42.5 71.5 L42.5 79.5 Z M50 75.5 L57.5 71.5 L57.5 79.5 Z" fill="#1A1A2E"/><circle cx="50" cy="75.5" r="2" fill="#2E2E48"/>';
  if (n === 'snake') return snakeLayer();
  if (n === 'beads') return ['#E5484D', '#F4C430', '#3A86FF', '#2FA84F', '#FF6FA8', '#7C4DFF', '#F28C28', '#22D3EE', '#E5484D'].map((c, i) => { const t = (i + 0.5) / 9, x = 41 + 18 * t, y = 72.4 + 7.2 * Math.sin(Math.PI * t); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.3" fill="${c}" stroke="#000" stroke-opacity=".15" stroke-width=".3"/>`; }).join('');
  if (n === 'chain') return '<path d="M42 72.6 Q50 81.4 58 72.6" fill="none" stroke="#B9C0CC" stroke-width="1.1" stroke-dasharray="1.4 .6"/><path d="M50 77.8 L50 80.4" stroke="#B9C0CC" stroke-width=".7"/><circle cx="50" cy="81.4" r="1.1" fill="#D5DAE5" stroke="#8A919E" stroke-width=".4"/>';
  if (n === 'chain_gold') return '<path d="M40 72 Q50 85 60 72" fill="none" stroke="#B8922E" stroke-width="2.6"/><path d="M40 72 Q50 85 60 72" fill="none" stroke="#F4C430" stroke-width="1.8" stroke-dasharray="2 .8"/><path d="M50 79 L50 82" stroke="#F4C430" stroke-width="1"/><path d="M50 82 L53.4 85.4 L50 89 L46.6 85.4 Z" fill="#F4C430" stroke="#B8922E" stroke-width=".7"/><circle cx="50" cy="85.4" r="1" fill="#fff" opacity=".8"/>';
  if (n === 'badge') return '<path d="M44 72 L57 86 M56 72 L59 86" stroke="#E5484D" stroke-width="1.6"/><rect x="53.5" y="85" width="13" height="16" rx="2" fill="#fff" stroke="#C9CED9" stroke-width=".8"/><rect x="53.5" y="85" width="13" height="4" rx="1.5" fill="#E5484D"/><circle cx="58" cy="94" r="2.4" fill="#C9CED9"/><path d="M61.5 92.5 h3 M61.5 95.5 h3" stroke="#C9CED9" stroke-width="1.2"/>';
  return '';
}
function hatLayer(h, hood) {
  if (h === 'beanie') {
    const c = shade(hood, 0.1);
    return `<path d="M28.5 42 Q27.5 15 50 14.5 Q72.5 15 71.5 42 Z" fill="${c}"/><path d="M38 20 L38 40 M46 16 L46 38 M54 16 L54 38 M62 20 L62 40" stroke="${shade(c, -0.15)}" stroke-width="1.4"/>
      <path d="M27 36 Q50 30.5 73 36 L73.5 44 Q50 38.5 26.5 44 Z" fill="${shade(c, -0.2)}"/><circle cx="50" cy="13" r="5" fill="${shade(c, 0.35)}"/>`;
  }
  if (h === 'cap') {
    const c = hood;
    return `<path d="M29.5 39 Q29 18.5 50 18 Q71 18.5 70.5 39 Z" fill="${c}"/><path d="M27 39 Q50 31 78 41 Q62 45.5 29 43 Z" fill="${shade(c, -0.3)}"/>
      <path d="M50 18 L50 37" stroke="${shade(c, -0.15)}" stroke-width="1.2"/><circle cx="50" cy="18.5" r="1.8" fill="${shade(c, -0.3)}"/><path d="M38 24 Q44 20.5 52 21" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>`;
  }
  if (h === 'hood') {
    // Капюшон поверх головы — передний край вокруг лица (задняя часть рисуется за головой отдельно)
    return `<path d="M27.4 54 Q24.6 20 50 17.4 Q75.4 20 72.6 54 Q72 30 50 26.6 Q28 30 27.4 54 Z" fill="${hood}"/><path d="M28.6 52 Q27 28 50 25 Q73 28 71.4 52" fill="none" stroke="${shade(hood, -0.3)}" stroke-width="1.6"/>`;
  }
  if (h === 'headset') {
    return '<path d="M30 47 Q28 17 50 17 Q72 17 70 47" fill="none" stroke="#2B2B3A" stroke-width="3.6" stroke-linecap="round"/><rect x="24.5" y="42" width="8" height="13" rx="3.5" fill="#2B2B3A"/><rect x="67.5" y="42" width="8" height="13" rx="3.5" fill="#2B2B3A"/><path d="M28 54 Q28.5 63 39 63.5" fill="none" stroke="#2B2B3A" stroke-width="2.2" stroke-linecap="round"/><rect x="38" y="61" width="5.5" height="4.5" rx="2" fill="#E5484D"/>';
  }
  return '';
}
function hoodBack(c) {
  return `<path d="M22 76 Q18 40 28 24 Q38 12 50 12 Q62 12 72 24 Q82 40 78 76 Z" fill="${shade(c, -0.12)}"/>`;
}
// Маски: медицинская и марлевая закрывают нос и рот; кибервизор (Лавка) — неоновая полоса на глазах
function maskLayer(m, g, c) {
  const W = g.W, bot = g.bot;
  if (m === 'medical' || m === 'gauze') {
    const col = m === 'medical' ? '#BFE3F7' : '#F7F7F2', e = m === 'medical' ? '#8FC3E3' : '#D8D6CC';
    const d = `M${50 - W + 3} 51 Q50 47.6 ${50 + W - 3} 51 L${50 + W - 4.6} ${bot - 6} Q50 ${bot + 1.6} ${50 - W + 4.6} ${bot - 6} Z`;
    return `<path d="M${50 - W + 3.4} 52 L${50 - W - 0.4} 48.6 M${50 - W + 4.4} ${bot - 7} L${50 - W - 0.2} 53 M${50 + W - 3.4} 52 L${50 + W + 0.4} 48.6 M${50 + W - 4.4} ${bot - 7} L${50 + W + 0.2} 53" stroke="${m === 'medical' ? '#fff' : '#E9E6DA'}" stroke-width="${m === 'medical' ? 0.8 : 1.4}"/>`
      + `<path d="${d}" fill="${col}" stroke="${e}" stroke-width=".7"/>`
      + (m === 'medical' ? `<path d="M${50 - W + 4} 55 Q50 53 ${50 + W - 4} 55 M${50 - W + 4.4} 58.6 Q50 56.6 ${50 + W - 4.4} 58.6 M${50 - W + 4.8} 62.2 Q50 60.2 ${50 + W - 4.8} 62.2" fill="none" stroke="${e}" stroke-width=".8"/>`
        : `<g stroke="${e}" stroke-width=".45">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${36 + i * 4} 49 L${30 + i * 4} ${bot - 2} M${30 + i * 4} 49 L${36 + i * 4} ${bot - 2}"/>`).join('')}</g>`);
  }
  if (m === 'visor') {
    return `<path d="M${50 - W - 1.4} 44.4 Q50 41.6 ${50 + W + 1.4} 44.4 L${50 + W + 0.6} 51.4 Q50 53.4 ${50 - W - 0.6} 51.4 Z" fill="#0E1224" stroke="#22D3EE" stroke-width="1"/>`
      + `<path d="M${50 - W + 2} 47.8 L${50 + W - 2} 47.8" stroke="#FF2FD0" stroke-width="1.6" opacity=".9"/><path d="M${50 - W + 2} 47.8 L${50 + W - 2} 47.8" stroke="#FF2FD0" stroke-width="4" opacity=".25"/>`
      + `<path d="M${50 - W} 44.6 Q50 42.4 ${50 + W} 44.6" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>`;
  }
  return '';
}
function eyesLayer(shape, eyes, skin) {
  if (shape === 'anime') {
    // Аниме-глаза (Лавка): большие, с двумя бликами и ресницами
    const one = (x) => `<ellipse cx="${x}" cy="48" rx="4.6" ry="5.4" fill="#fff"/><ellipse cx="${x}" cy="48.6" rx="3.6" ry="4.6" fill="${eyes}"/><ellipse cx="${x}" cy="50" rx="2.6" ry="3" fill="${shade(eyes, 0.35)}" opacity=".7"/><circle cx="${x}" cy="48.6" r="1.5" fill="#111"/><ellipse cx="${x - 1.4}" cy="46.4" rx="1.4" ry="1.7" fill="#fff"/><circle cx="${x + 1.4}" cy="51" r=".7" fill="#fff"/><path d="M${x - 5} 46 Q${x} 41.6 ${x + 5} 45.6" fill="none" stroke="#1A1A22" stroke-width="1.6" stroke-linecap="round"/>`;
    return one(43) + one(57);
  }
  const base = (r = 3.7, rx = 4.1, ir = 2.7, pr = 1.3, dx = 0) => `<ellipse cx="43" cy="48" rx="${rx}" ry="${r}" fill="#fff"/><ellipse cx="57" cy="48" rx="${rx}" ry="${r}" fill="#fff"/>
    <circle cx="${43.4 + dx}" cy="48.3" r="${ir}" fill="${eyes}"/><circle cx="${57.4 + dx}" cy="48.3" r="${ir}" fill="${eyes}"/>
    <circle cx="${43.4 + dx}" cy="48.3" r="${pr}" fill="#111"/><circle cx="${57.4 + dx}" cy="48.3" r="${pr}" fill="#111"/>
    <circle cx="${44.4 + dx}" cy="47.2" r=".9" fill="#fff"/><circle cx="${58.4 + dx}" cy="47.2" r=".9" fill="#fff"/>`;
  if (shape === 'wide') return base(4.7, 4.8, 2.5, 1, 0);
  const lid = (y) => `<path d="M38.4 ${y} Q43 ${y - 1.2} 47.6 ${y} L47.6 43.5 L38.4 43.5 Z M52.4 ${y} Q57 ${y - 1.2} 61.6 ${y} L61.6 43.5 L52.4 43.5 Z" fill="${skin}"/>
    <path d="M38.6 ${y} Q43 ${y - 1.2} 47.4 ${y} M52.6 ${y} Q57 ${y - 1.2} 61.4 ${y}" fill="none" stroke="#22252D" stroke-width="1.5" stroke-linecap="round"/>`;
  if (shape === 'tired') return base() + lid(47.6) + '<path d="M39.6 52.4 Q43 54.2 46.6 52.4 M53.4 52.4 Q57 54.2 60.6 52.4" fill="none" stroke="#7A4E6E" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round"/>';
  if (shape === 'sly') return base(3.7, 4.1, 2.7, 1.3, 1) + lid(48.4);
  return base();
}
function propLayer(p) {
  if (p === 'mug' || p === 'mug_best') {
    const gold = p === 'mug_best';
    const c = gold ? '#F4C430' : '#fff';
    return `<g transform="translate(-9 -3)"><path d="M70 82 Q66 78 70 74 M75 82 Q71 78 75 74" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M80.5 88 Q87 88 86.5 93 Q86 97.5 80.5 97" fill="none" stroke="${gold ? '#C99A0E' : '#C9CED9'}" stroke-width="2.4"/>
      <rect x="66" y="84" width="15" height="17" rx="2.5" fill="${c}" stroke="${gold ? '#C99A0E' : '#C9CED9'}" stroke-width="1"/><ellipse cx="73.5" cy="85" rx="6.6" ry="1.7" fill="#6B3E26"/>`
      + (gold ? '<path d="M73.5 88.5 L74.8 91.3 L77.8 91.6 L75.6 93.6 L76.2 96.6 L73.5 95.1 L70.8 96.6 L71.4 93.6 L69.2 91.6 L72.2 91.3 Z" fill="#fff"/>' : '<path d="M69.5 91 h8 M69.5 94 h6" stroke="#E5484D" stroke-width="1.2" stroke-linecap="round"/>') + '</g>';
  }
  if (p === 'papers') {
    return '<g transform="translate(8 -3) rotate(-8 24 92)"><rect x="12" y="84" width="24" height="19" rx="1.5" fill="#E8ECF4"/><rect x="14" y="82" width="24" height="19" rx="1.5" fill="#F7F9FC" stroke="#C9CED9" stroke-width=".8"/><path d="M17 87 h14 M17 90.5 h18 M17 94 h11" stroke="#9AA3B5" stroke-width="1.1"/><rect x="29" y="93.5" width="6" height="5" fill="#3A7BD5"/><rect x="31.5" y="91" width="3" height="7.5" fill="#2FA84F"/></g>';
  }
  if (p === 'laptop') {
    return '<rect x="27" y="80" width="46" height="24" rx="3" fill="#B9C1D0"/><rect x="27" y="80" width="46" height="24" rx="3" fill="none" stroke="#9AA3B5" stroke-width="1"/><circle cx="50" cy="91" r="3" fill="#E6E9F0"/><circle cx="36" cy="86" r="3.2" fill="#FF6FA8"/><rect x="58" y="84" width="9" height="6" rx="1.5" fill="#7CFFB2"/><path d="M60 93 l3 3 l5 -6" stroke="#2563C9" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="40" cy="97" r="2.4" fill="#FFC93C"/>';
  }
  if (p === 'sign') {
    return '<rect x="47.5" y="96" width="5" height="8" fill="#B07A3E"/><rect x="21" y="77" width="58" height="21" rx="3" fill="#FFF6D6" stroke="#D9A21B" stroke-width="1.6"/><text x="50" y="86" text-anchor="middle" font-size="7" font-weight="900" fill="#5B3B00" font-family="system-ui,sans-serif">Я НА</text><text x="50" y="94.5" text-anchor="middle" font-size="7" font-weight="900" fill="#5B3B00" font-family="system-ui,sans-serif">СОВЕЩАНИИ</text>';
  }
  return '';
}

// Фон аватара: мягкий градиент или сцена. Сцена — по краям и сверху, где её не закрывают голова и плечи,
// крупными узнаваемыми формами: так «офис», «дом» или «улица» читаются даже в маленьком кружке
const BG_GRAD = { sky: ['#DCEBFF', '#A9CBF5'], mint: ['#DDF7EA', '#A6E0C3'], peach: ['#FFEBD9', '#F7BE93'], lilac: ['#EEE5FF', '#C2ABF2'], sun: ['#FFF4C4', '#FFC94A'], slate: ['#8396BA', '#3B4866'] };
function skinIsLight(skin) { const n = parseInt(String(skin || '#E8B48A').slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 175; }
function bgLayer(bg, skin, u) {
  const R = (fill) => `<rect x="-5" y="-5" width="110" height="110" fill="${fill}"/>`;
  const radial = (id, a, b) => `<defs><radialGradient id="${id}" cx=".5" cy=".3" r=".85"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>${R(`url(#${id})`)}`;
  const lin = (id, a, b) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
  if (!bg || bg === 'auto') return skinIsLight(skin) ? radial(`bg${u}`, '#DCEBFF', '#9FC2F2') : radial(`bg${u}`, '#FFF1CF', '#F7C873');
  if (BG_GRAD[bg]) return radial(`bg${u}`, ...BG_GRAD[bg]);
  if (bg === 'office') {
    // Окно с городом справа, растение слева, рабочий стол снизу
    return lin(`bo${u}`, '#9FD3FF', '#E6F3FF') + R('#E4EBF3') + '<rect x="-5" y="-5" width="110" height="4" fill="#CBD6E3"/>'
      + `<rect x="62" y="5" width="34" height="34" rx="2" fill="url(#bo${u})"/><path d="M64 39V27h5v-6h5v18M75 39V24h6v15M83 39V19h4v-4h4v24" fill="#7FA4C9"/><path d="M85 22h1.6M85 26h1.6M85 30h1.6M77 28h1.6M77 32h1.6M66 30h1.6" stroke="#FFE08A" stroke-width="1.2"/>`
      + '<rect x="62" y="5" width="34" height="34" rx="2" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M79 5v34M62 22h34" stroke="#fff" stroke-width="1.8"/><rect x="60" y="38.5" width="38" height="2.6" rx="1" fill="#C3CEDB"/>'
      + '<path d="M9 40 Q2 30 7 20 Q12 28 11 38 Z M12 39 Q12 24 20 16 Q20 30 15 40 Z M10 41 Q6 32 1 30 Q4 38 9 42 Z" fill="#3E9B58"/><path d="M12 40 Q14 30 21 26" fill="none" stroke="#2F7A44" stroke-width="1"/>'
      + '<path d="M5 41h14l-2 14H7z" fill="#E07A3E"/><rect x="4" y="40" width="16" height="3" rx="1" fill="#C9662F"/>'
      + '<rect x="-5" y="66" width="110" height="40" fill="#C9A27A"/><rect x="-5" y="66" width="110" height="2.4" fill="#B08560"/>';
  }
  if (bg === 'meeting') {
    // Доска с графиком и стикерами, часы, стол с кружками
    return R('#E6E0F7') + '<rect x="3" y="6" width="40" height="28" rx="2.5" fill="#fff" stroke="#A99BDB" stroke-width="1.6"/>'
      + '<rect x="9" y="22" width="5" height="8" fill="#7C6BD6"/><rect x="16" y="17" width="5" height="13" fill="#3A86FF"/><rect x="23" y="12" width="5" height="18" fill="#2FA84F"/><path d="M8 20 L17 15 L24 11 L31 9" fill="none" stroke="#E5484D" stroke-width="1.4"/><path d="M29 9.6l2.4-.8-.6 2.4" fill="none" stroke="#E5484D" stroke-width="1.2"/>'
      + '<rect x="32" y="14" width="8" height="8" fill="#FFE27A" transform="rotate(6 36 18)"/><rect x="32" y="23" width="8" height="8" fill="#FF9EC0" transform="rotate(-5 36 27)"/><path d="M3 34h40" stroke="#8F82C7" stroke-width="2"/>'
      + '<circle cx="85" cy="16" r="9" fill="#fff" stroke="#8F82C7" stroke-width="2"/><path d="M85 10.5V16l4 2.4" fill="none" stroke="#3B3170" stroke-width="1.6" stroke-linecap="round"/><circle cx="85" cy="16" r="1" fill="#3B3170"/>'
      + '<rect x="72" y="32" width="8" height="8" fill="#9BE3C1" transform="rotate(-8 76 36)"/><rect x="83" y="34" width="8" height="8" fill="#FFE27A" transform="rotate(7 87 38)"/>'
      + '<rect x="-5" y="64" width="110" height="40" fill="#8C6A4E"/><rect x="-5" y="64" width="110" height="2.6" fill="#A8835F"/>'
      + '<path d="M5 58h7v7H5z" fill="#fff"/><path d="M12 59.5q3 0 3 2.5t-3 2.5" fill="none" stroke="#fff" stroke-width="1.2"/><path d="M86 58h7v7h-7z" fill="#E5484D"/><path d="M93 59.5q3 0 3 2.5t-3 2.5" fill="none" stroke="#E5484D" stroke-width="1.2"/>';
  }
  if (bg === 'home') {
    // Тёплая стена, окно со шторами, картина, торшер, спинка дивана
    return R('#F6E3CC') + '<path d="M0 -5v110M10 -5v110M20 -5v110M80 -5v110M90 -5v110" stroke="#EFD5B6" stroke-width="3"/>'
      + `${lin(`bh${u}`, '#9ED0FF', '#D9EEFF')}<rect x="66" y="6" width="26" height="26" rx="1.5" fill="url(#bh${u})"/><circle cx="85" cy="13" r="3.4" fill="#FFE38A"/><path d="M66 27 Q74 21 80 26 Q86 22 92 27V32H66z" fill="#8BC79A"/><path d="M79 6v26M66 19h26" stroke="#fff" stroke-width="1.6"/>`
      + '<path d="M62 3h34" stroke="#A0703F" stroke-width="2" stroke-linecap="round"/><path d="M63 4 Q66 20 63 36 L68 36 Q70 20 68 4 Z M95 4 Q92 20 95 36 L90 36 Q88 20 90 4 Z" fill="#E5484D"/>'
      + '<rect x="6" y="8" width="20" height="15" rx="1" fill="#fff" stroke="#B9844F" stroke-width="2"/><path d="M8.5 21l5-6 3.5 4 2.5-2.5 4.5 4.5z" fill="#6BB0E8"/><circle cx="21" cy="12" r="1.8" fill="#FFC93C"/>'
      + '<path d="M7 30h10l-3 7h-4z" fill="#FFD27A"/><path d="M12 37v28" stroke="#6B4A2F" stroke-width="1.6"/><ellipse cx="12" cy="31" rx="9" ry="5" fill="#FFE9A8" opacity=".35"/>'
      + '<path d="M-5 58 Q-5 52 4 52 L96 52 Q105 52 105 58 L105 104 L-5 104 Z" fill="#5B7DB1"/><path d="M-5 58 Q-5 52 4 52 L96 52 Q105 52 105 58" fill="none" stroke="#4A6A9C" stroke-width="2"/>'
      + '<rect x="2" y="56" width="16" height="14" rx="4" fill="#F4A72C" transform="rotate(-8 10 63)"/><rect x="82" y="56" width="16" height="14" rx="4" fill="#E85D75" transform="rotate(8 90 63)"/>';
  }
  if (bg === 'street') {
    // Небо, дома с окнами по краям, дерево, фонарь, тротуар
    return lin(`bs${u}`, '#7FC0FF', '#D8EEFF') + R(`url(#bs${u})`) + '<circle cx="80" cy="12" r="7" fill="#FFE07A"/><circle cx="80" cy="12" r="10.5" fill="#FFE07A" opacity=".28"/>'
      + '<path d="M28 10 a5 5 0 0 1 9 -2 a4 4 0 0 1 7 3 a3.5 3.5 0 0 1 -1 7 h-14 a4 4 0 0 1 -1 -8z" fill="#fff" opacity=".9"/>'
      + '<path d="M-5 66V18h18v48z" fill="#E8A87C"/><path d="M13 66V30h12v36z" fill="#C98C66"/><path d="M75 66V26h12v40z" fill="#8FA9C9"/><path d="M87 66V14h18v52z" fill="#B7C7DC"/>'
      + [[-1, 24], [6, 24], [-1, 34], [6, 34], [-1, 44], [6, 44], [16, 36], [20, 36], [16, 46], [20, 46], [78, 32], [82, 32], [78, 42], [82, 42], [90, 20], [97, 20], [90, 30], [97, 30], [90, 40], [97, 40]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="4" height="5" rx=".6" fill="${i % 3 ? '#FFF3C4' : '#6F86A8'}"/>`).join('')
      + '<rect x="-5" y="64" width="110" height="40" fill="#A7B1BF"/><path d="M-5 66h110" stroke="#8E98A7" stroke-width="2"/>'
      + '<rect x="21" y="44" width="3" height="22" fill="#7A5232"/><circle cx="22.5" cy="40" r="9" fill="#4FAF63"/><circle cx="17" cy="45" r="6" fill="#3E9B58"/><circle cx="28" cy="45" r="6" fill="#45A35D"/>'
      + '<path d="M72 66V34" stroke="#3B4255" stroke-width="2"/><path d="M72 35 Q72 31 76 31" fill="none" stroke="#3B4255" stroke-width="2"/><path d="M73 31h6l-1 3h-4z" fill="#3B4255"/><ellipse cx="76" cy="35" rx="4" ry="2" fill="#FFE07A" opacity=".8"/>';
  }
  if (bg === 'cafe') {
    // Меловая доска «Меню», лампы-подвесы, полка с чашками, стойка
    return R('#EBD3B4') + '<rect x="-5" y="-5" width="110" height="24" fill="#E2C49E"/>'
      + '<rect x="62" y="8" width="32" height="28" rx="2" fill="#2E3532" stroke="#9A6B3E" stroke-width="2.2"/><text x="78" y="17.5" text-anchor="middle" font-size="6" font-weight="900" fill="#F4F1DE" font-family="system-ui,sans-serif">МЕНЮ</text><path d="M66 22h12M66 26.5h16M66 31h10" stroke="#F4F1DE" stroke-width="1.2" stroke-linecap="round" opacity=".85"/><path d="M84 25h6v4.6a3 3 0 0 1-6 0z" fill="#F4F1DE"/><path d="M85.5 23.6q1-1.4 0-2.8M88 23.6q1-1.4 0-2.8" fill="none" stroke="#F4F1DE" stroke-width=".7"/>'
      + '<path d="M12 -5v15M28 -5v9" stroke="#5B4636" stroke-width="1"/><path d="M5 18a7 7 0 0 1 14 0z M22 12a6 6 0 0 1 12 0z" fill="#2E3532"/><ellipse cx="12" cy="19" rx="4" ry="2" fill="#FFD66B"/><ellipse cx="28" cy="13" rx="3.4" ry="1.8" fill="#FFD66B"/><ellipse cx="12" cy="24" rx="9" ry="5" fill="#FFE9A8" opacity=".35"/>'
      + '<rect x="0" y="40" width="22" height="2.4" rx="1" fill="#9A6B3E"/><path d="M3 34h6v6H3zM12 35h5v5h-5z" fill="#fff"/><path d="M9 35.5q2 0 2 2t-2 2M17 36q1.6 0 1.6 1.6t-1.6 1.6" fill="none" stroke="#fff" stroke-width=".9"/>'
      + '<rect x="-5" y="64" width="110" height="40" fill="#7A5232"/><rect x="-5" y="64" width="110" height="3" fill="#A0703F"/>';
  }
  return '';
}

// Нос: шесть форм. Видимый даже в маленьком кружке: тень сбоку, кончик и ноздри
function noseLayer(n, skin, sex) {
  const c = shade(skin, -0.42), sh = shade(skin, -0.22), hi = shade(skin, 0.35);
  const line = (d, w = 1.9) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const nostrils = (y = 54.4, dx = 2.1, r = 1) => `<ellipse cx="${50 - dx}" cy="${y}" rx="${r}" ry="${r * 0.65}" fill="${c}"/><ellipse cx="${50 + dx}" cy="${y}" rx="${r}" ry="${r * 0.65}" fill="${c}"/>`;
  const shapes = {
    button: `<ellipse cx="50" cy="53" rx="3.4" ry="2.6" fill="${sh}" opacity=".55"/>` + line('M48.4 54.4 Q50 55.6 51.6 54.4') + nostrils(54, 1.9, 0.75) + `<circle cx="50.8" cy="52" r=".9" fill="${hi}" opacity=".7"/>`,
    straight: `<path d="M50.6 46 L51.8 53.4 L48.6 53.8 Z" fill="${sh}" opacity=".45"/>` + line('M50.4 46.4 L51.6 53.2 Q50.4 55.2 48.2 54.2') + nostrils(54.6, 2, 0.7),
    wide: `<ellipse cx="50" cy="53.6" rx="5" ry="2.6" fill="${sh}" opacity=".5"/>` + line('M46.2 53.6 Q45.8 55.6 48 55.4 M53.8 53.6 Q54.2 55.6 52 55.4 M48 55.4 Q50 56.4 52 55.4') + nostrils(54.8, 2.6, 0.95),
    long: `<path d="M50.4 45 L52 54.2 L48.4 54.6 Z" fill="${sh}" opacity=".45"/>` + line('M50.4 45.4 Q52.2 51.8 51.6 54 Q50.4 55.6 48.2 54.8') + nostrils(54.8, 2, 0.75),
    snub: `<ellipse cx="50" cy="52.8" rx="3" ry="2.4" fill="${sh}" opacity=".5"/>` + line('M48.2 53.8 Q50 55 51.8 53.8') + nostrils(53.6, 1.5, 0.85) + `<circle cx="50.4" cy="51.6" r="1" fill="${hi}" opacity=".7"/>`,
    roman: `<path d="M49.8 45.6 Q53.6 49.6 52 54 L48.6 54 Z" fill="${sh}" opacity=".45"/>` + line('M49.8 46 Q53.4 49.8 51.8 53.8 Q50.6 55.6 48.2 54.6') + nostrils(54.8, 2, 0.75)
  };
  const body = shapes[n] || shapes.button;
  return sex === 'f' ? `<g transform="translate(50 51) scale(.9) translate(-50 -51)">${body}</g>` : body;
}
// Очки: пять оправ, тонкая оправа своего цвета и стёкла своего цвета (по умолчанию прозрачные).
// Дужки идут к ушам — очки «садятся» на лицо любой ширины. u — уникальный номер аватара для id градиентов
const GLASS_COLORS = {
  black: { f: '#262A36', hi: '#7A8196' }, tortoise: { grad: ['#4A2A16', '#A7652E', '#6B3B1C', '#C88A45'], hi: '#E7B27A' },
  gold: { f: '#C9A03A', hi: '#FFF1B8' }, silver: { f: '#AEB4C0', hi: '#FFFFFF' }, red: { f: '#C8323C', hi: '#FF8A92' },
  navy: { f: '#2E4F93', hi: '#86A5E8' }, pink: { f: '#E77BA6', hi: '#FFD3E5' }
};
const LENS_COLORS = { clear: ['#FFFFFF', 0.16, '#DDE8F7', 0.08], grey: ['#3B3F4A', 0.62, '#5A606E', 0.45], brown: ['#5A3A1E', 0.58, '#8A5A2E', 0.38],
  blue: ['#2A62C9', 0.5, '#5E9BEA', 0.32], green: ['#1F7A4A', 0.5, '#4FB07D', 0.32], pink: ['#E0508F', 0.42, '#FF9EC6', 0.28], yellow: ['#E0A500', 0.42, '#FFD86B', 0.3] };
const GLASS_SHAPES = {
  classic: 'M37 44.8 Q37 43 39 43 L47.6 43 Q49.4 43 49.4 44.8 L49.4 51 Q49.4 53 47.4 53 L39 53 Q37 53 37 51 Z',
  round: 'M43 41.9 A6.1 6.1 0 1 1 42.99 41.9 Z',
  square: 'M36.4 43.6 L49.4 43.6 L49.4 52.6 L36.4 52.6 Z',
  aviator: 'M36.4 44.4 Q43 41.8 49.2 43.8 Q49.8 52.2 43.6 53.8 Q36.6 53.4 36.4 44.4 Z',
  cat: 'M36.2 46.2 Q40 42 49.2 43.8 Q49.4 51.4 43.2 52.8 Q37.4 52.4 36.2 46.2 Z'
};
const mirrorX = (d) => `<g transform="translate(100 0) scale(-1 1)">${d}</g>`;
function glassesLayer(style, color, lensColor, u, W) {
  const shape = GLASS_SHAPES[style] || GLASS_SHAPES.classic;
  const c = GLASS_COLORS[color] || GLASS_COLORS.black;
  const ln = LENS_COLORS[lensColor] || LENS_COLORS.clear;
  const gid = `gf${u}`, lid = `gl${u}`;
  const defs = `<defs>${c.grad ? `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">${c.grad.map((g, i) => `<stop offset="${i / (c.grad.length - 1)}" stop-color="${g}"/>`).join('')}</linearGradient>` : ''}<linearGradient id="${lid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ln[0]}" stop-opacity="${ln[1]}"/><stop offset="1" stop-color="${ln[2]}" stop-opacity="${ln[3]}"/></linearGradient></defs>`;
  const frame = c.grad ? `url(#${gid})` : c.f;
  const w = style === 'aviator' ? 0.8 : 1.15;
  const temple = `<path d="M36.6 46 L${50 - W - 0.6} 47" stroke="${frame}" stroke-width=".9" stroke-linecap="round"/>`;
  const one = `<path d="${shape}" fill="url(#${lid})"/><path d="${shape}" fill="none" stroke="${frame}" stroke-width="${w}" stroke-linejoin="round"/>`
    + `<path d="M38.4 46 L40.2 44.6" stroke="#fff" stroke-opacity=".55" stroke-width=".7" stroke-linecap="round"/>`
    + (style === 'cat' ? `<path d="M36.6 46.2 Q35.2 44.6 34.8 42.8" fill="none" stroke="${frame}" stroke-width="1.4" stroke-linecap="round"/>` : '')
    + (style === 'aviator' ? `<path d="M37.2 44 Q43 42.2 48.6 43.6" fill="none" stroke="${frame}" stroke-width="1.1"/>` : '') + temple;
  const by = style === 'round' ? 47.2 : 46.2;
  return defs + one + mirrorX(one) + `<path d="M49 ${by} Q50 ${by - 1.1} 51 ${by}" fill="none" stroke="${frame}" stroke-width="${w}" stroke-linecap="round"/>`
    + (style === 'aviator' ? `<path d="M48.6 44 L51.4 44" stroke="${frame}" stroke-width=".8"/>` : '');
}
// Питомец рядом — внизу слева, поверх плеча
function petLayer(p) {
  if (p === 'corgi') {
    return '<g transform="translate(4 -5)"><ellipse cx="17" cy="97" rx="12" ry="8" fill="#E39A45"/><ellipse cx="17" cy="99" rx="6" ry="5.4" fill="#FFF6EA"/>'
      + '<path d="M8.6 75 L7.4 62.6 L15.2 71.6 Z M25.4 75 L26.6 62.6 L18.8 71.6 Z" fill="#E39A45"/><path d="M9.6 73 L8.8 65.4 L13.6 71 Z M24.4 73 L25.2 65.4 L20.4 71 Z" fill="#F7B8B8"/>'
      + '<ellipse cx="17" cy="79" rx="9" ry="8" fill="#E39A45"/><path d="M17 72 Q14 79 12.4 84 Q17 88 21.6 84 Q20 79 17 72 Z" fill="#FFF6EA"/>'
      + '<circle cx="13.4" cy="78" r="1.3" fill="#1E1A18"/><circle cx="20.6" cy="78" r="1.3" fill="#1E1A18"/><circle cx="13.8" cy="77.6" r=".4" fill="#fff"/><circle cx="21" cy="77.6" r=".4" fill="#fff"/>'
      + '<ellipse cx="17" cy="82" rx="1.7" ry="1.2" fill="#1E1A18"/><path d="M17 83.2 Q17 85 15.6 85.4 M17 83.2 Q17 85 18.4 85.4" fill="none" stroke="#1E1A18" stroke-width=".6" stroke-linecap="round"/><path d="M16.2 85.4 Q17 88 17.8 85.4 Z" fill="#F07A8A"/></g>';
  }
  if (p === 'pug') {
    return '<g transform="translate(4 -5)"><ellipse cx="17" cy="97" rx="11.6" ry="8" fill="#D9B98C"/><ellipse cx="17" cy="80" rx="9.6" ry="8.6" fill="#D9B98C"/>'
      + '<path d="M8 74 Q6 72.6 6.4 78 Q8.6 78.4 10 76 Z M26 74 Q28 72.6 27.6 78 Q25.4 78.4 24 76 Z" fill="#3A2E28"/>'
      + '<ellipse cx="17" cy="83.4" rx="6.4" ry="4.8" fill="#3A2E28"/><path d="M12.6 75.6 Q17 73.8 21.4 75.6 M13.6 77.4 Q17 76 20.4 77.4" fill="none" stroke="#B8966A" stroke-width=".7"/>'
      + '<circle cx="13" cy="79.6" r="1.9" fill="#1E1A18"/><circle cx="21" cy="79.6" r="1.9" fill="#1E1A18"/><circle cx="13.5" cy="79" r=".6" fill="#fff"/><circle cx="21.5" cy="79" r=".6" fill="#fff"/>'
      + '<ellipse cx="17" cy="82" rx="1.6" ry="1.1" fill="#111"/><path d="M15.8 86 Q17 88.4 18.2 86 Z" fill="#F07A8A"/></g>';
  }
  return '';
}
// Змея на шее (Лавка): обвивает шею, голова на плече, язык — раздвоенный
function snakeLayer() {
  return '<path d="M20 92 Q30 78 44 76 Q50 75 56 76 Q70 78 80 86" fill="none" stroke="#2F7A3A" stroke-width="5.6" stroke-linecap="round"/>'
    + '<path d="M20 92 Q30 78 44 76 Q50 75 56 76 Q70 78 80 86" fill="none" stroke="#4FB062" stroke-width="4" stroke-linecap="round"/>'
    + '<path d="M24 87 l2 -1.6 M30 81.6 l2.2 -1 M37 78 l2.2 -.6 M46 76.2 l2.4 0 M55 76.4 l2.4 .4 M63 77.6 l2.2 .8 M70 80.4 l2 1.2" stroke="#E8D34A" stroke-width="1.2" stroke-linecap="round"/>'
    + '<path d="M20 92 Q16 98 20 104" fill="none" stroke="#4FB062" stroke-width="3.4" stroke-linecap="round"/>'
    + '<ellipse cx="82.6" cy="87.6" rx="5" ry="3.6" fill="#4FB062" stroke="#2F7A3A" stroke-width=".9" transform="rotate(30 82.6 87.6)"/>'
    + '<circle cx="83.4" cy="86" r=".9" fill="#111"/><circle cx="83.7" cy="85.7" r=".3" fill="#fff"/><path d="M86.4 90.4 L89 92.2 M89 92.2 L90.4 91.6 M89 92.2 L89.6 93.6" stroke="#E5484D" stroke-width=".7" stroke-linecap="round"/>';
}
// Рука с кружкой (Аксессуары): рукав, кисть и пальцы обхватывают кружку
function mugHand(gold, skin, sleeve) {
  const c = gold ? '#F4C430' : '#fff', e = gold ? '#C99A0E' : '#C9CED9';
  return '<g transform="translate(-5 -9)">' + `<path d="M62 118 Q62 100 68 92" fill="none" stroke="${sleeve}" stroke-width="10" stroke-linecap="round"/>`
    + `<path d="M70 82 Q66 78 70 74 M75 82 Q71 78 75 74" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.3" stroke-linecap="round"/>`
    + `<path d="M80.5 88 Q87 88 86.5 93 Q86 97.5 80.5 97" fill="none" stroke="${e}" stroke-width="2.4"/>`
    + `<rect x="66" y="84" width="15" height="17" rx="2.5" fill="${c}" stroke="${e}" stroke-width="1"/><ellipse cx="73.5" cy="85" rx="6.6" ry="1.7" fill="#6B3E26"/>`
    + (gold ? '<path d="M73.5 88.5 L74.8 91.3 L77.8 91.6 L75.6 93.6 L76.2 96.6 L73.5 95.1 L70.8 96.6 L71.4 93.6 L69.2 91.6 L72.2 91.3 Z" fill="#fff"/>' : '<path d="M71 91 h6 M71 94 h4" stroke="#E5484D" stroke-width="1.2" stroke-linecap="round"/>')
    + `<path d="M62.6 90 Q66 88 70.4 89.4 L70.6 92.6 Q66.6 92 64 93.6 Z" fill="${skin}" stroke="${shade(skin, -0.2)}" stroke-width=".6"/>`
    + [91.6, 94.6, 97.6].map((y) => `<rect x="${y === 91.6 ? 64.8 : 64.4}" y="${y}" width="7.6" height="2.8" rx="1.4" fill="${skin}" stroke="${shade(skin, -0.2)}" stroke-width=".6"/>`).join('') + '</g>';
}

// Серьги — на мочках ушей (x — центр уха, y — низ мочки)
function earringsLayer(e, xl, xr, y) {
  const both = (fn) => fn(xl) + fn(xr);
  switch (e) {
    case 'studs': return both((x) => `<circle cx="${x}" cy="${y - 0.6}" r="1.3" fill="#F4C430" stroke="#B8922E" stroke-width=".5"/><circle cx="${x - 0.4}" cy="${y - 1}" r=".35" fill="#fff"/>`);
    case 'pearls': return both((x) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#FBF7EE" stroke="#D8D0BF" stroke-width=".5"/><circle cx="${x - 0.5}" cy="${y - 0.6}" r=".5" fill="#fff"/>`);
    case 'hoops': return both((x) => `<circle cx="${x}" cy="${y + 2.4}" r="3" fill="none" stroke="#E0B04B" stroke-width="1.2"/>`);
    case 'drops': return both((x) => `<path d="M${x} ${y - 0.6} L${x} ${y + 2}" stroke="#C9CED9" stroke-width=".7"/><path d="M${x} ${y + 1.6} Q${x + 2} ${y + 4.4} ${x} ${y + 5.6} Q${x - 2} ${y + 4.4} ${x} ${y + 1.6} Z" fill="#3A7BD5" stroke="#1E4FA8" stroke-width=".4"/>`);
    case 'cross': return both((x) => `<path d="M${x} ${y - 0.4} L${x} ${y + 4.4} M${x - 1.4} ${y + 1.2} L${x + 1.4} ${y + 1.2}" stroke="#C9CED9" stroke-width=".9" stroke-linecap="round"/>`);
    default: return '';
  }
}
// Макияж: помада, тени, стрелки, румяна
const MAKEUP = {
  none: { lip: null },
  light: { lip: '#D9667A', blush: 0.36 },
  lips: { lip: '#C2185B', lipW: 3.1 },
  smoky: { lip: '#B5576A', shadow: '#4E4352', shadowOp: 0.55, liner: true },
  evening: { lip: '#B0122E', lipW: 3, shadow: '#8E5AC8', shadowOp: 0.5, liner: true, blush: 0.3 },
  bright: { lip: '#FF4F6E', lipW: 3, shadow: '#FF7AB6', shadowOp: 0.5, blush: 0.42 }
};
const EYE_SCALE = { s: 0.84, m: 1, l: 1.17 };
const EAR_SCALE = { small: 0.78, normal: 1, big: 1.32 };

// Внутренности SVG аватара — пригодятся и для кружка, и для мем-открытки
let avaUid = 0;
function avatarInner(look = {}) {
  const u = ++avaUid;
  const sex = look.preset === 'f' ? 'f' : 'm';
  const hair = look.hair || '#2B1D14';
  const skin = look.skin || '#E8B48A';
  const eyes = look.eyes || '#22252D';
  const hs = HAIR_FRONT[look.hairStyle] ? look.hairStyle : 'short';
  const hood = HOODIE[look.hoodie] || HOODIE.blue;
  const g = faceGeo(look.face, sex);
  const rx = g.W;
  const skinDark = shade(skin, -0.16);
  const brow = shade(hair === '#F2E6C9' || hair === '#9AA3B5' ? '#8A7A66' : hair, -0.1);
  // Причёска, шапка и наушники садятся по ширине выбранного лица
  const kx = (rx / 19.5).toFixed(3);
  const fit = (svg) => (svg ? `<g transform="translate(50 0) scale(${kx} 1) translate(-50 0)">${svg}</g>` : '');
  const bc = look.beardColor && look.beardColor !== 'same' ? look.beardColor : hair;
  const mc = look.mustacheColor && look.mustacheColor !== 'same' ? look.mustacheColor : hair;
  // Борода — только у «М», макияж — только у «Ж»
  const mg = MOUTH_GEO[look.mouth] || MOUTH_GEO.smile;
  const beard = sex === 'm' ? (BEARDS[look.beard] || BEARDS.none)(bc, mc, mg, g) : { under: '', over: '' };
  const hat = look.hat && look.hat !== 'none' ? look.hat : null;
  const mk = sex === 'f' ? (MAKEUP[look.makeup] || MAKEUP.none) : MAKEUP.none;
  const es = (EYE_SCALE[look.eyeSize] || 1) * (sex === 'f' ? 1.08 : 1);
  const ek = (EAR_SCALE[look.ears] || 1) * (sex === 'f' ? 0.9 : 1);
  const shape = look.eyeShape === 'happy' ? 'normal' : look.eyeShape;
  // Ж — верхнее веко с ресницами и тонкие брови дугой; М — густые прямые брови
  const lash = sex === 'f' ? '<path d="M38.8 47.4 Q43 42.9 47.2 46.8 M61.2 47.4 Q57 42.9 52.8 46.8" fill="none" stroke="#1A1A22" stroke-width="1.5" stroke-linecap="round"/><path d="M38.9 47.2 Q37.6 46.6 37 45.4 M61.1 47.2 Q62.4 46.6 63 45.4" fill="none" stroke="#1A1A22" stroke-width="1.2" stroke-linecap="round"/>' : '';
  const liner = mk.liner ? '<path d="M38.8 47.6 L36 46 M61.2 47.6 L64 46" stroke="#1A1A22" stroke-width="1.5" stroke-linecap="round"/>' : '';
  const shadow = mk.shadow ? `<ellipse cx="43" cy="45.4" rx="5.4" ry="3.2" fill="${mk.shadow}" opacity="${mk.shadowOp}"/><ellipse cx="57" cy="45.4" rx="5.4" ry="3.2" fill="${mk.shadow}" opacity="${mk.shadowOp}"/>` : '';
  const browY = shape === 'tired' ? 1.2 : shape === 'wide' ? -1.4 : 0;
  const brows = sex === 'f'
    ? `<path d="M38.8 ${42.2 + browY} Q42.4 ${38.8 + browY} 47.2 ${41 + browY} M52.8 ${41 + browY} Q57.6 ${38.8 + browY} 61.2 ${42.2 + browY}" fill="none" stroke="${brow}" stroke-width="1.6" stroke-linecap="round"/>`
    : `<path d="M38.2 ${42 + browY} Q43 ${40.4 + browY} 47.6 ${41.4 + browY} M52.4 ${41.4 + browY} Q57 ${40.4 + browY} 61.8 ${42 + browY}" fill="none" stroke="${brow}" stroke-width="2.9" stroke-linecap="round"/>`;
  const jaw = '';
  const blushOp = mk.blush || (sex === 'f' ? 0.26 : 0.14);
  const lip = mk.lip || (sex === 'f' ? '#C9707C' : shade(skin, -0.28));
  const line = sex === 'f' ? shade(lip, -0.4) : shade(skin, -0.55);
  const freckles = look.freckles ? [[39.5, 52.5], [42, 54], [38.8, 55], [60.5, 52.5], [58, 54], [61.2, 55]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".85" fill="${shade(skin, -0.38)}"/>`).join('') : '';
  const capped = hat && hat !== 'headset';
  const hatC = look.hatColor && look.hatColor !== 'same' && HOODIE[look.hatColor] ? HOODIE[look.hatColor] : hood;
  const hooded = hat === 'hood';
  // Под шапкой высокие причёски (пучки, ирокез, кок) прячутся, длинные торчат прядями
  const hairBack = hooded ? '' : HAIR_BACK[hs] && !(capped && HAIR_TALL.includes(hs) && hs !== 'ponytail') ? HAIR_BACK[hs](hair) : '';
  const hairFront = hooded ? '' : capped ? (HAIR_LONG.includes(hs) || sex === 'f' ? locks(hair, HAIR_LONG.includes(hs) ? 62 : 52, 3.4) : '') : HAIR_FRONT[hs](hair);
  const exL = 50 - rx - 0.5, exR = 50 + rx + 0.5;
  const ears = `<ellipse cx="${exL}" cy="49" rx="${3.6 * ek}" ry="${5 * ek}" fill="${skin}"/><ellipse cx="${exR}" cy="49" rx="${3.6 * ek}" ry="${5 * ek}" fill="${skin}"/>
    <ellipse cx="${exL + 0.2}" cy="49.3" rx="${1.6 * ek}" ry="${2.8 * ek}" fill="${skinDark}"/><ellipse cx="${exR - 0.2}" cy="49.3" rx="${1.6 * ek}" ry="${2.8 * ek}" fill="${skinDark}"/>`;
  const mug = look.prop === 'mug' || look.prop === 'mug_best';
  return `${bgLayer(look.bg, skin, u)}${fit(hairBack)}
    ${hooded ? fit(hoodBack(hatC)) : ''}
    ${outfitLayer(look.outfit, hood, skin, sex)}
    ${neckLayer(look.neck)}
    ${ears}
    <path d="${g.d}" fill="${skin}"/>
    ${jaw}
    <ellipse cx="38" cy="54.6" rx="3.6" ry="2.6" fill="#FF7A8A" opacity="${blushOp}"/><ellipse cx="62" cy="54.6" rx="3.6" ry="2.6" fill="#FF7A8A" opacity="${blushOp}"/>
    ${freckles}
    <g transform="translate(50 48) scale(${es.toFixed(3)}) translate(-50 -48)">${shadow}${eyesLayer(shape, eyes, skin)}${lash}${liner}</g>
    ${brows}
    ${noseLayer(look.nose, skin, sex)}
    ${beard.under}
    <g transform="translate(0 1.4)">${(MOUTHS[look.mouth] || MOUTHS.smile)(lip, line)}</g>${beard.over}
    ${maskLayer(look.mask, g)}
    ${fit(hairFront)}
    ${earringsLayer(look.earrings, exL, exR, 49 + 5 * ek - 0.8)}
    ${capped ? fit(hatLayer(hat, hatC)) : ''}
    ${look.glasses ? glassesLayer(look.glassesStyle, look.glassesColor, look.lensColor, u, rx) : ''}
    ${hat === 'headset' ? fit(hatLayer('headset', hood)) : ''}
    ${look.phones && hat !== 'headset' ? fit('<path d="M29 47 Q27 15 50 15 Q73 15 71 47" fill="none" stroke="#2B2B3A" stroke-width="6" stroke-linecap="round"/><path d="M33 26 Q40 18 50 17.5" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/><rect x="23" y="42" width="10" height="16" rx="4" fill="#2B2B3A"/><rect x="67" y="42" width="10" height="16" rx="4" fill="#2B2B3A"/><rect x="25" y="45" width="3" height="10" rx="1.5" fill="#E5484D"/><rect x="72" y="45" width="3" height="10" rx="1.5" fill="#E5484D"/>') : ''}
    ${look.crown ? `<g ${capped ? 'transform="translate(0 -6)"' : ''}><path d="M33 19 L37 5 L44 13 L50 3 L56 13 L63 5 L67 19 Z" fill="#FFC93C" stroke="#D99A0B" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="13" r="2" fill="#E5484D"/></g>` : ''}
    ${mug ? mugHand(look.prop === 'mug_best', skin, look.outfit === 'suit' ? shade(hood, -0.45) : look.outfit === 'shirt' ? shade(hood, 0.8) : look.outfit === 'dev' ? '#262B36' : hood) : propLayer(look.prop)}
    ${petLayer(look.pet)}`;
}

function avatar(look = {}, size = 42, zoom = false) {
  const ring = FRAMES[look.frame] || '#FFFFFF';
  return `<span class="ava" style="width:${size + 6}px;height:${size + 6}px;border:3px solid ${ring}">
  <svg width="${size}" height="${size}" viewBox="${zoom ? '24 28 52 52' : '0 0 100 100'}" aria-hidden="true">${avatarInner(look)}</svg></span>`;
}

// Нажатие на аватар открывает карточку коллеги
const tap = (id, html) => `<button class="ava-btn" data-act="person" data-id="${id}" aria-label="Открыть профиль">${html}</button>`;
const BEAN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="6" ry="9" transform="rotate(30 12 12)"/><path d="M9 6c3 3 3 9 6 12"/></svg>';
const FLAME = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#FF8A3D" aria-hidden="true"><path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5.2.2 1.7 1 2.7 2 3.2C11 8.5 11 5.5 12 2z"/></svg>';
const ICONS = {
  coffee: 'M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3',
  lunch: 'M4 3v8a3 3 0 0 0 3 3v7M7 3v6M10 3v8a3 3 0 0 1-3 3M17 21V3c-2 1-3 4-3 8h3',
  where: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  food: 'M12 7c-4-2-8 1-7 6 1 4 3 8 7 7 4 1 6-3 7-7 1-5-3-8-7-6zM12 7c0-2 1-4 3-4',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'
};
const ico = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
const OFFICE_BG = { smol: '#E5484D', mark: '#3A86FF', vor: '#F4A72C' };
const CALL_STYLE = {
  coffee: '#8B5A2B', lunch: '#1F7A3A', room: '#2563C9', home: '#6D3FD6', call: '#F97316', where: '#0E7490', online: '#BE185D', wait: '#4B5563'
};
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };

// ---------- Платформа ----------
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; render(); });

// ---------- Загрузка ----------
// Вышла новая версия — перезагрузимся при следующем возвращении в приложение, а пока покажем кнопку
function noteBuild(b) {
  if (!b) return;
  if (!S.build) S.build = b;
  else if (b !== S.build) S.newBuild = true;
}
function reloadIfStale() {
  if (!S.newBuild || S.sheet || typing() || (S.bv && S.bv.status === 'play' && S.bv.mode === 'fast')) return false;
  location.reload(); return true;
}

async function loadMe() {
  const r = await get('/api/me');
  S.me = r.user; S.cat = r.catalog; S.vapidKey = r.vapidKey; S.domains = r.domains;
  noteBuild(r.build);
  if (S.me && S.me.gangs.length && !S.me.gangs.some((g) => g.id === S.activeGang)) S.activeGang = S.me.gangs[0].id;
}
async function loadState() {
  S.state = await get(`/api/state?seenChat=${S.seenChat}&seenFeed=${S.seenFeed}`);
  noteBuild(S.state.build);
  if (S.me) S.me.beans = S.state.beans;
}
async function loadGang() {
  if (!S.activeGang) { S.gang = null; return; }
  try { S.gang = await get(`/api/gangs/${S.activeGang}`); } catch { S.gang = null; S.activeGang = null; }
  await loadPolls();
}
async function loadPolls() {
  if (!S.activeGang) { S.polls = null; return; }
  try { S.polls = (await get(`/api/gangs/${S.activeGang}/polls`)).items; } catch { S.polls = []; }
}
async function loadEvents() { S.events = await get('/api/events'); }
async function loadFeatures() {
  S.fx = await get(`/api/features?gang=${S.activeGang || ''}`);
  // Новые ачивки — короткое поздравление, один раз
  const seen = new Set(store.get('achSeen', []));
  const fresh = S.fx.achievements.filter((a) => a.got && !seen.has(a.id));
  if (fresh.length) {
    if (seen.size) toast(fresh.length === 1 ? `Новая ачивка: «${fresh[0].name}» · +${fresh[0].reward}` : `Новых ачивок: ${fresh.length}`);
    store.set('achSeen', S.fx.achievements.filter((a) => a.got).map((a) => a.id));
  }
}
async function loadCrew() { S.crew = await get('/api/crew'); try { S.battles = (await get('/api/battles')).items; } catch { S.battles = []; } }
// Морской бой: при обновлении запоминаем, какие клетки появились — их и анимируем
const shotKeys = (v) => new Set([...v.myShots.map((t) => `o:${t.x},${t.y}`), ...v.oppShots.map((t) => `m:${t.x},${t.y}`)]);
function setBattleView(v) {
  const prev = S.bv && S.bv.id === v.id ? shotKeys(S.bv) : null;
  if (prev) {
    const fresh = [...shotKeys(v)].filter((k) => !prev.has(k));
    if (fresh.length) { S.bFresh = new Set(fresh); S.bFreshUntil = Date.now() + 1400; }
    if (v.last && !v.last.mine && v.seq !== S.bv.seq) {
      sfx(v.last.r === 'miss' ? 'splash' : v.last.r);
      S.bShout = { text: v.last.r === 'miss' ? `${v.opp.nick} промахнулся` : v.last.r === 'sunk' ? `${v.opp.nick} потопил твой корабль` : `${v.opp.nick} попал!`, cls: v.last.r, until: Date.now() + 1600, board: 'm' };
    }
  }
  // Реакция соперника: показываем пузырь, если она новее последней увиденной
  const oe = v.emotes && v.emotes.opp;
  if (oe && oe.at !== S.bEmoteSeen && v.now - oe.at < 8000) {
    S.bEmoteSeen = oe.at;
    S.bEmote = { ...(S.bEmote || {}), opp: { e: oe.e, until: Date.now() + 3200 } };
    setTimeout(() => { if (S.battle) render(); }, 3300);
    sfx('vote');
  } else if (oe && S.bEmoteSeen == null) S.bEmoteSeen = oe.at;
  // Партия только что закончилась победой — канонада (один раз)
  if (S.bv && S.bv.id === v.id && S.bv.status !== 'done' && v.status === 'done') {
    if (v.winner === 'me') sfx('fanfare'); else if (!S.bResigned) sfx('lose');
  }
  S.bv = v; S.bvAt = Date.now();
}
async function loadBattle() {
  if (!S.battle) { S.bv = null; return; }
  try { setBattleView(await get(`/api/battle/${S.battle}`)); } catch { S.battle = null; S.bv = null; }
}
async function loadDm() {
  if (!S.dm) { S.dmView = null; return; }
  try { S.dmView = await get(`/api/crew/${S.dm}`); } catch { S.dm = null; S.dmView = null; }
}
// Бейдж вкладки после прочтения: заявки + непрочитанное в остальных переписках
function recountCrewBadge() {
  if (!S.state || !S.crew) return;
  S.state.badges.crew = S.crew.incoming.length + S.crew.list.reduce((a, f) => a + (f.id === S.dm ? 0 : f.unread), 0);
}
async function loadGangExtra() {
  if (!S.activeGang) { S.gx = null; return; }
  try { S.gx = await get(`/api/gangs/${S.activeGang}/extra`); } catch { S.gx = null; }
  try { S.guess = await get(`/api/gangs/${S.activeGang}/guess`); } catch { S.guess = null; }
}
async function loadBlitz() { try { S.blitz = await get('/api/blitz'); } catch { S.blitz = null; } }
async function loadQuiz() { try { S.quiz = (await get('/api/quiz')).items; } catch { S.quiz = []; } }

async function loadFeedback() {
  S.fbItems = (await get('/api/feedback')).items;
  if (S.state && S.state.badges) S.state.badges.feedback = 0;
}

async function loadPeople() { try { S.people = (await get('/api/people')).people; } catch { S.people = []; } }
async function loadChats() {
  try { S.chats = await get('/api/chats'); } catch { S.chats = { items: [], requests: [] }; }
  try { S.invites = (await get('/api/invites')).items; } catch { S.invites = []; }
}
// Вкладки: «Рядом» — кто где, «Чаты» — банды и личка, «Офис» — столовая и лента, «Игры» — всё игровое
async function refresh({ all = false } = {}) {
  if (!S.me || !S.me.nick) return;
  const t = S.tab;
  const jobs = [loadState()];
  if (all || t === 'near') jobs.push(loadPeople());
  if (all || t === 'near' || t === 'office' || t === 'games') jobs.push(loadFeatures());
  if (all || t === 'chats') jobs.push(loadChats());
  if (all || t === 'chats' || t === 'games') jobs.push(loadCrew());
  if (all || (t === 'chats' && S.chatGang) || t === 'games') jobs.push(loadGang(), loadGangExtra());
  if (all || t === 'office') jobs.push(loadEvents());
  if (all || t === 'games') jobs.push(loadQuiz(), loadBlitz());
  if (t === 'chats' && S.battle) jobs.push(loadBattle());
  if (t === 'chats' && S.dm) jobs.push(loadDm());
  await Promise.all(jobs);
  if (t === 'chats' && S.dm && S.crew) { const f = S.crew.list.find((x) => x.id === S.dm); if (f) f.unread = 0; recountCrewBadge(); }
  if (t === 'chats' && S.chatGang) markSeen('chat');
  if (t === 'office') markSeen('feed');
}
function markSeen(kind) {
  const t = S.state ? S.state.now : Date.now();
  if (kind === 'chat') { S.seenChat = t; store.set('seenChat', t); if (S.state) S.state.badges.chat = 0; }
  else { S.seenFeed = t; store.set('seenFeed', t); if (S.state) S.state.badges.feed = 0; }
}

// ---------- Рендер ----------
function render() {
  const keepScroll = window.scrollY;
  // Фоновое обновление не должно стирать то, что человек сейчас печатает
  const a = document.activeElement;
  const focused = a && a.id && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') ? { id: a.id, v: a.value, s: a.selectionStart } : null;
  const chat = $('#dm-chat');
  const chatAtBottom = !chat || chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
  const sheetEl = document.querySelector('.sheet');
  const keepSheet = sheetEl && S.lastSheet === S.sheet ? sheetEl.scrollTop : 0;
  S.lastSheet = S.sheet;
  // Зёрна прибавились — покажем «+N» и пересчитаем число вверх
  if (S.me && S.me.nick) {
    if (S.shownBeans != null && S.me.beans > S.shownBeans && !S.beanFx) S.beanFx = { from: S.shownBeans, to: S.me.beans, fresh: true };
    S.shownBeans = S.me.beans;
  }
  if (!S.me) root.innerHTML = renderLogin();
  else if (!S.me.nick) root.innerHTML = renderNick();
  else root.innerHTML = renderApp();
  window.scrollTo(0, keepScroll);
  if (S.beanFx && S.beanFx.fresh) runBeanFx();
  if (focused) {
    const el = document.getElementById(focused.id);
    if (el) { el.value = focused.v; el.focus({ preventScroll: true }); try { el.setSelectionRange(focused.s, focused.s); } catch {} }
  }
  const chat2 = $('#dm-chat');
  if (chat2 && chatAtBottom) chat2.scrollTop = chat2.scrollHeight;
  const sheetNew = document.querySelector('.sheet');
  if (sheetNew && keepSheet) sheetNew.scrollTop = keepSheet;
}

function renderLogin() {
  const o = S.onb;
  const params = new URLSearchParams(location.search);
  const expired = params.get('login') === 'expired';
  if (o.step === 'sent') {
    return `<div class="onb">
      <div class="logo">Этаж<span>.</span></div>
      <div class="card">
        <h2>Проверь почту</h2>
        <p class="sub">Мы отправили ссылку и код на <b>${esc(o.email)}</b>. Ссылка и код работают 15 минут.</p>
        <p class="sub">На iPhone в установленном приложении удобнее ввести код — ссылка откроется в Safari.</p>
        <label class="field">Код из письма<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></label>
        ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
        <button class="btn wide" data-act="code-submit">Войти</button>
        ${o.devLink ? `<div class="note warn">Режим разработки: письмо не отправлялось. <a href="${esc(o.devLink)}">Войти по ссылке</a> или код <b>${esc(o.devCode)}</b></div>` : ''}
        <button class="linkbtn" data-act="onb-back">Ввести другую почту</button>
      </div>
    </div>`;
  }
  return `<div class="onb">
    <div class="logo">Этаж<span>.</span></div>
    <p class="sub" style="color:#C9D1EA">Неофициальное приложение для своих: кто из твоей банды в офисе, есть ли очередь в столовой, позвать на кофе одной кнопкой.</p>
    <div class="card">
      <h2>Вход по рабочей почте</h2>
      <p class="sub">Только ${S.domains.map((d) => '@' + esc(d)).join(', ')}. Почту мы не храним — только её зашифрованный отпечаток. Остальные видят только твой ник.</p>
      ${expired ? '<div class="err">Ссылка устарела или уже использована. Запроси новую.</div>' : ''}
      <label class="field">Рабочая почта<input id="email" type="email" inputmode="email" autocomplete="email" placeholder="name@${esc(S.domains[0])}" value="${esc(o.email)}"></label>
      <label class="check"><input id="consent" type="checkbox"> <span>Согласен с <a href="/privacy.html" target="_blank" rel="noopener">политикой обработки данных</a> и <a href="/rules.html" target="_blank" rel="noopener">правилами</a></span></label>
      ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
      <button class="btn wide" data-act="login-submit" ${S.busy ? 'disabled' : ''}>Получить ссылку для входа</button>
    </div>
  </div>`;
}

function renderNick() {
  const o = S.onb;
  return `<div class="onb">
    <div class="logo">Этаж<span>.</span></div>
    <div class="card">
      <h2>Придумай никнейм</h2>
      <p class="sub">По нему тебя узнают на Этаже. ФИО и должность оставь для почты, здесь веселее под псевдонимом.</p>
      <div class="nick-rules">
        <p><b>Можно почти всё:</b> гроза_дедлайнов, повелитель_кофемашины, просто_Петя. Буквы, цифры и «_», от 3 до 20 символов.</p>
        <p><b>Нельзя:</b> мат, оскорбления и шутки, над которыми смеёшься только ты. Проверка простая: такой ник не стыдно произнести вслух на планёрке.</p>
        <p><b>Передумаешь</b> — сменишь в профиле когда угодно за ${S.cat ? S.cat.nickPrice : 50} зёрен. Первый ник бесплатный, старый после смены сразу освобождается.</p>
      </div>
      <div class="chips">${o.nicks.map((n) => `<button class="chip" data-act="nick-pick" data-v="${esc(n)}">${esc(n)}</button>`).join('')}
        <button class="chip" data-act="nick-more">Ещё варианты</button></div>
      <label class="field">Никнейм<input id="nick" maxlength="21" autocomplete="off" placeholder="бодрый_енот" value="${esc(o.nick || '')}"></label>
      <div class="field">Аватар
        <div class="row">${['m', 'f'].map((p) => `<button class="chip ${(o.preset || 'm') === p ? 'on' : ''}" data-act="onb-preset" data-v="${p}">${avatar({ preset: p, hairStyle: p === 'f' ? 'long' : 'short' }, 28)} ${p === 'm' ? 'М' : 'Ж'}</button>`).join('')}</div>
      </div>
      ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
      <button class="btn wide" data-act="nick-submit">Готово</button>
    </div>
  </div>`;
}

function renderApp() {
  const me = S.me;
  const b = (S.state && S.state.badges) || { chat: 0, feed: 0, crew: 0 };
  const showBanner = !isStandalone() && store.get('installHiddenUntil', 0) < Date.now();
  return `
  <div class="app">
    <header class="top">
      <button class="who" data-act="open" data-v="profile" aria-label="Мой профиль, уровень ${me.level || 1}">
        <span class="me-ava ${S.coach === 1 ? 'coach-focus' : ''}">${b.feedback ? '<span class="bdot" aria-hidden="true"></span>' : ''}${me.completion && me.completion.pct < 100 ? `<span class="pring sm" style="--p:${me.completion.pct}" title="Профиль заполнен на ${me.completion.pct}%">${avatar(me.look, 40)}</span>` : avatar(me.look, 40)}<span class="lvl" aria-hidden="true">${me.level || 1}</span></span>
        <span style="min-width:0;display:flex;flex-direction:column;gap:3px">
          <span class="nick-row"><span class="nick">${esc(me.nick)}</span><span class="chev" aria-hidden="true">›</span></span>
          <span class="row" style="gap:6px">
            ${me.status ? `<span class="status-chip">${esc(me.status)}</span>` : ''}
            ${me.streak ? `<span class="streak" title="Дней подряд с отметкой в офисе">${FLAME}${me.streak} ${plural(me.streak, 'день', 'дня', 'дней')}</span>` : ''}
          </span>
        </span>
      </button>
      <button class="beans3d ${S.beanFx ? 'gain' : ''} ${S.coach === 2 ? 'coach-focus' : ''}" data-act="open" data-v="shop" aria-label="Зёрна: ${me.beans}. Открыть лавку${shopDot() ? '. Есть что купить' : ''}">${BEAN}<span class="bnum">${S.beanFx ? S.beanFx.from : me.beans}</span><span class="bcart"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11h10.2L20 8H6.3"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="16.5" cy="19.5" r="1.4"/></svg></span>${shopDot() ? '<span class="bdot" aria-hidden="true"></span>' : ''}${S.beanFx ? `<span class="bplus" aria-hidden="true">+${S.beanFx.to - S.beanFx.from}</span>` : ''}</button>
    </header>
    ${renderCoach()}
    ${S.newBuild ? '<button class="upd-bar" data-act="reload">✨ Вышло обновление — нажми, чтобы обновить</button>' : ''}
    <main>
      ${showBanner ? `<div class="banner">
        <div class="grow"><div style="font-weight:900;font-size:15px">Установи на телефон</div><div style="font-size:12px;font-weight:600">Иконка на экране — и придут зовы банды</div></div>
        <button class="btn small blue" data-act="open" data-v="install">Как?</button>
        <button class="x" style="background:none" data-act="install-hide" aria-label="Скрыть на сутки">×</button>
      </div>` : ''}
      ${S.tab === 'near' ? renderNear() : S.tab === 'chats' ? renderChats() : S.tab === 'office' ? renderOfficeTab() : renderGames()}
    </main>
    <nav class="tabs"><div class="in">
      ${tabBtn('near', 'Рядом', 0)}${tabBtn('chats', 'Чаты', (b.chat || 0) + (b.crew || 0) + (b.invites || 0) + (b.polls || 0))}${tabBtn('office', 'Офис', 0)}${tabBtn('games', 'Игры', (S.quiz || []).filter((z) => !z.answered).length + (S.battles || []).filter((x) => x.myTurn && x.status !== 'done').length)}
    </div></nav>
  </div>
  ${S.sheet ? renderSheet() : ''}`;
}

function tabBtn(id, label, n) {
  const icons = {
    near: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 5.5 2 5.5 5.5"/>',
    chats: '<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.4 8.4 0 1 1 21 11.5z"/><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01"/>',
    games: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
    office: '<path d="M4 21V5l8-3 8 3v16z"/><path d="M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2"/>',
    gang: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 5.5 2 5.5 5.5"/>',
    feed: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    crew: '<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.4 8.4 0 1 1 21 11.5z"/><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01"/>'
  };
  const focus = S.coach && COACH[S.coach] && COACH[S.coach].tab === id ? 'coach-focus' : '';
  return `<button class="tab ${S.tab === id ? 'on' : ''} ${focus}" data-act="tab" data-v="${id}" aria-current="${S.tab === id}">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[id]}</svg>
    ${label}${n ? `<span class="badge" aria-label="новых: ${n}">${n > 9 ? '9+' : n}</span>` : ''}</button>`;
}

// ----- Офис -----
// ===== Вкладка «Рядом»: мой статус и все мои люди одним списком =====
const pageHead = (title, sub) => `<div class="page-head"><h1>${title}</h1><p>${sub}</p></div>`;
// ----- Выбор офиса: одна большая кнопка «мой офис» и список остальных в шторке -----
// Офисов может быть сколько угодно: на экране всегда одна кнопка, остальные — в списке с поиском
const officeColor = (o) => OFFICE_BG[o.id] || o.color || '#3A86FF';
function recentOffices() { try { return (store.get('recentOffices', []) || []).filter((id) => S.cat.offices.some((o) => o.id === id)); } catch { return []; } }
function primaryOffice() {
  const offs = S.cat.offices;
  const home = S.me && S.me.profile && S.me.profile.home;
  return offs.find((o) => o.id === home) || offs.find((o) => o.id === recentOffices()[0]) || offs[0];
}
function officePicker() {
  const o = primaryOffice();
  if (!o) return '';
  const others = S.cat.offices.length - 1;
  const isHome = S.me.profile && S.me.profile.home === o.id;
  const sub = isHome ? 'мой офис · отметиться в одно касание' : recentOffices()[0] === o.id ? 'был здесь в прошлый раз' : 'свой офис отметь ★ в «Другой офис»';
  return `<button class="office-btn" style="background:${officeColor(o)}" data-act="checkin" data-v="${esc(o.id)}">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5l8-3 8 3v16z"/><path d="M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2"/></svg>
      <span class="grow"><span class="ob-name">${esc(o.name)}</span><span class="ob-sub">${sub}</span></span></button>
    ${others > 0 ? `<button class="office-more" data-act="open" data-v="office"><span class="grow">Другой офис</span><span class="small">ещё ${others}</span><span aria-hidden="true">›</span></button>` : ''}`;
}
function renderOfficeList() {
  const all = S.cat.offices;
  const cur = S.state && S.state.checkin && S.state.checkin.office;
  const home = S.me.profile && S.me.profile.home;
  const qv = (S.officeQ || '').trim().toLocaleLowerCase('ru');
  const row = (o) => `<div class="ofl-row ${o.id === cur ? 'cur' : ''}">
      <button class="ofl-pick" data-act="checkin" data-v="${esc(o.id)}"><span class="ofl-dot" style="background:${officeColor(o)}"></span><span class="grow">${esc(o.name)}</span>${o.id === cur ? '<span class="small">сейчас здесь</span>' : ''}</button>
      <button class="ofl-star ${o.id === home ? 'on' : ''}" data-act="prof" data-k="home" data-v="${esc(o.id)}" aria-label="${o.id === home ? 'Убрать из «мой офис»' : 'Сделать моим офисом'}" title="${o.id === home ? 'Мой офис' : 'Сделать моим офисом'}">${o.id === home ? '★' : '☆'}</button></div>`;
  const recent = recentOffices().map((id) => all.find((o) => o.id === id)).filter(Boolean).slice(0, 3);
  const list = (qv ? all.filter((o) => o.name.toLocaleLowerCase('ru').includes(qv)) : all).slice().sort((x, y) => x.name.localeCompare(y.name, 'ru'));
  return `${all.length > 6 ? `<label class="field" style="gap:0"><span class="hidden">Поиск офиса</span><input id="office-q" placeholder="Найти офис" value="${esc(S.officeQ || '')}" autocomplete="off"></label>` : ''}
    ${!qv && recent.length && all.length > 4 ? `<div class="eyebrow" style="margin-top:6px">Недавние</div>${recent.map(row).join('')}<div class="eyebrow" style="margin-top:10px">Все офисы</div>` : ''}
    ${list.length ? list.map(row).join('') : '<p class="sub">Ничего не нашли. Нет твоего офиса — напиши в «Идеи и ошибки», добавим.</p>'}
    <p class="small" style="margin:8px 0 0">★ — «мой офис»: он будет на главной кнопке, отмечаться в одно касание.${cur ? ' Зёрна за отметку — один раз в день.' : ''}</p>`;
}

function renderStatusBlock() {
  const st = S.state;
  if (st.night) return `${renderToday()}<div class="card"><h2>Офисы засыпают</h2><p class="sub">После 19:00 отметки сбрасываются. Утром отметься снова — увидишь, кто из твоих рядом.</p></div>`;
  if (!st.checkin) {
    return `${renderToday()}<div class="card">
      <h2>${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? 'Всё-таки в офисе?' : 'Где ты сегодня?'}</h2>
      ${officePicker()}
      ${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? '' : `<div class="today-grid">
        <button class="btn ghost" data-act="today" data-v="home">🏠 Из дома</button>
        <button class="btn ghost" data-act="open" data-v="sick">🤒 Болею</button>
        <button class="btn ghost" data-act="open" data-v="vacation">🌴 В отпуске</button>
        <button class="btn ghost" data-act="today" data-v="slack">😏 Отлыниваю</button></div>`}
      <p class="small">Отметка в офисе — до 19:00. +5 зёрен в день — за офис или «из дома», что раньше. Твои люди увидят, где ты.</p>
    </div>`;
  }
  const here = (S.people || []).filter((r) => r.where === 'office' && r.office === st.checkin.office).length;
  const hour = Number(st.msk.slice(0, 2));
  return `<section class="office-card">
    <div class="office-pic">${officeSvg({ office: st.checkin.office, crowd: here, hour, label: esc('Офис ' + st.checkin.name) })}</div>
    <div class="office-info">
      <div class="row" style="align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="display:flex;flex-direction:column;gap:2px"><span class="eyebrow">Ты в офисе</span><span class="office-name">${esc(st.checkin.name)}</span></div>
        <button class="icon-btn" data-act="open" data-v="office" aria-label="Сменить офис">${ico('swap', 16)}</button>
      </div>
      <span class="small">с ${st.checkin.since || ''} · твоих здесь <b style="color:#1F7A3A">${here}</b> · до 19:00</span>
      <button class="btn small ghost" style="align-self:flex-start" data-act="checkout">Ушёл домой</button>
    </div>
  </section>`;
}

function personRow(p) {
  const [w, color] = whereText(p);
  const st = S.state;
  const sameOffice = st.checkin && p.where === 'office' && p.office === st.checkin.office;
  const away = p.where === 'vacation' || p.where === 'sick';
  const action = p.unread ? `<button class="btn small" data-act="dm-open" data-id="${p.id}">💬 ${p.unread}</button>`
    : away ? '<span class="small">отдыхает</span>'
    : sameOffice ? `<button class="btn small" data-act="pcall" data-id="${p.id}" data-kind="coffee">На кофе</button>`
    : `<button class="btn small ghost" data-act="pcall-open" data-id="${p.id}">Позвать</button>`;
  const tagline = [p.mood && p.where === 'office' ? p.mood : '', p.gangs.length ? p.gangs.map((g) => g.name).join(', ') : ''].filter(Boolean).join(' · ');
  return `<div class="person2">
    ${tap(p.id, `<span class="ava-wrap" style="opacity:${away ? 0.6 : 1}"><span class="ava-ring" style="border-color:${color}">${avatar(p.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>`)}
    <div class="grow" style="min-width:0"><div class="tapname" style="font-weight:800;font-size:15px" data-act="person" data-id="${p.id}">${esc(p.nick)}</div>${p.name ? `<div class="realname">${esc(p.name)}</div>` : ''}
      <div class="where ellipsis">${esc(w)}${tagline ? ' · ' + esc(tagline) : ''}</div></div>
    ${action}</div>`;
}

function renderPeople() {
  const ps = S.people;
  if (!ps) return '<div class="card"><p class="sub">Загружаем твоих людей…</p></div>';
  if (!ps.length) {
    return `<section class="card empty"><div class="empty-ico">👋</div><h2>Пока здесь пусто</h2>
      <p class="sub">Тут появятся члены твоих банд: кто в офисе, кто дома, кто в отпуске. Сколоти банду и позови в неё своих по ссылке — или вступи в банду по приглашению.</p>
      <div class="row"><button class="btn grow" data-act="open" data-v="gang-new">Сколотить банду</button></div></section>`;
  }
  const st = S.state;
  const groups = [
    ['Со мной в офисе', (p) => st.checkin && p.where === 'office' && p.office === st.checkin.office],
    ['В офисе', (p) => p.where === 'office' || p.where === 'plan_office'],
    ['Работают из дома', (p) => p.where === 'home' || p.where === 'slack'],
    ['Отдыхают', (p) => p.where === 'vacation' || p.where === 'sick'],
    ['Пока не отметились', () => true]
  ];
  const left = [...ps];
  const html = groups.map(([title, test]) => {
    const g = left.filter(test);
    for (const x of g) left.splice(left.indexOf(x), 1);
    return g.length ? `<div class="pgroup"><div class="eyebrow">${title} · ${g.length}</div>${g.map(personRow).join('')}</div>` : '';
  }).join('');
  const hint = S.fx && S.fx.weekHint ? `<div class="week-hint">${ico('where', 16)}<span>${S.fx.weekHint.today ? 'Сегодня' : esc(S.fx.weekHint.label)} в офисе будут <b>${S.fx.weekHint.office} из ${S.fx.weekHint.total}</b> из банды</span></div>` : '';
  return `<section class="card people">${html}${hint}
    <div class="row" style="justify-content:space-between">${S.me.gangs.length ? `<button class="linkbtn" data-act="gang-invite" data-id="${S.activeGang || S.me.gangs[0].id}">+ Позвать в банду</button>` : '<span></span>'}<button class="linkbtn" data-act="open" data-v="gang-new">Сколотить банду</button></div></section>`;
}

function renderNear() {
  if (!S.state) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  return `${pageHead('Рядом', 'Где ты сегодня и кто из твоих людей рядом')}
    ${renderStatusBlock()}
    ${(S.people && !S.people.length) || !S.me.gangs.length ? findBar() : ''}
    ${renderQuickCalls()}
    ${renderBirthdays()}
    ${renderPeople()}`;
}

const findBar = () => `<button class="find-bar" data-act="find-open">${ico('search', 18)}<span>Найти своих: по нику, имени или почте</span></button>`;

function renderFind() {
  const f = S.find || {};
  const res = f.items ? (f.items.length ? f.items.map((x) => {
    let act = '';
    if (x.shared.length) act = `<button class="btn small" data-act="dm-open" data-id="${x.id}">Написать</button>`;
    else if (!S.me.gangs.length) act = '<span class="small">сначала сколоти банду</span>';
    const inv = x.invitable.map((g) => g.pending ? `<span class="chip" style="cursor:default">«${esc(g.name)}» · ждём ответа</span>` : `<button class="chip" data-act="find-invite" data-gang="${g.id}" data-id="${x.id}">Позвать в «${esc(g.name)}»</button>`).join('');
    return `<div class="find-row"><div class="person2">${tap(x.id, avatar(x.look, 40))}<div class="grow" style="min-width:0"><div style="font-weight:900">${esc(x.nick)}</div>
      <div class="where ellipsis">${[x.name, x.status, x.shared.length ? 'в банде ' + x.shared.join(', ') : ''].filter(Boolean).map(esc).join(' · ') || 'пока не в твоих бандах'}</div></div>${act}</div>
      ${inv ? `<div class="chips">${inv}</div>` : ''}</div>`;
  }).join('') : `<p class="sub">${esc(f.hint || 'Никого не нашли')}</p>`) : '<p class="small">Ник — по части, например «енот». Имя — только если человек открыл его всем. Почта — целиком, например ivanov@mts.ru: мы сравниваем отпечаток и сами адреса не храним.</p>';
  return `<div class="row"><label class="field grow" style="gap:0"><span class="hidden">Ник, имя или почта</span><input id="find-q" maxlength="80" autocapitalize="off" autocomplete="off" placeholder="Ник, имя или рабочая почта" value="${esc(f.q || '')}" aria-label="Ник, имя или рабочая почта"></label><button class="btn" data-act="find-go">Найти</button></div>
    ${res}
    <p class="small" style="margin:0">Позвать можно только в свою банду — человек сам решит, вступать ли. Не хочешь, чтобы тебя находили, — выключи в профиле: «Приватность, звук и уведомления».</p>`;
}

// ===== Вкладка «Чаты»: банды и личные переписки одним списком =====
function renderChats() {
  if (S.dm) return S.battle ? renderBattle() : renderDm();
  if (S.chatGang) return `<button class="linkbtn back" data-act="chats-back">‹ Все чаты</button>${renderGang()}`;
  const c = S.chats;
  if (!c) return pageHead('Чаты', 'Банды и личные переписки') + '<div class="card"><p class="sub">Загружаем…</p></div>';
  const seenG = store.get('seenGang', {});
  const reqs = c.requests.length ? `<section class="card"><h3>Хотят переписываться</h3>${c.requests.map((p) => `<div class="person2">${tap(p.id, avatar(p.look, 36))}<div class="grow ellipsis" style="font-weight:800;min-width:0">${esc(p.nick)}</div>
      <button class="btn small" data-act="crew-accept" data-id="${p.id}">Принять</button><button class="btn small ghost" data-act="crew-decline" data-id="${p.id}" aria-label="Отклонить">✕</button></div>`).join('')}</section>` : '';
  const row = (x) => {
    if (x.type === 'gang') {
      const unread = x.last && !x.last.mine && x.lastAt > (seenG[x.id] || 0);
      return `<button class="chat-row" data-act="gang-open" data-id="${x.id}">
        <span class="chat-gang" style="background:${esc(x.color)}">${esc(x.name.slice(0, 1).toUpperCase())}</span>
        <span class="grow" style="min-width:0"><span class="chat-title">${esc(x.name)} <span class="small">· ${x.members}</span></span>
          <span class="where ellipsis ${unread ? 'unread' : ''}">${x.last ? `${x.last.mine ? 'Ты' : esc(x.last.who || '')}: ${esc(x.last.text || '')}` : 'Сообщений пока нет — начни первым'}</span></span>
        <span class="crew-side">${x.lastTime ? `<span class="small">${x.lastTime}</span>` : ''}${x.polls ? `<span class="poll-badge" title="Опросы без твоего голоса">📊 ${x.polls}</span>` : unread ? '<span class="crew-badge">•</span>' : ''}</span></button>`;
    }
    const [w, color] = whereText(x);
    const turn = (S.battles || []).find((b) => b.oppId === x.id && b.myTurn && b.status !== 'done');
    return `<button class="chat-row" data-act="dm-open" data-id="${x.id}">
      <span class="ava-wrap"><span class="ava-ring" style="border-color:${color}">${avatar(x.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>
      <span class="grow" style="min-width:0"><span class="chat-title">${esc(x.nick)}</span><span class="where ellipsis ${x.unread ? 'unread' : ''}">${x.last ? `${x.last.mine ? 'Ты: ' : ''}${esc(x.last.text || '')}` : esc(w)}</span></span>
      <span class="crew-side">${turn ? '<span class="crew-turn" title="Твой ход в морском бою">⚓</span>' : ''}${x.lastTime ? `<span class="small">${x.lastTime}</span>` : ''}${x.unread ? `<span class="crew-badge">${x.unread > 9 ? '9+' : x.unread}</span>` : ''}</span></button>`;
  };
  const gangs = c.items.filter((x) => x.type === 'gang');
  const dms = c.items.filter((x) => x.type !== 'gang');
  const dmUnread = dms.reduce((a, x) => a + (x.unread || 0), 0);
  const head = (title, n, act, label, hot) => `<div class="chats-head"><h3>${title}${n ? ` <span class="chats-n ${hot ? 'hot' : ''}">${n}</span>` : ''}</h3><button class="linkbtn" data-act="open" data-v="${act}">＋ ${label}</button></div>`;
  const gangList = gangs.length ? gangs.map(row).join('')
    : '<p class="sub chats-empty">Ты пока ни в одной банде. Сколоти свою — у неё будет общий чат и зовы на кофе и обед.</p><button class="btn" data-act="open" data-v="gang-new">Сколотить банду</button>';
  const dmList = dms.length ? dms.map(row).join('')
    : `<p class="sub chats-empty">${gangs.length ? 'Пока тихо. Напиши кому-нибудь из своих — один на один, банда не увидит.' : 'Лично можно писать тем, кто с тобой в банде. Сначала сколоти банду или вступи в неё.'}</p>`;
  return `${pageHead('Чаты', 'Общие чаты банд и личка с членами твоих банд')}
    ${findBar()}
    ${(S.invites || []).length ? `<section class="card"><h3>Тебя зовут в банду</h3>${S.invites.map((i) => `<div class="person2"><span class="chat-gang" style="background:${esc(i.gang.color)}">${esc(i.gang.name.slice(0, 1).toUpperCase())}</span>
      <div class="grow" style="min-width:0"><div style="font-weight:900">${esc(i.gang.name)}</div><div class="where">${i.gang.members} ${plural(i.gang.members, 'человек', 'человека', 'человек')} · зовёт ${esc(i.from)}</div></div>
      <button class="btn small" data-act="invite-accept" data-id="${i.id}">Вступить</button><button class="btn small ghost" data-act="invite-decline" data-id="${i.id}" aria-label="Отказаться">Нет</button></div>`).join('')}</section>` : ''}
    ${reqs}
    <section class="card chats">${head('Банды', gangs.length, 'gang-new', 'Сколотить')}<p class="small chats-hint">Общий чат на всю банду · сообщения живут 24 часа</p>${gangList}</section>
    <section class="card chats">${head('Личка', dmUnread ? `${dmUnread} ${plural(dmUnread, 'новое', 'новых', 'новых')}` : '', 'dm-pick', 'Написать', true)}<p class="small chats-hint">Один на один · видите только вы двое</p>${dmList}</section>`;
}

// ===== Вкладка «Офис»: столовая, обед компанией, сигналы и лента =====
function renderOfficeTab() {
  const st = S.state;
  if (!st) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  const where = st.checkin ? `Ты в офисе «${esc(st.checkin.name)}»` : 'Отметься на вкладке «Рядом», чтобы видеть свой офис';
  return `${pageHead('Офис', where)}
    ${st.checkin && st.canteen ? renderCanteen() : `<section class="card empty"><div class="empty-ico">🍽</div><p class="sub">Загрузка столовой, обед компанией и сигналы видны тем, кто отметился в офисе.</p><button class="btn" data-act="tab" data-v="near">Отметиться</button></section>`}
    ${st.checkin ? renderLunches() : ''}
    ${renderFeed()}`;
}

// ===== Вкладка «Игры»: задания, квизы, морской бой, кофе, ачивки, Лавка =====
function renderGames() {
  const f = S.fx;
  const got = f ? f.achievements.filter((a) => a.got).length : 0;
  const active = (S.battles || []).filter((b) => b.status !== 'done');
  const nickOf = (id) => ((S.people || []).find((p) => p.id === id) || (S.crew && S.crew.list.find((p) => p.id === id)) || {}).nick || 'соперник';
  const battle = `<section class="card games-sea">
    <div class="row" style="justify-content:space-between"><span class="card-title">⚓ Морской бой</span><span class="small">по 1 на 1</span></div>
    ${active.length ? active.map((b) => `<button class="chat-row" data-act="battle-go" data-id="${b.id}" data-opp="${b.oppId}"><span class="grow"><span class="chat-title">${esc(nickOf(b.oppId))}</span><span class="where">${b.mode === 'fast' ? '⚡ быстрая · ' : ''}${b.status === 'setup' ? 'расстановка' : b.myTurn ? 'твой ход!' : 'ход соперника'}</span></span>${b.myTurn ? '<span class="crew-badge">!</span>' : ''}</button>`).join('') : '<p class="small" style="margin:0">Нет активных партий.</p>'}
    <button class="btn small" data-act="open" data-v="battle-pick">Вызвать на бой</button>
  </section>`;
  return `${pageHead('Игры', 'Задания, квизы и бои со своими. За всё дают зёрна, их тратят в Лавке')}
    ${renderQuests()}
    ${renderBlitzCard()}
    ${renderQuiz()}
    ${S.me.gangs.length > 1 ? `<div class="chips dark">${S.me.gangs.map((g) => `<button class="chip ${g.id === S.activeGang ? 'on' : ''}" data-act="gang-select" data-v="${g.id}">${esc(g.name)}</button>`).join('')}</div>` : ''}
    ${renderGuess()}
    ${battle}
    ${renderCoffee()}
    ${renderCompletion()}
    <section class="card"><div class="row" style="justify-content:space-between"><span class="card-title">🏅 Ачивки</span><span class="small">${got} из ${f ? f.achievements.length : 0}</span></div>
      <div class="row"><button class="btn small ghost grow" data-act="open-sec" data-v="ach">Мои ачивки</button><button class="btn small grow" data-act="open" data-v="shop">🛒 Лавка</button></div></section>`;
}

function renderOffice() {
  const st = S.state;
  if (!st) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  if (st.night) {
    return `${renderToday()}${renderBirthdays()}<div class="card"><h2>Офисы засыпают</h2><p class="sub">После 19:00 отметки сбрасываются. Утром отметься снова — увидишь, кто из банды рядом и есть ли очередь в столовой.</p></div>${renderQuests()}${renderCoffee()}${renderGangNow()}`;
  }
  if (!st.checkin) {
    return `${renderToday()}<div class="card">
      <h2>${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? 'Всё-таки в офисе?' : 'Где ты сегодня?'}</h2>
      <p class="sub">Отметься — и увидишь свой офис: кто из банды рядом и есть ли очередь в столовой. +5 зёрен в день — за офис или «из дома».</p>
      ${officePicker()}
      <p class="small">Отметка действует до 19:00 или пока не нажмёшь «Ушёл». Видно только офис, где ты отметился.</p>
      ${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? '' : `<div class="today-grid">
        <button class="btn ghost" data-act="today" data-v="home">🏠 Из дома</button>
        <button class="btn ghost" data-act="open" data-v="sick">🤒 Болею</button>
        <button class="btn ghost" data-act="open" data-v="vacation">🌴 В отпуске</button>
        <button class="btn ghost" data-act="today" data-v="slack">😏 Отлыниваю</button></div>
        <p class="small">Не отметишься и ничего не выберешь — после 11:00 банда увидит шуточный статус вроде «в астрале».</p>`}
    </div>${renderBirthdays()}${renderQuests()}${renderCompletion()}${renderQuiz()}${renderCoffee()}${renderGangNow()}`;
  }
  const here = st.gangNow.rows.filter((r) => r.where === 'office' && r.office === st.checkin.office).length;
  const hour = Number(st.msk.slice(0, 2));
  const since = st.checkin.since || '';
  return `
  <section class="office-card">
    <div class="office-pic">${officeSvg({ office: st.checkin.office, crowd: here, hour, label: esc('Офис ' + st.checkin.name + (here ? ', из банды здесь: ' + here : '')) })}</div>
    <div class="office-info">
      <div class="row" style="align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="display:flex;flex-direction:column;gap:2px">
          <span class="eyebrow">Ты в офисе</span>
          <span class="office-name">${esc(st.checkin.name)}</span>
        </div>
        <button class="icon-btn" data-act="open" data-v="office" aria-label="Сменить офис">${ico('swap', 16)}</button>
      </div>
      <span class="small">с ${since} · из банды здесь <b style="color:#1F7A3A">${here}</b> · до 19:00</span>
      <button class="btn small ghost" style="align-self:flex-start" data-act="checkout">Ушёл домой</button>
    </div>
  </section>
  ${renderBirthdays()}
  ${renderQuests()}
  ${renderCompletion()}
  ${renderQuiz()}
  ${renderQuickCalls()}
  ${renderCanteen()}
  ${renderLunches()}
  ${renderCoffee()}
  ${renderGangNow()}
  ${renderSignalsMini()}`;
}

function renderQuickCalls() {
  if (!S.me.gangs.length) return '';
  const gang = S.activeGang || S.me.gangs[0].id;
  const items = [['coffee', 'На кофе', '#8B5A2B', '#5E3B1A'], ['lunch', 'На обед', '#1F7A3A', '#155C2B'], ['where', 'Ты где?', '#0E7490', '#0A5468']];
  return `<section class="qcalls" aria-label="Быстрые зовы банде">
    ${items.map(([k, label, bg, shade]) => `<button class="qcall" style="background:${bg};border-bottom-color:${shade}" data-act="call-open" data-kind="${k}" data-gang="${gang}">${ico(k, 22)}${label}</button>`).join('')}
    <button class="qcall" style="background:#4B5563;border-bottom-color:#2F3640" data-act="gang-open" data-id="${gang}">${ico('more', 22)}Ещё</button>
  </section>`;
}

function renderCanteen() {
  const st = S.state;
  const c = st.canteen;
  const tone = { good: '#1F7A3A', ok: '#1D5BBF', warn: '#B45309', bad: '#C81E1E' }[c.tone];
  const trend = c.trend === 'up' ? ['↑ набирается', 'up'] : c.trend === 'down' ? ['↓ пустеет', 'down'] : ['→ ровно', 'flat'];
  const f = c.forecast;
  const color = (v) => (v >= 0.85 ? '#E5484D' : v >= 0.7 ? '#F59E0B' : v >= 0.4 ? '#2563C9' : '#7BC79A');
  const bars = f && f.enough ? `
    <div class="fc" role="img" aria-label="Прогноз загрузки с 12:00 до 14:30, пик около ${f.peak}">
      ${f.slots.map((s, i) => `<span style="height:${Math.max(8, Math.min(100, Math.round(s.load * 100)))}%;background:${color(s.load)}${i === f.current ? ';outline:2px solid #1A2547;outline-offset:2px' : ''}"></span>`).join('')}
    </div>
    <div class="fc-axis"><span>12:00</span>${f.current >= 0 ? '<span>сейчас</span>' : ''}<span>${f.peak} пик</span><span>14:30</span></div>` : '';
  return `<section class="card">
    <div class="row" style="justify-content:space-between">
      <span class="card-title">${ico('lunch', 18)}Столовая</span>
      <span class="trend-chip ${trend[1]}">${trend[0]}</span>
    </div>
    <div class="row" style="align-items:flex-end;justify-content:space-between;gap:10px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <span class="big" style="color:${tone}">${esc(c.label)}</span>
        <span style="font-size:13px;font-weight:700;color:${c.wait ? '#B45309' : '#1F5F2E'}">${c.wait ? `Очередь ≈ ${c.wait} мин` : 'Очереди нет'}</span>
      </div>
      ${st.inCanteen
        ? '<button class="btn green" data-act="canteen-out">Поел</button>'
        : '<button class="btn" style="white-space:nowrap" data-act="canteen-in">Я тут · +2</button>'}
    </div>
    ${bars}
    <p class="note ${c.advice.tone}" style="margin:0">${esc(c.advice.text)}</p>
    ${c.lowData ? '<p class="small">Мало отметок за 15 минут, оценка примерная. Отмечайся в столовой, чтобы она стала точнее.</p>' : ''}
    ${renderFood()}
  </section>`;
}

// Оценка обеда: 👍/👎, метки и комментарий для модератора. Коллеги видят только сводку
function renderFood() {
  const f = S.fx && S.fx.food;
  if (!f) return '';
  const sum = f.n ? `<div class="food-sum"><span class="food-pct ${f.upPct >= 60 ? 'good' : f.upPct >= 40 ? 'mid' : 'bad'}">👍 ${f.upPct}%</span><span>${f.n} ${plural(f.n, 'оценка', 'оценки', 'оценок')} сегодня${f.top.length ? ' · ' + f.top.map((t) => `«${esc(t.toLowerCase())}»`).join(', ') : ''}</span></div>` : '';
  if (!f.canRate) return sum ? `<div class="food">${sum}</div>` : '';
  const d = S.foodDraft;
  if (f.mine && !d) {
    return `<div class="food">${sum}<div class="row" style="justify-content:space-between"><span class="small" style="font-weight:700">Твоя оценка: ${f.mine.up ? '👍 понравилось' : '👎 не очень'}${f.mine.tags.length ? ' · ' + f.mine.tags.map(esc).join(', ').toLowerCase() : ''}</span><button class="linkbtn" data-act="food-edit">изменить</button></div></div>`;
  }
  if (!d) {
    return `<div class="food">${sum}<div class="food-q">Как обед?</div><div class="row"><button class="btn grow food-up" data-act="food-pick" data-v="1">👍 Понравилось</button><button class="btn ghost grow" data-act="food-pick" data-v="0">👎 Не очень</button></div></div>`;
  }
  const tags = d.up ? f.tagsUp : f.tagsDown;
  return `<div class="food">${sum}<div class="food-q">${d.up ? '👍 Что понравилось?' : '👎 Что не так?'} <span class="small">до 3</span></div>
    <div class="chips">${tags.map((t) => `<button class="chip ${d.tags.includes(t) ? 'on' : ''}" data-act="food-tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <label class="field" style="gap:4px"><span class="small">Пару слов для столовой — увидит только модератор, без имени</span><input id="food-comment" maxlength="140" value="${esc(d.comment || '')}" placeholder="${d.up ? 'Например: отличный борщ' : 'Например: суп был холодный'}"></label>
    <div class="row"><button class="btn grow" data-act="food-send">Отправить${f.mine ? '' : ' · +1'}</button><button class="btn ghost" data-act="food-cancel">Отмена</button></div></div>`;
}

function renderSignalsMini() {
  const ev = S.events;
  if (!ev || !ev.office) return '';
  const list = ev.signals.slice(0, 2);
  return `<section class="card">
    <div class="row" style="justify-content:space-between">
      <span class="card-title">Сигналы офиса</span>
      <button class="btn small green" data-act="open" data-v="signal">+ Сообщить</button>
    </div>
    ${list.length ? list.map((s) => `<div class="sig">
      <span class="sig-ico ${s.type === 'food' ? 'food' : 'other'}">${ico(s.type === 'food' ? 'food' : 'alert', 20)}</span>
      <div class="grow"><div style="font-weight:700">${esc(s.label)}${s.confirmed ? ' ✓' : ''}</div>
        <div class="small">${[s.zone, s.time, s.up ? 'подтвердили ' + s.up : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
      ${s.mine || s.myVote === 1 ? '' : `<button class="btn small ghost" data-act="vote" data-id="${s.id}" data-v="1">Есть</button>`}
    </div>`).join('') : '<p class="small" style="margin:0">Пока тихо. Холодно, на кухне еда или кофе закончился — сообщи всем на этаже.</p>'}
    ${ev.signals.length > 2 ? `<button class="linkbtn" style="align-self:flex-start" data-act="tab" data-v="office">Все сигналы (${ev.signals.length})</button>` : ''}
  </section>`;
}

const ddmm = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');
function whereText(r) {
  if (r.where === 'office') return [r.officeName || officeName(r.office), '#1F7A3A'];
  if (r.where === 'home') return [r.planned ? 'из дома (по плану)' : 'работает из дома', '#2563C9'];
  if (r.where === 'plan_office') return ['собирается в офис (по плану)', '#7BC79A'];
  if (r.where === 'vacation') return [r.until === (S.state && S.state.today) ? 'в отпуске сегодня' : `в отпуске до ${ddmm(r.until)}`, '#F97316'];
  if (r.where === 'sick') return [r.until && r.until !== (S.state && S.state.today) ? `болеет до ${ddmm(r.until)} — выздоравливай!` : 'болеет — выздоравливай!', '#DC2626'];
  if (r.where === 'slack') return ['отлынивает 😏 (сам признался)', '#A855F7'];
  if (r.where === 'idle') return [(S.cat.idleJokes || [])[r.joke] || 'в астрале', '#9AA3B5'];
  if (r.where === 'weekend') return [r.holiday ? `выходной · ${r.holiday.replace(/ \(.*\)$/, '')}` : 'выходной', '#9AA3B5'];
  if (r.where === 'none') return ['ещё в пути', '#9AA3B5'];
  if (r.where === 'night') return ['офисы спят', '#9AA3B5'];
  return ['скрывает, где он', '#9AA3B5'];
}

// Плашка «мой статус сегодня» над выбором офиса
function renderToday() {
  const st = S.state;
  const p = st.presence;
  const vacIn = st.nextVacation ? Math.round((Date.parse(st.nextVacation.from) - Date.parse(st.today)) / 864e5) : 0;
  const next = st.nextVacation ? `<p class="small">Следующий отпуск: ${ddmm(st.nextVacation.from)}–${ddmm(st.nextVacation.to)} · ${vacIn === 1 ? 'уже завтра 🌴' : `через ${vacIn} ${plural(vacIn, 'день', 'дня', 'дней')}`}</p>` : '';
  if (p.where === 'vacation') {
    return `<section class="card" style="background:#FFF4E0">
      <h2>🌴 Ты в отпуске${p.until === st.today ? ' сегодня' : ` до ${ddmm(p.until)}`}</h2>
      <p class="sub">Банда видит статус «в отпуске», зовы не присылают пуши — прочитаешь в чате, когда вернёшься.</p>
      <div class="row" style="gap:8px"><button class="btn ghost grow" data-act="vac-end">Вышел из отпуска</button><button class="btn ghost grow" data-act="open" data-v="profile">График</button></div>
    </section>`;
  }
  if (p.where === 'sick') {
    return `<section class="card" style="background:#FDECEA">
      <h2>🤒 Болеешь${p.until !== st.today ? ` до ${ddmm(p.until)}` : ' сегодня'}</h2>
      <p class="sub">Выздоравливай! Банда видит «болеет», зовы не присылают пуши. Причину и подробности никто не видит.</p>
      <button class="btn ghost" data-act="today" data-v="">Выздоровел</button>
    </section>`;
  }
  if (p.where === 'slack') {
    return `<section class="card" style="background:#F3E8FF">
      <h2>😏 Сегодня отлыниваешь</h2>
      <p class="sub">Честность — лучшая политика. Банда видит «отлынивает (сам признался)».</p>
      <button class="btn ghost" data-act="today" data-v="">Ладно, работаю</button>
    </section>`;
  }
  if (p.where === 'idle') {
    return `<section class="card">
      <p class="sub">Ты не отметился, и банда видит про тебя шутку: <b>«${esc((S.cat.idleJokes || [])[p.joke] || 'в астрале')}»</b>. Выбери статус или отметься в офисе.</p>${next}
    </section>`;
  }
  if (p.where === 'home') {
    return `<section class="card">
      <h2>🏠 Сегодня из дома${p.planned ? '?' : ''}</h2>
      <p class="sub">${p.planned ? 'Так в твоём плане на этот день недели. Подтверди — банда увидит, что ты на связи из дома. +5 зёрен, как за офис, и задание «Отметься» засчитается.' : 'Отметка стоит: банда видит «работает из дома». Приедешь — просто отметься в офисе.'}</p>
      ${p.planned ? '<button class="btn" data-act="today" data-v="home">Да, сегодня из дома</button>' : '<div class="row" style="gap:8px;align-items:center"><span class="note good grow" style="margin:0">✓ Отмечено</span><button class="btn small ghost" data-act="today" data-v="">Отменить</button></div>'}${next}
    </section>`;
  }
  return next ? `<section class="card">${next}</section>` : '';
}
const officeName = (id) => (S.cat.offices.find((o) => o.id === id) || {}).name || '';

function renderGangNow() {
  const g = S.state.gangNow;
  if (!g.hasGang) {
    return `<section class="card"><h3>Моя банда сейчас</h3><p class="sub">Ты пока ни в одной банде. Сколоти свою или вступи по ссылке от своих.</p>
      <button class="btn blue" data-act="open" data-v="gang-new">Создать банду</button></section>`;
  }
  const dnd = S.cat.moods.dnd;
  const rows = g.rows.map((r) => {
    const [w, color] = whereText(r);
    const sameOffice = S.state.checkin && r.where === 'office' && r.office === S.state.checkin.office;
    const away = r.where === 'vacation' || r.where === 'sick';
    const quiet = r.mood === dnd;
    const action = r.where === 'vacation' ? '<span class="small">отдыхает</span>'
      : r.where === 'sick' ? '<span class="small">не беспокоим</span>'
      : quiet ? '<span class="small">тихо</span>'
      : `<button class="btn small ${sameOffice ? '' : 'ghost'}" data-act="call-open" data-kind="${sameOffice ? 'coffee' : r.where === 'home' ? 'call' : 'where'}" data-to="${r.id}" data-gang="${r.gangId}">${sameOffice ? 'На кофе' : r.where === 'home' ? 'Созвонимся?' : 'Ты где?'}</button>`;
    return `<div class="person2">
      ${tap(r.id, `<span class="ava-wrap" style="opacity:${away ? 0.6 : 1}"><span class="ava-ring" style="border-color:${color}">${avatar(r.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>`)}
      <div class="grow"><div style="font-weight:700;font-size:15px" class="tapname" data-act="person" data-id="${r.id}">${esc(r.nick)}</div>${r.name ? `<div class="realname">${esc(r.name)}</div>` : ''}
      <div class="where ellipsis">${esc(w)}${r.mood && r.where === 'office' ? ' · ' + esc(r.mood) : ''}</div></div>
      ${action}</div>`;
  }).join('');
  const gangName = (S.me.gangs.find((x) => x.id === (S.activeGang || S.me.gangs[0].id)) || {}).name || '';
  return `<section class="card"><div class="row" style="justify-content:space-between"><span class="card-title">Моя банда сейчас</span><button class="linkbtn" data-act="gang-open" data-id="${S.activeGang || S.me.gangs[0].id}">${esc(gangName)} ›</button></div>
    ${rows || '<p class="sub">В банде пока только ты. Позови своих по ссылке из банды.</p>'}
    ${g.more ? `<p class="small">и ещё ${g.more} — все во вкладке «Моя банда»</p>` : ''}
    ${S.fx && S.fx.weekHint ? `<div class="week-hint">${ico('where', 16)}<span>${S.fx.weekHint.today ? 'Сегодня' : esc(S.fx.weekHint.label)} в офисе будут <b>${S.fx.weekHint.office} из ${S.fx.weekHint.total}</b>${S.fx.weekHint.today ? '' : ' — хороший день, чтобы собраться'}</span></div>` : ''}
    ${!S.me.shareOffice ? '<div class="note warn">Банда не видит, где ты: офис, дома или в отпуске. <button class="linkbtn" data-act="share-on">Показывать банде</button></div>' : ''}
  </section>`;
}

// ----- Банда -----
// ----- Опросы банды -----
const pollLeft = (ts) => {
  const h = Math.max(0, Math.round((ts - Date.now()) / 3600e3));
  return h < 1 ? 'меньше часа' : h < 24 ? `${h} ${plural(h, 'час', 'часа', 'часов')}` : `${Math.round(h / 24)} ${plural(Math.round(h / 24), 'день', 'дня', 'дней')}`;
};
function renderPoll(p) {
  const who = (v) => v.length ? `<span class="poll-who">${esc(v.slice(0, 3).join(', '))}${v.length > 3 ? ` +${v.length - 3}` : ''}</span>` : '';
  return `<div class="poll ${p.closed ? 'closed' : ''} ${!p.closed && !p.voted && !p.mine ? 'todo' : ''}">
    ${!p.closed && !p.voted && !p.mine ? '<span class="poll-todo">Ждём твой голос</span>' : ''}
    <div class="poll-q">${esc(p.question)}</div>
    <div class="small">${esc(p.author)} · ${p.closed ? 'опрос завершён' : `ещё ${pollLeft(p.closesAt)}`} · ${p.total} ${plural(p.total, 'голос', 'голоса', 'голосов')}${p.multi ? ' · можно несколько' : ''}</div>
    <div class="poll-opts">${p.options.map((o) => `<button class="poll-opt ${o.me ? 'me' : ''} ${o.lead ? 'lead' : ''}" data-act="poll-vote" data-id="${p.id}" data-v="${o.id}" ${p.closed ? 'disabled' : ''} aria-pressed="${o.me}">
      <span class="poll-bar" style="width:${p.voted || p.closed ? o.pct : 0}%"></span>
      <span class="poll-mark" aria-hidden="true">${o.me ? '✓' : ''}</span>
      <span class="poll-txt"><span>${esc(o.text)}${o.lead ? ' 🏆' : ''}</span>${o.addedBy ? `<span class="poll-by">вариант от ${esc(o.addedBy)}</span>` : ''}${p.voted || p.closed ? who(o.voters) : ''}</span>
      ${p.voted || p.closed ? `<span class="poll-pct">${o.pct}%</span>` : ''}</button>`).join('')}</div>
    ${p.canAdd ? `<div class="row poll-add"><label class="field grow" style="gap:0"><span class="hidden">Свой вариант</span><input id="poll-add-${p.id}" maxlength="40" placeholder="Свой вариант"></label><button class="btn small ghost" data-act="poll-add" data-id="${p.id}">Добавить</button></div>` : ''}
    ${p.mine && !p.closed ? `<button class="linkbtn" data-act="poll-close" data-id="${p.id}">Завершить опрос</button>` : ''}
  </div>`;
}
function renderPolls() {
  const items = S.polls || [];
  return `<section class="card">
    <div class="chats-head"><h3>Опросы${items.filter((p) => !p.closed).length ? ` <span class="chats-n">${items.filter((p) => !p.closed).length}</span>` : ''}</h3><button class="linkbtn" data-act="poll-new">＋ Опрос</button></div>
    ${items.length ? items.map(renderPoll).join('') : '<p class="small" style="margin:4px 0 0">Куда идём обедать, когда собираемся, какую пиццу брать — спроси банду. Можно разрешить всем дописывать свои варианты.</p>'}
  </section>`;
}
function renderPollNew() {
  const d = S.pollDraft;
  return `<label class="field">Вопрос<input id="pd-q" maxlength="120" placeholder="Куда идём в пятницу?" value="${esc(d.q)}"></label>
    <div class="field">Варианты
      ${d.options.map((o, i) => `<input class="pd-o" data-i="${i}" maxlength="40" placeholder="Вариант ${i + 1}" value="${esc(o)}">`).join('')}
      ${d.options.length < 10 ? '<button class="linkbtn" style="align-self:flex-start" data-act="pd-more">＋ ещё вариант</button>' : ''}
    </div>
    <label class="check"><input type="checkbox" id="pd-open" ${d.open ? 'checked' : ''}> <span>Участники могут добавить свой вариант</span></label>
    <label class="check"><input type="checkbox" id="pd-multi" ${d.multi ? 'checked' : ''}> <span>Можно выбрать несколько</span></label>
    <div class="field">Сколько идёт опрос
      <div class="chips">${[[1, 'сутки'], [3, '3 дня'], [7, 'неделю']].map(([v, t]) => `<button class="chip ${d.days === v ? 'on' : ''}" data-act="pd-days" data-v="${v}">${t}</button>`).join('')}</div></div>
    <button class="btn" data-act="poll-create">Запустить опрос</button>
    <p class="small" style="margin:0">Банда получит пуш. Голоса видны по никам — это банда, а не выборы.</p>`;
}

function renderGang() {
  const gangs = S.me.gangs;
  let chips = gangs.length ? `<div class="chips dark">${gangs.map((g) => `<button class="chip ${g.id === S.activeGang ? 'on' : ''}" data-act="gang-select" data-v="${g.id}">${esc(g.name)}</button>`).join('')}</div>` : '';
  const create = `<section class="card">${gangs.length ? '<details><summary style="font-weight:900;cursor:pointer;min-height:32px">Создать ещё банду или вступить по ссылке</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">' : '<h3>Банды</h3>'}
    <p class="sub">Банда — твои люди: команда, соседи по этажу, кофейный клуб. Создание стоит ${50} зёрен залога — они вернутся, когда в банде будет 3 человека.</p>
    <label class="field">Название новой банды<input id="gang-name" maxlength="30" placeholder="Например, Пятничный кофе"></label>
    <button class="btn violet" data-act="gang-create">Создать банду · залог 50</button>
    <label class="field">Или вставь ссылку-приглашение<input id="gang-code" placeholder="https://…/g/ABC123"></label>
    <button class="btn ghost" data-act="gang-join">Вступить</button>
  ${gangs.length ? '</div></details>' : ''}</section>`;
  if (!gangs.length) return create;
  if (S.chatGang) chips = ''; // в чатах банду выбирают из списка — переключатель не нужен
  const v = S.gang;
  if (!v) return chips + '<div class="card"><p class="sub">Загружаем банду…</p></div>' + create;
  const g = v.gang;
  const members = v.members.map((m) => {
    const [w, color] = whereText(m);
    return `<div class="person">${tap(m.id, avatar(m.look, 34))}<div class="grow"><div style="font-weight:900" class="tapname" data-act="person" data-id="${m.id}">${esc(m.nick)}${m.me ? ' (ты)' : ''}</div>${m.name ? `<div class="realname">${esc(m.name)}</div>` : ''}
      <div class="where"><span class="dot" style="background:${color}"></span>${esc(w)}${m.mood && m.where === 'office' ? ' · ' + esc(m.mood) : ''}${m.status ? ' · ' + esc(m.status) : ''}</div></div>
      ${m.me ? '' : `<button class="btn small ghost" data-act="dm-open" data-id="${m.id}" aria-label="Написать лично">💬</button><button class="btn small ghost" data-act="call-open" data-kind="where" data-to="${m.id}" data-gang="${g.id}">Позвать</button>`}</div>`;
  }).join('');
  const msgs = v.messages.map(renderMsg).join('') || '<p class="sub">Сообщения и зовы живут 24 часа. Начни первым.</p>';
  return `${chips}
  <section class="card" style="${g.gold ? 'border:3px solid #FFC93C' : ''}">
    <div class="row"><span class="dot" style="width:14px;height:14px;background:${esc(g.color)}"></span><h2 class="grow">${esc(g.name)}</h2><span class="small">${v.gang.count} ${plural(v.gang.count, 'участник', 'участника', 'участников')}</span></div>
    ${g.motto ? `<p class="sub" style="font-style:italic">«${esc(g.motto)}»</p>` : ''}
    ${g.depositPending ? '<div class="note warn">Залог 50 зёрен вернётся, когда в банде будет 3 человека.</div>' : ''}
    <div class="calls">${Object.entries(S.cat.calls).map(([k, c]) => `<button class="call" style="background:${CALL_STYLE[k]}" data-act="call-open" data-kind="${k}" data-gang="${g.id}">${esc(c.label)}</button>`).join('')}</div>
  </section>
  ${renderPolls()}
  <section class="card">
    <h3>Чат</h3>
    <div class="chat" id="chat">${msgs}</div>
    <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Сообщение</span><input id="chat-text" maxlength="300" placeholder="Написать банде" aria-label="Сообщение банде"></label>
      <button class="btn" data-act="chat-send" aria-label="Отправить">→</button></div>
  </section>
  ${renderWeek()}
  ${renderThanks(v)}
  ${renderGangBirthdays()}
  <section class="card"><h3>Участники</h3><p class="small" style="margin:0">Нажми на человека, чтобы написать ему лично.</p>${members}
    <button class="btn blue" data-act="invite-share">Позвать в банду по ссылке</button>
    <p class="small">Ссылка: ${esc(g.link)}. Отправь её в рабочий мессенджер — вступить смогут только свои — с рабочей почтой.</p>
    <div class="row" style="justify-content:space-between">
      <button class="linkbtn" data-act="report" data-type="gang" data-id="${g.id}">Пожаловаться на банду</button>
      <button class="linkbtn" data-act="gang-leave">Выйти из банды</button>
    </div>
  </section>
  ${create}`;
}

function renderMsg(m) {
  const reps = m.replies.length ? `<div class="reps">${m.replies.map((r) => `<span class="rep">${esc(r.nick)}: ${esc(r.label)}</span>`).join('')}</div>` : '';
  if (m.type === 'call') {
    const to = m.toNick ? ` → ${esc(m.toNick)}` : '';
    const body = `<b>${esc(m.author)}</b> ${esc(m.callText)}${m.opt ? ` · ${esc(m.opt.toLowerCase())}` : ''}${m.text ? ` · ${esc(m.text)}` : ''}`;
    return `<div class="msg call-msg ${m.mine ? 'mine' : ''}">
      <div class="meta"><span>${m.time}${to}</span></div>
      <div class="text">${body}</div>${reps}
      ${m.canReply ? `<div class="chips">${m.replyOptions.map((l) => `<button class="chip" data-act="reply" data-id="${m.id}" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div><span class="small">Ответ: +1 зерно</span>` : ''}
    </div>`;
  }
  return `<div class="msg ${m.mine ? 'mine' : ''}">
    <div class="meta"><b>${esc(m.author)}</b><span>${m.time}</span>${m.mine ? '' : `<button class="linkbtn" data-act="report" data-type="message" data-id="${m.id}" aria-label="Пожаловаться">⚑</button>`}</div>
    <div class="text">${esc(m.text)}</div></div>`;
}

// ----- Подельники -----
// Кнопка «в подельники» у участника банды: прячется, если он уже подельник или заявка висит
function crewAddBtn(id) {
  const c = S.crew;
  if (!c) return '';
  if (c.list.some((x) => x.id === id)) return `<button class="btn small ghost" data-act="dm-open" data-id="${id}" aria-label="Написать подельнику">✉</button>`;
  if (c.outgoing.some((x) => x.id === id)) return '<span class="small">заявка ушла</span>';
  return `<button class="btn small ghost" data-act="crew-add-id" data-id="${id}" aria-label="Позвать в подельники" title="Позвать в подельники">＋</button>`;
}

function renderCrew() {
  if (S.battle) return renderBattle();
  if (S.dm) return renderDm();
  const c = S.crew;
  if (!c) return '<div class="card"><p class="sub">Загружаем подельников…</p></div>';
  const incoming = c.incoming.length ? `<section class="card"><h3>Зовут в подельники</h3>
    ${c.incoming.map((p) => `<div class="person2">${tap(p.id, avatar(p.look, 36))}<div class="grow ellipsis" style="font-weight:800;min-width:0">${esc(p.nick)}</div>
      <button class="btn small" data-act="crew-accept" data-id="${p.id}">Принять</button>
      <button class="btn small ghost" data-act="crew-decline" data-id="${p.id}" aria-label="Отклонить заявку">✕</button></div>`).join('')}
  </section>` : '';
  const rows = c.list.map((f) => {
    const [w, color] = whereText(f);
    const line = f.last ? `${f.last.mine ? 'Ты: ' : ''}${f.last.text}` : w;
    return `<button class="person2 crew-row" data-act="dm-open" data-id="${f.id}">
      <span class="ava-wrap"><span class="ava-ring" style="border-color:${color}">${avatar(f.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>
      <span class="grow" style="min-width:0"><span class="crew-nick">${esc(f.nick)}</span><span class="where ellipsis ${f.unread ? 'unread' : ''}">${esc(line)}</span></span>
      <span class="crew-side">${(S.battles.find((b) => b.oppId === f.id && b.myTurn && b.status !== 'done')) ? '<span class="crew-turn" title="Твой ход в морском бою">⚓</span>' : ''}${f.lastTime ? `<span class="small">${f.lastTime}</span>` : ''}${f.unread ? `<span class="crew-badge">${f.unread > 9 ? '9+' : f.unread}</span>` : ''}</span>
    </button>`;
  }).join('');
  return `${incoming}
  <section class="card">
    <div class="row" style="justify-content:space-between"><h2>Подельники</h2><span class="small">${c.list.length} из ${c.max}</span></div>
    <p class="sub">Твои люди один на один, без банды. Переписку и зовы видите только вы двое, сообщения живут ${c.ttlDays} ${plural(c.ttlDays, 'день', 'дня', 'дней')}.</p>
    ${rows || '<p class="sub"><b>Пока никого.</b> Позови по нику или скинь свою ссылку. Ещё можно нажать «＋» у человека в составе банды.</p>'}
  </section>
  <section class="card">
    <h3>Позвать в подельники</h3>
    <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Ник</span><input id="crew-nick" maxlength="21" placeholder="ник" autocapitalize="off" autocomplete="off" aria-label="Ник"></label>
      <button class="btn" data-act="crew-add">Позвать</button></div>
    <button class="btn blue" data-act="crew-share">Отправить свою ссылку</button>
    <p class="small">Кто откроет ссылку, сразу станет подельником, поэтому шли её лично, а не в общий чат. Заявка по нику ждёт согласия.</p>
    ${c.outgoing.length ? `<div class="crew-out"><span class="small">Ждём ответа:</span> ${c.outgoing.map((p) => `<span class="rep">${esc(p.nick)} <button class="linkbtn" data-act="crew-decline" data-id="${p.id}" aria-label="Отменить заявку">✕</button></span>`).join(' ')}</div>` : ''}
    ${c.blocked.length ? `<details><summary class="small" style="cursor:pointer;min-height:32px">Заблокированные (${c.blocked.length})</summary>
      ${c.blocked.map((p) => `<div class="row" style="justify-content:space-between"><span>${esc(p.nick)}</span><button class="linkbtn" data-act="crew-unblock" data-id="${p.id}">Разблокировать</button></div>`).join('')}</details>` : ''}
  </section>`;
}

function renderDm() {
  const v = S.dmView;
  if (!v) return '<div class="card"><p class="sub">Открываем переписку…</p></div>';
  const f = v.friend;
  const [w, color] = whereText(f);
  const msgs = v.messages.map((m) => renderDmMsg(m, f)).join('') || `<p class="sub">Тут пусто. Напиши первым или позови на кофе. Сообщения живут ${v.ttlDays} ${plural(v.ttlDays, 'день', 'дня', 'дней')}.</p>`;
  const away = f.where === 'vacation' || f.where === 'sick';
  return `
  <button class="linkbtn back" data-act="dm-back">‹ Все чаты</button>
  <section class="card">
    <div class="row">
      <span class="ava-wrap"><span class="ava-ring" style="border-color:${color}">${avatar(f.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>
      <div class="grow" style="min-width:0"><div style="font-weight:900;font-size:17px">${esc(f.nick)}</div><div class="where ellipsis">${esc(w)}${f.mood && f.where === 'office' ? ' · ' + esc(f.mood) : ''}</div></div>
    </div>
    ${away ? '<div class="note warn">Сейчас отдыхает: пуш не придёт, увидит, когда вернётся.</div>' : ''}
    <div class="chips">${v.calls.map((k) => `<button class="chip" data-act="dm-call-open" data-kind="${k}">${esc(S.cat.calls[k].label)}</button>`).join('')}<button class="chip meme-chip" data-act="meme-open" data-to="${f.id}">🖼 Мем</button></div>
  </section>
  ${renderBattleInvite(f)}
  <section class="card">
    <div class="chat" id="dm-chat">${msgs}</div>
    <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Сообщение</span><input id="dm-text" maxlength="500" placeholder="Написать ${esc(f.nick)}" aria-label="Личное сообщение"></label>
      <button class="btn" data-act="dm-send" aria-label="Отправить">→</button></div>
  </section>
  <section class="card">
    <p class="small">Переписку видите только вы двое. Модератор увидит сообщение, только если на него пожалуются (⚑).</p>
    <div class="row" style="justify-content:space-between">
      ${f.crew ? `<button class="linkbtn" data-act="crew-remove" data-id="${f.id}">Удалить контакт</button>` : '<span></span>'}
      <button class="linkbtn" data-act="crew-block" data-id="${f.id}">Заблокировать</button>
    </div>
  </section>`;
}

function renderBattleInvite(f) {
  const g = S.battles.find((b) => b.oppId === f.id && b.status !== 'done');
  const label = !g ? 'Вызвать на морской бой'
    : g.status === 'setup' ? (g.myTurn ? 'Расставь флот — тебя вызвали' : 'Партия: ждём соперника')
    : g.myTurn ? 'Твой ход в морском бою!' : 'Партия идёт: ход соперника';
  if (!g) {
    return `<div class="battle-invite pick"><span class="bi-ico" aria-hidden="true">⚓</span><span class="grow"><b>Морской бой</b>
      <span class="bi-modes"><button class="bi-mode" data-act="battle-new" data-id="${f.id}" data-mode="calm">🐢 Без спешки<small>ходите, когда удобно</small></button>
      <button class="bi-mode fast" data-act="battle-new" data-id="${f.id}" data-mode="fast">⚡ Быстрая<small>по 1,5 мин у каждого</small></button></span></span></div>`;
  }
  return `<button class="battle-invite ${g.myTurn ? 'hot' : ''}" data-act="battle-open" data-id="${g.id}">
    <span class="bi-ico" aria-hidden="true">${g.mode === 'fast' ? '⚡' : '⚓'}</span><span class="grow"><b>${label}</b><span class="small">${g.mode === 'fast' ? 'Быстрая партия · ' : ''}Нажми, чтобы открыть поле</span></span><span aria-hidden="true">›</span>
  </button>`;
}

const B_COLS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];
const EMOTES = { lol: ['😂', 'Ха-ха!'], angry: ['😡', 'Ну всё!'], bored: ['😴', 'Скукота'], smart: ['🧠', 'Умный ход'], oops: ['😱', 'Ой-ой'], clap: ['👏', 'Браво'], mercy: ['🙏', 'Пощади'], easy: ['😎', 'Изи'] };

// Части корпуса: нос, середина, корма — чтобы корабль выглядел кораблём, а не набором квадратов
function hullParts(ships) {
  const m = new Map();
  for (const sh of ships) {
    if (sh.length === 1) { m.set(sh[0][0] * 10 + sh[0][1], 'solo'); continue; }
    const horiz = sh[0][1] === sh[1][1];
    const sorted = [...sh].sort((p, q) => (horiz ? p[0] - q[0] : p[1] - q[1]));
    sorted.forEach(([x, y], i) => m.set(x * 10 + y, `${horiz ? 'h' : 'v'} ${i === 0 ? 'bow' : i === sorted.length - 1 ? 'stern' : 'mid'}`));
  }
  return m;
}

// Поле 10×10. kind: 'opp' — по нему стреляю я; 'me' — мой флот и выстрелы соперника
function renderBoard(v, kind) {
  const shots = kind === 'opp' ? v.myShots : v.oppShots;
  const shown = kind === 'me' ? v.myShips : (v.oppShips || v.oppSunk);
  const sunk = kind === 'opp' ? v.oppSunk : v.myShips.filter((sh) => sh.every(([x, y]) => v.oppShots.some((t) => t.x === x && t.y === y)));
  const hull = hullParts(shown);
  const sunkAt = new Set(); sunk.forEach((sh) => sh.forEach(([x, y]) => sunkAt.add(x * 10 + y)));
  const shotAt = new Map(shots.map((t) => [t.x * 10 + t.y, t]));
  const canShoot = kind === 'opp' && v.myTurn;
  const fresh = Date.now() < S.bFreshUntil ? S.bFresh : new Set();
  const pre = kind === 'opp' ? 'o' : 'm';
  const cells = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const k = x * 10 + y;
    const t = shotAt.get(k);
    const cls = ['bc'];
    const part = hull.get(k);
    if (part) cls.push('ship', ...part.split(' '), kind === 'opp' && !sunkAt.has(k) ? 'ghost' : '');
    if (t) cls.push(t.r === 'miss' ? (t.auto ? 'miss auto' : 'miss') : sunkAt.has(k) ? 'sunk' : 'hit');
    if (fresh.has(`${pre}:${x},${y}`) && !(t && t.auto)) cls.push('fresh');
    if (v.last && ((kind === 'opp' && v.last.mine) || (kind === 'me' && !v.last.mine)) && v.last.x === x && v.last.y === y) cls.push('lastshot');
    const label = `${B_COLS[x]}${y + 1}`;
    const inner = t && t.r !== 'miss' ? `<i>${sunkAt.has(k) ? '' : '🔥'}</i>` : '';
    cells.push(canShoot && !t
      ? `<button class="${cls.join(' ')} aim" data-act="bshoot" data-x="${x}" data-y="${y}" aria-label="Выстрел в ${label}"></button>`
      : `<span class="${cls.join(' ').trim()}" aria-label="${label}${t ? (t.r === 'miss' ? ' мимо' : ' попадание') : ''}">${inner}</span>`);
  }
  const shout = S.bShout && Date.now() < S.bShout.until && S.bShout.board === pre ? `<div class="b-shout ${S.bShout.cls}">${esc(S.bShout.text)}</div>` : '';
  return `<div class="board-wrap ${kind}">
    <div class="board-cols">${B_COLS.map((c) => `<span>${c}</span>`).join('')}</div>
    <div class="board-rows">${Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>
    <div class="board ${canShoot ? 'armed' : ''}">${cells.join('')}</div>${shout}
  </div>`;
}

function fleetLeft(ships, shots) {
  const hit = new Set(shots.filter((t) => t.r !== 'miss').map((t) => t.x * 10 + t.y));
  return ships.map((sh) => ({ len: sh.length, sunk: sh.every(([x, y]) => hit.has(x * 10 + y)) }));
}
const fleetBars = (arr) => `<div class="fleet">${arr.sort((a, b) => b.len - a.len).map((s) => `<span class="fl ${s.sunk ? 'sunk' : ''}" title="${s.len}-палубный${s.sunk ? ', потоплен' : ''}">${'<i></i>'.repeat(s.len)}</span>`).join('')}</div>`;

// Часы быстрой партии: сервер присылает остаток, дальше тикаем сами до следующего ответа
function clockNow(v, who) {
  if (!v.clock) return 0;
  const running = v.status === 'play' && (who === 'me' ? v.myTurn : !v.myTurn);
  return Math.max(0, v.clock[who] - (running ? Date.now() - (S.bvAt || Date.now()) : 0));
}
const fmtClock = (ms) => { const sec = Math.ceil(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
setInterval(() => {
  const v = S.bv;
  if (!S.battle || !v || !v.clock || v.status !== 'play') return;
  for (const el of document.querySelectorAll('.vs-clock')) {
    const ms = clockNow(v, el.dataset.who);
    el.textContent = fmtClock(ms);
    el.classList.toggle('low', ms <= 10000);
    el.classList.toggle('warn', ms > 10000 && ms <= 30000);
    el.classList.toggle('run', (el.dataset.who === 'me') === v.myTurn);
  }
  const mine = clockNow(v, 'me');
  if (v.myTurn && mine <= 10000 && mine > 0) { const sec = Math.ceil(mine / 1000); if (S.lastTick !== sec) { S.lastTick = sec; sfx('tick'); } }
  if (clockNow(v, v.myTurn ? 'me' : 'opp') <= 0 && !S.bBusy && !S.clockFetch) {
    S.clockFetch = true;
    get(`/api/battle/${S.battle}`).then((nv) => { setBattleView(nv); render(); }).catch(() => {}).finally(() => { S.clockFetch = false; });
  }
}, 250);

// Шапка «ты против соперника»: аватары, счёт, чей ход, пузыри реакций
function renderVersus(v) {
  const bubble = () => '';
  const myTurn = v.status === 'play' && v.myTurn, oppTurn = v.status === 'play' && !v.myTurn;
  return `<section class="b-vs">
    <div class="vs-side ${myTurn ? 'turn' : ''}">${bubble('mine')}<span class="vs-ava">${avatar(S.me.look, 52)}</span><span class="vs-name">ты</span>${v.clock ? `<span class="vs-clock" data-who="me">${fmtClock(clockNow(v, 'me'))}</span>` : ''}</div>
    <div class="vs-mid"><div class="vs-score"><b>${v.score.me}</b><span>:</span><b>${v.score.opp}</b></div><div class="vs-cap">${v.status === 'setup' ? 'расстановка' : v.status === 'done' ? 'партия окончена' : myTurn ? 'твой ход' : 'ход соперника'}</div></div>
    <div class="vs-side ${oppTurn ? 'turn' : ''}">${bubble('opp')}${tap(v.opp.id, `<span class="vs-ava">${avatar(v.opp.look, 52)}</span>`)}<span class="vs-name ellipsis">${esc(v.opp.nick)}</span>${v.clock ? `<span class="vs-clock" data-who="opp">${fmtClock(clockNow(v, 'opp'))}</span>` : ''}</div>
  </section>`;
}

// Пузыри реакций закреплены на экране: видно, даже если прокрутил к своему полю
function renderEmoteLayer(v) {
  const one = (who, look) => {
    const e = S.bEmote && S.bEmote[who];
    if (!e || Date.now() > e.until) return '';
    const [em, label] = EMOTES[e.e] || ['', ''];
    return `<div class="emo-float ${who}"><span class="emo-mini">${avatar(look, 30)}</span><span class="emo-bubble"><b>${em}</b><span>${esc(label)}</span></span></div>`;
  };
  return one('opp', v.opp.look) + one('mine', S.me.look);
}

function renderEmoteBar() {
  return `<div class="b-emotes" role="group" aria-label="Реакции">${Object.entries(EMOTES).map(([k, [em, label]]) => `<button class="emo" data-act="bemote" data-v="${k}" aria-label="${label}" title="${label}">${em}</button>`).join('')}</div>`;
}

function renderBattle() {
  const v = S.bv;
  const back = `<button class="linkbtn back" data-act="battle-back">‹ К переписке</button>`;
  if (!v) return back + '<div class="card"><p class="sub">Открываем поле…</p></div>';
  if (v.status === 'setup') {
    return `${back}${renderEmoteLayer(v)}${renderVersus(v)}
    <section class="b-sea">
      <div class="sea-title">${v.ready ? 'Флот расставлен' : 'Расставь флот'}</div>
      <p class="sea-sub">${v.ready ? (v.oppReady ? 'Начинаем…' : `Ждём, пока ${esc(v.opp.nick)} расставит корабли. Придёт уведомление.`) : 'Корабли стоят случайно. Не нравится — перемешай. Готов — жми «В бой!».'}</p>
      ${renderBoard(v, 'me')}
      ${v.ready ? '' : `<div class="row"><button class="btn ghost grow" data-act="bshuffle">🎲 Перемешать</button><button class="btn grow" data-act="bready">⚓ В бой!</button></div>`}
    </section>
    ${renderEmoteBar()}
    <button class="linkbtn b-quit" data-act="bresign">Отказаться от партии</button>`;
  }
  const done = v.status === 'done';
  const banner = done
    ? `<div class="b-banner ${v.winner === 'me' ? 'win' : 'lose'}">${v.winner === 'me' ? (v.timeout ? `⏱ У ${esc(v.opp.nick)} кончилось время. Победа!` : v.resigned ? `🏆 ${esc(v.opp.nick)} сдался. Победа!` : '🏆 Победа! Весь флот соперника на дне') : (v.timeout ? '⏱ Время вышло. В следующий раз быстрее!' : v.resigned ? '🐔 Ты сдался. Бывает' : `💥 ${esc(v.opp.nick)} потопил твой флот`)}</div>`
    : v.myTurn ? '<div class="b-banner go">🎯 Твой ход — стреляй по полю соперника</div>'
    : `<div class="b-banner wait">⏳ Ход ${esc(v.opp.nick)}. Придёт уведомление, когда выстрелит</div>`;
  const oppFleet = v.fleet.map((len) => ({ len, sunk: false }));
  for (const sh of v.oppSunk) { const f = oppFleet.find((x) => x.len === sh.length && !x.sunk); if (f) f.sunk = true; }
  return `${back}${renderEmoteLayer(v)}${renderVersus(v)}
  ${banner}
  <section class="b-sea">
    <div class="row" style="justify-content:space-between"><span class="sea-title">Воды ${esc(v.opp.nick)}</span><span class="sea-sub">на плаву: ${v.oppLeft}</span></div>
    ${fleetBars(oppFleet)}
    ${renderBoard(v, 'opp')}
  </section>
  ${renderEmoteBar()}
  <section class="b-sea mine">
    <div class="row" style="justify-content:space-between"><span class="sea-title">Мой флот</span><span class="sea-sub">цел: ${v.myLeft} из ${v.fleet.length}</span></div>
    ${fleetBars(fleetLeft(v.myShips, v.oppShots))}
    ${renderBoard(v, 'me')}
  </section>
  ${done ? `<button class="btn wide" data-act="battle-new" data-id="${v.opp.id}" data-mode="${v.mode}">Реванш${v.mode === 'fast' ? ' · быстрая' : ''}</button>` : '<button class="linkbtn b-quit" data-act="bresign">Сдаться</button>'}`;
}

function renderDmMsg(m, f) {
  if (m.type === 'meme') {
    return `<div class="msg meme-msg ${m.mine ? 'mine' : ''}">${memeSvg(m.look || {}, m.kind, m.opt, 190)}
      <div class="meta"><span>${m.time}</span>${m.mine ? (m.read ? '<span title="Прочитано">✓✓</span>' : '<span title="Доставлено">✓</span>') : `<button class="linkbtn" data-act="meme-open" data-to="${f.id}">Ответить мемом</button>`}</div></div>`;
  }
  if (m.type === 'call') {
    const who = m.mine ? 'Ты' : esc(f.nick);
    const verb = m.mine ? esc(m.callText).replace(/^зовёт/, 'зовёшь').replace(/^просит/, 'просишь').replace(/^спрашивает/, 'спрашиваешь').replace(/^ждёт/, 'ждёшь') : esc(m.callText);
    return `<div class="msg call-msg ${m.mine ? 'mine' : ''}">
      <div class="meta"><span>${m.time}</span></div>
      <div class="text"><b>${who}</b> ${verb}${m.opt ? ` · ${esc(m.opt.toLowerCase())}` : ''}${m.text ? ` · ${esc(m.text)}` : ''}</div>
      ${m.reply ? `<div class="reps"><span class="rep">${m.mine ? esc(f.nick) : 'Ты'}: ${esc(m.reply)}</span></div>` : ''}
      ${m.canReply ? `<div class="chips">${m.replyOptions.map((l) => `<button class="chip" data-act="dm-reply" data-id="${m.id}" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div>` : ''}
    </div>`;
  }
  return `<div class="msg ${m.mine ? 'mine' : ''}">
    <div class="text">${esc(m.text)}</div>
    <div class="meta"><span>${m.time}</span>${m.mine ? (m.read ? '<span title="Прочитано">✓✓</span>' : '<span title="Доставлено">✓</span>') : `<button class="linkbtn" data-act="report" data-type="dm" data-id="${m.id}" aria-label="Пожаловаться модератору">⚑</button>`}</div></div>`;
}

// ----- События -----
function renderFeed() {
  const ev = S.events;
  if (!ev) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  const sig = ev.office
    ? `<section class="card">
        <div class="row"><h3 class="grow">Сигналы офиса</h3><button class="btn small" data-act="open" data-v="signal">Сообщить</button></div>
        ${ev.signals.length ? ev.signals.map((s) => `<div class="item"><div class="grow">
          <div style="font-weight:900">${esc(s.label)}${s.confirmed ? ' ✓' : ''}</div>
          <div class="where">${s.time}${s.zone ? ' · ' + esc(s.zone) : ''}${s.comment ? ' · ' + esc(s.comment) : ''}</div>
          <div class="small">подтвердили: ${s.up}${s.down ? ` · неактуально: ${s.down}` : ''}</div></div>
          ${s.mine ? '<span class="small">твой</span>' : `<div class="row" style="gap:4px">
            <button class="chip ${s.myVote === 1 ? 'on' : ''}" data-act="vote" data-id="${s.id}" data-v="1" aria-label="Подтверждаю">Да</button>
            <button class="chip ${s.myVote === -1 ? 'on' : ''}" data-act="vote" data-id="${s.id}" data-v="-1" aria-label="Уже неактуально">Уже нет</button></div>`}
        </div>`).join('') : '<p class="sub">Пока тихо. Заметил, что холодно, на кухне яблоки или кофе закончился — сообщи всем на этаже.</p>'}
        <p class="small">Пожарная тревога и эвакуация — только по официальным каналам АХО и охраны, не здесь.</p>
      </section>`
    : '<section class="card"><h3>Сигналы офиса</h3><p class="sub">Отметься в офисе, чтобы видеть и отправлять сигналы: холодно, еда на кухне, кофе закончился.</p></section>';
  const off = new Set(store.get('feedOff', []));
  const onlyClose = !!store.get('feedClose', false);
  const kinds = [['office', 'В офисе'], ['join', 'Новички'], ['ach', 'Ачивки'], ['shop', 'Покупки']];
  const shown = ev.events.filter((e) => !off.has(e.kind) && (!onlyClose || e.close));
  const filters = `<div class="chips feed-f"><button class="chip ${onlyClose ? 'on' : ''}" data-act="feed-close">👥 Только свои</button>${kinds.map(([k, l]) => `<button class="chip ${off.has(k) ? '' : 'on'}" data-act="feed-kind" data-v="${k}">${l}</button>`).join('')}</div>`;
  const lim = S.feedAll ? shown.length : 15;
  const list = shown.length ? shown.slice(0, lim).map((e) => `<div class="item"><div class="grow"><div style="font-weight:700">${esc(e.text)}</div><div class="where">${e.time}${e.office ? ' · ' + esc(e.office) : ''}</div></div></div>`).join('') : '<p class="sub">Событий пока нет.</p>';
  return `${sig}<section class="card"><h3>Лента</h3>${filters}${list}${shown.length < ev.events.length ? `<p class="small" style="margin:0">Скрыто фильтром: ${ev.events.length - shown.length}</p>` : ''}${shown.length > lim ? `<button class="linkbtn" data-act="feed-more">Показать ещё ${shown.length - lim}</button>` : ''}</section>`;
}

// ----- Новые блоки: задания, обед, кофе, дни рождения, неделя, спасибо -----
function renderQuests() {
  const f = S.fx;
  if (!f) return '';
  const done = f.quests.items.filter((x) => x.done).length;
  return `<section class="card quests">
    <div class="row" style="justify-content:space-between"><span class="card-title">Задания дня</span><span class="small">${done}/${f.quests.items.length} · +${f.quests.reward} за каждое, +${f.quests.bonus} за все</span></div>
    <div class="quest-row n${f.quests.items.length}">${f.quests.items.map((x) => `<button class="quest ${x.done ? 'done' : ''}" data-act="quest-go" data-v="${esc(x.go || '')}" ${x.done ? 'disabled' : ''}><span class="qmark" aria-hidden="true">${x.done ? '✓' : ''}</span><span>${esc(x.name)}</span></button>`).join('')}</div>
    ${(f.quests.extra || []).length ? `<div class="eyebrow" style="margin-top:12px">Бонус дня · +${f.quests.reward} за каждое</div>
    <div class="quest-row bonus">${f.quests.extra.map((x) => `<button class="quest bonus ${x.done ? 'done' : ''}" data-act="quest-go" data-v="${esc(x.go)}" ${x.done ? 'disabled' : ''}><span class="qmark" aria-hidden="true">${x.done ? '✓' : '★'}</span><span>${esc(x.name)}</span></button>`).join('')}</div>` : ''}
    <p class="small" style="margin:8px 0 0">Каждый день набор новый. Нажми на задание — откроется место, где его выполнить.</p>
  </section>`;
}

function renderBirthdays() {
  const f = S.fx;
  if (!f || !f.birthdaysToday.length) return '';
  return f.birthdaysToday.map((b) => `<section class="bday">
    ${tap(b.id, `<span class="ava-wrap">${avatar(b.look, 34)}</span>`)}
    <div class="grow"><div style="font-weight:900">Сегодня день рождения у ${esc(b.nick)}</div><div class="small" style="color:#5B3B00">Поздравь в банде или подари зёрна</div></div>
    ${b.gifted ? '<span class="small" style="color:#5B3B00;font-weight:700">Поздравил ✓</span>' : `<button class="btn small" data-act="gift" data-id="${b.id}">+${f.giftBeans} ${BEAN}</button>`}
  </section>`).join('');
}

function renderLunches() {
  const f = S.fx;
  if (!f || !f.lunches.office) return '';
  const items = f.lunches.items;
  return `<section class="card">
    <div class="row" style="justify-content:space-between"><span class="card-title">Обед компанией</span><button class="btn small green" data-act="open" data-v="lunch">+ Собрать</button></div>
    ${items.length ? items.map((l) => `<div class="lunch">
      <span class="lunch-time">${esc(l.time)}</span>
      <div class="grow"><div style="font-weight:700">${esc(l.nick)}${l.place ? ' · ' + esc(l.place) : ''}</div>
        <div class="small">${l.count ? `идут: ${l.who.map(esc).join(', ')}${l.count > l.who.length ? ' и ещё ' + (l.count - l.who.length) : ''}` : 'пока никто не присоединился'}</div></div>
      ${l.mine ? `<button class="btn small ghost" data-act="lunch-cancel" data-id="${l.id}">Отменить</button>`
        : l.joined ? `<button class="btn small ghost" data-act="lunch-leave" data-id="${l.id}">Не иду</button>`
        : `<button class="btn small" data-act="lunch-join" data-id="${l.id}">Я с вами</button>`}
    </div>`).join('') : '<p class="small" style="margin:0">Сегодня в этом офисе ещё никто не собирает компанию. Открой сбор — его увидят все, кто отмечен здесь.</p>'}
  </section>`;
}

function renderCoffee() {
  const f = S.fx;
  if (!f) return '';
  const c = f.coffee;
  if (!c.optIn) {
    return `<section class="card coffee">
      <div class="row" style="gap:12px"><span class="coffee-ico">${ico('coffee', 22)}</span>
      <div class="grow"><div class="card-title">Случайный кофе</div><div class="small">Раз в неделю знакомим с соседом по офису — не из твоих банд.</div></div></div>
      ${c.hasHome ? '<button class="btn small" data-act="coffee-on">Участвовать</button>' : '<button class="btn small ghost" data-act="open" data-v="profile">Укажи свой офис в профиле</button>'}
    </section>`;
  }
  if (!c.pair) {
    return `<section class="card coffee"><div class="row" style="gap:12px"><span class="coffee-ico">${ico('coffee', 22)}</span>
      <div class="grow"><div class="card-title">Случайный кофе</div><div class="small">Пары составляем по понедельникам в 10:00. Придёт уведомление.</div></div></div></section>`;
  }
  const p = c.pair;
  let state = '';
  if (p.ping && p.ping.reply) state = `<div class="note ${p.ping.reply === 'Иду' ? 'good' : 'warn'}" style="margin:0">${p.ping.mine ? esc(p.partner.nick) + ': ' : 'Ты ответил: '}${esc(p.ping.reply)} · ${esc(p.ping.opt.toLowerCase())}</div>`;
  else if (p.ping && p.ping.mine) state = `<div class="note warn" style="margin:0">Ты предложил: ${esc(p.ping.opt.toLowerCase())}. Ждём ответа.</div>`;
  else if (p.canReply) state = `<div class="note good" style="margin:0">${esc(p.partner.nick)} предлагает: ${esc(p.ping.opt.toLowerCase())}</div>
    <div class="chips">${p.replies.map((r) => `<button class="chip" data-act="coffee-reply" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>`;
  const offer = p.canReply || (p.ping && p.ping.mine && !p.ping.reply) ? '' : `<div class="chips">${p.options.map((o) => `<button class="chip" data-act="coffee-ping" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  return `<section class="card coffee">
    <div class="row" style="gap:12px">${tap(p.partner.id, `<span class="ava-wrap">${avatar(p.partner.look, 34)}</span>`)}
    <div class="grow"><div class="eyebrow">Случайный кофе на этой неделе</div><div style="font-weight:900;font-size:16px">${esc(p.partner.nick)}</div>${p.partner.name ? `<div class="small" style="font-weight:700">${esc(p.partner.name)}</div>` : ''}${p.office ? `<div class="small">${esc(p.office)}</div>` : ''}</div></div>
    ${state}${offer}
  </section>`;
}

function renderGangBirthdays() {
  const x = S.gx;
  if (!x || !x.birthdays.length) return '';
  return `<section class="card"><span class="card-title">Дни рождения</span>
    ${x.birthdays.map((b) => `<div class="person2">${tap(b.id, `<span class="ava-wrap">${avatar(b.look, 32)}</span>`)}
      <div class="grow"><div style="font-weight:700">${esc(b.nick)}${b.me ? ' (ты)' : ''}</div><div class="where">${b.inDays === 0 ? 'сегодня!' : b.inDays === 1 ? 'завтра' : `через ${b.inDays} ${plural(b.inDays, 'день', 'дня', 'дней')}`} · ${esc(b.bday)}</div></div>
      ${b.inDays === 0 && !b.me ? (b.gifted ? '<span class="small">поздравил ✓</span>' : `<button class="btn small" data-act="gift" data-id="${b.id}">+10 ${BEAN}</button>`) : ''}</div>`).join('')}
  </section>`;
}

const CELL = { off: ['', 'Выходной'], office: ['', 'Офис'], home: ['', 'Дома'], vacation: ['', 'Отпуск'], sick: ['', 'Болеет'], unknown: ['', 'Не указано'] };
// Праздники и особые дни этой недели — словами, чтобы не гадать по цвету
function renderWeekNotes(w) {
  const day = (d) => `${d.label.split(' ')[0]} ${d.label.split(' ')[1].slice(0, 5)}`;
  const notes = [];
  for (const d of w.days) {
    if (d.holiday) notes.push(`<b>${esc(day(d))}</b> — выходной: ${esc(d.holiday)}`);
    else if (d.workSat) notes.push(`<b>${esc(day(d))}</b> — рабочая суббота${d.short ? ', на час короче' : ''}`);
    else if (d.short) notes.push(`<b>${esc(day(d))}</b> — предпраздничный, на час короче`);
  }
  return notes.length ? `<div class="wk-notes">${notes.map((n) => `<div>${n}</div>`).join('')}</div>` : '';
}

function renderWeek() {
  const x = S.gx;
  if (!x) return '';
  const w = x.week;
  return `<section class="card">
    <div class="row" style="justify-content:space-between"><span class="card-title">Неделя банды</span><button class="linkbtn" data-act="open" data-v="profile">мой план</button></div>
    <div class="week" style="grid-template-columns: minmax(0, 1.6fr) repeat(${w.days.length}, minmax(0, 1fr))">
      <span></span>${w.days.map((d) => `<span class="wk-h ${d.holiday ? 'off' : ''}" ${d.holiday ? `title="${esc(d.holiday)}"` : d.short ? 'title="Сокращённый день, на час короче"' : ''}>${esc(d.label.split(' ')[0])}<br><b>${esc(d.label.split(' ')[1].slice(0, 5))}</b>${d.short ? '<i class="wk-short">−1ч</i>' : ''}</span>`).join('')}
      ${w.rows.map((r) => `<span class="wk-n ellipsis">${esc(r.nick)}${r.me ? ' (ты)' : ''}</span>${r.cells.map((c, i) => `<span class="wk-c ${c}" title="${c === 'off' ? esc(w.days[i].holiday) : CELL[c][1]}" aria-label="${c === 'off' ? 'Выходной: ' + esc(w.days[i].holiday) : CELL[c][1]}">${CELL[c][0]}</span>`).join('')}`).join('')}
      <span class="wk-n small">в офисе</span>${w.days.map((d) => `<span class="wk-sum ${w.best && d.label === w.best.label ? 'best' : ''}">${d.holiday ? '—' : d.office}</span>`).join('')}
    </div>
    <div class="wk-legend"><span><i class="wk-c office"></i>офис</span><span><i class="wk-c home"></i>дома</span><span><i class="wk-c vacation"></i>отпуск</span><span><i class="wk-c sick"></i>болеет</span>${w.days.some((d) => d.holiday) ? '<span><i class="wk-c off"></i>праздник</span>' : ''}</div>
    ${renderWeekNotes(w)}
    ${w.best ? `<div class="week-hint">${ico('where', 16)}<span>${w.best.today ? 'Сегодня' : esc(w.best.label)} в офисе будут <b>${w.best.office} из ${w.best.total}</b></span></div>` : '<p class="small" style="margin:0">Заполните план недели в профиле — тут станет видно, когда банда соберётся в офисе.</p>'}
    ${w.hidden ? `<p class="small" style="margin:0">Ещё ${w.hidden} ${plural(w.hidden, 'человек', 'человека', 'человек')} не показывают, где работают.</p>` : ''}
  </section>`;
}

function renderThanks(v) {
  const x = S.gx;
  if (!x) return '';
  const others = v.members.filter((m) => !m.me);
  return `<section class="card">
    <div class="row" style="justify-content:space-between"><span class="card-title">Спасибо</span><span class="small">осталось ${x.thanksLeft} из 3 сегодня</span></div>
    ${others.length && x.thanksLeft > 0 ? `<div class="chips">${others.map((m) => `<button class="chip ${S.thanksTo === m.id ? 'on' : ''}" data-act="thanks-to" data-v="${m.id}">${esc(m.nick)}</button>`).join('')}</div>
    ${S.thanksTo ? `<div class="row"><label class="field grow" style="gap:0"><span class="hidden">За что спасибо</span><input id="thanks-text" maxlength="80" placeholder="За что? Можно пусто" aria-label="За что спасибо"></label><button class="btn" data-act="thanks-send">Спасибо</button></div>` : '<p class="small" style="margin:0">Выбери, кому сказать спасибо. Получатель получит зерно.</p>'}` : ''}
    ${x.thanks.length ? `<div class="thanks-list">${x.thanks.map((t) => `<div class="thx ${t.toMe ? 'me' : ''}"><b>${esc(t.from)}</b> → <b>${esc(t.to)}</b>${t.text ? ': ' + esc(t.text) : ''}<span class="small"> · ${esc(t.when)}</span></div>`).join('')}</div>` : '<p class="small" style="margin:0">За неделю спасибо ещё не было. Начни первым.</p>'}
  </section>`;
}

function renderAchievements() {
  const f = S.fx;
  if (!f) return '<p class="small">Загружаем ачивки…</p>';
  const all = f.achievements;
  const cats = f.achCats || [['all', 'Ачивки']];
  const R = Object.fromEntries(all.map((a) => [a.tier, a.reward]));
  const prog = (n, goal) => goal > 1 ? `<span class="ach-prog"><i style="width:${Math.round((n / goal) * 100)}%"></i></span><span class="ach-num">${n} / ${goal}</span>` : '';
  const tile = (a) => `<div class="ach ${a.tier} ${a.got ? 'got' : ''} ${a.secret ? 'secret' : ''}" title="${esc(a.desc)}">
      <span class="ach-ico" aria-hidden="true">${a.got ? '★' : a.secret ? '🕶' : '?'}</span><span class="ach-name">${esc(a.name)}</span><span class="ach-desc">${esc(a.desc)}</span>${a.got ? '' : prog(a.n, a.goal)}</div>`;
  // Ступени одной серии — одна плитка: уровень, точки уровней, прогресс до следующего
  const seriesTile = (lv) => {
    const done = lv.filter((x) => x.got);
    const top = done[done.length - 1];
    const next = lv.find((x) => !x.got);
    const shown = top || lv[0];
    return `<div class="ach ${shown.tier} ${top ? 'got' : ''} series" title="${esc(next ? 'Дальше: ' + next.desc : 'Все ступени взяты')}">
      <span class="ach-ico" aria-hidden="true">${top ? '★' : '?'}</span><span class="ach-name">${esc(shown.name)}</span>
      <span class="ach-lv">${lv.map((x) => `<i class="${x.tier} ${x.got ? 'on' : ''}"></i>`).join('')}</span>
      <span class="ach-desc">${esc(next ? next.desc : 'Все ступени взяты')}</span>${next ? prog(next.n, next.goal) : ''}</div>`;
  };
  return `<p class="small" style="margin:0 0 6px">Обычные +${R.common} · редкие +${R.rare} · легендарные +${R.legendary} зёрен</p>
    ${cats.map(([cat, title]) => {
      const items = all.filter((a) => (a.cat || 'all') === cat);
      if (!items.length) return '';
      const tiles = [];
      const seen = new Set();
      for (const a of items) {
        if (!a.series) { tiles.push(tile(a)); continue; }
        if (seen.has(a.series)) continue;
        seen.add(a.series);
        tiles.push(seriesTile(items.filter((x) => x.series === a.series)));
      }
      const got = items.filter((a) => a.got).length;
      return `<div class="eyebrow" style="margin-top:6px">${title} · ${got} из ${items.length}</div>
        ${cat === 'stealth' ? '<p class="small" style="margin:2px 0 0">Как получить — секрет. Подсказка: иногда лучше не отсвечивать.</p>' : ''}
        <div class="ach-grid">${tiles.join('')}</div>`;
    }).join('')}`;
}

// ----- Шторки -----
function sheetWrap(title, body) {
  return `<div class="sheet-bg" data-act="close-bg"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
    ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}${body}</div></div>`;
}

function renderSheet() {
  switch (S.sheet) {
    case 'profile': return sheetWrap('Профиль', renderProfile());
    case 'person': return sheetWrap('Досье', renderPerson());
    case 'gang-new': return sheetWrap('Банда', `<p class="sub">Банда — твои люди: команда, соседи по этажу, кофейный клуб. Общий чат, зовы на кофе и обед, неделя офиса. Создание стоит 50 зёрен залога — они вернутся, когда в банде будет 3 человека.</p>
      <label class="field">Название новой банды<input id="gang-name" maxlength="30" placeholder="Например, Пятничный кофе"></label>
      <button class="btn violet" data-act="gang-create">Создать банду · залог 50</button>
      <label class="field">Или вставь ссылку-приглашение<input id="gang-code" placeholder="https://…/g/ABC123"></label>
      <button class="btn ghost" data-act="gang-join">Вступить</button>`);
    case 'crew-new': return sheetWrap('Позвать в личку', `<p class="sub">С участниками твоих банд переписываться можно сразу. Тех, кто не в банде, зови по нику или личной ссылкой.</p>
      <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Ник</span><input id="crew-nick" maxlength="21" placeholder="ник" autocapitalize="off" autocomplete="off" aria-label="Ник"></label><button class="btn" data-act="crew-add">Позвать</button></div>
      <button class="btn blue" data-act="crew-share">Отправить свою ссылку</button>
      <p class="small">Кто откроет ссылку, сразу сможет тебе писать, поэтому шли её лично, а не в общий чат.</p>
      ${S.crew && S.crew.outgoing.length ? `<div class="crew-out"><span class="small">Ждём ответа:</span> ${S.crew.outgoing.map((p) => `<span class="rep">${esc(p.nick)} <button class="linkbtn" data-act="crew-decline" data-id="${p.id}" aria-label="Отменить заявку">✕</button></span>`).join(' ')}</div>` : ''}
      ${S.crew && S.crew.blocked.length ? `<details><summary class="small" style="cursor:pointer;min-height:32px">Заблокированные (${S.crew.blocked.length})</summary>${S.crew.blocked.map((p) => `<div class="row" style="justify-content:space-between"><span>${esc(p.nick)}</span><button class="linkbtn" data-act="crew-unblock" data-id="${p.id}">Разблокировать</button></div>`).join('')}</details>` : ''}`);
    case 'pcall': return sheetWrap('Позвать ' + (((S.people || []).find((p) => p.id === S.pcallTo) || (S.person && S.person.id === S.pcallTo ? S.person : null) || {}).nick || ''), `<p class="sub">Лично, придёт пуш. Тихие часы 19:00–09:00 уважаем.</p>
      <div class="calls">${['coffee', 'lunch', 'room', 'call', 'where', 'online', 'wait'].map((k) => `<button class="call" style="background:${CALL_STYLE[k]}" data-act="pcall" data-id="${S.pcallTo}" data-kind="${k}">${esc(S.cat.calls[k].label)}</button>`).join('')}</div>
      <button class="btn ghost" data-act="dm-open" data-id="${S.pcallTo}">💬 Написать сообщение</button>`);
    case 'find': return sheetWrap('Найти своих', renderFind());
    case 'feedback': return sheetWrap('Идеи и ошибки', renderFeedback());
    case 'blitz': return sheetWrap(S.blitz && S.blitz.set ? `${S.blitz.set.emoji} ${S.blitz.set.title}` : 'Блиц', renderBlitzPlay());
    case 'poll-new': return sheetWrap('Новый опрос', renderPollNew());
    case 'dm-pick': return sheetWrap('Написать в личку', (S.people || []).length ? '<p class="sub">Лично можно писать любому члену твоих банд.</p>' + (S.people || []).map((p) => `<button class="chat-row" data-act="dm-open" data-id="${p.id}">${avatar(p.look, 36)}<span class="grow"><span class="chat-title">${esc(p.nick)}</span><span class="where">${esc(p.gangs.map((g) => g.name).join(', ') || whereText(p)[0])}</span></span><span aria-hidden="true">›</span></button>`).join('') : '<p class="sub">Пока некому писать. Сколоти банду и позови в неё своих.</p>');
    case 'battle-pick': return sheetWrap('С кем сыграть?', (S.people || []).length ? (S.people || []).map((p) => `<button class="chat-row" data-act="dm-open" data-id="${p.id}">${avatar(p.look, 36)}<span class="grow"><span class="chat-title">${esc(p.nick)}</span><span class="where">${esc(whereText(p)[0])}</span></span><span aria-hidden="true">›</span></button>`).join('') + '<p class="small">Откроется переписка — там выбери «Без спешки» или «Быстрая».</p>' : '<p class="sub">Сначала сколоти банду и позови в неё своих.</p>');
    case 'whatsnew': return sheetWrap('Что поменялось', `<div class="wn">
      <div class="wn-i"><span>👥</span><div><b>Рядом</b><p>Главный экран: где ты сегодня и все твои люди одним списком — кто в офисе, кто дома, кто в отпуске.</p></div></div>
      <div class="wn-i"><span>💬</span><div><b>Чаты</b><p>Банды и личка вместе. Членам своей банды теперь можно писать лично — без заявки.</p></div></div>
      <div class="wn-i"><span>🏢</span><div><b>Офис</b><p>Столовая, обед компанией, сигналы и лента событий.</p></div></div>
      <div class="wn-i"><span>🎮</span><div><b>Игры</b><p>Задания, квизы, морской бой, случайный кофе, ачивки и Лавка — всё в одном месте.</p></div></div>
      <button class="btn wide" data-act="whatsnew-ok">Понятно, покажи</button></div>`);
    case 'avatar': return sheetWrap(S.avaMode === 'vacation' ? 'Образ для отпуска' : 'Конструктор', renderAvatarEditor());
    case 'meme': return sheetWrap('Мем-открытка', renderMemeMaker());
    case 'shop': return sheetWrap('Лавка', renderShop());
    case 'install': return sheetWrap('Установи на телефон', renderInstall());
    case 'compose': return sheetWrap(S.cat.calls[S.compose.kind].label, renderCompose());
    case 'signal': return sheetWrap('Сигнал офиса', renderSignal());
    case 'office': return sheetWrap(S.state && S.state.checkin ? 'Сменить офис' : 'Выбери офис', renderOfficeList());
    case 'sick': return sheetWrap('Болею', `
      <p class="sub">Банда увидит «болеет — выздоравливай!», зовы не будут присылать пуши. Диагноз и подробности не нужны и нигде не сохраняются. Статус снимется сам после последнего дня.</p>
      <label class="field">По какое число (включительно, до 14 дней)<input id="sick-until" type="date" min="${S.state.today}" value="${S.state.today}"></label>
      <button class="btn wide" data-act="sick-now">Болею</button>`);
    case 'lunch': return sheetWrap('Обед компанией', `
      <p class="sub">Сбор увидят все, кто сегодня отмечен в твоём офисе. Кто присоединится — придёт уведомление.</p>
      <div class="field">Во сколько<div class="chips">${(S.fx ? S.fx.lunches.times : []).map((t) => `<button class="chip ${S.lunchTime === t ? 'on' : ''}" data-act="lunch-time" data-v="${t}">${t}</button>`).join('')}</div></div>
      <label class="field">Где встречаемся (необязательно)<input id="lunch-place" maxlength="30" placeholder="У лифтов на 3 этаже"></label>
      <button class="btn wide" data-act="lunch-create">Открыть сбор</button>`);
    case 'vacation': return sheetWrap('Я в отпуске', `
      <p class="sub">С сегодняшнего дня. Банда увидит «в отпуске до …», зовы не будут присылать пуши. Отпуск попадёт в график — его можно поправить в профиле.</p>
      <label class="field">По какое число (включительно)<input id="vac-until" type="date" min="${S.state.today}" value="${S.state.today}"></label>
      <button class="btn wide" data-act="vac-now">Ушёл в отпуск</button>`);
    default: return '';
  }
}

function renderCompose() {
  const c = S.compose;
  const def = S.cat.calls[c.kind];
  if (c.dm) {
    const nick = c.nick || (S.dmView ? S.dmView.friend.nick : '');
    return `
    <p class="sub"><b>${esc(nick)}</b>, лично. Придёт пуш, тихие часы 19:00–09:00 уважаем.</p>
    ${def.opts.length ? `<div class="field">Когда / где<div class="chips">${def.opts.map((o) => `<button class="chip ${c.opt === o ? 'on' : ''}" data-act="c-opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>` : ''}
    ${def.textLabel ? `<label class="field">${esc(def.textLabel)}<input id="c-text" maxlength="40" placeholder="${esc(def.textHint)}" value="${esc(c.text || '')}"></label>` : ''}
    <button class="btn wide" data-act="call-send">Позвать</button>
    <p class="small">Не больше 5 зовов в час одному человеку.</p>`;
  }
  const gang = S.me.gangs.find((g) => g.id === c.gang);
  const members = (S.gang && S.gang.gang.id === c.gang ? S.gang.members : []).filter((m) => !m.me);
  return `
    <p class="sub">Банда: <b>${esc(gang ? gang.name : '')}</b>. Придёт пуш — тихие часы 19:00–09:00 уважаем.</p>
    <div class="field">Кому<div class="chips">
      <button class="chip ${!c.to ? 'on' : ''}" data-act="c-to" data-v="">Всей банде</button>
      ${members.map((m) => `<button class="chip ${c.to === m.id ? 'on' : ''}" data-act="c-to" data-v="${m.id}">${esc(m.nick)}</button>`).join('')}
    </div></div>
    ${def.opts.length ? `<div class="field">Когда / где<div class="chips">${def.opts.map((o) => `<button class="chip ${c.opt === o ? 'on' : ''}" data-act="c-opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>` : ''}
    ${def.textLabel ? `<label class="field">${esc(def.textLabel)}<input id="c-text" maxlength="40" placeholder="${esc(def.textHint)}" value="${esc(c.text || '')}"></label>` : ''}
    <button class="btn wide" data-act="call-send">Позвать</button>
    <p class="small">Не больше 3 зовов в час.</p>`;
}

function renderSignal() {
  const s = S.signal || {};
  return `
    <div class="field">Что случилось<div class="chips">${Object.entries(S.cat.signals).map(([k, l]) => `<button class="chip ${s.type === k ? 'on' : ''}" data-act="s-type" data-v="${k}">${esc(l)}</button>`).join('')}</div></div>
    <label class="field">Где (этаж, зона)<input id="s-zone" maxlength="30" placeholder="3 этаж, кухня" value="${esc(s.zone || '')}"></label>
    <label class="field">Комментарий<input id="s-comment" maxlength="60" placeholder="Принесли яблоки" value="${esc(s.comment || '')}"></label>
    <button class="btn wide" data-act="signal-send" ${s.type ? '' : 'disabled'}>Отправить сигнал</button>
    <p class="small">Когда ещё двое подтвердят — сигнал получат все отмеченные в офисе, а ты +2 зерна. Ложные сигналы скрываются после трёх «Уже нет».</p>`;
}

function renderInstall() {
  const ios = isIOS();
  return `
    ${isStandalone() ? '<div class="note good">Приложение уже установлено.</div>' : ''}
    ${deferredInstall ? '<button class="btn wide" data-act="install-native">Установить</button>' : ''}
    <h3>${ios ? 'iPhone (Safari)' : 'Android (Chrome)'}</h3>
    ${ios ? `<ol class="ol"><li>Открой этот сайт в Safari.</li><li>Нажми «Поделиться» внизу экрана.</li><li>Выбери «На экран “Домой”».</li><li>Открой Этаж с иконки и включи уведомления в профиле.</li></ol>
      <p class="small">Уведомления на iPhone работают с iOS 16.4 и только из установленного приложения.</p>`
      : `<ol class="ol"><li>Открой меню браузера ⋮.</li><li>Выбери «Установить приложение» или «Добавить на главный экран».</li><li>Открой Этаж с иконки и включи уведомления в профиле.</li></ol>`}
    <h3>${ios ? 'Android' : 'iPhone'}</h3>
    <p class="sub">${ios ? 'Chrome → меню ⋮ → «Установить приложение».' : 'Safari → «Поделиться» → «На экран “Домой”».'}</p>`;
}

// «Угадай коллегу»: вопросы из профилей банды
function renderGuess() {
  const r = S.guess;
  if (!r) return '';
  const head = '<div class="row" style="justify-content:space-between"><span class="card-title">Кто из наших?</span>' + (r.question ? `<span class="small">осталось ${r.question.left} из 3 сегодня</span>` : '') + '</div>';
  if (r.small) return `<section class="card guess">${head}<p class="small" style="margin:0">Игра откроется, когда в банде будет хотя бы 4 человека. Позови ещё ${r.need} ${plural(r.need, 'человека', 'человек', 'человек')} по ссылке ниже.</p></section>`;
  if (!r.question) return `<section class="card guess">${head}<p class="small" style="margin:0">На сегодня всё, завтра будут новые вопросы. Они собираются из профилей банды: чем больше свои расскажут о себе, тем интереснее угадывать.</p></section>`;
  const x = r.question;
  const prompt = x.kind === 'avatar' ? `<div class="guess-ava">${avatar(x.look, 110)}</div><div class="guess-q">Кто из банды так выглядит?</div>`
    : x.kind === 'about' ? `<div class="guess-quote">«${esc(x.about)}»</div><div class="guess-q">Кто написал это о себе?</div>`
    : `<div class="chips" style="justify-content:center">${x.tags.map((t) => `<span class="chip on" style="cursor:default">${esc(t)}</span>`).join('')}</div><div class="guess-q">Чьи это интересы?</div>`;
  const opts = x.options.map((o) => {
    let cls = '';
    if (x.answered) cls = o.id === x.answer ? 'ok' : o.id === x.pick ? 'bad' : 'dim';
    return `<button class="gopt ${cls}" ${x.answered ? 'disabled' : `data-act="guess-pick" data-id="${x.id}" data-v="${o.id}"`}>${esc(o.nick)}</button>`;
  }).join('');
  const after = x.answered ? `<div class="note ${x.correct ? 'good' : 'warn'}" style="margin:0">${x.correct ? `Верно!${S.guessBeans ? ` +${S.guessBeans} ${plural(S.guessBeans, 'зерно', 'зерна', 'зёрен')}` : ''}` : `Это ${esc(x.answerNick)}`}</div>
    <div class="row">${x.left > 0 ? '<button class="btn small grow" data-act="guess-next">Следующий вопрос</button>' : ''}<button class="btn small ghost grow" data-act="person" data-id="${x.answer}">Профиль ${esc(x.answerNick)}</button></div>` : '';
  return `<section class="card guess">${head}${prompt}<div class="gopts">${opts}</div>${after}</section>`;
}

// Квиз недели от модератора
// ----- Блиц: вопросы на время -----
const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function blitzBoard(b, limit = 10) {
  if (!b || !b.top.length) return '<p class="small" style="margin:0">Пока никто не прошёл — стань первым в таблице.</p>';
  return `<div class="bl-board">${b.top.slice(0, limit).map((r) => `<div class="bl-row ${r.me ? 'me' : ''}"><span class="bl-place">${r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : r.place}</span><span class="grow ellipsis">${esc(r.nick)}${r.me ? ' (ты)' : ''}</span><b>${r.score}</b><span class="small">${mmss(r.secs * 1000)}</span></div>`).join('')}</div>
    ${b.place && b.place > limit ? `<p class="small" style="margin:6px 0 0">Ты на ${b.place} месте из ${b.players}</p>` : ''}`;
}
function renderBlitzCard() {
  const b = S.blitz;
  if (!b || !b.set) return '';
  const st = b.set;
  const head = `<div class="row" style="justify-content:space-between"><span class="card-title">${st.emoji} Блиц: ${esc(st.title)}</span><span class="small">до ${ddmm(st.to)}</span></div>`;
  if (b.state === 'new') {
    return `<section class="card blitz">${head}
      <p class="sub" style="margin:6px 0 10px">${esc(st.desc)}</p>
      <div class="bl-facts"><span>⏱ ${Math.round(st.secs / 60)} мин</span><span>❓ ${st.count} вопросов</span><span>${BEAN} до +${st.maxBeans}</span></div>
      <button class="btn wide" data-act="blitz-start">Начать — таймер пойдёт сразу</button>
      <p class="small" style="margin:8px 0 6px">Одна попытка. Закроешь окно — время всё равно идёт.</p>
      ${b.board && b.board.top.length ? `<div class="eyebrow">Лидеры</div>${blitzBoard(b.board, 3)}` : ''}
    </section>`;
  }
  if (b.state === 'play') {
    return `<section class="card blitz">${head}<p class="sub" style="margin:6px 0 10px">Блиц идёт: осталось <b>${mmss(b.leftMs)}</b>, верных ${b.score}.</p>
      <button class="btn wide" data-act="blitz-open">Продолжить</button></section>`;
  }
  return `<section class="card blitz">${head}
    <div class="bl-result"><b>${b.score}</b><span>верных из ${b.answered} отвеченных · за ${mmss(b.secs * 1000)}${b.beans ? ` · +${b.beans} зёрен` : ''}</span></div>
    ${b.board && b.board.place ? `<p class="small" style="margin:0 0 8px">Место: <b>${b.board.place}</b> из ${b.board.players}</p>` : ''}
    <div class="eyebrow">Лидеры</div>${blitzBoard(b.board)}
  </section>`;
}
function renderBlitzPlay() {
  const b = S.blitz;
  if (!b || !b.set) return '<p class="sub">Загружаем…</p>';
  if (b.state !== 'play' || !b.question) {
    return `<div class="bl-result big"><b>${b.score || 0}</b><span>верных${b.answered != null ? ` из ${b.answered}` : ''}${b.beans ? ` · +${b.beans} зёрен` : ''}</span></div>
      ${b.board && b.board.place ? `<p class="sub" style="text-align:center">Твоё место — ${b.board.place} из ${b.board.players}</p>` : ''}
      <div class="eyebrow">Лидеры</div>${blitzBoard(b.board)}
      <button class="btn wide" style="margin-top:12px" data-act="close">Готово</button>`;
  }
  const qn = b.question;
  const fb = S.blitzFb;
  const pct = Math.max(0, Math.min(100, (b.leftMs / (b.set.secs * 1000)) * 100));
  return `<div class="bl-top"><span class="bl-time ${b.leftMs < 15000 ? 'hot' : ''}" id="bl-time">${mmss(b.leftMs)}</span><span class="small">вопрос ${qn.n} из ${qn.total} · верных <b>${b.score}</b></span></div>
    <div class="bl-bar"><i id="bl-bar" style="width:${pct}%"></i></div>
    <p class="bl-q">${esc(qn.text)}</p>
    <div class="bl-opts">${qn.options.map((o, i) => `<button class="gopt bl-opt ${fb && fb.n === qn.n ? (i === fb.right ? 'ok' : i === fb.pick ? 'bad' : 'dim') : ''}" data-act="blitz-pick" data-n="${qn.n}" data-v="${i}" ${fb && fb.n === qn.n ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`;
}
// Тикающий таймер блица: обновляем только время и полоску, без перерисовки
let blitzTimer = null;
function blitzTick() {
  clearInterval(blitzTimer);
  if (!S.blitz || S.blitz.state !== 'play') return;
  const end = Date.now() + S.blitz.leftMs;
  S.blitzEnd = end;
  blitzTimer = setInterval(() => {
    if (!S.blitz || S.blitz.state !== 'play') { clearInterval(blitzTimer); return; }
    const left = end - Date.now();
    S.blitz.leftMs = left;
    const t = $('#bl-time'), bar = $('#bl-bar');
    if (t) { t.textContent = mmss(left); t.classList.toggle('hot', left < 15000); }
    if (bar) bar.style.width = `${Math.max(0, (left / (S.blitz.set.secs * 1000)) * 100)}%`;
    const sec = Math.ceil(left / 1000);
    if (S.sheet === 'blitz' && sec <= 10 && sec > 0 && S.blitzLastTick !== sec) { S.blitzLastTick = sec; sfx('tick'); }
    if (left <= 0) {
      clearInterval(blitzTimer);
      setTimeout(() => run(async () => { await loadBlitz(); sfx('confirm'); toast('Время вышло!'); loadMe().catch(() => {}); }), 400);
    }
  }, 250);
}

function renderQuiz() {
  const z = (S.quiz || [])[0];
  if (!z) return '';
  const more = (S.quiz || []).filter((x) => !x.answered).length - (z.answered ? 0 : 1);
  const opts = z.options.map((o, i) => {
    if (!z.answered) return `<button class="gopt" data-act="quiz-pick" data-id="${z.id}" data-v="${i}">${esc(o)}</button>`;
    const st = z.stats[i];
    const cls = i === z.correct ? 'ok' : i === z.pick ? 'bad' : '';
    return `<div class="qres ${cls}"><span class="qbar" style="width:${st.pct}%"></span><span class="qtxt">${i === z.correct ? '✓ ' : ''}${esc(o)}</span><span class="qpct">${st.pct}%</span></div>`;
  }).join('');
  return `<section class="card quiz">
    <div class="row" style="justify-content:space-between"><span class="eyebrow" style="margin:0">Квиз недели</span><span class="small">${z.answered ? `ответили ${z.total}` : '+3 за верный ответ'}</span></div>
    <div class="quiz-q">${esc(z.text)}</div>
    <div class="gopts">${opts}</div>
    ${z.answered ? `<div class="note ${z.pick === z.correct ? 'good' : 'warn'}" style="margin:0">${z.pick === z.correct ? 'Верно!' : 'Мимо.'}${z.explain ? ' ' + esc(z.explain) : ''}</div>` : ''}
    ${more > 0 ? `<p class="small" style="margin:0">Ещё ${more} ${plural(more, 'квиз ждёт', 'квиза ждут', 'квизов ждут')} ответа</p>` : ''}
  </section>`;
}

function runBeanFx() {
  const fx = S.beanFx; fx.fresh = false;
  sfx('coin');
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const el = document.querySelector('.beans3d .bnum');
    const k = Math.min(1, (t - t0) / dur);
    if (el) el.textContent = Math.round(fx.from + (fx.to - fx.from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => {
    if (S.beanFx !== fx) return;
    S.beanFx = null;
    const b = document.querySelector('.beans3d');
    if (b) { b.classList.remove('gain'); const p = b.querySelector('.bplus'); if (p) p.remove(); const n = b.querySelector('.bnum'); if (n && S.me) n.textContent = S.me.beans; }
  }, 1500);
}

// Точка на зёрнах: появилось что-то новое, на что хватает. Гаснет, когда заглянул в Лавку
function shopDot() {
  const aff = (S.me && S.me.affordable) || [];
  const seen = new Set(store.get('shopSeen', []));
  return aff.some((id) => !seen.has(id));
}
// Подсказки при первом запуске: профиль, зёрна и все нижние вкладки. Один раз
const COACH = [
  null,
  { cls: 'left', title: 'Это твой профиль', text: 'Нажми на аватар или ник: внешность, имя, план недели, ачивки. Зелёное кольцо — насколько профиль заполнен.' },
  { cls: 'right', title: 'Это твои зёрна', text: 'Их дают за отметки, ответы и квизы. Нажми — откроется Лавка со статусами и рамками.' },
  { tab: 'near', i: 0, title: 'Рядом', text: 'Главный экран. Отметься, где работаешь сегодня, — и увидишь всех своих людей: кто в офисе, кто дома, кто в отпуске. Позвать на кофе — одна кнопка.' },
  { tab: 'chats', i: 1, title: 'Чаты', text: 'Банды — общие чаты команды. Членам своих банд можно писать в личку. Тут же зовы и морской бой.' },
  { tab: 'office', i: 2, title: 'Офис', text: 'Загрузка столовой и оценка обеда, обед компанией, сигналы с этажа и лента событий.' },
  { tab: 'games', i: 3, title: 'Игры', text: 'Задания дня, квиз недели, «Кто из наших?», морской бой и случайный кофе. За всё дают зёрна — их тратят в Лавке.' }
];
function renderCoach() {
  if (!S.coach || S.sheet) return '';
  const tip = COACH[S.coach];
  const total = COACH.length - S.coachStart, n = S.coach - S.coachStart + 1;
  const last = S.coach === COACH.length - 1;
  const pos = tip.tab ? 'bottom' : tip.cls;
  const style = tip.tab ? ` style="--ax:${12.5 + tip.i * 25}%"` : '';
  return `<div class="coach-bg" data-act="coach-next"></div>
    <div class="coach-tip ${pos}"${style} role="dialog" aria-label="${esc(tip.title)}"><b>${esc(tip.title)}</b><p>${esc(tip.text)}</p>
      <div class="row" style="justify-content:space-between"><span class="small">${n} из ${total}</span>
      <span class="row" style="gap:6px">${last ? '' : '<button class="linkbtn" data-act="coach-skip">Пропустить</button>'}<button class="btn small" data-act="coach-next">${last ? 'Понятно' : 'Дальше'}</button></span></div></div>`;
}

// Звуки и вибрация интерфейса. Всё синтезируется в браузере — без файлов.
// Громкость 0–100 (0 — тишина) и вибрация настраиваются в профиле. На iPhone браузер вибрацию не поддерживает.
let audioCtx = null, master = null;
const TAB_NOTES = { near: 523, chats: 659, office: 784, games: 1047 };
const soundVol = () => { const v = Number(store.get('soundVol', store.get('sound', true) === false ? 0 : 60)); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 60; };
const vibroOn = () => store.get('vibro', true) !== false;
function actx() {
  const v = soundVol();
  if (!v) return null;
  try {
    if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); master = audioCtx.createGain(); master.connect(audioCtx.destination); }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    master.gain.value = Math.pow(v / 60, 1.6); // 60 — привычная громкость, выше — громче
    return audioCtx;
  } catch { return null; }
}
function tone(ctx, { f = 600, f2 = null, type = 'triangle', at = 0, dur = 0.12, vol = 0.07 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.8);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
// Короткий шум через фильтр: щелчки, всплески, «вжух»
function noise(ctx, { at = 0, dur = 0.08, vol = 0.08, type = 'bandpass', f = 2000, f2 = null, q = 1 }) {
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  src.connect(fl).connect(g).connect(master); src.start(t);
}
// Пушечный выстрел: шум через низкочастотный фильтр
function boom(ctx, at, vol = 0.5, len = 0.7) {
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
  const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; lp.type = 'lowpass'; lp.frequency.setValueAtTime(380, t); lp.frequency.exponentialRampToValueAtTime(60, t + len);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(lp).connect(g).connect(master); src.start(t);
}

// Каждый звук — свой характер: по нему без взгляда понятно, что произошло
const SOUNDS = {
  tap: (c) => { noise(c, { dur: 0.025, vol: 0.12, f: 3200, q: 2 }); tone(c, { f: 880, f2: 660, dur: 0.05, vol: 0.035 }); },
  tab: (c, tab) => { const f = TAB_NOTES[tab] || 600; tone(c, { f, dur: 0.18, vol: 0.06 }); tone(c, { f: f * 2, type: 'sine', dur: 0.12, vol: 0.02 }); noise(c, { dur: 0.02, vol: 0.06, f: 4000 }); },
  on: (c) => { tone(c, { f: 740, type: 'sine', dur: 0.05, vol: 0.05 }); tone(c, { f: 1110, type: 'sine', at: 0.045, dur: 0.07, vol: 0.05 }); },
  off: (c) => { tone(c, { f: 1110, type: 'sine', dur: 0.05, vol: 0.045 }); tone(c, { f: 740, type: 'sine', at: 0.045, dur: 0.07, vol: 0.045 }); },
  pick: (c) => { noise(c, { dur: 0.02, vol: 0.08, f: 5000, q: 3 }); tone(c, { f: 1320, type: 'sine', dur: 0.04, vol: 0.03 }); },
  open: (c) => { noise(c, { dur: 0.16, vol: 0.05, f: 600, f2: 2400, q: 0.8 }); tone(c, { f: 420, f2: 840, type: 'sine', dur: 0.16, vol: 0.035 }); },
  close: (c) => { noise(c, { dur: 0.14, vol: 0.045, f: 2200, f2: 500, q: 0.8 }); tone(c, { f: 760, f2: 380, type: 'sine', dur: 0.13, vol: 0.03 }); },
  expand: (c) => tone(c, { f: 600, f2: 900, type: 'sine', dur: 0.08, vol: 0.04 }),
  collapse: (c) => tone(c, { f: 900, f2: 600, type: 'sine', dur: 0.08, vol: 0.035 }),
  send: (c) => { noise(c, { dur: 0.12, vol: 0.05, f: 900, f2: 4000, q: 1 }); tone(c, { f: 500, f2: 1500, type: 'sine', dur: 0.1, vol: 0.04 }); tone(c, { f: 1760, type: 'sine', at: 0.09, dur: 0.06, vol: 0.03 }); },
  confirm: (c) => [523, 659, 784].forEach((f, i) => tone(c, { f, at: i * 0.06, dur: 0.14, vol: 0.05 })),
  danger: (c) => { tone(c, { f: 220, f2: 150, type: 'square', dur: 0.09, vol: 0.03 }); tone(c, { f: 180, f2: 120, type: 'square', at: 0.11, dur: 0.12, vol: 0.03 }); },
  error: (c) => { tone(c, { f: 196, type: 'sawtooth', dur: 0.09, vol: 0.035 }); tone(c, { f: 185, type: 'sawtooth', at: 0.12, dur: 0.14, vol: 0.035 }); },
  vote: (c) => { tone(c, { f: 500, f2: 1200, type: 'sine', dur: 0.07, vol: 0.06 }); noise(c, { at: 0.05, dur: 0.02, vol: 0.06, f: 3500 }); },
  coin: (c) => { tone(c, { f: 1319, type: 'square', dur: 0.07, vol: 0.025 }); tone(c, { f: 1760, type: 'square', at: 0.07, dur: 0.22, vol: 0.025 }); },
  click: (c) => { tone(c, { f: 1400, f2: 900, type: 'square', dur: 0.05, vol: 0.035 }); tone(c, { f: 2100, type: 'sine', at: 0.03, dur: 0.08, vol: 0.04 }); },
  tick: (c) => tone(c, { f: 1800, type: 'sine', dur: 0.04, vol: 0.03 }),
  splash: (c) => { noise(c, { dur: 0.35, vol: 0.12, type: 'highpass', f: 1200, f2: 400 }); tone(c, { f: 300, f2: 120, type: 'sine', dur: 0.2, vol: 0.04 }); },
  hit: (c) => { boom(c, 0, 0.35, 0.35); noise(c, { dur: 0.06, vol: 0.12, f: 2500 }); },
  sunk: (c) => { boom(c, 0, 0.5, 0.8); tone(c, { f: 400, f2: 90, type: 'sawtooth', at: 0.1, dur: 0.6, vol: 0.035 }); },
  lose: (c) => [[392, 0], [370, 0.32], [349, 0.64], [330, 0.96]].forEach(([f, at], i) => tone(c, { f, f2: i === 3 ? 290 : null, type: 'sawtooth', at, dur: i === 3 ? 0.8 : 0.3, vol: 0.04 })),
  chicken: (c) => {
    // «ко-ко-ко… кудах!»: короткие писклявые вскрики с резким подъёмом тона
    [0, 0.17, 0.34].forEach((at) => tone(c, { f: 620, f2: 1250, type: 'square', at, dur: 0.11, vol: 0.05 }));
    tone(c, { f: 700, f2: 1700, type: 'sawtooth', at: 0.56, dur: 0.16, vol: 0.06 });
    tone(c, { f: 1500, f2: 520, type: 'sawtooth', at: 0.72, dur: 0.38, vol: 0.05 });
  },
  fanfare: (c) => {
    [0, 0.35, 0.7].forEach((at) => boom(c, at, 0.45));
    [[523, 1.0], [659, 1.12], [784, 1.24], [1047, 1.36]].forEach(([f, at]) => tone(c, { f, type: 'sawtooth', at, dur: 0.16, vol: 0.05 }));
    [523, 659, 784, 1047].forEach((f) => tone(c, { f, type: 'triangle', at: 1.5, dur: 0.9, vol: 0.045 }));
  }
};
// Вибрация под стать звуку: короткий «тик» на нажатия, узор — на события
const BUZZ = { tap: 8, tab: 10, on: 6, off: 6, pick: 5, open: 8, close: 6, expand: 5, collapse: 5, send: 14, confirm: [12, 40, 18], danger: [25, 50, 25], error: [35, 45, 35],
  vote: 10, coin: [8, 30, 8], click: 8, tick: 4, splash: 15, hit: [30, 40, 60], sunk: [40, 30, 90], lose: [80, 60, 160], chicken: [30, 40, 30], fanfare: [60, 60, 60, 60, 200] };
let lastSfx = { name: '', at: 0 };
function sfx(name, arg) {
  const now = performance.now();
  if (lastSfx.name === name && now - lastSfx.at < 40) return; // двойной вызов на один тап — один звук
  lastSfx = { name, at: now };
  const c = actx();
  if (c && SOUNDS[name]) { try { SOUNDS[name](c, arg); } catch {} }
  if (vibroOn() && navigator.vibrate && BUZZ[name] != null) { try { navigator.vibrate(BUZZ[name]); } catch {} }
}
const tabSound = (tab) => sfx('tab', tab);

// Какой звук у какого нажатия. Свои звуки у вкладок, выстрелов, сдачи и Лавки — их играют сами действия
const FEEL_SELF = new Set(['tab', 'blitz-pick', 'bshoot', 'bresign', 'sound-toggle', 'vibro-toggle', 'sound-test', 'splash-skip']);
const FEEL = {
  open: 'open', 'open-sec': 'open', person: 'open', 'find-open': 'open', 'poll-new': 'open', 'ava-open': 'open', 'ava-open-vac': 'open', 'meme-open': 'open', 'pcall-open': 'open',
  'call-open': 'open', 'dm-call-open': 'open', 'battle-new': 'open', 'crew-share': 'open',
  'gang-open': 'open', 'dm-open': 'open', 'battle-open': 'open',
  close: 'close', 'close-bg': 'close', 'chats-back': 'close', 'dm-back': 'close', 'battle-back': 'close', 'onb-back': 'close', 'nick-no': 'close', 'food-cancel': 'close', 'feed-close': 'close', 'coach-skip': 'close',
  'poll-vote': 'vote', vote: 'vote', 'quiz-pick': 'vote', 'guess-pick': 'vote', 'food-pick': 'vote', reply: 'vote', 'dm-reply': 'vote', 'coffee-reply': 'vote', bemote: 'vote',
  buy: 'confirm', 'ava-buy': 'confirm', equip: 'confirm', 'invite-accept': 'confirm', 'crew-accept': 'confirm', 'nick-yes': 'confirm', checkin: 'confirm', 'canteen-in': 'confirm',
  'lunch-join': 'confirm', 'gang-join': 'confirm', bready: 'confirm', 'whatsnew-ok': 'confirm', 'ava-save': 'confirm', 'ava-save-vac': 'confirm', 'prof-save': 'confirm', 'name-save': 'confirm',
  'gang-leave': 'danger', 'invite-decline': 'danger', 'crew-decline': 'danger', 'crew-remove': 'danger', 'crew-block': 'danger', logout: 'danger', 'delete-account': 'danger',
  'lunch-leave': 'danger', 'lunch-cancel': 'danger', 'poll-close': 'danger', checkout: 'danger', 'canteen-out': 'danger', 'vac-del': 'danger', report: 'danger'
};
function feelFor(act, el) {
  if (FEEL_SELF.has(act)) return null;
  if (act === 'sec') return S.sec.has(el.dataset.v) ? 'collapse' : 'expand';
  if (act === 'today') return el.dataset.v ? 'confirm' : 'off';
  if (FEEL[act]) return FEEL[act];
  if (/(^|-)(send|create|go|add|share|submit)$|^gift$|signal-send|thanks-send|chat-send|find-invite|gang-invite/.test(act)) return 'send';
  if (el.classList.contains('chip') || /-(pick|kind|days|set|cat|scene|emo|to|time|tag|day|opt|select|preset|type)$/.test(act)) return 'pick';
  return 'tap';
}


// Кольцо заполненности профиля вокруг аватара
function progressRing(pct, inner) {
  return `<span class="pring" style="--p:${pct}">${inner}<span class="pring-num">${pct}%</span></span>`;
}
// Карточка «заполни профиль»: следующий шаг, а не список всего недоделанного
function renderCompletion(inProfile) {
  const c = S.me && S.me.completion;
  if (!c || c.pct >= 100) return '';
  if (!inProfile && Number(store.get('complHideUntil', 0)) > Date.now()) return '';
  const left = c.steps.filter((x) => !x.done);
  const next = left[0];
  return `<section class="${inProfile ? 'compl in' : 'card compl'}">
    <div class="row" style="justify-content:space-between"><span class="card-title">Профиль заполнен на ${c.pct}%</span>${inProfile ? '' : '<button class="linkbtn" data-act="compl-hide" aria-label="Скрыть на неделю">позже</button>'}</div>
    <div class="cbar"><span style="width:${c.pct}%"></span></div>
    <div class="csteps">${c.steps.map((x) => `<span class="cstep ${x.done ? 'done' : ''}" title="${esc(x.label)}"></span>`).join('')}</div>
    <p class="small" style="margin:0">Ещё ${left.length} ${plural(left.length, 'шаг', 'шага', 'шагов')} до ачивки «Открытая книга» и +15 зёрен. Своим проще позвать тебя на кофе, когда видно, чем ты живёшь.</p>
    <button class="btn small ${inProfile ? 'ghost' : ''}" data-act="open-sec" data-v="${next.sec}">${esc(next.label)} →</button>
  </section>`;
}

// Профиль собран из раскрывающихся секций: в заголовке — краткая сводка и карандаш, внутри — редактирование
const PENCIL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
const HAIR_NAMES = { short: 'Короткие', long: 'Длинные', tail: 'Хвост', curly: 'Кудри', bob: 'Каре', bun: 'Пучок', side: 'Набок', mohawk: 'Ирокез', afro: 'Афро', bald: 'Без волос',
  undercut: 'Андеркат', quiff: 'Кок', crop: 'Кроп', slick: 'Зачёс назад', buzz: 'Ёжик', manbun: 'Мужской пучок', waves: 'Локоны', bangs: 'С чёлкой', lob: 'Удлинённое каре', pixie: 'Пикси', ponytail: 'Высокий хвост', braid: 'Коса', buns: 'Два пучка', anime: 'Аниме' };
const FACE_NAMES = { oval: 'Овал', round: 'Круглое', square: 'Квадрат', long: 'Вытянутое', heart: 'Сердечко' };
const OUTFIT_NAMES = { hoodie: 'Худи', tee: 'Футболка', dev: 'Футболка разработчика', shirt: 'Рубашка', suit: 'Костюм', jacket: 'Бомбер', puffer: 'Пуховик', dress: 'Платье', cami: 'Топ на бретельках', biker: 'Косуха', cyber: 'Неон' };
const MASK_NAMES = { none: 'Без маски', medical: 'Медицинская', gauze: 'Марлевая', visor: 'Кибервизор' };
const COLOR_NAMES = { same: 'Как одежда', red: 'Красный', blue: 'Синий', green: 'Зелёный', violet: 'Фиолетовый', navy: 'Тёмно-синий', black: 'Чёрный', white: 'Белый', beige: 'Бежевый', yellow: 'Жёлтый', pink: 'Розовый', orange: 'Оранжевый', khaki: 'Хаки', burgundy: 'Бордовый', grey: 'Серый' };
const NECK_NAMES = { none: 'Ничего', tie: 'Галстук', tie_crooked: 'Галстук набок', bow: 'Бабочка', badge: 'Пропуск', beads: 'Бусы', chain: 'Цепочка', tie_gold: 'Золотой галстук', chain_gold: 'Золотая цепь', snake: 'Змея' };
const PET_NAMES = { none: 'Без питомца', corgi: 'Корги', pug: 'Мопс' };
const LENS_NAMES = { clear: 'Прозрачные', grey: 'Серые', brown: 'Коричневые', blue: 'Голубые', green: 'Зелёные', pink: 'Розовые', yellow: 'Жёлтые' };
const LENS_SWATCH = { clear: 'repeating-linear-gradient(45deg,#fff 0 4px,#E3E8F2 4px 8px)', grey: '#555B68', brown: '#7A5232', blue: '#4A86E0', green: '#3A9A68', pink: '#F08BB4', yellow: '#F2C230' };
const HAT_NAMES = { none: 'Без шапки', beanie: 'Шапка', cap: 'Кепка', hood: 'Капюшон', headset: 'Гарнитура' };
const EYE_NAMES = { normal: 'Обычные', tired: 'После совещания', sly: 'Хитрые', wide: 'Удивлённые', anime: 'Аниме' };
const PROP_NAMES = { none: 'Ничего', mug: 'Кружка', papers: 'Квартальный отчёт', sign: 'Табличка', laptop: 'Ноутбук', mug_best: 'Лучший сотрудник' };
const AVA_CATS = [['face', 'Лицо'], ['hair', 'Волосы'], ['eyes', 'Глаза'], ['mouth', 'Рот'], ['beard', 'Борода'], ['makeup', 'Макияж'], ['outfit', 'Одежда'], ['acc', 'Аксессуары'], ['bg', 'Фон'], ['meme', 'Мемы']];
const DEF_LOOK = { hatColor: 'same', mask: 'none', glassesColor: 'black', lensColor: 'clear', pet: 'none', eyeSize: 'm', nose: 'button', ears: 'normal', makeup: 'none', earrings: 'none', glassesStyle: 'classic', beardColor: 'same', mustacheColor: 'same' };
const GLASS_COLOR_NAMES = { black: 'Чёрная', tortoise: 'Черепаховая', gold: 'Золото', silver: 'Серебро', red: 'Красная', navy: 'Синяя', pink: 'Розовая' };
const GLASS_SWATCH = { black: '#262A36', tortoise: 'linear-gradient(135deg,#4A2A16,#A7652E 45%,#6B3B1C 70%,#C88A45)', gold: 'linear-gradient(135deg,#FFF1B8,#D6AA3E 50%,#8E6B1C)', silver: 'linear-gradient(135deg,#fff,#C9CED8 50%,#7E8594)', red: '#C8323C', navy: '#2E4F93', pink: '#F08BB4', clear: 'repeating-linear-gradient(45deg,#fff 0 4px,#E3E8F2 4px 8px)' };
const NOSE_NAMES = { button: 'Кнопка', straight: 'Прямой', wide: 'Широкий', long: 'Длинный', snub: 'Курносый', roman: 'С горбинкой' };
const EARS_NAMES = { small: 'Маленькие', normal: 'Обычные', big: 'Большие' };
const EYESIZE_NAMES = { s: 'Маленькие', m: 'Обычные', l: 'Большие' };
const MAKEUP_NAMES = { none: 'Без макияжа', light: 'Нюд', lips: 'Красная помада', smoky: 'Смоки', evening: 'Вечерний', bright: 'Яркий' };
const EARRING_NAMES = { none: 'Без серёг', studs: 'Гвоздики', pearls: 'Жемчуг', hoops: 'Кольца', drops: 'Подвески', cross: 'Крестики' };
const GLASSES_NAMES = { none: 'Без очков', classic: 'Классика', round: 'Круглые', square: 'Квадратные', aviator: 'Авиаторы', cat: 'Кошачий глаз' };
// Порядок оправ: сначала то, что чаще выбирают «М» или «Ж», но доступны все
const GLASSES_ORDER = { m: ['classic', 'square', 'round', 'aviator', 'cat'], f: ['cat', 'round', 'classic', 'aviator', 'square'] };
const BG_NAMES = { auto: 'Под кожу', sky: 'Небо', mint: 'Мята', peach: 'Персик', lilac: 'Лаванда', sun: 'Солнце', slate: 'Графит', office: 'Офис', meeting: 'Переговорка', home: 'Дом', street: 'Улица', cafe: 'Кафе' };
// Мемные пресеты меняют одежду, аксессуары и выражение лица, а лицо, кожу и причёску оставляют твоими
const AVA_PRESETS = [
  { id: 'boss', name: 'Начальник отдела', look: { outfit: 'suit', hoodie: 'navy', neck: 'tie', hat: 'none', prop: 'none', mouth: 'smirk', eyeShape: 'sly', glasses: false } },
  { id: 'tired', name: 'Устал, но держусь', look: { outfit: 'hoodie', neck: 'none', hat: 'none', prop: 'mug', mouth: 'neutral', eyeShape: 'tired' } },
  { id: 'excel', name: 'Гений Excel', look: { outfit: 'shirt', hoodie: 'green', neck: 'tie', hat: 'none', prop: 'papers', mouth: 'grin', eyeShape: 'wide', glasses: true } },
  { id: 'nothing', name: 'Я ничего не трогал', look: { outfit: 'dev', neck: 'none', hat: 'none', prop: 'none', mouth: 'wow', eyeShape: 'wide' } },
  { id: 'report', name: 'Снова квартальный отчёт', look: { outfit: 'shirt', hoodie: 'blue', neck: 'tie_crooked', hat: 'none', prop: 'papers', mouth: 'neutral', eyeShape: 'tired' } },
  { id: 'control', name: 'Всё под контролем', look: { outfit: 'suit', hoodie: 'red', neck: 'tie', hat: 'headset', prop: 'mug', mouth: 'smile', eyeShape: 'normal' } },
  // Легендарные образы: детали за зёрна в Лавке, примерить можно бесплатно
  { id: 'biker', legend: true, name: 'Байкер', look: { outfit: 'biker', neck: 'chain_gold', hat: 'none', mask: 'none', glasses: true, glassesStyle: 'aviator', glassesColor: 'gold', lensColor: 'grey', hairStyle: 'slick', mouth: 'smirk', eyeShape: 'sly', prop: 'none', bg: 'street' } },
  { id: 'cyber', legend: true, name: 'Киберпанк', look: { outfit: 'cyber', mask: 'visor', neck: 'none', hat: 'none', glasses: false, hairStyle: 'mohawk', hair: '#FF6FA8', mouth: 'neutral', prop: 'none', bg: 'slate' } },
  { id: 'anime', legend: true, name: 'Аниме-герой', look: { hairStyle: 'anime', eyeShape: 'anime', outfit: 'jacket', hoodie: 'orange', hat: 'none', mask: 'none', glasses: false, mouth: 'grin', prop: 'none', bg: 'sun' } },
  { id: 'winter', legend: false, name: 'Зима близко', look: { outfit: 'puffer', hoodie: 'navy', hat: 'beanie', hatColor: 'red', mask: 'none', neck: 'none', prop: 'mug', mouth: 'smile', bg: 'street' } }
];
// Платная ли деталь и куплена ли она
const partOf = (slot, value) => (S.cat.parts || []).find((x) => x.slot === slot && x.value === value);
const partLocked = (slot, value) => { const it = partOf(slot, value); return it && !(S.me.owned || []).includes(it.id) ? it : null; };
function draftLocked() {
  for (const k of ['neck', 'prop', 'hat', 'outfit', 'mask', 'hairStyle', 'eyeShape']) { const it = partLocked(k, S.draft[k]); if (it) return it; }
  return null;
}
function randomLook() {
  const L = S.cat.look, pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const free = (k) => L[k].filter((v) => !partLocked(k, v));
  const r = {};
  for (const k of ['preset', 'face', 'skin', 'eyes', 'hairStyle', 'hair', 'hoodie', 'mouth', 'eyeShape', 'outfit']) r[k] = pick(free(k));
  r.beard = Math.random() < 0.35 ? pick(free('beard').filter((v) => v !== 'none')) : 'none';
  r.neck = Math.random() < 0.45 ? pick(free('neck').filter((v) => v !== 'none')) : 'none';
  r.hat = Math.random() < 0.25 ? pick(free('hat').filter((v) => v !== 'none')) : 'none';
  r.prop = Math.random() < 0.4 ? pick(free('prop').filter((v) => v !== 'none')) : 'none';
  r.bg = Math.random() < 0.5 ? 'auto' : pick(L.bg);
  r.glasses = Math.random() < 0.3; r.freckles = Math.random() < 0.2; r.phones = r.hat === 'none' && Math.random() < 0.12;
  const f = r.preset === 'f';
  r.nose = pick(L.nose); r.ears = Math.random() < 0.7 ? 'normal' : pick(L.ears); r.eyeSize = Math.random() < 0.6 ? 'm' : pick(L.eyeSize);
  r.glassesStyle = pick(GLASSES_ORDER[f ? 'f' : 'm']); r.glassesColor = pick(L.glassesColor); r.lensColor = Math.random() < 0.75 ? 'clear' : pick(L.lensColor);
  r.hairStyle = pick(HAIR_ORDER[f ? 'f' : 'm'].slice(0, 10)); r.hatColor = Math.random() < 0.6 ? 'same' : pick(L.hoodie); r.mask = 'none';
  if (!f && (r.outfit === 'dress' || r.outfit === 'cami')) r.outfit = 'hoodie'; r.pet = Math.random() < 0.12 ? pick(['corgi', 'pug']) : 'none';
  r.makeup = f && Math.random() < 0.65 ? pick(L.makeup.filter((v) => v !== 'none')) : 'none';
  r.earrings = Math.random() < (f ? 0.55 : 0.08) ? pick(L.earrings.filter((v) => v !== 'none')) : 'none';
  if (f) r.beard = 'none'; else r.makeup = 'none';
  if (f) r.beard = 'none'; else if (Math.random() < 0.15) r.beard = pick(free('beard').filter((v) => v !== 'none'));
  r.beardColor = Math.random() < 0.15 ? pick(L.hair) : 'same'; r.mustacheColor = Math.random() < 0.1 ? pick(L.hair) : r.beardColor;
  return r;
}

// ----- Мем-открытка: аватар + ситуация + эмоция. Подписи только из списка -----
let memeSeq = 0;
function wrapText(t, max) {
  const out = []; let line = '';
  for (const w of t.split(' ')) { if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
  if (line) out.push(line);
  return out.slice(0, 3);
}
function memeSvg(look, sceneId, emoId, width = 220, standalone = false) {
  const sc = (S.cat.memes || []).find((x) => x.id === sceneId) || S.cat.memes[0];
  const e = (S.cat.memeEmos || {})[emoId] || {};
  const l = { ...look, mouth: e.mouth || look.mouth, eyeShape: e.eyeShape || look.eyeShape };
  const id = 'mg' + (++memeSeq);
  const lines = wrapText(sc.caption, 17);
  const y0 = lines.length === 1 ? 24 : lines.length === 2 ? 18 : 13;
  return `<svg ${standalone ? 'xmlns="http://www.w3.org/2000/svg"' : ''} viewBox="0 0 120 150" width="${width}" height="${Math.round(width * 1.25)}" role="img" aria-label="${esc(sc.caption)}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${sc.bg[0]}"/><stop offset="1" stop-color="${sc.bg[1]}"/></linearGradient>
    <clipPath id="${id}c"><circle cx="60" cy="96" r="44"/></clipPath></defs>
    <rect width="120" height="150" rx="10" fill="url(#${id})"/>
    <circle cx="104" cy="30" r="26" fill="#fff" opacity=".07"/><circle cx="10" cy="140" r="30" fill="#fff" opacity=".06"/>
    ${lines.map((t, i) => `<text x="60" y="${y0 + i * 12}" text-anchor="middle" font-family="Rubik,system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="10.5" font-weight="900" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width=".6" paint-order="stroke">${esc(t)}</text>`).join('')}
    <circle cx="60" cy="96" r="45.5" fill="#fff" opacity=".9"/>
    <g clip-path="url(#${id}c)"><rect x="16" y="52" width="88" height="88" fill="#FFE7B3"/><svg x="14" y="50" width="92" height="92" viewBox="0 0 100 100">${avatarInner(l)}</svg></g>
    <text x="114" y="146" text-anchor="end" font-family="system-ui,sans-serif" font-size="5" font-weight="800" fill="#fff" opacity=".7">этаж</text>
  </svg>`;
}
async function svgToPng(svg, w, h) {
  const img = new Image();
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise((ok) => c.toBlob(ok, 'image/png'));
}
function renderMemeMaker() {
  const m = S.meme;
  const crew = S.people || (S.crew && S.crew.list) || [];
  return `<div class="meme-ed">
    <div class="meme-prev">${memeSvg(S.me.look, m.scene, m.emo, 230)}</div>
    <div class="field">Ситуация<div class="scenes">${S.cat.memes.map((x) => `<button class="scene ${m.scene === x.id ? 'on' : ''}" style="background:linear-gradient(160deg, ${x.bg[0]}, ${x.bg[1]})" data-act="meme-scene" data-v="${x.id}">${esc(x.caption)}</button>`).join('')}</div></div>
    <div class="field">Эмоция<div class="chips">${Object.entries(S.cat.memeEmos).map(([k, v]) => `<button class="chip ${m.emo === k ? 'on' : ''}" data-act="meme-emo" data-v="${k}">${esc(v.label)}</button>`).join('')}</div></div>
    ${crew.length ? `<div class="field">Кому отправить<div class="chips">${crew.map((f) => `<button class="chip ${m.to === f.id ? 'on' : ''}" data-act="meme-to" data-v="${f.id}">${esc(f.nick)}</button>`).join('')}</div></div>` : '<p class="small" style="margin:0">Отправлять мемы можно членам твоих банд. А картинкой — куда угодно.</p>'}
    <div class="row">${m.to ? `<button class="btn grow" data-act="meme-send">Отправить ${esc((crew.find((f) => f.id === m.to) || {}).nick || '')}</button>` : ''}<button class="btn ${m.to ? 'ghost' : ''} grow" data-act="meme-share">${navigator.share ? 'Поделиться картинкой' : 'Скачать картинку'}</button></div>
    <p class="small" style="margin:0">На открытке твой текущий аватар. Подписи — из готового списка, чтобы мемы оставались добрыми.</p>
  </div>`;
}

// ----- Конструктор аватара: черновик, категории, пресеты, случайный -----
function renderAvatarEditor() {
  const d = S.draft, L = S.cat.look;
  const cat = (S.avaCat === 'makeup' && d.preset !== 'f') || (S.avaCat === 'beard' && d.preset === 'f') ? 'face' : (S.avaCat || 'face');
  const sw = (key, vals) => `<div class="row" style="flex-wrap:wrap;gap:8px">${vals.map((v) => `<button class="swatch ${d[key] === v ? 'on' : ''}" style="background:${HOODIE[v] || v}" data-act="ava-set" data-k="${key}" data-v="${v}" aria-label="${COLOR_NAMES[v] || key + ' ' + v}" title="${COLOR_NAMES[v] || ''}"></button>`).join('')}</div>`;
  // Превью без лишнего: на «Лице» не мешают шапка и волосы, на «Волосах» — шапка, на «Глазах» — очки.
  // Это только показ: в сохранённый аватар ничего не попадает. Кнопками над вкладками можно вернуть
  const auto = { face: { hat: true, hair: true }, hair: { hat: true }, eyes: { glasses: true } }[cat] || {};
  const hide = { ...auto, ...((S.avaHide || {})[cat] || {}) };
  const view = (l) => ({ ...l, ...(hide.hat ? { hat: 'none', phones: false, crown: false } : {}), ...(hide.hair ? { hairStyle: 'bald' } : {}), ...(hide.glasses ? { glasses: false } : {}) });
  const hasHat = (d.hat && d.hat !== 'none') || d.phones;
  const hideChip = (k, on, off) => `<button class="chip ${hide[k] ? 'on' : ''}" data-act="ava-hide" data-k="${k}" data-c="${cat}" data-v="${hide[k] ? '0' : '1'}">${hide[k] ? on : off}</button>`;
  const hideBar = [
    hasHat && (cat === 'face' || cat === 'hair') ? hideChip('hat', 'Шапка скрыта', 'Скрыть шапку') : '',
    d.hairStyle !== 'bald' && cat === 'face' ? hideChip('hair', 'Волосы скрыты', 'Скрыть волосы') : '',
    d.glasses && (cat === 'eyes' || cat === 'face') ? hideChip('glasses', 'Очки скрыты', 'Скрыть очки') : ''
  ].filter(Boolean).join('');
  const tiles = (key, vals, names, zoom = false) => `<div class="ava-tiles">${vals.map((v) => {
    const lock = partLocked(key, v);
    return `<button class="ava-tile ${(d[key] || DEF_LOOK[key]) === v ? 'on' : ''} ${lock ? 'paid' : ''}" data-act="ava-set" data-k="${key}" data-v="${v}">${avatar(view({ ...d, [key]: v, frame: null, crown: false, ...(zoom ? { pet: 'none', prop: 'none' } : {}) }), 60, zoom)}<span>${names[v] || v}</span>${lock ? `<em>${lock.price} ${BEAN}</em>` : ''}</button>`;
  }).join('')}</div>`;
  const tog = (k, label) => `<button class="chip ${d[k] ? 'on' : ''}" data-act="ava-toggle" data-k="${k}">${label}</button>`;
  const sex = d.preset === 'f' ? 'f' : 'm';
  const hairSw = (key) => `<div class="row" style="flex-wrap:wrap;gap:8px"><button class="swatch same ${!d[key] || d[key] === 'same' ? 'on' : ''}" data-act="ava-set" data-k="${key}" data-v="same" aria-label="Как волосы" title="Как волосы">=</button>${L.hair.map((v) => `<button class="swatch ${d[key] === v ? 'on' : ''}" style="background:${v}" data-act="ava-set" data-k="${key}" data-v="${v}" aria-label="${key} ${v}"></button>`).join('')}</div>`;
  const chipsOf = (key, vals, names) => `<div class="chips">${vals.map((v) => `<button class="chip ${(d[key] || DEF_LOOK[key]) === v ? 'on' : ''}" data-act="ava-set" data-k="${key}" data-v="${v}">${names[v] || v}</button>`).join('')}</div>`;
  // Очки: «без очков» + оправы; выбор оправы сам включает очки
  const glassesTiles = `<div class="ava-tiles">${['none', ...GLASSES_ORDER[sex]].map((v) => {
    const on = v === 'none' ? !d.glasses : d.glasses && (d.glassesStyle || 'classic') === v;
    return `<button class="ava-tile ${on ? 'on' : ''}" data-act="ava-glasses" data-v="${v}">${avatar({ ...d, glasses: v !== 'none', glassesStyle: v === 'none' ? d.glassesStyle : v, frame: null, crown: false, pet: 'none', prop: 'none' }, 60, true)}<span>${GLASSES_NAMES[v]}</span></button>`;
  }).join('')}</div>`;
  const body = {
    face: `<div class="chips">${['m', 'f'].map((v) => `<button class="chip ${d.preset === v ? 'on' : ''}" data-act="ava-set" data-k="preset" data-v="${v}">${v === 'm' ? 'М' : 'Ж'}</button>`).join('')}${tog('freckles', 'Веснушки')}</div>
      <p class="small" style="margin:0">«М» — шире челюсть и плечи, густые брови. «Ж» — мягкий подбородок, высокие скулы, ресницы.</p>
      <div class="field">Форма лица${tiles('face', L.face, FACE_NAMES, true)}</div>
      <div class="field">Нос${tiles('nose', L.nose, NOSE_NAMES, true)}</div>
      <div class="field">Уши${chipsOf('ears', L.ears, EARS_NAMES)}</div>
      <div class="field">Тон кожи${sw('skin', L.skin)}</div>`,
    hair: `<div class="field">Причёска${tiles('hairStyle', HAIR_ORDER[sex].concat(L.hairStyle.filter((v) => !HAIR_ORDER[sex].includes(v))), HAIR_NAMES)}</div><div class="field">Цвет волос${sw('hair', L.hair)}</div>
      <p class="small" style="margin:0">Цвет бороды и усов настраивается отдельно — во вкладке «Борода».</p>`,
    eyes: `<div class="field">Взгляд${tiles('eyeShape', L.eyeShape, EYE_NAMES, true)}</div><div class="field">Размер глаз${chipsOf('eyeSize', L.eyeSize, EYESIZE_NAMES)}</div><div class="field">Цвет глаз${sw('eyes', L.eyes)}</div>`,
    mouth: `<div class="field">Выражение${tiles('mouth', L.mouth, MOUTH_NAMES, true)}</div>`,
    beard: `<div class="field">Борода и усы${tiles('beard', L.beard, BEARD_NAMES, true)}</div>
      <div class="field">Цвет бороды${hairSw('beardColor')}</div><div class="field">Цвет усов${hairSw('mustacheColor')}</div>
      <p class="small" style="margin:0">«=» — как волосы. Седая борода при тёмных волосах, рыжие усы — пожалуйста.</p>`,
    makeup: `<div class="field">Макияж${tiles('makeup', L.makeup, MAKEUP_NAMES, true)}</div><div class="field">Серьги${tiles('earrings', L.earrings, EARRING_NAMES, true)}</div>`,
    outfit: `<div class="field">Одежда${tiles('outfit', L.outfit, OUTFIT_NAMES)}</div><div class="field">Цвет одежды${sw('hoodie', L.hoodie)}</div>`,
    acc: `<div class="field">Очки${glassesTiles}</div>${d.glasses ? `<div class="field">Цвет оправы<div class="row" style="flex-wrap:wrap;gap:8px">${L.glassesColor.map((v) => `<button class="swatch gc ${(d.glassesColor || 'black') === v ? 'on' : ''}" style="background:${GLASS_SWATCH[v]}" data-act="ava-set" data-k="glassesColor" data-v="${v}" aria-label="${GLASS_COLOR_NAMES[v]}" title="${GLASS_COLOR_NAMES[v]}"></button>`).join('')}</div></div>
      <div class="field">Цвет стёкол<div class="row" style="flex-wrap:wrap;gap:8px">${L.lensColor.map((v) => `<button class="swatch gc ${(d.lensColor || 'clear') === v ? 'on' : ''}" style="background:${LENS_SWATCH[v]}" data-act="ava-set" data-k="lensColor" data-v="${v}" aria-label="${LENS_NAMES[v]}" title="${LENS_NAMES[v]}"></button>`).join('')}</div></div>` : ''}<div class="field">Серьги${tiles('earrings', L.earrings, EARRING_NAMES, true)}</div><div class="field">На шее${tiles('neck', L.neck, NECK_NAMES)}</div><div class="field">На голове${tiles('hat', L.hat, HAT_NAMES)}</div>${d.hat && d.hat !== 'none' && d.hat !== 'headset' ? `<div class="field">Цвет головного убора<div class="row" style="flex-wrap:wrap;gap:8px"><button class="swatch same ${!d.hatColor || d.hatColor === 'same' ? 'on' : ''}" data-act="ava-set" data-k="hatColor" data-v="same" title="Как одежда" aria-label="Как одежда">=</button>${L.hoodie.map((v) => `<button class="swatch ${d.hatColor === v ? 'on' : ''}" style="background:${HOODIE[v]}" data-act="ava-set" data-k="hatColor" data-v="${v}" title="${COLOR_NAMES[v]}" aria-label="${COLOR_NAMES[v]}"></button>`).join('')}</div></div>` : ''}<div class="field">Маска${tiles('mask', L.mask, MASK_NAMES, true)}</div><div class="chips">${tog('phones', 'Наушники')}</div>
      <div class="field">В руке${tiles('prop', ['none', 'mug', 'mug_best'], { none: 'Ничего', mug: 'Кружка', mug_best: 'Лучший сотрудник' })}</div>
      <div class="field">Питомец рядом${tiles('pet', L.pet, PET_NAMES)}</div>`,
    bg: `<div class="field">Фон${tiles('bg', L.bg, BG_NAMES)}</div><p class="small" style="margin:0">«Под кожу» сам подбирает цвет, на котором лицо не сливается с фоном.</p>`,
    meme: `<div class="field">В руках${tiles('prop', ['none', 'papers', 'sign', 'laptop'], PROP_NAMES)}</div><p class="small" style="margin:0">Детали с ценой можно примерить бесплатно, а сохранить — после покупки в Лавке. Корона и рамки — тоже в Лавке.</p>`
  }[cat];
  const locked = draftLocked();
  return `<div class="ava-ed">
    <div class="ava-stage">${avatar(view(d), 170)}
      <div class="ava-tools"><button class="tool" data-act="ava-random" aria-label="Случайный аватар">🎲</button><button class="tool" data-act="ava-reset" aria-label="Вернуть как было">↺</button></div>
    </div>
    <div class="presets">${AVA_PRESETS.map((pr) => { const cost = Object.entries(pr.look).reduce((a, [k, v]) => { const it = partLocked(k, v); return a + (it ? it.price : 0); }, 0);
      return `<button class="preset ${pr.legend ? 'legend' : ''}" data-act="ava-preset" data-v="${pr.id}">${avatar({ ...d, ...pr.look, frame: null, crown: false }, 52)}<span>${pr.legend ? '⭐ ' : ''}${esc(pr.name)}</span>${cost ? `<em>${cost} ${BEAN}</em>` : ''}</button>`; }).join('')}</div>
    <div class="cats" role="tablist">${AVA_CATS.filter(([id]) => (id !== 'makeup' || d.preset === 'f') && (id !== 'beard' || d.preset !== 'f')).map(([id, label]) => `<button class="cat ${cat === id ? 'on' : ''}" role="tab" aria-selected="${cat === id}" data-act="ava-cat" data-v="${id}">${label}</button>`).join('')}</div>
    ${hideBar ? `<div class="hide-bar"><span class="small">В превью:</span>${hideBar}<span class="small">— на аватар не влияет</span></div>` : ''}
    <div class="cat-body">${body}</div>
    <div class="ava-foot">
      ${locked ? `<button class="btn grow" data-act="ava-buy" data-v="${locked.id}" ${S.me.beans < locked.price ? 'disabled' : ''}>Купить «${esc(locked.name)}» · ${locked.price} ${BEAN}</button>`
        : `<button class="btn grow" data-act="ava-save">${S.avaMode === 'vacation' ? 'Сохранить образ для отпуска' : 'Сохранить'}</button>`}
      <button class="btn ghost" data-act="close">Отмена</button>
    </div>
    ${!locked && S.avaMode !== 'vacation' ? '<button class="linkbtn" data-act="ava-save-vac" style="align-self:center">Сохранить как образ для отпуска</button>' : ''}
  </div>`;
}

const MOUTH_NAMES = { smile: 'Улыбка', grin: 'До ушей', smirk: 'Ухмылка', neutral: 'Серьёзный', sad: 'Грустный', wow: 'Удивлён' };
const BEARD_NAMES = { none: 'Нет', stubble: 'Щетина', beard: 'Борода', mustache: 'Усы', goatee: 'Эспаньолка' };
const VIS_NAMES = { all: 'Всем', gang: 'Членам моих банд', hidden: 'Никому' };
function section(id, title, summary, body, opts = {}) {
  const open = S.sec.has(id);
  return `<section class="psec ${open ? 'open' : ''}">
    <button class="psec-head" data-act="sec" data-v="${id}" aria-expanded="${open}">
      ${opts.lead || ''}<span class="grow"><span class="psec-title">${title}</span>${summary ? `<span class="psec-sum">${summary}</span>` : ''}</span>
      <span class="psec-edit">${open ? 'Свернуть' : PENCIL}</span>
    </button>
    ${open ? `<div class="psec-body">${body}</div>` : ''}
  </section>`;
}

// Идеи и ошибки: форма + мои сообщения с ответами модератора
const FB_STATUS_CLS = { new: '', planned: 'blue', done: 'good', declined: 'muted' };
function renderFeedback() {
  const f = S.fb || (S.fb = { kind: 'idea', text: '' });
  const bug = f.kind === 'bug';
  const items = S.fbItems;
  return `<p class="sub" style="margin-top:0">Этаж делают для своих — пиши, что бесит, чего не хватает и что сломалось. Отвечаем каждому. Если идею возьмём в работу или подтвердим баг — +10 зёрен.</p>
    <div class="chips">
      <button class="chip ${bug ? '' : 'on'}" data-act="fb-kind" data-v="idea" aria-pressed="${!bug}">Идея</button>
      <button class="chip ${bug ? 'on' : ''}" data-act="fb-kind" data-v="bug" aria-pressed="${bug}">Ошибка</button>
    </div>
    <label class="field"><span class="hidden">Текст</span><textarea id="fb-text" rows="5" maxlength="1000" placeholder="${bug ? 'Что делал → что ожидал → что получилось. Например: открыл чат банды, нажал «На кофе», ничего не пришло' : 'Чего не хватает или что сделать удобнее. Например: хочу видеть, кто сегодня обедает в столовой'}">${esc(f.text)}</textarea></label>
    <button class="btn" data-act="fb-send">Отправить</button>
    <p class="small" style="margin:0">${bug ? 'К сообщению приложим версию приложения и тип телефона и браузера — чтобы повторить ошибку. ' : ''}Видит только модератор.</p>
    <h3 style="margin:18px 0 6px">Мои сообщения</h3>
    ${!items ? '<p class="small">Загружаем…</p>' : items.length ? items.map((x) => `<div class="fb-item ${x.unseen ? 'new' : ''}">
      <div class="row" style="justify-content:space-between;gap:8px"><span class="small"><b>${x.kind === 'bug' ? 'Ошибка' : 'Идея'}</b> · ${ddmm(new Date(x.at).toISOString().slice(0, 10))}</span><span class="fb-st ${FB_STATUS_CLS[x.status] || ''}">${esc(x.statusName)}${x.rewarded ? ' · +10' : ''}</span></div>
      <div class="fb-text">${esc(x.text)}</div>
      ${x.reply ? `<div class="fb-reply"><b>Ответ:</b> ${esc(x.reply)}</div>` : ''}
    </div>`).join('') : '<p class="small">Пока пусто. Первое сообщение — самое ценное.</p>'}`;
}

function renderProfile() {
  const me = S.me;
  const L = S.cat.look;
  const look = me.look;
  const p = me.profile;
  const sw = (key, vals) => `<div class="row" style="flex-wrap:wrap;gap:8px">${vals.map((v) => `<button class="swatch ${look[key] === v ? 'on' : ''}" style="background:${HOODIE[v] || v}" data-act="look" data-k="${key}" data-v="${v}" aria-label="${key} ${v}"></button>`).join('')}</div>`;
  const tiles = (key, vals, names) => `<div class="ava-tiles">${vals.map((v) => `<button class="ava-tile ${look[key] === v ? 'on' : ''}" data-act="look" data-k="${key}" data-v="${v}">${avatar({ ...look, [key]: v, frame: null, crown: false }, 60, ['mouth', 'beard'].includes(key))}<span>${names[v] || v}</span></button>`).join('')}</div>`;
  const pushState = !('Notification' in window) ? 'unsupported' : Notification.permission;
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const got = S.fx ? S.fx.achievements.filter((a) => a.got).length : null;
  const planDays = (k) => S.cat.days.filter((d) => p.plan[d] === k);
  const plan = [planDays('office').length ? `${planDays('office').join(' ')} — офис` : '', planDays('home').length ? `${planDays('home').join(' ')} — дома` : ''].filter(Boolean).join(', ') || 'план не заполнен';
  const office = (S.cat.offices.find((o) => o.id === p.home) || {}).name;

  const vac = p.vacationLook ? { ...look, ...p.vacationLook, status: look.status, frame: look.frame, crown: look.crown } : null;
  const lookBody = `
    <div class="look-hero">${avatar(look, 120)}${vac ? `<button class="look-vac" data-act="ava-open-vac" aria-label="Изменить образ для отпуска">${avatar(vac, 56)}<span class="small">в отпуске ✎</span></button>` : ''}</div>
    <div class="row"><button class="btn grow" data-act="ava-open">🎨 Конструктор</button><button class="btn ghost grow" data-act="meme-open">🖼 Сделать мем</button></div>
    <p class="small" style="margin:0">${vac ? 'Пока ты в отпуске, банда видит второй образ. ' + '<button class="linkbtn" data-act="vac-look-clear">Убрать образ для отпуска</button>' : 'В конструкторе можно собрать и второй образ — для отпуска. Банда увидит его, пока ты отдыхаешь.'}</p>`;

  const nameBody = `
    <div class="field">Никнейм
      ${S.nickConfirm ? `<div class="note warn" style="margin:0">Сменить ${esc(me.nick)} на <b>${esc(S.nickConfirm)}</b> за ${S.cat.nickPrice} зёрен? Старый ник освободится, и его сможет занять кто-то другой.</div>
      <div class="row"><button class="btn small grow" data-act="nick-yes">Да, сменить</button><button class="btn small ghost grow" data-act="nick-no">Отмена</button></div>`
      : `<div class="row"><label class="grow" style="display:flex"><span class="hidden">Новый никнейм</span><input id="p-nick" maxlength="21" value="${esc(me.nick)}" aria-label="Новый никнейм"></label>
      <button class="btn small" data-act="nick-change" ${me.beans < S.cat.nickPrice ? 'disabled' : ''}>Сменить</button></div>
      <span class="small" style="font-weight:600">${me.beans < S.cat.nickPrice ? `Смена стоит ${S.cat.nickPrice} зёрен, у тебя ${me.beans}.` : `Стоит ${S.cat.nickPrice} зёрен. Буквы, цифры и «_», от 3 до 20 символов.`}</span>`}</div>
    <div class="row" style="gap:8px">
      <label class="field grow">Имя<input id="p-first" maxlength="30" value="${esc(p.firstName)}" autocomplete="given-name"></label>
      <label class="field grow">Фамилия<input id="p-last" maxlength="30" value="${esc(p.lastName)}" autocomplete="family-name"></label>
    </div>
    <div class="field">Кто видит имя и фамилию<div class="chips">${Object.entries(VIS_NAMES).map(([k, l]) => `<button class="chip ${p.nameVis === k ? 'on' : ''}" data-act="name-vis" data-v="${k}">${l}</button>`).join('')}</div>
      <span class="small" style="font-weight:600">${p.nameVis === 'all' ? 'Увидят и те, кто не в твоих бандах, например пара в случайном кофе.' : p.nameVis === 'gang' ? 'Видят члены твоих банд. Остальные — только ник.' : 'Все видят только ник.'}</span></div>
    <button class="btn ghost" data-act="name-save">Сохранить имя</button>`;

  const workBody = `
    <div class="field">Статус<div class="chips">${Object.entries(S.cat.moods).map(([k, l]) => `<button class="chip ${p.mood === k ? 'on' : ''}" data-act="prof" data-k="mood" data-v="${k}">${esc(l)}</button>`).join('')}</div></div>
    <label class="field">Мой офис — на главной кнопке отметки<select id="home-office">
      <option value="">Не выбран</option>${S.cat.offices.slice().sort((x, y) => x.name.localeCompare(y.name, 'ru')).map((o) => `<option value="${esc(o.id)}" ${p.home === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
    <div class="field">План недели — нажимай, чтобы переключить: офис → дом → не знаю
      <div class="plan">${S.cat.days.map((d) => { const v = p.plan[d]; return `<button class="plan-day ${v || 'none'}" data-act="plan-day" data-v="${d}" aria-label="${d}: ${v === 'office' ? 'офис' : v === 'home' ? 'дом' : 'не задано'}"><b>${d}</b><span>${v === 'office' ? 'Офис' : v === 'home' ? 'Дом' : '—'}</span></button>`; }).join('')}</div>
      <span class="small" style="font-weight:600">Банда видит «по плану из дома» или «собирается в офис». Отметка в офисе всегда важнее плана.</span></div>`;

  const vacBody = `
    ${p.vacations.length ? p.vacations.map((v, i) => `<div class="item"><span class="grow" style="color:var(--ink);font-weight:800">🌴 ${ddmm(v.from)} — ${ddmm(v.to)}</span><button class="btn small danger" data-act="vac-del" data-v="${i}">Удалить</button></div>`).join('') : '<span class="small" style="font-weight:600">Пока пусто. В эти дни банда увидит «в отпуске до …», а зовы не будут присылать пуши.</span>'}
    <div class="row" style="gap:6px;align-items:flex-end">
      <label class="field grow">С<input id="vac-from" type="date"></label>
      <label class="field grow">По<input id="vac-to" type="date"></label>
      <button class="btn small" data-act="vac-add" style="min-height:48px">Добавить</button>
    </div>`;

  const aboutBody = `
    <div class="field">Интересы (до 5)<div class="chips">${S.cat.tags.map((t) => `<button class="chip ${p.tags.includes(t) ? 'on' : ''}" data-act="prof-tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
    <label class="field">О себе (до 60 символов)<input id="p-about" maxlength="60" value="${esc(p.about)}" placeholder="Люблю кофе и настолки"></label>
    <label class="field">День рождения (ДД.ММ, без года)<input id="p-bday" maxlength="5" inputmode="numeric" value="${esc(p.bday)}" placeholder="14.03"></label>
    <button class="btn ghost" data-act="prof-save">Сохранить</button>`;

  const privBody = `
    <label class="check"><input type="checkbox" data-act="toggle" data-k="shareOffice" ${me.shareOffice ? 'checked' : ''}> <span>Показывать банде, где я: офис, дома или в отпуске</span></label>
    <label class="check"><input type="checkbox" data-act="toggle" data-k="quiet" ${me.quiet ? 'checked' : ''}> <span>Тихие часы 19:00–09:00 — не присылать зовы</span></label>
    <label class="check"><input type="checkbox" data-act="findable-toggle" ${p.findable !== false ? 'checked' : ''}> <span>Меня можно найти по нику и рабочей почте — и позвать в банду</span></label>
    <div class="snd-set">
      <label class="field" style="gap:4px"><span>Громкость звуков: <b id="vol-n">${soundVol() ? soundVol() + '%' : 'выкл'}</b></span>
        <input type="range" id="snd-vol" min="0" max="100" step="5" value="${soundVol()}" aria-label="Громкость звуков интерфейса"></label>
      <div class="row" style="justify-content:space-between;gap:8px">
        <label class="check" style="margin:0"><input type="checkbox" data-act="vibro-toggle" ${vibroOn() ? 'checked' : ''}> <span>Вибрация${navigator.vibrate ? '' : ' <span class="small">(этот браузер не умеет)</span>'}</span></label>
        <button class="btn small ghost" data-act="sound-test">Послушать</button>
      </div>
    </div>
    <label class="check"><input type="checkbox" data-act="coffee-toggle" ${p.coffee ? 'checked' : ''}> <span>Участвовать в случайном кофе${p.home ? '' : ' (сначала укажи «Мой офис» в разделе «Работа»)'}</span></label>
    ${pushState === 'granted' && !(me.completion.steps.find((x) => x.id === 'push') || {}).done ? `<div class="note warn" style="margin:0">Браузер разрешил уведомления, но этот телефон не подключён к серверу — пуши не придут.</div><button class="btn blue" data-act="push-enable" ${S.vapidKey ? '' : 'disabled'}>Подключить уведомления</button>`
      : pushState === 'granted' ? '<div class="row"><span class="note good grow">Уведомления включены</span><button class="btn small ghost" data-act="push-test">Проверить</button></div>'
      : pushState === 'unsupported' ? `<div class="note warn">${isIOS() && !isStandalone() ? 'На iPhone уведомления работают только из установленного приложения.' : 'Этот браузер не поддерживает уведомления.'}</div>`
      : pushState === 'denied' ? '<div class="note warn">Уведомления запрещены в настройках браузера.</div>'
      : `<button class="btn blue" data-act="push-enable" ${S.vapidKey ? '' : 'disabled'}>Включить уведомления</button>`}
    <button class="btn ghost" data-act="open" data-v="install">Как установить на телефон</button>`;

  return `
    <div class="prof-hero">${progressRing(me.completion.pct, avatar(look, 72))}<div class="grow">
      <div class="nick" style="color:var(--ink)">${esc(me.nick)}</div>
      ${name ? `<div class="small" style="font-weight:700">${esc(name)}</div>` : ''}
      ${me.status ? `<div class="status" style="color:#B7791F">${esc(me.status)}</div>` : ''}
      <div class="small">${me.beans} ${plural(me.beans, 'зерно', 'зерна', 'зёрен')}</div></div></div>
    ${renderCompletion(true)}
    ${section('look', 'Внешность', `${OUTFIT_NAMES[look.outfit] || 'Худи'} · ${(HAIR_NAMES[look.hairStyle] || '').toLowerCase()}${look.prop && look.prop !== 'none' ? ' · ' + (PROP_NAMES[look.prop] || '').toLowerCase() : ''}`, lookBody)}
    ${section('name', 'Ник, имя и фамилия', name ? `${esc(name)} · видят: ${VIS_NAMES[p.nameVis].toLowerCase()}` : 'Имя не указано', nameBody)}
    ${section('ach', 'Ачивки', got == null ? '' : `${got} из ${S.fx.achievements.length}`, renderAchievements())}
    ${section('work', 'Работа', `${office || 'офис не указан'} · ${plan}`, workBody)}
    ${section('vac', 'Отпуска', p.vacations.length ? p.vacations.map((v) => `${ddmm(v.from)}–${ddmm(v.to)}`).join(', ') : 'не запланированы', vacBody)}
    ${section('about', 'О себе', [p.about && esc(p.about), p.bday && 'ДР ' + esc(p.bday)].filter(Boolean).join(' · ') || 'интересы, пара слов, день рождения', aboutBody)}
    ${section('priv', 'Приватность, звук и уведомления', `${me.shareOffice ? 'банда видит, где я' : 'где я — скрыто'}${me.quiet ? ' · тихие часы' : ''} · ${soundVol() ? 'звук ' + soundVol() + '%' : 'без звука'}`, privBody)}
    <button class="fb-entry" data-act="open" data-v="feedback"><span class="grow"><b>Есть идея или нашёл ошибку?</b><span class="small">Напиши — ответим. За принятую идею +10 зёрен</span></span>${(S.state && S.state.badges && S.state.badges.feedback) ? `<span class="fb-count">${S.state.badges.feedback}</span>` : '<span class="chev" aria-hidden="true">›</span>'}</button>
    ${me.isAdmin ? '<a class="btn violet" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="/admin.html">Модерация</a>' : ''}
    <div class="row" style="justify-content:space-between">
      <button class="linkbtn" data-act="logout">Выйти</button>
      <a class="linkbtn" href="/privacy.html" target="_blank" rel="noopener">Политика</a>
      <button class="linkbtn" style="color:#B42318" data-act="delete-account">Удалить аккаунт</button>
    </div>`;
}

function renderPerson() {
  const x = S.person;
  if (!x) return '<p class="sub">Загружаем…</p>';
  const [w, color] = x.where ? whereText(x) : ['', ''];
  const rows = [];
  if (x.full) {
    if (x.where && x.where !== 'hidden') rows.push(['Сейчас', `<span class="dot" style="background:${color}"></span> ${esc(w)}${x.mood && x.where === 'office' ? ' · ' + esc(x.mood) : ''}`]);
    if (x.home) rows.push(['Обычно в офисе', esc(x.home)]);
    if (x.bday) rows.push(['День рождения', esc(x.bday)]);
    if (x.gangs && x.gangs.length) rows.push([x.gangs.length > 1 ? 'Общие банды' : 'Общая банда', x.gangs.map(esc).join(', ')]);
    if (x.crew) rows.push(['Подельник', 'да']);
  }
  return `<div class="person-card">
    <div class="person-ava">${avatar(x.look, 180)}</div>
    <div class="nick" style="color:var(--ink);text-align:center">${esc(x.nick)}${x.me ? ' (ты)' : ''}</div>
    ${x.name ? `<div class="sub" style="text-align:center;margin:0;font-weight:700">${esc(x.name)}</div>` : ''}
    ${x.status ? `<div class="status" style="color:#B7791F;text-align:center">${esc(x.status)}</div>` : ''}
    ${x.about ? `<p class="person-about">«${esc(x.about)}»</p>` : ''}
    ${x.tags && x.tags.length ? `<div class="chips" style="justify-content:center">${x.tags.map((t) => `<span class="chip on" style="cursor:default">${esc(t)}</span>`).join('')}</div>` : ''}
    ${rows.length ? `<div class="person-rows">${rows.map(([k, v]) => `<div><span class="small">${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
    ${!x.full ? '<p class="small" style="text-align:center">Подробности видят члены общих банд.</p>' : ''}
    ${x.me ? '<button class="btn ghost" data-act="open" data-v="profile">Редактировать мой профиль</button>'
      : x.full ? `<div class="row"><button class="btn grow" data-act="dm-open" data-id="${x.id}">💬 Написать</button><button class="btn ghost grow" data-act="pcall-open" data-id="${x.id}">📣 Позвать</button></div>` : ''}
  </div>`;
}

function renderShop() {
  if (!S.shop) return '<p class="sub">Загружаем…</p>';
  const groups = [['part', 'Детали для аватара'], ['status', 'Статусы'], ['frame', 'Рамки аватара'], ['crown', 'Особое'], ['gang', 'Для банды']];
  const item = (it) => {
    let action;
    if (it.kind === 'gang') {
      action = S.me.gangs.length ? `<button class="btn small" data-act="buy" data-v="${it.id}" ${S.shop.beans < it.price ? 'disabled' : ''}>${it.price} ${BEAN}</button>` : '<span class="small">нужна банда</span>';
    } else if (it.kind === 'part') {
      const prev = avatar({ ...S.me.look, [it.slot]: it.value, frame: null, crown: false }, 44);
      action = it.owned ? `<button class="btn small ghost" data-act="ava-open" data-cat="${it.slot === 'prop' ? 'meme' : it.slot === 'outfit' ? 'outfit' : it.slot === 'hairStyle' ? 'hair' : it.slot === 'eyeShape' ? 'eyes' : 'acc'}">В конструктор</button>`
        : `<button class="btn small" data-act="buy" data-v="${it.id}" ${S.shop.beans < it.price ? 'disabled' : ''}>${it.price} ${BEAN}</button>`;
      return `<div class="item">${prev}<div class="grow"><div style="font-weight:900">${it.legend ? '⭐ ' : ''}${esc(it.name)}</div><div class="small">${it.owned ? 'куплено — надень в конструкторе' : 'можно примерить в конструкторе'}</div></div>${action}</div>`;
    } else if (it.owned) {
      action = `<button class="btn small ${it.equipped ? 'green' : 'ghost'}" data-act="equip" data-v="${it.id}" data-on="${it.equipped ? '0' : '1'}">${it.equipped ? 'Надето' : 'Надеть'}</button>`;
    } else if (it.left === 0) {
      action = '<span class="small">тираж закончился</span>';
    } else {
      action = `<button class="btn small" data-act="buy" data-v="${it.id}" ${S.shop.beans < it.price ? 'disabled' : ''}>${it.price} ${BEAN}</button>`;
    }
    return `<div class="item"><div class="grow"><div style="font-weight:900">${it.color ? `<span class="dot" style="background:${it.color}"></span>` : ''}${esc(it.name)}</div>
      ${it.left !== undefined ? `<div class="small">осталось ${it.left}</div>` : ''}</div>${action}</div>`;
  };
  const gangSel = S.me.gangs.length > 1 ? `<div class="field">Покупка для банды<div class="chips">${S.me.gangs.map((g) => `<button class="chip ${g.id === (S.shopGang || S.activeGang) ? 'on' : ''}" data-act="shop-gang" data-v="${g.id}">${esc(g.name)}</button>`).join('')}</div></div>` : '';
  return `<div class="note warn">У тебя ${S.shop.beans} зёрен</div>
    ${groups.map(([k, title]) => `<h3>${title}</h3>${k === 'gang' ? gangSel : ''}${S.shop.items.filter((i) => i.kind === k).map(item).join('')}`).join('')}
    ${S.gang && S.gang.gang.mottoOwned ? `<label class="field">Девиз банды «${esc(S.gang.gang.name)}»<input id="motto" maxlength="40" value="${esc(S.gang.gang.motto || '')}"></label><button class="btn ghost" data-act="motto-save">Сохранить девиз</button>` : ''}
    <h3>Как заработать</h3>
    <ol class="ol"><li>Отметка в офисе — +5 (раз в день)</li><li>Отметка в столовой — +2 (до 2 раз в день)</li><li>Ответ на зов банды — +1 (до 10 в день)</li><li>Подтверждённый сигнал офиса — +2 (до 3 в день)</li><li>Банда набрала 3 человек — залог 50 вернётся</li></ol>`;
}

// ---------- Действия ----------
// Опасное действие подтверждается вторым нажатием в течение 4 секунд
function confirmTwice(id, text) {
  const t = Date.now();
  if (S.confirmId === id && t - S.confirmAt < 4000) { S.confirmId = null; return true; }
  S.confirmId = id; S.confirmAt = t; toast(text); return false;
}

async function run(fn, { rerender = true } = {}) {
  S.error = '';
  try { await fn(); } catch (e) {
    sfx('error');
    if (S.sheet) S.error = e.message; else toast(e.message);
  }
  if (rerender) render();
}

const actions = {
  async 'login-submit'() {
    const email = $('#email').value.trim();
    S.onb.email = email;
    if (!$('#consent').checked) { S.onb.error = 'Отметь согласие с политикой и правилами.'; return render(); }
    S.busy = true; S.onb.error = ''; render();
    try {
      const r = await post('/api/auth/request', { email, consent: true });
      S.onb = { ...S.onb, step: 'sent', error: '', devLink: r.devLink || null, devCode: r.devCode || null };
    } catch (e) { S.onb.error = e.message; }
    S.busy = false; render();
  },
  async 'code-submit'() {
    try {
      await post('/api/auth/code', { email: S.onb.email, code: $('#code').value });
      await boot();
    } catch (e) { S.onb.error = e.message; render(); }
  },
  'onb-back'() { S.onb.step = 'email'; S.onb.error = ''; render(); },
  async 'nick-more'() { S.onb.nicks = (await get('/api/nick-suggestions')).nicks; render(); },
  'nick-pick'(el) { S.onb.nick = el.dataset.v; render(); },
  'onb-preset'(el) { S.onb.nick = $('#nick').value; S.onb.preset = el.dataset.v; render(); },
  async 'nick-submit'() {
    const nick = $('#nick').value.trim();
    S.onb.nick = nick;
    try {
      await post('/api/me/nick', { nick });
      const f = S.onb.preset === 'f';
      await post('/api/me/profile', { look: { preset: f ? 'f' : 'm', hairStyle: f ? 'long' : 'short' } });
      await boot();
      toast('+50 зёрен на старт');
      if (!isStandalone()) { S.sheet = 'install'; render(); }
    } catch (e) { S.onb.error = e.message; render(); }
  },

  async tab(el) {
    if (S.tab !== el.dataset.v) tabSound(el.dataset.v);
    S.tab = el.dataset.v; S.sheet = null; render();
    await run(() => refresh());
  },
  checkin: (el) => run(async () => {
    S.sheet = null;
    const r = await post('/api/checkin', { office: el.dataset.v });
    try { store.set('recentOffices', [el.dataset.v, ...recentOffices().filter((id) => id !== el.dataset.v)].slice(0, 5)); } catch {}
    S.officeQ = '';
    if (r.beans) toast(`+${r.beans} зёрен за отметку`);
    await refresh({ all: true });
  }),
  checkout: () => run(async () => { await post('/api/checkout'); toast('Хорошего вечера!'); await refresh(); }),
  'canteen-in': () => run(async () => { const r = await post('/api/canteen/in'); toast(r.beans ? `Приятного аппетита! +${r.beans}` : 'Приятного аппетита!'); await Promise.all([loadState(), loadFeatures()]); }),
  'canteen-out': () => run(async () => { await post('/api/canteen/out'); await loadState(); }),
  'share-on': () => run(async () => { await post('/api/me/profile', { shareOffice: true }); S.me.shareOffice = true; await loadState(); }),

  'gang-select': (el) => run(async () => { S.activeGang = Number(el.dataset.v); store.set('activeGang', S.activeGang); S.thanksTo = null; await Promise.all([loadGang(), loadGangExtra()]); }),
  'gang-create': () => run(async () => {
    const r = await post('/api/gangs', { name: $('#gang-name').value });
    S.activeGang = r.id; store.set('activeGang', r.id);
    await loadMe(); await loadGang();
    toast('Банда сколочена. Зови своих по ссылке');
  }),
  'gang-join': () => run(async () => joinByCode($('#gang-code').value)),
  'gang-leave': () => run(async () => {
    if (!confirmInline('gang-leave')) return;
    await post(`/api/gangs/${S.activeGang}/leave`);
    S.activeGang = null; await loadMe(); await loadGang();
  }),
  'invite-share': async () => {
    const link = S.gang.gang.link;
    const text = `Вступай в банду «${S.gang.gang.name}» в Этаже: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Этаж', text, url: link });
      else { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); }
    } catch {}
  },
  'call-open': async (el) => {
    const gang = Number(el.dataset.gang || S.activeGang);
    if (gang !== S.activeGang || !S.gang) { S.activeGang = gang; await loadGang().catch(() => {}); }
    const def = S.cat.calls[el.dataset.kind];
    S.compose = { kind: el.dataset.kind, gang, to: el.dataset.to ? Number(el.dataset.to) : null, opt: def.opts[0] || null, text: '' };
    S.sheet = 'compose'; S.error = ''; render();
  },
  'c-to'(el) { saveComposeText(); S.compose.to = el.dataset.v ? Number(el.dataset.v) : null; render(); },
  'c-opt'(el) { saveComposeText(); S.compose.opt = el.dataset.v; render(); },
  'call-send': () => run(async () => {
    saveComposeText();
    const c = S.compose;
    if (c.dm) {
      const r = await post(`/api/crew/${c.dm}/messages`, { type: 'call', kind: c.kind, opt: c.opt, text: c.text });
      S.sheet = null;
      toast(r.quiet ? 'Отправлено. Сейчас тихие часы — пуш может не прийти' : 'Зов отправлен');
      if (S.tab === 'chats' && S.dm) await loadDm();
      return;
    }
    const r = await post(`/api/gangs/${c.gang}/messages`, { type: 'call', kind: c.kind, to: c.to, opt: c.opt, text: c.text });
    S.sheet = null;
    toast(r.away ? `Зов отправлен. ${r.away === 1 && c.to ? 'Человек в отпуске' : 'Кто-то в отпуске'} — пуш не придёт, увидит в чате` : r.quiet ? 'Отправлено. Сейчас тихие часы — у кого они включены, пуш не придёт' : 'Зов отправлен');
    await loadGang(); if (S.tab === 'chats' && S.chatGang) markSeen('chat');
  }),
  reply: (el) => run(async () => { const r = await post(`/api/messages/${el.dataset.id}/reply`, { label: el.dataset.v }); if (r.beans) toast(`+${r.beans} зерно`); await loadGang(); }),
  'chat-send': () => run(async () => {
    const text = $('#chat-text').value;
    if (!text.trim()) return;
    await post(`/api/gangs/${S.activeGang}/messages`, { type: 'text', text });
    await loadGang(); markSeen('chat');
  }),
  'dm-open': (el) => run(async () => {
    S.tab = 'chats'; S.chatGang = false; S.battle = null; S.sheet = null; S.dm = Number(el.dataset.id); S.dmView = null; render();
    await Promise.all([loadDm(), S.crew ? null : loadCrew()]);
    if (S.crew) { const f = S.crew.list.find((x) => x.id === S.dm); if (f) f.unread = 0; recountCrewBadge(); }
    window.scrollTo(0, 0);
  }),
  'battle-new': (el) => run(async () => {
    const r = await post('/api/battle', { to: Number(el.dataset.id), mode: el.dataset.mode || 'calm' });
    S.tab = 'chats'; S.chatGang = false; S.sheet = null; S.dm = S.dm || Number(el.dataset.id); S.battle = r.id; S.bv = null; await loadBattle(); window.scrollTo(0, 0);
    if (!r.existing) toast(el.dataset.mode === 'fast' ? 'Быстрая партия! Часы пойдут, когда оба нажмут «В бой»' : 'Вызов отправлен. Расставляй флот');
  }),
  'battle-open': (el) => run(async () => { S.battle = Number(el.dataset.id); S.bv = null; await loadBattle(); window.scrollTo(0, 0); }),
  'battle-back': () => run(async () => {
    const opp = S.bv ? S.bv.opp.id : null; S.battle = null; S.bv = null;
    if (opp) { S.dm = opp; await loadDm(); } else S.dm = null;
    await Promise.all([loadCrew(), loadChats()]);
  }),
  bemote: (el) => {
    const e = el.dataset.v;
    if (S.bEmoteAt && Date.now() - S.bEmoteAt < 2500) return;
    S.bEmoteAt = Date.now();
    S.bEmote = { ...(S.bEmote || {}), mine: { e, until: Date.now() + 3200 } };
    render(); setTimeout(() => { if (S.battle) render(); }, 3300);
    post(`/api/battle/${S.battle}/emote`, { e }).catch(() => {});
  },
  bshuffle: () => run(async () => { setBattleView(await post(`/api/battle/${S.battle}/shuffle`)); }),
  bready: () => run(async () => { setBattleView(await post(`/api/battle/${S.battle}/ready`)); }),
  bresign: () => run(async () => {
    const playing = S.bv && S.bv.status === 'play';
    if (!confirmTwice('bresign', playing ? 'Нажми ещё раз, чтобы сдаться' : 'Нажми ещё раз, чтобы отказаться')) return;
    S.bResigned = true;
    S.bv = await post(`/api/battle/${S.battle}/resign`); S.bvAt = Date.now();
    sfx('chicken');
  }),
  bshoot: (el) => {
    if (S.bBusy) return; S.bBusy = true;
    run(async () => {
      try {
        const r = await post(`/api/battle/${S.battle}/shoot`, { x: Number(el.dataset.x), y: Number(el.dataset.y) });
        setBattleView(r.view);
        const t = { miss: 'Мимо', hit: 'Ранил! Стреляй ещё', sunk: 'Потопил! Стреляй ещё' }[r.result];
        S.bShout = { text: r.view.status === 'done' ? (r.beans ? `Победа! +${r.beans} зёрен` : 'Победа!') : t, cls: r.view.status === 'done' ? 'sunk' : r.result, until: Date.now() + 1400, board: 'o' };
        sfx(r.view.status === 'done' ? 'sunk' : r.result === 'miss' ? 'splash' : r.result);
        if (r.view.status === 'done') { loadMe().catch(() => {}); loadFeatures().catch(() => {}); }
        setTimeout(() => { if (S.battle) render(); }, 1500);
      } finally { S.bBusy = false; }
    });
  },
  'dm-back': () => run(async () => { S.dm = null; S.dmView = null; await Promise.all([loadChats(), loadCrew(), loadState()]); }),
  'chats-back': () => run(async () => { S.chatGang = false; await Promise.all([loadChats(), loadState()]); }),
  'gang-open': (el) => run(async () => {
    S.tab = 'chats'; S.dm = null; S.chatGang = true; S.activeGang = Number(el.dataset.id); store.set('activeGang', S.activeGang);
    const sg = store.get('seenGang', {}); sg[S.activeGang] = Date.now(); store.set('seenGang', sg);
    render(); await Promise.all([loadGang(), loadGangExtra()]); markSeen('chat'); window.scrollTo(0, 0);
  }),
  'gang-invite': (el) => run(async () => { S.activeGang = Number(el.dataset.id); if (!S.gang || S.gang.gang.id !== S.activeGang) await loadGang(); await actions['invite-share'](); }, { rerender: false }),
  'find-open'() { S.find = S.find || {}; S.sheet = 'find'; S.lastSheet = null; render(); setTimeout(() => { const i = $('#find-q'); if (i) i.focus(); }, 50); },
  'find-go': () => run(async () => {
    const qv = $('#find-q').value.trim();
    S.find = { q: qv, ...(await get('/api/search?q=' + encodeURIComponent(qv))) };
  }),
  'find-invite': (el) => run(async () => {
    await post(`/api/gangs/${el.dataset.gang}/invite`, { to: Number(el.dataset.id) });
    toast('Позвали! Придёт пуш, ждём ответа');
    S.find = { q: S.find.q, ...(await get('/api/search?q=' + encodeURIComponent(S.find.q))) };
  }),
  'invite-accept': (el) => run(async () => {
    const r = await post(`/api/invites/${el.dataset.id}/accept`);
    toast('Ты в банде!'); await loadMe();
    S.activeGang = r.gang; store.set('activeGang', r.gang); S.chatGang = true; S.dm = null;
    await Promise.all([loadChats(), loadGang(), loadGangExtra(), loadState()]);
  }),
  'invite-decline': (el) => run(async () => { await post(`/api/invites/${el.dataset.id}/decline`); await Promise.all([loadChats(), loadState()]); }),
  'pcall-open'(el) { S.pcallTo = Number(el.dataset.id); S.sheet = 'pcall'; S.lastSheet = null; render(); },
  pcall(el) {
    const id = Number(el.dataset.id), kind = el.dataset.kind, def = S.cat.calls[kind];
    const p = (S.people || []).find((x) => x.id === id) || (S.person && S.person.id === id ? S.person : null) || ((S.chats && S.chats.items) || []).find((x) => x.type === 'dm' && x.id === id) || {};
    S.compose = { kind, dm: id, nick: p.nick, opt: def.opts[0] || null, text: '' };
    S.sheet = 'compose'; S.error = ''; render();
  },
  'battle-go': (el) => run(async () => { S.tab = 'chats'; S.chatGang = false; S.dm = Number(el.dataset.opp); S.battle = Number(el.dataset.id); S.bv = null; render(); await loadBattle(); window.scrollTo(0, 0); }),
  'whatsnew-ok'() { store.set('ia2', 1); S.sheet = null; S.coach = 3; S.coachStart = 3; S.tab = 'near'; render(); },
  'dm-send': () => run(async () => {
    const el = $('#dm-text');
    const text = el.value;
    if (!text.trim()) return;
    el.value = '';
    try { await post(`/api/crew/${S.dm}/messages`, { type: 'text', text }); } catch (e) { el.value = text; throw e; }
    await loadDm();
  }),
  'dm-call-open'(el) {
    const def = S.cat.calls[el.dataset.kind];
    S.compose = { kind: el.dataset.kind, dm: S.dm, opt: def.opts[0] || null, text: '' };
    S.sheet = 'compose'; S.error = ''; render();
  },
  'dm-reply': (el) => run(async () => { await post(`/api/dm/${el.dataset.id}/reply`, { label: el.dataset.v }); await loadDm(); }),
  'crew-add': () => run(async () => {
    const nick = $('#crew-nick').value.trim();
    if (!nick) throw new Error('Впиши ник');
    const r = await post('/api/crew/add', { nick });
    $('#crew-nick').value = '';
    toast(r.accepted ? 'Теперь можно переписываться!' : r.already ? 'Вы уже на связи' : 'Заявка ушла. Ждём ответа');
    await loadCrew();
  }),
  'crew-add-id': (el) => run(async () => {
    const r = await post('/api/crew/add', { id: Number(el.dataset.id) });
    toast(r.accepted ? 'Теперь можно переписываться!' : 'Заявка ушла');
    await loadCrew();
  }),
  'crew-accept': (el) => run(async () => { await post(`/api/crew/${el.dataset.id}/accept`); toast('Теперь можно переписываться!'); await Promise.all([loadCrew(), loadChats(), loadState()]); }),
  'crew-decline': (el) => run(async () => { await post(`/api/crew/${el.dataset.id}/remove`); await Promise.all([loadCrew(), loadChats(), loadState()]); }),
  'crew-remove': (el) => run(async () => {
    if (!confirmInline('crew-remove', 'Нажми ещё раз: переписка удалится у вас обоих')) return;
    await post(`/api/crew/${el.dataset.id}/remove`);
    S.dm = null; S.dmView = null; toast('Отпустили'); await loadCrew();
  }),
  'crew-block': (el) => run(async () => {
    if (!confirmInline('crew-block', 'Нажми ещё раз: он больше не сможет писать и звать тебя')) return;
    await post(`/api/crew/${el.dataset.id}/block`);
    S.dm = null; S.dmView = null; toast('Заблокирован. Он об этом не узнает'); await loadCrew();
  }),
  'crew-unblock': (el) => run(async () => { await post(`/api/crew/${el.dataset.id}/unblock`); await loadCrew(); }),
  'crew-share': async () => {
    const link = S.crew.link;
    const text = `Давай будем подельниками в Этаже: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Этаж', text, url: link });
      else { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); }
    } catch {}
  },
  report: (el) => run(async () => {
    if (!confirmInline('report-' + el.dataset.type + el.dataset.id, 'Нажми ещё раз, чтобы пожаловаться')) return;
    await post('/api/report', { type: el.dataset.type, id: Number(el.dataset.id) });
    toast('Жалоба отправлена модераторам');
  }, { rerender: false }),

  's-type'(el) { saveSignalText(); S.signal = { ...(S.signal || {}), type: el.dataset.v }; render(); },
  'signal-send': () => run(async () => {
    saveSignalText();
    await post('/api/signals', S.signal);
    S.sheet = null; S.signal = null; toast('Сигнал отправлен. Ждём подтверждений'); await loadEvents();
  }),
  vote: (el) => run(async () => { await post(`/api/signals/${el.dataset.id}/vote`, { vote: Number(el.dataset.v) }); await loadEvents(); }),

  async open(el) {
    S.sheet = el.dataset.v; S.error = '';
    if (S.sheet === 'signal') S.signal = {};
    render();
    if (S.sheet === 'shop') sfx('click'); // Лавка — своя «касса»
    if (S.sheet === 'shop') { store.set('shopSeen', [...new Set([...store.get('shopSeen', []), ...((S.me && S.me.affordable) || [])])]); await run(async () => { S.shop = await get('/api/shop'); if (S.activeGang && !S.gang) await loadGang(); }); }
    if (S.sheet === 'profile' || S.sheet === 'lunch') await run(loadFeatures);
    if (S.sheet === 'feedback') await run(loadFeedback);
    if (S.sheet === 'crew-new' && !S.crew) await run(loadCrew);
    if ((S.sheet === 'battle-pick' || S.sheet === 'dm-pick') && !S.people) await run(loadPeople);
  },
  'fb-kind'(el) { const t = $('#fb-text'); S.fb = { kind: el.dataset.v, text: t ? t.value : '' }; render(); },
  'fb-send': () => run(async () => {
    const text = ($('#fb-text') || {}).value || '';
    if (text.trim().length < 5) throw new Error('Напиши хотя бы пару слов');
    const r = await post('/api/feedback', { kind: (S.fb || {}).kind || 'idea', text, tab: S.tab });
    S.fb = { kind: (S.fb || {}).kind || 'idea', text: '' }; S.fbItems = r.items;
    toast('Спасибо! Ответим здесь и пушем');
  }),
  'poll-new'() { S.pollDraft = { q: '', options: ['', ''], open: true, multi: false, days: 1 }; S.sheet = 'poll-new'; S.error = ''; render(); },
  'pd-more'() { savePollDraft(); S.pollDraft.options.push(''); render(); const l = [...document.querySelectorAll('.pd-o')].pop(); if (l) l.focus(); },
  'pd-days'(el) { savePollDraft(); S.pollDraft.days = Number(el.dataset.v); render(); },
  'poll-create': () => run(async () => {
    savePollDraft();
    const d = S.pollDraft;
    await post(`/api/gangs/${S.activeGang}/polls`, { question: d.q, options: d.options.filter((o) => o.trim()), open: d.open, multi: d.multi, days: d.days });
    S.sheet = null; S.pollDraft = null; toast('Опрос запущен'); await loadGang();
  }),
  'poll-vote': (el) => run(async () => {
    const r = await post(`/api/polls/${el.dataset.id}/vote`, { option: Number(el.dataset.v) });
    S.polls = (S.polls || []).map((p) => (p.id === r.poll.id ? r.poll : p));
    loadState().then(render).catch(() => {}); // бейдж «Чаты» пересчитает сервер
  }),
  'poll-add': (el) => run(async () => {
    const inp = $('#poll-add-' + el.dataset.id);
    if (!inp || !inp.value.trim()) throw new Error('Напиши вариант');
    const r = await post(`/api/polls/${el.dataset.id}/options`, { text: inp.value });
    S.polls = (S.polls || []).map((p) => (p.id === r.poll.id ? r.poll : p));
    toast(r.existed ? 'Такой вариант уже есть — голос за него' : 'Вариант добавлен, твой голос за него');
  }),
  'poll-close': (el) => run(async () => {
    const r = await post(`/api/polls/${el.dataset.id}/close`);
    S.polls = (S.polls || []).map((p) => (p.id === r.poll.id ? r.poll : p));
  }),
  // Плитка задания дня ведёт туда, где его можно выполнить
  'quest-go'(el) {
    const go = el.dataset.v;
    S.sheet = null;
    const firstGang = S.activeGang || (S.me.gangs[0] || {}).id;
    if (go === 'near') { S.tab = 'near'; tabSound('near'); }
    else if (go === 'office') { S.tab = 'office'; tabSound('office'); }
    else if (go === 'games') { S.tab = 'games'; tabSound('games'); }
    else if (go === 'gang' && firstGang) { S.tab = 'chats'; S.chatGang = true; S.dm = null; S.activeGang = firstGang; store.set('activeGang', firstGang); }
    else if (go === 'dm') { S.tab = 'chats'; S.dm = null; S.chatGang = false; return actions.open({ dataset: { v: 'dm-pick' } }); }
    else S.tab = 'chats';
    window.scrollTo(0, 0);
    run(() => refresh());
  },
  'blitz-start': () => run(async () => {
    S.blitz = await post('/api/blitz/start'); S.blitzFb = null; S.blitzLastTick = null;
    S.sheet = 'blitz'; blitzTick();
  }),
  'blitz-open': () => run(async () => { await loadBlitz(); S.blitzFb = null; S.sheet = 'blitz'; blitzTick(); }),
  'blitz-pick': (el) => {
    if (S.blitzBusy) return;
    S.blitzBusy = true;
    const n = Number(el.dataset.n), pick = Number(el.dataset.v);
    run(async () => {
      try {
        const r = await post('/api/blitz/answer', { n, pick });
        if (r.result) {
          S.blitzFb = { n, pick, right: r.result.right };
          sfx(r.result.correct ? 'on' : 'error');
          render();
          await new Promise((res) => setTimeout(res, r.result.correct ? 380 : 750));
        }
        const left = S.blitzEnd ? S.blitzEnd - Date.now() : r.leftMs;
        S.blitz = r; if (r.state === 'play') S.blitz.leftMs = left;
        S.blitzFb = null;
        if (r.state === 'done') { clearInterval(blitzTimer); sfx(r.score >= 10 ? 'fanfare' : 'confirm'); loadMe().catch(() => {}); loadFeatures().catch(() => {}); }
      } finally { S.blitzBusy = false; }
    });
  },
  'splash-skip'() { if (S.splashDone) { sfx('confirm'); S.splashDone(); } },
  close() { S.sheet = null; S.error = ''; render(); },
  'close-bg'(el, e) { if (e.target === el) actions.close(); },
  'shop-gang'(el) { S.shopGang = Number(el.dataset.v); render(); },
  buy: (el) => run(async () => {
    await post('/api/shop/buy', { item: el.dataset.v, gangId: S.shopGang || S.activeGang });
    toast('Куплено!');
    await loadMe(); S.shop = await get('/api/shop'); await loadGang();
  }),
  equip: (el) => run(async () => { await post('/api/shop/equip', { item: el.dataset.v, on: el.dataset.on === '1' }); await loadMe(); S.shop = await get('/api/shop'); }),
  'motto-save': () => run(async () => { await post(`/api/gangs/${S.gang.gang.id}/motto`, { motto: $('#motto').value }); await loadGang(); toast('Девиз сохранён'); }),

  look: (el) => run(async () => { await post('/api/me/profile', { look: { [el.dataset.k]: el.dataset.v } }); await loadMe(); }),
  'ava-open'(el) { S.draft = { ...S.me.look }; S.avaMode = 'main'; S.avaCat = (el && el.dataset.cat) || 'face'; S.sheet = 'avatar'; S.lastSheet = null; render(); },
  'ava-open-vac'() { S.draft = { ...S.me.look, ...(S.me.profile.vacationLook || {}) }; S.avaMode = 'vacation'; S.avaCat = 'outfit'; S.sheet = 'avatar'; S.lastSheet = null; render(); },
  'meme-open'(el) {
    S.meme = { scene: (S.meme && S.meme.scene) || S.cat.memes[0].id, emo: (S.meme && S.meme.emo) || 'calm', to: el && el.dataset.to ? Number(el.dataset.to) : null };
    S.sheet = 'meme'; S.lastSheet = null; render();
    if (!S.people) loadPeople().then(render).catch(() => {});
  },
  'meme-scene'(el) { S.meme.scene = el.dataset.v; render(); },
  'meme-emo'(el) { S.meme.emo = el.dataset.v; render(); },
  'meme-to'(el) { const v = Number(el.dataset.v); S.meme.to = S.meme.to === v ? null : v; render(); },
  'meme-send': () => run(async () => {
    const to = S.meme.to;
    await post(`/api/crew/${to}/messages`, { type: 'meme', kind: S.meme.scene, opt: S.meme.emo });
    S.sheet = null; toast('Мем отправлен');
    if (S.tab === 'chats' && S.dm === to) await loadDm();
  }),
  'meme-share': () => run(async () => {
    const svg = memeSvg(S.me.look, S.meme.scene, S.meme.emo, 720, true);
    const blob = await svgToPng(svg, 720, 900);
    const file = new File([blob], 'etazh-mem.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Мем из Этажа' }); } catch {} return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'etazh-mem.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Картинка сохранена');
  }, { rerender: false }),
  'ava-cat'(el) { S.avaCat = el.dataset.v; render(); },
  'ava-set'(el) { S.draft = { ...S.draft, [el.dataset.k]: el.dataset.v }; render(); },
  'ava-glasses'(el) { const v = el.dataset.v; S.draft = v === 'none' ? { ...S.draft, glasses: false } : { ...S.draft, glasses: true, glassesStyle: v }; render(); },
  'ava-hide'(el) { const c = el.dataset.c; S.avaHide = S.avaHide || {}; S.avaHide[c] = { ...(S.avaHide[c] || {}), [el.dataset.k]: el.dataset.v === '1' }; render(); },
  'ava-toggle'(el) { S.draft = { ...S.draft, [el.dataset.k]: !S.draft[el.dataset.k] }; render(); },
  'ava-preset'(el) { const pr = AVA_PRESETS.find((x) => x.id === el.dataset.v); S.draft = { ...S.draft, ...pr.look }; toast(`Образ «${pr.name}»`); render(); },
  'ava-random'() { S.draft = { ...S.draft, ...randomLook() }; if (navigator.vibrate) navigator.vibrate(10); render(); },
  'ava-reset'() { S.draft = S.avaMode === 'vacation' && S.me.profile.vacationLook ? { ...S.me.look, ...S.me.profile.vacationLook } : { ...S.me.look }; render(); },
  'ava-buy': (el) => run(async () => { await post('/api/shop/buy', { item: el.dataset.v }); const keep = S.draft; await loadMe(); S.draft = keep; toast('Куплено! Теперь можно сохранить'); }),
  'ava-save': () => run(async () => {
    const pick = Object.fromEntries(Object.keys(S.cat.look).concat(['glasses', 'phones', 'freckles']).map((k) => [k, S.draft[k]]));
    if (pick.preset === 'f') pick.beard = 'none'; else pick.makeup = 'none';
    if (S.avaMode === 'vacation') await post('/api/me/profile', { profile: { vacationLook: pick } });
    else await post('/api/me/profile', { look: pick });
    await loadMe(); S.sheet = 'profile'; S.sec.add('look'); toast(S.avaMode === 'vacation' ? 'Образ для отпуска сохранён' : 'Аватар сохранён');
    refresh({ all: true }).then(render).catch(() => {}); // чтобы новый аватар сразу был везде: банда, подельники, неделя
  }),
  'ava-save-vac': () => run(async () => {
    const pick = Object.fromEntries(Object.keys(S.cat.look).concat(['glasses', 'phones', 'freckles']).map((k) => [k, S.draft[k]]));
    await post('/api/me/profile', { profile: { vacationLook: pick } });
    await loadMe(); S.sheet = 'profile'; S.sec.add('look'); toast('Образ для отпуска сохранён. Основной аватар не менялся');
  }),
  'vac-look-clear': () => run(async () => { await post('/api/me/profile', { profile: { vacationLook: null } }); await loadMe(); }),
  'look-toggle': (el) => run(async () => { await post('/api/me/profile', { look: { [el.dataset.k]: !S.me.look[el.dataset.k] } }); await loadMe(); }),
  prof: (el) => run(async () => {
    const v = el.dataset.k === 'home' && S.me.profile.home === el.dataset.v ? null : el.dataset.v;
    await post('/api/me/profile', { profile: { [el.dataset.k]: v } }); await loadMe();
  }),
  today: (el) => run(async () => {
    const r = await post('/api/me/profile', { profile: { today: el.dataset.v ? { kind: el.dataset.v } : null } });
    await loadMe(); await loadState();
    if (el.dataset.v === 'slack') toast('Признание засчитано 😏');
    if (el.dataset.v === 'home') { toast(r.beans ? `Отмечено: сегодня из дома · +${r.beans} зёрен` : 'Отмечено: сегодня из дома'); loadFeatures().then(render).catch(() => {}); }
  }),
  'plan-day': (el) => run(async () => {
    const plan = { ...S.me.profile.plan };
    const cur = plan[el.dataset.v];
    if (!cur) plan[el.dataset.v] = 'office'; else if (cur === 'office') plan[el.dataset.v] = 'home'; else delete plan[el.dataset.v];
    await post('/api/me/profile', { profile: { plan } }); await loadMe();
  }),
  'sick-now': () => run(async () => {
    await post('/api/me/profile', { profile: { today: { kind: 'sick', to: $('#sick-until').value || S.state.today } } });
    S.sheet = null; await loadMe(); await loadState(); toast('Выздоравливай! Зовы не будут беспокоить');
  }),
  'thanks-to'(el) { S.thanksTo = Number(el.dataset.v); render(); },
  'thanks-send': () => run(async () => {
    const r = await post('/api/thanks', { gang: S.activeGang, to: S.thanksTo, text: ($('#thanks-text') || {}).value || '' });
    S.thanksTo = null; toast(`Спасибо отправлено. Осталось ${r.left} на сегодня`);
    await Promise.all([loadGangExtra(), loadMe()]);
  }),
  gift: (el) => run(async () => { await post('/api/gift', { to: Number(el.dataset.id) }); toast('Поздравление отправлено'); await Promise.all([loadMe(), loadFeatures(), loadGangExtra()]); }),
  'lunch-time'(el) { S.lunchTime = el.dataset.v; const pl = $('#lunch-place'); const v = pl ? pl.value : ''; render(); if ($('#lunch-place')) $('#lunch-place').value = v; },
  'lunch-create': () => run(async () => { await post('/api/lunch', { time: S.lunchTime, place: $('#lunch-place').value }); S.sheet = null; toast('Сбор открыт'); await loadFeatures(); }),
  'lunch-join': (el) => run(async () => { await post(`/api/lunch/${el.dataset.id}/join`); toast('Приятного аппетита!'); await loadFeatures(); }),
  'lunch-leave': (el) => run(async () => { await post(`/api/lunch/${el.dataset.id}/leave`); await loadFeatures(); }),
  'lunch-cancel': (el) => run(async () => { await post(`/api/lunch/${el.dataset.id}/cancel`); await loadFeatures(); }),
  'coffee-on': () => run(async () => { await post('/api/me/profile', { profile: { coffee: true } }); toast('Готово! Пару подберём в понедельник'); await Promise.all([loadMe(), loadFeatures()]); }),
  'coffee-toggle': (el) => run(async () => { await post('/api/me/profile', { profile: { coffee: el.checked } }); await Promise.all([loadMe(), loadFeatures()]); }),
  'coffee-ping': (el) => run(async () => { await post('/api/coffee/ping', { opt: el.dataset.v }); toast('Предложение отправлено'); await loadFeatures(); }),
  'coffee-reply': (el) => run(async () => { await post('/api/coffee/reply', { label: el.dataset.v }); await loadFeatures(); }),
  'vac-now': () => run(async () => {
    const today = S.state.today;
    const to = $('#vac-until').value || today;
    const rest = S.me.profile.vacations.filter((v) => v.to < today || v.from > to);
    await post('/api/me/profile', { profile: { vacations: [...rest, { from: today, to }] } });
    S.sheet = null; await loadMe(); await loadState(); toast('Хорошего отдыха! Зовы не будут беспокоить');
  }),
  'vac-end': () => run(async () => {
    const today = S.state.today;
    const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
    const list = S.me.profile.vacations
      .map((v) => (v.from <= today && today <= v.to ? (v.from < today ? { from: v.from, to: yesterday } : null) : v))
      .filter(Boolean);
    await post('/api/me/profile', { profile: { vacations: list, today: null } });
    await loadMe(); await loadState(); toast('С возвращением!');
  }),
  'vac-add': () => run(async () => {
    const from = $('#vac-from').value; const to = $('#vac-to').value || from;
    if (!from) throw new Error('Выбери дату начала отпуска');
    await post('/api/me/profile', { profile: { vacations: [...S.me.profile.vacations, { from, to }] } });
    await loadMe(); await loadState(); toast('Отпуск добавлен');
  }),
  'vac-del': (el) => run(async () => {
    const list = S.me.profile.vacations.filter((_, i) => i !== Number(el.dataset.v));
    await post('/api/me/profile', { profile: { vacations: list } }); await loadMe(); await loadState();
  }),
  'prof-day': (el) => run(async () => {
    const d = new Set(S.me.profile.days); d.has(el.dataset.v) ? d.delete(el.dataset.v) : d.add(el.dataset.v);
    await post('/api/me/profile', { profile: { days: [...d] } }); await loadMe();
  }),
  'prof-tag': (el) => run(async () => {
    const t = new Set(S.me.profile.tags);
    if (t.has(el.dataset.v)) t.delete(el.dataset.v); else if (t.size >= 5) throw new Error('Не больше 5 интересов'); else t.add(el.dataset.v);
    await post('/api/me/profile', { profile: { tags: [...t] } }); await loadMe();
  }),
  person: (el) => { S.person = null; S.sheet = 'person'; render(); run(async () => { S.person = await get(`/api/users/${el.dataset.id}`); }); },
  'guess-pick': (el) => run(async () => {
    const r = await post(`/api/guess/${el.dataset.id}`, { pick: Number(el.dataset.v) });
    S.guess = { question: r.question }; S.guessBeans = r.beans;
    if (r.beans) loadMe().then(render).catch(() => {});
  }),
  'guess-next': () => run(async () => { S.guessBeans = 0; S.guess = await get(`/api/gangs/${S.activeGang}/guess`); }),
  'quiz-pick': (el) => run(async () => {
    const r = await post(`/api/quiz/${el.dataset.id}/answer`, { pick: Number(el.dataset.v) });
    S.quiz = S.quiz.map((x) => (x.id === r.quiz.id ? r.quiz : x));
    if (r.beans) { toast(`Верно! +${r.beans} зёрна`); loadMe().then(render).catch(() => {}); }
  }),
  // Шаг из карточки «заполни профиль»: раскрываем нужный раздел, прокручиваем к нему и ставим курсор в поле
  'food-pick'(el) { S.foodDraft = { up: el.dataset.v === '1', tags: [], comment: '' }; render(); },
  'food-edit'() { const m = S.fx.food.mine; S.foodDraft = { up: m.up, tags: [...m.tags], comment: '' }; render(); },
  'food-cancel'() { S.foodDraft = null; render(); },
  'food-tag'(el) {
    const d = S.foodDraft, t = el.dataset.v; const c = $('#food-comment'); if (c) d.comment = c.value;
    if (d.tags.includes(t)) d.tags = d.tags.filter((x) => x !== t); else if (d.tags.length < 3) d.tags.push(t); else toast('Не больше трёх');
    render();
  },
  'food-send': () => run(async () => {
    const d = S.foodDraft; const c = $('#food-comment');
    const r = await post('/api/canteen/rate', { up: d.up, tags: d.tags, comment: c ? c.value : '' });
    S.foodDraft = null; S.fx.food = r.food;
    toast(r.beans ? `Спасибо за оценку! +${r.beans} зерно` : 'Оценка обновлена');
    if (r.beans) loadMe().then(render).catch(() => {});
  }),
  'feed-kind'(el) { const off = new Set(store.get('feedOff', [])); if (off.has(el.dataset.v)) off.delete(el.dataset.v); else off.add(el.dataset.v); store.set('feedOff', [...off]); render(); },
  'feed-more'() { S.feedAll = true; render(); },
  'feed-close'() { store.set('feedClose', !store.get('feedClose', false)); render(); },
  reload() { location.reload(); },
  'coach-next'() {
    if (S.coach < COACH.length - 1) {
      S.coach++;
      const tip = COACH[S.coach];
      if (tip.tab && S.tab !== tip.tab) { S.tab = tip.tab; render(); run(() => refresh()); return; }
    } else { S.coach = 0; store.set('coachDone', 2); store.set('ia2', 1); if (S.tab !== 'near') { S.tab = 'near'; run(() => refresh()); } }
    render();
  },
  'coach-skip'() { S.coach = 0; store.set('coachDone', 2); store.set('ia2', 1); if (S.tab !== 'near') { S.tab = 'near'; run(() => refresh()); } render(); },
  'findable-toggle': (el) => run(async () => { await post('/api/me/profile', { profile: { findable: el.checked } }); await loadMe(); toast(el.checked ? 'Тебя можно найти' : 'Тебя больше не найти поиском'); }),
  'vibro-toggle'(el) { store.set('vibro', el.checked); if (el.checked) sfx('confirm'); },
  'sound-test'() { const demo = ['tap', 'open', 'on', 'send', 'vote', 'confirm', 'coin']; demo.forEach((n, i) => setTimeout(() => sfx(n), i * 320)); },
  'open-sec'(el) {
    const v = el.dataset.v;
    const wasOpen = S.sheet === 'profile';
    S.sheet = 'profile'; S.sec.add(v); if (!wasOpen) S.lastSheet = null;
    render();
    const focusId = { about: 'p-about' }[v];
    requestAnimationFrame(() => {
      const head = document.querySelector(`.psec-head[data-v="${v}"]`);
      if (head) head.scrollIntoView({ block: 'start' });
      const input = focusId && document.getElementById(focusId);
      if (input && !input.value) setTimeout(() => input.focus({ preventScroll: true }), 350);
    });
    if (!S.fx) loadFeatures().catch(() => {}); // данные для ачивок; без перерисовки, чтобы не сбить прокрутку
  },
  'compl-hide'() { store.set('complHideUntil', Date.now() + 7 * 864e5); render(); },
  sec(el) { const v = el.dataset.v; if (S.sec.has(v)) S.sec.delete(v); else S.sec.add(v); render(); },
  'name-vis': (el) => run(async () => { await post('/api/me/profile', { profile: { nameVis: el.dataset.v } }); await loadMe(); }),
  'name-save': () => run(async () => { await post('/api/me/profile', { profile: { firstName: $('#p-first').value, lastName: $('#p-last').value } }); await loadMe(); toast('Сохранено'); }),
  'nick-change'() {
    const nick = $('#p-nick').value.trim().replace(/^@+/, '');
    if (nick.toLowerCase() === S.me.nick.toLowerCase()) { S.error = 'Впиши новый никнейм'; render(); return; }
    if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]{3,20}$/.test(nick)) { S.error = 'От 3 до 20 символов: буквы, цифры и «_», без пробелов.'; render(); return; }
    S.error = null; S.nickConfirm = nick; render();
  },
  'nick-no'() { S.nickConfirm = null; render(); },
  'nick-yes': () => run(async () => {
    const nick = S.nickConfirm; S.nickConfirm = null;
    const r = await post('/api/me/nick', { nick }); await loadMe(); toast(`Теперь ты ${r.nick}`);
  }),
  'prof-save': () => run(async () => { await post('/api/me/profile', { profile: { about: $('#p-about').value, bday: $('#p-bday').value } }); await loadMe(); toast('Сохранено'); }),
  toggle: (el) => run(async () => { await post('/api/me/profile', { [el.dataset.k]: el.checked }); await loadMe(); await loadState(); }),
  'push-enable': () => run(enablePush),
  'push-test': () => run(async () => { await post('/api/push/test'); toast('Отправили тестовое уведомление'); }, { rerender: false }),
  'install-hide'() { store.set('installHiddenUntil', Date.now() + 864e5); render(); },
  async 'install-native'() { if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); } },
  logout: () => run(async () => { await post('/api/auth/logout'); S.me = null; S.sheet = null; S.onb = { step: 'email', email: '', error: '', nicks: [] }; }),
  'delete-account': () => run(async () => {
    if (!confirmInline('delete', 'Нажми ещё раз: аккаунт, банды без участников и зёрна удалятся навсегда')) return;
    await api('DELETE', '/api/me'); S.me = null; S.sheet = null;
  })
};

// Подтверждение вторым нажатием — без системных диалогов
let pendingConfirm = null;
function confirmInline(key, text = 'Нажми ещё раз для подтверждения') {
  if (pendingConfirm && pendingConfirm.key === key && Date.now() - pendingConfirm.at < 4000) { pendingConfirm = null; return true; }
  pendingConfirm = { key, at: Date.now() };
  toast(text);
  return false;
}
function saveComposeText() { const el = $('#c-text'); if (el && S.compose) S.compose.text = el.value; }
function savePollDraft() {
  const d = S.pollDraft; if (!d) return;
  const qn = $('#pd-q'); if (qn) d.q = qn.value;
  document.querySelectorAll('.pd-o').forEach((x) => { d.options[Number(x.dataset.i)] = x.value; });
  const o = $('#pd-open'); if (o) d.open = o.checked;
  const m = $('#pd-multi'); if (m) d.multi = m.checked;
}
function saveSignalText() { if (!S.signal) S.signal = {}; const z = $('#s-zone'); const c = $('#s-comment'); if (z) S.signal.zone = z.value; if (c) S.signal.comment = c.value; }

async function joinByCode(code) {
  const r = await post('/api/gangs/join', { code });
  S.activeGang = r.id; store.set('activeGang', r.id); S.tab = 'chats'; S.chatGang = true; S.dm = null; S.sheet = null;
  await loadMe(); await loadGang();
  toast(r.already ? 'Ты уже в этой банде' : 'Ты в банде!');
}

// ---------- Пуши ----------
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(isIOS() ? 'Сначала установи Этаж на экран «Домой» — на iPhone уведомления работают только так.' : 'Браузер не поддерживает уведомления.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Уведомления не разрешены.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(S.vapidKey) }));
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
  await loadMe();
  toast('Уведомления включены');
}

// Браузер помнит разрешение, а сервер может потерять подписку (переустановка, смена ключей, протухший адрес).
// Тихо сверяем при каждом запуске: если разрешение есть, а сервер подписку не знает — отправляем заново.
async function syncPush() {
  if (!S.vapidKey || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (S.me.completion && S.me.completion.steps.find((x) => x.id === 'push' && x.done)) return;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = urlB64ToUint8(S.vapidKey);
  if (sub && sub.options && sub.options.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    if (old.length !== key.length || old.some((b, i) => b !== key[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
  await loadMe();
}

// ---------- События DOM ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  if (el.dataset.act === 'close-bg' && e.target !== el) return; // клик внутри шторки — не закрываем и не мешаем ссылкам
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); const snd = feelFor(el.dataset.act, el); if (snd) sfx(snd); fn(el, e); }
});
// Ползунок громкости: число меняется на ходу, образец звука — когда отпустил
document.addEventListener('input', (e) => {
  if (e.target.id === 'office-q') {
    S.officeQ = e.target.value; render();
    const i = $('#office-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    return;
  }
  if (e.target.id !== 'snd-vol') return;
  store.set('soundVol', Number(e.target.value)); store.set('sound', Number(e.target.value) > 0);
  const n = $('#vol-n'); if (n) n.textContent = Number(e.target.value) ? e.target.value + '%' : 'выкл';
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'snd-vol') { sfx('pick'); return; }
  if (e.target.id === 'home-office') { sfx('pick'); run(async () => { await post('/api/me/profile', { profile: { home: e.target.value || null } }); await loadMe(); toast(e.target.value ? 'Мой офис сохранён' : 'Мой офис сброшен'); }); return; }
  const el = e.target;
  if (el.tagName === 'INPUT' && el.type === 'checkbox' && el.dataset.act && actions[el.dataset.act]) { if (!FEEL_SELF.has(el.dataset.act)) sfx(el.checked ? 'on' : 'off'); actions[el.dataset.act](el, e); }
  else if (el.tagName === 'INPUT' && el.type === 'checkbox') sfx(el.checked ? 'on' : 'off');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id) {
    const map = { 'find-q': 'find-go', email: 'login-submit', code: 'code-submit', nick: 'nick-submit', 'chat-text': 'chat-send', 'thanks-text': 'thanks-send', 'lunch-place': 'lunch-create', 'dm-text': 'dm-send', 'crew-nick': 'crew-add' };
    if (map[e.target.id]) { e.preventDefault(); actions[map[e.target.id]](); }
    else if (e.target.id && e.target.id.startsWith('poll-add-')) { e.preventDefault(); actions['poll-add']({ dataset: { id: e.target.id.slice(9) } }); }
  }
  if (e.key === 'Escape' && S.sheet) actions.close();
});

// ---------- Обновление в фоне ----------
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
setInterval(async () => {
  if (document.hidden || !S.me || !S.me.nick || typing() || S.sheet) return;
  try { await refresh(); render(); } catch {}
}, 20000);
// Морской бой: опрашиваем часто, чтобы выстрел соперника появился почти сразу. В быстрой партии — раз в секунду
let battleTick = 0;
setInterval(async () => {
  const v = S.bv;
  if (document.hidden || !S.me || S.tab !== 'chats' || !S.battle || !v || S.sheet || S.bBusy) return;
  battleTick++;
  if (!(v.mode === 'fast' && v.status !== 'done') && battleTick % 3) return;
  try {
    const nv = await get(`/api/battle/${S.battle}`);
    const oe = nv.emotes && nv.emotes.opp;
    if (nv.seq !== v.seq || nv.oppReady !== v.oppReady || (oe && oe.at !== S.bEmoteSeen)) {
      setBattleView(nv); render();
      setTimeout(() => { if (S.battle) render(); }, 1700);
      if (navigator.vibrate && nv.last && !nv.last.mine && nv.last.r !== 'miss') navigator.vibrate([40, 30, 40]);
    }
  } catch {}
}, 900);
setInterval(async () => {
  if (document.hidden || !S.me || !S.me.nick || S.tab !== 'chats' || !S.dm || S.battle || S.sheet) return;
  const before = S.dmView ? S.dmView.messages.map((m) => m.id + ':' + (m.reply || '') + (m.read ? 'r' : '')).join() : '';
  try {
    await loadDm();
    const after = S.dmView ? S.dmView.messages.map((m) => m.id + ':' + (m.reply || '') + (m.read ? 'r' : '')).join() : '';
    if (after !== before) render();
  } catch {}
}, 6000);
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && reloadIfStale()) return;
  if (!document.hidden && S.me && S.me.nick && !typing()) { try { await refresh(); render(); } catch {} }
});

// ---------- Старт ----------
// Ссылки из пушей: #gang/ID, #crew/ID, #battle/ID, #feed, #feedback
function applyHash(hash) {
  if (hash.startsWith('#gang/')) { S.tab = 'chats'; S.chatGang = true; S.dm = null; S.activeGang = Number(hash.slice(6)) || S.activeGang; }
  if (hash === '#feed') S.tab = 'office';
  if (hash === '#crew' || hash === '#chats') S.tab = 'chats';
  if (hash.startsWith('#crew/')) { S.tab = 'chats'; S.dm = Number(hash.slice(6)) || null; }
  if (hash.startsWith('#battle/')) { S.tab = 'chats'; S.battle = Number(hash.slice(8)) || null; }
}

// Открытое приложение: пуш меняет только хэш, страница не перезагружается — разбираем его здесь
window.addEventListener('hashchange', async () => {
  const hash = location.hash;
  if (!hash || !S.me || !S.me.nick || /^#(join|crew)=/i.test(hash)) return;
  applyHash(hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (hash === '#feedback') { S.sheet = 'feedback'; render(); await run(loadFeedback); return; }
  S.sheet = null;
  try { await refresh(); } catch {}
  render();
});

// ----- Приветствие при входе: по времени суток, где ты сегодня, дню недели и дню рождения -----
// Повторный вход в той же ситуации — другая фраза из набора, а не та же самая
const GREET = {
  bday: ['С днём рождения, {a}! 🎂 Банда уже в курсе', 'Именинник на этаже! С днём рождения, {a} 🎉', 'Сегодня твой день, {a}. Торт сам себя не съест 🎂', 'Ещё один уровень пройден, {a}! С днём рождения'],
  vacation: ['Ты же в отпуске, {a}! Что ты тут забыл{s}? 🌴', 'Отпуск, {a}! Закрывай приложение и иди на пляж', 'Работа подождёт, {a}. Отдыхай 🌴'],
  sick: ['Выздоравливай, {a}! Чай с лимоном — приказ', 'Лежи и лечись, {a}. Банда держит оборону', 'Поправляйся, {a}! Без тебя тут скучно'],
  night: ['Не спится, {a}? 🦉', 'Ночная смена, {a}? Офисы спят, а ты нет', 'Совы одобряют, {a}. Но утром будет тяжело'],
  weekend: ['Выходной же, {a}! Отдыхай', 'Суббота-воскресенье, {a}. Этаж подождёт', 'В выходной на работу? {A}, ты легенда'],
  mon_morning: ['Понедельник, {a}. Держись!', 'Утречка, {a}! Понедельник — это ненадолго', 'Новая неделя, {a}. Погнали ☕'],
  fri_evening: ['Пятница, {a}! Ещё чуть-чуть', 'Пятничный вечер, {a}. Ты справил{s}ся 🎉', 'Почти выходные, {a}! Держись'],
  office_morning: ['Утречка, {a}! Ты уже на этаже ☕', 'Доброе утро, {a}! Офис рад тебя видеть', 'Ранняя птичка, {a}! Кофе ждёт'],
  office_day: ['Хорошего дня, {a}!', 'Как там на этаже, {a}? Обед скоро', 'Держим темп, {a}!'],
  office_evening: ['Крепись, {a}! Скоро домой', 'Вечереет, {a}. Не засиживайся', 'Финишная прямая, {a}!'],
  home_morning: ['Утречка, {a}! Работаем из пижамы? ☕', 'Доброе утро, {a}! Кот уже на рабочем месте', 'Утро дома, {a}. Сначала кофе'],
  home_day: ['Хорошего дня, {a}! Домашний офис на связи', 'Как там дома, {a}? Не забудь пообедать', 'Работаем из дома, {a}. Банда на связи'],
  home_evening: ['Крепись, {a}! До дивана рукой подать', 'Вечер дома, {a}. Закрывай ноутбук', 'Ещё чуть-чуть, {a}, и отдыхать'],
  none_morning: ['Утречка, {a}! Где сегодня работаем?', 'Доброе утро, {a}! Отметься — банда ждёт', 'Привет, {a}! Офис или дом?'],
  none_day: ['Хорошего дня, {a}!', 'Привет, {a}! Ты где сегодня?', 'О, {a}! Банда тебя потеряла'],
  none_evening: ['Крепись, {a}! Вечер близко', 'Добрый вечер, {a}!', 'Вечереет, {a}. Как прошёл день?']
};
// Кнопка «дальше» — под настроение ситуации
const GREET_GO = {
  bday: ['Где мой торт? 🎂', 'Принимаю поздравления', 'Погнали праздновать'], vacation: ['Я только глянуть', 'Одним глазком', 'Ладно, на минутку'],
  sick: ['Ладно, лягу', 'Только проверю чат', 'Я тихонько'], night: ['Ещё пять минут', 'Совы не спят', 'Я быстро'],
  weekend: ['Я на минутку', 'Только посмотреть', 'Отдыхаю, честно'], mon_morning: ['Держусь!', 'За дело!', 'Кофе — и погнали'],
  fri_evening: ['Скорее бы выходные', 'Ещё чуть-чуть', 'Погнали!'], morning: ['За дело!', 'Погнали!', 'Кофе — и в бой', 'Поехали!'],
  day: ['За дело!', 'Погнали!', 'Работаем', 'Вперёд!'], evening: ['Добиваем день', 'Ещё немного', 'Погнали!']
};
const GREET_ADDR = { m: ['бандит', 'шеф', 'дружище', 'босс', 'чемпион'], f: ['бандитка', 'моя дорогая', 'звезда', 'королева', 'шефиня'] };
function greeting() {
  const me = S.me, st = S.state || {};
  const sex = me.look && me.look.preset === 'f' ? 'f' : 'm';
  const now = new Date(), h = now.getHours(), dow = now.getDay();
  const part = h < 5 || h >= 23 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'day' : 'evening';
  const p = (st.presence && st.presence.where) || 'none';
  const dd = String(now.getDate()).padStart(2, '0') + '.' + String(now.getMonth() + 1).padStart(2, '0');
  let key;
  if (me.profile && me.profile.bday === dd) key = 'bday';
  else if (p === 'vacation') key = 'vacation';
  else if (p === 'sick') key = 'sick';
  else if (part === 'night') key = 'night';
  else if (p === 'weekend') key = 'weekend';
  else if (dow === 1 && part === 'morning' && p !== 'office') key = 'mon_morning';
  else if (dow === 5 && part === 'evening') key = 'fri_evening';
  else key = `${st.checkin ? 'office' : p === 'home' ? 'home' : 'none'}_${part}`;
  const list = GREET[key] || GREET.none_day;
  let last = {};
  try { last = store.get('greet', {}) || {}; } catch {}
  const i = last.key === key ? (last.i + 1) % list.length : Math.floor(Math.random() * list.length);
  const ai = last.key === key ? ((last.ai || 0) + 1) % GREET_ADDR[sex].length : Math.floor(Math.random() * GREET_ADDR[sex].length);
  try { store.set('greet', { key, i, ai }); } catch {}
  // Иногда вместо «бандит» — ник: так приветствие звучит лично
  const addr = Math.random() < 0.3 ? me.nick : GREET_ADDR[sex][ai];
  const text = list[i].replace('{a}', addr).replace('{A}', addr[0].toUpperCase() + addr.slice(1)).replace(/\{s\}/g, sex === 'f' ? 'а' : '');
  const day = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const gk = GREET_GO[key] || GREET_GO[part] || GREET_GO.day;
  return { text, day, go: gk[i % gk.length] };
}
// Заставка: логотип, аватар и приветствие. До 10 секунд (полоска показывает, сколько осталось), кнопка — дальше сразу
const SPLASH_MS = 10000;
async function splash() {
  try { await loadState(); } catch {}
  const g = greeting();
  root.innerHTML = `<div class="splash"><div class="logo">Этаж<span>.</span></div>
    <div class="splash-ava">${avatar(S.me.look, 96)}</div>
    <p class="splash-hi">${esc(g.text)}</p><p class="splash-day">${esc(g.day)}</p>
    <button class="btn splash-go" data-act="splash-skip">${esc(g.go)} →</button><div class="splash-bar"><i style="animation-duration:${SPLASH_MS}ms"></i></div></div>`;
  await new Promise((res) => { S.splashDone = res; setTimeout(res, SPLASH_MS); });
  S.splashDone = null;
}

async function boot() {
  await loadMe();
  const hash = location.hash;
  // Приветствие — при обычном входе; по ссылке из пуша или приглашения сразу к делу
  let greeted = false;
  try { greeted = !!sessionStorage.getItem('etazh:greeted'); sessionStorage.setItem('etazh:greeted', '1'); } catch {}
  if (S.me && S.me.nick && !hash && !greeted) await splash();
  applyHash(hash);
  const openFeedback = hash === '#feedback';
  const join = /^#join=([A-Z0-9]{6})$/i.exec(hash);
  if (join) store.set('pendingJoin', join[1]);
  const crewCode = /^#crew=([A-Z0-9]{6})$/i.exec(hash);
  if (crewCode) store.set('pendingCrew', crewCode[1]);
  if (S.me && !S.me.nick && !S.onb.nicks.length) S.onb.nicks = (await get('/api/nick-suggestions')).nicks;
  if (S.me && S.me.nick) {
    const pending = store.get('pendingJoin', null);
    if (pending) { store.set('pendingJoin', null); try { await joinByCode(pending); } catch (e) { toast(e.message); } }
    const pendingCrew = store.get('pendingCrew', null);
    if (pendingCrew) {
      store.set('pendingCrew', null); S.tab = 'chats';
      try { const r = await post('/api/crew/add', { code: pendingCrew }); toast(r.accepted ? 'Теперь можно переписываться!' : r.already ? 'Вы уже на связи' : 'Заявка ушла. Ждём ответа'); } catch (e) { toast(e.message); }
    }
    await refresh({ all: true });
    const coachDone = Number(store.get('coachDone', 0));
    if (coachDone < 2) { S.coach = coachDone === 1 ? 3 : 1; S.coachStart = S.coach; }
    else if (!store.get('ia2', 0)) { S.sheet = 'whatsnew'; } // уже знакомы с приложением — коротко покажем, что поменялось
    syncPush().then(render).catch(() => {});
    if (openFeedback) { S.sheet = 'feedback'; loadFeedback().then(render).catch(() => {}); }
  }
  if (hash) history.replaceState(null, '', location.pathname + (location.search.includes('login=') ? '' : location.search));
  render();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot().catch((e) => { root.innerHTML = `<div class="onb"><div class="card"><h2>Не получилось загрузиться</h2><p class="sub">${esc(e.message)}</p></div></div>`; });
