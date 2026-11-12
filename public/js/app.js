// Клиент «Этажа»: без фреймворков, рендер строками + делегирование событий (CSP запрещает inline-обработчики).
import { officeSvg } from './building.js';
import { GUIDE } from './guide.js';
import { SHIP_DEFS } from './ships.js';
import { DUEL_DEFS, SIDE, handSvg, handDuo, dieSvg, tttMark, tttLine, confetti, raincloud } from './duelart.js';
import * as PR from './practice.js';
import { seaFxSync } from './seafx.js';
import { crestSvg, crestOf, autoCrest, randomCrest, CREST_PARTS, TINCTURES, TINCTURE_NAMES, SHAPE_NAMES, DIV_NAMES, CHARGE_NAMES, TOP_NAMES } from './crest.js';

const $ = (sel) => document.querySelector(sel);
const root = $('#app');
const esc = (s) => String(s ?? '').replace(/\uE000\w*\uE001\s?/g, '').replace(/[\uE000\uE001]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Род в текстах: по полу аватара. gw(look, 'ушёл', 'ушла'); me(...) — про себя
const gw = (look, m, f) => (look && look.preset === 'f' ? f : m);
const meG = (m, f) => gw(S.me && S.me.look, m, f);
const store = {
  get(k, d) { try { const v = localStorage.getItem('etazh:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('etazh:' + k, JSON.stringify(v)); } catch {} }
};

const S = {
  me: null, cat: null, vapidKey: null,
  state: null, gang: null, events: null, shop: null,
  tab: 'near', activeGang: store.get('activeGang', null), people: null, chats: null, chatGang: false, dmList: false,
  sheet: null, compose: null, signal: null,
  onb: { step: 'email', email: '', error: '', devLink: null, devCode: null, nicks: [] },
  error: '', busy: false,
  nearMore: store.get('nearMore', false), seenChat: store.get('seenChat', 0), seenFeed: store.get('seenFeed', 0),
  fx: null, gx: null, thanksTo: null, lunchTime: '13:00', sec: new Set(),
  crew: null, dm: null, dmView: null,
  battles: [], battle: null, bv: null, bFresh: new Set(), bFreshUntil: 0, bShout: null
};

// ---------- API ----------
async function api(method, url, body) {
  // Мобильная сеть иногда «залипает»: без ответа за 20 секунд (45 — для больших отправок) обрываем, чтобы кнопки не висели
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), payload && payload.length > 100000 ? 45000 : 20000);
  let res;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin', signal: ctl.signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: payload
    });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'Сервер долго не отвечает. Проверь интернет и попробуй ещё раз.' : 'Нет связи с сервером. Проверь интернет.');
  } finally { clearTimeout(timer); }
  let json = {};
  try { json = await res.json(); } catch {}
  if (res.status === 401) { S.me = null; render(); }
  if (!res.ok) throw new Error(json.error || 'Сервер не ответил. Проверь интернет.');
  return json;
}
// GET-запросы одного мгновения уходят одной пачкой: на старте вместо ~30 запросов — один, при смене вкладки — тоже
const BATCH = { q: [], t: 0 };
function get(u) {
  return new Promise((resolve, reject) => {
    BATCH.q.push({ u, resolve, reject });
    if (!BATCH.t) BATCH.t = setTimeout(flushBatch, 0);
  });
}
async function flushBatch() {
  const q = BATCH.q; BATCH.q = []; BATCH.t = 0;
  if (q.length === 1) { api('GET', q[0].u).then(q[0].resolve, q[0].reject); return; }
  let r;
  try { r = (await api('POST', '/api/batch', { paths: q.map((x) => x.u) })).r; }
  catch (e) { q.forEach((x) => x.reject(e)); return; }
  q.forEach((x, i) => {
    const it = r[i] || { s: 500, j: {} };
    if (it.s === 401) { S.me = null; render(); }
    if (it.s >= 200 && it.s < 300) x.resolve(it.j);
    else x.reject(new Error(it.j.error || 'Сервер не ответил. Проверь интернет.'));
  });
}
const post = (u, b = {}) => api('POST', u, b);

let toastTimer;
// top — показать сверху: для «нажми ещё раз», чтобы плашка не закрыла ту самую кнопку внизу экрана
// Плашка «уйдёт через 4 с · Отменить»: действие выполняется, только если не отменили
function undoBar(text, go, sec = 4) {
  document.querySelectorAll('.undo-bar').forEach((x) => x.remove());
  const el = document.createElement('div');
  el.className = 'undo-bar';
  el.setAttribute('role', 'status');
  let left = sec;
  const draw = () => { el.innerHTML = `<span class="grow">${esc(text)} ${left} с</span><button class="btn small ghost" type="button">Отменить</button>`; el.querySelector('button').onclick = () => { clearInterval(iv); el.remove(); toast('Не отправили'); }; };
  draw();
  document.body.appendChild(el);
  const iv = setInterval(() => { left--; if (left <= 0) { clearInterval(iv); el.remove(); go(); } else draw(); }, 1000);
}

function toast(text, { top = false } = {}) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = plain(text);
  el.classList.toggle('top', top);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------- Аватар ----------
const HOODIE = { red: '#E5484D', blue: '#2563C9', green: '#1F7A3A', violet: '#8B5CF6', navy: '#34405F', black: '#23252B', white: '#EEF1F6', beige: '#D8C3A5', yellow: '#F4C430', pink: '#F08BB4', orange: '#F28C28', khaki: '#7D7A4F', burgundy: '#7A1F34', grey: '#8A919E' };
const FRAMES = { fr_gold: '#FFC93C', fr_neon: '#22D3EE', fr_fire: '#F97316', fr_champ: '#FFD84D' };
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
// Где линия роста волос видна: у чёлки, каре, пикси, кудрей и афро лоб закрыт — залысины там не рисуем
const HAIRLINE_OK = ['short', 'undercut', 'quiff', 'crop', 'slick', 'buzz', 'manbun', 'tail', 'ponytail', 'bun', 'buns', 'long', 'waves', 'lob', 'braid', 'mohawk'];
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
    // Горловина: тёмная внутренность за шеей, шея уходит в неё, спереди — трикотажная резинка
    return `<path d="${body}" fill="${hood}"/>${shadeR}<path d="M38.6 73.4 Q41 68.4 50 68 Q59 68.4 61.4 73.4 Q50 77.4 38.6 73.4 Z" fill="${shade(r, -0.45)}"/><path d="M38.6 73.4 Q41 68.4 50 68 Q59 68.4 61.4 73.4" fill="none" stroke="${r}" stroke-width="2.2"/>${neck}<path d="M37.6 73 Q50 78.6 62.4 73 L63 75.6 Q50 82 37 75.6 Z" fill="${r}"/><path d="M38.6 74.6 Q50 80 61.4 74.6" fill="none" stroke="${shade(r, 0.25)}" stroke-width=".7" stroke-dasharray="1 1"/>
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
  if (o === 'nysweater') {
    // Новогодний свитер: красный, белая полоса со снежинками и зелёной «ёлочкой», высокое горло
    const c = '#C62828', w = '#F6F7FB', g = '#1F7A3A';
    const flake = (x, y) => `<path d="M${x} ${y - 2.4} V${y + 2.4} M${x - 2.1} ${y - 1.2} L${x + 2.1} ${y + 1.2} M${x - 2.1} ${y + 1.2} L${x + 2.1} ${y - 1.2}" stroke="${c}" stroke-width=".9" stroke-linecap="round"/>`;
    return `<path d="${body}" fill="${c}"/>${shadeR}${neck}`
      + `<path d="M${f ? 17 : 10} 88 Q50 83 ${f ? 83 : 90} 88 L${f ? 83.6 : 90.6} 97 Q50 92 ${f ? 16.4 : 9.4} 97 Z" fill="${w}"/>`
      + [24, 36, 50, 64, 76].map((x) => flake(x, 90.6)).join('')
      + `<path d="M${f ? 16.4 : 9.4} 99.6 Q50 94.6 ${f ? 83.6 : 90.6} 99.6" fill="none" stroke="${g}" stroke-width="1.6" stroke-dasharray="2.2 1.4"/>`
      + `<path d="M39.6 76 Q38.6 67.6 44 66.4 L56 66.4 Q61.4 67.6 60.4 76 Q50 79 39.6 76 Z" fill="${c}" stroke="${shade(c, -0.25)}" stroke-width=".8"/><path d="M41 69.6 H59 M40.6 72.6 H59.4" stroke="${shade(c, -0.25)}" stroke-width=".6"/>`;
  }
  if (o === 'telnyashka') {
    // Тельняшка: белая в синюю полоску, вырез лодочкой
    const st = '#1E3A8A';
    const clip = `tl${Math.random().toString(36).slice(2, 7)}`;
    return `<clipPath id="${clip}"><path d="${body}"/></clipPath><path d="${body}" fill="#F7F8FB"/>`
      + `<g clip-path="url(#${clip})">${Array.from({ length: 10 }, (_, i) => `<rect x="0" y="${73 + i * 3.4}" width="100" height="1.7" fill="${st}"/>`).join('')}</g>${shadeR}${neck}`
      + `<path d="M38 73 Q50 80 62 73" fill="none" stroke="${st}" stroke-width="1.6"/>`;
  }
  if (o === 'vampire') {
    // Плащ вампира: чёрный, высокий стоячий воротник с красной подкладкой, белая рубашка и рубиновая брошь
    const k = '#15131A', r = '#9B111E';
    return `<path d="M${f ? 26 : 22} 76 L${f ? 19 : 14} 46 Q${f ? 28 : 24} 54 ${f ? 37 : 35} 59 L42 72 Z" fill="${k}"/><path d="M${f ? 26.6 : 23} 73 L${f ? 21.6 : 17} 50.6 Q${f ? 28.6 : 25} 56.6 ${f ? 35.6 : 34} 60.4 L40.6 71.4 Z" fill="${r}"/>`
      + `<path d="M${f ? 74 : 78} 76 L${f ? 81 : 86} 46 Q${f ? 72 : 76} 54 ${f ? 63 : 65} 59 L58 72 Z" fill="${k}"/><path d="M${f ? 73.4 : 77} 73 L${f ? 78.4 : 83} 50.6 Q${f ? 71.4 : 75} 56.6 ${f ? 64.4 : 66} 60.4 L59.4 71.4 Z" fill="${r}"/>`
      + `<path d="${body}" fill="${k}"/>${neck}`
      + `<path d="M42.6 72 L50 90 L57.4 72 Q50 70.6 42.6 72 Z" fill="#F4F6FA"/><path d="M45 74 Q50 77.6 55 74" fill="none" stroke="#D5DAE5" stroke-width=".8"/>`
      + `<path d="M41.6 72 L50 92 L40 104 L${f ? 30 : 24} 104 L36 78 Z M58.4 72 L50 92 L60 104 L${f ? 70 : 76} 104 L64 78 Z" fill="#221E2A"/>`
      + `<path d="M41.6 72 L36 78 L${f ? 30 : 24} 104 M58.4 72 L64 78 L${f ? 70 : 76} 104" fill="none" stroke="${r}" stroke-width="1.2"/>`
      + `<path d="M47.6 79.6 L50 77 L52.4 79.6 L50 82.2 Z" fill="#D7263D" stroke="#7E151B" stroke-width=".6"/><circle cx="49.4" cy="79" r=".5" fill="#fff"/>`;
  }
  if (o === 'armor') {
    // Доспехи (легендарные): стальная кираса с наплечниками, заклёпки и блик
    const st = '#B9C3D1', dk = '#6B7689', lt = '#E8EDF4';
    return `<path d="${body}" fill="${st}"/>${neck}
      <path d="M${f ? 26 : 22} 104 Q${f ? 28 : 25} 82 50 79 Q${f ? 72 : 75} 82 ${f ? 74 : 78} 104 Z" fill="#C9D2DE" stroke="${dk}" stroke-width="1"/>
      <path d="M50 80 V104" stroke="${dk}" stroke-width="1"/><path d="M36 92 Q50 96 64 92" fill="none" stroke="${dk}" stroke-width=".9"/>
      <path d="M${f ? 15 : 8} 92 Q${f ? 14 : 7} 74 ${f ? 34 : 30} 72 Q${f ? 38 : 35} 80 ${f ? 30 : 26} 90 Z" fill="${st}" stroke="${dk}" stroke-width="1"/>
      <path d="M${f ? 85 : 92} 92 Q${f ? 86 : 93} 74 ${f ? 66 : 70} 72 Q${f ? 62 : 65} 80 ${f ? 70 : 74} 90 Z" fill="${st}" stroke="${dk}" stroke-width="1"/>
      <path d="M${f ? 17 : 11} 84 Q${f ? 24 : 18} 79 ${f ? 32 : 28} 79 M${f ? 83 : 89} 84 Q${f ? 76 : 82} 79 ${f ? 68 : 72} 79" fill="none" stroke="${dk}" stroke-width=".8"/>
      <path d="M39 72 Q50 76 61 72 L60 76 Q50 80 40 76 Z" fill="${dk}"/>
      ${[[40, 86], [60, 86], [44, 99], [56, 99]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="${lt}" stroke="${dk}" stroke-width=".5"/>`).join('')}
      <path d="M${f ? 32 : 29} 88 Q${f ? 34 : 31} 82 42 81" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>`;
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
  if (n === 'garland') {
    // Ёлочная гирлянда: провод вокруг шеи и разноцветные лампочки со свечением
    const cols = ['#FF4D4D', '#FFC93C', '#3AD07A', '#3A86FF', '#FF6FD1'];
    const pts = Array.from({ length: 9 }, (_, i) => { const t = (i + 0.5) / 9; return [38 + 24 * t, 73.4 + 8.4 * Math.sin(Math.PI * t)]; });
    return '<path d="M37 73 Q50 87 63 73" fill="none" stroke="#1E5A2E" stroke-width="1.1"/>'
      + pts.map(([x, y], i) => `<circle cx="${x.toFixed(2)}" cy="${(y + 1.6).toFixed(2)}" r="2.6" fill="${cols[i % cols.length]}" opacity=".35"/><ellipse cx="${x.toFixed(2)}" cy="${(y + 1.6).toFixed(2)}" rx="1.25" ry="1.7" fill="${cols[i % cols.length]}"/><circle cx="${(x - 0.4).toFixed(2)}" cy="${(y + 1).toFixed(2)}" r=".4" fill="#fff" opacity=".85"/>`).join('');
  }
  if (n === 'beads') return ['#E5484D', '#F4C430', '#3A86FF', '#2FA84F', '#FF6FA8', '#7C4DFF', '#F28C28', '#22D3EE', '#E5484D'].map((c, i) => { const t = (i + 0.5) / 9, x = 41 + 18 * t, y = 72.4 + 7.2 * Math.sin(Math.PI * t); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.3" fill="${c}" stroke="#000" stroke-opacity=".15" stroke-width=".3"/>`; }).join('');
  if (n === 'chain') return '<path d="M42 72.6 Q50 81.4 58 72.6" fill="none" stroke="#B9C0CC" stroke-width="1.1" stroke-dasharray="1.4 .6"/><path d="M50 77.8 L50 80.4" stroke="#B9C0CC" stroke-width=".7"/><circle cx="50" cy="81.4" r="1.1" fill="#D5DAE5" stroke="#8A919E" stroke-width=".4"/>';
  if (n === 'chain_gold') return '<path d="M40 72 Q50 85 60 72" fill="none" stroke="#B8922E" stroke-width="2.6"/><path d="M40 72 Q50 85 60 72" fill="none" stroke="#F4C430" stroke-width="1.8" stroke-dasharray="2 .8"/><path d="M50 79 L50 82" stroke="#F4C430" stroke-width="1"/><path d="M50 82 L53.4 85.4 L50 89 L46.6 85.4 Z" fill="#F4C430" stroke="#B8922E" stroke-width=".7"/><circle cx="50" cy="85.4" r="1" fill="#fff" opacity=".8"/>';
  if (n === 'badge') return '<path d="M44 72 L57 86 M56 72 L59 86" stroke="#E5484D" stroke-width="1.6"/><rect x="53.5" y="85" width="13" height="16" rx="2" fill="#fff" stroke="#C9CED9" stroke-width=".8"/><rect x="53.5" y="85" width="13" height="4" rx="1.5" fill="#E5484D"/><circle cx="58" cy="94" r="2.4" fill="#C9CED9"/><path d="M61.5 92.5 h3 M61.5 95.5 h3" stroke="#C9CED9" stroke-width="1.2"/>';
  return '';
}
// Значки на кепку: белые на тёмной кепке, чёрные на светлой
const CAP_BADGES = {
  star: 'M50 21.6 L51.9 25.6 L56.3 26.1 L53 29.1 L53.9 33.4 L50 31.2 L46.1 33.4 L47 29.1 L43.7 26.1 L48.1 25.6 Z',
  bolt: 'M51.6 20.8 L45.6 28.6 H49.8 L48.2 34.4 L54.6 26 H50.4 Z',
  heart: 'M50 33.4 Q43.4 28.6 44 24.8 Q44.8 21.4 48 22 Q49.4 22.4 50 24 Q50.6 22.4 52 22 Q55.2 21.4 56 24.8 Q56.6 28.6 50 33.4 Z',
  crown: 'M44 32.6 L43.4 24.4 L46.8 27.6 L50 22 L53.2 27.6 L56.6 24.4 L56 32.6 Z',
  paw: 'M50 33.2 Q46.2 33.2 46.4 30.2 Q46.8 27.6 50 27.4 Q53.2 27.6 53.6 30.2 Q53.8 33.2 50 33.2 Z M45.2 27.2 a1.5 1.9 0 1 0 .01 0 Z M48.4 24.6 a1.5 1.9 0 1 0 .01 0 Z M51.6 24.6 a1.5 1.9 0 1 0 .01 0 Z M54.8 27.2 a1.5 1.9 0 1 0 .01 0 Z',
  e: null, one: null
};
const CAP_BADGE_NAMES = { none: 'Без значка', star: 'Звезда', bolt: 'Молния', heart: 'Сердце', crown: 'Корона', paw: 'Лапа', e: 'Буква Э', one: 'Номер 1' };
const lum = (hex) => { const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
function capBadge(b, cap) {
  if (!b || b === 'none') return '';
  const ink = lum(cap) > 0.55 ? '#1E2433' : '#FFFFFF';
  if (b === 'e' || b === 'one') return `<text x="50" y="33" text-anchor="middle" font-family="Unbounded, Arial Black, sans-serif" font-weight="800" font-size="12" fill="${ink}">${b === 'e' ? 'Э' : '1'}</text>`;
  return CAP_BADGES[b] ? `<path d="${CAP_BADGES[b]}" fill="${ink}"/>` : '';
}
function hatLayer(h, hood, sex, badge) {
  if (h === 'beanie') {
    const c = shade(hood, 0.1);
    return `<path d="M28.5 42 Q27.5 15 50 14.5 Q72.5 15 71.5 42 Z" fill="${c}"/><path d="M38 20 L38 40 M46 16 L46 38 M54 16 L54 38 M62 20 L62 40" stroke="${shade(c, -0.15)}" stroke-width="1.4"/>
      <path d="M27 36 Q50 30.5 73 36 L73.5 44 Q50 38.5 26.5 44 Z" fill="${shade(c, -0.2)}"/><circle cx="50" cy="13" r="5" fill="${shade(c, 0.35)}"/>`;
  }
  if (h === 'cap') {
    const c = hood;
    return `<path d="M26.6 40 Q26 13 50 12.5 Q74 13 73.4 40 Z" fill="${c}"/><path d="M25 40 Q50 31.5 80 42 Q62 46.5 27 44 Z" fill="${shade(c, -0.3)}"/>
      <path d="M50 12.5 L50 ${badge && badge !== 'none' ? 19.6 : 37}" stroke="${shade(c, -0.15)}" stroke-width="1.2"/>${capBadge(badge, c)}<circle cx="50" cy="13" r="1.8" fill="${shade(c, -0.3)}"/><path d="M36 20 Q43 15.5 52 15.6" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>`;
  }
  if (h === 'knight') {
    // Рыцарский шлем: стальной купол с забралом-щелью и красным плюмажем
    return `<path d="M50 14 Q60 2 71 6 Q62 8 58 15" fill="#D7263D"/><path d="M50 14 Q56 5 64 6" fill="none" stroke="#8E1424" stroke-width="1"/>
      <path d="M26.5 52 Q24.5 15 50 13.5 Q75.5 15 73.5 52 Q72.4 58.6 62 61 Q56 62.4 50 62.4 Q44 62.4 38 61 Q27.6 58.6 26.5 52 Z" fill="#B9C3D1" stroke="#6B7689" stroke-width="1.2"/><path d="M38 61 Q50 63.6 62 61" fill="none" stroke="#6B7689" stroke-width="1.6"/>
      <path d="M50 14 V40" stroke="#6B7689" stroke-width="1.2"/><path d="M29 44 H71 V50 H29 Z" fill="#1E2433"/><path d="M31 46.5 H69" stroke="#3A4256" stroke-width=".8"/>
      ${[0, 1, 2, 3, 4].map((i) => `<path d="M${40 + i * 5} 52 V58" stroke="#6B7689" stroke-width="1.4" stroke-linecap="round"/>`).join('')}
      <path d="M33 24 Q38 17 46 16" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>`;
  }
  if (h === 'tricorn') {
    // Треуголка капитана: поднятые поля, золотой кант, пряжка
    return `<path d="M35 23 Q36 8.5 50 8.5 Q64 8.5 65 23 Z" fill="#1B1B24"/>`
      + `<path d="M18 30 Q25 13 50 17 Q75 13 82 30 Q66 26 50 27.6 Q34 26 18 30 Z" fill="#23232E" stroke="#E0B04B" stroke-width="1.3" stroke-linejoin="round"/>`
      + `<path d="M18 30 Q34 27.6 50 27.6 Q66 27.6 82 30 Q71 41 50 45 Q29 41 18 30 Z" fill="#2C2C38" stroke="#E0B04B" stroke-width="1.4" stroke-linejoin="round"/>`
      + `<path d="M27 33.4 Q50 40 73 33.4" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="1"/><rect x="46.6" y="32" width="6.8" height="5.6" rx="1" fill="none" stroke="#E0B04B" stroke-width="1.3"/>`;
  }
  if (h === 'ushanka') {
    // Ушанка: мех, отворот спереди, уши опущены
    const f = '#6E4B2E', l = '#8C6642', d = '#4E3320';
    return `<path d="M24.6 38 Q21 52 24.4 64 Q28.4 67.4 32.6 63 L33 39 Z" fill="${l}" stroke="${d}" stroke-width=".8"/><path d="M75.4 38 Q79 52 75.6 64 Q71.6 67.4 67.4 63 L67 39 Z" fill="${l}" stroke="${d}" stroke-width=".8"/>`
      + `<path d="M27 40 Q26 13 50 12.5 Q74 13 73 40 Z" fill="${f}"/>`
      + `<path d="M25.4 31.6 Q50 25 74.6 31.6 L75 42 Q50 36 25 42 Z" fill="${l}" stroke="${d}" stroke-width=".8"/>`
      + `<g stroke="${d}" stroke-width=".7" stroke-linecap="round" opacity=".7"><path d="M33 34 l1 2.4 M40 32 l.8 2.4 M47 31 l.6 2.4 M54 31 l.4 2.4 M61 32 l.2 2.4 M68 33.6 l0 2.4 M26.6 46 l2 .6 M26.4 54 l2 .6 M73.4 46 l-2 .6 M73.6 54 l-2 .6 M38 18 l1.4 1.6 M50 15 l0 2 M62 18 l-1.4 1.6"/></g>`;
  }
  if (h === 'dedmoroz') {
    // Шапка Деда Мороза: красная, круглая, с белой меховой опушкой и серебряными снежинками
    const sn = (x, y) => `<path d="M${x} ${y - 2.6} V${y + 2.6} M${x - 2.3} ${y - 1.3} L${x + 2.3} ${y + 1.3} M${x - 2.3} ${y + 1.3} L${x + 2.3} ${y - 1.3}" stroke="#E6ECF5" stroke-width=".8" stroke-linecap="round"/>`;
    return `<path d="M27.4 38 Q26.4 11 50 10.4 Q73.6 11 72.6 38 Z" fill="#C62828"/><path d="M33 18 Q40 12.6 49 12.6" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2" stroke-linecap="round"/>`
      + sn(40, 22) + sn(55, 18) + sn(63, 27) + sn(48, 28)
      + `<path d="M25.4 31.4 Q50 25.4 74.6 31.4 L75 41.6 Q50 36 25 41.6 Z" fill="#F6F7FB"/>`
      + [27, 33, 39, 45, 51, 57, 63, 69, 74].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 40.6 : 41.4}" r="2.4" fill="#F6F7FB"/>`).join('')
      + `<path d="M28 34 Q50 29 72 34" fill="none" stroke="#D5DAE5" stroke-width=".8"/>`;
  }
  if (h === 'kokoshnik') {
    // Кокошник Снегурочки: высокий полумесяц, жемчуг по краю и голубой камень
    return `<path d="M29 38 Q26 22 34.6 13.6 Q42 6 50 4 Q58 6 65.4 13.6 Q74 22 71 38 Q50 30.6 29 38 Z" fill="#DCEBFA" stroke="#7FA8DA" stroke-width="1.2"/>`
      + `<path d="M33.6 34.6 Q32 22 39 15.4 Q44.6 10.4 50 9.4 Q55.4 10.4 61 15.4 Q68 22 66.4 34.6" fill="none" stroke="#9CC0EA" stroke-width="1"/>`
      + `<path d="M39 30 Q42 22 50 18 Q58 22 61 30" fill="none" stroke="#B8D3F2" stroke-width="1.6"/><path d="M50 10 V18" stroke="#B8D3F2" stroke-width="1.2"/>`
      + [[31, 36.2], [35.4, 33.8], [40, 32.2], [45, 31.3], [50, 31], [55, 31.3], [60, 32.2], [64.6, 33.8], [69, 36.2]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.25" fill="#fff" stroke="#C9D3EA" stroke-width=".4"/>`).join('')
      + `<path d="M50 20.4 L53.4 24.6 L50 28.8 L46.6 24.6 Z" fill="#3A86FF" stroke="#1E4FA8" stroke-width=".7"/><circle cx="49" cy="23.6" r=".7" fill="#fff"/>`
      + [[36, 20], [64, 20], [42, 13], [58, 13]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fff"/>`).join('');
  }
  if (h === 'fedora') {
    const c = shade(hood, -0.35);
    return `<path d="M28 31 Q28 11.5 50 11.5 Q72 11.5 72 31 L73 37 H27 Z" fill="${c}"/><path d="M40 12.5 Q50 20 60 12.5" fill="none" stroke="${shade(c, -0.3)}" stroke-width="1.6"/>
      <path d="M27.4 31.5 H72.6 V37 H27.4 Z" fill="${shade(c, -0.45)}"/><ellipse cx="50" cy="38" rx="32" ry="4.8" fill="${c}"/><ellipse cx="50" cy="37" rx="24" ry="2" fill="${shade(c, -0.25)}" opacity=".6"/>`;
  }
  if (h === 'royal') {
    // Королевская корона: высокая, с бархатом и камнями
    return `<path d="M31 32 Q50 24 69 32 L66 20 Q50 12 34 20 Z" fill="#B3122E"/>
      <path d="M30 36 L28 14 L37 22 L43 9 L50 19 L57 9 L63 22 L72 14 L70 36 Z" fill="#F2B705" stroke="#A87C00" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M29.5 31 Q50 27 70.5 31 L70 36 Q50 32 30 36 Z" fill="#E0A800"/>
      <circle cx="43" cy="9" r="2" fill="#fff"/><circle cx="57" cy="9" r="2" fill="#fff"/><circle cx="28" cy="14" r="1.7" fill="#fff"/><circle cx="72" cy="14" r="1.7" fill="#fff"/>
      <circle cx="50" cy="31.5" r="2.4" fill="#D7263D"/><circle cx="40" cy="32.5" r="1.7" fill="#2563C9"/><circle cx="60" cy="32.5" r="1.7" fill="#1F8A4C"/>`;
  }
  if (h === 'wreath') {
    // Весенний венок: зелёные листья и цветы — тюльпаны, мимоза, ромашки
    const leaf = (x, y, a) => `<ellipse cx="${x}" cy="${y}" rx="3.6" ry="1.6" transform="rotate(${a} ${x} ${y})" fill="#4FA35E"/>`;
    const flower = (x, y, c, r = 2.6) => [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${(x + Math.cos(a * Math.PI / 180) * r * 0.8).toFixed(2)}" cy="${(y + Math.sin(a * Math.PI / 180) * r * 0.8).toFixed(2)}" rx="${(r * 0.62).toFixed(2)}" ry="${(r * 0.62).toFixed(2)}" fill="${c}"/>`).join('') + `<circle cx="${x}" cy="${y}" r="${(r * 0.5).toFixed(2)}" fill="#FFC93C"/>`;
    const mimosa = (x, y) => [[0, 0], [1.6, 1], [-1.6, 1], [0, 2], [1.2, -1.2], [-1.2, -1.2]].map(([dx, dy]) => `<circle cx="${x + dx}" cy="${y + dy}" r="1" fill="#FFD600"/>`).join('');
    return `<path d="M29 40 Q28 21 50 17 Q72 21 71 40" fill="none" stroke="#3E7D44" stroke-width="1.4"/>`
      + [[31, 34, -60], [33.4, 27, -40], [38.6, 21.4, -20], [61.4, 21.4, 20], [66.6, 27, 40], [69, 34, 60], [45, 18.6, -6], [55, 18.6, 6]].map(([x, y, a]) => leaf(x, y, a)).join('')
      + flower(34, 30, '#FF8FB8') + flower(50, 17.6, '#FF5E7E', 3) + flower(66, 30, '#FF8FB8') + flower(42, 20.4, '#FFFFFF', 2.2) + flower(58, 20.4, '#FFFFFF', 2.2)
      + mimosa(30, 39) + mimosa(70, 39);
  }
  if (h === 'shawl') {
    // Расписной платок: покрывает голову, по краю бахрома, цветочный узор, узел под подбородком
    const c = '#B71C1C', e = '#3A0E0E';
    const rose = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFD3D9"/><circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="#F06292"/><ellipse cx="${x + r * 1.1}" cy="${y + r * 0.6}" rx="${r * 0.7}" ry="${r * 0.35}" fill="#2E7D32" transform="rotate(30 ${x + r * 1.1} ${y + r * 0.6})"/>`;
    return `<path d="M24.6 66 Q20 40 27 26 Q36 11 50 11 Q64 11 73 26 Q80 40 75.4 66 Q70 56 69.6 46 Q68 30 50 28.6 Q32 30 30.4 46 Q30 56 24.6 66 Z" fill="${c}"/>`
      + `<path d="M24.6 66 Q20 40 27 26 Q36 11 50 11 Q64 11 73 26 Q80 40 75.4 66" fill="none" stroke="${e}" stroke-width="1.2" stroke-dasharray="1.4 1.1"/>`
      + rose(40, 18, 2.6) + rose(58, 17, 2.8) + rose(30, 34, 2.2) + rose(70, 34, 2.2) + rose(50, 22.6, 1.8)
      + `<path d="M30.4 46 Q32 30 50 28.6 Q68 30 69.6 46" fill="none" stroke="#FFC93C" stroke-width="1"/>`
      + `<path d="M44 70 Q50 66.6 56 70 L58.6 79 L54 76.4 L50 80 L46 76.4 L41.4 79 Z" fill="${c}" stroke="${e}" stroke-width=".6"/><circle cx="50" cy="70.6" r="2.2" fill="${shade(c, -0.15)}"/>`;
  }
  if (h === 'laurel') {
    // Лавровый венок: две ветви листьев по кругу головы, сходятся надо лбом
    const leaf = (x, y, a, c) => `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="2" transform="rotate(${a} ${x} ${y})" fill="${c}"/>`;
    const pts = [[29, 40, -70], [29.6, 34, -55], [31.4, 28.4, -40], [34.6, 23.6, -25], [39, 20, -12], [44.4, 18, 0]];
    const side = (flip) => pts.map(([x, y, a], i) => leaf(flip ? 100 - x : x, y, flip ? -a : a, i % 2 ? '#3E9B58' : '#5BBF6E')).join('');
    return `<path d="M29 43 Q28 22 50 17.6 Q72 22 71 43" fill="none" stroke="#2F7A44" stroke-width="1.3"/>${side(false)}${side(true)}<circle cx="50" cy="17.4" r="2.3" fill="#FFC93C" stroke="#D99A0B" stroke-width=".8"/>`;
  }
  if (h === 'headset') {
    return '<path d="M30 47 Q28 17 50 17 Q72 17 70 47" fill="none" stroke="#2B2B3A" stroke-width="3.6" stroke-linecap="round"/><rect x="24.5" y="42" width="8" height="13" rx="3.5" fill="#2B2B3A"/><rect x="67.5" y="42" width="8" height="13" rx="3.5" fill="#2B2B3A"/><path d="M28 54 Q28.5 63 39 63.5" fill="none" stroke="#2B2B3A" stroke-width="2.2" stroke-linecap="round"/><rect x="38" y="61" width="5.5" height="4.5" rx="2" fill="#E5484D"/>';
  }
  return '';
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
  if (m === 'scuba') {
    // Маска аквалангиста: стекло на глаза и нос, ремешок и трубка сбоку
    const top = 40, b2 = 57;
    return `<path d="M${50 - W - 2.4} ${top + 3} Q50 ${top - 2} ${50 + W + 2.4} ${top + 3}" fill="none" stroke="#1E2433" stroke-width="2.6"/>`
      + `<path d="M${50 - W + 1} ${top + 1} Q50 ${top - 1.6} ${50 + W - 1} ${top + 1} L${50 + W - 1.6} ${b2 - 6} Q${50 + 6} ${b2 - 5} 50 ${b2} Q${50 - 6} ${b2 - 5} ${50 - W + 1.6} ${b2 - 6} Z" fill="#7FD6F5" fill-opacity=".38" stroke="#F97316" stroke-width="2.4" stroke-linejoin="round"/>`
      + `<path d="M${50 - W + 4} ${top + 3} Q${50 - W + 6} ${top + 1.4} ${50 - W + 10} ${top + 1.6}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" stroke-linecap="round"/>`
      + `<path d="M${50 + W + 2.6} ${top + 16} V${top - 8} Q${50 + W + 2.6} ${top - 12} ${50 + W + 6} ${top - 12}" fill="none" stroke="#F2B705" stroke-width="3" stroke-linecap="round"/><path d="M${50 + W + 2.6} ${top + 16} Q${50 + W + 2} ${b2 + 4} ${50 + 4} ${b2 + 3}" fill="none" stroke="#1E2433" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  if (m === 'visor') {
    return `<path d="M${50 - W - 1.4} 44.4 Q50 41.6 ${50 + W + 1.4} 44.4 L${50 + W + 0.6} 51.4 Q50 53.4 ${50 - W - 0.6} 51.4 Z" fill="#0E1224" stroke="#22D3EE" stroke-width="1"/>`
      + `<path d="M${50 - W + 2} 47.8 L${50 + W - 2} 47.8" stroke="#FF2FD0" stroke-width="1.6" opacity=".9"/><path d="M${50 - W + 2} 47.8 L${50 + W - 2} 47.8" stroke="#FF2FD0" stroke-width="4" opacity=".25"/>`
      + `<path d="M${50 - W} 44.6 Q50 42.4 ${50 + W} 44.6" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>`;
  }
  return '';
}
// Глаза по анатомии: разрез (миндаль, узкие, нависшее веко, опущенные/приподнятые уголки) и посадка.
// Белок — форма разреза, радужка поверх, а всё вне разреза закрывает кожа (вырез evenodd) — радужка не вылезает за веко
const EYE_GAP = { close: 1.2, normal: 0, wide: -1.3 };
function eyeAnat(shape, eyes, skin, gap = 0, lashes = false, uid = 0) {
  const H = { normal: 3.8, almond: 3.1, narrow: 1.75, hooded: 3.2, down: 3.1, up: 3.1 }[shape] || 3.8;
  const tilt = { down: 2.3, up: -2.3 }[shape] || 0;
  const w = shape === 'normal' ? 4.2 : 4.7;
  const one = (cx, side) => {
    const o = cx + side * w, i = cx - side * w, ty = 48 + tilt; // внешний и внутренний уголки
    const top = shape === 'normal' ? 48 - H * 1.05 : 48 - H * 1.12, bot = shape === 'normal' ? 48 + H * 1.05 : 48 + H * 0.82;
    const d = shape === 'normal'
      ? `M${i} 48 C${i} ${top} ${o} ${top} ${o} 48 C${o} ${bot} ${i} ${bot} ${i} 48 Z`
      : `M${i} 48.2 C${i + side * 1.6} ${top} ${o - side * 2.2} ${top} ${o} ${ty} C${o - side * 2} ${bot} ${i + side * 1.4} ${bot} ${i} 48.2 Z`;
    const ix = cx + 0.4, ir = shape === 'narrow' ? 2.45 : 2.75;
    // Радужка обрезается по разрезу (clipPath) — кожу поверх не кладём, чтобы не срезать тени, веснушки и морщинки
    const cid = `ey${uid}${side < 0 ? 'L' : 'R'}`;
    let g = `<clipPath id="${cid}"><path d="${d}"/></clipPath><path d="${d}" fill="#fff"/><g clip-path="url(#${cid})"><circle cx="${ix}" cy="48.3" r="${ir}" fill="${eyes}"/><circle cx="${ix}" cy="48.3" r="${ir * 0.47}" fill="#111"/><circle cx="${ix + 1}" cy="47.2" r=".85" fill="#fff"/></g>`;
    // Линия верхнего века — даёт форму глазу даже в маленьком кружке
    const lid = shape === 'normal' ? `M${i} 48 C${i} ${top} ${o} ${top} ${o} 48` : `M${i} 48.2 C${i + side * 1.6} ${top} ${o - side * 2.2} ${top} ${o} ${ty}`;
    g += `<path d="${lid}" fill="none" stroke="#22252D" stroke-width="${lashes ? 1.5 : 1}" stroke-linecap="round"/>`;
    if (lashes) g += `<path d="M${o} ${ty} L${o + side * 1.6} ${ty - 1.6} M${o - side * 1.6} ${top + 1.2} L${o - side * 1.9} ${top - 0.6}" stroke="#22252D" stroke-width="1.1" stroke-linecap="round"/>`;
    // Нависшее веко: складка кожи над разрезом
    if (shape === 'hooded') g += `<path d="M${i - side * 0.6} ${top - 1} Q${cx} ${top - 2.4} ${o + side * 0.8} ${ty - 0.4} L${o + side * 0.8} ${ty + 0.2} Q${cx + side * 0.6} ${top + 0.6} ${i} ${48 - 0.6} Z" fill="${skin}"/><path d="M${i} ${48 - 0.6} Q${cx + side * 0.6} ${top + 0.6} ${o + side * 0.6} ${ty + 0.1}" fill="none" stroke="#22252D" stroke-width="1.1" stroke-linecap="round"/><path d="M${i - side * 0.4} ${top - 0.9} Q${cx} ${top - 2.2} ${o + side * 0.6} ${ty - 0.5}" fill="none" stroke="${shade(skin, -0.3)}" stroke-width=".9" stroke-linecap="round"/>`;
    return g;
  };
  // side — куда смотрит внешний уголок: у левого глаза влево (−1), у правого вправо (+1)
  return one(43 + gap, -1) + one(57 - gap, 1);
}
function eyesLayer(shape, eyes, skin, gap = 0, lashes = false, uid = 0) {
  if (['normal', 'almond', 'narrow', 'hooded', 'down', 'up'].includes(shape || 'normal')) return eyeAnat(shape || 'normal', eyes, skin, gap, lashes, uid);
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
function propLayer(p, sex = 'm') {
  if (p === 'mug' || p === 'mug_best') {
    const gold = p === 'mug_best';
    const c = gold ? '#F4C430' : '#fff';
    return `<g transform="translate(-9 -3)"><path d="M70 82 Q66 78 70 74 M75 82 Q71 78 75 74" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M80.5 88 Q87 88 86.5 93 Q86 97.5 80.5 97" fill="none" stroke="${gold ? '#C99A0E' : '#C9CED9'}" stroke-width="2.4"/>
      <rect x="66" y="84" width="15" height="17" rx="2.5" fill="${c}" stroke="${gold ? '#C99A0E' : '#C9CED9'}" stroke-width="1"/><ellipse cx="73.5" cy="85" rx="6.6" ry="1.7" fill="#6B3E26"/>`
      + (gold ? '<path d="M73.5 88.5 L74.8 91.3 L77.8 91.6 L75.6 93.6 L76.2 96.6 L73.5 95.1 L70.8 96.6 L71.4 93.6 L69.2 91.6 L72.2 91.3 Z" fill="#fff"/>' : '<path d="M69.5 91 h8 M69.5 94 h6" stroke="#E5484D" stroke-width="1.2" stroke-linecap="round"/>') + '</g>';
  }
  if (p === 'trophy') {
    // Кубок Лиги в руке: золотой, с ручками и звездой
    return `<g transform="translate(57 63) scale(1.2)"><path d="M3 2 H21 Q21 15 12 17 Q3 15 3 2 Z" fill="#FFC93C" stroke="#D99A0B" stroke-width="1.1"/>
      <path d="M3 4 Q-2 4 -1.5 8.5 Q-1 12 4.5 12 M21 4 Q26 4 25.5 8.5 Q25 12 19.5 12" fill="none" stroke="#D99A0B" stroke-width="1.6"/>
      <rect x="10" y="16.5" width="4" height="5" fill="#D99A0B"/><rect x="5.5" y="21" width="13" height="4" rx="1.2" fill="#8B5A2B"/>
      <path d="M12 5.2 L13.2 7.8 L16 8.1 L13.9 10 L14.5 12.8 L12 11.4 L9.5 12.8 L10.1 10 L8 8.1 L10.8 7.8 Z" fill="#fff"/>
      <path d="M6 4.5 Q6.5 10 9 13" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2" stroke-linecap="round"/>
      </g>`;
  }
  if (p === 'papers') {
    return '<g transform="translate(8 -3) rotate(-8 24 92)"><rect x="12" y="84" width="24" height="19" rx="1.5" fill="#E8ECF4"/><rect x="14" y="82" width="24" height="19" rx="1.5" fill="#F7F9FC" stroke="#C9CED9" stroke-width=".8"/><path d="M17 87 h14 M17 90.5 h18 M17 94 h11" stroke="#9AA3B5" stroke-width="1.1"/><rect x="29" y="93.5" width="6" height="5" fill="#3A7BD5"/><rect x="31.5" y="91" width="3" height="7.5" fill="#2FA84F"/></g>';
  }
  if (p === 'laptop') {
    return '<rect x="27" y="80" width="46" height="24" rx="3" fill="#B9C1D0"/><rect x="27" y="80" width="46" height="24" rx="3" fill="none" stroke="#9AA3B5" stroke-width="1"/><circle cx="50" cy="91" r="3" fill="#E6E9F0"/><circle cx="36" cy="86" r="3.2" fill="#FF6FA8"/><rect x="58" y="84" width="9" height="6" rx="1.5" fill="#7CFFB2"/><path d="M60 93 l3 3 l5 -6" stroke="#2563C9" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="40" cy="97" r="2.4" fill="#FFC93C"/>';
  }
  // Офисные таблички из Лавки: та же табличка на палке, свой текст. Длинную строку ужимаем по ширине
  const SIGNS = { sign_lunch: [sex === 'f' ? 'УШЛА НА ОБЕД' : 'УШЁЛ НА ОБЕД', 'ВЕРНУСЬ НЕ СКОРО', '#FFE3E3', '#D94B4B', '#6B1414'], sign_dnd: ['НЕ БЕСПОКОИТЬ', 'ДУМАЮ', '#E6F0FF', '#3A6FD8', '#16306B'], sign_ask: ['Я ПРОСТО', 'СПРОСИТЬ', '#E5F7EA', '#2FA84F', '#124A22'] };
  if (SIGNS[p]) {
    const [a, b, bg, bd, fg] = SIGNS[p];
    const line = (t, y) => `<text x="50" y="${y}" text-anchor="middle" font-size="6.8" font-weight="900" fill="${fg}" font-family="system-ui,sans-serif"${t.length > 11 ? ' textLength="52" lengthAdjust="spacingAndGlyphs"' : ''}>${t}</text>`;
    return `<rect x="47.5" y="96" width="5" height="8" fill="#B07A3E"/><rect x="21" y="77" width="58" height="21" rx="3" fill="${bg}" stroke="${bd}" stroke-width="1.6"/>${line(a, 86)}${line(b, 94.5)}`;
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
      // Тумба под растением: горшок стоит, а не висит
      + '<rect x="-5" y="55" width="30" height="12" fill="#D3DCE7"/><rect x="-5" y="54" width="31" height="2.4" rx="1" fill="#B8C4D3"/><rect x="3" y="58.6" width="10" height="1.4" rx=".7" fill="#9AA8BA"/>'
      + '<rect x="-5" y="66" width="110" height="40" fill="#C9A27A"/><rect x="-5" y="66" width="110" height="2.4" fill="#B08560"/>';
  }
  if (bg === 'meeting') {
    // Доска с графиком и стикерами, часы, стол с кружками
    return R('#E6E0F7') + '<rect x="3" y="6" width="40" height="28" rx="2.5" fill="#fff" stroke="#A99BDB" stroke-width="1.6"/>'
      + '<rect x="9" y="22" width="5" height="8" fill="#7C6BD6"/><rect x="16" y="17" width="5" height="13" fill="#3A86FF"/><rect x="23" y="12" width="5" height="18" fill="#2FA84F"/><path d="M8 20 L17 15 L24 11 L31 9" fill="none" stroke="#E5484D" stroke-width="1.4"/><path d="M29 9.6l2.4-.8-.6 2.4" fill="none" stroke="#E5484D" stroke-width="1.2"/>'
      + '<rect x="32" y="14" width="8" height="8" fill="#FFE27A" transform="rotate(6 36 18)"/><rect x="32" y="23" width="8" height="8" fill="#FF9EC0" transform="rotate(-5 36 27)"/><path d="M3 34h40" stroke="#8F82C7" stroke-width="2"/>'
      + '<circle cx="85" cy="16" r="9" fill="#fff" stroke="#8F82C7" stroke-width="2"/><path d="M85 10.5V16l4 2.4" fill="none" stroke="#3B3170" stroke-width="1.6" stroke-linecap="round"/><circle cx="85" cy="16" r="1" fill="#3B3170"/>'
      // Стикеры — на пробковой доске, а не на голой стене
      + '<rect x="68" y="29" width="28" height="18" rx="1.5" fill="#D6B48A" stroke="#A9835A" stroke-width="1.4"/>'
      + '<rect x="71" y="32" width="8" height="8" fill="#9BE3C1" transform="rotate(-8 75 36)"/><rect x="84" y="33" width="8" height="8" fill="#FFE27A" transform="rotate(7 88 37)"/><circle cx="75" cy="32.6" r=".9" fill="#E5484D"/><circle cx="88" cy="33.6" r=".9" fill="#3A86FF"/>'
      + '<rect x="-5" y="64" width="110" height="40" fill="#8C6A4E"/><rect x="-5" y="64" width="110" height="2.6" fill="#A8835F"/>'
      + '<path d="M5 58h7v7H5z" fill="#fff"/><path d="M12 59.5q3 0 3 2.5t-3 2.5" fill="none" stroke="#fff" stroke-width="1.2"/><path d="M86 58h7v7h-7z" fill="#E5484D"/><path d="M93 59.5q3 0 3 2.5t-3 2.5" fill="none" stroke="#E5484D" stroke-width="1.2"/>';
  }
  if (bg === 'home') {
    // Тёплая стена, окно со шторами, картина, торшер, спинка дивана
    return R('#F6E3CC') + '<path d="M0 -5v110M10 -5v110M20 -5v110M80 -5v110M90 -5v110" stroke="#EFD5B6" stroke-width="3"/>'
      + `${lin(`bh${u}`, '#9ED0FF', '#D9EEFF')}<rect x="66" y="6" width="26" height="26" rx="1.5" fill="url(#bh${u})"/><circle cx="85" cy="13" r="3.4" fill="#FFE38A"/><path d="M66 27 Q74 21 80 26 Q86 22 92 27V32H66z" fill="#8BC79A"/><path d="M79 6v26M66 19h26" stroke="#fff" stroke-width="1.6"/>`
      + '<path d="M62 3h34" stroke="#A0703F" stroke-width="2" stroke-linecap="round"/><path d="M63 4 Q66 20 63 36 L68 36 Q70 20 68 4 Z M95 4 Q92 20 95 36 L90 36 Q88 20 90 4 Z" fill="#E5484D"/>'
      + '<path d="M8 8 L16 3 L24 8" fill="none" stroke="#8A6A4A" stroke-width=".7"/><circle cx="16" cy="3" r=".9" fill="#6B4A2F"/><rect x="6" y="8" width="20" height="15" rx="1" fill="#fff" stroke="#B9844F" stroke-width="2"/><path d="M8.5 21l5-6 3.5 4 2.5-2.5 4.5 4.5z" fill="#6BB0E8"/><circle cx="21" cy="12" r="1.8" fill="#FFC93C"/>'
      + '<path d="M7 30h10l-3 7h-4z" fill="#FFD27A"/><path d="M12 37v15" stroke="#6B4A2F" stroke-width="1.6"/><ellipse cx="12" cy="31" rx="9" ry="5" fill="#FFE9A8" opacity=".35"/>'
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

// Брови: форма и толщина — одна из самых узнаваемых черт. auto — как раньше: «М» густые прямые, «Ж» тонкие дугой
function browsLayer(shape, sex, color, dy = 0, gap = 0) {
  const sh = shape && shape !== 'auto' ? shape : sex === 'f' ? 'arch' : 'straight';
  const L = (d, w) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const y = (v) => v + dy, a = gap, b = -gap;
  const pair = (fn, w) => L(fn(1, a) + ' ' + fn(-1, b), w);
  // fn(side, shift): side 1 — левая бровь (внутренний край справа, у переносицы)
  const P = {
    straight: (s, k) => `M${50 - s * 11.8 + k} ${y(42)} Q${50 - s * 7 + k} ${y(40.6)} ${50 - s * 2.4 + k} ${y(41.4)}`,
    thick: (s, k) => `M${50 - s * 11.8 + k} ${y(42)} Q${50 - s * 7 + k} ${y(40.2)} ${50 - s * 2.4 + k} ${y(41.2)}`,
    arch: (s, k) => `M${50 - s * 11.4 + k} ${y(42.4)} Q${50 - s * 7.8 + k} ${y(38.6)} ${50 - s * 2.8 + k} ${y(41)}`,
    thin: (s, k) => `M${50 - s * 11.4 + k} ${y(42.2)} Q${50 - s * 7.6 + k} ${y(39.2)} ${50 - s * 2.8 + k} ${y(41)}`,
    peak: (s, k) => `M${50 - s * 11.6 + k} ${y(42.6)} L${50 - s * 6.6 + k} ${y(39.2)} L${50 - s * 2.6 + k} ${y(41.2)}`,
    uni: (s, k) => `M${50 - s * 11.8 + k} ${y(42)} Q${50 - s * 7 + k} ${y(40.4)} ${50 - s * 2.4 + k} ${y(41.4)}`
  };
  const W = { straight: sex === 'f' ? 2 : 2.9, thick: 3.9, arch: sex === 'f' ? 1.6 : 2.3, thin: 1.15, peak: sex === 'f' ? 1.8 : 2.6, uni: 3.2 }[sh];
  let o = pair(P[sh] || P.straight, W);
  if (sh === 'uni') o += L(`M${47.6 + a} ${y(41.6)} Q50 ${y(42.2)} ${52.4 + b} ${y(41.6)}`, 1.6);
  return o;
}
// Возраст: 1 — «гусиные лапки» и лёгкие мешки, 2 — плюс носогубные складки и морщины на лбу
function ageLayer(age, skin, gap = 0) {
  if (!age || age === '0') return '';
  const c = shade(skin, -0.4), L = (d, w = 0.9, op = 0.8) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`;
  let o = L(`M${37 + gap} 47 l-2 -1.2 M${37 + gap} 48.6 l-2.2 .2 M${37.2 + gap} 50 l-2 1.2 M${63 - gap} 47 l2 -1.2 M${63 - gap} 48.6 l2.2 .2 M${62.8 - gap} 50 l2 1.2`, 0.7)
    + L(`M${39.6 + gap} 52.6 Q${43 + gap} 54 ${46.4 + gap} 52.6 M${53.6 - gap} 52.6 Q${57 - gap} 54 ${60.4 - gap} 52.6`, 0.75, 0.5);
  if (age === '2') o += L('M44.2 52.6 Q41.4 56 43 60.4 M55.8 52.6 Q58.6 56 57 60.4', 1, 0.6) + L('M42 34.6 Q50 33.4 58 34.6 M43.6 37 Q50 36 56.4 37', 0.7, 0.45);
  return o;
}
// Приметы: родинка и ямочки
function marksLayer(mole, dimples, skin) {
  const at = { cheekL: [39, 56], cheekR: [61.4, 55], lip: [56.8, 54.4], chin: [52.4, 65] }[mole];
  return (at ? `<circle cx="${at[0]}" cy="${at[1]}" r=".95" fill="${shade(skin, -0.55)}"/>` : '')
    + (dimples ? `<path d="M41 58.6 q.6 1.4 1.6 1.6 M59 58.6 q-.6 1.4 -1.6 1.6" fill="none" stroke="${shade(skin, -0.3)}" stroke-width=".8" stroke-linecap="round"/>` : '');
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
// Собака сидит у плеча целиком: тело с грудкой, передние лапы, голова. Порода — уши, морда и окрас
function dogSit(o) {
  const { c, d, chest, ears, muzzle, eyesY = 77.4, extra = '' } = o;
  return `<g>
    <path d="M6.6 104 Q4.6 92 9 86 Q17 80.4 25 86 Q29.4 92 27.4 104 Z" fill="${c}"/>
    <path d="M12.4 104 Q11.4 92 17 88 Q22.6 92 21.6 104 Z" fill="${chest}"/>
    <rect x="10.6" y="93" width="5" height="11.4" rx="2.5" fill="${c}"/><rect x="18.4" y="93" width="5" height="11.4" rx="2.5" fill="${c}"/>
    <ellipse cx="13.1" cy="103.4" rx="3.1" ry="1.8" fill="${chest}"/><ellipse cx="20.9" cy="103.4" rx="3.1" ry="1.8" fill="${chest}"/>
    <path d="M10 86.6 Q17 90 24 86.6" fill="none" stroke="${d}" stroke-width=".8" opacity=".6"/>
    ${ears.back || ''}
    <ellipse cx="17" cy="76.4" rx="${o.hw || 9.4}" ry="${o.hh || 8.2}" fill="${c}"/>
    ${ears.front || ''}${extra}
    ${muzzle}
    <circle cx="12.9" cy="${eyesY}" r="1.75" fill="#1E1A18"/><circle cx="21.1" cy="${eyesY}" r="1.75" fill="#1E1A18"/>
    <circle cx="13.4" cy="${eyesY - 0.6}" r=".55" fill="#fff"/><circle cx="21.6" cy="${eyesY - 0.6}" r=".55" fill="#fff"/>
  </g>`;
}
function petLayer(p) {
  if (p === 'cat') {
    // Кот лежит на клавиатуре: клавиатура внизу слева, рыжий кот свернулся сверху, хвост свисает
    return `<g transform="translate(9.2 1.8) scale(.82)"><rect x="2" y="95" width="34" height="9" rx="2" fill="#3A3F4C"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${4.4 + i * 5.2}" y="97" width="4" height="2.6" rx=".6" fill="#6B7285"/>`).join('')}<rect x="8" y="100.6" width="22" height="2.2" rx=".6" fill="#6B7285"/>
      <path d="M31 96 Q38 98 36 104" fill="none" stroke="#E08A3C" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="19" cy="91" rx="14" ry="6.4" fill="#E9963F"/><path d="M8 89 Q19 85 30 89" fill="none" stroke="#C4762A" stroke-width="1.2"/><path d="M12 93 Q19 95 26 93" fill="none" stroke="#F7C08A" stroke-width="1.6"/>
      <ellipse cx="10" cy="85.4" rx="7" ry="6" fill="#E9963F"/><path d="M4.6 82 L4 75.6 L8.6 80 Z M15.4 82 L16 75.6 L11.4 80 Z" fill="#E9963F"/><path d="M5.4 81 L5.2 77.6 L7.6 80 Z M14.6 81 L14.8 77.6 L12.4 80 Z" fill="#F4B8A8"/>
      <path d="M6.4 85.4 Q7.6 86.4 8.8 85.4 M11.2 85.4 Q12.4 86.4 13.6 85.4" fill="none" stroke="#3A2414" stroke-width=".8" stroke-linecap="round"/>
      <path d="M9.4 87.4 L10.6 87.4 L10 88.2 Z" fill="#E86A7A"/><path d="M3 87 h4 M3 88.6 h4 M13 87 h4 M13 88.6 h4" stroke="#fff" stroke-width=".4" opacity=".8"/>
      <text x="22" y="82" font-size="5" fill="#7A8299" font-family="system-ui,sans-serif" font-weight="800">z</text><text x="25.4" y="78" font-size="6" fill="#7A8299" font-family="system-ui,sans-serif" font-weight="800">z</text></g>`;
  }
  if (p === 'aquarium') {
    // Круглый аквариум на столе: вода, золотая рыбка, водоросль и пузырьки
    return `<g transform="translate(9.2 1.8) scale(.82)"><rect x="1" y="101" width="36" height="3" rx="1" fill="#B07A3E"/><ellipse cx="18" cy="88" rx="14" ry="13" fill="#CFEFFF" fill-opacity=".55" stroke="#9CC9E6" stroke-width="1.2"/>
      <path d="M5.4 86 Q18 83.4 30.6 86 Q31 97 18 101 Q5 97 5.4 86 Z" fill="#5BB8F0" fill-opacity=".55"/><ellipse cx="18" cy="76" rx="8.6" ry="2" fill="none" stroke="#9CC9E6" stroke-width="1.2"/>
      <path d="M9 100 Q8 94 10.4 90 Q11 95 10.6 100 Z M12 100 Q13.6 95 12.4 91.6" fill="#2FA84F" stroke="#2FA84F" stroke-width=".6"/>
      <ellipse cx="20" cy="92" rx="5" ry="3.2" fill="#FF8A2A"/><path d="M24.6 92 L28.4 89 L28.4 95 Z" fill="#FFB25A"/><circle cx="17.4" cy="91.4" r=".9" fill="#1E1A18"/><path d="M19 89 Q20.4 87.4 22 89" fill="#FFB25A"/>
      <circle cx="15" cy="86" r="1" fill="none" stroke="#fff" stroke-width=".5"/><circle cx="14" cy="82.6" r=".7" fill="none" stroke="#fff" stroke-width=".5"/><path d="M8 80 Q10 78.6 12 79.4" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1" stroke-linecap="round"/></g>`;
  }
  if (p === 'cactus') {
    // Кактус в горшке стоит на столе — на полке внизу слева, не висит в воздухе
    return `<g transform="translate(9.2 1.8) scale(.82)"><rect x="1" y="101" width="34" height="3" rx="1" fill="#B07A3E"/><path d="M9 91 h16 l-2 10 h-12 Z" fill="#D9734A"/><rect x="8" y="89.4" width="18" height="3" rx="1" fill="#E98D63"/>
      <rect x="13.4" y="70" width="7.2" height="20" rx="3.6" fill="#3FA65A"/><path d="M13.6 80 h-3.4 a2.4 2.4 0 0 1 -2.4 -2.4 v-4 a1.7 1.7 0 0 1 3.4 0 v2.6 h2.4" fill="#3FA65A"/><path d="M20.4 77 h3.2 a2.4 2.4 0 0 0 2.4 -2.4 v-5 a1.7 1.7 0 0 0 -3.4 0 v3.6 h-2.2" fill="#3FA65A"/>
      <path d="M17 72 v16 M15 75 l-1 -.6 M19 79 l1 -.6 M15 84 l-1 -.6" stroke="#2C7A41" stroke-width=".7" stroke-linecap="round"/><circle cx="17" cy="69.4" r="2.2" fill="#FF6FA8"/><circle cx="17" cy="69.4" r=".9" fill="#FFE08A"/></g>`;
  }
  if (p === 'corgi') {
    // Вельш-корги: рыжий с белой грудкой и белой полосой на морде, большие острые уши, вытянутая морда
    return dogSit({ c: '#E39A45', d: '#B8742C', chest: '#FFF6EA', hw: 9, hh: 7.8,
      ears: { back: '<path d="M8.4 74 L6.8 60.4 L15.4 69.4 Z M25.6 74 L27.2 60.4 L18.6 69.4 Z" fill="#E39A45"/><path d="M9.4 72 L8.6 63.6 L13.6 69.2 Z M24.6 72 L25.4 63.6 L20.4 69.2 Z" fill="#F4B8A8"/>' },
      extra: '<path d="M17 69 Q15.4 75 13 80.4 Q17 84.6 21 80.4 Q18.6 75 17 69 Z" fill="#FFF6EA"/>',
      muzzle: '<ellipse cx="17" cy="81.4" rx="4.4" ry="3" fill="#FFF6EA"/><ellipse cx="17" cy="80.2" rx="1.7" ry="1.2" fill="#1E1A18"/><path d="M17 81.4 Q17 83 15.6 83.4 M17 81.4 Q17 83 18.4 83.4" fill="none" stroke="#1E1A18" stroke-width=".6" stroke-linecap="round"/><path d="M16.2 83.4 Q17 85.6 17.8 83.4 Z" fill="#F07A8A"/>' });
  }
  if (p === 'frenchie') {
    // Французский бульдог: крупная квадратная голова, широкие стоячие уши-«локаторы» со скруглёнными кончиками,
    // короткая плоская морда со складкой над носом, глаза широко, тёмный тигровый окрас с белой грудкой
    const c = '#3E3A3F', d = '#2A272B';
    return dogSit({ c, d, chest: '#F1EEEA', hw: 10.4, hh: 8.6, eyesY: 77,
      ears: { back: `<path d="M9 72.6 Q2.6 69.6 3 63.4 Q3.6 59.4 8 60.6 Q14.4 62.8 15.6 69.4 Z M25 72.6 Q31.4 69.6 31 63.4 Q30.4 59.4 26 60.6 Q19.6 62.8 18.4 69.4 Z" fill="${c}"/><path d="M9.4 70.2 Q5.2 68 5.4 64 Q6.2 62 9 63 Q12.6 64.8 13.4 68.8 Z M24.6 70.2 Q28.8 68 28.6 64 Q27.8 62 25 63 Q21.4 64.8 20.6 68.8 Z" fill="#D9A3A3"/>` },
      extra: `<path d="M17 69.6 V75" stroke="#F1EEEA" stroke-width="2.4" stroke-linecap="round"/><path d="M8 75 Q12 72.6 16 74.6 M26 75 Q22 72.6 18 74.6" fill="none" stroke="${d}" stroke-width=".7"/>`,
      muzzle: `<path d="M11.6 80.4 Q17 77.6 22.4 80.4 Q22.6 85 17 85.6 Q11.4 85 11.6 80.4 Z" fill="${d}"/><path d="M13.4 79.2 Q17 77.6 20.6 79.2" fill="none" stroke="#5A555B" stroke-width=".8"/>
        <path d="M15 80.4 Q17 79.4 19 80.4 Q18.6 82 17 82.2 Q15.4 82 15 80.4 Z" fill="#111"/><path d="M17 82.2 V83.6 M17 83.6 Q15.4 84.4 14.2 83.4 M17 83.6 Q18.6 84.4 19.8 83.4" fill="none" stroke="#111" stroke-width=".6" stroke-linecap="round"/>` });
  }
  if (p === 'pug') {
    // Мопс: палевый, чёрная маска, маленькие висячие ушки, складки на лбу, приплюснутая морда
    return dogSit({ c: '#DCBD8E', d: '#B8966A', chest: '#E9D2AE', hw: 9.8, hh: 8.4,
      ears: { front: '<path d="M8 71.6 Q5.6 72.4 6.4 77 Q8.8 77 10.4 74 Z M26 71.6 Q28.4 72.4 27.6 77 Q25.2 77 23.6 74 Z" fill="#2E2622"/>' },
      extra: '<path d="M12.4 72.6 Q17 70.8 21.6 72.6 M13.4 74.4 Q17 73 20.6 74.4" fill="none" stroke="#9C7A52" stroke-width=".8" stroke-linecap="round"/>',
      muzzle: '<ellipse cx="17" cy="81.6" rx="6" ry="4.4" fill="#3A2E28"/><path d="M14.4 79.6 Q17 78.4 19.6 79.6" fill="none" stroke="#5E4E44" stroke-width=".8"/><ellipse cx="17" cy="80.6" rx="1.7" ry="1.1" fill="#111"/><path d="M15.6 84.4 Q17 86.6 18.4 84.4 Z" fill="#F07A8A"/>' });
  }
  if (p === 'parrot') {
    // Попугай ара на правом плече (слева от зрителя питомцы уже заняты корги и мопсом)
    return `<g transform="translate(0 -1)"><path d="M80 78 Q84 90 82 100 L79 99 Q80 90 77.6 79 Z" fill="#2A7BD5"/><path d="M81 80 Q86 90 86 99 L83.6 99 Q83 90 79 81 Z" fill="#E5484D"/>`
      + `<ellipse cx="79.6" cy="68" rx="6" ry="9.4" fill="#E5484D"/><path d="M74.4 66 Q73 74 77.6 79.4 Q82 76 82.4 68 Q79 70 74.4 66 Z" fill="#F4C430"/><path d="M75 71 Q75.6 77 78.8 80 Q81.2 76.6 81 71.6 Q78 73.4 75 71 Z" fill="#2A7BD5"/>`
      + `<circle cx="79.4" cy="57.6" r="5.4" fill="#E5484D"/><path d="M80.6 54.6 Q85.4 54.4 86.4 57 Q86.6 60.6 83.6 61.6 Q84.4 58.4 81 58 Z" fill="#F7F4EE"/>`
      + `<path d="M84.4 56.6 Q88.6 57.2 88 61 Q87.4 63.4 85 63 Q86.6 60.4 84 59.6 Z" fill="#2B2B33"/><path d="M84 59.8 Q85.6 61.6 84.6 62.4" fill="none" stroke="#111" stroke-width=".5"/>`
      + `<circle cx="82.4" cy="57.2" r="1.2" fill="#111"/><circle cx="82.7" cy="56.9" r=".35" fill="#fff"/>`
      + `<path d="M76.6 77.4 l-.8 2.2 M79 78 l0 2.4 M81.4 77.6 l.8 2.2" stroke="#8A919E" stroke-width="1.1" stroke-linecap="round"/></g>`;
  }
  if (p === 'frenchie') {
    // Французский бульдог: серо-голубой, белая грудка, огромные уши-«летучая мышь»
    const c = '#7D8494', d = '#5B6170', e = '#F2C9C9';
    return `<g transform="translate(4 -5)"><ellipse cx="17" cy="97" rx="11.6" ry="8" fill="${c}"/><path d="M12 92 Q17 102 22 92 Q20 99 17 101 Q14 99 12 92 Z" fill="#F4F4F2"/>`
      + `<path d="M8.6 76 L5 62.6 Q4.6 60.6 6.6 61.4 L14 69 Z" fill="${c}"/><path d="M8.6 74 L6.6 64.4 L12.4 69.6 Z" fill="${e}"/>`
      + `<path d="M25.4 76 L29 62.6 Q29.4 60.6 27.4 61.4 L20 69 Z" fill="${c}"/><path d="M25.4 74 L27.4 64.4 L21.6 69.6 Z" fill="${e}"/>`
      + `<ellipse cx="17" cy="80.4" rx="10" ry="8.6" fill="${c}"/><path d="M13 74.6 Q17 73 21 74.6 M14 76.4 Q17 75.2 20 76.4" fill="none" stroke="${d}" stroke-width=".7"/>`
      + `<ellipse cx="17" cy="84.4" rx="5.6" ry="3.8" fill="${d}"/><path d="M17 74 V80" stroke="#F4F4F2" stroke-width="2" stroke-linecap="round"/>`
      + `<circle cx="12.6" cy="79.6" r="2" fill="#1E1A18"/><circle cx="21.4" cy="79.6" r="2" fill="#1E1A18"/><circle cx="13.1" cy="79" r=".6" fill="#fff"/><circle cx="21.9" cy="79" r=".6" fill="#fff"/>`
      + `<ellipse cx="17" cy="82.4" rx="1.8" ry="1.2" fill="#1E1A18"/><path d="M17 83.6 Q17 85.4 15.4 85.8 M17 83.6 Q17 85.4 18.6 85.8" fill="none" stroke="#1E1A18" stroke-width=".6" stroke-linecap="round"/></g>`;
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
// Змея на шее (Лавка): обвивает шею. Задняя часть кольца рисуется за шеей (до одежды), передние витки — поверх воротника,
// хвост свисает на грудь слева, голова приподнята на правом плече
const SNAKE = { d: '#2F7A3A', m: '#4FB062', b: '#E8D34A' };
function snakeBack() {
  return `<path d="M39 74.5 Q39.5 64.5 50 64 Q60.5 64.5 61 74.5" fill="none" stroke="${SNAKE.d}" stroke-width="5.4" stroke-linecap="round"/>`
    + `<path d="M39 74.5 Q39.5 64.5 50 64 Q60.5 64.5 61 74.5" fill="none" stroke="${shade(SNAKE.m, -0.12)}" stroke-width="3.8" stroke-linecap="round"/>`;
}
function snakeLayer() {
  const body = (d, w = 5.4) => `<path d="${d}" fill="none" stroke="${SNAKE.d}" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${SNAKE.m}" stroke-width="${w - 1.6}" stroke-linecap="round"/>`;
  // Два витка вокруг основания шеи; хвост уходит за правое плечо, голова приподнята над левым
  return body('M61 74.5 Q66 76 66 79 Q65 84 50 84.6 Q35 84 34.6 79 Q35 75.6 39 74.5', 5)
    + body('M39 74.5 Q38 81 50 81.5 Q62 81 61 74.5')
    + body('M66 79 Q70.6 78.4 73 75.6', 4.2)
    + body('M34.6 79 Q31 78.6 30 75', 4.6)
    + `<path d="M43 80.4 l1.6 .8 M48.4 81.5 h1.8 M54 81.2 l1.6 -.5 M40 83.2 l1.5 .5 M50 84.4 h1.8 M58.6 83.6 l1.5 -.5" stroke="${SNAKE.b}" stroke-width="1" stroke-linecap="round"/>`
    + `<g transform="rotate(-62 30 74)"><ellipse cx="28" cy="73.6" rx="4.6" ry="3.3" fill="${SNAKE.m}" stroke="${SNAKE.d}" stroke-width=".9"/>`
    + `<circle cx="26.8" cy="72.4" r=".95" fill="#111"/><circle cx="26.5" cy="72.1" r=".3" fill="#fff"/>`
    + `<path d="M23.6 74.2 L21 74.8 M21 74.8 L19.8 74 M21 74.8 L20 76" stroke="#E5484D" stroke-width=".7" stroke-linecap="round"/></g>`;
}
// Предметы в руке. Рука — левая у персонажа (справа на картинке): рукав снизу, кулак обхватывает предмет
function fist(x, y, skin, w = 9, h = 10) {
  const e = shade(skin, -0.22);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3.6" fill="${skin}" stroke="${e}" stroke-width=".7"/>`
    + `<path d="M${x + 1.2} ${y + h * 0.36} h${w * 0.55} M${x + 1.2} ${y + h * 0.64} h${w * 0.55}" stroke="${e}" stroke-width=".7" stroke-linecap="round"/>`;
}
// Кружка: пальцы продеты в ручку, большой палец сверху на ручке
function mugHand(gold, skin, sleeve) {
  const c = gold ? '#F4C430' : '#fff', e = gold ? '#C99A0E' : '#C9CED9', sk = shade(skin, -0.22);
  return `<g transform="translate(-4 -7)">` + `<path d="M93 114 Q91 104 87.6 98" fill="none" stroke="${sleeve}" stroke-width="10" stroke-linecap="round"/>`
    + `<path d="M66 79 Q63 75 66 71 M71 79 Q68 75 71 71" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.3" stroke-linecap="round"/>`
    + `<rect x="61" y="81" width="15" height="17" rx="2.5" fill="${c}" stroke="${e}" stroke-width="1"/><ellipse cx="68.5" cy="82" rx="6.6" ry="1.7" fill="#6B3E26"/>`
    + (gold ? '<path d="M68.5 85.5 L69.8 88.3 L72.8 88.6 L70.6 90.6 L71.2 93.6 L68.5 92.1 L65.8 93.6 L66.4 90.6 L64.2 88.6 L67.2 88.3 Z" fill="#fff"/>' : '<path d="M65 88 h7 M65 91 h5" stroke="#E5484D" stroke-width="1.2" stroke-linecap="round"/>')
    + `<path d="M76 84.6 Q82.6 84.6 82.2 89.6 Q81.8 94.4 76 94" fill="none" stroke="${e}" stroke-width="2.4"/>`
    + fist(79.4, 86.2, skin, 9, 10.4)
    + `<path d="M80.4 86.6 Q81.6 83.6 85.4 84.4" fill="none" stroke="${sk}" stroke-width="3.6" stroke-linecap="round"/><path d="M80.4 86.6 Q81.6 83.6 85.4 84.4" fill="none" stroke="${skin}" stroke-width="2.4" stroke-linecap="round"/>` + '</g>';
}
// Факел: деревянная рукоять, промасленная обмотка и живое пламя
function torchHand(skin, sleeve) {
  return `<g transform="translate(-4 -6)">` + `<path d="M93 114 Q91 104 87 98" fill="none" stroke="${sleeve}" stroke-width="10" stroke-linecap="round"/>`
    + `<path d="M84 106 L80.4 76" stroke="#7A4A22" stroke-width="4.4" stroke-linecap="round"/><path d="M83.4 101 L80.6 78" stroke="#A86B3A" stroke-width="1.2" stroke-linecap="round"/>`
    + `<path d="M77.2 78.6 L84 77.6 L83 72.4 L77.6 73.2 Z" fill="#5E3818"/><path d="M77.4 76 L83.6 75.2" stroke="#3A2210" stroke-width=".8"/>`
    + `<path d="M80 73.6 Q72.6 68 76 60 Q77 64.6 79.2 64.4 Q77.6 56.6 82.4 50 Q83.4 57.6 86.6 60.4 Q89.4 66.6 85.4 72 Q83 74.4 80 73.6 Z" fill="#FF7A1A"/>`
    + `<path d="M80.4 72.6 Q76.6 68.6 79 64 Q80 66.8 81.4 66.4 Q80.8 61 83.4 57.4 Q84.4 62.4 86 64.6 Q87 69.4 84.2 72 Q82.4 73.4 80.4 72.6 Z" fill="#FFC93C"/>`
    + `<path d="M81.6 71.6 Q80.2 69 81.8 66.6 Q82.6 68.4 83.6 68 Q84.6 70.6 83.2 71.8 Z" fill="#FFF3C4"/>`
    + fist(77.6, 88, skin, 9.6, 10) + '</g>';
}
// Букет мимозы: стебли в кулаке, пушистые жёлтые шарики и перистые листья
function mimosaHand(skin, sleeve) {
  const balls = [[72, 64], [76, 61], [80, 64], [74, 68.4], [78.4, 67.6], [70, 70], [82, 69], [76, 72], [68.6, 65.6], [83.4, 63.6], [79.6, 58.6], [73, 59.4]];
  return `<g transform="translate(-4 -6)"><path d="M93 114 Q91 104 87 98" fill="none" stroke="${sleeve}" stroke-width="10" stroke-linecap="round"/>`
    + `<path d="M81 100 L76 70 M82 100 L80 68 M83 100 L84 70" stroke="#5E8C3A" stroke-width="1.2"/>`
    + `<path d="M70 74 Q74 70 78 74 M80 74 Q84 70 88 74 M68 70 Q72 67 75 71" fill="none" stroke="#6FA34A" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1.2 .6"/>`
    + balls.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#FFD600"/><circle cx="${x - 0.7}" cy="${y - 0.7}" r=".9" fill="#FFF3A0"/>`).join('')
    + fist(77.6, 90, skin, 9.4, 10) + '</g>';
}
// Стопка блинов на тарелке: держит снизу ладонью
function pancakesHand(skin, sleeve) {
  const e = shade(skin, -0.22);
  return `<g transform="translate(-4 -8)"><path d="M93 114 Q90 106 84 100" fill="none" stroke="${sleeve}" stroke-width="10" stroke-linecap="round"/>`
    + `<path d="M64 96 Q76 100.6 88 96 Q86 99.6 76 100.4 Q66 99.6 64 96 Z" fill="${skin}" stroke="${e}" stroke-width=".7"/>`
    + `<ellipse cx="76" cy="94" rx="13" ry="3" fill="#F2F4F8" stroke="#C9CED9" stroke-width=".7"/>`
    + [91.6, 89.4, 87.2, 85, 82.8].map((y, i) => `<ellipse cx="76" cy="${y}" rx="${11 - i * 0.4}" ry="2.4" fill="${i % 2 ? '#E9A23B' : '#F4BC5C'}" stroke="#C47F1E" stroke-width=".5"/>`).join('')
    + `<path d="M72 81.6 Q76 79.6 80 81.6 Q78 83.2 76 82.6 Q74 83.2 72 81.6 Z" fill="#FFE27A"/><path d="M68 84 Q70 86.4 69 88" fill="none" stroke="#FFE27A" stroke-width="1.2" stroke-linecap="round"/>`
    + `<path d="M70 79 Q68 75 71 71 M76 78 Q74 74 77 70 M82 79 Q80 75 83 71" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.1" stroke-linecap="round"/></g>`;
}
// Телефон: держит перед грудью экраном к зрителю, большой палец сбоку
function phoneHand(skin, sleeve) {
  const e = shade(skin, -0.22);
  return `<g transform="translate(-3 -8)">` + `<path d="M86 114 Q82 106 75 101" fill="none" stroke="${sleeve}" stroke-width="10" stroke-linecap="round"/>`
    + `<path d="M58.6 96 Q59 105 66.6 105.4 Q74.4 105 75 96 Z" fill="${skin}" stroke="${e}" stroke-width=".7"/>`
    + `<rect x="59.6" y="77" width="14" height="23" rx="2.6" fill="#1E2433"/><rect x="60.9" y="79.4" width="11.4" height="18" rx="1.2" fill="#2E5BD0"/>`
    + `<rect x="62.2" y="81" width="8.8" height="3" rx="1" fill="#fff" opacity=".85"/><rect x="62.2" y="85.6" width="6" height="2" rx="1" fill="#fff" opacity=".55"/><rect x="62.2" y="89" width="7.4" height="2" rx="1" fill="#fff" opacity=".55"/>`
    + `<circle cx="66.6" cy="78.2" r=".5" fill="#555"/>`
    + `<rect x="56.8" y="86" width="4.4" height="8.4" rx="2.2" fill="${skin}" stroke="${e}" stroke-width=".7" transform="rotate(-14 59 90)"/>`
    + [86.4, 90, 93.6].map((y) => `<rect x="72.2" y="${y}" width="4.2" height="3.2" rx="1.6" fill="${skin}" stroke="${e}" stroke-width=".7"/>`).join('') + '</g>';
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
  const hat = look.hat && look.hat !== 'none' && look.hat !== 'hood' ? look.hat : null;
  const mk = sex === 'f' ? (MAKEUP[look.makeup] || MAKEUP.none) : MAKEUP.none;
  const es = (EYE_SCALE[look.eyeSize] || 1) * (sex === 'f' ? 1.08 : 1);
  const ek = (EAR_SCALE[look.ears] || 1) * (sex === 'f' ? 0.9 : 1);
  const shape = look.eyeShape === 'happy' ? 'normal' : look.eyeShape;
  // Ж — верхнее веко с ресницами и тонкие брови дугой; М — густые прямые брови
  const lash = sex === 'f' && !['normal', 'almond', 'narrow', 'hooded', 'down', 'up'].includes(shape || 'normal') ? '<path d="M38.8 47.4 Q43 42.9 47.2 46.8 M61.2 47.4 Q57 42.9 52.8 46.8" fill="none" stroke="#1A1A22" stroke-width="1.5" stroke-linecap="round"/><path d="M38.9 47.2 Q37.6 46.6 37 45.4 M61.1 47.2 Q62.4 46.6 63 45.4" fill="none" stroke="#1A1A22" stroke-width="1.2" stroke-linecap="round"/>' : '';
  const liner = mk.liner ? '<path d="M38.8 47.6 L36 46 M61.2 47.6 L64 46" stroke="#1A1A22" stroke-width="1.5" stroke-linecap="round"/>' : '';
  const shadow = mk.shadow ? `<ellipse cx="43" cy="45.4" rx="5.4" ry="3.2" fill="${mk.shadow}" opacity="${mk.shadowOp}"/><ellipse cx="57" cy="45.4" rx="5.4" ry="3.2" fill="${mk.shadow}" opacity="${mk.shadowOp}"/>` : '';
  const browY = shape === 'tired' ? 1.2 : shape === 'wide' ? -1.4 : 0;
  const gapK = EYE_GAP[look.eyeGap] || 0;
  const lashOn = look.lashes !== undefined ? !!look.lashes : sex === 'f';
  const browC = look.browColor && look.browColor !== 'same' ? shade(look.browColor, -0.1) : brow;
  const brows = browsLayer(look.browShape, sex, browC, browY, gapK * 0.6);
  const jaw = '';
  const blushOp = mk.blush || (sex === 'f' ? 0.26 : 0.14);
  const lip = mk.lip || (sex === 'f' ? '#C9707C' : shade(skin, -0.28));
  const line = sex === 'f' ? shade(lip, -0.4) : shade(skin, -0.55);
  const freckles = look.freckles ? [[39.5, 52.5], [42, 54], [38.8, 55], [60.5, 52.5], [58, 54], [61.2, 55]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".85" fill="${shade(skin, -0.38)}"/>`).join('') : '';
  const capped = hat && !['headset', 'laurel', 'royal', 'kokoshnik', 'wreath'].includes(hat);
  const hatC = look.hatColor && look.hatColor !== 'same' && HOODIE[look.hatColor] ? HOODIE[look.hatColor] : hood;
  // Под шапкой высокие причёски (пучки, ирокез, кок) прячутся, длинные торчат прядями
  const hairBack = HAIR_BACK[hs] && !(capped && HAIR_TALL.includes(hs) && hs !== 'ponytail') ? HAIR_BACK[hs](hair) : '';
  const hairFront = capped ? (HAIR_LONG.includes(hs) || sex === 'f' ? locks(hair, HAIR_LONG.includes(hs) ? 62 : 52, 3.4) : '') : HAIR_FRONT[hs](hair);
  const exL = 50 - rx - 0.5, exR = 50 + rx + 0.5;
  const ears = `<ellipse cx="${exL}" cy="49" rx="${3.6 * ek}" ry="${5 * ek}" fill="${skin}"/><ellipse cx="${exR}" cy="49" rx="${3.6 * ek}" ry="${5 * ek}" fill="${skin}"/>
    <ellipse cx="${exL + 0.2}" cy="49.3" rx="${1.6 * ek}" ry="${2.8 * ek}" fill="${skinDark}"/><ellipse cx="${exR - 0.2}" cy="49.3" rx="${1.6 * ek}" ry="${2.8 * ek}" fill="${skinDark}"/>`;
  const mug = look.prop === 'mug' || look.prop === 'mug_best';
  // Правила наложения: шлем закрывает всё лицо (очки, маска, борода, серьги, пряди не видны);
  // маска аквалангиста и кибервизор закрывают глаза — очки под ними прячутся; капюшон закрывает уши — серьги не видны
  const helmet = hat === 'knight';
  const brimY = { cap: 39, fedora: 36, beanie: 40, tricorn: 40, ushanka: 40, dedmoroz: 40, shawl: 100 }[hat];
  // Линия роста волос: залысины, высокий лоб, «М» — вырезаем из передних прядей. Пробор справа — зеркалим причёску
  const mir = (svg) => (look.part === 'right' && svg ? `<g transform="translate(100 0) scale(-1 1)">${svg}</g>` : svg);
  // Залысины и высокий лоб: поверх передних прядей кладём кожу, обрезанную по контуру головы, и мягкую линию роста
  const HL = { high: [[50, 33.8, 12.6, 3.4]], receding: [[38.6, 33.4, 4.6, 4.8], [61.4, 33.4, 4.6, 4.8]], m: [[38.8, 31.4, 6.2, 6.6], [61.2, 31.4, 6.2, 6.6], [50, 35.6, 6.4, 1.6]] }[look.hairline];
  const hlLayer = HL && hairFront && !capped && HAIRLINE_OK.includes(hs) ? `<clipPath id="hc${u}"><path d="${g.d}"/></clipPath><g clip-path="url(#hc${u})">${HL.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${skin}"/>`).join('')}</g>` : '';
  const hairFrontC = mir(fit(hairFront)) + hlLayer;
  const hairBackC = brimY && hairBack ? `<clipPath id="hb${u}"><rect x="0" y="${brimY}" width="100" height="100"/></clipPath><g clip-path="url(#hb${u})">${mir(fit(hairBack))}</g>` : mir(fit(hairBack));
  const eyesCovered = helmet || look.mask === 'scuba' || look.mask === 'visor';
  const earsCovered = helmet || hat === 'ushanka' || hat === 'shawl';
  const showGlasses = look.glasses && !eyesCovered;
  const beardL = helmet ? { under: '', over: '' } : beard;
  return `${bgLayer(look.bg, skin, u)}${hairBackC}
    ${look.neck === 'snake' ? snakeBack() : ''}
    ${outfitLayer(look.outfit, hood, skin, sex)}
    ${look.neck === 'snake' && ['corgi', 'pug', 'frenchie'].includes(look.pet) && !mug ? `<g transform="translate(100 0) scale(-1 1)">${snakeLayer()}</g>` : neckLayer(look.neck)}
    ${ears}
    <path d="${g.d}" fill="${skin}"/>
    ${jaw}
    <ellipse cx="38" cy="54.6" rx="3.6" ry="2.6" fill="#FF7A8A" opacity="${blushOp}"/><ellipse cx="62" cy="54.6" rx="3.6" ry="2.6" fill="#FF7A8A" opacity="${blushOp}"/>
    ${freckles}${ageLayer(look.age, skin, gapK)}${marksLayer(look.mole, look.dimples, skin)}
    <g transform="translate(50 48) scale(${es.toFixed(3)}) translate(-50 -48)">${shadow}${eyesLayer(shape, eyes, skin, gapK, lashOn, u)}${lash}${liner}</g>
    ${brows}
    ${noseLayer(look.nose, skin, sex)}
    ${beardL.under}
    <g transform="translate(0 1.4)"><g transform="translate(50 57.6) scale(${{ thin: '0.97 0.72', full: '1.06 1.3' }[look.lips] || '1 1'}) translate(-50 -57.6)">${(MOUTHS[look.mouth] || MOUTHS.smile)(lip, line)}</g></g>${beardL.over}
    ${helmet ? '' : maskLayer(look.mask, g)}
    ${earsCovered ? '' : earringsLayer(look.earrings, exL, exR, 49 + 5 * ek - 0.8)}
    ${helmet ? '' : hairFrontC}
    ${showGlasses && capped ? glassesLayer(look.glassesStyle, look.glassesColor, look.lensColor, u, rx) : ''}
    ${capped ? fit(hatLayer(hat, hatC, sex, look.capBadge)) : ''}
    ${showGlasses && !capped ? glassesLayer(look.glassesStyle, look.glassesColor, look.lensColor, u, rx) : ''}
    ${hat === 'headset' || hat === 'laurel' || hat === 'royal' || hat === 'kokoshnik' || hat === 'wreath' ? fit(hatLayer(hat, hood)) : ''}
    ${look.phones && hat !== 'headset' && hat !== 'ushanka' && !helmet ? fit('<path d="M29 47 Q27 15 50 15 Q73 15 71 47" fill="none" stroke="#2B2B3A" stroke-width="6" stroke-linecap="round"/><path d="M33 26 Q40 18 50 17.5" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/><rect x="23" y="42" width="10" height="16" rx="4" fill="#2B2B3A"/><rect x="67" y="42" width="10" height="16" rx="4" fill="#2B2B3A"/><rect x="25" y="45" width="3" height="10" rx="1.5" fill="#E5484D"/><rect x="72" y="45" width="3" height="10" rx="1.5" fill="#E5484D"/>') : ''}
    ${look.crown && !helmet && hat !== 'royal' ? `<g ${capped ? 'transform="translate(50 5) scale(.78) translate(-50 0)"' : ''}><path d="M33 19 L37 5 L44 13 L50 3 L56 13 L63 5 L67 19 Z" fill="#FFC93C" stroke="#D99A0B" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="13" r="2" fill="#E5484D"/></g>` : ''}
    ${(() => { const sl = look.outfit === 'telnyashka' ? '#F7F8FB' : look.outfit === 'nysweater' ? '#C62828' : look.outfit === 'suit' ? shade(hood, -0.45) : look.outfit === 'shirt' ? shade(hood, 0.8) : look.outfit === 'dev' ? '#262B36' : look.outfit === 'vampire' ? '#15131A' : look.outfit === 'armor' ? '#B9C3D1' : look.outfit === 'biker' ? '#1B1C22' : look.outfit === 'cyber' ? '#13131C' : hood;
      return mug ? mugHand(look.prop === 'mug_best', skin, sl) : look.prop === 'torch' ? torchHand(skin, sl) : look.prop === 'phone' ? phoneHand(skin, sl) : look.prop === 'mimosa' ? mimosaHand(skin, sl) : look.prop === 'pancakes' ? pancakesHand(skin, sl) : propLayer(look.prop, sex); })()}
    ${look.pet === 'parrot' && look.prop && look.prop !== 'none' ? `<g transform="translate(100 0) scale(-1 1)">${petLayer('parrot')}</g>` : petLayer(look.pet)}${prankLayer(look.prank)}`;
}

// Подлянка от подельника: на час поверх аватара (кофе на одежде, стикер на лбу, наушники)
function prankLayer(pr) {
  if (!pr || !pr.until || pr.until < Date.now()) return '';
  if (pr.v === 'coffee') {
    return `<g><path d="M40 80 Q44 74 50 78 Q57 73 61 80 Q66 84 60 90 Q56 96 49 92 Q41 96 38 89 Q35 84 40 80 Z" fill="#9A6234" fill-opacity=".8"/>
      <path d="M44 91 q-.6 5 .8 7 M55 92 q.6 4 -.4 6" fill="none" stroke="#9A6234" stroke-opacity=".8" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="47" cy="81" rx="3" ry="1.4" fill="#A86B3C" opacity=".8"/>
      <g transform="rotate(-38 76 74)"><rect x="70" y="68" width="12" height="13" rx="2" fill="#fff" stroke="#C9CED9"/><path d="M82 71 q4 0 4 3.6 q0 3.4 -4 3.4" fill="none" stroke="#C9CED9" stroke-width="1.6"/></g></g>`;
  }
  if (pr.v === 'sticker') {
    return `<g transform="rotate(-8 50 26)"><rect x="34" y="13" width="32" height="23" rx="1.2" fill="#FFE45C" stroke="#E0B400" stroke-width=".6"/><path d="M34 13 h32 v3.6 h-32 Z" fill="#F4C430"/>
      <text x="50" y="25" text-anchor="middle" font-size="7" font-weight="900" fill="#5B3B00" font-family="system-ui,sans-serif">Я ♥</text><text x="50" y="32" text-anchor="middle" font-size="5.6" font-weight="900" fill="#5B3B00" font-family="system-ui,sans-serif" textLength="28" lengthAdjust="spacingAndGlyphs">ПОНЕДЕЛЬНИКИ</text></g>`;
  }
  if (pr.v === 'phones') {
    return `<g><path d="M26 46 Q24 10 50 10 Q76 10 74 46" fill="none" stroke="#FF3D8B" stroke-width="7" stroke-linecap="round"/><rect x="18" y="38" width="14" height="20" rx="6" fill="#FF3D8B"/><rect x="68" y="38" width="14" height="20" rx="6" fill="#FF3D8B"/>
      <rect x="21" y="42" width="5" height="12" rx="2.5" fill="#1B1C22"/><rect x="74" y="42" width="5" height="12" rx="2.5" fill="#1B1C22"/>
      <text x="6" y="34" font-size="11" fill="#7C3AED" font-weight="900">♪</text><text x="84" y="28" font-size="12" fill="#E5484D" font-weight="900">♫</text><text x="88" y="46" font-size="8" fill="#2563EB" font-weight="900">♪</text></g>`;
  }
  return '';
}

// Ник с эффектом из Лавки (золотой, радужный, глитч) — пока аренда не кончилась. Без эффекта — обычный текст
const NFX = ['gold', 'rainbow', 'glitch'];
function nk(o) {
  const t = esc((o && o.nick) || '');
  const fx = o && o.look && o.look.nfx;
  return fx && NFX.includes(fx.v) && fx.until > Date.now() ? `<span class="nfx nfx-${fx.v}" data-t="${t}">${t}</span>` : t;
}
// Из дуэлей оставлен морской бой; камень-ножницы-бумага, кости и крестики-нолики скрыты (идущие партии можно доиграть)
const DUEL_GAMES = ['sea'];
// Объёмный аватар: картинку собирает сервер из слоёв (/api/ava), адрес — сам образ, поэтому браузер держит её в кэше.
// В адрес идут только те поля образа, от которых зависит картинка: рамка, эффект ника, розыгрыш её не меняют.
const AVA3D = true;
const AVA_KEYS = ['preset', 'skin', 'hair', 'hairStyle', 'hoodie', 'outfit', 'eyes', 'eyeShape', 'mouth', 'beard', 'browShape', 'browColor', 'beardColor', 'mustacheColor', 'nose', 'glasses', 'glassesStyle', 'glassesColor',
  'hat', 'hatColor', 'crown', 'phones', 'mask', 'neck', 'earrings', 'prop', 'pet', 'freckles', 'age', 'mole', 'makeup', 'lensColor', 'eyeGap', 'eyeSize', 'lips', 'part'];
const avaCodes = new Map();
function avaCode(look) {
  const o = {};
  for (const k of AVA_KEYS) { const v = look[k]; if (v != null && v !== false && v !== '' && v !== 'none' && v !== 'same' && v !== 'auto' && v !== 'normal' && v !== 'clear' && v !== 'left' && v !== 'm' && v !== '0' && typeof v !== 'object') o[k] = v; }
  const json = JSON.stringify(o);
  let c = avaCodes.get(json);
  if (!c) { c = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); if (avaCodes.size > 2000) avaCodes.clear(); avaCodes.set(json, c); }
  return c;
}
// Размер картинки — под экран: в списках хватает 96 px, крупные планы и профиль берут 192 или 400
// AVA_V — версия картинок: аватары кэшируются на месяц, после замены слоёв на сервере число поднимаем
const AVA_V = 2;
const avaSrc = (look, px = 192) => `/api/ava/${avaCode(look)}.png?s=${px <= 96 ? 96 : px <= 192 ? 192 : 400}&v=${AVA_V}`;
const BG_SCENES = ['office', 'meeting', 'home', 'street', 'cafe'];
function avaBg(look) {
  if (BG_SCENES.includes(look.bg)) return `background:#DCE6F5 url(/art/bg_${look.bg}.webp) center/cover`;
  const [a, b] = BG_GRAD[look.bg] || (skinIsLight(look.skin) ? ['#DCEBFF', '#9FC2F2'] : ['#FFF1CF', '#F7C873']);
  return `background:radial-gradient(circle at 50% 30%,${a},${b})`;
}
// Крупные планы конструктора: центр и доля кадра (глаза, рот, верх головы)
const AVA_ZOOM = { eyes: [0.5, 0.425, 0.5], mouth: [0.5, 0.635, 0.46], top: [0.5, 0.43, 0.86], true: [0.5, 0.52, 0.84] };
function avatar(look = {}, size = 42, zoom = false) {
  if (!AVA3D) return avatarFlat(look, size, zoom);
  const ring = FRAMES[look.frame] || '#FFFFFF';
  const [zx, zy, zs] = AVA_ZOOM[zoom] || [0.5, 0.5, 1];
  const k = 100 / zs;
  const px = Math.round((size / zs) * Math.min(3, window.devicePixelRatio || 1));
  // Розыгрыш (кофе, стикер, наушники) рисуется поверх прежними координатами — пересчитываем их в новый кадр
  const pr = look.prank && look.prank.until > Date.now() ? `<svg viewBox="18.8 20 62.4 62.4" aria-hidden="true">${prankLayer(look.prank)}</svg>` : '';
  return `<span class="ava ava3 ${look.frame === 'fr_champ' ? 'champ' : ''}" style="width:${size + 6}px;height:${size + 6}px;border:3px solid ${ring};${avaBg(look)}"><span class="ava-in" style="left:${(-(zx - zs / 2) * k).toFixed(1)}%;top:${(-(zy - zs / 2) * k).toFixed(1)}%;width:${k.toFixed(1)}%;height:${k.toFixed(1)}%"><img src="${avaSrc(look, px)}" alt="" decoding="sync" draggable="false">${pr}</span></span>`;
}
function avatarFlat(look = {}, size = 42, zoom = false) {
  const ring = FRAMES[look.frame] || '#FFFFFF';
  return `<span class="ava ${look.frame === 'fr_champ' ? 'champ' : ''}" style="width:${size + 6}px;height:${size + 6}px;border:3px solid ${ring}">
  <svg width="${size}" height="${size}" viewBox="${{ eyes: '34.5 31 31 31', mouth: '36 45 28 28', hair: '14 6 72 72', top: '22 16 56 56' }[zoom] || (zoom ? '24 28 52 52' : '0 0 100 100')}" aria-hidden="true">${avatarInner(look)}</svg></span>`;
}

// Объёмные картинки («пластилин»): готовые webp с прозрачным фоном, одинаково смотрятся в светлой и тёмной теме
const art = (name, size = 40) => `<img class="art" src="/art/${name}.webp" width="${size}" height="${size}" alt="" loading="lazy" decoding="async">`;

// Нажатие на аватар открывает карточку коллеги
const tap = (id, html) => `<button class="ava-btn" data-act="person" data-id="${id}" aria-label="Открыть профиль">${html}</button>`;
const BEAN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="6" ry="9" transform="rotate(30 12 12)"/><path d="M9 6c3 3 3 9 6 12"/></svg>';
const FLAME = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#FF8A3D" aria-hidden="true"><path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5.2.2 1.7 1 2.7 2 3.2C11 8.5 11 5.5 12 2z"/></svg>';
const ICONS = {
  focus: 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  rain: 'M16 13v6M8 13v6M12 15v6M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3',
  snow: 'M20 17.6A5 5 0 0 0 18 8h-1.3A8 8 0 1 0 4 16.3M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01',
  wind: 'M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2',
  gift: 'M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8C10.5 4.5 7 4 7 6.2S10 8 12 8zm0 0c1.5-3.5 5-4 5-1.8S14 8 12 8z',
  tree: 'M12 2l5 7h-3l4 6h-4l3 5H7l3-5H6l4-6H7zM12 20v2',
  coffee: 'M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3',
  lunch: 'M4 3v8a3 3 0 0 0 3 3v7M7 3v6M10 3v8a3 3 0 0 1-3 3M17 21V3c-2 1-3 4-3 8h3',
  where: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  food: 'M12 7c-4-2-8 1-7 6 1 4 3 8 7 7 4 1 6-3 7-7 1-5-3-8-7-6zM12 7c0-2 1-4 3-4',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  room: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M17 11a2.5 2.5 0 1 0 0-5M17 14.5a5 5 0 0 1 4.5 5',
  home: 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5',
  call: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  online: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a14 14 0 0 1 20 0M12 19.5h.01',
  wait: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  mic: 'M9 3h6v11H9zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v3M8 21h8M9.5 21l.5-4h4l.5 4',
  swords: 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2',
  dice: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
  anchor: 'M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 8v13M5 12H2a10 10 0 0 0 20 0h-3M8 11h8',
  thumbUp: 'M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18 21H7',
  thumbDown: 'M17 14V3h4v11zM17 14l-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 6 3h11',
  chat: 'M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.4 8.4 0 1 1 21 11.5z',
  game: 'M8 7h8a5.5 5.5 0 0 1 0 11H8A5.5 5.5 0 0 1 8 7zM7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 11.5V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L3.5 15a1.6 1.6 0 0 1 2.7-1.7L8 15',
  bank: 'M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z',
  x: 'M6 6l12 12M18 6 6 18',
  vote: 'M4 11h16v9H4zM8 11V5h8v6M10 8l1.5 1.5L14 7',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5zM5 19h14',
  office: 'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 3v4M17 5h4',
  thermo: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  party: 'M4 20l5-14 9 9zM14 4a3 3 0 0 0 3 3M19 9h2M17 2v2M21 5l-1.5 1',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  cake: 'M4 21v-9h16v9M4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1.2 4 .5M12 12V8M12 5.5a1 1 0 0 0 1-1c0-1-1-2.5-1-2.5s-1 1.5-1 2.5a1 1 0 0 0 1 1M3 21h18',
  mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
  cal: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  chart: 'M5 20V11M11 20V5M17 20v-6M3 20h18',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  medal: 'M8 3h8l-2 6h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 13v4',
  megaphone: 'M3 11v3l11 5V6zM14 8a5 5 0 0 1 0 8M6.5 15.5 8 21h3l-1.2-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9.5c0-1.4-1.3-2-3-2s-3 .6-3 2 1.3 2 3 2.5 3 1 3 2.5-1.3 2-3 2-3-.6-3-2M12 6v1.5M12 16.5V18',
  flame: 'M12 22c4 0 7-2.7 7-6.8 0-3.2-2-5.4-3.4-7-.5 1.7-1.6 2.8-2.6 3.3.3-3.4-1.4-6.6-4.5-8.5.3 3-1.3 5-2.8 6.8C4.7 11.2 5 13 5 15.2 5 19.3 8 22 12 22z',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  cart: 'M3 4h2l2.5 11h10L20 7H6.5M9 19.5h.01M16.5 19.5h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3c.5.6.3 1.7-.5 2.2-.6.3-1.3.5-2 .5zM7.5 11h.01M10 7.5h.01M15 7.5h.01',
  rock: 'M7 10.5V8a1.75 1.75 0 0 1 3.5 0v2.5M10.5 9V7.25a1.75 1.75 0 0 1 3.5 0V9M14 9.5V8a1.75 1.75 0 0 1 3.5 0v3M17.5 11a1.75 1.75 0 0 1 3.5 0v3.5a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7V12a2 2 0 0 1 2-2h4.5a2 2 0 0 1 0 4H9',
  paper: 'M7.5 12.5V5.5a1.5 1.5 0 0 1 3 0v6M10.5 11V3.5a1.5 1.5 0 0 1 3 0V11M13.5 11V4.5a1.5 1.5 0 0 1 3 0V12M16.5 12V7.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4l-2.6-4.4a1.6 1.6 0 0 1 2.7-1.7l1.4 1.9',
  scissors: 'M9.5 12.5 6.2 4.2a1.6 1.6 0 0 1 3-1.1l3.3 8.4M12.5 11.5l1.3-8a1.6 1.6 0 0 1 3.2.5l-1.2 8.5M15.8 12.5a1.6 1.6 0 0 1 3.2 0v2.5a6.5 6.5 0 0 1-6.5 6.5h-1a6.5 6.5 0 0 1-6.3-4.9l-.6-2.4a1.8 1.8 0 0 1 3.4-1.1l1 2.4M9.5 15c1.6-1.2 3.8-1.3 5.6-.2',
  glasses: 'M6.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 12.5h4M3 12.5 2 10M21 12.5l1-2.5',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  grid: 'M4 9h16M4 15h16M9 4v16M15 4v16'
};
const ico = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
// Эмодзи в интерфейсе заменены монохромными иконками: в коде они записаны токеном \uE000имя\uE001,
// при отрисовке токен превращается в линейную иконку под цвет текста (в атрибутах — просто выкидывается)
// Мягкие переносы для подписей плиток: длинные слова делятся по слогам (В|СВ, ВС|СВ, Й|С), чтобы не вылезать за плитку
const HV = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ', HJ = 'йьъЙЬЪ';
const hyWord = (w) => { const v = (c) => !!c && HV.includes(c); const lt = (c) => !!c && /[А-Яа-яЁё]/.test(c); let o = '';
  for (let i = 0; i < w.length; i++) { o += w[i]; if (i < 1 || w.length - i - 1 < 3) continue;
    const a = w[i], b = w[i + 1], c = w[i + 2], p = w[i - 1];
    const brk = (v(a) && lt(b) && !v(b) && !HJ.includes(b) && v(c))
      || (!v(a) && !HJ.includes(a) && v(p) && lt(b) && !v(b) && !HJ.includes(b) && v(c))
      || (HJ.includes(a) && lt(b) && !v(b));
    if (brk) o += '\u00AD'; }
  return o; };
const hy = (t) => String(t).replace(/[А-Яа-яЁё]{8,}/g, hyWord);
const ICON_TOKEN = /\uE000(\w+)\uE001/g;
// Род: в текстах интерфейса токен \uE002мужская|женская\uE003 — разворачивается по полу из профиля при отрисовке и в тостах
const genderize = (s) => String(s).replace(/\uE002([^|\uE003]*)\|([^\uE003]*)\uE003/g, (_, m, f) => meG(m, f));
const iconize = (html) => genderize(html).replace(/(<[^>]*>)|\uE000(\w+)\uE001/g, (m, tag, n) => tag ? tag.replace(/\uE000\w+\uE001\s?/g, '') : ICONS[n] ? `<svg class="ei ei-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n]}"/></svg>` : '');
const plain = (t) => genderize(String(t ?? '')).replace(/\uE000\w+\uE001\s?/g, '').trim();
const OFFICE_BG = { smol: '#E5484D', mark: '#3A86FF', vor: '#F4A72C' };
const CALL_STYLE = {
  coffee: '#8B5A2B', lunch: '#1F7A3A', room: '#2563C9', home: '#6D3FD6', call: '#F97316', where: '#0E7490', online: '#BE185D', wait: '#4B5563'
};
const themePref = () => store.get('theme', 'auto');
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };

// ---------- Платформа ----------
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Samsung Internet, Яндекс Браузер, MIUI и Huawei ставят сайт как собственный APK под старый Android —
// Play Защита блокирует его как «подозрительное приложение». Устанавливать нужно из Chrome: он делает WebAPK, подписанный Google
const wrapBrowser = () => { const ua = navigator.userAgent; if (!/android/i.test(ua)) return null;
  return /SamsungBrowser/i.test(ua) ? 'Samsung Internet' : /YaBrowser|YaApp|YaSearchBrowser/i.test(ua) ? 'Яндекс Браузер' : /MiuiBrowser|XiaoMi/i.test(ua) ? 'браузер Xiaomi' : /HuaweiBrowser/i.test(ua) ? 'браузер Huawei' : null; };
const chromeIntent = () => `intent://${location.host}/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=com.android.chrome')};end`;
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
  S.me = r.user; S.cat = r.catalog; S.vapidKey = r.vapidKey;
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
  await Promise.all([loadPolls(), loadGEvents(), loadCV(), loadWars(), loadSanta(), loadFriday(), loadWave()]);
}
function boardSync() {
  const d = S.boardDraft; if (!d) return;
  const t = $('#bd-text'), u = $('#bd-until'), pl = $('#bd-place');
  if (t) d.text = t.value; if (u) d.until = u.value; if (pl) d.place = pl.value;
}
function gevSync() {
  const d = S.gevDraft; if (!d) return;
  const v = (id) => { const e = $(id); return e ? e.value : undefined; };
  for (const [k, id] of [['title', '#gev-title'], ['day', '#gev-day'], ['time', '#gev-time'], ['place', '#gev-place'], ['note', '#gev-note'], ['guest', '#gev-guest']]) { const x = v(id); if (x !== undefined) d[k] = x; }
}
async function loadCV() {
  if (!S.activeGang) { S.cv = null; return; }
  try { S.cv = await get(`/api/gangs/${S.activeGang}/crest-vote`); } catch { S.cv = null; }
}
async function loadSanta() {
  if (!S.activeGang) { S.santa = null; return; }
  try { S.santa = await get(`/api/gangs/${S.activeGang}/santa`); } catch { S.santa = null; }
}
// «Этаж» пишет сам: живая сводка дел. Новые пункты (ещё не виденные) — счётчик на вкладке «Чаты»
async function loadInbox() { try { S.inbox = (await get('/api/inbox')).items; } catch { S.inbox = S.inbox || []; } }
const inboxSeen = () => { try { return new Set(store.get('inboxSeen', [])); } catch { return new Set(); } };
const inboxNew = () => { const seen = inboxSeen(); return (S.inbox || []).filter((x) => !seen.has(x.id)).length; };
function markInboxSeen() { try { store.set('inboxSeen', (S.inbox || []).map((x) => x.id)); } catch {} }
async function loadMatch() { try { S.match = await get('/api/match'); } catch { S.match = null; } }
async function loadBoard() { try { S.board = await get('/api/board'); } catch { S.board = null; } }
async function loadAdvent() { try { S.advent = await get('/api/advent'); } catch { S.advent = null; } }
async function loadWave() {
  if (!S.activeGang) { S.wave = null; return; }
  try { S.wave = await get(`/api/gangs/${S.activeGang}/wave`); if (S.wave.active) S.waveOff = S.wave.active.now - Date.now(); } catch { S.wave = null; }
}
async function loadFriday() {
  if (!FRIDAY_ON || !S.activeGang) { S.friday = null; return; }
  try { S.friday = await get(`/api/gangs/${S.activeGang}/friday`); } catch { S.friday = null; }
}
// ----- «Дела дня»: до трёх дел, сроки — сегодня, завтра или следующий офисный день -----
async function loadTodos() { try { S.todos = await get('/api/todos'); } catch { S.todos = null; } }
const TODO_TPL = ['Позвать на кофе', 'Вернуть', 'Поздравить', 'Обед с', 'Занести'];
const TODO_DONE = ['Галочка!', 'Одним меньше', 'Так держать', 'Сделано — и забыто', 'Вычеркнуто'];
const dayLabel = (d, office) => (S.todos && d === S.todos.tomorrow ? 'завтра' : `${ddmmW(d)}${office && d === office ? ' · офис' : ''}`);
// «Дела дня» — своя карточка на «Рядом». Запись в одно касание: строка ввода всегда на виду, Enter — дело на сегодня.
// Когда, во сколько напомнить и с кем связано — по кнопке «Ещё» рядом со строкой. Сделанные сворачиваются вниз.
const TODO_TIMES = () => {
  const n = new Date(Date.now() + 3 * 3600e3), h = n.getUTCHours(), m = n.getUTCMinutes();
  const inH = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return [['', 'Без напоминания'], [inH, 'Через час'], ...['12:00', '14:00', '17:00'].filter((x) => x > `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`).map((x) => [x, x])];
};
function renderTodos() {
  const t = S.todos;
  if (!t) return '';
  const more = !!S.todoAdd;
  const when = S.todoWhen || 'today';
  const row = (x) => `<div class="todo ${x.done ? 'done' : ''}">
    <button class="todo-check" data-act="todo-done" data-id="${x.id}" data-v="${x.done ? 0 : 1}" aria-label="${x.done ? 'Вернуть' : 'Сделано'}: ${esc(x.text)}">${x.done ? ico('check', 16) : ''}</button>
    <span class="grow"><span class="todo-t">${esc(x.text)}</span>
      ${x.time || x.person || x.tail ? `<span class="todo-meta">${x.tail ? `<i class="todo-tail">хвост с ${ddmmW(x.tail)}</i>` : ''}${x.time ? `<i>${ico('wait', 12)} ${esc(x.time)}</i>` : ''}${x.person ? `<button class="todo-who" data-act="dm-open" data-id="${x.person.id}">${avatar(x.person.look, 18)} ${nk(x.person)}</button>` : ''}</span>` : ''}</span>
    ${x.done ? '' : `<button class="icon-btn" data-act="todo-move" data-id="${x.id}" aria-label="Перенести на завтра" title="На завтра">${ico('swap', 15)}</button>`}
    <button class="icon-btn" data-act="todo-remove" data-id="${x.id}" aria-label="Удалить" title="Удалить">${ico('x', 15)}</button></div>`;
  const open = t.today.filter((x) => !x.done), done = t.today.filter((x) => x.done);
  const total = t.today.length;
  const person = S.todoPerson ? (t.people.find((p) => p.id === S.todoPerson) || S.todoPersonObj) : null;
  const people = person && !t.people.some((p) => p.id === person.id) ? [person, ...t.people] : t.people;
  const times = TODO_TIMES();
  const opts = more ? `<div class="todo-opts">
      <div class="chips">${TODO_TPL.map((x) => `<button class="chip" data-act="todo-tpl" data-v="${esc(x)}">${esc(x)}…</button>`).join('')}</div>
      <div class="field">Когда<div class="chips todo-when">${[['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['office', t.officeDay ? `В офисный день · ${ddmmW(t.officeDay)}` : 'В офисный день']].map(([k, l]) => `<button class="chip ${when === k ? 'on' : ''}" data-act="todo-when" data-v="${k}" ${k === 'office' && !t.officeDay ? 'disabled title="Заполни план недели в профиле"' : ''}>${l}</button>`).join('')}</div></div>
      <div class="field">Напомнить пушем<div class="chips">${(when === 'today' ? times : [['', 'Без напоминания'], ['10:00', '10:00'], ['13:00', '13:00'], ['17:00', '17:00']]).map(([v, l]) => `<button class="chip ${(S.todoTime || '') === v ? 'on' : ''}" data-act="todo-tm" data-v="${v}">${l}</button>`).join('')}
        <label class="todo-time">${ico('wait', 14)}<input id="todo-time" type="time" value="${esc(S.todoTime || '')}" aria-label="Своё время"></label></div></div>
      ${people.length ? `<div class="field">С кем связано<div class="todo-people">${people.map((p) => `<button class="todo-pp ${S.todoPerson === p.id ? 'on' : ''}" data-act="todo-person" data-id="${p.id}" title="${esc(p.nick)}" aria-label="${esc(p.nick)}">${avatar(p.look, 30)}</button>`).join('')}</div></div>` : ''}
    </div>` : '';
  const sum = more ? [when !== 'today' ? (when === 'tomorrow' ? 'завтра' : 'в офисный день') : '', S.todoTime ? `напомню в ${S.todoTime}` : '', person ? `с ${person.nick}` : ''].filter(Boolean).join(' · ') : '';
  const input = t.left ? `<div class="todo-add">
      <div class="row todo-add-row"><label class="grow" style="display:flex"><span class="hidden">Новое дело</span><input id="todo-text" maxlength="80" placeholder="＋ Что не забыть?" value="${esc(S.todoDraft || '')}" autocomplete="off" enterkeyhint="done"></label>
        <button class="icon-btn todo-more ${more ? 'on' : ''}" data-act="todo-more" aria-expanded="${more}" aria-label="Когда, напоминание, с кем">${ico(more ? 'x' : 'wait', 17)}</button>
        <button class="btn small" data-act="todo-add" aria-label="Добавить">→</button></div>
      ${sum ? `<span class="small todo-sum">${esc(sum)}</span>` : ''}${opts}</div>` : `<p class="small" style="margin:0">На сегодня ${t.max} дел — максимум. Закрой или перенеси одно, чтобы добавить новое.</p>`;
  return `<section class="card todos">
    <div class="row" style="justify-content:space-between;align-items:center">
      <span class="card-title has-art">${art('tasks', 30)}Дела дня</span>
      <span class="row" style="gap:6px">${total ? `<span class="todo-prog" aria-label="Сделано ${done.length} из ${total}"><i style="--p:${Math.round(done.length / total * 100)}%"></i>${done.length}/${total}</span>` : ''}${t.streak ? `<span class="todo-streak" title="Дней без хвостов подряд">${ico('flame', 14)} ${t.streak}</span>` : ''}</span>
    </div>
    ${t.cleanToday && total ? `<div class="todo-clean">${ico('party', 18)} Чистый день — ни одного хвоста</div>` : ''}
    ${!total && !more ? `<p class="sub" style="margin:0">Позвать на кофе, вернуть зонт, поздравить. Закроешь все дела дня — похвала и +2 зерна. Видишь только ты.</p>` : ''}
    ${open.map(row).join('')}
    ${input}
    ${done.length ? `<details class="todo-later" ${S.todoDoneOpen ? 'open' : ''}><summary data-act="todo-done-toggle">Сделано · ${done.length}</summary>${done.map(row).join('')}</details>` : ''}
    ${t.later.length ? `<details class="todo-later"><summary>Потом · ${t.later.length}</summary>${t.later.map((x) => `<div class="todo later"><span class="todo-due">${dayLabel(x.due, t.officeDay)}</span><span class="grow"><span class="todo-t">${esc(x.text)}</span>${x.time ? `<span class="todo-meta"><i>${esc(x.time)}</i></span>` : ''}</span><button class="chip" data-act="todo-today" data-id="${x.id}" ${t.left ? '' : 'disabled'}>Сегодня</button><button class="icon-btn" data-act="todo-remove" data-id="${x.id}" aria-label="Удалить" title="Удалить">${ico('x', 15)}</button></div>`).join('')}</details>` : ''}
  </section>`;
}
// Праздник «Чистый день»: галочка и звёзды через экран
function todoParty(text) {
  const el = document.createElement('div');
  el.className = 'todo-party'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="tp-check">${ico('check', 60)}</div><div class="tp-text">${esc(text)}</div>${Array.from({ length: 14 }, (_, i) => `<i style="--i:${i};--x:${Math.round(Math.cos(i / 14 * 6.28) * 160)}px;--y:${Math.round(Math.sin(i / 14 * 6.28) * 160)}px"></i>`).join('')}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ----- «Батарейка недели»: самотест на усталость — результат видит только сам человек -----
function batterySvg(level, color, { size = 1, boosts = 0, anim = false } = {}) {
  const w = 150 * size, h = 70 * size, pad = 8 * size, inner = (w - 18 * size) - pad * 2;
  const fill = Math.max(4 * size, Math.round(inner * level / 100));
  return `<svg class="bt-svg ${anim ? 'anim' : ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Заряд ${level}%">
    <rect x="${2 * size}" y="${2 * size}" width="${w - 18 * size}" height="${h - 4 * size}" rx="${14 * size}" fill="none" stroke="currentColor" stroke-width="${4 * size}" opacity=".85"/>
    <rect x="${w - 14 * size}" y="${h * 0.32}" width="${10 * size}" height="${h * 0.36}" rx="${4 * size}" fill="currentColor" opacity=".85"/>
    <rect class="bt-fill" x="${pad}" y="${pad}" width="${fill}" height="${h - pad * 2}" rx="${9 * size}" fill="${color}" style="--w:${fill}px"/>
    ${boosts ? `<path d="M${w / 2 - 6 * size} ${h * 0.22} L${w / 2 - 14 * size} ${h * 0.56} L${w / 2 - 2 * size} ${h * 0.56} L${w / 2 - 8 * size} ${h * 0.82} L${w / 2 + 12 * size} ${h * 0.42} L${w / 2} ${h * 0.42} L${w / 2 + 6 * size} ${h * 0.22} Z" fill="#fff" stroke="#1A2547" stroke-width="${1.5 * size}" class="bt-bolt"/>` : ''}
  </svg>`;
}
const ddmmW = (w) => { const [, m, d] = w.split('-'); return `${d}.${m}`; };
function renderBattery() {
  const b = S.battery;
  if (!b) return '<p class="sub">Проверяем заряд…</p>';
  const st = S.bt || { step: 0, answers: [] };
  // Тест: если на этой неделе не проходил или нажал «пройти заново»
  if (!b.mine || st.retake) {
    const qn = b.questions[st.step];
    if (!qn) return '<p class="sub">Считаем заряд…</p>';
    return `<div class="bt-quiz">
      <div class="bt-dots">${b.questions.map((_, i) => `<i class="${i < st.step ? 'done' : i === st.step ? 'now' : ''}"></i>`).join('')}</div>
      <h3>${esc(qn.text)}</h3>
      <div class="bt-opts">${qn.opts.map((o, i) => ({ o, i })).reverse().map(({ o, i }) => `<button class="bt-opt" data-act="bt-pick" data-v="${i}"><span class="bt-dot" style="background:${['#E5484D', '#F07A1A', '#F2B705', '#2FA84F'][i]}"></span>${esc(o)}</button>`).join('')}</div>
      <p class="small" style="margin:0;text-align:center">Вопрос ${st.step + 1} из ${b.questions.length} · ответы не сохраняются, только итоговый заряд</p>
    </div>`;
  }
  const m = b.mine;
  const boosts = b.boosts || [];
  return `<div class="bt-result">
    <div class="bt-hero" style="--c:${m.lv.color}">
      ${batterySvg(m.level, m.lv.color, { size: 1.4, boosts: boosts.length, anim: S.btAnim })}
      <div class="bt-pct" style="color:${m.lv.color}">${m.level}%</div>
      <div class="bt-name">${esc(m.lv.name)}</div>
      <p>${esc(m.lv.text)}</p>
    </div>
    ${boosts.length ? `<section class="st-block"><div class="st-h"><b>Тебе подкинули заряд</b><span class="small">${boosts.length}</span></div>
      ${boosts.map((x) => `<div class="st-person">${tap(x.from.id, avatar(x.from.look, 36))}<span class="grow"><b>${nk(x.from)}</b><span class="small">${esc(x.name)}</span></span>${ico(x.icon, 20)}</div>`).join('')}</section>` : ''}
    ${m.canAsk ? `<section class="st-block bt-ask"><b>${m.ask ? 'Подзарядку ' + meG('попросил', 'попросила') + ' — свои видят' : 'Попросить подзарядку у своих?'}</b>
      <span class="small">${m.ask ? 'У тебя в банде и у подельников рядом с твоим ником горит значок. Процентов и ответов никто не видит. Просьба снимется сама в понедельник.' : 'Банда и подельники увидят значок рядом с твоим ником и смогут позвать на кофе, прислать шоколадку или дать пять. Процентов и ответов никто не увидит.'}</span>
      <button class="btn ${m.ask ? 'ghost' : ''}" data-act="bt-ask" data-v="${m.ask ? 0 : 1}">${m.ask ? 'Снять просьбу' : 'bolt Попросить подзарядку'}</button></section>` : ''}
    ${b.history.length > 1 ? `<section class="st-block"><div class="st-h"><b>Последние недели</b></div><div class="bt-hist">${b.history.map((h) => { const lv = b.levels.find((l) => h.level >= l.min); return `<span>${batterySvg(h.level, lv.color, { size: 0.42 })}<em>${ddmmW(h.week)} · ${h.level}%</em></span>`; }).join('')}</div></section>` : ''}
    <div class="row" style="justify-content:space-between;align-items:center"><button class="linkbtn" data-act="bt-retake">Пройти заново</button>
      <label class="small bt-remind"><input type="checkbox" data-act="bt-remind" ${S.me && S.me.profile && S.me.profile.battery === false ? '' : 'checked'}> Напоминать по пятницам</label></div>
    <p class="small st-note">lock Это не медицинский тест, а повод прислушаться к себе. Результат видишь только ты. Храним только процент за неделю, четыре недели.</p>
  </div>`;
}
function renderBoost() {
  const t = S.boostTo;
  if (!t) return '';
  const sent = t.sent || [];
  const opts = [['coffee', 'coffee', 'Позвать на кофе', 'Пуш с приглашением, договоритесь в личке'], ['choco', 'gift', 'Виртуальная шоколадка', 'Маленькая сладкая радость в пуше'], ['five', 'hand', 'Дать пять', 'Просто напомнить, что ты рядом']];
  return `<div class="boost">
    <p class="sub" style="margin:0"><b>${nk(t)}</b> просит немного подзарядки. Выбери, чем поддержать — можно всё сразу.</p>
    ${opts.map(([k, i, n, d]) => `<button class="bt-opt boost-opt ${sent.includes(k) ? 'done' : ''}" data-act="boost-send" data-v="${k}" ${sent.includes(k) ? 'disabled' : ''}>${ico(i, 22)}<span class="grow"><b>${n}</b><span class="small">${sent.includes(k) ? 'Отправлено' : d}</span></span>${sent.includes(k) ? 'check' : ''}</button>`).join('')}
    <p class="small" style="margin:0">Человек сам попросил подзарядку. Сколько у него заряда, видит только он.</p>
  </div>`;
}

// Бейджи: заработанные можно показать в своей карточке (до трёх), незаработанные — с прогрессом
function renderBadges(s) {
  if (!s.badges) return '';
  const got = s.badges.filter((b) => b.got), locked = s.badges.filter((b) => !b.got).sort((a, b) => b.n / b.of - a.n / a.of);
  const shown = got.filter((b) => b.shown).length;
  const tile = (b) => b.got
    ? `<button class="bdg ${b.shown ? 'on' : ''}" data-act="badge-toggle" data-v="${b.id}" aria-pressed="${b.shown}"><span class="bd-ico">${ico(b.icon, 20)}</span><span class="grow"><b>${esc(b.title)}</b><span class="small">${esc(b.desc)}</span></span><span class="bd-check" aria-hidden="true">${b.shown ? 'check' : ''}</span></button>`
    : `<div class="bdg locked"><span class="bd-ico">${ico(b.icon, 20)}</span><span class="grow"><b>${esc(b.title)}</b><span class="small">${esc(b.desc)}</span>${b.of > 1 ? `<span class="bd-bar"><i style="width:${Math.round((b.n / b.of) * 100)}%"></i></span><span class="small">${b.hint ? esc(b.hint) : `${b.n} из ${b.of}`}</span>` : `<span class="small bd-hint">${esc(b.hint || 'Пока не твой ритм')}</span>`}</span></div>`;
  return `<section class="st-block"><div class="st-h"><b>Бейджи</b><span class="small">${got.length ? `в карточке ${shown} из ${s.showMax}` : 'заработай первый'}</span></div>
    ${got.length ? `<p class="small" style="margin:0">Нажми на бейдж — он появится в твоей карточке, его увидят коллеги. До ${s.showMax} штук.</p><div class="bdgs">${got.map(tile).join('')}</div>` : ''}
    ${locked.length ? `<details class="bd-more" ${got.length ? '' : 'open'}><summary>Ещё ${locked.length} — как получить</summary><div class="bdgs">${locked.map(tile).join('')}</div></details>` : ''}
  </section>`;
}

// ----- «Мой стиль»: личная карточка по действиям — видит только сам человек, тексты не читаются -----
function renderStyle() {
  const s = S.style;
  if (!s) return '<p class="sub">Собираем портрет…</p>';
  const maxH = Math.max(1, ...s.hours.map((x) => x.n)), maxW = Math.max(1, ...s.week.map((x) => x.n));
  const st = s.stats;
  const num = (n, l) => `<div class="st-num"><b>${n}</b><span>${l}</span></div>`;
  const ppl = (list, btn) => list.map((p) => `<div class="st-person">${tap(p.id, avatar(p.look, 40))}<span class="grow"><b>${nk(p)}</b>${btn ? '' : `<span class="small">${p.n} ${plural(p.n, 'касание', 'касания', 'касаний')} за 2 месяца</span>`}</span>${btn ? `<button class="btn small ghost" data-act="dm-open" data-id="${p.id}">chat Написать</button>` : ''}</div>`).join('');
  return `<div class="style">
    <section class="st-hero"><span class="st-hero-ico">${ico(s.main.icon, 30)}</span><div><span class="small">Твой архетип</span><h2>${esc(s.main.title)}</h2><p>${esc(s.main.text)}</p>
      ${s.traits.length ? `<div class="chips">${s.traits.map((t) => `<span class="chip on" style="cursor:default">${esc(t)}</span>`).join('')}</div>` : ''}</div></section>
    ${renderBadges(s)}
    <section class="st-block"><div class="st-h"><b>${esc(s.chrono.title)}</b>${s.busiest ? `<span class="small">самый живой день — ${esc(s.busiest)}</span>` : ''}</div>
      <p class="small" style="margin:0">${esc(s.chrono.text)}</p>
      <div class="st-hours" aria-label="Активность по часам">${s.hours.map((x) => `<span title="${x.h}:00 — ${x.n}"><i style="height:${Math.round((x.n / maxH) * 100)}%"></i><em>${x.h % 3 === 0 ? x.h : ''}</em></span>`).join('')}</div>
      <div class="st-week">${s.week.map((x) => `<span><i style="width:${Math.round((x.n / maxW) * 100)}%"></i><em>${x.d}</em></span>`).join('')}</div>
    </section>
    ${s.replyMin != null ? `<section class="st-block st-row">${ico('bolt', 22)}<div><b>Отвечаешь в личке примерно за ${s.replyMin < 60 ? s.replyMin + ' мин' : Math.round(s.replyMin / 60) + ' ч'}</b><span class="small">${s.replyMin <= 10 ? 'Молния. С тобой легко договориться.' : s.replyMin <= 60 ? 'Нормальный темп: не висишь в телефоне, но и не теряешься.' : 'Не спешишь — и это нормально. Важное лучше звать зовом.'}</span></div></section>` : ''}
    <section class="st-block"><div class="st-h"><b>Цифры за всё время</b></div>
      <div class="st-nums">${num(st.msgs, 'в чатах банд')}${num(st.dms, 'в личке')}${num(st.calls, 'зовов')}${num(st.replies, 'ответов на зовы')}${num(st.thanksGiven, meG('спасибо сказал', 'спасибо сказала'))}${num(st.thanksGot, meG('спасибо получил', 'спасибо получила'))}${num(st.games, 'игр')}${num(st.checkins, 'отметок')}</div></section>
    ${s.ties.length ? `<section class="st-block"><div class="st-h"><b>Чаще всего на связи</b></div>${ppl(s.ties)}</section>` : ''}
    ${s.fresh.length ? `<section class="st-block"><div class="st-h"><b>Ещё не общались один на один</b><span class="small">из твоей банды</span></div>${ppl(s.fresh, true)}</section>` : ''}
    <p class="small st-note">lock Это видишь только ты. Тексты сообщений не читаются — считаем только действия: когда, сколько и с кем.</p>
  </div>`;
}

// ----- «Волна» по банде: клич раз в неделю, у банды 10 минут, чтобы встать -----
const WAVE_JOINED = () => [`${meG('Встал', 'Встала')} — значит, ${meG('свой', 'своя')}`, 'Банда видит', 'Красиво пошла!', 'Банда в сборе', 'Руки выше, банда в силе'];
const fanHtml = (f, size = 36) => `<span class="fan ${f.up ? 'up' : ''} ${f.me ? 'me' : ''}" style="--i:${f.i ?? 0}" title="${esc(f.nick)}"><span class="fan-arms" aria-hidden="true"></span>${avatar(f.look, size)}</span>`;
const waveLeft = (a) => Math.max(0, Math.round((a.endsAt - (Date.now() + (S.waveOff || 0))) / 1000));
function renderWave() {
  const w = S.wave;
  if (!w) return '';
  if (S.waveScroll) { S.waveScroll = false; setTimeout(() => { const c = findInGangTabs('.wave'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300); }
  const a = w.active;
  if (a) {
    const pct = Math.round((a.joined / a.size) * 100), need = Math.ceil(a.size / 2);
    return `<section class="card wave live">
      <div class="row" style="justify-content:space-between"><span class="card-title">hand Волна!</span><span class="wave-timer" id="wave-left">${mmss(waveLeft(a) * 1000)}</span></div>
      <p class="sub" style="margin:0">${a.by.auto ? 'Середина недели — Этаж сам запустил волну.' : `<b>${nk(a.by)}</b> ${a.by.fem ? 'запустила' : 'запустил'} волну.`} ${a.joined >= a.size ? 'Встала вся банда!' : a.joined >= need ? 'Банда в силе — дожимайте до всех!' : `Нужно, чтобы встали ${need} из ${a.size}.`}</p>
      <div class="stands" role="img" aria-label="Встали ${a.joined} из ${a.size}">${a.fans.map((f) => fanHtml(f)).join('')}</div>
      <div class="wave-bar"><i style="width:${pct}%"></i><span>встали ${a.joined} из ${a.size}</span></div>
      ${a.mine ? `<p class="small" style="margin:0;text-align:center">Ты стоишь. Свистни тем, кто ещё сидит, — пуш им уже ушёл.</p>` : `<button class="btn wave-go" data-act="wave-join" data-id="${a.id}">Встать за своих!</button>`}
    </section>`;
  }
  const last = w.last;
  if (!w.canLaunch && !last) return '';
  return `<section class="card wave idle">
    ${last ? `<div class="wave-last ${last.kind}">hand <span>${esc(last.text)}${last.mine ? '' : ` · ты ${meG('пропустил', 'пропустила')}`}</span></div>` : ''}
    ${w.canLaunch ? `<div class="row"><div class="grow"><b>Подними банду волной</b><div class="small">Клич своим: у всех ${w.windowMin} минут, чтобы встать. Одна волна на банду в неделю — успей первым. ${esc(w.autoHint)}</div></div><button class="btn small" data-act="wave-launch-open">Запустить</button></div>` : `<div class="small">${esc(w.why)}</div>`}
  </section>`;
}
const WAVE_PREVIEW = ['{nick} запустил волну. Встань, подними руки — у банды 10 минут', 'Это волна, а не спам. Ну почти. Зайди и нажми «Встать» — банда считает', 'Срочно: ничего срочного. Просто {nick} запустил волну', 'Даже кофемашина уже встала. Твоя очередь'];
function renderWaveLaunch() {
  const g = S.gang && S.gang.gang;
  const demo = Array.from({ length: 9 }, (_, i) => `<span class="fan up demo" style="--i:${i}"><span class="fan-arms" aria-hidden="true"></span><span class="demo-head" style="--c:${['#FFC93C', '#4F8BFF', '#2FA84F', '#E5484D', '#8B5CF6'][i % 5]}"></span></span>`).join('');
  const txt = WAVE_PREVIEW[Math.floor(Math.random() * WAVE_PREVIEW.length)].replace('{nick}', S.me.nick).replace('{gang}', g ? g.name : 'банда').replace('запустил', meG('запустил', 'запустила'));
  return `<div class="wave-launch">
    <div class="stands demo-stands" aria-hidden="true">${demo}</div>
    <div class="push-preview"><span class="pp-ico">Э.</span><div class="grow"><b>Этаж</b><span>${esc(txt)}</span></div></div>
    <ol class="ol"><li>Своим придёт смешной клич — повод заглянуть в Этаж.</li><li>У всех ${S.wave ? S.wave.windowMin : 10} минут, чтобы нажать «Встать за своих».</li><li>Встанут больше половины — банда в силе. Встанут все — ты капитан.</li></ol>
    <p class="small" style="margin:0">Одна волна на банду в неделю: кто первый, тот и запускает. Если до среды никто не соберётся, Этаж поднимет банду сам в 12:00. Тем, кто в отпуске или в тихих часах, пуш не придёт.</p>
    <button class="btn wave-go" data-act="wave-launch">Запустить волну!</button>
  </div>`;
}
// Волна через весь экран: банда прыгает слева направо, «ПОДЪЁМ!» по центру
function waveSweep(meLook) {
  const el = document.createElement('div');
  el.className = 'wave-sweep';
  el.setAttribute('aria-hidden', 'true');
  const n = 14, mid = Math.floor(n / 2);
  el.innerHTML = `<div class="sw-title">ПОДЪЁМ!</div><div class="sw-row">${Array.from({ length: n }, (_, i) => i === mid && meLook
    ? `<span class="sw-fan me" style="--i:${i}"><span class="fan-arms"></span>${avatar(meLook, 40)}</span>`
    : `<span class="sw-fan" style="--i:${i};--c:${['#FFC93C', '#4F8BFF', '#2FA84F', '#E5484D', '#8B5CF6', '#F97316'][i % 6]}"><span class="fan-arms"></span><span class="demo-head"></span></span>`).join('')}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
setInterval(() => {
  const a = S.wave && S.wave.active, el = document.getElementById('wave-left');
  if (!a || !el) return;
  const left = waveLeft(a);
  el.textContent = mmss(left * 1000);
  el.classList.toggle('hot', left <= 60);
  if (left <= 0 && !S.waveReloading) { S.waveReloading = true; loadWave().then(render).finally(() => { S.waveReloading = false; }); }
}, 1000);

// Пятничная пятиминутка выключена (FRIDAY_ON): не прижилась. Код и ответы сохранены, включается флагом здесь и в server/api.js
const FRIDAY_ON = false;
// Пятничная пятиминутка: три вопроса недели; ответил — видишь ответы банды и ставишь реакции
// Окно серии: после отметки (офис или «из дома») — сколько дней подряд, сколько дали, сколько будет завтра
function showStreak(r) {
  if (!r || !r.beans || !r.streak) return;
  const n = r.streak, max = r.streakBeans.length, pos = Math.min(n, max);
  const lines = n === 1 ? 'Серия началась. Завтра будет больше' : n < max ? `${n} ${plural(n, 'день', 'дня', 'дней')} подряд. Завтра +${r.tomorrow}` : `${n} ${plural(n, 'день', 'дня', 'дней')} подряд — максимум зёрен каждый день. Так держать`;
  const el = document.createElement('div');
  el.className = 'streak-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `Серия ${n}, плюс ${r.beans} зёрен`);
  el.innerHTML = `<div class="sp-card">
    <div class="sp-fire">${ico('flame', 54)}</div>
    <div class="sp-title">${n === 1 ? 'Первый день серии' : `Серия ${n} ${plural(n, 'день', 'дня', 'дней')}`}</div>
    <div class="sp-beans">+${r.beans} зёрен</div>
    <div class="sp-steps">${r.streakBeans.map((b, i) => `<span class="${i < pos ? 'on' : ''} ${i === pos - 1 ? 'now' : ''}"><i>${i < pos ? ico('flame', 16) : i + 1}</i><em>+${b}</em></span>`).join('')}</div>
    <p>${esc(lines)}. Пропустишь рабочий день — серия начнётся заново, выходные не считаются.</p>
    <button class="btn wide" data-act="streak-close">Отлично</button></div>`;
  document.body.appendChild(el);
  sfx('charge');
  const close = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-act="streak-close"]')) close(); });
  setTimeout(close, 9000);
}

// Блок мог уехать в другую вкладку банды («Чат», «Жизнь», «Банда») — ищем по очереди и переключаем
// Вкладка «Банда» открывает банду сразу; личка — отдельный экран (конверт в шапке)
const inGang = () => S.tab === 'chats' && !S.dm && !S.dmList;
function ensureGang() {
  const gs = (S.me && S.me.gangs) || [];
  if (!gs.length) return;
  if (!gs.some((g) => g.id === S.activeGang)) { S.activeGang = gs[0].id; store.set('activeGang', S.activeGang); }
}
function findInGangTabs(sel) {
  let t = document.querySelector(sel);
  if (t || !inGang()) return t;
  for (const k of ['chat', 'life', 'crew']) { if (t) break; S.gangTab = k; render(); t = document.querySelector(sel); }
  return t;
}
// Свёрнутая пятиминутка: после своих ответов — полоска с фразой, кто ответил и сколько новых чужих ответов
const FR_DONE = ['Неделя отрефлексирована. Психолог доволен', 'Сдано. Можно официально уходить в выходные', 'Отчёт о неделе принят без согласования с руководством',
  'Три строчки честности — и ты свободен|свободна', 'Пятиминутка закрыта за 30 секунд. Рекорд офиса'];
const frSeenKey = (f) => `${S.activeGang}:${f.week}`;
function renderFridayStrip(f) {
  const seen = (store.get('frSeen', {}) || {})[frSeenKey(f)] || 0;
  const fresh = Math.max(0, f.othersCount - seen);
  const alone = f.people <= 1, all = f.people >= f.members;
  const line = all ? 'Вся банда отчиталась. Можно открывать пятничное'
    : alone ? `Пока ты один такой честный|одна такая честная, остальные ${f.members - 1} стесняются`
    : FR_DONE[(f.week.charCodeAt(9) + S.activeGang) % FR_DONE.length];
  return `<section class="card friday fr-strip">
    <button class="fr-strip-btn" data-act="friday-open">
      <span class="fr-ok">check</span>
      <span class="grow"><b>Пятиминутка сдана</b><span class="small">${esc(line)}</span>
        <span class="fr-who">${f.answered.slice(0, 8).map((p) => avatar(p.look, 22)).join('')}<em>ответили ${f.people} из ${f.members}</em></span></span>
      ${fresh ? `<span class="fr-new">+${fresh} ${plural(fresh, 'новый', 'новых', 'новых')}</span>` : '<span class="chev" aria-hidden="true">›</span>'}
    </button>
    ${f.canAnswer && !all && !f.poked ? `<button class="btn small ghost fr-poke" data-act="friday-poke">megaphone Пнуть банду</button>` : ''}
  </section>`;
}
function renderFriday() {
  const f = S.friday;
  if (!f) return '';
  const any = f.questions.some((qd) => qd.answers.length);
  if (!f.canAnswer && !any) return '';
  if (f.done && !S.fridayOpen && !S.fridayEdit) return renderFridayStrip(f);
  const qBlock = (qd) => {
    const editing = f.canAnswer && (!qd.mine || S.fridayEdit === qd.id);
    const others = qd.answers.filter((a) => !a.me);
    return `<div class="fr-q"><b>${esc(qd.text)}</b>
      ${editing ? `<div class="row"><label class="field grow" style="gap:0"><span class="hidden">${esc(qd.text)}</span><input id="fr-${qd.id}" maxlength="${f.max}" value="${esc(qd.mine || '')}" placeholder="${esc(qd.ph)}"></label><button class="btn small" data-act="friday-send" data-q="${qd.id}">${qd.mine ? 'OK' : '→'}</button></div>`
        : qd.mine ? `<div class="fr-a me"><span class="grow">${esc(qd.mine)}</span>${f.canAnswer ? `<button class="linkbtn" data-act="friday-edit" data-q="${qd.id}" aria-label="Изменить">pencil</button>` : ''}</div>` : ''}
      ${(qd.mine || !f.canAnswer) ? others.map((a) => `<div class="fr-a"><span class="fr-ava">${avatar(a.look, 26)}</span><span class="grow"><span class="small">${nk(a)}</span><span class="fr-t">${esc(a.text)}</span>
        <span class="fr-r">${f.reactions.map((e) => `<button class="${a.my === e ? 'on' : ''}" data-act="friday-react" data-id="${a.id}" data-v="${e}" aria-label="Реакция ${e}">${e}${a.counts[e] ? `<i>${a.counts[e]}</i>` : ''}</button>`).join('')}</span></span></div>`).join('') : (others.length ? `<div class="small">Ответили ${others.length} — ответь, чтобы увидеть</div>` : '')}
    </div>`;
  };
  return `<section class="card friday"><div class="row" style="justify-content:space-between"><span class="card-title">chat Пятничная пятиминутка</span>${f.done ? '<button class="linkbtn small" data-act="friday-close">Свернуть</button>' : ''}<span class="small">${f.canAnswer ? `ответили ${f.people} из ${f.members}` : 'неделя закрыта'}</span></div>
    ${f.canAnswer && !f.done ? '<p class="small" style="margin:0">Три вопроса о неделе — ответ в одну строку. Ответы банды откроются, когда ответишь сам|сама. +3 зерна.</p>' : ''}
    ${f.questions.map(qBlock).join('')}
  </section>`;
}
async function loadGEvents() {
  if (!S.activeGang) { S.gev = null; return; }
  try { S.gev = await get(`/api/gangs/${S.activeGang}/gevents`); } catch { S.gev = null; }
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
      S.bShout = { text: v.last.r === 'miss' ? `${v.opp.nick} ${gw(v.opp.look, 'промахнулся', 'промахнулась')}` : v.last.r === 'sunk' ? `${v.opp.nick} ${gw(v.opp.look, 'потопил', 'потопила')} твой корабль` : `${v.opp.nick} ${gw(v.opp.look, 'попал', 'попала')}!`, cls: v.last.r, until: Date.now() + 1600, board: 'm' };
    }
  }
  // Реакция соперника: показываем пузырь, если она новее последней увиденной
  const oe = v.emotes && v.emotes.opp;
  if (oe && oe.at !== S.bEmoteSeen && v.now - oe.at < 8000) {
    S.bEmoteSeen = oe.at;
    S.bEmote = { ...(S.bEmote || {}), opp: { e: oe.e, until: Date.now() + 3200 } };
    setTimeout(() => { if (S.battle) render(); }, 3300);
    sfx(`emo_${oe.e}`);
  } else if (oe && S.bEmoteSeen == null) S.bEmoteSeen = oe.at;
  // Обе расстановки готовы — партия началась: труба «Свистать всех наверх!» (один раз)
  if (S.bv && S.bv.id === v.id && S.bv.status === 'setup' && v.status === 'play') sfx('bugle');
  // Партия только что закончилась победой — канонада (один раз)
  if (S.bv && S.bv.id === v.id && S.bv.status !== 'done' && v.status === 'done') {
    if (v.winner === 'me') sfx('victory'); else if (!S.bResigned) sfx('lose');
  }
  S.bv = v; S.bvAt = Date.now();
}
async function loadBattle() {
  if (!S.battle) { S.bv = null; return; }
  try { setBattleView(await get(`/api/battle/${S.battle}`)); } catch { S.battle = null; S.bv = null; }
}
// ===== Секретный чат: сквозное шифрование прямо в браузере =====
// Ключ ECDH P-256 создаётся на устройстве; закрытая часть неизвлекаемая и хранится в IndexedDB.
// Общий ключ пары — ECDH → HKDF → AES-256-GCM. Сервер видит только открытые ключи и шифр.
const E2E = (() => {
  const supported = !!(window.crypto && crypto.subtle && window.indexedDB);
  const DB = 'etazh-e2e', STORE = 'keys';
  const idb = () => new Promise((ok, fail) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
  const idbGet = async (k) => { const d = await idb(); return new Promise((ok, fail) => { const t = d.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => ok(t.result); t.onerror = () => fail(t.error); }); };
  const idbSet = async (k, v) => { const d = await idb(); return new Promise((ok, fail) => { const t = d.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k); t.onsuccess = () => ok(); t.onerror = () => fail(t.error); }); };
  const b64u = (buf) => { let s = ''; new Uint8Array(buf).forEach((c) => { s += String.fromCharCode(c); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const enc = new TextEncoder(), dec = new TextDecoder();
  let me = null;
  async function mine(uid) {
    if (me && me.uid === uid) return me;
    let rec = await idbGet('me:' + uid);
    if (!rec) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
      rec = { priv: kp.privateKey, pub: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, at: Date.now() };
      await idbSet('me:' + uid, rec);
    }
    me = { uid, ...rec };
    return me;
  }
  const cache = new Map();
  async function keyFor(my, their, lo, hi) {
    const id = `${my.pub.x}|${their.x}|${their.y}|${lo}|${hi}`;
    if (cache.has(id)) return cache.get(id);
    const tp = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: their.x, y: their.y, ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: tp }, my.priv, 256);
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const k = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(`etazh-secret:${lo}:${hi}`), info: enc.encode('v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    cache.set(id, k);
    return k;
  }
  // Отпечаток пары ключей одинаков у обоих собеседников: ключи сортируются
  const pairHash = async (a, b) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode([a.x + a.y, b.x + b.y].sort().join('|'))));
  const kfp = async (a, b) => [...(await pairHash(a, b)).slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
  async function safety(a, b) {
    const h = await pairHash(a, b), out = [];
    for (let i = 0; i < 5; i++) out.push(String(((h[i * 3] << 16) | (h[i * 3 + 1] << 8) | h[i * 3 + 2]) % 10000).padStart(4, '0'));
    return out.join(' ');
  }
  async function encrypt(my, their, lo, hi, text) {
    const k = await keyFor(my, their, lo, hi);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify({ t: text })));
    return { iv: b64u(iv), ct: b64u(ct), kfp: await kfp(my.pub, their) };
  }
  async function decrypt(my, their, lo, hi, m) {
    try {
      const k = await keyFor(my, their, lo, hi);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(m.iv) }, k, unb64u(m.ct));
      return JSON.parse(dec.decode(pt)).t;
    } catch { return null; }
  }
  return { supported, mine, encrypt, decrypt, safety, kfp };
})();
async function loadSecret() {
  const id = S.dm;
  if (!id || !E2E.supported) return;
  const r = await get(`/api/secret/${id}`);
  const my = await E2E.mine(S.me.id);
  if (!r.mine) { await post('/api/e2e/key', { pub: my.pub }); r.mine = { pub: JSON.stringify(my.pub) }; }
  const sm = JSON.parse(r.mine.pub);
  const sameDevice = sm.x === my.pub.x && sm.y === my.pub.y;
  const theirs = r.theirs ? JSON.parse(r.theirs.pub) : null;
  const [lo, hi] = S.me.id < id ? [S.me.id, id] : [id, S.me.id];
  const items = [];
  for (const m of r.items) items.push({ ...m, text: theirs && sameDevice ? await E2E.decrypt(my, theirs, lo, hi, m) : null });
  S.secret = { id, sameDevice, theirs, code: theirs && sameDevice ? await E2E.safety(my.pub, theirs) : null, items, canWrite: r.canWrite, ttlDays: r.ttlDays };
}
function renderSecret(f) {
  if (!E2E.supported) return '<section class="card secret"><p class="sub" style="margin:0">Этот браузер не умеет шифровать. Открой Этаж в свежем Chrome или Safari.</p></section>';
  const x = S.secret;
  if (!x || x.id !== f.id) return '<section class="card secret"><p class="sub" style="margin:0">Готовим ключи…</p></section>';
  const msgs = x.items.map((m) => `<div class="msg ${m.mine ? 'mine' : ''} ${m.text === null ? 'locked' : ''}"><div class="text">${m.text === null ? 'lock Не расшифровать: сообщение для другого ключа' : esc(m.text)}</div><div class="meta"><span>${m.time}</span>${m.mine ? (m.read ? '<span title="Прочитано">✓✓</span>' : '<span title="Доставлено">✓</span>') : ''}</div></div>`).join('')
    || `<p class="sub" style="margin:0">Тут пусто. Всё, что напишете, увидите только вы двое — даже сервер не прочитает. Сообщения живут ${x.ttlDays} дней.</p>`;
  const ready = x.theirs && x.sameDevice && x.canWrite;
  return `<section class="card secret">
    <div class="row" style="justify-content:space-between"><span class="card-title">lock Секретный чат</span><span class="small">сквозное шифрование</span></div>
    ${!x.sameDevice ? `<div class="note warn" style="margin:0">Секретный чат сейчас привязан к другому твоему устройству. Сделай это устройство основным — тогда старые секретные сообщения здесь не прочитать, а новые будут работать тут.<br><button class="btn small" data-act="secret-adopt" style="margin-top:8px">Сделать это устройство основным</button></div>` : ''}
    ${!x.theirs ? `<div class="note" style="margin:0">${nk(f)} ещё не открывал${gw(f.look, '', 'а')} секретный чат — нужен его ключ. Позови: как только откроет вкладку «Секретный», можно писать.<br><button class="btn small" data-act="secret-invite" style="margin-top:8px">Позвать в секретный чат</button></div>` : ''}
    <div class="chat" id="sc-chat">${msgs}</div>
    ${ready ? `<div class="row"><label class="field grow" style="gap:0"><span class="hidden">Секретное сообщение</span><input id="sc-text" maxlength="1000" placeholder="Секретно написать ${esc(f.nick)}" aria-label="Секретное сообщение"></label><button class="btn" data-act="secret-send" aria-label="Отправить">→</button></div>` : ''}
    ${x.code ? `<div class="sc-code"><span class="small">Код безопасности</span><b>${x.code}</b><span class="small">Сверьте при встрече: у ${nk(f)} должен быть такой же. Совпадает — вас никто не подслушивает.</span></div>` : ''}
    <p class="small" style="margin:0">Сервер хранит только шифр и не может его прочитать. Поэтому в пуше не будет текста, а пожаловаться на сообщение модератору нельзя — только заблокировать. Ключ живёт на этом устройстве: на новом телефоне старые секретные сообщения не прочитать.</p>
  </section>`;
}
async function loadDm() {
  if (!S.dm) { S.dmView = null; return; }
  try { S.dmView = await get(`/api/crew/${S.dm}`); } catch { S.dm = null; S.dmView = null; return; }
  await loadDuels(S.dm);
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
async function afterInvite(r) {
  toast('Ты в банде!'); await loadMe();
  S.activeGang = r.gang; store.set('activeGang', r.gang); S.chatGang = true; S.dmList = false; S.dm = null;
  await Promise.all([loadChats(), loadGang(), loadGangExtra(), loadState()]);
}
async function afterCreate(r) {
  S.gnew = null; S.sheet = null; S.tab = 'chats'; S.chatGang = true; S.dmList = false; S.dm = null;
  S.activeGang = r.id; store.set('activeGang', r.id);
  await loadMe(); await loadGang();
  toast('Банда сколочена. Зови своих по ссылке');
}
async function applyGang(id, sw) {
  const r = await post(`/api/gangs/${id}/apply`, { switch: sw });
  if (r.member) { toast('Ты в банде!'); await loadMe(); S.sheet = null; S.activeGang = r.id; store.set('activeGang', r.id); S.tab = 'chats'; S.chatGang = true; S.dmList = false; S.dm = null; await loadGang(); return; }
  toast(sw ? 'Заявка отправлена. Когда примут — перейдёшь в новую банду' : 'Заявка отправлена — владелец получит пуш');
  if (S.gfind && S.gfind.items) S.gfind.items = S.gfind.items.map((c) => (c.id === id ? { ...c, requested: true } : c));
  if (S.gprofile && S.gprofile.id === id) S.gprofile = { ...S.gprofile, requested: true };
}
async function loadGangFind() {
  const f = S.gfind;
  const r = await get(`/api/gangs/search?q=${encodeURIComponent(f.q || '')}&area=${encodeURIComponent(f.area || '')}`);
  f.items = r.items; f.recommended = !!r.recommended;
}
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
  const jobs = [loadState(), loadInbox()];
  if (all || t === 'near') jobs.push(loadBoard(), loadPeople(), loadMatch(), loadTodos(), S.fx ? Promise.resolve() : loadFeatures().catch(() => {}));
  if (all || t === 'near' || t === 'office' || t === 'games') jobs.push(loadFeatures());
  if (all || t === 'near' || t === 'games') jobs.push(loadAdvent());
  if (all || t === 'chats') jobs.push(loadChats());
  if (all || t === 'chats' || t === 'games') jobs.push(loadCrew());
  if (inGang()) ensureGang();
  if (all || inGang() || t === 'games') jobs.push(loadGang(), loadGangExtra());
  if (all && !S.changes) jobs.push(loadChanges());
  if (all || t === 'office') jobs.push(loadEvents(), loadBoard(), S.experts && S.experts.q ? null : loadExperts());
  if (all || t === 'games') jobs.push(loadQuiz(), loadBlitz(), loadLeague('W').catch(() => {}), loadDuels(), loadTour());
  if (t === 'chats' && S.battle) jobs.push(loadBattle());
  if (t === 'chats' && S.dm) jobs.push(loadDm());
  await Promise.all(jobs);
  if (t === 'chats' && S.dm && S.crew) { const f = S.crew.list.find((x) => x.id === S.dm); if (f) f.unread = 0; recountCrewBadge(); }
  if (inGang()) markSeen('chat');
  if (t === 'office') markSeen('feed');
}
function markSeen(kind) {
  const t = S.state ? S.state.now : Date.now();
  if (kind === 'chat') { S.seenChat = t; store.set('seenChat', t); if (S.state) S.state.badges.chat = 0; }
  else { S.seenFeed = t; store.set('seenFeed', t); if (S.state) S.state.badges.feed = 0; }
}

// ---------- Рендер ----------
// Метрики модератора: какой раздел открывали сегодня — по разу в день, только счётчик на сервере
const SEEN = new Set();
function trackSeen(k) {
  if (!k) return;
  const key = new Date().toDateString() + k;
  if (SEEN.has(key)) return;
  SEEN.add(key);
  fetch('/api/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k }) }).catch(() => {});
}

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
  if (!S.me) root.innerHTML = iconize(renderLogin());
  else if (!S.me.nick) root.innerHTML = iconize(renderNick());
  else if (!(S.me.profile && S.me.profile.firstName && S.me.profile.lastName)) root.innerHTML = iconize(renderNameStep());
  else { root.innerHTML = iconize(renderApp()); trackSeen(S.tab); if (['shop', 'league', 'profile'].includes(S.sheet)) trackSeen(S.sheet); }
  window.scrollTo(0, keepScroll);
  // Эффекты морского боя живут на отдельном холсте: перерисовка экрана их не обрывает
  seaFxSync({
    on: !!document.querySelector('.board-wrap'), fresh: S.bFresh, freshUntil: S.bFreshUntil || 0,
    win: S.bv && S.bShout && Date.now() < S.bShout.until && /^Победа/.test(S.bShout.text) ? S.bv.id || 'pr' : null
  });
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

// «Об Этаже»: цель и функции в шести карточках, мемным тоном. Один текст — для входа, новичков и профиля
const ABOUT_TILES = [
  ['office', 'Кто в офисе', 'Отметься — и банда видит, что ты тут. Больше никаких «ты сегодня где?» в пяти чатах.'],
  ['coffee', 'Зовы', 'Кофе, обед, «домой», «перезвони» — в одно касание. Банда отвечает кнопкой, а не созвоном.'],
  ['lunch', 'Очередь в столовой', 'Свои подсказывают, есть ли очередь. Лучше узнать заранее, чем стоять с подносом и рефлексировать.'],
  ['flag', 'Банды', 'Не отдел по списку, а свои: с кем обедаешь, пьёшь кофе и сидишь рядом. Общий чат, опросы, неделя офиса, дни рождения.'],
  ['game', 'Игры и зёрна', 'Задания дня, квизы, блиц, морской бой. За всё — зёрна, на них — шмотки для аватара.'],
  ['trophy', 'Лига банд', 'Банды соревнуются за неделю и месяц. Победителям — кубки, венки и вечная слава до следующего месяца.']
];
function aboutHtml({ cta = true } = {}) {
  return `<div class="about">
    <p class="about-lead"><b>Этаж</b> — неофициальное приложение для своих, чтобы <b>видеть, кто рядом, и собираться без лишней переписки</b>. Рабочие задачи — в рабочих системах. Тут — кофе, обед, игры и банда.</p>
    <div class="about-grid">${ABOUT_TILES.map(([e, t, d]) => `<div class="about-tile"><span class="about-emo" aria-hidden="true">${e}</span><b>${t}</b><span>${d}</span></div>`).join('')}</div>
    <div class="about-not"><b>Чего Этаж не делает</b>
      <span>Не следит: никакой геолокации — только твоя кнопка «я в офисе», и её можно скрыть. Не хранит почту — только зашифрованный отпечаток. Не для начальства: это не табель, а кофе-машина с интерфейсом.</span></div>
    ${S.me ? `<button class="fb-entry" data-act="open" data-v="guide"><span class="grow"><b>Как тут всё устроено</b><span class="small">Каждая вкладка и меню: что нажимать и зачем</span></span><span class="chev" aria-hidden="true">›</span></button>` : ''}
    ${S.me ? '<button class="linkbtn" data-act="open" data-v="changes">Что нового — по дням →</button>' : '<a class="linkbtn" href="/changelog.html" target="_blank" rel="noopener">Что нового — по дням →</a>'}
    ${cta ? '<button class="btn" data-act="about-ok">Понятно, погнали</button>' : ''}
  </div>`;
}

// Экран входа: Этаж лучше всего живёт установленным на телефон — говорим об этом до входа
const PHONE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>';
const isPhone = () => isIOS() || /android|mobile/i.test(navigator.userAgent);
function loginInstallHint() {
  if (isStandalone()) return '';
  if (!isPhone()) return `<div class="login-inst"><b>${PHONE_SVG}Этаж сделан для телефона</b>
    <span>Открой <b>${esc(location.host)}</b> на телефоне и установи на главный экран. С компьютера войти можно, но зовы на кофе и обед сюда не придут.</span></div>`;
  return `<div class="login-inst"><b>${PHONE_SVG}Сначала установи на главный экран</b>
    <span>Так Этаж работает лучше всего: открывается с иконки, как обычное приложение, и присылает зовы и уведомления. В браузере они не приходят.${isIOS() ? ' Лучше установить до входа: на iPhone после установки может понадобиться войти ещё раз.' : ''}</span>
    <details class="login-inst-how"><summary>Как установить — полминуты</summary>${renderInstall()}</details></div>`;
}
function renderLogin() {
  const o = S.onb;
  const params = new URLSearchParams(location.search);
  const expired = params.get('login') === 'expired';
  const acc = params.get('access');
  if (o.step === 'access') {
    return `<div class="onb">
      <div class="logo">Этаж<span>.</span></div>
      <div class="card">
        <h2>Подтверди почту</h2>
        <p class="sub">Для твоей компании Этаж пока не открыт. Мы отправили письмо на <b>${esc(o.email)}</b> — открой ссылку из него, и модератор получит заявку.</p>
        <p class="sub">Когда Этаж откроют для твоей компании, придёт письмо со ссылкой для входа. Адрес храним зашифрованным только до решения.</p>
        ${o.devLink ? `<div class="note warn">Режим разработки: письмо не отправлялось. <a href="${esc(o.devLink)}">Подтвердить</a></div>` : ''}
        <button class="linkbtn" data-act="onb-back">Ввести другую почту</button>
      </div>
    </div>`;
  }
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
    <div class="logo">Этаж<span>.</span><em class="logo-beta">β-тест</em></div>
    <p class="sub" >Неофициальное приложение для своих: кто из твоей банды в офисе, есть ли очередь в столовой, позвать на кофе одной кнопкой.</p>
    <details class="about-login"><summary>Что такое Этаж? За 30 секунд</summary>${aboutHtml({ cta: false })}</details>
    ${loginInstallHint()}
    <div class="card">
      <h2>Вход по корпоративной почте</h2>
      <p class="sub">Введи рабочую почту своей компании. Почту мы не храним — только её зашифрованный отпечаток. Остальные видят только твой ник.</p>
      ${expired ? '<div class="err">Ссылка устарела или уже использована. Запроси новую.</div>' : ''}
      ${acc === 'sent' ? '<div class="note">Заявка у модератора. Когда Этаж откроют для твоей компании, придёт письмо со ссылкой для входа.</div>' : acc === 'expired' ? '<div class="err">Ссылка для заявки устарела. Введи почту ещё раз.</div>' : ''}
      <label class="field">Рабочая почта<input id="email" type="email" inputmode="email" autocomplete="email" placeholder="имя@вашакомпания.ru" value="${esc(o.email)}"></label>
      <label class="check"><input id="consent" type="checkbox"> <span>Согласен с <a href="/privacy.html" target="_blank" rel="noopener">политикой обработки данных</a> и <a href="/rules.html" target="_blank" rel="noopener">правилами</a></span></label>
      ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
      <button class="btn wide" data-act="login-submit" ${S.busy ? 'disabled' : ''}>Получить ссылку для входа</button>
    </div>
  </div>`;
}

// Обязательный шаг: имя и фамилия. Регистр правим сами — «иВАН петров» станет «Иван Петров»
function renderNameStep() {
  const p = S.me.profile || {};
  return `<div class="onb">
    <div class="logo">Этаж<span>.</span></div>
    <div class="card">
      <h2>Как тебя зовут?</h2>
      <p class="sub">Ник — ${nk(S.me)} — остаётся, а имя и фамилия нужны, чтобы коллеги понимали, с кем общаются. Регистр поправим сами.</p>
      <label class="field">Имя<input id="n-first" maxlength="30" autocomplete="given-name" value="${esc(p.firstName || '')}" placeholder="Анна"></label>
      <label class="field">Фамилия<input id="n-last" maxlength="30" autocomplete="family-name" value="${esc(p.lastName || '')}" placeholder="Петрова"></label>
      ${S.error ? `<div class="note warn">${esc(S.error)}</div>` : ''}
      <button class="btn" data-act="name-step-save">Дальше</button>
      <p class="small" style="margin:0">Имя и фамилию видят все коллеги в Этаже — так проще писать в личку, звать на кофе и знакомиться. Исправить можно в профиле.</p>
    </div></div>`;
}
const nameCase = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru').replace(/(^|[\s-])([a-zа-яё])/g, (m, sep, ch) => sep + ch.toLocaleUpperCase('ru'));
function renderNick() {
  const o = S.onb;
  return `<div class="onb">
    <div class="logo">Этаж<span>.</span></div>
    <div class="card">
      <h2>Придумай никнейм</h2>
      <p class="sub">По нему тебя узнают на Этаже. Ник — для веселья, а имя и фамилию спросим следующим шагом, чтобы коллеги понимали, с кем общаются.</p>
      <div class="nick-rules">
        <p><b>Можно почти всё:</b> гроза_дедлайна, король_кофе, просто_Петя. Буквы, цифры и «_», от 3 до 14 символов.</p>
        <p><b>Нельзя:</b> мат, оскорбления и шутки, над которыми смеёшься только ты. Проверка простая: такой ник не стыдно произнести вслух на планёрке.</p>
        <p><b>Передумаешь</b> — сменишь в профиле: первая смена бесплатно, дальше — ${S.cat ? S.cat.nickPrice : 50} зёрен. Ник при регистрации тоже бесплатный, старый после смены сразу освобождается.</p>
      </div>
      <div class="chips">${o.nicks.map((n) => `<button class="chip" data-act="nick-pick" data-v="${esc(n)}">${esc(n)}</button>`).join('')}
        <button class="chip" data-act="nick-more">Ещё варианты</button></div>
      <label class="field">Никнейм<input id="nick" maxlength="14" autocomplete="off" placeholder="бодрый_енот" value="${esc(o.nick || '')}"></label>
      <div class="field">Кто ты? <span class="small" style="font-weight:600">— от этого зависят аватар и как к тебе обращаться: «бандит» или «бандитка»</span>
        <div class="row">${['m', 'f'].map((p) => `<button class="chip ${o.preset === p ? 'on' : ''}" data-act="onb-preset" data-v="${p}">${avatar({ preset: p, hairStyle: p === 'f' ? 'long' : 'short' }, 28)} ${p === 'm' ? 'Он' : 'Она'}</button>`).join('')}</div>
      </div>
      ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
      <button class="btn wide" data-act="nick-submit" ${o.preset ? '' : 'aria-disabled="true"'} style="${o.preset ? '' : 'opacity:.55'}">${o.preset ? 'Готово' : 'Выбери «Он» или «Она»'}</button>
    </div>
  </div>`;
}

// Плашка сверху: сегодняшняя дата, «бета-тест» и обезличенные цифры. Нажатие — подробности
const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function todayLabel(short = false) {
  const d = new Date(Date.now() + 3 * 3600e3); // по Москве
  return `${short ? ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getUTCDay()] : WD_FULL[d.getUTCDay()]}, ${d.getUTCDate()} ${MON_GEN[d.getUTCMonth()]}`;
}
function renderTopStrip() {
  const st = S.state && S.state.stats;
  return `<button class="top-strip" data-act="open" data-v="stats" aria-label="Статистика Этажа">
    <span class="ts-date">${todayLabel(true)}</span><span class="ts-beta">β-тест</span>
    ${st ? `<span class="ts-nums">${st.gangs} ${plural(st.gangs, 'банда', 'банды', 'банд')} · ${st.users} ${plural(st.users, 'бандит', 'бандита', 'бандитов')}</span>` : ''}</button>`;
}
function renderStats() {
  const st = S.state && S.state.stats;
  if (!st) return '<p class="sub">Загружаем…</p>';
  const tile = (n, label) => `<div><b>${n}</b><span>${label}</span></div>`;
  return `<div class="note warn" style="margin:0"><b>Идёт бета-тест.</b> Что-то может сломаться, а что-то — поменяться. Нашёл баг или есть идея — напиши, за принятую идею +10 зёрен.</div>
    <p class="small" style="margin:0">Сегодня ${todayLabel()}. Цифры общие на весь Этаж, без ников и названий — кто именно, не видно.</p>
    <div class="g-stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      ${tile(st.users, plural(st.users, 'бандит в Этаже', 'бандита в Этаже', 'бандитов в Этаже'))}
      ${tile(st.gangs, plural(st.gangs, 'банда', 'банды', 'банд'))}
      ${tile(st.inGangs, 'уже в банде')}
      ${tile(st.users - st.inGangs, 'пока одиночки')}
      ${tile(st.today, 'заходили сегодня')}
      ${tile(st.week, 'за последние 7 дней')}
      ${tile(st.inOffice, 'отметились в офисе сегодня')}
      ${tile(st.newWeek, 'новичков за неделю')}
    </div>
    <p class="small" style="margin:0">${st.msgsToday} ${plural(st.msgsToday, 'сообщение', 'сообщения', 'сообщений')} в бандах сегодня. Чем больше своих — тем полезнее Этаж: позови коллегу, это +15 зёрен.</p>
    <div class="row"><button class="btn grow" data-act="crew-share">mail Позвать коллегу</button><button class="btn ghost grow" data-act="open" data-v="feedback">bulb Идея или баг</button></div>`;
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
          <span class="nick-row"><span class="nick">${nk(me)}</span><span class="chev" aria-hidden="true">›</span></span>
          <span class="row" style="gap:6px">
            ${me.status ? `<span class="status-chip">${esc(me.status)}</span>` : ''}
            ${me.streak ? `<span class="streak" title="Рабочих дней подряд с отметкой — в офисе или из дома">${FLAME}${me.streak} ${plural(me.streak, 'день', 'дня', 'дней')}</span>` : ''}
          </span>
        </span>
      </button>
      ${renderMailBtn(b)}
      <button class="beans3d ${S.beanFx ? 'gain' : ''} ${S.coach === 2 ? 'coach-focus' : ''}" data-act="open" data-v="shop" aria-label="Зёрна: ${me.beans}. Открыть лавку${shopDot() ? '. Есть что купить' : ''}">${BEAN}<span class="bnum">${S.beanFx ? S.beanFx.from : me.beans}</span><span class="bcart"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11h10.2L20 8H6.3"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="16.5" cy="19.5" r="1.4"/></svg></span>${shopDot() ? '<span class="bdot" aria-hidden="true"></span>' : ''}${S.beanFx ? `<span class="bplus" aria-hidden="true">+${S.beanFx.to - S.beanFx.from}</span>` : ''}</button>
    </header>
    ${S.tab === 'near' ? renderTopStrip() : ''}
    ${renderCoach()}
    ${S.newBuild ? '<button class="upd-bar" data-act="reload">spark Вышло обновление — нажми, чтобы обновить</button>' : ''}
    <main>
      ${showBanner ? `<div class="banner">
        <div class="grow"><div style="font-weight:900;font-size:15px">Установи на телефон</div><div style="font-size:12px;font-weight:600">${wrapBrowser() ? 'Лучше через Chrome — так телефон не ругается' : isIOS() ? 'На iPhone без этого не придёт ни одно уведомление: ни зов, ни «Неделя банды»' : 'Иконка на экране — и придут зовы банды'}</div></div>
        <button class="btn small blue" data-act="open" data-v="install">Как?</button>
        <button class="x" style="background:none" data-act="install-hide" aria-label="Скрыть на сутки">×</button>
      </div>` : ''}
      ${S.tab === 'near' ? renderNear() : S.tab === 'chats' ? renderChats() : S.tab === 'office' ? renderOfficeTab() : renderGames()}
    </main>
    <nav class="tabs"><div class="in">
      ${tabBtn('near', 'Рядом', 0)}${tabBtn('chats', 'Банда', chatNews().reduce((a, x) => a + (x.dm ? 0 : x.n), 0))}${tabBtn('office', 'Офис', 0)}${tabBtn('games', 'Игры', (b.duels || 0) + (S.quiz || []).filter((z) => !z.answered).length + (S.battles || []).filter((x) => x.myTurn && x.status !== 'done').length)}
    </div></nav>
  </div>
  ${S.sheet ? renderSheet() : ''}`;
}

const DM_SVG = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 9.5a6 6 0 0 1-8.9 5.2L2.5 15.8l1-3A6 6 0 1 1 14.5 9.5z"/><path d="M17.3 9.2a5.3 5.3 0 0 1 3.3 8.3l.9 2.9-3-1.1a5.3 5.3 0 0 1-7.2-1.7"/></svg>';
// Личка — значок диалога в шапке: виден на всех вкладках, счётчик непрочитанного и «твой ход» в морском бою
function renderMailBtn(b) {
  const n = b.crew || 0;
  const turn = (S.battles || []).some((x) => x.myTurn && x.status !== 'done');
  const on = S.tab === 'chats' && (S.dm || S.dmList);
  return `<button class="mailbtn ${on ? 'on' : ''}" data-act="dm-list" aria-label="Личка${n ? `, новых: ${n}` : ''}${turn ? ', твой ход в морском бою' : ''}">${DM_SVG}${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : turn ? '<span class="mdot" aria-hidden="true"></span>' : ''}</button>`;
}
function tabBtn(id, label, n) {
  const icons = {
    near: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 5.5 2 5.5 5.5"/>',
    chats: '<path d="M12 2.5l8 2.8v6.2c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V5.3z"/><path d="M12 8l1.2 2.5 2.7.3-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.3z"/>',
    games: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
    office: '<path d="M4 21V5l8-3 8 3v16z"/><path d="M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2"/>',
    gang: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 5.5 2 5.5 5.5"/>',
    feed: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    crew: '<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.4 8.4 0 1 1 21 11.5z"/><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01"/>'
  };
  const focus = S.coach && COACH[S.coach] && COACH[S.coach].tab === id ? 'coach-focus' : '';
  const on = S.tab === id && !(id === 'chats' && (S.dm || S.dmList));
  return `<button class="tab ${on ? 'on' : ''} ${focus}" data-act="tab" data-v="${id}" aria-current="${on}">
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

// Вечером: кто из банд в офисе в следующий рабочий день (по плану недели)
function renderTomorrow() {
  const t = S.state && S.state.tomorrow;
  if (!t || t.noGang) return '';
  const cap = t.label.charAt(0).toUpperCase() + t.label.slice(1);
  const mine = { office: 'ты — в офисе', home: 'ты — дома', vacation: 'ты — в отпуске', sick: 'ты — на больничном', off: 'выходной' }[t.mine] || 'твой план не указан';
  const plan = '<button class="linkbtn small" data-act="open-sec" data-v="work">План недели</button>';
  if (t.locked) {
    return `<section class="card tmr"><div class="row" style="justify-content:space-between;gap:8px"><h3>office ${esc(cap)} в офисе</h3>${plan}</div>
      <p class="sub" style="margin:0">Заполни свой план недели — и увидишь, кто из банды ${esc(t.label)} в офисе. Уже заполнили: ${t.filled} из ${t.total}.</p></section>`;
  }
  const offices = new Set(t.office.map((p) => p.office).filter(Boolean));
  const list = t.office.length
    ? `<div class="tmr-list">${t.office.map((p) => `<button class="tmr-p" data-act="person" data-id="${p.id}">${avatar(p.look, 40)}<span class="ellipsis">${nk(p)}</span>${offices.size > 1 && p.office ? `<small class="ellipsis">${esc(p.office)}</small>` : ''}</button>`).join('')}</div>`
    : `<p class="sub" style="margin:0">По планам ${esc(t.label)} из банды в офисе никого.${t.unknown ? ' Но не все заполнили план.' : ''}</p>`;
  return `<section class="card tmr"><div class="row" style="justify-content:space-between;gap:8px"><h3>office ${esc(cap)} в офисе${t.office.length ? ` · ${t.office.length}` : ''}</h3>${plan}</div>
    ${list}
    <p class="small" style="margin:0">${esc(mine)}${t.unknown && t.office.length ? ` · ещё ${t.unknown} без плана на этот день` : ''}</p></section>`;
}
function renderStatusBlock() {
  const st = S.state;
  if (st.night) return `${renderToday()}<div class="card"><h2>Офисы засыпают</h2><p class="sub">После 19:00 отметки сбрасываются. Утром отметься снова — увидишь, кто из твоих рядом.</p></div>${renderTomorrow()}`;
  if (!st.checkin) {
    return `${renderToday()}<div class="card">
      <h2>${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? 'Всё-таки в офисе?' : 'Где ты сегодня?'}</h2>
      ${st.presence.where === 'idle' ? `<p class="sub st-joke">Пока банда видит про тебя: <b>«${esc((S.cat.idleJokes || [])[st.presence.joke] || 'в астрале')}»</b></p>` : ''}
      ${officePicker()}
      ${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? '' : `<div class="today-grid">
        <button class="btn ghost" data-act="today" data-v="home">home Из дома</button>
        <button class="btn ghost" data-act="open" data-v="sick">thermo Болею</button>
        <button class="btn ghost" data-act="open" data-v="vacation">sun В отпуске</button>
        <button class="btn ghost" data-act="today" data-v="slack">Отлыниваю</button></div>`}
      <p class="small">Отметка в офисе — до 19:00. Зёрна за отметку растут с серией дней: от +3 до +8. Твои люди увидят, где ты.</p>
    </div>`;
  }
  const here = (S.people || []).filter((r) => r.where === 'office' && r.office === st.checkin.office).length;
  // На «Рядом» отметка — одной строкой: картинка офиса живёт на вкладке «Офис», здесь важнее зовы и люди
  return `<section class="st-strip st-office">
    <span class="st-ico">${ico('office', 20)}</span>
    <span class="grow"><b>${esc(st.checkin.name)}</b><span class="small">с ${st.checkin.since || ''} · твоих здесь <b>${here}</b></span></span>
    <button class="icon-btn" data-act="open" data-v="office" aria-label="Сменить офис">${ico('swap', 16)}</button>
    <button class="btn small ghost" data-act="checkout">${meG('Ушёл', 'Ушла')}</button>
  </section>`;
}

function personRow(p) {
  const [w, color] = whereText(p);
  const st = S.state;
  const sameOffice = st.checkin && p.where === 'office' && p.office === st.checkin.office;
  const away = p.where === 'vacation' || p.where === 'sick';
  const action = p.unread ? `<button class="btn small" data-act="dm-open" data-id="${p.id}">chat ${p.unread}</button>`
    : away ? '<span class="small">отдыхает</span>'
    : sameOffice ? `<button class="btn small" data-act="pcall" data-id="${p.id}" data-kind="coffee">На кофе</button>`
    : `<button class="btn small ghost" data-act="pcall-open" data-id="${p.id}">Позвать</button>`;
  const mine = new Set(S.me.gangs.length === 1 ? [S.me.gangs[0].name] : []); // единственную свою банду не повторяем у каждого
  const gs = p.gangs.map((g) => g.name).filter((n) => !mine.has(n));
  const tagline = [p.mood && p.where === 'office' ? p.mood : '', gs.join(', ')].filter(Boolean).join(' · ');
  return `<div class="person2">
    ${tap(p.id, `<span class="ava-wrap" style="opacity:${away ? 0.6 : 1}"><span class="ava-ring" style="border-color:${color}">${avatar(p.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>`)}
    <div class="grow" style="min-width:0"><div class="tapname" style="font-weight:800;font-size:15px" data-act="person" data-id="${p.id}">${nk(p)}</div>${p.name ? `<div class="realname">${esc(p.name)}</div>` : ''}
      <div class="where ellipsis">${esc(w)}${tagline ? ' · ' + esc(tagline) : ''}</div></div>
    ${action}</div>`;
}

function renderPeople() {
  const ps = S.people;
  if (!ps) return '<div class="card"><p class="sub">Загружаем твоих людей…</p></div>';
  if (!ps.length) {
    return `<section class="card empty">${art('friends', 96)}<h2>Пока здесь пусто</h2>
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
  const nl = S.state && S.state.nameLock;
  const nameStrip = nl ? `<button class="week-lock-strip" data-act="open-sec" data-v="name">${ico('lock', 16)}<span>Имена коллег скрыты: ${nl.named} из ${nl.total} ${plural(nl.total, 'бандита', 'бандитов', 'бандитов')} указали имя, и ты видишь только ники. <b>Указать своё →</b></span></button>` : '';
  const hint = S.fx && S.fx.weekLock ? planLockMsg(S.fx.weekLock, true) : S.fx && S.fx.weekHint ? `<div class="week-hint">${ico('where', 16)}<span>${S.fx.weekHint.today ? 'Сегодня' : esc(S.fx.weekHint.label)} в офисе по планам <b>${S.fx.weekHint.office} ${plural(S.fx.weekHint.office, 'человек', 'человека', 'человек')}</b> из банды</span></div>` : '';
  return `<section class="card people">${html}${hint}${nameStrip}
    <div class="row">${S.me.gangs.length ? `<button class="linkbtn" data-act="gang-invite" data-id="${S.activeGang || S.me.gangs[0].id}">+ Позвать в банду</button>` : '<button class="linkbtn" data-act="open" data-v="gang-new">Сколотить банду</button>'}</div></section>`;
}

function renderNear() {
  if (!S.state) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  const aboutCard = S.me.newbie3 && !store.get('aboutSeen') ? `<button class="about-card" data-act="open" data-v="about"><span aria-hidden="true"></span><span class="grow"><b>Что это вообще такое?</b><span class="small">Этаж за 30 секунд: зачем он и что тут есть</span></span><span class="chev" aria-hidden="true">›</span></button>` : '';
  const pr = S.me.look.prank && S.me.look.prank.until > Date.now() ? S.me.look.prank : null;
  const prankStrip = pr ? `<div class="prank-strip">${avatar(S.me.look, 34)}<span class="grow"><b>${esc(pr.from)} тебя ${pr.f ? 'разыграла' : 'разыграл'}</b><span class="small">${{ coffee: 'Кофе на одежде', sticker: 'Стикер на лбу', phones: 'Наушники с рок-музыкой' }[pr.v] || 'Подлянка'} — до ${new Date(pr.until).toTimeString().slice(0, 5)}</span></span><button class="btn small" data-act="prank-off">Снять</button></div>` : '';
  return `${pageHead('Рядом', 'Где ты сегодня и кто из твоих людей рядом')}
    ${prankStrip}${aboutCard}
    ${renderWeatherStrip()}
    ${renderStatusBlock()}
    ${renderPushNudge()}
    ${(S.people && !S.people.length) || !S.me.gangs.length ? findBar() : ''}
    ${renderQuickCalls()}
    ${renderTodos()}
    ${renderLunchCard()}
    ${renderWeekNote()}
    ${renderPeople()}
    ${renderBirthdays()}
    ${renderAdvent(true)}
    ${renderNearMore()}`;
}
// Установил, но уведомления не включил — зовы и сводки не дойдут. Особенно важно на iPhone: там пуши только так
function renderPushNudge() {
  if (!isStandalone() || !('Notification' in window) || Notification.permission !== 'default' || !S.vapidKey) return '';
  if (store.get('pushNudgeHidden', 0) > Date.now()) return '';
  return `<section class="st-strip"><span class="st-ico">${ico('alert', 20)}</span><span class="grow"><b>Уведомления выключены</b><span class="small">Без них не дойдут зовы банды и «Неделя банды»</span></span><button class="btn small blue" data-act="push-enable">Включить</button><button class="icon-btn" data-act="push-nudge-hide" aria-label="Скрыть на неделю">${ico('x', 15)}</button></section>`;
}
// Погода на завтра: строка под отметкой вечером накануне офисного дня. Дублирует пуш для тех, у кого пушей нет
function renderWeatherStrip() {
  const w = S.me && S.me.weather;
  if (!w || store.get('weatherHidden', '') === w.day) return '';
  return `<div class="wx-strip wx-${esc(w.icon)}">${ico(w.icon, 22)}<span class="grow"><b>Завтра в офис</b><span class="small">${esc(w.text.replace(/^Завтра:?\s*/, '').replace(/^./, (c) => c.toUpperCase()))}</span></span><button class="icon-btn" data-act="weather-hide" data-v="${esc(w.day)}" aria-label="Скрыть">${ico('x', 15)}</button></div>`;
}
// «Ещё полезное» на «Рядом»: дела дня, случайный кофе и «Совпадаем» свёрнуты в одну строку.
// Дела с открытыми пунктами на сегодня стоят на виду — их человек завёл сам.
// «Ещё полезное» на «Рядом»: случайный кофе и «Совпадаем» (сейчас выключены). «Дела дня» — своя карточка выше
function renderNearMore() {
  const c = COFFEE_ON && S.fx && S.fx.coffee, p = c && c.pair;
  const coffeeHot = !!(p && (p.canReply || !p.ping));
  const open = !!S.nearMore;
  const bits = [c ? (p ? `Кофе с ${esc(p.partner.nick)}` : 'Случайный кофе') : '', MATCH_ON && S.match && !S.match.off ? 'Совпадаем' : ''].filter(Boolean);
  if (!bits.length) return '';
  return `<section class="near-more ${open ? 'on' : ''}">
      <button class="near-more-head" data-act="near-more" aria-expanded="${open}"><span class="grow"><b>Ещё полезное</b><span class="small">${bits.join(' · ')}</span></span>${coffeeHot && !open ? '<i class="gq-dot" aria-label="ждёт ответа"></i>' : ''}<span class="chev" aria-hidden="true">${open ? '⌃' : '⌄'}</span></button>
      ${open ? `<div class="near-more-body">${renderCoffeeStrip()}${renderMatch()}</div>` : ''}
    </section>`;
}

// Заблокированный график: «заполни свой план — увидишь чужой». filled/total — сколько бандитов уже заполнили
function planLockMsg(lock, compact = false) {
  const f = lock.filled, t = lock.total;
  const who = t ? (f ? `${f} из ${t} ${plural(t, 'бандита', 'бандитов', 'бандитов')} уже ${plural(f, 'заполнил', 'заполнили', 'заполнили')} свой план и ${f > 1 ? 'видят друг друга' : 'видит график'}, а ты — нет.` : 'Пока никто в банде не заполнил план — будь первым.') : '';
  if (compact) return `<button class="week-lock-strip" data-act="open-sec" data-v="work">${ico('lock', 16)}<span>График банды скрыт: ${f ? `${f} из ${t} уже видят друг друга` : 'заполни план первым'}. <b>Заполнить →</b></span></button>`;
  return `<div class="week-lock"><span class="wl-ico">${ico('lock', 20)}</span><div class="grow"><b>Заполни свой план — увидишь график банды</b><p>${who} Отметь, в какие дни ты обычно в офисе, а в какие — дома. Это 30 секунд.</p>
    <button class="btn small" data-act="open-sec" data-v="work">Заполнить план недели</button></div></div>`;
}
// ----- «Совпадаем»: кто из коллег (не только банды) где на неделе -----
// «Совпадаем» и «Случайный кофе» выключены (MATCH_ON / COFFEE_ON): пока людей мало, пары и совпадения повторяются
const MATCH_ON = false, COFFEE_ON = false;
function renderMatch() {
  const m = S.match;
  if (!MATCH_ON || !m || m.off) return '';
  if (!m.on) {
    return `<section class="card match"><div class="card-title">where Совпадаем</div>
      <p class="sub" style="margin:0">Кто из коллег — не только из банды — в какие дни в офисе, а кто дома. Можно позвать на обед, кофе или созвониться.</p>
      <p class="small" style="margin:0">Видят только те, кто сам открыл свои дни. ${m.count ? `Уже открыли: <b>${m.count}</b>.` : 'Будь первым|первой.'} Показываем ник, имя, аватар, офис на день и общие интересы.</p>
      <button class="btn" data-act="match-on">Открыть свои дни и посмотреть</button></section>`;
  }
  if (m.locked) {
    return `<section class="card match"><div class="card-title">where Совпадаем</div>
      <div class="week-lock"><span class="wl-ico">${ico('lock', 20)}</span><div class="grow"><b>Заполни свой план — увидишь, с кем совпадаешь</b><p>${m.count ? `${m.count} ${plural(m.count, 'коллега уже открыл', 'коллеги уже открыли', 'коллег уже открыли')} свои дни и видят друг друга.` : ''} Твой план недели пока пустой — отметь офисные и домашние дни.</p>
      <button class="btn small" data-act="open-sec" data-v="work">Заполнить план недели</button></div></div></section>`;
  }
  const i = Math.min(S.matchDay || 0, m.days.length - 1);
  const d = m.days[i];
  const chips = `<div class="match-days">${m.days.map((x, k) => `<button class="mday ${k === i ? 'on' : ''} ${x.holiday ? 'off' : ''}" data-act="match-day" data-v="${k}"><b>${esc(x.label.split(' ')[0])}</b><span>${esc(x.label.split(' ')[1] || '')}</span><i>${x.holiday ? '—' : (x.offices ? `${ICONS.office ? ico('office', 11) : ''}${x.offices.reduce((a, o) => a + o.n, 0)}` : '')}</i></button>`).join('')}</div>`;
  if (d.holiday) return `<section class="card match"><div class="card-title">where Совпадаем</div>${chips}<p class="sub" style="margin:0">${esc(d.holiday)} — выходной.</p></section>`;
  const meLine = d.me === 'office' ? 'ты в офисе' : d.me === 'home' ? 'ты из дома' : d.me === 'vacation' ? 'ты в отпуске' : 'твой план не указан';
  const strip = (ps) => `<div class="match-strip">${ps.slice(0, 14).map((p) => `<span class="mp ${p.mate ? 'mate' : ''} ${p.common.length ? 'common' : ''}" title="${esc(p.name || p.nick)}">${tap(p.id, avatar(p.look, 38))}<span>${esc(p.name ? p.name.split(' ')[0] : p.nick)}</span></span>`).join('')}${ps.length > 14 ? `<span class="mp more">+${ps.length - 14}</span>` : ''}</div>`;
  const commons = (ps) => { const c = ps.filter((p) => p.common.length && !p.mate).slice(0, 3); return c.length ? `<div class="match-common">star ${c.map((p) => `<button class="linkbtn" data-act="person" data-id="${p.id}">${nk(p)}</button> — ${esc(p.common.slice(0, 2).join(', '))}`).join('; ')}</div>` : ''; };
  const group = (title, n, ps, mine) => `<div class="match-group ${mine ? 'mine' : ''}"><div class="row" style="justify-content:space-between"><b>${title}</b><span class="small">${n} ${plural(n, 'человек', 'человека', 'человек')}</span></div>${strip(ps)}${commons(ps)}</div>`;
  const body = (d.offices.length || d.home.n)
    ? d.offices.map((o) => group(`office ${esc(o.name)}`, o.n, o.people, o.mine)).join('') + (d.home.n ? group('home Из дома', d.home.n, d.home.people) : '')
    : '<p class="sub" style="margin:0">На этот день пока никто не отметил план.</p>';
  return `<section class="card match"><div class="row" style="justify-content:space-between"><span class="card-title">where Совпадаем</span><span class="small">${meLine}</span></div>
    ${chips}${body}
    <p class="small" style="margin:0">Нажми на человека — откроется карточка: написать, позвать на кофе или обед. Жёлтая обводка — общие интересы, синяя — твоя банда.${d.me === 'unknown' ? ' <button class="linkbtn" data-act="open-sec" data-v="work">Заполни свой план</button>' : ''}</p>
  </section>`;
}
// ----- «Кто знает?»: поиск коллег по темам «Спроси меня про» и «Чем занимаюсь» -----
// «Респект» коллеге из его карточки, лички или чата банды — любому, не только из своей банды.
// Кто кому и за что — видит только получатель; остальным видно одно число на карточке человека
const THX_REASONS = ['за помощь', 'за совет', 'за быстрый ответ', 'за кофе', 'за поддержку', 'просто так'];
// Выбор, кому респект, из чата банды: свои из банды и подельники. В общий чат ничего не попадает
function renderRespectPick() {
  const mates = ((S.gang && S.gang.members) || []).filter((m) => !m.me);
  const ids = new Set(mates.map((m) => m.id));
  const favs = ((S.chats && S.chats.favorites) || []).filter((f) => !ids.has(f.id));
  const btn = (m) => `<button class="chat-row" data-act="thx-open" data-id="${m.id}" data-nick="${esc(m.nick)}">${avatar(m.look, 36)}<span class="grow ellipsis"><b>${nk(m)}</b></span><span class="chev" aria-hidden="true">›</span></button>`;
  if (!mates.length && !favs.length) return '<p class="sub" style="margin:0">Пока некому: в банде никого, подельников нет. Респект можно выразить и из карточки любого коллеги во вкладке «Рядом».</p>';
  return `<p class="small" style="margin:0">Получит пуш и +2 зерна. Кто и за что — увидит только получатель.</p>
    ${mates.length ? `<div class="eyebrow">Банда</div>${mates.map(btn).join('')}` : ''}
    ${favs.length ? `<div class="eyebrow">Подельники</div>${favs.map(btn).join('')}` : ''}`;
}
function renderThx() {
  const t = S.thx;
  if (!t) return '';
  const left = S.thxLeft;
  if (left === 0) return '<p class="sub" style="margin:0">На сегодня респекты закончились — их три в день, так они ценнее. Завтра будут новые.</p>';
  return `<div class="thx-sheet">
    <p class="sub" style="margin:0"><b>${nk(t)}</b> получит пуш и +2 зерна. За что и от кого — увидит только получатель. ${left != null ? `Осталось ${left} из 3 на сегодня.` : ''}</p>
    <div class="chips">${THX_REASONS.map((r) => `<button class="chip" data-act="thx-reason" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <label class="field">За что респект (необязательно)<input id="thx-text" maxlength="80" placeholder="За помощь с отчётом"></label>
    <button class="btn" data-act="thx-send">hand Выразить респект</button>
  </div>`;
}
// Туториал «Как тут всё устроено»: раздел на вкладку или меню, пункты раскрываются, «Показать» ведёт туда
function guideHtml() {
  const open = S.guideOpen || null;
  return `<div class="guide">
    <p class="sub" style="margin:0">Нажми на раздел — расскажем, что там нажимать и зачем. «Показать» откроет это место в приложении.</p>
    <button class="btn ghost" data-act="guide-tour">${ico('spark', 18)} Пройти короткий тур с подсказками</button>
    ${GUIDE.map((g) => `<section class="guide-sec ${open === g.id ? 'on' : ''}">
      <button class="guide-head" data-act="guide-toggle" data-v="${g.id}" aria-expanded="${open === g.id}"><span class="guide-ico">${ico(g.icon, 20)}</span><span class="grow"><b>${esc(g.title)}</b><span class="small">${esc(g.lead)}</span></span><span class="chev" aria-hidden="true">${open === g.id ? '−' : '+'}</span></button>
      ${open === g.id ? `<dl class="guide-items">${g.items.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
        ${g.go ? `<button class="btn small" data-act="guide-go" data-v="${g.id}">Показать</button>` : ''}` : ''}
    </section>`).join('')}
  </div>`;
}
// «Что нового»: журнал изменений по дням (public/changelog.json)
async function loadChanges() { try { const r = await fetch('/changelog.json', { cache: 'no-cache' }); if (r.ok) S.changes = await r.json(); } catch {} }
const changesFresh = () => !!(S.changes && S.changes[0] && S.changes[0].day > (store.get('changesSeen', '') || ''));
function changesHtml() {
  if (!S.changes) return '<p class="small">Загружаю…</p>';
  const block = (title, list) => list && list.length ? `<div class="cl-kind">${title}</div><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const M = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const date = (d) => { const [, m, dd] = d.split('-').map(Number); return `${dd} ${M[m - 1]}`; };
  return `<div class="changelog">${S.changes.map((d) => `<section class="cl-day"><h4>${date(d.day)}</h4>${block('Новое', d.new)}${block('Стало удобнее', d.better)}${block('Починили', d.fix)}</section>`).join('')}
    <a class="linkbtn" href="/changelog.html" target="_blank" rel="noopener">Открыть отдельной страницей</a></div>`;
}
async function loadExperts(qs = '') { try { S.experts = { ...(await get('/api/experts?q=' + encodeURIComponent(qs))), q: qs }; } catch { S.experts = S.experts || null; } }
function renderExperts() {
  const x = S.experts;
  if (!x) return '';
  const res = x.q && x.q.length >= 2 ? (x.items.length ? x.items.map((p) => `<div class="expert">
      ${tap(p.id, avatar(p.look, 40))}
      <div class="grow" style="min-width:0"><div class="ex-head"><b>${esc(p.name || p.nick)}</b>${p.name ? `<span class="small">${nk(p)}</span>` : ''}</div>
        ${p.role ? `<div class="small ex-role">${esc(p.role)}</div>` : ''}
        <div class="chips">${p.allTags.map((t) => `<span class="chip ask-chip ${p.tags.includes(t) ? 'on' : ''}">${esc(t)}</span>`).join('')}</div>
        <div class="small">${p.office ? esc(p.office) : 'офис не указан'}${p.officeDay ? ` · в офисе ${esc(p.officeDay)}` : ''}</div></div>
      <button class="btn small ghost" data-act="dm-open" data-id="${p.id}" aria-label="Написать ${esc(p.nick)}">chat</button></div>`).join('') : `<p class="small" style="margin:0">Пока никто не указал «${esc(x.q)}» в своих темах. Спроси на доске — вопрос увидят те, у кого такая тема.</p>`) : '';
  const mp = (S.me && S.me.profile) || {};
  const mineEmpty = !((mp.askMe && mp.askMe.length) || mp.role);
  return `<section class="card experts"><div class="chats-head"><h3>help Кто знает?</h3><span class="small">кто за что отвечает</span></div>
    <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Тема</span><input id="ex-q" maxlength="40" value="${esc(x.q || '')}" placeholder="парковка, Jira, тарифы B2B…" enterkeyhint="search"></label><button class="btn" data-act="ex-find" aria-label="Найти">search</button></div>
    ${!x.q && x.popular.length ? `<div class="chips">${x.popular.map((t) => `<button class="chip ask-chip" data-act="ex-tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    ${res}
    ${mineEmpty ? '<button class="week-lock-strip" data-act="open-sec" data-v="work">'+ico('help', 16)+'<span>Тебя тоже могут искать: заполни «Чем занимаюсь» и «Спроси меня про». <b>Заполнить →</b></span></button>' : ''}
  </section>`;
}
// ----- Доска объявлений -----
// В «Офисе» — «На кухне» (угощение, висит час) и обычные объявления. Обед живёт в «Рядом»: renderLunchCard
const BOARD_CATS = [['all', 'Всё'], ['kitchen', 'Кухня'], ['other', 'Объявления']];
const minsLeft = (ts) => Math.max(1, Math.round((ts - Date.now()) / 60e3));
function renderBoardCard() {
  const b = S.board;
  if (!b) return '';
  const home = S.me.profile && S.me.profile.home;
  const gang = (S.me.gangs || [])[0] || null;
  const scope = S.boardScope === 'office' && !home ? 'all' : S.boardScope === 'gang' && !gang ? 'all' : S.boardScope || 'all';
  const cat = S.boardCat === 'kitchen' || S.boardCat === 'other' ? S.boardCat : 'all';
  const live = b.items.filter((x) => x.kind !== 'lunch' && (!x.expiresAt || x.expiresAt > Date.now()));
  const inScope = live.filter((x) => scope === 'all' || (scope === 'office' ? !x.gang && (!x.office || x.office.id === home) : x.gang && x.gang.id === gang.id));
  const inCat = (x, c) => c === 'all' || (c === 'other' ? x.kind !== 'lunch' && x.kind !== 'kitchen' : x.kind === c);
  // Угощение — наверх: оно живёт час
  const items = inScope.filter((x) => inCat(x, cat)).sort((p, q) => (!!q.expiresAt - !!p.expiresAt) || q.at - p.at);
  const chips = [['all', 'Весь Этаж'], home && ['office', 'Мой офис'], gang && ['gang', 'Банда']].filter(Boolean);
  const cnt = (c) => inScope.filter((x) => inCat(x, c)).length;
  const empty = {
    kitchen: 'На кухне яблоки, мармелад или торт после дня рождения? Напиши — объявление провисит час: обычно за это время всё разбирают.',
    gang: 'Здесь объявления только для своих: «Скинемся на торт», «Кто завтра в офисе?», «Отдам монитор». Видит только банда.',
    all: '«На кухне яблоки», «Отдам билеты», «Кто едет на конференцию», «Нашёл зонт на 5-м» — сюда. Объявление само исчезнет в срок. Позвать на обед — во вкладке «Рядом».'
  };
  const emptyText = cat === 'kitchen' ? empty.kitchen : scope === 'gang' ? empty.gang : empty.all;
  const newAct = `data-act="board-new" data-v="${cat === 'kitchen' ? 'kitchen' : 'other'}"`;
  return `<section class="card bboard"><div class="chats-head"><h3 class="has-art">${art('megaphone', 28)}Доска</h3><button class="linkbtn" ${newAct}>＋ ${cat === 'kitchen' ? 'Что на кухне' : 'Объявление'}</button></div>
    ${chips.length > 1 ? `<div class="chips">${chips.map(([v, t]) => `<button class="chip ${scope === v ? 'on' : ''}" data-act="board-filter" data-v="${v}">${t}</button>`).join('')}</div>` : ''}
    <div class="chips bp-cats">${BOARD_CATS.map(([v, t]) => { const n = v === 'all' ? 0 : cnt(v); return `<button class="chip small ${cat === v ? 'on' : ''}" data-act="board-cat" data-v="${v}">${v === 'kitchen' ? ico('gift', 14) + ' ' : ''}${t}${n ? ` <b>${n}</b>` : ''}</button>`; }).join('')}</div>
    ${items.length ? items.slice(0, S.boardAll ? 100 : 5).map(boardRow).join('') : `<p class="small" style="margin:0">${emptyText}</p>`}
    ${items.length > 5 && !S.boardAll ? `<button class="linkbtn" data-act="board-all">Ещё ${items.length - 5}</button>` : ''}
  </section>`;
}
// Одно объявление Доски: обед (время, кто идёт), угощение на кухне (таймер) или обычное
function boardRow(x) {
  const where = (x) => x.gang ? `только банда «${esc(x.gang.name)}»` : x.office ? esc(x.office.name) : 'весь Этаж';
  const people = (x) => x.fans && x.fans.length ? x.fans.map((f) => `<button class="linkbtn" data-act="dm-open" data-id="${f.id}">${nk(f)}</button>`).join(', ') : '';
  {
    const head = `<div class="row" style="gap:10px;align-items:flex-start">${tap(x.author.id, avatar(x.author.look, 36))}
      <div class="grow" style="min-width:0"><div class="bp-head"><b>${nk(x.author)}</b>${x.author.name ? `<span class="small">${esc(x.author.name)}</span>` : ''}<span class="bp-kind">${ico(x.icon, 14)} ${esc(x.kindName)}</span></div>`;
    const rep = `<button class="linkbtn bp-rep" data-act="report" data-type="board" data-id="${x.id}" aria-label="Пожаловаться">⚑</button>`;
    if (x.kind === 'lunch') {
      const going = people(x);
      return `<div class="bpost k-lunch">${head}
        <div class="bp-lunch"><span class="lunch-time">${esc(x.time)}</span><span class="grow">${x.place ? `<b>${esc(x.place)}</b>` : '<b>Обед</b>'}${x.text ? `<span class="bp-text">${esc(x.text)}</span>` : ''}</span></div>
        <div class="small">${going ? `идут: ${going}` : 'пока никто не присоединился'} · ${where(x)}</div></div></div>
      <div class="row bp-acts">${x.mine ? `<button class="btn small ghost" data-act="board-remove" data-id="${x.id}">Отменить сбор</button><span class="small">снимется сам, когда нажмёшь «Поел»</span>`
        : `<button class="btn small ${x.iMetoo ? 'ghost' : ''}" data-act="board-metoo" data-id="${x.id}">${x.iMetoo ? 'Не иду' : 'Я с вами'}</button><button class="chip" data-act="dm-open" data-id="${x.author.id}">Написать</button>${rep}`}</div></div>`;
    }
    if (x.kind === 'kitchen') {
      return `<div class="bpost k-kitchen">${head}
        <div class="bp-text">${esc(x.text)}</div>
        <div class="small">ещё ${minsLeft(x.expiresAt)} мин · ${where(x)}${x.mine && x.metoo ? ` · спасибо: ${x.metoo}` : ''}</div></div></div>
      <div class="row bp-acts">${x.mine ? `<button class="linkbtn" data-act="board-remove" data-id="${x.id}">Всё разобрали — снять</button>`
        : `<button class="chip ${x.iMetoo ? 'on' : ''}" data-act="board-metoo" data-id="${x.id}">${x.iMetoo ? 'check ' : ''}Спасибо!${x.metoo ? ' · ' + x.metoo : ''}</button>${rep}`}</div></div>`;
    }
    return `<div class="bpost k-${x.kind}">${head}
        <div class="bp-text">${esc(x.text)}</div>
        <div class="small">до ${ddmm(x.until)} · ${where(x)}${x.mine && x.fans && x.fans.length ? ` · откликнулись: ${people(x)}` : ''}</div></div></div>
    <div class="row bp-acts">${x.mine ? `<button class="linkbtn" data-act="board-remove" data-id="${x.id}">Снять</button>` : `<button class="chip ${x.iMetoo ? 'on' : ''}" data-act="board-metoo" data-id="${x.id}">${x.iMetoo ? 'check ' : ''}Я тоже${x.metoo ? ' · ' + x.metoo : ''}</button><button class="chip" data-act="dm-open" data-id="${x.author.id}">Написать</button>${rep}`}${x.mine && x.metoo ? `<span class="small">«я тоже» · ${x.metoo}</span>` : ''}</div></div>`;
  }
}
// «Кто на обед?» во вкладке «Рядом»: сборы на обед (это объявления Доски вида lunch) и кнопка «Позвать»
function renderLunchCard() {
  const b = S.board;
  if (!b) return '';
  const items = b.items.filter((x) => x.kind === 'lunch' && (!x.expiresAt || x.expiresAt > Date.now())).sort((p, q) => String(p.time).localeCompare(String(q.time)));
  const can = (b.lunchTimes || []).length > 0;
  if (!items.length && !can) return ''; // вечером звать уже некуда — карточку не показываем
  return `<section class="card bboard lunch-card"><div class="chats-head"><h3 class="has-art">${art('lunch', 28)}Кто на обед?</h3>${can ? '<button class="linkbtn" data-act="board-new" data-v="lunch">＋ Позвать</button>' : ''}</div>
    ${items.length ? items.slice(0, S.lunchAll ? 50 : 3).map(boardRow).join('') : '<p class="small" style="margin:0">Позови на обед: выбери время и где встречаетесь. Кто нажмёт «Я с вами» — тебе придёт пуш. Сбор снимется сам, когда отметишь в столовой «Поел».</p>'}
    ${items.length > 3 && !S.lunchAll ? `<button class="linkbtn" data-act="lunch-all">Ещё ${items.length - 3}</button>` : ''}
  </section>`;
}
function renderBoardNew() {
  const d = S.boardDraft;
  const kinds = (S.board && S.board.kinds) || [];
  const home = S.me.profile && S.me.profile.home;
  const homeName = home && S.cat.offices ? ((S.cat.offices.find((o) => o.id === home) || {}).name || 'мой офис') : 'мой офис';
  const min = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const max = new Date(Date.now() + 3 * 3600e3 + 14 * 864e5).toISOString().slice(0, 10);
  const gang = (S.me.gangs || [])[0] || null;
  const ci = S.state && S.state.checkin;
  const here = ci && ci.office !== home ? [ci.office, `Только ${esc(ci.name)}`] : null;
  const who = [['', 'Весь Этаж'], home && [home, `Только ${esc(homeName)}`], here, gang && ['gang', `Только банда «${esc(gang.name)}»`]].filter(Boolean);
  const cur = d.gang ? 'gang' : d.office || '';
  const offName = d.office === home ? homeName : here && d.office === here[0] ? ci.name : 'этот офис';
  const times = ((S.board && S.board.lunchTimes) || []).slice(0, 10); // ближайшие два с половиной часа
  const lunch = d.kind === 'lunch', kitchen = d.kind === 'kitchen';
  const ph = lunch ? 'Например: новая пиццерия на Арбате, берём столик на шестерых' : kitchen ? 'Яблоки, груши и мармелад на кухне 3-го этажа' : 'Отдам два билета в театр на субботу';
  const audience = d.gang ? 'Объявление увидит только твоя банда' + (lunch ? ', и каждому придёт пуш.' : '.') : d.office ? `Объявление увидят в «${esc(offName)}» и все, кто смотрит весь Этаж.` : 'Объявление видят все.';
  const life = lunch ? 'Кто нажмёт «Я с вами» — придёт пуш. Сбор снимется сам через час после обеда или когда ты отметишь в столовой «Поел».'
    : kitchen ? (d.office && !d.gang ? 'Кто сейчас отмечен в этом офисе, получит пуш. ' : '') + 'Провисит час — обычно за это время всё разбирают.' : '«Я тоже» придёт тебе пушем, дальше — в личке. Не дольше двух недель, потом исчезнет само.';
  return `${lunch ? '' : `<div class="field">О чём<div class="chips">${kinds.filter((k) => k.id !== 'lunch').map((k) => `<button class="chip ${d.kind === k.id ? 'on' : ''}" data-act="board-kind" data-v="${k.id}">${ico(k.icon, 14)} ${esc(k.name)}</button>`).join('')}</div></div>`}
    ${lunch ? `<div class="field">Во сколько${times.length ? `<div class="chips">${times.map((t) => `<button class="chip ${d.time === t ? 'on' : ''}" data-act="board-time" data-v="${t}">${t}</button>`).join('')}</div>` : '<p class="small" style="margin:0">На сегодня обеды уже закончились — позвать можно завтра с 11:00.</p>'}</div>
      <label class="field">Где встречаемся<input id="bd-place" maxlength="40" placeholder="У лифтов на 3 этаже" value="${esc(d.place || '')}"></label>` : ''}
    <label class="field">${lunch ? 'Пара слов (необязательно)' : 'Текст'}<textarea id="bd-text" maxlength="200" rows="${lunch ? 2 : 3}" placeholder="${ph}">${esc(d.text)}</textarea></label>
    ${lunch || kitchen ? '' : `<div class="row" style="gap:10px"><label class="field grow">Висит до<input id="bd-until" type="date" min="${min}" max="${max}" value="${esc(d.until)}"></label></div>`}
    ${who.length > 1 ? `<div class="field">Кому<div class="chips">${who.map(([v, t]) => `<button class="chip ${cur === v ? 'on' : ''}" data-act="board-office" data-v="${v}">${t}</button>`).join('')}</div></div>` : ''}
    <p class="small" style="margin:0">${audience} ${life}</p>
    <button class="btn" data-act="board-save" ${lunch && !times.length ? 'disabled' : ''}>${lunch ? 'Позвать на обед' : 'Повесить'}</button>`;
}
const findBar = () => `<button class="find-bar" data-act="find-open">${ico('search', 18)}<span>Найти: ник, имя или почта</span></button>`;

function renderFind() {
  const f = S.find || {};
  const res = f.items ? (f.items.length ? f.items.map((x) => {
    let act = '';
    if (x.shared.length) act = `<button class="btn small" data-act="dm-open" data-id="${x.id}">Написать</button>`;
    else if (x.company) act = `<button class="btn small" data-act="find-crew" data-v="${esc(x.nick)}">В подельники</button>`;
    else if (!S.me.gangs.length) act = '<span class="small">сначала сколоти банду</span>';
    const inv = x.invitable.map((g) => g.pending ? `<span class="chip" style="cursor:default">«${esc(g.name)}» · ждём ответа</span>` : `<button class="chip" data-act="find-invite" data-gang="${g.id}" data-id="${x.id}">Позвать в «${esc(g.name)}»</button>`).join('');
    return `<div class="find-row"><div class="person2">${tap(x.id, avatar(x.look, 40))}<div class="grow" style="min-width:0"><div style="font-weight:900">${nk(x)}</div>
      <div class="where ellipsis">${[x.company ? `из ${x.company}` : '', x.name, x.status, x.shared.length ? 'в банде ' + x.shared.join(', ') : ''].filter(Boolean).map(esc).join(' · ') || 'пока не в твоих бандах'}</div></div>${act}</div>
      ${inv ? `<div class="chips">${inv}</div>` : ''}</div>`;
  }).join('') : `<p class="sub">${esc(f.hint || 'Никого не нашли')}</p>`) : '<p class="small">Ник — по части, например «енот». Имя — только если человек открыл его всем. Почта — целиком, например ivanov@вашакомпания.ru. Коллег из другой компании ищем только по нику целиком или по почте. Мы сравниваем отпечаток и сами адреса не храним.</p>';
  return `<div class="row"><label class="field grow" style="gap:0"><span class="hidden">Ник, имя или почта</span><input id="find-q" maxlength="80" autocapitalize="off" autocomplete="off" placeholder="Ник, имя или рабочая почта" value="${esc(f.q || '')}" aria-label="Ник, имя или рабочая почта"></label><button class="btn" data-act="find-go">Найти</button></div>
    ${res}
    <p class="small" style="margin:0">Позвать можно только в свою банду — человек сам решит, вступать ли. Не хочешь, чтобы тебя находили, — выключи в профиле: «Приватность, звук и уведомления».</p>`;
}

// ===== Вкладка «Чаты»: банды и личные переписки одним списком =====
// «Моя банда» в Чатах: банда одна — значит, одна большая карточка с главным. Без банды — герой-одиночка
const LONER_LINES = [
  'Ты — герой-одиночка: ни банды, ни знамени, только ветер в ушах и кофе из автомата.',
  'Одинокий воин бродит по этажам. Говорят, у костра банды теплее — и обед там вкуснее.',
  'Кто ты, воин? Самурай без господина. Найди своих или собери дружину сам|сама.'
];
function renderMyGang(gangs, seenG) {
  if (!gangs.length) {
    const line = LONER_LINES[(new Date().getUTCDate()) % LONER_LINES.length];
    return `<section class="card loner"><div class="loner-ico" aria-hidden="true">swords</div>
      <h3 style="margin:0">Моя банда</h3>
      <p class="sub" style="margin:0">${meG(line, line.replace('герой-одиночка', 'героиня-одиночка').replace('Одинокий воин бродит', 'Одинокая воительница бродит').replace('Кто ты, воин? Самурай без господина.', 'Кто ты, воительница? Ронин без господина.'))} Банда — это общий чат, зовы на кофе, события, Лига и герб на знамени.</p>
      <div class="row"><button class="btn grow" data-act="gang-find">search Найти</button><button class="btn violet grow" data-act="open" data-v="gang-new">＋ Сколотить</button></div>
      <button class="linkbtn" data-act="open" data-v="gang-new" style="align-self:center">Есть ссылка-приглашение? Вставь её здесь</button></section>`;
  }
  const card = (x) => {
    const unread = x.last && !x.last.mine && x.lastAt > (seenG[x.id] || 0);
    const lg = x.league;
    const facts = [
      `room ${x.members} ${plural(x.members, 'человек', 'человека', 'человек')}${x.inOffice ? ` · office ${x.inOffice} в офисе` : ''}`,
      lg ? `trophy ${lg.place ? `${lg.place} место в Лиге недели` : lg.eligible ? 'в Лиге — пока без очков' : 'в Лигу — от 3 человек'}` : '',
      x.next ? `cal ${esc(x.next.title)} — ${x.next.day === new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10) ? 'сегодня' : `${x.next.day.slice(8)}.${x.next.day.slice(5, 7)}`}${x.next.time ? ' ' + x.next.time : ''}` : ''
    ].filter(Boolean);
    const flags = [
      x.crestVote && !x.crestVote.voted ? '<span class="mg-flag">shield голосуем за герб</span>' : '',
      x.wars && x.wars.incoming ? '<span class="mg-flag hot">swords вас вызывают на битву</span>' : '',
      x.wars && x.wars.myTurn ? '<span class="mg-flag hot">swords твой выход в битве</span>' : x.wars && x.wars.active ? `<span class="mg-flag">swords битв идёт: ${x.wars.active}</span>` : '',
      x.owner && S.state && S.state.badges && S.state.badges.gangRequests ? `<span class="mg-flag hot">hand хотят в банду: ${S.state.badges.gangRequests}</span>` : '',
      x.polls ? `<span class="mg-flag">chart ${x.polls} ${plural(x.polls, 'опрос', 'опроса', 'опросов')} без тебя</span>` : ''
    ].join('');
    return `<button class="my-gang" data-act="gang-open" data-id="${x.id}">
      <span class="mg-crest ${auraCls(x)}">${crestSvg(crestOf(x), { size: 64, full: true })}</span>
      <span class="grow" style="min-width:0;display:flex;flex-direction:column;gap:3px">
        <span class="mg-name">${gangName(x)}</span>
        ${x.motto ? `<span class="small" style="font-style:italic">«${esc(x.motto)}»</span>` : ''}
        ${facts.map((f) => `<span class="small">${f}</span>`).join('')}
        ${flags ? `<span class="mg-flags">${flags}</span>` : ''}
        <span class="where ellipsis ${unread ? 'unread' : ''}">${x.last ? `chat ${x.last.mine ? 'Ты' : esc(x.last.who || '')}: ${esc(x.last.text || '')}` : 'chat Сообщений пока нет — начни первым|первой'}</span>
      </span><span class="chev" aria-hidden="true">›</span></button>`;
  };
  return `<section class="card chats"><div class="chats-head"><h3>${gangs.length > 1 ? 'Мои банды' : 'Моя банда'}</h3></div>
    ${gangs.length > 1 ? `<div class="note warn" style="margin:0">Теперь банда может быть только одна — выйди из лишних. Очки Лиги идут в «${esc(gangs[0].name)}».</div>` : ''}
    ${gangs.map(card).join('')}</section>`;
}

// Что именно новое в «Чатах». Красная цифра на вкладке — ровно сумма этих пунктов, и каждый виден строкой
// вверху «Чатов» с переходом туда, где это лежит. Раньше в цифру попадали «дела Этажа», которых в чатах уже нет
function chatNews() {
  const b = (S.state && S.state.badges) || {};
  const g = (S.me && S.me.gangs && S.me.gangs[0]) || null;
  return [
    { n: b.chat || 0, t: (n) => `${n} ${plural(n, 'сообщение', 'сообщения', 'сообщений')} в банде`, act: g ? `data-act="gang-open" data-id="${g.id}"` : '' },
    { dm: true, n: b.crew || 0, t: (n) => `${n} ${plural(n, 'сообщение', 'сообщения', 'сообщений')} в личке`, act: 'data-act="chats-jump" data-v=".chats-dm"' },
    { n: b.invites || 0, t: (n) => n === 1 ? 'Тебя зовут в банду' : `${n} приглашения в банды`, act: 'data-act="chats-jump" data-v=".chats-inv"' },
    { n: b.gangRequests || 0, t: (n) => `${n} ${plural(n, 'заявка', 'заявки', 'заявок')} в банду`, act: g ? `data-act="gang-reqs" data-id="${g.id}"` : '' },
    { n: b.polls || 0, t: (n) => `${n} ${plural(n, 'опрос', 'опроса', 'опросов')} без твоего голоса`, act: g ? `data-act="gang-open" data-id="${g.id}"` : '' }
  ].filter((x) => x.n > 0);
}
function renderChatNews() {
  const items = chatNews();
  if (!items.length) return '';
  return `<section class="chat-news" aria-label="Что нового">${items.map((x) => `<button class="cn-item" ${x.act}><span class="cn-n">${x.n > 9 ? '9+' : x.n}</span><span class="grow">${esc(x.t(x.n))}</span><span aria-hidden="true">›</span></button>`).join('')}</section>`;
}

// Строка «Этаж» первой в чатах: что ждёт тебя сейчас
function renderInboxRow() {
  const items = S.inbox || [];
  const n = inboxNew();
  const line = items.length ? items[0].title + (items.length > 1 ? ` и ещё ${items.length - 1}` : '') : 'Всё сделано. Можно и поработать';
  return `<button class="chat-row inbox-row" data-act="inbox-open"><img class="inbox-ava" src="/icons/icon-192.png" alt="" width="42" height="42">
    <span class="grow" style="min-width:0"><span class="chat-title">Этаж <span class="small">· что ждёт тебя</span></span><span class="where ellipsis ${n ? 'unread' : ''}">${esc(line)}</span></span>
    <span class="crew-side">${n ? `<span class="crew-badge">${n > 9 ? '9+' : n}</span>` : items.length ? `<span class="small">${items.length}</span>` : ''}</span></button>`;
}
function renderInbox() {
  const items = S.inbox || [];
  const h = S.state && S.state.msk ? Number(S.state.msk.slice(0, 2)) : new Date().getHours();
  const hi = h < 12 ? 'Доброе утро' : h < 17 ? 'Привет' : 'Добрый вечер';
  const intro = items.length ? `${hi}! Вот что тебя ждёт. Пункт пропадёт сам, как только сделаешь.` : `${hi}! Всё сделано: ни ходов, ни заданий, ни блица. Можно и поработать.`;
  return `<div class="inbox">
    <div class="inbox-msg">${esc(intro)}</div>
    ${items.map((x) => `<button class="inbox-item k-${x.kind}" data-act="inbox-go" data-go='${esc(JSON.stringify(x.go))}'><span class="inbox-ico">${ico(x.icon, 20)}</span>
      <span class="grow" style="min-width:0"><b>${esc(x.title)}</b>${x.text ? `<span class="small">${esc(x.text)}</span>` : ''}</span><span aria-hidden="true">›</span></button>`).join('')}
    <p class="small" style="margin:6px 2px 0">Раз в рабочий день, около 11:30, пришлю короткую сводку пушем — только если ты ещё не заходил${meG('', 'а')} и есть что-то кроме заданий дня. Отключается в профиле → «Приватность».</p>
  </div>`;
}
function renderChats() {
  if (S.dm) return S.battle ? renderBattle() : renderDm();
  const invCard = (S.invites || []).length ? `<section class="card chats-inv"><h3>Тебя зовут в банду</h3>${S.invites.map((i) => `<div class="person2">${gangBadge(i.gang, 38)}
      <div class="grow" style="min-width:0"><div style="font-weight:900">${esc(i.gang.name)}</div><div class="where">${i.gang.members} ${plural(i.gang.members, 'человек', 'человека', 'человек')} · зовёт ${esc(i.from)}</div></div>
      <button class="btn small" data-act="invite-accept" data-id="${i.id}">Вступить</button><button class="btn small ghost" data-act="invite-decline" data-id="${i.id}" aria-label="Отказаться">Нет</button></div>`).join('')}</section>` : '';
  if (!S.dmList) {
    const has = S.me.gangs.length > 0;
    return `${has ? '' : pageHead('Банда', 'Свои люди, общий чат, зовы и Лига')}${invCard}${has ? '' : renderMyGang([], {})}${has ? renderGang() : ''}`;
  }
  const c = S.chats;
  if (!c) return pageHead('Личка', 'Голубиная почта') + '<div class="card"><p class="sub">Загружаем…</p></div>';
  const seenG = store.get('seenGang', {});
  const reqs = c.requests.length ? `<section class="card"><h3>Хотят переписываться</h3>${c.requests.map((p) => `<div class="person2">${tap(p.id, avatar(p.look, 36))}<div class="grow ellipsis" style="font-weight:800;min-width:0">${nk(p)}</div>
      <button class="btn small" data-act="crew-accept" data-id="${p.id}">Принять</button><button class="btn small ghost" data-act="crew-decline" data-id="${p.id}" aria-label="Отклонить">✕</button></div>`).join('')}</section>` : '';
  const row = (x) => {
    if (x.type === 'gang') {
      const unread = x.last && !x.last.mine && x.lastAt > (seenG[x.id] || 0);
      return `<button class="chat-row" data-act="gang-open" data-id="${x.id}">
        <span class="chat-gang-crest">${gangBadge(x, 42)}</span>
        <span class="grow" style="min-width:0"><span class="chat-title">${esc(x.name)} <span class="small">· ${x.members}</span></span>
          <span class="where ellipsis ${unread ? 'unread' : ''}">${x.last ? `${x.last.mine ? 'Ты' : esc(x.last.who || '')}: ${esc(x.last.text || '')}` : 'Сообщений пока нет — начни первым|первой'}</span></span>
        <span class="crew-side">${x.lastTime ? `<span class="small">${x.lastTime}</span>` : ''}${x.polls ? `<span class="poll-badge" title="Опросы без твоего голоса">chart ${x.polls}</span>` : unread ? '<span class="crew-badge">•</span>' : ''}</span></button>`;
    }
    const [w, color] = x.where ? whereText(x) : ['', '#C9D1EA'];
    const turn = (S.battles || []).find((b) => b.oppId === x.id && b.myTurn && b.status !== 'done');
    return `<div class="dm-line ${x.closed ? 'closed' : ''}"><button class="chat-row" data-act="dm-open" data-id="${x.id}">
      <span class="ava-wrap"><span class="ava-ring" style="border-color:${color}">${avatar(x.look, 32)}</span>${x.where ? `<span class="ava-dot" style="background:${color}"></span>` : ''}</span>
      <span class="grow" style="min-width:0"><span class="chat-title">${x.crew ? '<span class="fav-star" title="Подельник">★</span> ' : ''}${nk(x)}</span><span class="where ellipsis ${x.unread ? 'unread' : ''}">${x.closed ? 'lock ' : ''}${x.last ? `${x.last.mine ? 'Ты: ' : ''}${esc(x.last.text || '')}` : esc(w)}</span></span>
      <span class="crew-side">${turn ? '<span class="crew-turn" title="Твой ход в морском бою">anchor</span>' : ''}${x.lastTime ? `<span class="small">${x.lastTime}</span>` : ''}${x.unread ? `<span class="crew-badge">${x.unread > 9 ? '9+' : x.unread}</span>` : ''}</span></button>
      <button class="dm-x" data-act="dm-close" data-id="${x.id}" aria-label="${x.closed ? 'Убрать из списка' : 'Закрыть личку с ' + esc(x.nick)}" title="${x.closed ? 'Убрать из списка' : 'Закрыть личку'}">×</button></div>`;
  };
  const gangs = c.items.filter((x) => x.type === 'gang');
  const dms = c.items.filter((x) => x.type !== 'gang');
  const dmUnread = dms.reduce((a, x) => a + (x.unread || 0), 0);
  const head = (title, n, act, label, hot) => `<div class="chats-head"><h3>${title}${n ? ` <span class="chats-n ${hot ? 'hot' : ''}">${n}</span>` : ''}</h3><button class="linkbtn" data-act="open" data-v="${act}">＋ ${label}</button></div>`;
  const gangList = gangs.length ? gangs.map(row).join('')
    : '<p class="sub chats-empty">Ты пока ни в одной банде. Сколоти свою — у неё будет общий чат и зовы на кофе и обед.</p><button class="btn" data-act="open" data-v="gang-new">Сколотить банду</button>';
  const favs = c.favorites || [];
  const favStrip = `<div class="fav-head"><span class="small"><b>★ Подельники</b> · им можно писать всегда</span><button class="linkbtn" data-act="open" data-v="crew">${favs.length ? 'все' : '＋ добавить'}</button></div>
    ${favs.length ? `<div class="fav-strip">${favs.map((f) => { const [, col] = whereText(f); return `<button class="fav" data-act="dm-open" data-id="${f.id}"><span class="ava-ring" style="border-color:${col}">${avatar(f.look, 40)}</span><span class="ellipsis">${nk(f)}</span></button>`; }).join('')}</div>` : ''}`;
  const dmList = dms.length ? dms.map(row).join('')
    : `<div class="empty-art">${art('dove', 84)}</div>` + '<p class="sub chats-empty">Голуби скучают. Напиши кому-нибудь — лично можно любому, кто не закрыл личку: найди по нику или открой карточку человека.</p>';
  return `<div class="dml-head">${pageHead('Личка', 'Найди человека, напиши ему, добавь в подельники')}<button class="dml-x" data-act="dmlist-close" aria-label="Закрыть личку">✕</button></div>
    ${findBar()}
    ${reqs}
    ${store.get('inviteShared') ? `<button class="invite-mini" data-act="crew-share" aria-label="Позвать коллегу в Этаж, +15 зёрен за новичка"><span class="im-ico" aria-hidden="true">mail</span><span class="im-t">Позвать коллегу в Этаж</span><span class="im-pill">+15 ${BEAN}</span><span class="im-go" aria-hidden="true">›</span></button>` : `<button class="invite-app" data-act="crew-share"><span class="grow"><b>Позвать коллегу в Этаж</b><span class="small">Личная ссылка: придёт — сразу будете на связи. +15 зёрен за каждого новичка</span></span><span aria-hidden="true">mail</span></button>`}
    <section class="card chats chats-dm">${head('Переписки', dmUnread ? `${dmUnread} ${plural(dmUnread, 'новое', 'новых', 'новых')}` : '', 'dm-pick', 'Написать', true)}${favStrip}<p class="small chats-hint">Один на один · видите только вы двое · × закрывает переписку у обоих</p>${dmList}</section>`;
}

// ===== Вкладка «Офис»: столовая, Доска, сигналы и лента =====
function renderOfficeTab() {
  const st = S.state;
  if (!st) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  const where = st.checkin ? `Ты в офисе «${esc(st.checkin.name)}»` : 'Доска, «Кто знает?» и что нового на этаже';
  return `${pageHead('Офис', where)}
    ${st.checkin && st.canteen ? renderCanteen() : officeGate()}
    ${renderBoardCard()}
    ${renderExperts()}
    ${renderFeed()}`;
}
// До отметки — одна строка вместо трёх пустых карточек. Вечером не зовём отмечаться: отметки откроются утром
function officeGate() {
  const st = S.state;
  if (st.night) return `<section class="st-strip"><span class="st-ico">${ico('moon', 20)}</span><span class="grow"><b>Офисы спят до утра</b><span class="small">Столовая, обед компанией и сигналы откроются после утренней отметки</span></span></section>`;
  return `<section class="st-strip"><span class="st-ico">${ico('lunch', 20)}</span><span class="grow"><b>Столовая и сигналы</b><span class="small">Видны тем, кто отметился в офисе</span></span><button class="btn small" data-act="tab" data-v="near">Отметиться</button></section>`;
}

// ===== Вкладка «Игры»: задания, квизы, морской бой, кофе, ачивки, Лавка =====
// ----- Праздники: адвент-календарь и Тайный Санта -----
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayHuman = (d) => `${Number(d.slice(8, 10))} ${MONTHS_GEN[Number(d.slice(5, 7)) - 1]}`;
function renderAdvent(compact = false) {
  const a = S.advent;
  if (!a || !a.active) return '';
  const t = a.today;
  if (compact) {
    if (t.opened) return '';
    return `<button class="adv-strip" data-act="tab" data-v="games"><span class="adv-strip-n">${t.n}</span><span class="grow"><b>Окошко адвента ждёт</b><span class="small">${t.kind === 'open' ? 'Сегодня без задания — просто открой' : esc(t.title)}</span></span><span aria-hidden="true">→</span></button>`;
  }
  const lead = (new Date(Date.parse(a.days[0].day + 'T12:00:00Z')).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: lead }, () => '<span class="adv-d pad"></span>').join('')
    + a.days.map((d) => `<span class="adv-d ${d.state}${d.rest ? ' rest' : ''}" aria-label="${d.n} декабря: ${d.state === 'done' ? 'открыто' : d.state === 'missed' ? 'пропущено' : d.state === 'today' ? 'сегодня' : 'впереди'}">${d.state === 'done' ? ico('check', 14) : d.n}</span>`).join('');
  const prog = Math.min(a.count, a.goal);
  const task = t.kind === 'open'
    ? (t.opened ? `<p class="adv-fact">${esc(t.text)}</p>` : '<p class="small">Сегодня выходной, задания нет. Открой окошко — внутри факт про Новый год.</p>')
    : `<p class="small">${esc(t.text)}</p>`;
  const btn = t.opened ? `<div class="adv-done">${ico('check', 16)} Открыто, +2 зерна. Завтра новое окошко</div>`
    : t.ready ? '<button class="btn" data-act="advent-open">Открыть окошко · +2</button>'
    : '<button class="btn ghost" disabled>Сначала задание</button>';
  return `<section class="card adv">
    <div class="row" style="justify-content:space-between"><span class="card-title">tree Адвент-календарь</span><span class="small">${a.count} из 31</span></div>
    <div class="adv-week" aria-hidden="true">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((x) => `<i>${x}</i>`).join('')}</div>
    <div class="adv-grid">${cells}</div>
    <div class="adv-today">
      <div class="adv-day">${dayHuman(t.day)} · <b>${esc(t.title)}</b></div>
      ${task}
      ${btn}
    </div>
    <div class="adv-goal">
      <div class="adv-bar"><i style="width:${Math.round(prog / a.goal * 100)}%"></i></div>
      <span class="small">${a.garland ? 'Гирлянда твоя — она в конструкторе аватара, раздел «Аксессуары»' : `Ещё ${a.goal - prog} — и ёлочная гирлянда для аватара. Для неё хватит ${a.goal} окошек из 31, так что выходные можно пропускать`}</span>
    </div>
  </section>`;
}
// Новогоднее оформление карточки: гирлянда сверху, хвойные ветки по углам, сугроб снизу. Текст — на чистом поле посередине
const nyDeco = () => '<div class="ny-deco" aria-hidden="true"><img class="ny-fir l" src="/art/ny/fir.webp" alt=""><img class="ny-fir r" src="/art/ny/fir.webp" alt=""><div class="ny-garland" style="--ny:-' + (Date.now() % 12000) + 'ms"><img src="/art/ny/garland.webp" alt=""><i style="left:5.8%;top:56%"></i><i style="left:18.1%;top:69%"></i><i style="left:31.3%;top:73%"></i><i style="left:44.2%;top:63%"></i><i style="left:56.3%;top:63%"></i><i style="left:69%;top:73%"></i><i style="left:82.3%;top:69%"></i><i style="left:94.2%;top:54%"></i></div><img class="ny-snow" src="/art/ny/snow.webp" alt=""><img class="ny-balls" src="/art/ny/balls.webp" alt=""></div>';
function renderSanta() {
  const s = S.santa;
  if (!s || !s.visible) return '';
  if (s.status === 'cancelled') return s.joined ? '<section class="card santa"><span class="card-title">gift Тайный Санта</span><p class="sub">В этом году не состоялся: записалось меньше трёх человек.</p></section>' : '';
  const dd = dayHuman(s.drawDay);
  const draw = s.canDraw ? `<button class="btn btn-santa-draw" data-act="santa-draw">${ico('dice', 18)} Провести жеребьёвку сейчас</button><span class="small" style="text-align:center">Ты владелец банды — можно не ждать ${dd}</span>` : '';
  let body;
  if (s.status === 'drawn') {
    body = !s.joined ? `<p class="sub">Жеребьёвка прошла без тебя: участников ${s.count}, подарки вручены ${s.gifted}.</p>`
      : `<div class="santa-target"><span class="small">Ты даришь</span><b>${esc(s.target ? s.target.nick : '—')}</b>
          ${s.target && s.target.wish ? `<p>«${esc(s.target.wish)}»</p>` : '<p class="small">Пожелания нет — придётся угадывать.</p>'}<span class="small">Бюджет — до ${s.budget || 500} ₽</span></div>
        ${s.myGifted ? `<div class="adv-done">${ico('check', 16)} Подарок вручён</div>` : '<button class="btn" data-act="santa-gifted">Подарок вручён</button>'}
        <p class="small" style="margin:0">Вручено ${s.gifted} из ${s.count}. Кто дарит тебе — секрет. Видно его только в момент вручения.</p>`;
  } else if (s.joined) {
    const wishBox = S.santaEdit
      ? `<label class="field">Пожелание для своего Санты<textarea id="santa-wish" maxlength="200" rows="2" placeholder="Что любишь и чего дарить не надо">${esc(s.wish)}</textarea></label>
        <div class="row" style="gap:8px"><button class="btn small grow" data-act="santa-wish">Сохранить</button><button class="linkbtn santa-quiet" data-act="santa-edit">Отмена</button></div>`
      : `<div class="santa-wish"><span class="small">Твоё пожелание</span><p>${s.wish ? `«${esc(s.wish)}»` : '<span class="small">Пока пусто — Санте придётся угадывать</span>'}</p>
        <button class="btn small btn-santa-edit" data-act="santa-edit">${ico('pencil', 16)} ${s.wish ? 'Редактировать пожелание' : 'Написать пожелание'}</button></div>`;
    body = `<p class="sub">Ты участвуешь. Записалось ${s.count}, жеребьёвка ${dd}${s.count < s.min ? `, нужно хотя бы ${s.min}` : ''}. Подарок — до ${s.budget || 500} ₽.</p>
      ${wishBox}
      ${draw}
      <div class="row" style="justify-content:center"><button class="linkbtn santa-quiet" data-act="santa-leave">${ico('x', 14)} Не участвую</button></div>`;
  } else if (s.regOpen) {
    body = `<p class="sub">Каждый тайно готовит подарок одному человеку из банды. Запишись и напиши, что любишь. ${dd} пройдёт жеребьёвка, и каждый узнает, кому дарит. Записалось: ${s.count}.</p>
      <div class="santa-rule">Подарок — <b>до ${s.budget || 500} ₽</b>. Дороже не надо: смысл во внимании, а не в цене</div>
      <label class="field">Пожелание<textarea id="santa-wish" maxlength="200" rows="2" placeholder="Люблю чай и настолки, сладкое не дарите"></textarea></label>
      <button class="btn" data-act="santa-join">Участвую</button>${draw}`;
  } else return '';
  return `<section class="card santa ny">${nyDeco()}<div class="row ny-head" style="justify-content:space-between"><span class="card-title has-art"><img class="art" src="/art/ny/gift.webp" width="34" height="37" alt="">Тайный Санта</span><span class="small">${s.status === 'drawn' ? 'жеребьёвка прошла' : `до ${dd}`}</span></div>${body}</section>`;
}

function renderGames() {
  if (S.practice) return renderPractice();
  const gangChips = S.me.gangs.length > 1 ? `<div class="chips dark">${S.me.gangs.map((g) => `<button class="chip ${g.id === S.activeGang ? 'on' : ''}" data-act="gang-select" data-v="${g.id}">${esc(g.name)}</button>`).join('')}</div>` : '';
  const group = (title) => `<div class="g-group">${title}</div>`;
  const ownQuiz = renderQuiz();
  const ownGuess = renderGuess();
  return `${pageHead('Игры', 'Блиц, квизы и бои со своими. За победы — зёрна, их тратят в Лавке')}
    ${renderAdvent()}
    
    ${renderBlitzCard()}
    ${group('Один на один')}
    ${renderDuelsCard()}
    ${ownQuiz || ownGuess ? group('Про своих') : ''}
    ${ownQuiz}
    ${ownGuess ? gangChips : ''}
    ${ownGuess}
    ${group('Банды')}
    ${renderLeagueCard()}
    ${renderTourCard()}`;
}
// Случайный кофе — это знакомства, а не игра: живёт во вкладке «Рядом», рядом с «Совпадаем»
function renderCoffeeStrip() {
  const f = S.fx, c = f && f.coffee;
  if (!COFFEE_ON || !c) return '';
  const p = c.pair;
  const hot = !!(p && (p.canReply || !p.ping));
  const sub = !c.optIn ? 'Раз в неделю — пара на кофе с коллегой из другой банды' : !p ? 'Пару подберём в понедельник' : `Пара этой недели — ${esc(p.partner.nick)}`;
  return `<button class="coffee-strip ${hot ? 'hot' : ''}" data-act="open" data-v="coffee"><span class="gq-ico">${p ? avatar(p.partner.look, 40) : ico('coffee', 22)}${hot ? '<i class="gq-dot" aria-label="ждёт ответа"></i>' : ''}</span><span class="grow"><b>Случайный кофе</b><span class="small">${sub}</span></span><span class="chev" aria-hidden="true">›</span></button>`;
}
// Старые быстрые иконки «Игр» — больше не показываются (ачивки — в профиле, Лавка — в шапке)
function renderGamesQuick() {
  const f = S.fx;
  const c = f && f.coffee;
  const p = c && c.pair;
  const coffeeSub = !c ? '' : !c.optIn ? 'знакомства' : !p ? 'пара в пн' : esc(p.partner.nick);
  const coffeeHot = !!(c && ((p && p.canReply) || (p && !p.ping)));
  const got = f ? f.achievements.filter((a) => a.got).length : 0;
  const tile = (act, v, icon, title, sub, hot, cls) => `<button class="gq ${cls}" data-act="${act}" data-v="${v}">
    <span class="gq-ico">${p && cls === 'coffee' ? avatar(p.partner.look, 40) : ico(icon, 22)}${hot ? '<i class="gq-dot" aria-label="ждёт ответа"></i>' : ''}</span>
    <b>${title}</b><span>${sub}</span></button>`;
  return `<div class="g-quick">
    ${tile('open', 'coffee', 'coffee', 'Случайный кофе', coffeeSub, coffeeHot, 'coffee')}
    ${tile('open-sec', 'ach', 'medal', 'Ачивки', f ? `${got} из ${f.achievements.length}` : '', false, 'ach')}
    ${tile('open', 'shop', 'cart', 'Лавка', `${S.me.beans} зёрен`, false, 'shop')}
  </div>`;
}

function renderOffice() {
  const st = S.state;
  if (!st) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  if (st.night) {
    return `${renderToday()}${renderBirthdays()}<div class="card"><h2>Офисы засыпают</h2><p class="sub">После 19:00 отметки сбрасываются. Утром отметься снова — увидишь, кто из банды рядом и есть ли очередь в столовой.</p></div>${renderTomorrow()}${renderCoffee()}${renderGangNow()}`;
  }
  if (!st.checkin) {
    return `${renderToday()}<div class="card">
      <h2>${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? 'Всё-таки в офисе?' : 'Где ты сегодня?'}</h2>
      <p class="sub">Отметься — и увидишь свой офис: кто из банды рядом и есть ли очередь в столовой. Зёрна растут с серией дней: от +3 до +8.</p>
      ${officePicker()}
      <p class="small">Отметка действует до 19:00 или пока не нажмёшь «${meG('Ушёл', 'Ушла')}». Видно только офис, где ты ${meG('отметился', 'отметилась')}.</p>
      ${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? '' : `<div class="today-grid">
        <button class="btn ghost" data-act="today" data-v="home">home Из дома</button>
        <button class="btn ghost" data-act="open" data-v="sick">thermo Болею</button>
        <button class="btn ghost" data-act="open" data-v="vacation">sun В отпуске</button>
        <button class="btn ghost" data-act="today" data-v="slack">Отлыниваю</button></div>
        <p class="small">Не отметишься и ничего не выберешь — после 11:00 банда увидит шуточный статус вроде «в астрале».</p>`}
    </div>${renderBirthdays()}${renderCompletion()}${renderQuiz()}${renderCoffee()}${renderGangNow()}`;
  }
  const here = st.gangNow.rows.filter((r) => r.where === 'office' && r.office === st.checkin.office).length;
  const hour = Number(st.msk.slice(0, 2));
  const since = st.checkin.since || '';
  return `
  <section class="office-card">
    <div class="office-pic">${officeSvg({ office: st.checkin.office, crowd: here, hour, flag: S.gang && S.gang.gang.flag ? S.gang.gang.color : null, label: esc('Офис ' + st.checkin.name + (here ? ', из банды здесь: ' + here : '')) })}</div>
    <div class="office-info">
      <div class="row" style="align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="display:flex;flex-direction:column;gap:2px">
          <span class="eyebrow">Ты в офисе</span>
          <span class="office-name">${esc(st.checkin.name)}</span>
        </div>
        <button class="icon-btn" data-act="open" data-v="office" aria-label="Сменить офис">${ico('swap', 16)}</button>
      </div>
      <span class="small">с ${since} · из банды здесь <b style="color:var(--tint-g-fg)">${here}</b> · до 19:00</span>
      <button class="btn small ghost" style="align-self:flex-start" data-act="checkout">${meG('Ушёл домой', 'Ушла домой')}</button>
    </div>
  </section>
  ${renderBirthdays()}
  
  ${renderCompletion()}
  ${renderQuiz()}
  ${renderQuickCalls()}
  ${renderCanteen()}
  ${renderCoffee()}
  ${renderGangNow()}
  ${renderSignalsMini()}`;
}

function renderQuickCalls() {
  if (!S.me.gangs.length) return '';
  const gang = S.activeGang || S.me.gangs[0].id;
  const items = [['coffee', 'На кофе', '#8B5A2B', '#5E3B1A'], ['lunch', 'На обед', '#1F7A3A', '#155C2B'], ['where', 'Ты где?', '#0E7490', '#0A5468']];
  return `<section class="qcalls" aria-label="Быстрые зовы банде">
    ${items.map(([k, label, bg, shade]) => `<button class="qcall" style="--c:${bg}" data-act="call-open" data-kind="${k}" data-gang="${gang}">${art({ coffee: 'coffee', lunch: 'lunch', where: 'pin' }[k], 34)}${label}</button>`).join('')}
    <button class="qcall" style="--c:#6B7594" data-act="gang-open" data-id="${gang}">${ico('more', 22)}Ещё</button>
  </section>${renderQuickExtra(gang)}`;
}

// Шаблоны зовов и «В фокусе» — под быстрыми зовами
function tplLabel(t) {
  const def = S.cat.calls[t.kind] || { label: t.kind };
  return [def.label, t.opt, t.text, t.to ? t.toNick : null].filter(Boolean).join(' · ');
}
function renderQuickExtra(gang) {
  const p = S.me.profile || {};
  const tpls = (p.callTpl || []).filter((t) => S.me.gangs.some((g) => g.id === t.gang));
  const f = p.focus && p.focus > Date.now() ? p.focus : null;
  // Одна аккуратная строка: шаблоны (листаются вбок), карандаш и «В фокус». Подсказка про шаблоны — в окне зова
  const focusBtn = f
    ? `<button class="qx-pill qx-focus on" data-act="focus-off" aria-label="Выйти из фокуса">${ico('focus', 16)}<span>${tpls.length ? '' : 'В фокусе '}до ${hhmm(f)}</span>${ico('x', 13)}</button>`
    : `<button class="qx-pill qx-focus" data-act="open" data-v="focus">${ico('focus', 16)}<span>В фокус</span>${tpls.length ? '' : '<span class="qx-sub">· пуши на паузу</span>'}</button>`;
  const chips = tpls.map((t, i) => `<button class="qx-pill qx-tpl${S.tplEdit ? ' edit' : ''}" data-act="${S.tplEdit ? 'tpl-del' : 'tpl-send'}" data-i="${i}" aria-label="${S.tplEdit ? 'Удалить шаблон' : 'Отправить'}: ${esc(tplLabel(t))}">${ico(S.tplEdit ? 'x' : 'star', 14)}<span>${esc(tplLabel(t))}</span></button>`).join('');
  return `<div class="qx${tpls.length ? '' : ' solo'}">
    ${tpls.length ? `<div class="qx-tpls">${chips}</div><button class="qx-pill qx-edit${S.tplEdit ? ' on' : ''}" data-act="tpl-edit" aria-label="${S.tplEdit ? 'Готово' : 'Изменить шаблоны'}">${ico(S.tplEdit ? 'check' : 'pencil', 15)}</button>` : ''}
    ${focusBtn}
  </div>`;
}

// Неделя банды: в первый рабочий день недели — отпуска, больничные и дни рождения
function renderWeekNote() {
  const w = S.state && S.state.weekNote;
  if (!w || store.get('weekNoteHidden', '') === w.week) return '';
  const row = (icon, title, list) => list.length ? `<div class="wn-row">${icon === 'cake' ? art('popper', 22) : ico(icon, 16)}<span><b>${title}</b> ${list.map((x) => `${esc(x.nick)}${x.text ? ` <span class="small">${esc(x.text)}</span>` : ''}`).join(', ')}</span></div>` : '';
  return `<section class="card wn">
    <div class="row" style="justify-content:space-between"><span class="card-title">${ico('cal', 18)}Неделя банды</span><button class="icon-btn" data-act="weeknote-hide" data-v="${esc(w.week)}" aria-label="Скрыть">${ico('x', 15)}</button></div>
    ${row('sun', 'В отпуске:', w.vac)}${row('thermo', 'Болеет:', w.sick)}${row('cake', 'День рождения:', w.bday)}
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
        <span class="${c.wait ? 'ttl-wait' : 'ttl-ok'}" style="font-size:13px;font-weight:700">${c.wait ? `Очередь ≈ ${c.wait} мин` : 'Очереди нет'}${c.lowData ? '<span class="small" title="Мало отметок за 15 минут. Отмечайся в столовой — оценка станет точнее"> · примерно, мало отметок</span>' : ''}</span>
      </div>
      ${st.inCanteen
        ? '<button class="btn green" data-act="canteen-out">Поел</button>'
        : '<button class="btn" style="white-space:nowrap" data-act="canteen-in">Я тут · +2</button>'}
    </div>
    ${bars}
    ${c.tone === 'good' && !c.wait && !bars ? '' : `<p class="note ${c.advice.tone}" style="margin:0">${esc(c.advice.text)}</p>`}
    ${renderFood()}
  </section>`;
}

// Оценка обеда: thumbUp/thumbDown, метки и комментарий для модератора. Коллеги видят только сводку
function renderFood() {
  const f = S.fx && S.fx.food;
  if (!f) return '';
  const sum = f.n ? `<div class="food-sum"><span class="food-pct ${f.upPct >= 60 ? 'good' : f.upPct >= 40 ? 'mid' : 'bad'}">thumbUp ${f.upPct}%</span><span>${f.n} ${plural(f.n, 'оценка', 'оценки', 'оценок')} сегодня${f.top.length ? ' · ' + f.top.map((t) => `«${esc(t.toLowerCase())}»`).join(', ') : ''}</span></div>` : '';
  if (!f.canRate) return sum ? `<div class="food">${sum}</div>` : '';
  const d = S.foodDraft;
  if (f.mine && !d) {
    // Свою оценку человек и так помнит — показываем общую сводку и одну ссылку «изменить мою»
    return `<div class="food"><div class="row" style="justify-content:space-between;gap:8px">${sum || '<span class="small">Оценка принята</span>'}<button class="linkbtn" style="flex:none" data-act="food-edit">изменить мою</button></div></div>`;
  }
  if (!d) {
    return `<div class="food">${sum}<div class="food-q">Как обед?</div><div class="row"><button class="btn grow food-up" data-act="food-pick" data-v="1">thumbUp Понравилось</button><button class="btn ghost grow" data-act="food-pick" data-v="0">thumbDown Не очень</button></div></div>`;
  }
  const tags = d.up ? f.tagsUp : f.tagsDown;
  return `<div class="food">${sum}<div class="food-q">${d.up ? 'thumbUp Что понравилось?' : 'thumbDown Что не так?'} <span class="small">до 3</span></div>
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

const addDaysC = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const ddmm = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');
const focusOn = (r) => !!(r && r.focus && r.focus > Date.now());
const hhmm = (ts) => new Date(ts).toTimeString().slice(0, 5);
function whereText(r) {
  if (focusOn(r)) { const [t, c] = whereText1(r); return [`в фокусе до ${hhmm(r.focus)} · ${t}`, c]; }
  return whereText1(r);
}
function whereText1(r) {
  const [t, c] = whereText0(r);
  return r.vacSoon ? [`с ${ddmm(r.vacSoon)} в отпуске · ${t}`, c] : [t, c];
}
function whereText0(r) {
  if (r.where === 'office') return [r.officeName || officeName(r.office), '#1F7A3A'];
  if (r.where === 'home') return [r.planned ? 'из дома (по плану)' : 'работает из дома', '#2563C9'];
  if (r.where === 'plan_office') return ['собирается в офис (по плану)', '#7BC79A'];
  if (r.where === 'vacation') return [r.until === (S.state && S.state.today) ? 'в отпуске сегодня' : `в отпуске до ${ddmm(r.until)}`, '#F97316'];
  if (r.where === 'sick') return [r.until && r.until !== (S.state && S.state.today) ? `болеет до ${ddmm(r.until)} — выздоравливай!` : 'болеет — выздоравливай!', '#DC2626'];
  if (r.where === 'slack') return [gw(r.look, 'отлынивает (сам признался)', 'отлынивает (сама призналась)'), '#A855F7'];
  if (r.where === 'idle') return [(gw(r.look, S.cat.idleJokes, S.cat.idleJokesF || S.cat.idleJokes) || [])[r.joke] || 'в астрале', '#9AA3B5'];
  if (r.where === 'weekend') return [r.holiday ? `выходной · ${r.holiday.replace(/ \(.*\)$/, '')}` : 'выходной', '#9AA3B5'];
  if (r.where === 'none') return ['ещё в пути', '#9AA3B5'];
  if (r.where === 'night') return ['офисы спят', '#9AA3B5'];
  return ['место не показывает', '#9AA3B5'];
}

// Плашка «мой статус сегодня» над выбором офиса
function renderToday() {
  const st = S.state;
  const p = st.presence;
  const next = renderVacSoon();
  if (p.where === 'vacation') {
    return `<section class="card vac-soon">
      <div class="vac-main">
        <div class="vac-num"><b class="w">отпуск</b><span>${p.until === st.today ? 'сегодня' : `до ${ddmm(p.until)}`}</span></div>
        <div class="vac-info">
          ${st.vacNow ? `<div class="vac-range">${st.vacNow.restDays > 1 ? `${st.vacNow.restDays} ${plural(st.vacNow.restDays, 'день', 'дня', 'дней')}` : 'последний день'}</div><div class="vac-sub">выходить ${st.vacNow.backDow.toLowerCase()} ${ddmm(st.vacNow.back)}</div>` : ''}
          <div class="vac-sub">Банда видит «в отпуске», зовы без пушей</div>
        </div>
      </div>
      <div class="vac-acts"><button class="vac-btn" data-act="vac-end">Вышел|Вышла из отпуска</button><button class="vac-btn" data-act="open" data-v="profile">График</button></div>
    </section>`;
  }
  if (p.where === 'sick') {
    return `<section class="card" style="background:var(--tint-r)">
      <h2>thermo Болеешь${p.until !== st.today ? ` до ${ddmm(p.until)}` : ' сегодня'}</h2>
      <p class="sub">Выздоравливай! Банда видит «болеет», зовы не присылают пуши. Причину и подробности никто не видит.</p>
      <button class="btn ghost" data-act="today" data-v="">Выздоровел|Выздоровела</button>
    </section>`;
  }
  if (p.where === 'slack') {
    return `<section class="card" style="background:var(--tint-v)">
      <h2>Сегодня отлыниваешь</h2>
      <p class="sub">Честность — лучшая политика. Банда видит «отлынивает (${meG('сам признался', 'сама призналась')})».</p>
      <button class="btn ghost" data-act="today" data-v="">Ладно, работаю</button>
    </section>${next}`;
  }
  if (p.where === 'idle') return next; // шутка про «не отметился» — подзаголовком в карточке «Где ты сегодня?»
  if (p.where === 'home' && !p.planned) {
    return `<section class="st-strip"><span class="st-ico">${ico('home', 20)}</span><span class="grow"><b>Сегодня из дома</b><span class="small">Банда видит «работает из дома». Приедешь — отметься в офисе</span></span><button class="btn small ghost" data-act="today" data-v="">Отменить</button></section>${next}`;
  }
  if (p.where === 'home') {
    return `<section class="card">
      <h2>home Сегодня из дома${p.planned ? '?' : ''}</h2>
      <p class="sub">${p.planned ? 'Так в твоём плане на этот день недели. Подтверди — банда увидит, что ты на связи из дома. +5 зёрен, как за офис, и задание «Отметься» засчитается.' : 'Отметка стоит: банда видит «работает из дома». Приедешь — просто отметься в офисе.'}</p>
      ${p.planned ? '<button class="btn" data-act="today" data-v="home">Да, сегодня из дома</button>' : '<div class="row" style="gap:8px;align-items:center"><span class="note good grow" style="margin:0">✓ Отмечено</span><button class="btn small ghost" data-act="today" data-v="">Отменить</button></div>'}
    </section>${next}`;
  }
  return next;
}

// Скорый отпуск: обратный отсчёт, «2 дня отпуска → 5 дней отдыха», что сделать до ухода
function renderVacSoon() {
  const v = S.state.nextVacation;
  if (!v) return '';
  const range = `${ddmm(v.from)}${v.to !== v.from ? `–${ddmm(v.to)}` : ''}`;
  if (v.in > 21) return `<div class="vac-far">sun Следующий отпуск ${range} · через ${v.in} ${plural(v.in, 'день', 'дня', 'дней')}</div>`;
  const bonus = v.restDays > v.vacDays;
  const ann = store.get('vacAnn:' + v.from);
  const hasGang = S.me.gangs.length > 0;
  const n = v.restIn ?? v.in;
  const big = n === 1 ? 'завтра' : v.workLeft === 0 ? 'вот-вот' : '';
  const today = S.state.today;
  const dowOf = (d) => ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(d + 'T00:00:00Z').getUTCDay()];
  const lastLabel = v.lastWork === today ? 'сегодня' : v.lastWork === addDaysC(today, 1) ? 'завтра' : `${dowOf(v.lastWork)} ${ddmm(v.lastWork)}`;
  const segs = v.workLeft > 0 && v.workLeft <= 10 ? `<div class="vac-prog"><div class="vac-segs">${Array.from({ length: v.workLeft }, () => '<i></i>').join('')}</div><span>${v.workLeft === 1 ? `последний рабочий день — <b>${lastLabel}</b>` : `ещё ${v.workLeft} ${plural(v.workLeft, 'рабочий день', 'рабочих дня', 'рабочих дней')}, последний — <b>${lastLabel}</b>`}</span></div>` : '';
  return `<section class="card vac-soon">
    <div class="vac-main">
      <div class="vac-num">${big ? `<b class="w">${big}</b>` : `<b>${n}</b>`}<span>${big ? 'отпуск' : `${plural(n, 'день', 'дня', 'дней')} до отпуска`}</span></div>
      <div class="vac-info">
        <div class="vac-range">${range}</div>
        <div class="vac-sub">${bonus ? `${v.vacDays} ${plural(v.vacDays, 'день', 'дня', 'дней')} отпуска = <b>${v.restDays} ${plural(v.restDays, 'день', 'дня', 'дней')} отдыха</b>` : `<b>${v.restDays} ${plural(v.restDays, 'день', 'дня', 'дней')} отдыха</b>`}</div>
        <div class="vac-sub">выходить ${v.backDow.toLowerCase()} ${ddmm(v.back)}</div>
      </div>
    </div>
    ${segs}
    <div class="vac-acts">
      ${hasGang ? (ann ? '<span class="vac-done">\uE000check\uE001 Банда в курсе</span>' : '<button class="vac-btn" data-act="vac-tell">\uE000megaphone\uE001 Сказать банде</button>') : ''}
      ${hasGang ? '<button class="vac-btn" data-act="vac-party">\uE000party\uE001 Проводы</button>' : ''}
      ${!S.me.profile.vacationLook ? '<button class="vac-btn" data-act="ava-open-vac">\uE000glasses\uE001 Образ для отпуска</button>' : ''}
    </div>
  </section>`;
}
const officeName = (id) => (S.cat.offices.find((o) => o.id === id) || {}).name || '';

function renderGangNow() {
  const g = S.state.gangNow;
  if (!g.hasGang) {
    return `<section class="card"><h3>Моя банда сейчас</h3><p class="sub">Ты пока ни в одной банде. Сколоти свою или вступи по ссылке от своих.</p>
      <button class="btn blue" data-act="open" data-v="gang-new">Создать банду</button></section>`;
  }
  const dnd = (meG(S.cat.moods, S.cat.moodsF || S.cat.moods)).dnd;
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
      <div class="grow"><div style="font-weight:700;font-size:15px" class="tapname" data-act="person" data-id="${r.id}">${nk(r)}</div>${r.name ? `<div class="realname">${esc(r.name)}</div>` : ''}
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
      <span class="poll-txt"><span>${esc(o.text)}${o.lead ? ' trophy' : ''}</span>${o.addedBy ? `<span class="poll-by">вариант от ${esc(o.addedBy)}</span>` : ''}${p.voted || p.closed ? who(o.voters) : ''}</span>
      ${p.voted || p.closed ? `<span class="poll-pct">${o.pct}%</span>` : ''}</button>`).join('')}</div>
    ${p.canAdd ? `<div class="row poll-add"><label class="field grow" style="gap:0"><span class="hidden">Свой вариант</span><input id="poll-add-${p.id}" maxlength="40" placeholder="Свой вариант"></label><button class="btn small ghost" data-act="poll-add" data-id="${p.id}">Добавить</button></div>` : ''}
    ${p.mine && !p.closed ? `<button class="linkbtn" data-act="poll-close" data-id="${p.id}">Завершить опрос</button>` : ''}
  </div>`;
}
// ----- События банды: встречи, сабантуи, дни рождения -----
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
function evWhen(e) {
  const d = new Date(e.day + 'T00:00:00Z');
  const rel = e.inDays === 0 ? 'сегодня' : e.inDays === 1 ? 'завтра' : e.inDays === 2 ? 'послезавтра' : e.inDays < 0 ? '' : `через ${e.inDays} ${plural(e.inDays, 'день', 'дня', 'дней')}`;
  return { dd: d.getUTCDate(), mon: MON_GEN[d.getUTCMonth()].slice(0, 3), wd: WD_SHORT[d.getUTCDay()], rel };
}
function renderGEvent(e) {
  const w = evWhen(e);
  const btn = (a, label) => `<button class="chip ${e.my === a ? 'on' : ''}" data-act="gev-rsvp" data-id="${e.id}" data-v="${a}">${label}</button>`;
  return `<div class="gev ${e.past ? 'past' : ''} ${e.inDays === 0 ? 'today' : ''}">
    <div class="gev-date"><b>${w.dd}</b><span>${w.mon}</span><i>${w.wd}</i></div>
    <div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:4px">
      <div class="gev-title">${gevIco(e.kind)} ${esc(e.title)}</div>
      ${e.guest ? `<div class="gev-joint">${e.host.id === S.activeGang ? `вместе с бандой «${esc(e.guest.name)}»` : `зовёт банда «${esc(e.host.name)}»`}</div>` : ''}
      <div class="small">${[w.rel, e.time, e.place && 'where ' + esc(e.place)].filter(Boolean).join(' · ')}${e.past ? 'прошло' : ''}</div>
      ${e.note ? `<div class="small gev-note">${esc(e.note)}</div>` : ''}
      <div class="gev-who">${e.yes.slice(0, 8).map((p) => `<span title="${esc(p.nick)}">${avatar(p.look, 22)}</span>`).join('')}<span class="small">${e.yes.length ? `идут ${e.yes.length}` : 'пока никто не идёт'}${e.maybe.length ? ` · может ${e.maybe.length}` : ''}${e.no ? ` · не смогут ${e.no}` : ''}</span></div>
      ${e.past ? '' : `<div class="chips">${btn('yes', 'thumbUp Иду')}${btn('maybe', 'Может быть')}${btn('no', 'Не смогу')}</div>`}
      <div class="small">автор: ${esc(e.author)}${e.canEdit ? ` · <button class="linkbtn" data-act="gev-edit" data-id="${e.id}">изменить</button>` : ''}${e.canCancel && !e.past ? ` · <button class="linkbtn" data-act="gev-cancel" data-id="${e.id}">отменить</button>` : ''}</div>
    </div></div>`;
}
function renderGEvents() {
  const v = S.gev;
  if (!v) return '';
  const sug = v.suggestions.length ? `<div class="gev-sug"><span class="small"><b>Повод есть:</b></span>${v.suggestions.map((x, i) => `<button class="chip" data-act="gev-new" data-sug="${i}">${esc(x.hint)} ＋</button>`).join('')}</div>` : '';
  return `<section class="card gevents">
    <div class="chats-head"><h3>cal События${v.upcoming.length ? ` <span class="chats-n">${v.upcoming.length}</span>` : ''}</h3><button class="linkbtn" data-act="gev-new">＋ Событие</button></div>
    ${v.upcoming.length ? v.upcoming.map(renderGEvent).join('') : '<p class="small" style="margin:4px 0 0">Встречи, сабантуи к праздникам, дни рождения — всё, ради чего банда собирается вне созвонов. Создать может любой.</p>'}
    ${sug}
    ${v.past.length ? `<details><summary class="small" style="cursor:pointer;min-height:32px">Недавно прошли (${v.past.length})</summary>${v.past.map(renderGEvent).join('')}</details>` : ''}
  </section>`;
}
// Подсказка: сворачиваемый блок «?» с правилами. Открытость запоминаем, чтобы не мешала
function hint(id, title, html) {
  const open = !!(S.hintOpen && S.hintOpen[id]);
  return `<details class="hint" data-hint="${id}" ${open ? 'open' : ''}><summary><span class="hint-q" aria-hidden="true">?</span>${title}</summary><div class="hint-body">${html}</div></details>`;
}
const WAR_RULES = (r) => `<ol class="ol">
  <li><b>Кто бросает вызов.</b> Владелец банды: выбирает соперника, вид битвы и героя. Обе банды — от 3 человек.</li>
  <li><b>Ответ — ${r.pendingDays} дня.</b> Владелец соперника принимает и выставляет своего героя или отказывается. Молчание = отказ, отказы видны в статистике банды.</li>
  <li><b>Срок битвы — 5 рабочих дней</b> с момента, как вызов приняли. Праздники и выходные не считаются.</li>
  <li><b>Блиц:</b> 3 минуты вопросов по теме. Первым проходит герой принявшей банды, потом — вызвавшей. Счёт скрыт до итога. Больше верных — победа, поровну — побеждает тот, кто быстрее. Не успел — техническое поражение.</li>
  <li><b>Морской бой:</b> быстрая партия героев, по 1,5 минуты на часах.</li>
  <li><b>Ограничения:</b> не больше 2 битв у банды сразу, с одной бандой — одна битва и пауза ${r.rematchDays} дней перед реваншем. По одной теме банда бьётся один раз.</li>
  <li><b>Награда:</b> герою-победителю +${r.prizeHero} зёрен, всей его банде по +${r.prizeTeam} и очки в Лигу.</li></ol>`;
const HERO_RULES = `<ul class="ol">
  <li>Нажми «hand Готов быть героем» — владелец увидит тебя первым|первой в списке.</li>
  <li><b>Ротация:</b> кто бился за банду в прошлый раз, в следующей битве не выходит — пусть пробуют все.</li>
  <li>Не сможешь — откажись до старта, владелец назначит замену. После старта отказаться нельзя.</li>
  <li>Рядом с ником — сколько раз был героем и сколько побед.</li></ul>`;
const BET_RULES = (max) => `<ul class="ol">
  <li>Ставит любой член банды — от 1 до ${max} зёрен, <b>только за свою банду</b>. Против своих ставить нельзя.</li>
  <li>Ставки открыты, пока герои не начали: в блице — до старта первого героя, в морском бою — пока партия не пошла.</li>
  <li>Победители забирают свои ставки и делят банк проигравших пропорционально ставкам. Ничья или отмена — всё возвращается.</li></ul>`;
function warHeroPick(members, sel, act) {
  return `<div class="hero-list">${members.map((p) => `<button class="hero-opt ${sel === p.id ? 'on' : ''}" data-act="${act}" data-v="${p.id}" ${p.rotation ? 'disabled' : ''}>
    ${avatar(p.look, 34)}<span class="grow" style="min-width:0"><b class="ellipsis">${nk(p)}${p.volunteer ? ' hand' : ''}</b>
    <span class="small">${p.rotation ? 'бился в прошлый раз — ротация' : p.wars ? `героем ${p.wars} ${plural(p.wars, 'раз', 'раза', 'раз')} · побед ${p.wins}` : 'ещё не был героем'}</span></span></button>`).join('')}</div>`;
}

// ===== Казна банды: слава и оформление =====
const gst = (g) => (g && g.style) || {};
const gItemName = (id) => ((S.cat.gangItems || []).find((x) => x.id === id) || {}).name || '';
// Название банды с купленной плашкой и статусом
function gangName(g, cls = '') {
  const st = gst(g);
  return `<span class="gname ${st.plate ? 'pl ' + st.plate : ''} ${cls}">${esc(g.name)}</span>${st.status ? `<span class="gstatus">${esc(gItemName(st.status))}</span>` : ''}`;
}
const auraCls = (g) => (gst(g).aura ? 'aura ' + gst(g).aura : '');
async function loadTreasury() { try { S.tr = await get(`/api/gangs/${S.activeGang}/treasury`); } catch { S.tr = null; } }
function trPreview(it, g) {
  const fake = { ...g, style: { ...gst(g), [it.slot]: it.id } };
  if (it.slot === 'plate') return `<span class="gname pl ${it.id}">${esc(g.name)}</span>`;
  if (it.slot === 'status') return `<span class="gstatus">${esc(it.name)}</span>`;
  if (it.slot === 'aura') return `<span class="g-crest ${auraCls(fake)}">${crestSvg(crestOf(g), { size: 34 })}</span>`;
  if (it.slot === 'cardbg') return `<span class="g-banner mini ${it.id}"></span>`;
  return `<span class="chat-prev ${it.id}"><i>Привет, банда!</i></span>`;
}
function renderTreasury() {
  const t = S.tr;
  const g = S.gang && S.gang.gang;
  if (!t || !g) return '<p class="sub">Загружаем…</p>';
  const G = t.glory;
  const v = t.vote;
  const vote = v ? `<div class="tr-vote"><b>vote Голосуем: «${esc(v.item.name)}» за ${v.item.price} славы</b>
      <span class="small">Автор — ${esc(v.author)} · за — ${v.za}, против — ${v.protiv} из ${v.members}. Досрочно решит ${v.needEarly}, иначе через ${Math.max(0, Math.round((v.endsAt - Date.now()) / 3600e3))} ч при кворуме ${v.quorum}. Голос тайный.</span>
      <div class="row"><button class="btn small grow ${v.my === 1 ? 'green' : ''}" data-act="tr-vote" data-v="1">thumbUp За${v.my === 1 ? ' ✓' : ''}</button><button class="btn small ghost grow" data-act="tr-vote" data-v="-1">thumbDown Против${v.my === -1 ? ' ✓' : ''}</button></div></div>` : '';
  const action = (it) => {
    if (it.owned) return t.isOwner ? `<button class="btn small ${it.equipped ? 'worn' : 'ghost wear'}" data-act="tr-equip" data-v="${it.id}" data-slot="${it.slot}" data-on="${it.equipped ? '0' : '1'}">${it.equipped ? 'check Надето' : 'Надеть'}</button>` : `<span class="small">${it.equipped ? 'надето' : 'есть'}</span>`;
    const short = t.balance < it.price;
    if (it.needVote) return `<button class="btn small ${short ? 'ghost' : ''}" data-act="tr-buy" data-v="${it.id}" ${short || v ? 'disabled' : ''}>vote ${it.price}</button>`;
    return t.isOwner ? `<button class="btn small" data-act="tr-buy" data-v="${it.id}" ${short ? 'disabled' : ''}>bank ${it.price}</button>` : `<span class="small">bank ${it.price}</span>`;
  };
  return `<div class="tr-head"><span class="tr-coin" aria-hidden="true">bank</span><div><b class="tr-bal">${t.balance}</b><span class="small">славы в казне банды «${esc(g.name)}»</span></div></div>
    <p class="small" style="margin:0">Слава — общая валюта банды, за общие победы. Личные зёрна сюда не идут и отсюда не берутся.</p>
    ${hint('tr-earn', 'Как копится слава и кто тратит', `<ul class="ol">
      <li>Победа в битве банд — +${G.warWin}, ничья — +${G.warDraw}.</li>
      <li>Лига недели: 1–3 место — +${G.weekly.join(' / +')}. Лига месяца — +${G.monthly.join(' / +')}.</li>
      <li>Кубок месяца: чемпион — +${G.tourWin}, финалист — +${G.tourFinal}.</li>
      <li>Каждый день, когда банда «в сборе» (отметились 70%, не меньше трёх), — +${G.together}.</li>
      <li><b>Тратить:</b> до ${t.voteFrom} славы — владелец, покупка видна в чате. От ${t.voteFrom} — любой член банды выносит на тайное голосование: досрочно решает больше половины, иначе через 48 часов при кворуме в треть банды.</li>
      <li>За славу — только внешний вид. Очки Лиги, победы и лимиты не покупаются.</li></ul>`)}
    ${vote}
    ${Object.entries(t.slots).map(([slot, title]) => `<h3 style="margin:8px 0 0">${title}</h3>
      ${t.items.filter((it) => it.slot === slot).map((it) => `<div class="tr-item ${it.equipped ? 'on' : ''}"><span class="tr-prev">${trPreview(it, g)}</span><span class="grow"><b>${esc(it.name)}</b><span class="small">${it.needVote ? 'голосованием банды' : 'покупает владелец'}</span></span>${action(it)}</div>`).join('')}`).join('')}
    ${t.history.length ? `<h3 style="margin:8px 0 0">История</h3><div class="tr-hist">${t.history.map((h) => `<div><span>${esc(h.item ? `${h.reason}: ${h.item}` : h.reason)}</span><b class="${h.amount > 0 ? 'plus' : 'minus'}">${h.amount > 0 ? '+' : ''}${h.amount}</b></div>`).join('')}</div>` : ''}`;
}

// ===== Турнир банд =====
async function loadTour() { try { S.tour = await get('/api/tourney'); if (S.tour && S.tour.off) S.tour = null; } catch { S.tour = null; } }
const TOUR_RULES = (r) => `<ol class="ol">
  <li><b>Запись</b> — с 15-го числа до старта. Записывает владелец, в банде — от 3 человек.</li>
  <li><b>Старт</b> — за 6 рабочих дней до конца месяца. До ${r.maxTeams} банд, сетка — по очкам Лиги месяца: сильные получают слабых, лишним — проход без боя.</li>
  <li><b>Матч</b> — блиц героев на 3 минуты по теме раунда, на матч — ${r.roundDays} рабочих дня. Героя назначает владелец, ротация действует. Ничья — проходит банда выше в Лиге.</li>
  <li><b>Призы:</b> чемпиону — Кубок в профиль банды и по ${r.prizeChamp} зёрен каждому, финалисту — по ${r.prizeFinal}.</li></ol>`;
const ddmmT = (d) => `${d.slice(8)}.${d.slice(5, 7)}`;
function renderTourCard() {
  const t = S.tour;
  if (!t) return '';
  const line = t.status === 'reg' ? (t.regOpen ? `запись открыта до ${ddmmT(t.startDay)}` : `запись с ${ddmmT(t.regFrom)}, старт ${ddmmT(t.startDay)}`)
    : t.status === 'running' ? `идёт ${t.rounds.length ? t.rounds[t.rounds.length - 1].name : ''}` : t.status === 'done' ? `чемпион — «${t.champion ? esc(t.champion.name) : '—'}»` : 'перенесён: банд не хватило';
  return `<section class="card tour-card"><div class="row" style="justify-content:space-between"><span class="card-title has-art">${art('cup', 30)}${esc(t.title)}</span><span class="small">${line}</span></div>
    <p class="small" style="margin:0">Турнир банд на выбывание: блиц героев, сетка до 8 банд.${t.teams.length ? ` Записались: ${t.teams.length}.` : ''}${t.registered ? ' <b>Твоя банда в деле.</b>' : ''}</p>
    ${t.last && t.last.champion ? `<p class="small" style="margin:0">Прошлый кубок — «${esc(t.last.champion.name)}»</p>` : ''}
    <button class="btn small" data-act="tourney-open">Сетка и правила</button></section>`;
}
function renderTourney() {
  const t = S.tour;
  if (!t) return '<p class="sub">Загружаем…</p>';
  const team = (g, win) => (g ? `<span class="tm ${win ? 'win' : ''} ${g.mine ? 'mine' : ''}">${crestSvg(crestOf(g), { size: 22 })}<span class="ellipsis">${esc(g.name)}</span></span>` : '<span class="tm bye">проход без боя</span>');
  const bracket = t.rounds.length ? `<div class="bracket">${t.rounds.map((r) => `<div class="br-round"><div class="br-name">${esc(r.name)}<span class="small"> · ${esc(r.topic)}</span></div>
      ${r.matches.map((m) => `<div class="br-match">${team(m.a, m.winner && m.winner === (m.a || {}).id)}${team(m.b, m.winner && m.b && m.winner === m.b.id)}</div>`).join('')}</div>`).join('')}</div>` : '';
  const reg = t.status === 'reg' ? (t.canRegister ? `<button class="btn ${t.registered ? 'ghost' : 'war-call'}" data-act="tourney-reg" data-v="${t.registered ? 'off' : 'on'}">${t.registered ? 'Сняться с турнира' : 'trophy Записать банду'}</button>`
    : `<p class="small" style="margin:0">${t.regOpen ? (t.myGangSmall ? 'В турнире — банды от 3 человек.' : t.registered ? 'Твоя банда записана.' : 'Записывает владелец банды.') : `Запись откроется ${ddmmT(t.regFrom)}.`}</p>`) : '';
  return `${t.status === 'done' && t.champion ? `<div class="tour-champ">${crestSvg(crestOf(t.champion), { size: 90, full: true, motto: t.champion.name })}<b>Чемпион: «${esc(t.champion.name)}»</b>${t.runnerUp ? `<span class="small">финалист — «${esc(t.runnerUp.name)}»</span>` : ''}</div>` : ''}
    <div class="tour-dates"><div><b>${ddmmT(t.regFrom)}</b><span>запись</span></div><div><b>${ddmmT(t.startDay)}</b><span>старт</span></div><div><b>${t.teams.length}</b><span>${plural(t.teams.length, 'банда', 'банды', 'банд')}</span></div></div>
    ${reg}
    ${bracket || (t.teams.length ? `<div class="g-tags big">${t.teams.map((g) => `<i>${esc(g.name)}</i>`).join('')}</div>` : '')}
    ${hint('tour-rules', 'Регламент турнира', TOUR_RULES(t.rules))}`;
}

// ===== Битвы банд =====
const fmtLeft = (ms) => { if (ms <= 0) return 'время вышло'; const h = Math.floor(ms / 3600e3); return h >= 24 ? `${Math.floor(h / 24)} дн ${h % 24} ч` : `${h} ч ${Math.floor((ms % 3600e3) / 60e3)} мин`; };
async function loadWars() {
  if (!S.activeGang) { S.wars = null; return; }
  try { S.wars = await get(`/api/gangs/${S.activeGang}/wars`); } catch { S.wars = null; }
}
function warSide(sd, label) {
  return `<div class="war-side ${sd.mine ? 'mine' : ''}">${crestSvg(crestOf(sd), { size: 46 })}<b class="ellipsis">${esc(sd.name)}</b>
    <span class="small">${label}: ${sd.hero ? nk(sd.hero) : '—'}</span>
    ${sd.run && (sd.run.done || sd.run.playing) ? `<span class="war-run">${sd.run.done ? (sd.run.score !== null ? `check ${sd.run.score} верных · ${sd.run.secs} с` : 'check прошёл') : 'wait проходит'}</span>` : ''}</div>`;
}
function renderWar(w) {
  const kind = w.kind === 'blitz' ? `Блиц «${esc(w.topic.title)}»` : 'anchor Быстрый морской бой';
  const status = w.status === 'pending' ? 'ждёт ответа' : w.status === 'active' ? `идёт · осталось ${fmtLeft(w.endsAt - Date.now())}` : w.winner === 'us' ? 'trophy Победа!' : w.winner === 'them' ? 'Поражение' : 'Ничья';
  const acts = [];
  if (w.canAccept) acts.push(`<button class="btn small" data-act="war-accept-open" data-id="${w.id}">swords Принять вызов</button><button class="btn small ghost" data-act="war-decline" data-id="${w.id}">Отказаться</button>`);
  if (w.canCancel) acts.push(`<button class="btn small ghost" data-act="war-decline" data-id="${w.id}">Отозвать вызов</button>`);
  if (w.canPlay) acts.push(`<button class="btn small war-go" data-act="war-play" data-id="${w.id}">▶ Пройти блиц за банду — 3 минуты</button>`);
  if (w.status === 'active' && w.kind === 'sea' && w.amHero && w.battleId) acts.push(`<button class="btn small war-go" data-act="battle-go" data-id="${w.battleId}" data-opp="${w.opp}">anchor К бою</button>`);
  const mySide = w.from.mine ? w.from : w.to.mine ? w.to : null;
  if (w.canSetHero) acts.push(`<button class="btn small ghost" data-act="war-hero-open" data-id="${w.id}">${mySide && mySide.hero ? 'swap Сменить героя' : 'star Назначить героя'}</button>`);
  if (w.canStepDown) acts.push(`<button class="btn small ghost" data-act="war-step-down" data-id="${w.id}">Не смогу биться</button>`);
  const live = ['pending', 'active'].includes(w.status);
  const betLine = w.bets.mine ? `dice Твоя ставка: ${w.bets.mine.amount}${w.bets.mine.payout != null ? ` → получено ${w.bets.mine.payout}` : ''}`
    : w.bets.open ? `<span class="bet-row">dice Ставка за своих: ${[1, 3, 5, 10].filter((x) => x <= w.bets.max).map((x) => `<button class="chip bet-chip" data-act="war-bet" data-id="${w.id}" data-v="${x}">${x}</button>`).join('')}</span>` : '';
  const pools = (w.from.pool || w.to.pool) ? `<span class="small">банк: ${w.from.pool} : ${w.to.pool}</span>` : '';
  const cheer = live && mySide && !w.amHero ? (w.cheered ? '<span class="small">bolt ты поддержал|поддержала героя</span>' : `<button class="btn small cheer" data-act="war-cheer" data-id="${w.id}">bolt Держись!</button>`) : '';
  const extra = [betLine, pools, cheer, live && mySide && mySide.cheers ? `<span class="small">bolt болеют за нашего: ${mySide.cheers}</span>` : ''].filter(Boolean);
  return `<div class="war ${w.status} ${w.winner || ''}">
    <div class="war-head"><span class="war-kind">${w.tour ? 'trophy Турнир · ' : ''}${kind}</span><span class="small">${status}</span></div>
    <div class="war-vs">${warSide(w.from, 'вызвали, герой')}<span class="war-x">VS</span>${warSide(w.to, 'приняли, герой')}</div>
    ${w.status === 'done' && w.result && w.result.note ? `<p class="small" style="margin:0;text-align:center">${esc(w.result.note)}</p>` : ''}
    ${w.waitReason ? `<p class="small" style="margin:0">${esc(w.waitReason)}</p>` : ''}
    ${extra.length ? `<div class="war-extra">${extra.join('')}</div>` : ''}
    ${acts.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${acts.join('')}</div>` : ''}
  </div>`;
}
function renderWars() {
  const v = S.wars;
  if (!v) return '';
  const rec = v.record;
  return `<section class="card wars">
    <div class="chats-head"><h3 class="has-art">${art('shield', 28)}Битвы банд</h3><span class="small">${rec.w + rec.l + rec.d ? `побед ${rec.w} · поражений ${rec.l}${rec.d ? ` · ничьих ${rec.d}` : ''}` : 'ещё не воевали'}${rec.declined ? ` · отказов ${rec.declined}` : ''}</span></div>
    ${v.items.length ? v.items.map(renderWar).join('') : '<p class="small" style="margin:4px 0 0">Вызови другую банду: блиц на 3 минуты по теме или быстрый морской бой. От каждой банды — один герой, на всё — рабочая неделя.</p>'}
    <button class="btn small ${v.volunteer ? 'green' : 'ghost'} vol-btn" data-act="war-volunteer" data-v="${v.volunteer ? '0' : '1'}">${v.volunteer ? 'hand Ты в списке добровольцев — нажми, чтобы выйти' : 'hand Готов быть героем'}</button>
    ${v.isOwner ? (v.members < v.minMembers ? `<p class="small" style="margin:0">Битвы — для банд от ${v.minMembers} человек. Позови своих.</p>` : '<button class="btn war-call" data-act="war-new">swords Бросить вызов</button>') : `<p class="small" style="margin:0">Вызов бросает и принимает владелец банды.${v.volunteers ? ` Добровольцев: ${v.volunteers}.` : ''}</p>`}
    <details class="hint-group"><summary>help Как это работает: битвы, герои, ставки</summary>
    ${hint('war-rules', 'Как устроены битвы банд', WAR_RULES(v.rules))}
    ${hint('war-hero', 'Кто становится героем', HERO_RULES)}
    ${hint('war-bets', 'Как работают ставки', BET_RULES(v.rules.betMax))}</details>
  </section>`;
}
function renderWarNew() {
  const d = S.warDraft;
  const m = S.warMeta;
  if (!m) return '<p class="sub">Загружаем…</p>';
  const rival = m.rivals.find((r) => r.id === d.to);
  if (m.self) return `<p class="sub">${esc(m.self)}</p>`;
  return `<p class="small" style="margin:0">Четыре шага: соперник → вид битвы → тема → герой. Соперник получит пуш и ответит в течение 3 дней.</p>
    <div class="field">1. Кого вызываем<div class="war-rivals">${m.rivals.length ? m.rivals.map((r) => `<button class="war-rival ${d.to === r.id ? 'on' : ''}" data-act="war-set" data-k="to" data-v="${r.id}" ${r.block ? 'disabled' : ''}>${crestSvg(crestOf(r), { size: 34 })}<span class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(r.name)}</b><span class="small">${r.block ? esc(r.block) : r.count + ' чел.'}</span></span></button>`).join('') : '<p class="small">Других банд пока нет — позови коллег сколотить свою.</p>'}</div></div>
    <div class="field">2. Чем бьёмся<div class="war-kinds">
      <button class="war-kindbtn ${d.kind === 'blitz' ? 'on' : ''}" data-act="war-set" data-k="kind" data-v="blitz"><span>bulb</span><b>Блиц</b><span class="small">3 минуты вопросов по теме. Первым проходит их герой, потом наш</span></button>
      <button class="war-kindbtn ${d.kind === 'sea' ? 'on' : ''}" data-act="war-set" data-k="kind" data-v="sea"><span>anchor</span><b>Морской бой</b><span class="small">Быстрая партия героев: по 1,5 минуты на часах</span></button></div></div>
    ${d.kind === 'blitz' ? `<div class="field">3. Тема${!rival ? ' <span class="small">(сначала выбери соперника)</span>' : ''}<div class="war-topics">${m.topics.map((t) => `<button class="war-topic ${d.topic === t.id ? 'on' : ''}" data-act="war-set" data-k="topic" data-v="${t.id}" ${!t.free ? 'disabled' : ''}><span class="grow"><b>${esc(t.title)}</b><span class="small">${!t.free ? (t.usedByMe ? 'ваша банда уже билась по ней' : 'соперник уже бился по ней') : esc(t.desc)}</span></span></button>`).join('')}</div>
      <p class="small" style="margin:0">По каждой теме банда бьётся один раз. Новая тема открывается каждую неделю.</p></div>` : ''}
    <div class="field">${d.kind === 'blitz' ? '4' : '3'}. Наш герой <span class="small">— hand добровольцы сверху</span>${warHeroPick(m.members, d.hero, 'war-hero-pick')}</div>
    ${hint('war-hero-2', 'Кого выбрать героем', HERO_RULES)}
    <button class="btn" data-act="war-send" ${d.to && d.hero && (d.kind === 'sea' || d.topic) ? '' : 'disabled'}>swords Бросить вызов</button>
    <p class="small" style="margin:0">Срок — рабочая неделя с момента, как соперник примет вызов. Не успел — техническое поражение. Победителям: герою +20 зёрен, всей банде по +5 и очки в Лигу.</p>`;
}
function renderWarAccept() {
  const d = S.warAccept;
  const m = S.warMeta;
  if (!m || !d) return '<p class="sub">Загружаем…</p>';
  return `<p class="sub" style="margin:0">Кто будет защищать честь банды? ${d.kind === 'blitz' ? 'В блице наш герой проходит первым.' : 'Герои сыграют быструю партию морского боя.'}</p>
    ${warHeroPick(m.members, d.hero, 'war-acc-hero')}
    <button class="btn" data-act="war-accept" ${d.hero ? '' : 'disabled'}>swords Принять бой</button>
    <p class="small" style="margin:0">Срок — 5 рабочих дней с этой минуты. Отказаться можно бесплатно, но отказы видны в статистике банды.</p>`;
}
function renderWarHero() {
  const d = S.warHero; const m = S.warMeta;
  if (!m || !d) return '<p class="sub">Загружаем…</p>';
  return `<p class="sub" style="margin:0">Кто выйдет за банду? Пока герой не начал, его можно поменять.</p>
    ${warHeroPick(m.members, d.hero, 'war-hero-pick2')}
    <button class="btn" data-act="war-hero-save" ${d.hero ? '' : 'disabled'}>star Назначить героем</button>`;
}

// ===== Тренировка с ботом =====
// Партии идут в браузере (practice.js): без зёрен, рейтинга и уведомлений. Счёт — только себе, в localStorage
const PR_GAMES = { rps: 'Камень, ножницы, бумага', dice: 'Кости', ttt: 'Крестики-нолики', sea: 'Морской бой' };
const prScore = (game) => { const all = store.get('practiceScore', {}); return all[game] || { me: 0, opp: 0 }; };
function prCount(result) {
  const P = S.practice; if (!P || P.counted) return;
  P.counted = true;
  const all = store.get('practiceScore', {}); const sc = all[P.game] || { me: 0, opp: 0 };
  if (result === 'win') sc.me++; else if (result === 'lose') sc.opp++;
  all[P.game] = sc; store.set('practiceScore', all);
}
function prLevel(game) { return store.get('practiceLevel', {})[game] || 'hard'; }
function renderPracticeHead() {
  const P = S.practice, sc = prScore(P.game);
  // Идёт морской бой — шапка в одну строку: экран нужен полю
  if (P.game === 'sea' && S.bv && S.bv.status === 'play') return `<div class="pr-mini"><button class="linkbtn back" data-act="pr-back">‹ К играм</button><span class="pr-score">${PR.LEVELS[P.level]} · ты <b>${sc.me}</b> : <b>${sc.opp}</b> противник</span></div>`;
  const lv = P.game === 'ttt' || P.game === 'sea';
  return `<button class="linkbtn back" data-act="pr-back">‹ К играм</button>
    <section class="card pr-head">
      <div class="row" style="justify-content:space-between;gap:8px"><b>Тренировка: ${esc(PR_GAMES[P.game].toLowerCase())}</b><span class="pr-score" aria-label="Счёт в практике">ты <b>${sc.me}</b> : <b>${sc.opp}</b> противник</span></div>
      ${lv ? `<div class="chips">${Object.entries(PR.LEVELS).map(([k, l]) => `<button class="chip ${P.level === k ? 'on' : ''}" data-act="pr-level" data-v="${k}" aria-pressed="${P.level === k}">${l}</button>`).join('')}</div>
        ${P.game === 'sea' && S.bv && S.bv.status === 'play' ? '' : `<p class="small" style="margin:0">${P.game === 'ttt' ? (P.level === 'hard' ? 'Сильный противник не проигрывает. Сведёшь вничью — ачивка «Ничья с машиной».' : 'Лёгкий противник иногда зевает тройку.') : P.level === 'hard' ? 'Сильный противник считает, где корабли вероятнее, и добивает раненые. Потопишь его флот — ачивка.' : 'Лёгкий противник часто стреляет наугад.'}</p>`}` : '<p class="small" style="margin:0">Ни зёрен, ни рейтинга — счёт видишь только ты.</p>'}
    </section>`;
}
function renderPractice() {
  const P = S.practice;
  // Если между делом открывали настоящую партию, вернуть на экран свою тренировочную
  if (P.server && !(P.game === 'sea' ? P.sv : P.dv)) return `${renderPracticeHead()}<div class="card"><p class="sub">Расставляем фигуры…</p></div>`;
  if (P.game === 'sea') { if (!S.bv || !S.bv.practice) S.bv = P.server ? P.sv : PR.seaView(P.st, prScore('sea')); return renderBattle(); }
  const d = P.server ? P.dv : PR.duelView(P.st);
  return `${renderPracticeHead()}<section class="card duels">${DUEL_DEFS}${renderDuel(d)}
    ${d.status === 'done' ? '<button class="btn wide" data-act="pr-again">Ещё партию</button>' : ''}</section>`;
}
function prNew(game) {
  const prev = S.practice && S.practice.game === game ? S.practice : null;
  // В крестиках-ноликах первый ход по очереди: то ты, то бот
  const first = game === 'ttt' && prev && prev.first === 'me' ? 'opp' : 'me';
  const level = prLevel(game);
  S.bResigned = false; S.bEmote = null; S.duelAnim = null;
  // Сильный бот в крестиках и морском бое играет на сервере: за победу над ним дают ачивки, их нельзя нарисовать в браузере
  if ((game === 'ttt' || game === 'sea') && level === 'hard') {
    const P = S.practice = { game, level, first, counted: false, server: true, id: null, dv: null, sv: null };
    S.bv = null;
    post('/api/botgame', { game, first }).then((r) => { if (S.practice !== P) return; P.id = r.id; prPlay(P, r); }).catch((e) => { if (S.practice === P) { toast(e.message); S.practice = null; render(); } });
    return;
  }
  S.practice = { game, level, first, counted: false, st: game === 'sea' ? PR.newSea() : PR.newDuel(game, { first }) };
  if (game === 'sea') { S.bv = null; setBattleView(PR.seaView(S.practice.st, prScore('sea'))); }
  if (game === 'ttt' && first === 'opp') prTttBot();
}
// Ответ сервера: виды после каждого шага. Первый показываем сразу, ходы бота — с паузой, как живые
function prApply(P, v) {
  if (P.game === 'sea') { v.score = prScore('sea'); if (v.status === 'done') { prCount(v.winner === 'me' ? 'win' : 'lose'); v.score = prScore('sea'); } P.sv = v; setBattleView(v); }
  else { P.dv = v; if (v.status !== 'play' || !v.myTurn) prDuelDone(v); else S.duelAnim = { id: 'bot', seq: v.seq, until: Date.now() + 2600 }; }
}
function prPlay(P, r, first = true) {
  const steps = r.steps || [];
  steps.forEach((v, i) => setTimeout(() => {
    if (S.practice !== P) return;
    if (P.game === 'ttt' && i > 0) sfx('marker');
    prApply(P, v);
    if (P.game === 'sea' && v.last && v.last.r === 'sunk' && !v.last.mine && v.status === 'play' && Math.random() < 0.4) prBotEmote(['easy', 'smart', 'lol']);
    render();
    if (i === steps.length - 1) {
      setTimeout(() => { if (S.practice === P) render(); }, 1700);
      if (r.ach && r.ach.length) Promise.all([loadFeatures(), loadMe()]).then(render).catch(() => {});
    }
  }, i === 0 && first ? 0 : i * (P.game === 'sea' ? 950 : 750)));
}
const prMove = (body) => { const P = S.practice; return post(`/api/botgame/${P.id}/move`, body).then((r) => prPlay(P, r)); };
function prDuelDone(d) {
  S.duelAnim = { id: 'bot', seq: d.seq, until: Date.now() + 2600 };
  if (d.status === 'done') prCount(d.result);
  duelOutcomeSfx(d);
}
function prTttBot() {
  const P = S.practice, st = P.st;
  if (st.status !== 'play' || st.turn !== 'opp') return;
  setTimeout(() => {
    if (S.practice !== P) return;
    PR.tttBot(st, { level: P.level }); sfx('marker');
    prDuelDone(PR.duelView(st)); render();
  }, 650 + Math.random() * 500);
}
// Бот в морском бое стреляет с паузой, как живой: попал — стреляет ещё
function prSeaBot() {
  const P = S.practice, st = P.st;
  if (st.status !== 'play' || st.turn !== 'opp') return;
  setTimeout(() => {
    if (S.practice !== P) return;
    const r = PR.seaBotShot(st, { level: P.level });
    if (st.status === 'done') prCount('lose');
    setBattleView(PR.seaView(st, prScore('sea')));
    if (r && r.result === 'sunk' && st.status === 'play' && Math.random() < 0.4) prBotEmote(['easy', 'smart', 'lol']);
    render();
    setTimeout(() => { if (S.practice === P) render(); }, 1700);
    prSeaBot();
  }, 800 + Math.random() * 600);
}
function prBotEmote(pool) {
  const P = S.practice;
  setTimeout(() => {
    if (S.practice !== P) return;
    const e = pool[Math.floor(Math.random() * pool.length)];
    S.bEmote = { ...(S.bEmote || {}), opp: { e, until: Date.now() + 3200 } };
    sfx(`emo_${e}`); render();
    setTimeout(() => { if (S.practice === P) render(); }, 3300);
  }, 900);
}
const prSea = () => S.practice && S.practice.game === 'sea';

// ===== Личные дуэли =====
const RPS_EMO = { rock: 'rock', scissors: 'scissors', paper: 'paper' };
// Плитка «Камень, ножницы, бумага»: кулак сжимает ножницы — лезвие слева, кольца справа
const rpsDuo = () => `<svg class="rps-duo" viewBox="0 0 44 28" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 9.4 3 11.1l12 1.5"/><path d="M33.6 9.6l2.4-.5M33.6 12.2l2.3 1"/><circle cx="39" cy="8.2" r="3"/><circle cx="39.4" cy="15.3" r="3"/><path d="M15 13.6V7.4a2.3 2.3 0 0 1 4.6 0v6.2"/><path d="M19.6 13.6V6.1a2.3 2.3 0 0 1 4.6 0v7.5"/><path d="M24.2 13.6V6.6a2.3 2.3 0 0 1 4.6 0v7"/><path d="M28.8 11.2V8.2a2.3 2.3 0 0 1 4.6 0v6.6a7 7 0 0 1-3.4 6V25H18.6v-4.4a6.4 6.4 0 0 1-3.6-5.7v-1.3"/><path d="M15 13.6h10.6a2.2 2.2 0 0 1 0 4.4H20"/></svg>`;
const RPS_NAME = { rock: 'Камень', scissors: 'Ножницы', paper: 'Бумага' };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const dieFace = (n, cls = '') => `<span class="die ${cls}" aria-label="${n}">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n] && PIPS[n].includes(i) ? 'on' : ''}"></i>`).join('')}</span>`;
async function loadDuels(withId) {
  try { const r = await get(`/api/duels${withId ? '?with=' + withId : ''}`); if (withId) S.duelsWith = r.items; else S.duels = r.items; } catch {}
}
function duelHead(d) {
  const stakeTag = d.stake ? `<span class="duel-stake-tag">coin ${d.stake}${d.needPay ? ' — заплатишь первым ходом' : d.mine && !d.oppPaid && d.status === 'play' ? ' — соперник ещё не ответил' : ''}</span>` : '';
  const res = d.result === 'win' ? `<span class="duel-res win">${art('trophy', 24)}Победа</span>` : d.result === 'lose' ? `<span class="duel-res lose">${art('flag', 24)}${d.resigned ? 'Сдался' : 'Поражение'}</span>` : d.result === 'draw' ? `<span class="duel-res">${art('shake', 24)}Ничья</span>` : '';
  const score = '';
  const untouched = !d.mine && (d.game === 'ttt' ? !d.board.includes('me') : !d.rounds.some((r) => r.me));
  return `<div class="duel-head"><b>${{ rps: 'rock Камень, ножницы, бумага', dice: 'dice Кости', ttt: 'x Крестики-нолики' }[d.game]}</b>${score}${res}${d.status === 'play' ? `<button class="linkbtn small" data-act="duel-resign" data-id="${d.id}" data-soft="${untouched ? 1 : 0}">${untouched ? 'отказаться' : 'сдаться'}</button>` : ''}</div>${d.result ? `<div class="res-hero">${art(d.result === 'win' ? 'win' : d.result === 'lose' ? 'lose' : 'draw', 104)}</div>` : ''}${stakeTag}`;
}
// Эмоции на аватаре: рот и глаза поверх своего образа
// Эмоция меняет только рот: форма глаз — часть внешности, по ней человека узнают
const MOOD = { win: { mouth: 'grin' }, happy: { mouth: 'smile' }, sad: { mouth: 'sad' }, lose: { mouth: 'wow' }, meh: { mouth: 'neutral' }, smirk: { mouth: 'smirk' }, wow: { mouth: 'wow' } };
const moodLook = (look, m) => ({ ...(look || {}), ...(MOOD[m] || {}) });
// Руки: кожа — с аватара, рукав — цвет худи. Если рукава у соперников похожи, у соперника — оранжевый
const colorDist = (a, b) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const [x, y] = [p(a), p(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
function handsOf(d) {
  const sk = (l) => (l && /^#[0-9a-f]{6}$/i.test(l.skin || '') ? l.skin : '#E8B48A');
  const sl = (l) => HOODIE[(l && l.hoodie) || 'blue'] || HOODIE.blue;
  const me = { skin: sk(S.me.look), sleeve: sl(S.me.look) };
  const opp = { skin: sk(d.opp.look), sleeve: sl(d.opp.look) };
  if (colorDist(me.sleeve, opp.sleeve) < 90) { me.sleeve = SIDE.me.c; opp.sleeve = SIDE.opp.c; }
  return { me, opp };
}
// Шапка дуэли: ты и соперник с эмоциями по ходу партии, кто думает — у того облачко «…»
function duelVs(d, moods, fresh) {
  const think = d.status === 'play' ? (d.myTurn ? 'me' : 'opp') : null;
  const side = (who, look, nick) => `<div class="dvs-p ${who} mood-${moods[who]} ${fresh ? 'fresh' : ''}">
    <span class="dvs-ava">${avatar(moodLook(look, moods[who]), 46)}${think === who ? '<i class="dvs-think"><b></b><b></b><b></b></i>' : ''}</span><span class="dvs-nick ellipsis">${nick}</span></div>`;
  return `<div class="dvs">${side('me', S.me.look, 'ты')}<div class="dvs-mid">${d.score ? `<b>${d.score.me}</b><span>:</span><b>${d.score.opp}</b>` : '<span class="small">vs</span>'}</div>${side('opp', d.opp.look, nk(d.opp))}</div>`;
}
function duelFx(d, fresh) {
  if (!fresh || !d.result) return '';
  return d.result === 'win' ? confetti() : d.result === 'lose' ? raincloud() : '';
}
function moodsOf(d, last) {
  if (d.status === 'done') return d.result === 'win' ? { me: 'win', opp: 'lose' } : d.result === 'lose' ? { me: 'lose', opp: 'win' } : { me: 'meh', opp: 'meh' };
  if (last && last.win) return last.win === 'me' ? { me: 'happy', opp: 'sad' } : last.win === 'opp' ? { me: 'sad', opp: 'happy' } : { me: 'meh', opp: 'meh' };
  return { me: 'smirk', opp: 'smirk' };
}
function renderDuel(d) {
  const fresh = !!(S.duelAnim && S.duelAnim.id === d.id && S.duelAnim.seq === d.seq && Date.now() < (S.duelAnim.until || 0));
  if (d.game === 'ttt') {
    // Новые фишки: сравниваем с тем, что уже видели
    S.tttSeen = S.tttSeen || {};
    const prev = S.tttSeen[d.id];
    if (!prev || prev.board !== d.board.join()) S.tttSeen[d.id] = { board: d.board.join(), fresh: prev ? d.board.map((c, i) => (c && !prev.board.split(',')[i] ? i : -1)).filter((i) => i >= 0) : [], until: Date.now() + 1500 };
    const nw = S.tttSeen[d.id].until > Date.now() ? S.tttSeen[d.id].fresh : [];
    const cell = (c, i) => {
      const win = d.line && d.line.includes(i);
      const mark = c ? (c === 'me' ? d.mark : d.mark === 'x' ? 'o' : 'x') : null;
      return `<button class="ttt-cell ${mark ? 'm-' + mark : ''} ${win ? 'win' : ''}" data-act="duel-cell" data-id="${d.id}" data-v="${i}" ${c || !d.myTurn ? 'disabled' : ''} aria-label="Клетка ${i + 1}${mark ? (mark === 'x' ? ', крестик' : ', нолик') : ''}">${tttMark(mark, nw.includes(i), c === 'me' ? 'me' : 'opp')}</button>`;
    };
    const moods = d.status === 'done' ? moodsOf(d) : { me: 'smirk', opp: 'smirk' };
    return `<div class="duel ttt">${duelHead(d)}${duelVs(d, moods, fresh)}<div class="arena"><div class="ttt-grid">${d.board.map(cell).join('')}${tttLine(d.line, fresh)}</div></div>
      <p class="small duel-hint">${d.status === 'play' ? (d.myTurn ? `Твой ход — ты ${d.mark === 'x' ? 'крестики' : 'нолики'}` : 'Ход соперника…') : ''}</p>${duelFx(d, fresh)}</div>`;
  }
  const cur = d.rounds[d.rounds.length - 1];
  const done = d.rounds.filter((r) => r.win);
  const last = done[done.length - 1];
  const moods = moodsOf(d, last);
  if (d.game === 'rps') {
    const H = handsOf(d);
    const res = (who) => (!last ? '' : last.win === 'draw' ? 'draw' : last.win === who ? 'win' : 'lose');
    let stage = '';
    if (d.status === 'play' && cur.me && (!cur.opp || cur.opp === 'hidden')) {
      // Сходил, ждём соперника: своя фигура и кулак соперника с вопросом
      stage = `<div class="rps-stage arena wait"><span class="rh me">${handSvg(cur.me, H.me.sleeve, H.me.skin)}</span><span class="rps-q">?</span><span class="rh opp">${handSvg('rock', H.opp.sleeve, H.opp.skin, 'wait')}</span></div>`;
    } else if (last) {
      stage = `<div class="rps-stage arena ${fresh ? 'anim' : ''}"><span class="rh me ${res('me')}">${handDuo(last.me, H.me.sleeve, H.me.skin)}</span>
        <span class="rps-vs ${last.win}">${last.win === 'me' ? 'бьёт' : last.win === 'opp' ? 'бита' : 'ничья'}</span><i class="rps-boom"></i>
        <span class="rh opp ${res('opp')}">${handDuo(last.opp, H.opp.sleeve, H.opp.skin)}</span></div>`;
    }
    return `<div class="duel rps">${duelHead(d)}${duelVs(d, moods, fresh)}${stage}
      ${d.status === 'play' ? (d.myTurn ? `<div class="rps-pick">${Object.keys(RPS_EMO).map((m, i) => `<button class="rps-btn" data-act="duel-rps" data-id="${d.id}" data-v="${m}" style="--i:${i}"><span class="rh me">${handSvg(m, H.me.sleeve, H.me.skin)}</span><b>${RPS_NAME[m]}</b></button>`).join('')}</div>`
        : `<p class="small duel-hint">${cur.me ? `Ты ${meG('выбрал', 'выбрала')}: ${RPS_NAME[cur.me].toLowerCase()} — ждём соперника` : ''}</p>`) : ''}
      <p class="small duel-hint">До ${d.winTo} побед. Ход соперника скрыт, пока не сходишь сам.</p>${duelFx(d, fresh)}</div>`;
  }
  // Кости
  const rolling = S.duelRolling === d.id;
  const pair = (v, who) => (v && v !== 'hidden' ? v.map((n, i) => dieSvg(n, fresh ? 'land' : '', i * 0.09 + (who === 'opp' ? 0.25 : 0))).join('') : rolling && who === 'me' ? dieSvg(1, 'roll') + dieSvg(6, 'roll', 0.1) : dieSvg(0, 'blank') + dieSvg(0, 'blank'));
  const shown = d.status === 'play' && cur.me ? { me: cur.me, opp: cur.opp } : last ? { me: last.me, opp: last.opp, win: last.win } : { me: null, opp: null };
  const sum = (v, who) => (Array.isArray(v) ? `<b class="dice-sum ${fresh ? 'pop' : ''} ${shown.win === who ? 'won' : ''}">${v[0] + v[1]}</b>` : '<b class="dice-sum muted">—</b>');
  return `<div class="duel dice">${duelHead(d)}${duelVs(d, moods, fresh)}
    <div class="dice-table arena"><div class="dice-side"><div class="dice-pair">${pair(shown.me, 'me')}</div>${sum(shown.me, 'me')}</div>
      <span class="dice-vs ${shown.win || ''}">${shown.win === 'me' ? '›' : shown.win === 'opp' ? '‹' : shown.win === 'draw' ? '=' : 'vs'}</span>
      <div class="dice-side"><div class="dice-pair">${pair(shown.opp, 'opp')}</div>${sum(shown.opp, 'opp')}</div></div>
    ${d.status === 'play' ? (d.myTurn ? `<button class="btn dice-roll" data-act="duel-roll" data-id="${d.id}">dice Бросить кости</button>` : `<p class="small duel-hint">${cur.me ? 'Ждём бросок соперника…' : ''}</p>`) : ''}
    <p class="small duel-hint">У кого сумма больше — тот взял раунд. До ${d.winTo} побед.</p>${duelFx(d, fresh)}</div>`;
}
// Темп морского боя: два варианта-карточки. В личке — сразу вызов, в шторке «Игр» — выбор (on)
function seaModes({ to = null, stake = 0, pick = null } = {}) {
  const opt = (mode, icon, title, sub) => to
    ? `<button class="sea-mode ${mode}" data-act="battle-new" data-id="${to}" data-mode="${mode}" data-stake="${stake}"><span class="sm-ico">${ico(icon, 18)}</span><span class="grow"><b>${title}</b><small>${sub}</small></span></button>`
    : `<button class="sea-mode ${mode} ${pick === mode ? 'on' : ''}" data-act="sea-mode" data-v="${mode}" aria-pressed="${pick === mode}"><span class="sm-ico">${ico(icon, 18)}</span><span class="grow"><b>${title}</b><small>${sub}</small></span></button>`;
  return `<div class="sea-modes">${to ? '<span class="sm-cap">Морской бой — какой темп?</span>' : ''}${opt('calm', 'anchor', 'Без спешки', 'ходите, когда удобно')}${opt('fast', 'bolt', 'Быстрая', 'по 1,5 мин у каждого')}</div>`;
}
function renderDuelsBox(f) {
  const items = S.duelsWith || [];
  // Если партия в морской бой уже идёт, её плашка выше, а плитку не показываем
  const sea = !S.battles.some((b) => b.oppId === f.id && b.status !== 'done');
  return `${DUEL_DEFS}<section class="card duels">
    <div class="chats-head"><h3>game Сыграть</h3><span class="small">победа +2 зерна</span></div>
    <div class="duel-stake"><span class="small">Ставка:</span>${[0, 5, 10].map((x) => `<button class="chip ${(S.duelStake || 0) === x ? 'on' : ''}" data-act="duel-stake" data-v="${x}">${x ? x + ' зёрен' : 'без ставки'}</button>`).join('')}</div>
    <div class="duel-new ${sea ? 'n4' : ''}">${[['rps', rpsDuo(), 'Камень, ножницы, бумага'], ['dice', 'dice', 'Кости'], ['ttt', 'xcircle', 'Крестики-нолики'], ...(sea ? [['sea', 'anchor', 'Морской бой']] : [])].filter((x) => DUEL_GAMES.includes(x[0])).map(([g, e, t]) => `<button class="duel-start ${g === 'sea' && S.dmSea ? 'on' : ''}" data-act="${g === 'sea' ? 'dm-sea' : 'duel-new'}" data-to="${f.id}" data-v="${g}"><span>${e}</span><b>${hy(t)}</b></button>`).join('')}</div>
    ${sea && S.dmSea ? seaModes({ to: f.id, stake: S.duelStake || 0 }) : ''}
    ${hint('duel-rules', 'Правила дуэлей и ставок', `<ul class="ol"><li><b>Камень, ножницы, бумага</b> и <b>кости</b> — до двух побед. В камне-ножницах-бумаге ход соперника скрыт, пока не сходишь сам. Кости бросает сервер — подкрутить нельзя.</li><li><b>Крестики-нолики</b> — кто вызвал, ходит крестиками первым.</li><li><b>Ставка</b> 5 или 10 зёрен: вызвавший платит сразу, соперник — своим первым ходом. Не хочешь — откажись до хода, ничего не потеряешь. Победитель забирает обе ставки, ничья — возврат. В <b>морском бою</b> соперник платит, когда нажимает «В бой»; отказ до начала — возврат обоим.</li><li>Победа без ставки — +2 зерна (до 3 раз в день). Брошенная на 3 дня дуэль закрывается, ставки возвращаются.</li></ul>`)}
    ${items.map(renderDuel).join('')}
  </section>`;
}
function renderDuelsCard() {
  const items = (S.duels || []).filter((d) => d.status === 'play');
  const battles = (S.battles || []).filter((x) => x.status !== 'done');
  const nickOf = (id) => ((S.people || []).find((p) => p.id === id) || (S.crew && S.crew.list.find((p) => p.id === id)) || {}).nick || 'соперник';
  const waiting = items.filter((d) => d.myTurn).length + battles.filter((x) => x.myTurn).length;
  const games = [['duel-pick', 'rps', art('rps', 44), 'Камень, ножницы, бумага'], ['duel-pick', 'dice', art('dice', 44), 'Кости'], ['duel-pick', 'ttt', art('ttt', 44), 'Крестики-нолики'], ['duel-pick', 'sea', art('ship', DUEL_GAMES.length === 1 ? 62 : 44), 'Морской бой']].filter((x) => DUEL_GAMES.includes(x[1]));
  return `<section class="card duels-card"><div class="chats-head"><h3>game Сыграть</h3><span class="small">${waiting ? `${waiting} ${plural(waiting, 'ждёт', 'ждут', 'ждут')} твоего хода` : 'победа +2 зерна'}</span></div>
    <div class="duel-new n${games.length}">${games.map(([act, g, e, t]) => g === 'sea' && games.length === 1
      ? `<button class="duel-start has-art sea-hero" data-act="${act}" data-v="${g}" style="--sea:-${Date.now() % 24000}ms"><i class="sh-sky"></i><i class="sh-w w1"></i><i class="sh-gull g1"><i></i></i><i class="sh-gull g2"><i></i></i><i class="sh-gull g3"><i></i></i><i class="sh-buoy"><img src="/art/sea_buoy.webp" width="28" height="40" alt=""></i><i class="sh-w w2"></i><span>${e}</span><i class="sh-w w3"></i><b>${hy(t)}<small>Потопи чужой флот</small></b></button>`
      : `<button class="duel-start has-art" data-act="${act}" data-v="${g}"><span>${e}</span><b>${hy(t)}</b></button>`).join('')}</div>
    ${items.length || battles.length ? '' : (S.gHelp ? '<p class="small" style="margin:0">Нажми игру — дальше выбери соперника или «Практику» с компьютером. В дуэлях можно играть на ставку 5 или 10 зёрен — победитель забирает обе. Морской бой — быстрый или без спешки. <button class="linkbtn small" data-act="g-help">Скрыть</button></p>' : '<button class="linkbtn small g-help" data-act="g-help">Как играть?</button>')}
    ${battles.map((x) => `<button class="chat-row" data-act="battle-go" data-id="${x.id}" data-opp="${x.oppId}"><span class="duel-ico">anchor</span><span class="grow"><span class="chat-title">${esc(nickOf(x.oppId))}</span><span class="where">Морской бой · ${x.mode === 'fast' ? 'быстрая · ' : ''}${x.status === 'setup' ? 'расстановка' : x.myTurn ? 'твой ход!' : 'ход соперника'}</span></span>${x.myTurn ? '<span class="crew-badge">!</span>' : ''}</button>`).join('')}
    ${items.map((d) => `<button class="chat-row" data-act="dm-open" data-id="${d.opp.id}">${avatar(d.opp.look, 32)}<span class="grow"><span class="chat-title">${nk(d.opp)}</span><span class="where">${{ rps: 'rock Камень, ножницы, бумага', dice: 'dice Кости', ttt: 'x Крестики-нолики' }[d.game]}${d.score ? ` · ${d.score.me}:${d.score.opp}` : ''}</span></span>${d.myTurn ? '<span class="crew-badge">!</span>' : ''}</button>`).join('')}</section>`;
}

function duelOutcomeSfx(d) {
  // Сначала звук самой анимации (качание рук, стук костей), потом — итог
  const done = d.rounds ? d.rounds.filter((r) => r.win) : [];
  const last = done[done.length - 1];
  const resolved = d.result || (last && d.rounds[d.rounds.length - 1].me === null);
  const wait = resolved && d.game === 'rps' ? 1550 : resolved && d.game === 'dice' ? 850 : 300;
  if (resolved && d.game === 'rps') sfx('rps3');
  setTimeout(() => {
    if (d.result === 'win') sfx('victory');
    else if (d.result === 'lose') sfx('lose');
    else if (last && d.rounds[d.rounds.length - 1].me === null) sfx(last.win === 'me' ? 'coin' : last.win === 'opp' ? 'error' : 'tick');
  }, wait);
  if (navigator.vibrate && vibroOn() && d.result) navigator.vibrate(d.result === 'win' ? [30, 40, 30, 40, 80] : [120]);
}
// ----- Голосование за герб -----
function renderCrestVote() {
  const v = S.cv;
  if (!v || (!v.active && !v.last)) return '';
  const g = S.gang.gang;
  if (!v.active) {
    const ok = v.last.status === 'accepted';
    return `<section class="card cv-done"><div class="row" style="gap:10px">${crestSvg(v.last.crest, { size: 40 })}<span class="small grow">${ok ? 'shield Банда выбрала новый герб' : 'shield Предложенный герб не прошёл'}: за — ${v.last.za}, против — ${v.last.protiv}</span></div></section>`;
  }
  const a = v.active;
  const hrs = Math.max(0, Math.round((a.endsAt - Date.now()) / 3600e3));
  const total = Math.max(1, a.members);
  return `<section class="card cv">
    <div class="chats-head"><h3>shield Голосуем за герб</h3><span class="small">ещё ${hrs} ч</span></div>
    <div class="cv-pair"><div>${crestSvg(crestOf(g), { size: 74, full: true })}<span class="small">сейчас</span></div><span class="cv-arrow" aria-hidden="true">→</span><div>${crestSvg(a.crest, { size: 74, full: true, motto: g.motto || g.name })}<span class="small">предлагает ${esc(a.author)}</span></div></div>
    <div class="cv-bar"><span class="za" style="width:${(a.za / total) * 100}%"></span><span class="pr" style="width:${(a.protiv / total) * 100}%"></span></div>
    <div class="small">За — <b>${a.za}</b>, против — <b>${a.protiv}</b> из ${a.members}. Голос тайный. Досрочно решит ${a.needEarly} ${plural(a.needEarly, 'голос', 'голоса', 'голосов')}, иначе через ${hrs} ч — если «за» больше и проголосовала хотя бы треть банды (${a.quorum}).</div>
    <div class="row"><button class="btn grow ${a.my === 1 ? 'green' : ''}" data-act="cv-vote" data-id="${a.id}" data-v="1">thumbUp За${a.my === 1 ? ' ✓' : ''}</button><button class="btn ghost grow ${a.my === -1 ? 'on' : ''}" data-act="cv-vote" data-id="${a.id}" data-v="-1">thumbDown Против${a.my === -1 ? ' ✓' : ''}</button></div>
    ${a.mine ? `<button class="linkbtn" data-act="cv-withdraw" data-id="${a.id}" style="align-self:center">Снять с голосования</button>` : ''}
  </section>`;
}

function renderGEventNew() {
  const d = S.gevDraft;
  const kinds = (S.gev && S.gev.kinds) || [];
  const min = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  return `<div class="field">Что за повод<div class="chips">${kinds.map((k) => `<button class="chip ${d.kind === k.id ? 'on' : ''}" data-act="gev-kind" data-v="${k.id}">${gevIco(k.id)} ${esc(k.name)}</button>`).join('')}</div></div>
    <label class="field">Название<input id="gev-title" maxlength="60" placeholder="Пятничный сабантуй перед праздниками" value="${esc(d.title)}"></label>
    <div class="row" style="gap:10px"><label class="field grow">Дата<input id="gev-day" type="date" min="${min}" value="${esc(d.day)}"></label>
      <label class="field" style="width:120px">Время<input id="gev-time" type="time" value="${esc(d.time)}"></label></div>
    <label class="field">Где (необязательно)<input id="gev-place" maxlength="60" placeholder="Кафе на первом этаже, переговорка 5.12" value="${esc(d.place)}"></label>
    ${d.editId ? '' : `<label class="field">Позвать ещё банду (необязательно)<select id="gev-guest"><option value="">— только своя банда —</option>${(S.gevGuests || []).map((g) => `<option value="${g.id}" ${String(d.guest || '') === String(g.id) ? 'selected' : ''}>${esc(g.name)} · ${g.members}</option>`).join('')}</select></label>`}
    <label class="field">Подробности (необязательно)<textarea id="gev-note" maxlength="300" rows="3" placeholder="Скидываемся по 500, Лена несёт торт">${esc(d.note)}</textarea></label>
    <p class="small" style="margin:0">${d.editId ? 'Если поменяешь дату, время или место — кто идёт или думает, получит пуш, а в чат банды уйдёт сообщение «Изменилось».' : 'Банда получит пуш и сообщение в чате. Утром в день события напомним тем, кто идёт.'}</p>
    <button class="btn" data-act="gev-save">${d.editId ? 'Сохранить' : 'Создать событие'}</button>`;
}

function renderPolls() {
  const items = S.polls || [];
  return `<section class="card polls">
    <div class="chats-head"><h3>vote Опросы${items.filter((p) => !p.closed).length ? ` <span class="chats-n">${items.filter((p) => !p.closed).length}</span>` : ''}</h3><button class="linkbtn" data-act="poll-new">＋ Опрос</button></div>
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

// ----- Банды: создание, поиск, профиль, настройки -----
const ACCESS_NAMES = { open: ['Открытая', 'вступить может любой'], request: ['По заявке', 'вступление подтверждает владелец'], invite: ['Закрытая', 'только по ссылке или приглашению, в поиске не видна'] };
// Значок банды — её герб (собранный владельцем или автоматический)
const gangBadge = (g, size = 40) => `<span class="g-crest ${g && g.style && g.style.aura ? 'aura ' + g.style.aura : ''}" style="width:${size}px">${crestSvg(crestOf(g), { size })}</span>`;
function areaSelect(id, cur) {
  return `<select id="${id}"><option value="">Выбери, что вас объединяет</option>${S.cat.gangAreas.map((a) => `<option ${cur === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>`;
}
function accessPicker(cur) {
  return `<div class="acc-pick">${Object.entries(ACCESS_NAMES).map(([k, [t, d]]) => `<button class="acc-opt ${cur === k ? 'on' : ''}" data-act="gs-access" data-v="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>`;
}
function interestChips(sel) {
  return `<div class="chips">${S.cat.gangInterests.map((t) => `<button class="chip ${sel.includes(t) ? 'on' : ''}" data-act="gs-int" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
}
// ----- Генератор герба -----
function crestField(d, ctx) {
  if (ctx === 'set') return `<div class="field">Герб<div class="row crest-field">${crestSvg(crestOf({ ...S.gang.gang, crest: d.crest }), { size: 60, full: true })}
    <div class="grow" style="display:flex;flex-direction:column;gap:6px"><span class="small" style="font-weight:600">Герб выбирает банда голосованием — у владельца тут нет особых прав.</span>
    <button class="btn small" data-act="crest-open" data-ctx="vote">vote Предложить герб</button></div></div></div>`;
  const g = { id: (S.gang && ctx === 'set' && S.gang.gang.id) || 0, name: d.name || 'Банда', color: d.color, area: d.area, interests: d.interests, crest: d.crest };
  return `<div class="field">Герб<div class="row crest-field">${crestSvg(crestOf(g), { size: 70, full: true, motto: d.name || '' })}
    <div class="grow" style="display:flex;flex-direction:column;gap:6px"><span class="small" style="font-weight:600">${d.crest ? 'Собран вручную' : 'Собирается сам — по тому, что вас объединяет, и интересам'}</span>
    <button class="btn small" data-act="crest-open" data-ctx="${ctx}">shield Собрать герб</button></div></div></div>`;
}
const CREST_TABS = [['shape', 'Щит'], ['field', 'Поле'], ['charge', 'Фигура'], ['top', 'Навершие']];
function renderCrestEditor() {
  const e = S.crestEd;
  const c = e.crest;
  const tab = e.tab || 'shape';
  const mini = (patch, size = 46) => crestSvg({ ...c, ...patch }, { size });
  const tile = (k, v, name) => `<button class="ava-tile crest-tile ${c[k] === v ? 'on' : ''}" data-act="crest-set" data-k="${k}" data-v="${v}">${mini({ [k]: v })}<span>${esc(name)}</span></button>`;
  const sw = (k) => `<div class="row" style="flex-wrap:wrap;gap:8px">${CREST_PARTS.tincture.map((t) => `<button class="swatch ${c[k] === t ? 'on' : ''}" style="background:${TINCTURES[t][0]}" data-act="crest-set" data-k="${k}" data-v="${t}" title="${TINCTURE_NAMES[t]}" aria-label="${TINCTURE_NAMES[t]}"></button>`).join('')}</div>`;
  const body = {
    shape: `<div class="ava-tiles">${CREST_PARTS.shape.map((v) => tile('shape', v, SHAPE_NAMES[v])).join('')}</div>`,
    field: `<div class="field">Основной цвет${sw('c1')}</div><div class="field">Второй цвет${sw('c2')}</div>
      <div class="field">Деление<div class="ava-tiles">${CREST_PARTS.div.map((v) => tile('div', v, DIV_NAMES[v])).join('')}</div></div>
      <p class="small" style="margin:0">Правило геральдики: металл (золото, серебро) кладут на цвет, а цвет — на металл. Так герб читается даже в маленьком значке.</p>`,
    charge: `<div class="field">Цвет фигуры${sw('cc')}</div><div class="ava-tiles crest-charges">${CREST_PARTS.charge.map((v) => tile('charge', v, CHARGE_NAMES[v])).join('')}</div>`,
    top: `<div class="ava-tiles">${CREST_PARTS.top.map((v) => `<button class="ava-tile crest-tile ${c.top === v ? 'on' : ''}" data-act="crest-set" data-k="top" data-v="${v}">${crestSvg({ ...c, top: v }, { size: 52, full: true })}<span>${TOP_NAMES[v]}</span></button>`).join('')}</div>
      <div class="chips"><button class="chip ${c.motto !== false ? 'on' : ''}" data-act="crest-set" data-k="motto" data-v="${c.motto !== false ? '0' : '1'}">${c.motto !== false ? '✓ ' : ''}Лента с девизом</button></div>
      <p class="small" style="margin:0">На ленте — девиз банды (покупается в Лавке), а пока его нет — название.</p>`
  }[tab];
  return `<div class="ava-ed">
    <div class="ava-stage crest-stage">${crestSvg(c, { size: 150, full: true, motto: e.mottoText })}
      <div class="ava-tools"><button class="tool" data-act="crest-random" aria-label="Случайный герб">dice</button><button class="tool" data-act="crest-auto" aria-label="Подобрать по тому, что объединяет, и интересам" title="По смыслу банды">spark</button></div></div>
    <p class="small" style="margin:0;text-align:center">dice — случайный, spark — по направлению и интересам банды</p>
    <div class="cats" role="tablist">${CREST_TABS.map(([id, label]) => `<button class="cat ${tab === id ? 'on' : ''}" role="tab" aria-selected="${tab === id}" data-act="crest-tab" data-v="${id}">${label}</button>`).join('')}</div>
    <div class="cat-body">${body}</div>
    ${e.ctx === 'vote' ? '<p class="small" style="margin:0">Герб выбирает вся банда: тайное голосование 48 часов, у владельца нет вето. Досрочно решает больше половины банды.</p>' : ''}
    <div class="ava-foot"><button class="btn grow" data-act="crest-save">${e.ctx === 'vote' ? 'vote Вынести на голосование' : 'Готово'}</button>${e.ctx === 'vote' ? '' : '<button class="btn ghost" data-act="crest-reset" title="Вернуть автоматический">Авто</button>'}</div>
  </div>`;
}

function renderGangNew() {
  const d = S.gnew || (S.gnew = { access: 'request', interests: [], emoji: null });
  return `<div class="gang-hint"><b>Банда — не оргструктура</b>
      <span>Это те, с кем ты и так пересекаешься каждый день: кофе, обед, соседние столы, общий проект. Может совпасть с частью твоей команды, но строить её по штатному расписанию не нужно.</span>
      <div class="gh-cols"><div><i>Банда</i><span>с кем обедаешь и ходишь за кофе</span><span>соседи по этажу и проектная тусовка</span><span>часть команды, если вы на одной волне</span></div>
      <div><i>Не банда</i><span>весь отдел по списку</span><span>руководитель «для порядка»</span><span>рабочие задачи — им место в рабочих системах</span></div></div></div>
    <p class="sub" style="margin-top:0">Общий чат, зовы, неделя офиса, опросы. Залог 50 зёрен вернётся, когда в банде будет 3 человека. В банде до 30 человек, а сам|сама ты можешь быть только в одной банде${S.me.gangs.length ? ` — сколотишь новую, выйдешь из «${esc(S.me.gangs[0].name)}»` : ''}.</p>
    <label class="field">Название<input id="gang-name" maxlength="16" placeholder="Например, Кофейный патруль" value="${esc(d.name || '')}"></label>
    <label class="field">Что вас объединяет${areaSelect('gang-area', d.area)}</label>
    ${crestField(d, 'new')}
    <div class="field">Кто может вступить${accessPicker(d.access)}</div>
    <div class="field">Интересы — до 6, по ним банду найдут${interestChips(d.interests)}</div>
    <label class="field">Пара слов о банде (необязательно)<input id="gang-about" maxlength="160" placeholder="Кто мы и зачем собрались" value="${esc(d.about || '')}"></label>
    <button class="btn violet" data-act="gang-create">Сколотить банду · залог 50</button>
    <label class="field">Или вставь ссылку-приглашение<input id="gang-code" placeholder="https://…/g/ABC123"></label>
    <button class="btn ghost" data-act="gang-join">Вступить по ссылке</button>`;
}
function saveGangForm(prefix) {
  const d = prefix === 'new' ? S.gnew : S.gset;
  if (!d) return;
  const v = (id) => { const e = $(id); return e ? e.value : undefined; };
  if (prefix === 'new') { d.name = v('#gang-name'); d.area = v('#gang-area'); d.about = v('#gang-about'); }
  else { d.name = v('#gs-name'); d.area = v('#gs-area'); d.about = v('#gs-about'); d.maxMembers = v('#gs-max'); d.office = v('#gs-office'); }
}
function gangCardHtml(c) {
  const btn = c.member ? `<button class="btn small ghost" data-act="gang-open" data-id="${c.id}">Открыть</button>`
    : c.full ? '<span class="small">мест нет</span>'
    : c.access === 'open' ? `<button class="btn small" data-act="gang-apply" data-id="${c.id}">Вступить</button>`
    : c.requested ? `<button class="btn small ghost" data-act="gang-apply-cancel" data-id="${c.id}">Заявка отправлена ✕</button>`
    : `<button class="btn small" data-act="gang-apply" data-id="${c.id}">Подать заявку</button>`;
  return `<div class="g-card"><button class="g-main" data-act="gang-profile" data-id="${c.id}">${gangBadge(c)}<span class="grow" style="min-width:0">
      <span class="g-name">${gangName(c)}</span>
      <span class="small">${c.area ? esc(c.area) + ' · ' : ''}${c.count}${c.max ? '/' + c.max : ''} ${plural(c.count, 'человек', 'человека', 'человек')}${c.inOffice ? ` · ${c.inOffice} в офисе` : ''}</span>
      ${c.legend ? `<span class="g-legend small">crown ${esc(c.legend)}</span>` : ''}
      ${c.why ? `<span class="g-why">${esc(c.why)}</span>` : ''}
      ${c.interests.length ? `<span class="g-tags">${c.interests.slice(0, 3).map((t) => `<i>${esc(t)}</i>`).join('')}</span>` : ''}</span></button>${btn}</div>`;
}
function renderGangFind() {
  const f = S.gfind || (S.gfind = { q: '', area: '', items: null });
  return `<div class="row" style="gap:8px"><label class="field grow" style="gap:0"><span class="hidden">Поиск банды</span><input id="gfind-q" placeholder="Название или интерес" value="${esc(f.q)}" autocomplete="off"></label><button class="btn" data-act="gang-find-go">Найти</button></div>
    <div class="chips scroll-x">${['', ...S.cat.gangAreas].map((a) => `<button class="chip ${f.area === a ? 'on' : ''}" data-act="gang-find-area" data-v="${esc(a)}">${a ? esc(a) : 'Все'}</button>`).join('')}</div>
    ${f.recommended && f.items && f.items.length ? '<h3 style="margin:4px 0 0">Рекомендуем</h3>' : ''}
    ${S.me.gangs.length ? `<p class="small" style="margin:0">Ты в банде «${esc(S.me.gangs[0].name)}». Банда может быть одна — при вступлении в новую выйдешь из старой.</p>` : ''}
    ${f.items === null ? '<p class="small">Загружаем…</p>' : f.items.length ? f.items.map(gangCardHtml).join('') : '<p class="sub">Ничего не нашли. Закрытые банды в поиске не видны — в них зовут ссылкой. Или сколоти свою!</p>'}`;
}
function renderGangProfile() {
  const c = S.gprofile;
  if (!c) return '<p class="sub">Загружаем…</p>';
  const [accT, accD] = ACCESS_NAMES[c.access] || ACCESS_NAMES.invite;
  const days = Math.max(1, Math.round((Date.now() - c.since) / 864e5));
  return `<div class="g-hero" style="--gc:${esc(c.color)}"><span class="g-crest ${auraCls(c)}">${crestSvg(crestOf(c), { size: 92, full: true, motto: c.motto || c.name })}</span><div><div class="g-title">${gangName(c)}${c.gold ? ' crown' : ''}</div>
      <div class="small">${c.area ? esc(c.area) : 'просто банда'}</div></div></div>
    ${c.legend ? `<div class="g-legend">crown ${esc(c.legend)}</div>` : ''}
    ${trophyLine(c.trophies) ? `<p class="small" style="margin:0">Трофеи Лиги: ${trophyLine(c.trophies)}</p>` : ''}
    ${c.motto ? `<p class="sub" style="font-style:italic;margin:0">«${esc(c.motto)}»</p>` : ''}
    ${c.about ? `<p class="sub" style="margin:0">${esc(c.about)}</p>` : ''}
    ${c.interests.length ? `<div class="g-tags big">${c.interests.map((t) => `<i>${esc(t)}</i>`).join('')}</div>` : ''}
    <div class="g-stats"><div><b>${c.count}${c.max ? '/' + c.max : ''}</b><span>${plural(c.count, 'участник', 'участника', 'участников')}</span></div><div><b>${c.inOffice}</b><span>в офисе сегодня</span></div><div><b>${c.msgsWeek}</b><span>сообщений за неделю</span></div><div><b>${days}</b><span>${plural(days, 'день', 'дня', 'дней')} банде</span></div></div>
    <div class="g-faces">${c.faces.map((m) => `<span title="${esc(m.nick)}">${avatar(m.look, 34)}</span>`).join('')}${c.count > c.faces.length ? `<span class="small">и ещё ${c.count - c.faces.length}</span>` : ''}</div>
    ${leagueRules()}
    <p class="small" style="margin:0"><b>${accT}</b> — ${accD}${c.owner ? ` · владелец ${esc(c.owner)}` : ''}${c.officeName ? ` · офис ${esc(c.officeName)}` : ''}</p>
    ${gangCardHtml(c).replace(/^<div class="g-card"><button class="g-main"[\s\S]*?<\/button>/, '<div class="g-card solo">')}`;
}
function renderGangSwitch() {
  const a = S.switchAsk || {};
  return `<p class="sub" style="margin:0">Банда может быть только одна. ${a.request ? `Когда владелец примет заявку, ты выйдешь из «${esc(a.from)}».` : `Ты выйдешь из «${esc(a.from)}».`}</p>
    <ul class="ol" style="margin:0"><li>Чат и зовы старой банды пропадут.</li><li>Очки Лиги, которые ты уже принёс, останутся старой банде.</li><li>Если ты владелец — банда перейдёт самому давнему участнику.</li></ul>
    <button class="btn" data-act="gang-switch-go">${a.request ? 'Подать заявку' : 'Перейти'}</button>
    <button class="btn ghost" data-act="close">Остаться</button>`;
}

// ----- Лига банд -----
const MEDAL = ['<b class="mdl m1">1</b>', '<b class="mdl m2">2</b>', '<b class="mdl m3">3</b>'];
const GEV_ICON = { meet: 'room', party: 'party', bday: 'cake', holiday: 'spark', lunch: 'lunch', sport: 'target', work: 'flag', other: 'spark' };
const gevIco = (k) => `\uE000${GEV_ICON[k] || 'cal'}\uE001`;
const TROPHY_NAMES = { p_trophy: 'Кубок Лиги в руку', p_laurel: 'лавровый венок', fr_champ: 'рамка чемпиона' };
function trophyLine(t) {
  if (!t) return '';
  const parts = [];
  t.w.forEach((n, i) => n && parts.push(`${MEDAL[i]}×${n} нед.`));
  t.m.forEach((n, i) => n && parts.push(`${MEDAL[i]}×${n} мес.`));
  return parts.join(' · ');
}
function leagueRow(r) {
  return `<div class="lg-row ${r.me ? 'me' : ''}"><span class="lg-place">${r.place ? (MEDAL[r.place - 1] || r.place) : '—'}</span>${gangBadge(r, 32)}
    <span class="grow" style="min-width:0"><span class="g-name ellipsis">${esc(r.name)}</span><span class="small">${r.members} ${plural(r.members, 'человек', 'человека', 'человек')}${r.together ? ` · в сборе ${r.together} ${plural(r.together, 'день', 'дня', 'дней')}` : ''}</span></span>
    <b class="lg-score">${r.score}</b></div>`;
}
// Методика Лиги — одна на таблицу, профиль и шапку банды. Числа совпадают с server/league.js
const LEAGUE_RULES = { dayCap: 40, minRoster: 3, together: 70, togetherBonus: 10,
  prizes: { W: [[30, 'Кубок Лиги в руку аватара'], [20, ''], [10, '']], M: [[100, 'лавровый венок, рамка чемпиона и титул «Легенда месяца» для банды'], [70, 'лавровый венок'], [50, 'лавровый венок']] } };
function leagueRules(type = null) {
  const R = LEAGUE_RULES;
  const pr = (t) => R.prizes[t].map(([b, extra], i) => `<li><b>${MEDAL[i]}</b> +${b} зёрен каждому, кто принёс очки${extra ? ` + ${extra}` : ''}</li>`).join('');
  return `<details class="lg-rules"><summary>help Как устроена Лига банд</summary>
    <ul class="ol">
      <li><b>Очки.</b> Каждое зерно за дело — очко твоей банде: отметка в офисе или из дома, столовая, ответ на зов, задания дня, квизы, блиц, морской бой, спасибо, ачивки. Зёрна за призы, приглашения и возврат залога не считаются.</li>
      <li><b>Лимит.</b> Один человек приносит не больше ${R.dayCap} очков в день — одиночка банду не вытянет, нужна вся банда.</li>
      <li><b>Счёт банды</b> — средний вклад на участника: сумма очков делится на число людей, которые были в банде за период (не меньше ${R.minRoster}). Маленькая дружная банда спорит на равных с большой. Ушедшие и исключённые тоже в знаменателе — выгнать молчунов ради среднего не выйдет.</li>
      <li><b>«Банда в сборе».</b> Если за день отметились ${R.together}% банды (не меньше трёх человек) — +${R.togetherBonus} к счёту.</li>
      <li><b>Кто участвует.</b> Банды от ${R.minRoster} человек. Человек может быть только в одной банде; при переходе его очки остаются старой банде.</li>
      <li><b>Периоды.</b> Неделя — с понедельника по воскресенье, месяц — календарный. Итоги и призы — сами: за неделю в понедельник, за месяц 1-го числа.</li>
    </ul>
    ${!type || type === 'W' ? `<h3 style="margin:6px 0">Призы недели</h3><ul class="ol">${pr('W')}</ul>` : ''}
    ${!type || type === 'M' ? `<h3 style="margin:6px 0">Призы месяца</h3><ul class="ol">${pr('M')}</ul>` : ''}
    <p class="small" style="margin:0">Трофеи не продаются в Лавке — только за места в Лиге.</p>
  </details>`;
}
function renderLeague() {
  const type = S.leagueType || 'W';
  const L = S.league && S.league[type];
  const tabs = `<div class="chips"><button class="chip ${type === 'W' ? 'on' : ''}" data-act="league-tab" data-v="W">Неделя</button><button class="chip ${type === 'M' ? 'on' : ''}" data-act="league-tab" data-v="M">Месяц</button></div>`;
  if (!L) return tabs + '<p class="sub">Загружаем…</p>';
  const m = L.mine;
  const mine = !m ? `<div class="note">Ты пока не в банде — очки идут только банде. <button class="linkbtn" data-act="gang-find">Найти банду</button></div>`
    : `<div class="lg-mine"><div class="row" style="gap:10px">${gangBadge(m)}<div class="grow"><b>${esc(m.name)}</b><div class="small">${m.place ? `${m.place} место из ${L.count}` : m.eligible ? 'пока без очков' : `в Лиге с ${L.rules.minRoster} человек — зови своих`}</div></div><b class="lg-score big">${m.score}</b></div>
      <div class="g-stats" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div><b>${m.myPoints}</b><span>твой вклад</span></div><div><b>${m.todayPts}/${m.dayCap}</b><span>очков сегодня</span></div><div><b>${m.together}</b><span>${plural(m.together, 'день', 'дня', 'дней')} в сборе</span></div></div></div>`;
  const outside = m && m.place && m.place > 10 ? leagueRow(m) : '';
  const last = L.last.winners.length ? `<h3 style="margin:6px 0 0">Итоги: ${esc(L.last.label)}</h3>${L.last.winners.slice(0, 5).map((w) => `<div class="lg-row"><span class="lg-place">${MEDAL[w.place - 1] || w.place}</span>${gangBadge(w)}<span class="grow g-name ellipsis">${esc(w.name)}</span><b class="lg-score">${w.score}</b></div>`).join('')}` : '';
  return `${tabs}<p class="small" style="margin:0">${esc(L.period.label)} · ${L.period.daysLeft > 1 ? `до финиша ${L.period.daysLeft} ${plural(L.period.daysLeft, 'день', 'дня', 'дней')}` : 'финиш сегодня в полночь'}</p>
    ${mine}
    <div class="lg-list">${L.top.length ? L.top.map(leagueRow).join('') + outside : '<p class="sub">Пока никто не набрал очков. Отметься — и твоя банда первая.</p>'}</div>
    ${leagueRules(type)}
    ${last}`;
}
async function loadLeague(type = S.leagueType || 'W') {
  S.league = S.league || {};
  S.league[type] = await get('/api/league?period=' + (type === 'M' ? 'month' : 'week'));
}
function renderLeagueCard() {
  const L = S.league && S.league.W;
  const m = L && L.mine;
  return `<section class="card lg-card"><div class="row" style="justify-content:space-between"><span class="card-title has-art">${art('trophy', 30)}Лига банд</span><span class="small">${L ? (L.period.daysLeft > 1 ? `ещё ${L.period.daysLeft} ${plural(L.period.daysLeft, 'день', 'дня', 'дней')}` : 'финиш сегодня') : ''}</span></div>
    ${!L ? '<p class="small" style="margin:0">Загружаем…</p>' : m ? `<div class="row" style="gap:10px">${gangBadge(m)}<div class="grow"><b>${m.place ? `${MEDAL[m.place - 1] || ''} ${m.place} место` : m.eligible ? 'Пока без очков' : `Нужно ${L.rules.minRoster} человека`}</b><div class="small">счёт ${m.score} · твой вклад ${m.myPoints} · сегодня ${m.todayPts}/${m.dayCap}</div></div></div>`
      : '<p class="small" style="margin:0">Банды соревнуются за неделю и месяц: зёрна за дела — очки банде. Вступи в банду, чтобы играть.</p>'}
    ${L && L.top.length ? `<div class="lg-mini">${L.top.slice(0, 3).map((r) => `<span class="${r.me ? 'me' : ''}">${MEDAL[r.place - 1]} ${esc(r.name)} · ${r.score}</span>`).join('')}</div>` : ''}
    <button class="btn small" data-act="league-open">Таблица и призы</button></section>`;
}

function renderGangSettings() {
  const d = S.gset;
  if (!d) return '<p class="sub">Загружаем…</p>';
  return `<label class="field">Название<input id="gs-name" maxlength="${Math.max(16, (d.name || '').length)}" value="${esc(d.name || '')}"></label>
    ${crestField(d, 'set')}
    <div class="field">Цвет<div class="row" style="gap:8px">${S.cat.gangColors.map((c) => `<button class="swatch ${d.color === c ? 'on' : ''}" style="background:${c}" data-act="gs-color" data-v="${c}" aria-label="Цвет ${c}"></button>`).join('')}</div></div>
    <label class="field">Что вас объединяет${areaSelect('gs-area', d.area)}</label>
    <label class="field">О банде<input id="gs-about" maxlength="160" value="${esc(d.about || '')}" placeholder="Кто мы и зачем собрались"></label>
    <div class="field">Интересы — до 6${interestChips(d.interests)}</div>
    <div class="field">Кто может вступить${accessPicker(d.access)}</div>
    <div class="field">Кто зовёт новых<div class="chips"><button class="chip ${d.whoInvites !== 'owner' ? 'on' : ''}" data-act="gs-who" data-v="all">Все участники</button><button class="chip ${d.whoInvites === 'owner' ? 'on' : ''}" data-act="gs-who" data-v="owner">Только я</button></div></div>
    <div class="row" style="gap:10px"><label class="field" style="width:130px">Лимит людей<input id="gs-max" type="number" min="0" max="30" value="${d.maxMembers || 0}"></label>
      <label class="field grow">Офис банды<select id="gs-office"><option value="">Любой</option>${S.cat.offices.map((o) => `<option value="${esc(o.id)}" ${d.office === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label></div>
    <p class="small" style="margin:0">0 — до 30 человек, это максимум для любой банды.</p>
    <button class="btn" data-act="gs-save">Сохранить</button>`;
}

function renderGang() {
  const gangs = S.me.gangs;
  let chips = gangs.length ? `<div class="chips dark">${gangs.map((g) => `<button class="chip ${g.id === S.activeGang ? 'on' : ''}" data-act="gang-select" data-v="${g.id}">${esc(g.name)}</button>`).join('')}</div>` : '';
  const create = gangs.length
    ? `<section class="card"><details><summary style="font-weight:900;cursor:pointer;min-height:32px">Перейти в другую банду</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      <p class="sub" style="margin:0">Банда может быть только одна. Вступишь в другую или сколотишь новую — выйдешь из этой. Очки Лиги, которые ты принёс, останутся здесь.</p>
      <div class="row"><button class="btn small grow" data-act="gang-find">search Найти банду</button><button class="btn small ghost grow" data-act="open" data-v="gang-new">＋ Сколотить</button></div></div></details></section>`
    : `<section class="card"><h3>Банды</h3><p class="sub">Банда — твои люди: команда, соседи по этажу, кофейный клуб. Общий чат, зовы, неделя офиса и Лига банд, где вы соревнуетесь с другими.</p>
      <div class="row"><button class="btn grow" data-act="gang-find">search Найти банду</button><button class="btn violet grow" data-act="open" data-v="gang-new">＋ Сколотить</button></div>
      <label class="field">Или вставь ссылку-приглашение<input id="gang-code" placeholder="https://…/g/ABC123"></label>
      <button class="btn ghost" data-act="gang-join">Вступить по ссылке</button></section>`;
  const multi = gangs.length > 1 ? `<div class="note warn">Теперь банда может быть только одна. Ты в ${gangs.length}: очки Лиги идут в «${esc(gangs[0].name)}» (в неё ты вступил раньше). Выйди из лишних, чтобы не путаться.</div>` : '';
  if (!gangs.length) return create;
  if (S.tab === 'chats') chips = ''; // банда одна — переключатель не нужен
  const v = S.gang;
  if (!v) return multi + chips + '<div class="card"><p class="sub">Загружаем банду…</p></div>' + create;
  const g = v.gang;
  const msgs = v.messages.map(renderMsg).join('') || '<p class="sub">Сообщения и зовы живут 24 часа. Начни первым|первой.</p>';
  // Что ждёт меня в банде — для ленты «Сейчас важно» во вкладке «Чат» и счётчика на «Жизни»
  const f = S.friday, w = S.wave, cv = S.cv && S.cv.active;
  const life = [];
  if (f && f.canAnswer && !f.done) life.push(['chat', 'Пятиминутка ждёт тебя', 'Три строчки о неделе · +3 зерна', '.friday']);
  for (const e of (S.gev && S.gev.upcoming) || []) if (!e.my && e.inDays <= 7) life.push(['cal', esc(e.title), `${e.inDays === 0 ? 'сегодня' : e.inDays === 1 ? 'завтра' : `через ${e.inDays} ${plural(e.inDays, 'день', 'дня', 'дней')}`} · ответь, придёшь ли`, '.gevents']);
  for (const p of S.polls || []) if (!p.closed && !p.voted && !p.mine) life.push(['vote', esc(p.question), 'Опрос ждёт твой голос', '.polls']);
  if (cv && !cv.my && !cv.mine) life.push(['shield', 'Голосуем за новый герб', 'Твой голос решает', '.cv']);
  const reqN = (v.requests || []).length;
  const tab = S.gangTab || 'chat';
  const tabs = `<div class="g-tabs" role="tablist">${[['chat', 'Чат', 0], ['life', 'Жизнь', 0], ['crew', 'Банда', reqN]].map(([k, l, n]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-act="gang-tab" data-v="${k}">${l}${n ? `<i>${n}</i>` : ''}</button>`).join('')}</div>`;
  const head = `<section class="card g-head" style="${g.gold ? 'border:3px solid #FFC93C' : ''}">
    ${gst(g).cardbg ? `<div class="g-banner ${gst(g).cardbg}" aria-hidden="true"></div>` : ''}
    <div class="row"><button class="crest-btn ${auraCls(g)}" data-act="crest-open" data-ctx="vote" aria-label="Предложить новый герб банды">${crestSvg(crestOf(g), { size: 78, full: true })}<i aria-hidden="true">✎</i></button><div class="grow" style="min-width:0"><h2 style="margin:0">${gangName(g)}</h2><span class="small">${g.floor ? g.floor + ' этаж · ' : ''}${g.area ? esc(g.area) + ' · ' : ''}${v.gang.count}${g.max ? '/' + g.max : ''} ${plural(v.gang.count, 'участник', 'участника', 'участников')}${g.league && g.league.place ? ` · ${MEDAL[g.league.place - 1] || ''} ${g.league.place} место в Лиге` : ''}</span></div>
      ${g.isOwner ? '<button class="icon-btn" data-act="gang-settings" aria-label="Настройки банды">gear</button>' : `<button class="icon-btn" data-act="gang-profile" data-id="${g.id}" aria-label="Профиль банды">help</button>`}</div>
    ${tabs}
  </section>`;
  // ----- Чат: сейчас важно, зовы, переписка
  const now = [];
  if (g.pizza) {
    const pz = g.pizza;
    now.push(`<section class="card pizza-card"><span class="pizza-ico" aria-hidden="true">🍕</span><div class="grow" style="min-width:0"><b>${pz.mine ? 'Ты угощаешь банду пиццей' : `${esc(pz.by)} угощает пиццей`}</b>
      <span class="small">Осталось кусков: ${pz.left} из ${pz.slices}${pz.mine ? ' · угощающий не ест' : ' · кусок — +1 зерно'}</span></div>
      ${!pz.mine && !pz.took && pz.left ? '<button class="btn small" data-act="pizza-take">Взять кусок</button>' : pz.took ? '<span class="small">check съедено</span>' : ''}</section>`);
  }
  if (w && w.active && !w.active.mine) now.push(renderWave());
  if (life.length || reqN) now.push(`<section class="card g-now"><span class="eyebrow">Сейчас важно</span>
    ${life.slice(0, 3).map(([i, t, d, to]) => `<button class="g-now-row" data-act="gang-go" data-v="life" data-to="${to}">${ico(i, 18)}<span class="grow"><b>${t}</b><span class="small">${d}</span></span><span class="chev" aria-hidden="true">›</span></button>`).join('')}
    ${life.length > 3 ? `<button class="linkbtn" data-act="gang-tab" data-v="life">Ещё ${life.length - 3} — во вкладке «Жизнь»</button>` : ''}
    ${reqN && g.isOwner ? `<button class="g-now-row" data-act="gang-go" data-v="crew" data-to=".g-req">${ico('hand', 18)}<span class="grow"><b>Хотят в банду: ${reqN}</b><span class="small">Прими или откажи</span></span><span class="chev" aria-hidden="true">›</span></button>` : ''}
  </section>`);
  const chatTab = `${now.join('')}
  <section class="card ${gst(g).chat ? 'chat-theme ' + gst(g).chat : ''}">
    <div class="row chat-acts"><button class="btn small grow ${S.callsOpen ? 'ghost' : ''}" data-act="calls-toggle" aria-expanded="${!!S.callsOpen}">megaphone ${S.callsOpen ? 'Свернуть' : 'Позвать банду'}</button><button class="btn small ghost grow" data-act="respect-pick">hand Респект</button></div>
    ${S.callsOpen ? `<div class="calls">${Object.entries(S.cat.calls).map(([k, c]) => `<button class="call" style="--c:${CALL_STYLE[k]}" data-act="call-open" data-kind="${k}" data-gang="${g.id}">${ico(k, 20)}<span>${esc(c.label)}</span></button>`).join('')}</div>` : ''}
    <div class="chat" id="chat">${msgs}</div>
    ${(S.cat.memes || []).some((x) => x.season && x.on !== false) ? `<div class="chips"><button class="chip hol-chip" data-act="meme-open" data-gang="${g.id}">gift Праздничная открытка банде</button></div>` : ''}
    <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Сообщение</span><input id="chat-text" maxlength="300" placeholder="Написать банде" aria-label="Сообщение банде"></label>
      ${micBtn('gang')}<button class="btn" data-act="chat-send" aria-label="Отправить">→</button></div>${recBar('gang')}
  </section>`;
  // ----- Жизнь: всё, что банда делает вместе
  const lifeTab = `<div class="g-group">События</div>${w && w.active && w.active.mine ? renderWave() : ''}${renderGEvents()}${renderSanta()}${renderGangBirthdays()}${w && !w.active ? renderWave() : ''}<div class="g-group">Опросы</div>${renderPolls()}${renderCrestVote()}`;
  // ----- Банда: кто мы, люди, неделя, казна, лига, битвы
  // «Банда на неделе» — первой: кто когда в офисе важнее описания банды
  const crewTab = `${renderCrewWeek(v, g)}
  <section class="card g-about">
    ${g.legend ? `<div class="g-legend">crown ${esc(g.legend)}</div>` : ''}
    ${g.motto ? `<p class="sub" style="font-style:italic;margin:0">«${esc(g.motto)}»</p>` : ''}
    ${g.about ? `<p class="sub" style="margin:0">${esc(g.about)}</p>` : ''}
    ${g.interests && g.interests.length ? `<div class="g-tags"><span class="g-tags-l">Интересы банды:</span>${g.interests.map((t) => `<i>${esc(t)}</i>`).join('')}</div>` : ''}
    <button class="tr-strip" data-act="treasury-open">bank Казна: <b>${g.glory || 0}</b> славы <span class="small">— оформление банды за общие победы</span></button>
    ${g.league ? `<button class="lg-strip" data-act="league-open">trophy Лига недели: <b>${g.league.place ? `${MEDAL[g.league.place - 1] || ''} ${g.league.place} место из ${g.league.of}` : g.league.eligible ? 'пока без очков' : 'нужно 3 человека'}</b> · счёт ${g.league.score}${trophyLine(g.trophies) ? ` · ${trophyLine(g.trophies)}` : ''}</button>` : ''}
    ${g.league ? leagueRules() : ''}
    ${g.depositPending ? '<div class="note warn">Залог 50 зёрен вернётся, когда в банде будет 3 человека.</div>' : ''}
  </section>
  ${renderWars()}
  <div class="row g-foot" style="justify-content:space-between">
    <button class="linkbtn" data-act="report" data-type="gang" data-id="${g.id}">Пожаловаться на банду</button>
    <button class="linkbtn" data-act="gang-leave">Выйти из банды</button>
  </div>
  ${create}`;
  return `${multi}${chips}${head}${tab === 'life' ? lifeTab : tab === 'crew' ? crewTab : chatTab}`;
}

function renderMsg(m) {
  const reps = m.replies.length ? `<div class="reps">${m.replies.map((r) => `<span class="rep">${nk(r)}: ${esc(r.label)}</span>`).join('')}</div>` : '';
  if (m.type === 'call') {
    const to = m.toNick ? ` → ${esc(m.toNick)}` : '';
    const body = `<b>${esc(m.author)}</b> ${esc(m.callText)}${m.opt ? ` · ${esc(m.opt.toLowerCase())}` : ''}${m.text ? ` · ${esc(m.text)}` : ''}`;
    return `<div class="msg call-msg ${m.mine ? 'mine' : ''}">
      <div class="meta"><span>${m.time}${to}</span></div>
      <div class="text">${body}</div>${reps}
      ${m.canReply ? `<div class="chips">${m.replyOptions.map((l) => `<button class="chip" data-act="reply" data-id="${m.id}" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div><span class="small">Ответ: +1 зерно</span>` : ''}
    </div>`;
  }
  if (m.type === 'meme') {
    return `<div class="msg meme-msg ${m.mine ? 'mine' : ''}">
    <div class="meta"><b>${esc(m.author)}</b><span>${m.time}</span>${m.mine ? '' : `<button class="linkbtn" data-act="report" data-type="message" data-id="${m.id}" aria-label="Пожаловаться">⚑</button>`}</div>
    ${memeSvg(m.look || {}, m.kind, m.opt, 190)}</div>`;
  }
  if (m.type === 'voice') {
    return `<div class="msg ${m.mine ? 'mine' : ''}">
    <div class="meta"><b>${esc(m.author)}</b><span>${m.time}</span>${m.mine ? '' : `<button class="linkbtn" data-act="report" data-type="message" data-id="${m.id}" aria-label="Пожаловаться">⚑</button>`}</div>
    ${voiceEl(m.voice)}</div>`;
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
  if (c.list.some((x) => x.id === id)) return `<button class="btn small ghost" data-act="dm-open" data-id="${id}" aria-label="Написать подельнику">mail</button>`;
  if (c.outgoing.some((x) => x.id === id)) return '<span class="small">заявка ушла</span>';
  return `<button class="btn small ghost" data-act="crew-add-id" data-id="${id}" aria-label="Позвать в подельники" title="Позвать в подельники">＋</button>`;
}

function renderCrew() {
  if (S.battle) return renderBattle();
  if (S.dm) return renderDm();
  const c = S.crew;
  if (!c) return '<div class="card"><p class="sub">Загружаем подельников…</p></div>';
  const incoming = c.incoming.length ? `<section class="card"><h3>Зовут в подельники</h3>
    ${c.incoming.map((p) => `<div class="person2">${tap(p.id, avatar(p.look, 36))}<div class="grow ellipsis" style="font-weight:800;min-width:0">${nk(p)}</div>
      <button class="btn small" data-act="crew-accept" data-id="${p.id}">Принять</button>
      <button class="btn small ghost" data-act="crew-decline" data-id="${p.id}" aria-label="Отклонить заявку">✕</button></div>`).join('')}
  </section>` : '';
  const rows = c.list.map((f) => {
    const [w, color] = whereText(f);
    const line = f.last ? `${f.last.mine ? 'Ты: ' : ''}${f.last.text}` : w;
    return `<button class="person2 crew-row" data-act="dm-open" data-id="${f.id}">
      <span class="ava-wrap"><span class="ava-ring" style="border-color:${color}">${avatar(f.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>
      <span class="grow" style="min-width:0"><span class="crew-nick">${nk(f)}</span><span class="where ellipsis ${f.unread ? 'unread' : ''}">${esc(line)}</span></span>
      <span class="crew-side">${(S.battles.find((b) => b.oppId === f.id && b.myTurn && b.status !== 'done')) ? '<span class="crew-turn" title="Твой ход в морском бою">anchor</span>' : ''}${f.lastTime ? `<span class="small">${f.lastTime}</span>` : ''}${f.unread ? `<span class="crew-badge">${f.unread > 9 ? '9+' : f.unread}</span>` : ''}</span>
    </button>`;
  }).join('');
  return `${incoming}
  <section class="card">
    <div class="row" style="justify-content:space-between"><h2>★ Подельники</h2><span class="small">${c.list.length} из ${c.max}</span></div>
    <p class="sub">Избранные контакты для постоянного общения — из любой банды или вообще без неё. Подельникам можно писать всегда, даже если личка закрыта для остальных. Они сверху в «Личке» и видят, где ты сегодня.</p>
    ${rows || '<p class="sub"><b>Пока никого.</b> Позови по нику или скинь свою ссылку. Ещё можно нажать «＋» у человека в составе банды.</p>'}
  </section>
  <section class="card">
    <h3>Позвать в подельники</h3>
    <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Ник</span><input id="crew-nick" maxlength="21" placeholder="ник" autocapitalize="off" autocomplete="off" aria-label="Ник"></label>
      <button class="btn" data-act="crew-add">Позвать</button></div>
    <button class="btn blue" data-act="crew-share">Отправить свою ссылку</button>
    <p class="small">Кто откроет ссылку, сразу станет подельником, поэтому шли её лично, а не в общий чат. Заявка по нику ждёт согласия.</p>
    ${c.outgoing.length ? `<div class="crew-out"><span class="small">Ждём ответа:</span> ${c.outgoing.map((p) => `<span class="rep">${nk(p)} <button class="linkbtn" data-act="crew-decline" data-id="${p.id}" aria-label="Отменить заявку">✕</button></span>`).join(' ')}</div>` : ''}
    ${c.blocked.length ? `<details><summary class="small" style="cursor:pointer;min-height:32px">Заблокированные (${c.blocked.length})</summary>
      ${c.blocked.map((p) => `<div class="row" style="justify-content:space-between"><span>${nk(p)}</span><button class="linkbtn" data-act="crew-unblock" data-id="${p.id}">Разблокировать</button></div>`).join('')}</details>` : ''}
  </section>`;
}

// ----- Голубиная почта: конверт с крыльями улетает из поля ввода -----
// Только на первое сообщение человеку за день, на голосовые и мемы — чтобы не надоедало
function pigeon(to, force) {
  const day = (S.state && S.state.today) || new Date().toISOString().slice(0, 10);
  const key = `pigeon:${to}:${day}`;
  if (!force && store.get(key)) return;
  store.set(key, 1);
  sfx('flap');
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const from = document.querySelector('#dm-text') || document.querySelector('.sheet') || document.body;
  const r = from.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'pigeon';
  el.style.left = Math.round(r.left + r.width * 0.6) + 'px';
  el.style.top = Math.round(r.top) + 'px';
  el.innerHTML = '<svg viewBox="0 0 48 32" width="68" height="45" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path class="pw pw-l" d="M14 12C10 4 4 2 1 3c2 4 6 8 13 11"/><path class="pw pw-r" d="M34 12c4-8 10-10 13-9-2 4-6 8-13 11"/><rect x="12" y="10" width="24" height="17" rx="2.5" fill="var(--card)"/><path d="M12.8 11.2 24 20l11.2-8.8"/></svg>';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// ----- Голосовые: до 30 секунд, живут час -----
const VOICE_MAX = 30;
const REC = { on: false, where: null, t0: 0, rec: null, chunks: [], stream: null, timer: null, mime: '', cancel: false };
const PLAY = { token: null, audio: null, url: null };
const vmmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const canRecord = () => !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
function micBtn(where) {
  if (!canRecord()) return '';
  return `<button class="btn ghost mic-btn ${REC.on && REC.where === where ? 'on' : ''}" data-act="rec-start" data-v="${where}" aria-label="Записать голосовое">${REC.on && REC.where === where ? '●' : 'mic'}</button>`;
}
function recBar(where) {
  if (!REC.on || REC.where !== where) return '<p class="small voice-hint">mic Голосовые — до 30 секунд, хранятся час и сгорают</p>';
  const sec = Math.min(VOICE_MAX, (Date.now() - REC.t0) / 1000);
  return `<div class="rec-bar"><span class="rec-dot"></span><b id="rec-t">${vmmss(sec)}</b><span class="rec-track"><i id="rec-p" style="width:${(sec / VOICE_MAX) * 100}%"></i></span><span class="small">0:30</span>
    <div class="rec-acts"><button class="btn small ghost" data-act="rec-cancel">Отмена</button><button class="btn small" data-act="rec-send">Отправить</button></div></div>`;
}
function voiceEl(v) {
  if (!v || v.gone) return `<div class="voice gone">mic Голосовое ${vmmss((v && v.dur) || 0)} · сгорело</div>`;
  const playing = PLAY.token === v.token && PLAY.audio && !PLAY.audio.paused;
  const left = Math.max(1, Math.round(v.left / 60e3));
  return `<div class="voice" data-vt="${esc(v.token)}"><button class="voice-play" data-act="voice-play" data-v="${esc(v.token)}" data-mime="${esc(v.mime || '')}" aria-label="${playing ? 'Пауза' : 'Слушать'}">${playing ? '❚❚' : '▶'}</button>
    <span class="voice-track"><i></i></span><span class="voice-d">${vmmss(v.dur)}</span></div><div class="voice-left">flame сгорит через ${left} мин</div>`;
}
function recTick() {
  const sec = (Date.now() - REC.t0) / 1000;
  const t = $('#rec-t'); const pr = $('#rec-p');
  if (t) t.textContent = vmmss(Math.min(sec, VOICE_MAX));
  if (pr) pr.style.width = Math.min(100, (sec / VOICE_MAX) * 100) + '%';
  if (sec >= VOICE_MAX) { toast('30 секунд — отправляю'); actions['rec-send'](); }
}
function recStop(cancel) {
  REC.cancel = cancel;
  clearInterval(REC.timer);
  try { if (REC.rec && REC.rec.state !== 'inactive') REC.rec.stop(); } catch {}
  if (REC.stream) REC.stream.getTracks().forEach((t) => t.stop());
}
const blobB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });

function renderDm() {
  const v = S.dmView;
  if (!v) return '<div class="card"><p class="sub">Открываем переписку…</p></div>';
  const f = v.friend;
  const [w, color] = f.where ? whereText(f) : ['не в твоей банде', '#C9D1EA'];
  const shut = v.cantWrite;
  const msgs = v.messages.map((m) => renderDmMsg(m, f)).join('') || (v.closedByOther ? '' : `<p class="sub">Тут пусто. Напиши первым или позови на кофе. Сообщения живут ${v.ttlDays} ${plural(v.ttlDays, 'день', 'дня', 'дней')}.</p>`);
  const star = v.crewState === 'ok' ? `<button class="star-btn on" data-act="crew-remove" data-id="${f.id}" title="Подельник. Нажми дважды, чтобы убрать">★ Подельник</button>`
    : v.crewState === 'sent' ? '<span class="star-btn wait">☆ заявка ушла</span>'
    : v.crewState === 'incoming' ? `<button class="star-btn" data-act="crew-accept" data-id="${f.id}">★ Принять в подельники</button>`
    : `<button class="star-btn" data-act="crew-add-id" data-id="${f.id}" title="Избранный контакт: писать можно всегда">☆ В подельники</button>`;
  const away = f.where === 'vacation' || f.where === 'sick';
  return `
  <button class="linkbtn back" data-act="dm-back">‹ Личка</button>
  <section class="card">
    <div class="row">
      <span class="ava-wrap"><span class="ava-ring" style="border-color:${color}">${avatar(f.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>
      <div class="grow" style="min-width:0"><div style="font-weight:900;font-size:17px">${nk(f)}</div><div class="where ellipsis">${esc(w)}${f.mood && f.where === 'office' ? ' · ' + esc(f.mood) : ''}</div></div>
      ${star}
    </div>
    ${away ? '<div class="note warn">Сейчас отдыхает: пуш не придёт, увидит, когда вернётся.</div>' : ''}
    ${shut ? `<div class="note dm-shut">lock ${esc(shut)}</div>` : ''}
    ${shut ? '' : `<div class="chips">${v.calls.map((k) => `<button class="chip" data-act="dm-call-open" data-kind="${k}">${esc(S.cat.calls[k].label)}</button>`).join('')}<button class="chip meme-chip" data-act="meme-open" data-to="${f.id}">image Мем</button><button class="chip thx-chip" data-act="thx-open" data-id="${f.id}" data-nick="${esc(f.nick)}">hand Респект</button></div>`}
  </section>
  ${!shut || S.dmSecret ? `<div class="seg dm-mode" role="tablist"><button class="seg-b ${S.dmSecret ? '' : 'on'}" data-act="dm-mode" data-v="plain" aria-selected="${!S.dmSecret}">Обычный чат</button><button class="seg-b ${S.dmSecret ? 'on' : ''}" data-act="dm-mode" data-v="secret" aria-selected="${!!S.dmSecret}">lock Секретный</button></div>` : ''}
  ${S.dmSecret ? renderSecret(f) : ''}
  ${!shut && !S.dmSecret ? renderBattleInvite(f) : ''}
  ${shut || S.dmSecret ? '' : renderDuelsBox(f)}
  ${S.dmSecret || (shut && !v.messages.length) ? '' : `<section class="card">
    <div class="chat" id="dm-chat">${msgs}</div>
    ${shut ? '' : `<div class="row"><label class="field grow" style="gap:0"><span class="hidden">Сообщение</span><input id="dm-text" maxlength="500" placeholder="Написать ${esc(f.nick)}" aria-label="Личное сообщение"></label>
      ${micBtn('dm')}<button class="btn" data-act="dm-send" aria-label="Отправить">→</button></div>${recBar('dm')}`}
    ${v.closedByMe ? '<p class="small" style="margin:0">Ты закрыл|закрыла эту личку. Напишешь — она откроется снова.</p>' : ''}
  </section>`}
  <section class="card">
    ${S.dmSecret ? '' : '<p class="small">Переписку видите только вы двое. Модератор увидит сообщение, только если на него пожалуются (⚑).</p>'}
    <div class="row" style="justify-content:space-between">
      <button class="linkbtn" data-act="dm-close" data-id="${f.id}">${v.closedByOther ? 'Убрать из списка' : '× Закрыть личку'}</button>
      <button class="linkbtn" data-act="crew-block" data-id="${f.id}">Заблокировать</button>
    </div>
  </section>`;
}

function renderBattleInvite(f) {
  const g = S.battles.find((b) => b.oppId === f.id && b.status !== 'done');
  const label = !g ? 'Вызвать на морской бой'
    : g.status === 'setup' ? (g.myTurn ? (g.challenger ? 'Расставь флот — вызов отправлен' : 'Расставь флот — тебя вызвали') : 'Партия: ждём соперника')
    : g.myTurn ? 'Твой ход в морском бою!' : 'Партия идёт: ход соперника';
  if (!g) return '';

  return `<button class="battle-invite ${g.myTurn ? 'hot' : ''}" data-act="battle-open" data-id="${g.id}">
    <span class="bi-ico" aria-hidden="true">${g.mode === 'fast' ? 'bolt' : 'anchor'}</span><span class="grow"><b>${label}</b><span class="small">${g.mode === 'fast' ? 'Быстрая партия · ' : ''}${g.stake ? `ставка ${g.stake} · ` : ''}Нажми, чтобы открыть поле</span></span><span aria-hidden="true">›</span>
  </button>`;
}

const B_COLS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];
const EMOTES = { lol: ['😂', 'Ха-ха!'], angry: ['😡', 'Ну всё!'], bored: ['😴', 'Скукота'], smart: ['🧠', 'Умный ход'], oops: ['😱', 'Ой-ой'], clap: ['👏', 'Браво'], mercy: ['🙏', 'Пощади'], easy: ['😎', 'Изи'] };

// Части корпуса: нос, середина, корма — чтобы корабль выглядел кораблём, а не набором квадратов
// Поле 10×10. kind: 'opp' — по нему стреляю я; 'me' — мой флот и выстрелы соперника
function renderBoard(v, kind) {
  const shots = kind === 'opp' ? v.myShots : v.oppShots;
  const shown = kind === 'me' ? v.myShips : (v.oppShips || v.oppSunk);
  const sunk = kind === 'opp' ? v.oppSunk : v.myShips.filter((sh) => sh.every(([x, y]) => v.oppShots.some((t) => t.x === x && t.y === y)));
  const sunkAt = new Set(); sunk.forEach((sh) => sh.forEach(([x, y]) => sunkAt.add(x * 10 + y)));
  const shotAt = new Map(shots.map((t) => [t.x * 10 + t.y, t]));
  const shipAt = new Set(); shown.forEach((sh) => sh.forEach(([x, y]) => shipAt.add(x * 10 + y)));
  const canShoot = kind === 'opp' && v.myTurn;
  const fresh = Date.now() < S.bFreshUntil ? S.bFresh : new Set();
  const pre = kind === 'opp' ? 'o' : 'm';
  // Экран перерисовывается чаще, чем идёт анимация (опрос, ход соперника). Чтобы взрыв, всплеск и надпись
  // не начинались заново и не мелькали дважды, продолжаем анимацию с того места, где она была
  const fAgo = Math.max(0, Date.now() - (S.bFreshUntil - 1400));
  const cells = [];
  const lastOppShot = kind === 'me' ? [...v.oppShots].reverse().find((t) => !t.auto) : null;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const k = x * 10 + y;
    const t = shotAt.get(k);
    const cls = ['bc'];
    if (shipAt.has(k)) cls.push('under');
    if (t) cls.push(t.r === 'miss' ? (t.auto ? 'miss auto' : 'miss') : sunkAt.has(k) ? 'sunk' : 'hit');
    if (fresh.has(`${pre}:${x},${y}`) && !(t && t.auto)) cls.push('fresh');
    if (kind === 'opp' ? v.last && v.last.mine && v.last.x === x && v.last.y === y : lastOppShot && lastOppShot.x === x && lastOppShot.y === y) cls.push('lastshot');
    const label = `${B_COLS[x]}${y + 1}`;
    cells.push(canShoot && !t
      ? `<button class="${cls.join(' ')} aim" data-act="bshoot" data-x="${x}" data-y="${y}" aria-label="Выстрел в ${label}"></button>`
      : `<span class="${cls.join(' ').trim()}"${cls.includes('fresh') ? ` style="--ad:-${fAgo}ms"` : ''} aria-label="${label}${t ? (t.r === 'miss' ? ' мимо' : sunkAt.has(k) ? ' потоплен' : ' попадание') : ''}"></span>`);
  }
  // Слой кораблей поверх клеток: свои — целиком, чужие — только потопленные (горят) и, после партии, уцелевшие
  const art = [];
  for (const sh of shown) {
    const vertical = sh.length > 1 && sh[0][0] === sh[1][0];
    const sorted = [...sh].sort((p, q) => (vertical ? p[1] - q[1] : p[0] - q[0]));
    const [x0, y0] = sorted[0];
    const isSunk = sh.every(([x, y]) => sunkAt.has(x * 10 + y));
    const state = isSunk ? 'sunk' : kind === 'opp' ? 'ghost' : 'ok';
    const hits = isSunk ? [] : sorted.map(([x, y], i) => (shotAt.has(x * 10 + y) ? i : -1)).filter((i) => i >= 0);
    const area = vertical ? `grid-area:${y0 + 1} / ${x0 + 1} / span ${sh.length} / span 1` : `grid-area:${y0 + 1} / ${x0 + 1} / span 1 / span ${sh.length}`;
    // Объёмный кораблик-спрайт; потопленный — отдельная картинка с пробоинами. Подбитые палубы — копоть, огонь рисует холст эффектов.
    // Покачивание продолжается с того же места после перерисовки (отрицательная задержка), иначе корабли дёргались бы раз в секунду
    const L = sh.length, o = vertical ? 'v' : 'h';
    const scorch = hits.map((i) => `<i class="scorch" style="${vertical ? `top:${((i + 0.5) / L) * 100}%;left:50%;width:74%` : `left:${((i + 0.5) / L) * 100}%;top:50%;width:${74 / L}%`}"></i>`).join('');
    art.push(`<div class="ship-slot spr ${state}" style="${area};--bob:-${(Date.now() + (x0 * 7 + y0 * 13) * 190) % 3600}ms"><img class="ship-spr ${o}" src="/art/ships/s${L}${o}${isSunk ? 'w' : ''}.webp" alt="" draggable="false">${scorch}</div>`);
  }
  // Попадания по чужим кораблям, которые ещё на плаву: видно только взрыв
  if (kind === 'opp') for (const t of shots) if (t.r !== 'miss' && !sunkAt.has(t.x * 10 + t.y)) art.push(`<div class="ship-slot boom" style="grid-area:${t.y + 1} / ${t.x + 1};--bob:-${(Date.now() + (t.x + t.y) * 230) % 1400}ms"><i class="crater"></i></div>`);
  const shout = S.bShout && Date.now() < S.bShout.until && S.bShout.board === pre ? `<div class="b-shout ${S.bShout.cls}" style="animation-delay:-${Math.max(0, Date.now() - (S.bShout.until - 1400))}ms">${esc(S.bShout.text)}</div>` : '';
  return `<div class="board-wrap ${kind}">
    <div class="board ${canShoot ? 'armed' : ''}" style="--sea:-${Date.now() % 24000}ms">${cells.join('')}<div class="ships-layer">${art.join('')}</div></div>${shout}
  </div>`;
}

function fleetLeft(ships, shots) {
  const hit = new Set(shots.filter((t) => t.r !== 'miss').map((t) => t.x * 10 + t.y));
  return ships.map((sh) => ({ len: sh.length, sunk: sh.every(([x, y]) => hit.has(x * 10 + y)) }));
}
// Флот по классам: «▮▮▮▮ 1/1  ▮▮▮ 2/2 …» — сколько кораблей каждой длины ещё на плаву. Потопленный класс гаснет
const fleetBars = (arr) => {
  const g = {};
  for (const sh of arr) { const x = g[sh.len] || (g[sh.len] = { len: sh.len, total: 0, alive: 0 }); x.total++; if (!sh.sunk) x.alive++; }
  return `<div class="fleet">${Object.values(g).sort((a, b) => b.len - a.len).map((x) => `<span class="fl ${x.alive ? (x.alive < x.total ? 'hurt' : '') : 'gone'}" title="${x.len}-палубные: на плаву ${x.alive} из ${x.total}"><span class="fl-ship">${'<i></i>'.repeat(x.len)}</span><b>${x.alive}</b><small>/${x.total}</small></span>`).join('')}</div>`;
};

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
  // Эмоции: кто попал — радуется, по кому попали — в шоке, потопили — грустит; после партии — победитель и проигравший
  let mm = 'smirk', mo = 'smirk';
  if (v.status === 'done') { mm = v.winner === 'me' ? 'win' : 'lose'; mo = v.winner === 'me' ? 'lose' : 'win'; }
  else if (v.last && v.last.r && v.last.r !== 'miss') { const sunk = v.last.r === 'sunk'; if (v.last.mine) { mm = sunk ? 'win' : 'happy'; mo = sunk ? 'sad' : 'wow'; } else { mo = sunk ? 'win' : 'happy'; mm = sunk ? 'sad' : 'wow'; } }
  // Во время партии — компактная строка, чтобы поле соперника и свой флот поместились на одном экране
  const cmp = v.status === 'play', AS = cmp ? 34 : 52;
  return `<section class="b-vs ${cmp ? 'compact' : ''}">
    <div class="vs-side ${myTurn ? 'turn' : ''}">${bubble('mine')}<span class="vs-ava mood-${mm}">${avatar(moodLook(S.me.look, mm), AS)}</span><span class="vs-name">ты</span>${v.clock ? `<span class="vs-clock" data-who="me">${fmtClock(clockNow(v, 'me'))}</span>` : ''}</div>
    <div class="vs-mid"><div class="vs-score"><b>${v.score.me}</b><span>:</span><b>${v.score.opp}</b></div><div class="vs-cap">${v.status === 'setup' ? 'расстановка' : v.status === 'done' ? 'партия окончена' : myTurn ? 'твой ход' : 'ход соперника'}</div></div>
    <div class="vs-side ${oppTurn ? 'turn' : ''}">${bubble('opp')}${(v.practice ? (h) => h : (h) => tap(v.opp.id, h))(`<span class="vs-ava mood-${mo}">${avatar(moodLook(v.opp.look, mo), AS)}</span>`)}<span class="vs-name ellipsis">${nk(v.opp)}</span>${v.clock ? `<span class="vs-clock" data-who="opp">${fmtClock(clockNow(v, 'opp'))}</span>` : ''}</div>
  </section>`;
}

// Пузыри реакций закреплены на экране: видно, даже если прокрутил к своему полю
function renderEmoteLayer(v) {
  const one = (who, look) => {
    const e = S.bEmote && S.bEmote[who];
    if (!e || Date.now() > e.until) return '';
    const [em, label] = EMOTES[e.e] || ['', ''];
    // Экран боя перерисовывается каждую секунду: без отрицательной задержки анимация начиналась заново
    // и пузырь «выскакивал» второй раз. Продолжаем с того места, где она была
    const gone = Math.max(0, Date.now() - (e.until - 3200));
    return `<div class="emo-float ${who}" style="animation-delay:-${gone}ms"><span class="emo-mini">${avatar(look, 30)}</span><span class="emo-bubble"><b style="animation-delay:${150 - gone}ms">${em}</b><span>${esc(label)}</span></span></div>`;
  };
  return one('opp', v.opp.look) + one('mine', S.me.look);
}

function renderEmoteBar() {
  return `<div class="b-emotes" role="group" aria-label="Реакции">${Object.entries(EMOTES).map(([k, [em, label]]) => `<button class="emo" data-act="bemote" data-v="${k}" aria-label="${label}" title="${label}">${em}</button>`).join('')}</div>`;
}

function renderBattle() {
  const v = S.bv;
  const back = S.practice ? renderPracticeHead() : `<button class="linkbtn back" data-act="battle-back">‹ К переписке</button>`;
  if (!v) return back + '<div class="card"><p class="sub">Открываем поле…</p></div>';
  const defs = SHIP_DEFS;
  if (v.status === 'setup') {
    return `${defs}${back}${renderEmoteLayer(v)}${renderVersus(v)}
    <section class="b-sea">
      <div class="sea-title">${v.ready ? 'Флот расставлен' : 'Расставь флот'}</div>
      <p class="sea-sub">${v.ready ? (v.oppReady ? 'Начинаем…' : `Ждём, пока ${nk(v.opp)} расставит корабли. Придёт уведомление.`) : 'Корабли стоят случайно. Не нравится — перемешай. Готов — жми «В бой!».'}</p>
      ${renderBoard(v, 'me')}
      ${v.stake ? `<div class="b-stake">${BEAN} Ставка ${v.stake} зёрен с каждого — победитель забирает ${v.stake * 2}${v.needPay ? '. Твои спишутся, когда нажмёшь «В бой»' : !v.oppPaid ? `. ${nk(v.opp)} ещё не ${gw(v.opp.look, 'принял', 'приняла')} вызов` : ''}</div>` : ''}
      ${v.ready ? '' : `<div class="row"><button class="btn ghost grow" data-act="bshuffle">dice Перемешать</button><button class="btn grow" data-act="bready">anchor ${v.needPay ? `В бой · ${v.stake} зёрен` : 'В бой!'}</button></div>`}
    </section>
    ${renderEmoteBar()}
    <button class="linkbtn b-quit" data-act="bresign">Отказаться от партии${v.stake ? ' — ставки вернутся' : ''}</button>`;
  }
  const done = v.status === 'done';
  const banner = done
    ? `<div class="b-banner has-art ${v.winner === 'me' ? 'win' : 'lose'}">${art(v.winner === 'me' ? 'trophy' : v.timeout ? 'hourglass' : v.resigned ? 'flag' : 'buoy', 44)}<span>${v.winner === 'me' ? (v.timeout ? `У ${nk(v.opp)} кончилось время. Победа!` : v.resigned ? `${nk(v.opp)} ${gw(v.opp.look, 'сдался', 'сдалась')}. Победа!` : 'Победа! Весь флот соперника на дне') : (v.timeout ? 'Время вышло. В следующий раз быстрее!' : v.resigned ? `Ты ${meG('сдался', 'сдалась')}. Бывает` : `${nk(v.opp)} ${gw(v.opp.look, 'потопил', 'потопила')} твой флот`)}</span></div>`
    : v.myTurn ? '<div class="b-banner go">target Твой ход — стреляй по полю соперника</div>'
    : v.practice ? `<div class="b-banner wait">wait ${nk(v.opp)} целится…</div>`
    : `<div class="b-banner wait">wait Ход ${nk(v.opp)}. Придёт уведомление, когда выстрелит</div>`;
  const oppFleet = v.fleet.map((len) => ({ len, sunk: false }));
  for (const sh of v.oppSunk) { const f = oppFleet.find((x) => x.len === sh.length && !x.sunk); if (f) f.sunk = true; }
  // Во время партии свой флот — мини-картой рядом с баннером: поле соперника и своё положение на одном экране.
  // Нажатие на мини-карту разворачивает своё поле целиком (и обратно)
  // Последний выстрел соперника — даже если после него стрелял ты (он подсвечен на мини-карте)
  const lo = [...v.oppShots].reverse().find((t) => !t.auto);
  const lastOpp = lo ? (lo.r === 'miss' ? 'мимо' : v.myShips.some((sh) => sh.some(([x, y]) => x === lo.x && y === lo.y) && sh.every(([x, y]) => v.oppShots.some((t) => t.x === x && t.y === y))) ? 'потопил корабль' : 'попал') : null;
  const compact = !done && !S.bMineBig;
  const mineMini = compact ? `<section class="b-mini" data-act="b-mine-big" role="button" aria-label="Показать моё поле крупно">
    <div class="b-mini-board">${renderBoard(v, 'me')}</div>
    <div class="b-mini-info"><span class="sea-title">Мой флот</span><span class="sea-sub">цел: <b>${v.myLeft}</b> из ${v.fleet.length}</span>
      ${fleetBars(fleetLeft(v.myShips, v.oppShots))}
      <span class="small">${lastOpp ? `Соперник: ${lastOpp}` : 'Соперник ещё не стрелял'}</span><span class="small b-mini-more">Нажми — крупно</span></div>
  </section>` : '';
  // Чей ход — прямо в заголовке поля соперника (во время партии отдельный баннер не нужен — экономим место)
  const turnLine = done ? '' : v.myTurn ? '<span class="b-turn go">Твой ход — стреляй</span>' : `<span class="b-turn wait">${v.practice ? `${nk(v.opp)} целится…` : `Ход ${nk(v.opp)}`}</span>`;
  return `${defs}${back}${renderEmoteLayer(v)}${renderVersus(v)}
  ${done || !compact ? banner : ''}
  <section class="b-sea">
    <div class="row" style="justify-content:space-between;gap:8px"><span class="sea-title">${v.practice ? 'Воды противника' : `Воды ${nk(v.opp)}`}</span>${turnLine || `<span class="sea-sub">на плаву: ${v.oppLeft}</span>`}</div>
    ${fleetBars(oppFleet)}
    ${renderBoard(v, 'opp')}
  </section>
  ${mineMini}
  ${renderEmoteBar()}
  ${compact ? '' : `<section class="b-sea mine">
    <div class="row" style="justify-content:space-between"><span class="sea-title">Мой флот</span><span class="sea-sub">цел: ${v.myLeft} из ${v.fleet.length}${!done ? ' · <button class="linkbtn" data-act="b-mine-big">свернуть</button>' : ''}</span></div>
    ${fleetBars(fleetLeft(v.myShips, v.oppShots))}
    ${renderBoard(v, 'me')}
  </section>`}
  ${done && v.practice ? '<button class="btn wide" data-act="pr-again">Ещё партию</button>' : done ? `<button class="btn wide" data-act="battle-new" data-id="${v.opp.id}" data-mode="${v.mode}" data-stake="${v.stake || 0}">Реванш${v.mode === 'fast' ? ' · быстрая' : ''}</button>` : '<button class="linkbtn b-quit" data-act="bresign">Сдаться</button>'}`;
}

function renderDmMsg(m, f) {
  if (m.type === 'meme') {
    return `<div class="msg meme-msg ${m.mine ? 'mine' : ''}">${memeSvg(m.look || {}, m.kind, m.opt, 190)}
      <div class="meta"><span>${m.time}</span>${m.mine ? (m.read ? '<span title="Прочитано">✓✓</span>' : '<span title="Доставлено">✓</span>') : `<button class="linkbtn" data-act="meme-open" data-to="${f.id}">Ответить мемом</button>`}</div></div>`;
  }
  if (m.type === 'call') {
    const who = m.mine ? 'Ты' : nk(f);
    const verb = m.mine ? esc(m.callText).replace(/^зовёт/, 'зовёшь').replace(/^просит/, 'просишь').replace(/^спрашивает/, 'спрашиваешь').replace(/^ждёт/, 'ждёшь') : esc(m.callText);
    return `<div class="msg call-msg ${m.mine ? 'mine' : ''}">
      <div class="meta"><span>${m.time}</span></div>
      <div class="text"><b>${who}</b> ${verb}${m.opt ? ` · ${esc(m.opt.toLowerCase())}` : ''}${m.text ? ` · ${esc(m.text)}` : ''}</div>
      ${m.reply ? `<div class="reps"><span class="rep">${m.mine ? nk(f) : 'Ты'}: ${esc(m.reply)}</span></div>` : ''}
      ${m.canReply ? `<div class="chips">${m.replyOptions.map((l) => `<button class="chip" data-act="dm-reply" data-id="${m.id}" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div>` : ''}
    </div>`;
  }
  return `<div class="msg ${m.mine ? 'mine' : ''}">
    ${m.type === 'voice' ? voiceEl(m.voice) : `<div class="text">${esc(m.text)}</div>`}
    <div class="meta"><span>${m.time}</span>${m.mine ? (m.read ? '<span title="Прочитано">✓✓</span>' : '<span title="Доставлено">✓</span>') : `<button class="linkbtn" data-act="report" data-type="dm" data-id="${m.id}" aria-label="Пожаловаться модератору">⚑</button>`}</div></div>`;
}

// ----- События -----
function renderFeed() {
  const ev = S.events;
  if (!ev) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  const sig = ev.office
    ? `<section class="card">
        <div class="row"><h3 class="grow">alert Сигналы офиса</h3><button class="btn small" data-act="open" data-v="signal">Сообщить</button></div>
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
    : ''; // до отметки сигналы не показываем: плашка сверху вкладки уже объясняет, что откроется
  // «Мои события»: только то, что случилось с тобой — респект, ответ на твой зов, отклик на объявление, подарок, твоя ачивка
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const lim = S.feedAll ? ev.events.length : 5;
  const list = ev.events.length ? ev.events.slice(0, lim).map((e) => `<div class="item mf-item k-${esc(e.kind)}"><span class="mf-ico">${ico(FEED_ICON[e.kind] || 'spark', 18)}</span><div class="grow" style="min-width:0"><div class="mf-text">${esc(e.text)}</div><div class="where">${e.day === today ? e.time : ddmm(e.day) + ' · ' + e.time}</div></div>${e.from ? `<button class="chip" data-act="person" data-id="${e.from}" aria-label="Открыть карточку">›</button>` : ''}</div>`).join('')
    : '<p class="small" style="margin:0">Здесь будет то, что случилось с тобой: респект от коллеги, ответ на твой зов, «я с вами» на обед, подарок, новая ачивка. Чужих новостей тут нет.</p>';
  return `${sig}<section class="card myfeed"><h3>\uE000spark\uE001 Мои события</h3>${list}${ev.events.length > lim ? `<button class="linkbtn" data-act="feed-all">Ещё ${ev.events.length - lim}</button>` : ''}</section>`;
}

const FEED_ICON = { respect: 'hand', reply: 'megaphone', board: 'lunch', gang: 'flag', prank: 'dice', gift: 'gift', league: 'medal', ach: 'star' };
// ----- Новые блоки: задания, обед, кофе, дни рождения, неделя, спасибо -----
// Иконка и короткая подпись для каждого задания дня
const QUEST_ICON = { where: ['where', 'Отметься'], join: ['flag', 'Банда'], chat: ['chat', 'Чат банды'], call: ['coffee', 'Позови'], reply: ['megaphone', 'Ответь'],
  thanks: ['hand', 'Респект'], dm: ['mail', 'Личка'], meme: ['image', 'Мем'], vote: ['vote', 'Опрос'], guess: ['help', 'Кто из наших'], quiz: ['bulb', 'Квиз'],
  sea: ['anchor', 'Морской бой'], food: ['lunch', 'Обед'], bday: ['cake', 'Именинник'],
  dmnew: ['mail', 'Личка'], todo: ['check', 'Дело дня'], friday: ['chat', 'Пятиминутка'], wave: ['hand', 'Волна'],
  blitz: ['bolt', 'Блиц'], battery: ['thermo', 'Батарейка'], wquiz: ['bulb', 'Квиз'], wguess: ['help', 'Кто из наших'], look: ['palette', 'Образ'] };
function renderQuests() {
  const f = S.fx;
  if (!f) return '';
  const wk = f.quests.weekend;
  const all = [...f.quests.items, ...(f.quests.extra || []).map((x) => ({ ...x, bonus: true }))];
  const done = f.quests.items.filter((x) => x.done).length, total = f.quests.items.length;
  if (wk && !all.length) return `<section class="card quests wk"><span class="card-title">sun Выходной</span><p class="sub" style="margin:0">Задания отдыхают — и ты отдыхай. Увидимся в понедельник.</p></section>`;
  const open = all.find((x) => x.id === S.questOpen);
  const t = open && open.target;
  const more = open ? `<div class="qi-more"><div class="grow"><b>${esc(open.name)}</b><span class="small">${open.done ? 'Готово' : `+${f.quests.reward} зерна${open.bonus ? ' · бонусное, в «все задания» не входит' : ''}`}</span></div>
      ${open.done ? '' : t ? `<span class="row" style="gap:6px">${t.canSwap ? '<button class="btn small ghost" data-act="quest-swap">Другого</button>' : ''}<button class="btn small" data-act="dm-open" data-id="${t.id}">Написать →</button></span>`
        : `<button class="btn small" data-act="quest-go" data-v="${esc(open.go || '')}" data-q="${open.id}" data-to="${esc(open.to || '')}">Сделать →</button>`}</div>`
    : wk ? '' : `<div class="qi-bar"><i style="width:${Math.round(done / Math.max(1, total) * 100)}%"></i></div>`;
  return `<section class="card quests ${wk ? 'wk' : ''}">
    <div class="row" style="justify-content:space-between"><span class="card-title">${wk ? 'sun Выходной' : 'Задания дня'}</span><span class="small">${wk ? '' : done === total ? `все готовы · +${f.quests.bonus} бонус` : `${done} из ${total} · +${f.quests.reward} за каждое`}</span></div>
    ${wk ? '<p class="small" style="margin:0">Задания отдыхают — и ты отдыхай. Коллег не дёргаем. Если скучно — вот пара для себя:</p>' : ''}
    <div class="qi-row">${all.map((x) => {
      const [icon, label] = QUEST_ICON[x.id] || ['star', x.name];
      return `<button class="qi ${x.done ? 'done' : ''} ${x.bonus ? 'bonus' : ''} ${open && open.id === x.id ? 'on' : ''}" data-act="quest-open" data-v="${x.id}" aria-expanded="${open && open.id === x.id}" aria-label="${esc(x.name)}${x.done ? ' — готово' : ''}">
        <span class="qi-c">${x.target ? avatar(x.target.look, 40) : ico(icon, 22)}${x.done ? `<i class="qi-ok">${ico('check', 12)}</i>` : x.bonus ? '<i class="qi-ok star">★</i>' : ''}</span><span class="qi-l">${hy(x.target ? x.target.nick : label)}</span></button>`;
    }).join('')}</div>
    ${more}
  </section>`;
}

function renderBirthdays() {
  const f = S.fx;
  if (!f || !f.birthdaysToday.length) return '';
  return f.birthdaysToday.map((b) => `<section class="bday">
    ${tap(b.id, `<span class="ava-wrap">${avatar(b.look, 34)}</span>`)}
    <div class="grow"><div style="font-weight:900">Сегодня день рождения у ${nk(b)}</div><div class="small" >Поздравь в банде или подари зёрна</div></div>
    ${b.gifted ? '<span class="small" style="font-weight:700">Поздравил|Поздравила ✓</span>' : `<button class="btn small" data-act="gift" data-id="${b.id}">+${f.giftBeans} ${BEAN}</button>`}
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
      <div class="grow"><div style="font-weight:700">${nk(l)}${l.place ? ' · ' + esc(l.place) : ''}</div>
        <div class="small">${l.count ? `идут: ${l.who.map(esc).join(', ')}${l.count > l.who.length ? ' и ещё ' + (l.count - l.who.length) : ''}` : 'пока никто не присоединился'}</div></div>
      ${l.mine ? `<button class="btn small ghost" data-act="lunch-cancel" data-id="${l.id}">Отменить</button>`
        : l.joined ? `<button class="btn small ghost" data-act="lunch-leave" data-id="${l.id}">Не иду</button>`
        : `<button class="btn small" data-act="lunch-join" data-id="${l.id}">Я с вами</button>`}
    </div>`).join('') : '<p class="small" style="margin:0">Сегодня в этом офисе ещё никто не собирает компанию. Открой сбор — его увидят все, кто отмечен здесь.</p>'}
  </section>`;
}

function renderCoffee() {
  const f = S.fx;
  if (!COFFEE_ON || !f) return '';
  const c = f.coffee;
  if (!c.optIn) {
    return `<section class="card coffee">
      <div class="row" style="gap:12px"><span class="coffee-ico art-ico">${art('clink', 46)}</span>
      <div class="grow"><div class="card-title">Случайный кофе</div><div class="small">Раз в неделю знакомим с соседом по офису — не из твоих банд.</div></div></div>
      ${c.hasHome ? '<button class="btn small" data-act="coffee-on">Участвовать</button>' : '<button class="btn small ghost" data-act="open" data-v="profile">Укажи свой офис в профиле</button>'}
    </section>`;
  }
  if (!c.pair) {
    return `<section class="card coffee"><div class="row" style="gap:12px"><span class="coffee-ico art-ico">${art('clink', 46)}</span>
      <div class="grow"><div class="card-title">Случайный кофе</div><div class="small">Пары составляем по понедельникам в 10:00. Придёт уведомление.</div></div></div></section>`;
  }
  const p = c.pair;
  let state = '';
  if (p.ping && p.ping.reply) state = `<div class="note ${p.ping.reply === 'Иду' ? 'good' : 'warn'}" style="margin:0">${p.ping.mine ? nk(p.partner) + ': ' : (meG('Ты ответил: ', 'Ты ответила: '))}${esc(p.ping.reply)} · ${esc(p.ping.opt.toLowerCase())}</div>`;
  else if (p.ping && p.ping.mine) state = `<div class="note warn" style="margin:0">Ты предложил|предложила: ${esc(p.ping.opt.toLowerCase())}. Ждём ответа.</div>`;
  else if (p.canReply) state = `<div class="note good" style="margin:0">${nk(p.partner)} предлагает: ${esc(p.ping.opt.toLowerCase())}</div>
    <div class="chips">${p.replies.map((r) => `<button class="chip" data-act="coffee-reply" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>`;
  const offer = p.canReply || (p.ping && p.ping.mine && !p.ping.reply) ? '' : `<div class="chips">${p.options.map((o) => `<button class="chip" data-act="coffee-ping" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  return `<section class="card coffee">
    <div class="row" style="gap:12px">${tap(p.partner.id, `<span class="ava-wrap">${avatar(p.partner.look, 34)}</span>`)}
    <div class="grow"><div class="eyebrow">Случайный кофе на этой неделе</div><div style="font-weight:900;font-size:16px">${nk(p.partner)}</div>${p.partner.name ? `<div class="small" style="font-weight:700">${esc(p.partner.name)}</div>` : ''}${p.office ? `<div class="small">${esc(p.office)}</div>` : ''}</div></div>
    ${state}${offer}
  </section>`;
}

function renderGangBirthdays() {
  const x = S.gx;
  if (!x || !x.birthdays.length) return '';
  return `<section class="card"><span class="card-title">Дни рождения</span>
    ${x.birthdays.map((b) => `<div class="person2">${tap(b.id, `<span class="ava-wrap">${avatar(b.look, 32)}</span>`)}
      <div class="grow"><div style="font-weight:700">${nk(b)}${b.me ? ' (ты)' : ''}</div><div class="where">${b.inDays === 0 ? 'сегодня!' : b.inDays === 1 ? 'завтра' : `через ${b.inDays} ${plural(b.inDays, 'день', 'дня', 'дней')}`} · ${esc(b.bday)}</div></div>
      ${b.inDays === 0 && !b.me ? (b.gifted ? `<span class="small">${meG('поздравил', 'поздравила')} ✓</span>` : `<button class="btn small" data-act="gift" data-id="${b.id}">+10 ${BEAN}</button>`) : ''}</div>`).join('')}
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

// «Банда на неделе»: участники и неделя офиса в одном списке. Строка — человек, справа точки по рабочим дням,
// первая — сегодня. Нажатие — карточка, удержание — «Позвать» и «Написать» (у владельца — управление)
function renderCrewWeek(v, g) {
  const x = S.gx, w = x && x.week;
  const reqN = (v.requests || []).length;
  const days = w ? w.days : [];
  const rowOf = new Map(((w && w.rows) || []).map((r) => [r.id, r]));
  const fake = ['office', 'home', 'office', 'office', 'home'];
  const rank = (m) => m.me ? 0 : m.where === 'office' ? 1 : 2;
  const all = [...v.members].sort((a, b) => rank(a) - rank(b));
  // В списке — только те, кто показал график целиком (и ты). Остальные — по кнопке: участники банды всё равно должны быть доступны
  const full = (m) => { const r = rowOf.get(m.id); return !!r && !r.cells.includes('unknown'); };
  const strict = !!(w && !w.locked && days.length);
  const shown = strict ? all.filter((m) => m.me || full(m)) : all;
  const rest = all.length - shown.length;
  const cut = !S.membersAll && (strict ? rest > 0 : all.length > 6);
  const list = S.membersAll ? all : strict ? shown : cut ? all.slice(0, 5) : all;
  const dots = (m, k) => {
    const r = rowOf.get(m.id);
    if (!days.length) return '';
    if (!r && !w.locked) return `<span class="cw-dots cw-none" aria-label="не показывает план"></span>`;
    return `<span class="cw-dots ${!r ? 'cw-blur' : ''}" aria-hidden="${!r}">${days.map((d, i) => {
      const c = r ? r.cells[i] : (d.today ? 'unknown' : fake[(i + k) % 5]);
      return `<i class="wk-c ${c} ${d.today ? 'cw-today' : ''}" title="${esc(d.label)}: ${c === 'off' ? esc(d.holiday || 'выходной') : CELL[c][1]}"></i>`;
    }).join('')}</span>`;
  };
  const row = (m, k) => {
    const [wt, color] = whereText(m);
    const menu = S.memMenu === m.id && !m.me;
    return `<div class="cw-row ${menu ? 'on' : ''}" data-act="person" data-id="${m.id}" ${m.me ? '' : `data-hold="mem-menu"`}>
      ${avatar(m.look, 34)}
      <span class="cw-who"><b class="ellipsis">${nk(m)}${m.me ? ' (ты)' : ''}</b><span class="cw-where"><span class="dot" style="background:${color}"></span><span class="ellipsis">${esc(m.name ? m.name.split(' ')[0] + ' · ' : '')}${esc(wt)}</span></span></span>
      ${m.charge && !m.me ? `<button class="btn small bt-need" data-act="boost-open" data-id="${m.id}" data-nick="${esc(m.nick)}" aria-label="Подкинуть заряд: ${esc(m.nick)} просит подзарядку">bolt</button>` : ''}
      ${dots(m, k)}
    </div>
    ${menu ? `<div class="cw-menu"><button class="btn small" data-act="call-open" data-kind="where" data-to="${m.id}" data-gang="${g.id}">Позвать</button><button class="btn small ghost" data-act="dm-open" data-id="${m.id}">${ico('chat', 15)} Написать</button>
      ${g.isOwner ? `<button class="btn small ghost" data-act="gm-owner" data-id="${m.id}">Сделать владельцем</button><button class="btn small danger" data-act="gm-kick" data-id="${m.id}">Убрать</button>` : ''}</div>` : ''}`;
  };
  const todayCol = days.findIndex((d) => d.today);
  const officeToday = todayCol >= 0 ? v.members.filter((m) => m.where === 'office').length : null;
  const planToday = todayCol >= 0 && w && !w.locked ? Math.max(0, w.rows.filter((r) => r.cells[todayCol] === 'office').length - officeToday) : 0;
  const sum = [officeToday != null ? `Сегодня в офисе <b>${officeToday} из ${v.members.length}</b>${planToday ? `, собираются ещё <b>${planToday}</b>` : ''}` : '',
    w && w.best && !w.best.today ? `больше всего — ${esc(w.best.label.split(' ')[0].toLowerCase())}, <b>${w.best.office}</b>` : ''].filter(Boolean).join(' · ');
  const head = days.length ? `<span class="cw-dots cw-head">${days.map((d) => `<i class="${d.today ? 'cw-today' : ''} ${d.holiday ? 'off' : ''}">${d.today ? 'сег' : esc(d.label.split(' ')[0])}</i>`).join('')}</span>` : '';
  return `<section class="card crew-week">
    <div class="row cw-top"><span class="card-title grow">hand Банда на неделе · ${v.members.length}</span>${head}</div>
    ${sum ? `<div class="cw-sum">${ico('where', 15)}<span>${sum}</span></div>` : ''}
    ${w && w.locked ? planLockMsg(w.locked, true) : ''}
    ${reqN ? `<div class="g-req"><b>Хотят в банду · ${reqN}</b>${v.requests.map((r) => `<div class="person2">${tap(r.id, avatar(r.look, 30))}<span class="grow ellipsis" style="font-weight:800">${nk(r)}</span><button class="btn small" data-act="greq" data-id="${r.id}" data-v="accept">Принять</button><button class="btn small ghost" data-act="greq" data-id="${r.id}" data-v="decline" aria-label="Отклонить">✕</button></div>`).join('')}</div>` : ''}
    <div class="cw-list">${list.map(row).join('')}</div>
    ${cut || S.membersAll ? `<button class="linkbtn" data-act="members-all" aria-expanded="${!cut}">${!cut ? 'Свернуть' : strict ? `Ещё ${rest} — без графика на всю неделю` : `Показать всех · ${all.length}`}</button>` : ''}
    <div class="wk-legend"><span><i class="wk-c office"></i>офис</span><span><i class="wk-c home"></i>дома</span><span><i class="wk-c vacation"></i>отпуск</span><span><i class="wk-c sick"></i>болеет</span>${days.some((d) => d.holiday) ? '<span><i class="wk-c off"></i>праздник</span>' : ''}</div>
    <p class="small cw-hint">Нажми — карточка. Удерживай — «Позвать» и «Написать».${w && !w.locked ? ' <button class="linkbtn" data-act="open-sec" data-v="work">Мой план</button>' : ''}</p>
    ${w && !w.locked ? renderWeekNotes(w) : ''}
    ${w && w.hidden ? `<p class="small" style="margin:0">${w.hidden} ${plural(w.hidden, 'человек не показывает', 'человека не показывают', 'человек не показывают')} план — у них нет точек.</p>` : ''}
    ${g.link ? `<button class="btn blue" data-act="invite-share">Позвать в банду по ссылке</button>` : '<p class="small" style="margin:0">В этой банде новых зовёт только владелец.</p>'}
  </section>`;
}

function renderThanks(v) {
  const x = S.gx;
  if (!x) return '';
  const others = v.members.filter((m) => !m.me);
  const can = others.length && x.thanksLeft > 0;
  const pick = can && S.thxPick;
  const line = (t) => `<div class="thx ${t.toMe ? 'me' : ''}"><b>${esc(t.from)}</b> → <b>${esc(t.to)}</b>${t.text ? ': ' + esc(t.text) : ''}<span class="small"> · ${esc(t.when)}</span></div>`;
  const toMe = x.thanks.find((t) => t.toMe);
  return `<section class="card thx-card">
    <div class="row" style="justify-content:space-between;align-items:center"><span class="card-title">handСпасибо</span>
      ${can ? `<button class="btn small ${pick ? 'ghost' : ''}" data-act="thx-pick" aria-expanded="${!!pick}">${pick ? 'Свернуть' : 'Сказать спасибо'}</button>` : `<span class="small">${x.thanksLeft ? '' : 'на сегодня всё'}</span>`}</div>
    ${pick ? `<p class="small" style="margin:0">Кому? Получит пуш и зерно. Осталось ${x.thanksLeft} из 3 сегодня.</p>
      <div class="chips">${others.map((m) => `<button class="chip ${S.thanksTo === m.id ? 'on' : ''}" data-act="thanks-to" data-v="${m.id}">${nk(m)}</button>`).join('')}</div>
      ${S.thanksTo ? `<div class="row"><label class="field grow" style="gap:0"><span class="hidden">За что спасибо</span><input id="thanks-text" maxlength="80" placeholder="За что? Можно пусто" aria-label="За что спасибо"></label><button class="btn" data-act="thanks-send">Спасибо</button></div>` : ''}` : ''}
    ${toMe && !S.thxAll ? line(toMe) : ''}
    ${x.thanks.length ? `<button class="linkbtn thx-more" data-act="thx-all" aria-expanded="${!!S.thxAll}">${S.thxAll ? 'Свернуть' : `Спасибо за неделю · ${x.thanks.length}`}</button>
      ${S.thxAll ? `<div class="thanks-list">${x.thanks.map(line).join('')}</div>` : ''}` : (pick ? '' : '<p class="small" style="margin:0">За неделю спасибо ещё не было. Начни первым|первой.</p>')}
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
      <span class="ach-ico" aria-hidden="true">${art(a.got ? 'medal_' + (['common', 'rare', 'legendary'].includes(a.tier) ? a.tier : 'common') : a.secret ? 'medal_secret' : 'medal_locked', 44)}</span><span class="ach-name">${esc(a.name)}</span><span class="ach-desc">${esc(a.desc)}</span>${a.got ? '' : prog(a.n, a.goal)}</div>`;
  // Ступени одной серии — одна плитка: уровень, точки уровней, прогресс до следующего
  const seriesTile = (lv) => {
    const done = lv.filter((x) => x.got);
    const top = done[done.length - 1];
    const next = lv.find((x) => !x.got);
    const shown = top || lv[0];
    return `<div class="ach ${shown.tier} ${top ? 'got' : ''} series" title="${esc(next ? 'Дальше: ' + next.desc : 'Все ступени взяты')}">
      <span class="ach-ico" aria-hidden="true">${art(top ? 'medal_' + (['common', 'rare', 'legendary'].includes(shown.tier) ? shown.tier : 'common') : 'medal_locked', 44)}</span><span class="ach-name">${esc(shown.name)}</span>
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
        ${cat === 'duels' ? '<p class="small" style="margin:2px 0 0">Часть ачивок — секретные и смешные: за то, как красиво ты проигрываешь.</p>' : ''}
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
    case 'gang-new': return sheetWrap('Новая банда', renderGangNew());
    case 'gang-find': return sheetWrap('Найти банду', renderGangFind());
    case 'gang-profile': return sheetWrap('Банда', renderGangProfile());
    case 'gang-settings': return sheetWrap('Настройки банды', renderGangSettings());
    case 'crew': return sheetWrap('Подельники', renderCrew());
    case 'stats': return sheetWrap('Этаж сегодня', renderStats());
    case 'about': store.set('aboutSeen', true); return sheetWrap('Об Этаже', aboutHtml());
    case 'style': return sheetWrap('Мой стиль', renderStyle());
    case 'battery': return sheetWrap('Батарейка недели', renderBattery());
    case 'boost': return sheetWrap('Подкинуть заряд', renderBoost());
    case 'wave-launch': return sheetWrap('Волна по банде', renderWaveLaunch());
    case 'thanks-person': return sheetWrap('Респект', renderThx());
    case 'respect-pick': return sheetWrap('Кому респект?', renderRespectPick());
    case 'guide': return sheetWrap('Как тут всё устроено', guideHtml());
    case 'changes': if (S.changes && S.changes[0]) store.set('changesSeen', S.changes[0].day); return sheetWrap('Что нового', changesHtml());
    case 'crest': return sheetWrap('Герб банды', renderCrestEditor());
    case 'gang-switch': return sheetWrap('Перейти в другую банду?', renderGangSwitch());
    case 'league': return sheetWrap('Лига банд', `<div class="res-hero">${art('podium', 88)}</div>` + renderLeague());
    case 'crew-new': return sheetWrap('Позвать в личку', `<p class="sub">С участниками твоих банд переписываться можно сразу. Тех, кто не в банде, зови по нику или личной ссылкой.</p>
      <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Ник</span><input id="crew-nick" maxlength="21" placeholder="ник" autocapitalize="off" autocomplete="off" aria-label="Ник"></label><button class="btn" data-act="crew-add">Позвать</button></div>
      <button class="btn blue" data-act="crew-share">Отправить свою ссылку</button>
      <p class="small">Кто откроет ссылку, сразу сможет тебе писать, поэтому шли её лично, а не в общий чат.</p>
      ${S.crew && S.crew.outgoing.length ? `<div class="crew-out"><span class="small">Ждём ответа:</span> ${S.crew.outgoing.map((p) => `<span class="rep">${nk(p)} <button class="linkbtn" data-act="crew-decline" data-id="${p.id}" aria-label="Отменить заявку">✕</button></span>`).join(' ')}</div>` : ''}
      ${S.crew && S.crew.blocked.length ? `<details><summary class="small" style="cursor:pointer;min-height:32px">Заблокированные (${S.crew.blocked.length})</summary>${S.crew.blocked.map((p) => `<div class="row" style="justify-content:space-between"><span>${nk(p)}</span><button class="linkbtn" data-act="crew-unblock" data-id="${p.id}">Разблокировать</button></div>`).join('')}</details>` : ''}`);
    case 'pcall': return sheetWrap('Позвать ' + (((S.people || []).find((p) => p.id === S.pcallTo) || (S.person && S.person.id === S.pcallTo ? S.person : null) || {}).nick || ''), `<p class="sub">Лично, придёт пуш. Тихие часы 19:00–09:00 уважаем.</p>
      <div class="calls">${['coffee', 'lunch', 'room', 'call', 'where', 'online', 'wait'].map((k) => `<button class="call" style="--c:${CALL_STYLE[k]}" data-act="pcall" data-id="${S.pcallTo}" data-kind="${k}">${ico(k, 20)}<span>${esc(S.cat.calls[k].label)}</span></button>`).join('')}</div>
      <button class="btn ghost" data-act="dm-open" data-id="${S.pcallTo}">chat Написать сообщение</button>`);
    case 'find': return sheetWrap('Найти своих', renderFind());
    case 'feedback': return sheetWrap('Идеи и ошибки', renderFeedback());
    case 'blitz': return sheetWrap(S.blitz && S.blitz.set ? S.blitz.set.title : 'Блиц', renderBlitzPlay());
    case 'poll-new': return sheetWrap('Новый опрос', renderPollNew());
    case 'gev-new': return sheetWrap(S.gevDraft && S.gevDraft.editId ? 'Изменить событие' : 'Новое событие', renderGEventNew());
    case 'war-new': return sheetWrap('swords Вызов на битву', renderWarNew());
    case 'war-accept': return sheetWrap('swords Принять вызов', renderWarAccept());
    case 'treasury': return sheetWrap('bank Казна банды', renderTreasury());
    case 'war-hero': return sheetWrap('star Герой банды', renderWarHero());
    case 'tourney': return sheetWrap(S.tour ? `trophy ${S.tour.title}` : 'trophy Турнир', renderTourney());
    case 'dm-pick': return sheetWrap('Написать в личку', `<p class="sub" style="margin:0">Написать можно любому — если он сам не ограничил личку. Подельникам и своей банде — проще всего.</p>
      <button class="find-bar light" data-act="find-open">${ico('search', 18)}<span>Найти человека по нику или почте</span></button>
      ${(S.people || []).map((p) => `<button class="chat-row" data-act="dm-open" data-id="${p.id}">${avatar(p.look, 36)}<span class="grow"><span class="chat-title">${p.crew ? '<span class="fav-star">★</span> ' : ''}${nk(p)}</span><span class="where">${esc(p.gangs.map((g) => g.name).join(', ') || (p.crew ? 'подельник' : whereText(p)[0]))}</span></span><span aria-hidden="true">›</span></button>`).join('')}`);
    case 'duel-pick': return sheetWrap(`${{ rps: 'rock Камень, ножницы, бумага', dice: 'dice Кости', ttt: 'x Крестики-нолики', sea: 'anchor Морской бой' }[S.duelGame] || 'Дуэль'}: с кем?`, `
      <button class="chat-row pr-row" data-act="pr-start" data-v="${S.duelGame}">${avatar(PR.BOT.look, 36)}<span class="grow"><span class="chat-title">Практика</span><span class="where">${S.duelGame === 'ttt' || S.duelGame === 'sea' ? 'два уровня · есть ачивки' : 'без зёрен и рейтинга'}</span></span><span class="pr-go">Играть</span></button>
      <div class="pr-or"><span>или со своими</span></div>
      ${S.duelGame === 'sea' ? seaModes({ pick: S.seaMode || 'calm' }) : ''}
      <div class="duel-stake"><span class="small">Ставка:</span>${[0, 5, 10].map((x) => `<button class="chip ${(S.duelStake || 0) === x ? 'on' : ''}" data-act="duel-stake" data-v="${x}">${x ? x + ' зёрен' : 'без ставки'}</button>`).join('')}</div>
      ${(S.people || []).length ? (S.people || []).map((p) => `<button class="chat-row" data-act="duel-go" data-id="${p.id}">${avatar(p.look, 36)}<span class="grow"><span class="chat-title">${p.crew ? '<span class="fav-star">★</span> ' : ''}${nk(p)}</span><span class="where">${esc(whereText(p)[0])}</span></span><span aria-hidden="true">swords</span></button>`).join('') : '<p class="sub">Пока некого вызвать: найди своих по нику или вступи в банду.</p>'}
      <button class="find-bar light" data-act="find-open">${ico('search', 18)}<span>Найти соперника по нику</span></button>
      <p class="small" style="margin:0">${S.duelGame === 'sea' ? 'Вызвать можно любого, кому можно написать лично. Соперник платит ставку, когда нажимает «В бой»; откажется — зёрна вернутся.' : 'Вызвать можно любого, кому можно написать лично. Дуэль появится у вас в личке.'}</p>`);
    case 'battle-pick': return sheetWrap('С кем сыграть?', (S.people || []).length ? (S.people || []).map((p) => `<button class="chat-row" data-act="dm-open" data-id="${p.id}">${avatar(p.look, 36)}<span class="grow"><span class="chat-title">${nk(p)}</span><span class="where">${esc(whereText(p)[0])}</span></span><span aria-hidden="true">›</span></button>`).join('') + '<p class="small">Откроется переписка — там выбери «Без спешки» или «Быстрая».</p>' : '<p class="sub">Сначала сколоти банду и позови в неё своих.</p>');
    case 'whatsnew': return sheetWrap('Что поменялось', `<div class="wn">
      <div class="wn-i"><span>room</span><div><b>Рядом</b><p>Главный экран: где ты сегодня и все твои люди одним списком — кто в офисе, кто дома, кто в отпуске.</p></div></div>
      <div class="wn-i"><span>chat</span><div><b>Чаты</b><p>Банды и личка вместе. Членам своей банды теперь можно писать лично — без заявки.</p></div></div>
      <div class="wn-i"><span>office</span><div><b>Офис</b><p>Столовая, Доска объявлений, сигналы и «Мои события».</p></div></div>
      <div class="wn-i"><span>game</span><div><b>Игры</b><p>Задания, квизы, морской бой, случайный кофе, ачивки и Лавка — всё в одном месте.</p></div></div>
      <button class="btn wide" data-act="whatsnew-ok">Понятно, покажи</button></div>`);
    case 'avatar': return sheetWrap(S.avaMode === 'vacation' ? 'Образ для отпуска' : 'Конструктор', renderAvatarEditor());
    case 'meme': return sheetWrap('Мем-открытка', renderMemeMaker());
    case 'shop': return sheetWrap('Лавка', renderShop());
    case 'gift-pick': return sheetWrap(S.giftMode === 'prank' ? 'Разыграть подельника' : 'Подарить подельнику', (S.giftMode === 'prank' ? '' : `<div class="res-hero">${art('gift', 88)}</div>`) + renderGiftPick());
    case 'inbox': return sheetWrap('Этаж', renderInbox());
    case 'board-new': return sheetWrap(S.boardDraft && S.boardDraft.kind === 'lunch' ? 'Позвать на обед' : 'Объявление', renderBoardNew());
    case 'coffee': return sheetWrap('Случайный кофе', `<div class="coffee-sheet">${renderCoffee()}</div><p class="small">Раз в неделю, в понедельник в 10:00, знакомим с коллегой из твоего офиса, который не в твоих бандах. Договориться о времени можно прямо здесь — кнопками.</p>${S.fx && S.fx.coffee && S.fx.coffee.optIn ? '<button class="linkbtn" data-act="coffee-off">Больше не участвовать</button>' : ''}`);
    case 'install': return sheetWrap('Установи на телефон', renderInstall());
    case 'compose': return sheetWrap(S.cat.calls[S.compose.kind].label, renderCompose());
    case 'focus': return sheetWrap('В фокусе', `
      <p class="sub">Пуши — зовы, личка, чат банды — не придут, пока ты в фокусе. Сообщения никуда не денутся, увидишь их после. Банда видит наушники и до скольки ты занят${meG('', 'а')}.</p>
      <div class="focus-grid">
        <button class="btn ghost" data-act="focus-set" data-v="30">30 минут</button>
        <button class="btn ghost" data-act="focus-set" data-v="60">Час</button>
        <button class="btn ghost" data-act="focus-set" data-v="120">Два часа</button>
        <button class="btn ghost" data-act="focus-set" data-v="eod">До 19:00</button>
      </div>`);
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
      <button class="btn wide" data-act="vac-now">${meG('Ушёл в отпуск', 'Ушла в отпуск')}</button>`);
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
      ${members.map((m) => `<button class="chip ${c.to === m.id ? 'on' : ''}" data-act="c-to" data-v="${m.id}">${nk(m)}</button>`).join('')}
    </div></div>
    ${def.opts.length ? `<div class="field">Когда / где<div class="chips">${def.opts.map((o) => `<button class="chip ${c.opt === o ? 'on' : ''}" data-act="c-opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>` : ''}
    ${def.textLabel ? `<label class="field">${esc(def.textLabel)}<input id="c-text" maxlength="40" placeholder="${esc(def.textHint)}" value="${esc(c.text || '')}"></label>` : ''}
    <button class="btn wide" data-act="call-send">Позвать</button>
    <div class="row" style="justify-content:space-between;gap:8px"><p class="small" style="margin:0">Не больше 3 зовов в час.</p><button class="linkbtn small" data-act="tpl-save">${ico('star', 14)}Сохранить шаблоном</button></div>`;
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
  const ios = isIOS(), wrap = wrapBrowser();
  const blocked = `<details class="install-blocked"><summary>Телефон пишет «Подозрительное приложение заблокировано»?</summary>
      <p class="small">Так Play Защита реагирует на Этаж, установленный из Samsung Internet, Яндекс Браузера или браузера Xiaomi: они упаковывают сайт в свою «обёртку» под старую версию Android. С самим Этажем всё в порядке.</p>
      <ol class="ol"><li>Удали заблокированную иконку Этажа.</li><li>Открой ${esc(location.host)} в Chrome.</li><li>Меню ⋮ → «Установить приложение».</li><li>Войди по почте — банда, зёрна и переписка на месте.</li></ol></details>`;
  if (wrap && !isStandalone()) return `
    <div class="note warn">Ты в браузере «${esc(wrap)}». Если установить Этаж отсюда, Play Защита может заблокировать его как «подозрительное приложение». Установи из Chrome — там всё проходит без предупреждений.</div>
    <a class="btn wide" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${chromeIntent()}">Открыть в Chrome</a>
    <ol class="ol"><li>Нажми «Открыть в Chrome».</li><li>В Chrome: меню ⋮ → «Установить приложение».</li><li>Войди по почте и включи уведомления в профиле.</li></ol>
    ${blocked}`;
  return `
    ${isStandalone() ? '<div class="note good">Приложение уже установлено.</div>' : ''}
    ${deferredInstall ? '<button class="btn wide" data-act="install-native">Установить</button>' : ''}
    <h3>${ios ? 'iPhone (Safari)' : 'Android (Chrome)'}</h3>
    ${ios ? `<ol class="ol"><li>Открой этот сайт в Safari.</li><li>Нажми «Поделиться» внизу экрана.</li><li>Выбери «На экран “Домой”».</li><li>Открой Этаж с иконки и включи уведомления в профиле.</li></ol>
      <p class="small">Уведомления на iPhone работают с iOS 16.4 и только из установленного приложения.</p>`
      : `<ol class="ol"><li>Открой сайт в Chrome — из Samsung Internet и Яндекс Браузера Play Защита может заблокировать установку.</li><li>Меню ⋮ → «Установить приложение».</li><li>Открой Этаж с иконки и включи уведомления в профиле.</li></ol>${blocked}`}
    <h3>${ios ? 'Android' : 'iPhone'}</h3>
    <p class="sub">${ios ? 'Chrome → меню ⋮ → «Установить приложение».' : 'Safari → «Поделиться» → «На экран “Домой”».'}</p>`;
}

// «Угадай коллегу»: вопросы из профилей банды
// «Кто из наших?» выключен: пока народу мало, вопросы повторяются. Включается флагом; сервер и данные не тронуты
const GUESS_ON = false;
function renderGuess() {
  const r = S.guess;
  if (!GUESS_ON || !r) return '';
  const head = `<div class="row" style="justify-content:space-between"><span class="card-title has-art">${art('friends', 30)}Кто из наших?</span>` + (r.question ? `<span class="small">осталось ${r.question.left} из 3 сегодня</span>` : '') + '</div>';
  if (r.small) return `<section class="card guess">${head}<p class="small" style="margin:0">Игра откроется, когда в банде будет хотя бы 4 человека. Позови ещё ${r.need} ${plural(r.need, 'человека', 'человек', 'человек')} по ссылке ниже.</p></section>`;
  if (!r.question) return `<section class="card guess">${head}<p class="small" style="margin:0">На сегодня всё, завтра будут новые вопросы. Они собираются из профилей банды: чем больше свои расскажут о себе, тем интереснее угадывать.</p></section>`;
  const x = r.question;
  const prompt = x.kind === 'avatar' ? `<div class="guess-ava">${avatar(x.look, 110)}</div><div class="guess-q">Кто из банды так выглядит?</div>`
    : x.kind === 'about' ? `<div class="guess-quote">«${esc(x.about)}»</div><div class="guess-q">Кто написал это о себе?</div>`
    : `<div class="chips" style="justify-content:center">${x.tags.map((t) => `<span class="chip on" style="cursor:default">${esc(t)}</span>`).join('')}</div><div class="guess-q">Чьи это интересы?</div>`;
  const opts = x.options.map((o) => {
    let cls = '';
    if (x.answered) cls = o.id === x.answer ? 'ok' : o.id === x.pick ? 'bad' : 'dim';
    return `<button class="gopt ${cls}" ${x.answered ? 'disabled' : `data-act="guess-pick" data-id="${x.id}" data-v="${o.id}"`}>${nk(o)}</button>`;
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
  return `<div class="bl-board">${b.top.slice(0, limit).map((r) => `<div class="bl-row ${r.me ? 'me' : ''}"><span class="bl-place">${r.place <= 3 ? ['medal', 'medal', 'medal'][r.place - 1] : r.place}</span><span class="grow ellipsis">${nk(r)}${r.me ? ' (ты)' : ''}</span><b>${r.score}</b><span class="small">${mmss(r.secs * 1000)}</span></div>`).join('')}</div>
    ${b.place && b.place > limit ? `<p class="small" style="margin:6px 0 0">Ты на ${b.place} месте из ${b.players}</p>` : ''}`;
}
function renderBlitzCard() {
  const b = S.blitz;
  if (!b || !b.set) return '';
  const st = b.set;
  const head = `<div class="row" style="justify-content:space-between"><span class="card-title has-art">${art('stopwatch', 30)}Блиц: ${esc(st.title)}</span><span class="small">до ${ddmm(st.to)}</span></div>`;
  if (b.state === 'new') {
    return `<section class="card blitz">${head}
      <p class="sub" style="margin:6px 0 10px">${esc(st.desc)}</p>
      <div class="bl-facts"><span>wait ${Math.round(st.secs / 60)} мин</span><span>help ${st.count} вопросов</span><span>${BEAN} до +${st.maxBeans}</span></div>
      <button class="btn wide" data-act="blitz-start">Начать — таймер пойдёт сразу</button>
      <p class="small" style="margin:8px 0 6px">Одна попытка. Закроешь окно — время всё равно идёт.</p>
      ${b.board && b.board.top.length ? `<div class="eyebrow">Лидеры</div>${blitzBoard(b.board, 3)}` : ''}
    </section>`;
  }
  if (b.state === 'play') {
    return `<section class="card blitz">${head}<p class="sub" style="margin:6px 0 10px">Блиц идёт: осталось <b>${mmss(b.leftMs)}</b>, верных ${b.score}.</p>
      <button class="btn wide" data-act="blitz-open">Продолжить</button></section>`;
  }
  // Прошёл — только тройка лидеров; своё место — строкой под ней, если ты не в тройке
  return `<section class="card blitz done">${head}${blitzBoard(b.board, 3)}</section>`;
}
function renderBlitzPlay() {
  const b = S.blitz;
  if (!b || !b.set) return '<p class="sub">Загружаем…</p>';
  if (S.blitzWar && b.state === 'new') {
    return `<div class="war-intro"><span class="war-big">swords</span>${b.cheers && b.cheers.length ? `<div class="cheers">bolt За тебя болеют: ${b.cheers.map(esc).join(', ')}</div>` : ''}<p class="sub">Ты защищаешь честь банды. ${b.set.count} вопросов по теме «${esc(b.set.title)}», 3 минуты. Отвечай быстро: при равенстве верных побеждает тот, кто быстрее.</p>
      <button class="btn wide" data-act="war-start">Начать — таймер пойдёт сразу</button><p class="small" style="margin:0">Одна попытка. Закроешь окно — время всё равно идёт.</p></div>`;
  }
  if (S.blitzWar && b.state === 'done') {
    const w = b.warView;
    const res = w && w.status === 'done' ? (w.winner === 'us' ? 'trophy Банда победила!' : w.winner === 'them' ? 'Соперник оказался сильнее' : 'Ничья') : 'Итог будет, когда пройдёт соперник — придёт пуш';
    return `<div class="bl-result big"><b>${b.score || 0}</b><span>верных из ${b.answered} · за ${mmss((b.secs || 0) * 1000)}</span></div>
      <p class="sub" style="text-align:center">${res}</p><button class="btn wide" data-act="war-play-close">Готово</button>`;
  }
  if (b.state !== 'play' || !b.question) {
    S.blitzStreak = 0;
    const mood = (b.score || 0) >= 10 ? 'win' : (b.score || 0) >= 5 ? 'happy' : 'meh';
    return `<div class="bl-end duel-fx"><span class="bl-me mood-${mood}"><span class="dvs-ava">${avatar(moodLook(S.me.look, mood), 64)}</span></span>${mood === 'win' && b.state === 'done' ? confetti(22) : ''}</div>${['win', 'happy'].includes(mood) ? `<div class="res-hero">${art('win', 96)}</div>` : ['lose', 'sad'].includes(mood) ? `<div class="res-hero">${art('lose', 96)}</div>` : ''}<div class="bl-result big"><b>${b.score || 0}</b><span>верных${b.answered != null ? ` из ${b.answered}` : ''}${b.beans ? ` · +${b.beans} зёрен` : ''}</span></div>
      ${b.board && b.board.place ? `<p class="sub" style="text-align:center">Твоё место — ${b.board.place} из ${b.board.players}</p>` : ''}
      <div class="eyebrow">Лидеры</div>${blitzBoard(b.board)}
      <button class="btn wide" style="margin-top:12px" data-act="close">Готово</button>`;
  }
  const qn = b.question;
  const fb = S.blitzFb;
  const pct = Math.max(0, Math.min(100, (b.leftMs / (b.set.secs * 1000)) * 100));
  const ok = fb && fb.n === qn.n ? fb.pick === fb.right : null;
  const st = S.blitzStreak || 0;
  return `<div class="bl-top"><span class="bl-me ${ok === true ? 'mood-happy fresh' : ok === false ? 'mood-sad fresh' : ''}"><span class="dvs-ava">${avatar(moodLook(S.me.look, ok === true ? 'happy' : ok === false ? 'sad' : 'smirk'), 38)}</span>${ok === true ? '<i class="bl-plus">+1</i>' : ''}</span>
    <span class="bl-time ${b.leftMs < 15000 ? 'hot' : ''}" id="bl-time">${mmss(b.leftMs)}</span><span class="small grow" style="text-align:right">вопрос ${qn.n} из ${qn.total} · верных <b>${b.score}</b>${st >= 3 ? `<span class="bl-streak">${T('flame')}${st} подряд</span>` : ''}</span></div>
    <div class="bl-bar"><i id="bl-bar" style="width:${pct}%"></i></div>
    <p class="bl-q">${esc(qn.text)}</p>
    ${S.blitzOver ? '<div class="note warn bl-over">Время вышло — считаем итог…</div>' : `<div class="bl-opts">${qn.options.map((o, i) => `<button class="gopt bl-opt ${fb && fb.n === qn.n ? (i === fb.right ? 'ok' : i === fb.pick ? 'bad' : 'dim') : ''}" data-act="blitz-pick" data-n="${qn.n}" data-v="${i}" ${fb && fb.n === qn.n ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`}`;
}
// Время вышло. Сервер ещё 3 секунды ждёт ответы, отправленные в последний миг, и только потом закрывает блиц.
// Раньше клиент спрашивал итог через 0,4 с, получал «ещё идёт» — и вопрос с 0:00 висел, пока не нажмёшь вариант
async function blitzTimeout() {
  S.blitzOver = true; render();
  toast('Время вышло!');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    if (S.blitzWar) { await wait(400); S.blitz = await post(`/api/wars/${S.blitzWar}/timeout`); await loadWars(); }
    else {
      await wait(3400);
      for (let i = 0; i < 6; i++) {
        await loadBlitz();
        if (!S.blitz || S.blitz.state !== 'play') break;
        await wait(1500);
      }
    }
    sfx('confirm'); loadMe().catch(() => {});
  } catch (e) { toast(e.message); }
  S.blitzOver = false; render();
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
      blitzTimeout();
    }
  }, 250);
}

function renderQuiz() {
  const z = (S.quiz || [])[0];
  if (!z) return '';
  const more = (S.quiz || []).filter((x) => !x.answered).length - (z.answered ? 0 : 1);
  const qf = !!(S.quizFresh && S.quizFresh.id === z.id && Date.now() < S.quizFresh.until);
  const opts = z.options.map((o, i) => {
    if (!z.answered) return `<button class="gopt" data-act="quiz-pick" data-id="${z.id}" data-v="${i}">${esc(o)}</button>`;
    const st = z.stats[i];
    const cls = i === z.correct ? 'ok' : i === z.pick ? 'bad' : '';
    return `<div class="qres ${cls}"><span class="qbar" style="width:${st.pct}%"></span><span class="qtxt">${i === z.correct ? '✓ ' : ''}${esc(o)}</span><span class="qpct">${st.pct}%</span></div>`;
  }).join('');
  return `<section class="card quiz duel-fx">
    <div class="row" style="justify-content:space-between"><span class="card-title has-art">${art('quiz', 30)}Квиз недели</span><span class="small">${z.answered ? `ответили ${z.total}` : '+3 за верный ответ'}</span></div>
    <div class="quiz-q">${esc(z.text)}</div>
    <div class="gopts">${opts}</div>
    ${z.answered ? `<div class="quiz-res ${z.pick === z.correct ? 'good' : 'warn'} ${qf ? 'fresh' : ''}"><span class="qr-ava">${avatar(moodLook(S.me.look, z.pick === z.correct ? 'happy' : 'sad'), 40)}</span><div class="note ${z.pick === z.correct ? 'good' : 'warn'}" style="margin:0">${z.pick === z.correct ? 'Верно!' : 'Мимо.'}${z.explain ? ' ' + esc(z.explain) : ''}</div></div>` : ''}
    ${qf && z.pick === z.correct ? confetti(18) : ''}
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
  { tab: 'chats', i: 1, title: 'Банда', text: 'Твои люди: общий чат, зовы на кофе и обед, опросы и Лига. Личка и морской бой — под значком диалога наверху.' },
  { tab: 'office', i: 2, title: 'Офис', text: 'Загрузка столовой и оценка обеда, Доска с кухней и объявлениями, сигналы с этажа и лента событий.' },
  { tab: 'games', i: 3, title: 'Игры', text: 'Задания дня, квиз недели, морской бой и случайный кофе. За всё дают зёрна — их тратят в Лавке.' }
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
let audioCtx = null, master = null, wetIn = null;
const soundVol = () => { const v = Number(store.get('soundVol', store.get('sound', true) === false ? 0 : 60)); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 60; };
const vibroOn = () => store.get('vibro', true) !== false;
// Импульс для ревербератора: затухающий стерео-шум — «комната», чтобы игровые звуки не были плоскими
function impulse(ctx, sec = 1.4, decay = 3.2) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return b;
}
// Шина: громкость → компрессор (не даёт хрипеть при наложении) → выход; отдельная посылка на реверб
function audioBus(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  const out = ctx.createGain(); out.connect(comp).connect(ctx.destination);
  const rv = ctx.createConvolver(); rv.buffer = impulse(ctx);
  const send = ctx.createGain(), ret = ctx.createGain(); ret.gain.value = 0.35;
  send.connect(rv).connect(ret).connect(out);
  return { out, send };
}
function actx() {
  const v = soundVol();
  if (!v) return null;
  try {
    if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); const b = audioBus(audioCtx); master = b.out; wetIn = b.send; loadSamples(audioCtx); }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    master.gain.value = Math.pow(v / 60, 1.6); // 60 — привычная громкость, выше — громче
    return audioCtx;
  } catch { return null; }
}
// Записанные звуки: живой оркестр (сэмплы VS Chamber Orchestra, CC0), сведённые в короткие фразы.
// Грузятся один раз при первом звуке; пока не загрузились или без сети — играет синтезированная версия
const SAMPLE_URLS = { bugle: '/sounds/battle.mp3', lose: '/sounds/lose.mp3', victory: '/sounds/win.mp3', fanfare: '/sounds/rally.mp3', gangHorn: '/sounds/horn.mp3',
  // Морской бой: настоящие записи пушки, взрывов и воды (CC0), по два варианта — чтобы выстрелы не звучали одинаково
  splash: ['/sounds/miss1.mp3', '/sounds/miss2.mp3'], hit: ['/sounds/hit1.mp3', '/sounds/hit2.mp3'], sunk: '/sounds/sunk1.mp3', chicken: '/sounds/resign.mp3',
  // Реакции в играх: короткие «мультяшные» реплики оркестра — у каждой своя, узнаётся без взгляда на экран
  ...Object.fromEntries(['lol', 'angry', 'bored', 'smart', 'oops', 'clap', 'mercy', 'easy'].map((k) => [`emo_${k}`, `/sounds/emo_${k}.mp3`])) };
// Громкость записей подогнана к остальным звукам: кульминации боя громче всего, но не оглушают
const SAMPLE_VOL = { bugle: 0.62, lose: 0.75, victory: 0.53, fanfare: 0.26, gangHorn: 0.28, splash: 0.3, hit: 0.25, sunk: 0.4, chicken: 0.13,
  emo_lol: 0.157, emo_angry: 0.19, emo_bored: 0.126, emo_smart: 0.155, emo_oops: 0.135, emo_clap: 0.159, emo_mercy: 0.126, emo_easy: 0.31 };
const sampleBuf = {};
function loadSamples(c) {
  for (const [k, urls] of Object.entries(SAMPLE_URLS)) {
    if (sampleBuf[k] !== undefined) continue;
    sampleBuf[k] = [];
    for (const url of [].concat(urls)) {
      fetch(url).then((r) => r.arrayBuffer()).then((b) => new Promise((ok, no) => c.decodeAudioData(b, ok, no))).then((buf) => { sampleBuf[k].push(buf); }).catch(() => {});
    }
  }
}
function playSample(c, k, vol = SAMPLE_VOL[k] || 0.6) {
  const list = sampleBuf[k]; if (!list || !list.length) return false;
  const buf = list[Math.floor(Math.random() * list.length)];
  const src = c.createBufferSource(), g = c.createGain(); src.buffer = buf; g.gain.value = vol;
  // Громкость записи задана в SAMPLE_VOL — поправку синтезированных звуков (SOUND_GAIN) к ней не применяем
  const sg = sfxGain; sfxGain = 1; src.connect(g); sndOut(c, g, 0); sfxGain = sg; src.start(); return true;
}
// Подключить узел к выходу: сухой сигнал + немного в реверб (rv 0…1). pan — стерео −1…1
// Поправка громкости отдельных звуков (см. SOUND_GAIN): выставляется в sfx() на время вызова
let sfxGain = 1;
function sndOut(ctx, node, rv = 0, pan = null) {
  let n = node;
  if (sfxGain !== 1) { const g = ctx.createGain(); g.gain.value = sfxGain; n.connect(g); n = g; }
  if (pan !== null && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; n.connect(p); n = p; }
  n.connect(master);
  if (rv && wetIn) { const s = ctx.createGain(); s.gain.value = rv; n.connect(s).connect(wetIn); }
  return n;
}
const noiseBuf = (ctx, dur, shape = 2) => {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, shape);
  return buf;
};
function tone(ctx, { f = 600, f2 = null, type = 'triangle', at = 0, dur = 0.12, vol = 0.07, atk = 0.008, rv = 0, pan = null }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.8);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); sndOut(ctx, g, rv, pan); o.start(t); o.stop(t + dur + 0.02);
}
// Фильтрованный шум: щелчки, всплески, «вжух»
function noise(ctx, { at = 0, dur = 0.08, vol = 0.08, type = 'bandpass', f = 2000, f2 = null, q = 1, shape = 2, rv = 0, pan = null, pan2 = null }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf(ctx, dur, shape); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  src.connect(fl).connect(g);
  if (pan2 !== null && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner(); p.pan.setValueAtTime(pan ?? 0, t); p.pan.linearRampToValueAtTime(pan2, t + dur); g.connect(p); sndOut(ctx, p, rv);
  } else sndOut(ctx, g, rv, pan);
  src.start(t);
}
// Щелчок как в Android: 5–10 мс шума с крутым спадом и едва слышное «тело» — без нот и мелодий
function tick(ctx, { at = 0, f = 2600, body = 1500, vol = 0.12, dur = 0.007 } = {}) {
  noise(ctx, { at, dur, vol, type: 'bandpass', f, q: 0.7, shape: 5 });
  tone(ctx, { f: body, f2: body * 0.8, type: 'sine', at, dur: 0.018, vol: vol * 0.22, atk: 0.001 });
}
// Колокольчик: негармонические обертоны, как у металла
function bell(ctx, { f, at = 0, dur = 0.9, vol = 0.05, rv = 0.3 }) {
  [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]].filter(([k]) => f * k < 7500).forEach(([k, a], i) => tone(ctx, { f: f * k, type: 'sine', at, dur: dur / (1 + i * 0.7), vol: vol * a, atk: 0.003, rv }));
}
// Медная труба: три расстроенные пилы через раскрывающийся фильтр, подъезд к ноте снизу, дыхание на атаке.
// wah — «вау» сурдиной, как у грустного тромбона
function brass(ctx, { f, at = 0, dur = 0.2, vol = 0.09, vib = 0, dark = false, wah = 0, rv = 0.3 }) {
  const t = ctx.currentTime + at;
  const mix = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
  const k = dark ? 0.6 : 1;
  lp.frequency.setValueAtTime(f * 1.1 * k, t); lp.frequency.exponentialRampToValueAtTime(f * 6 * k, t + 0.06); lp.frequency.exponentialRampToValueAtTime(f * 3.2 * k, t + dur);
  if (wah) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = wah; lg.gain.value = f * 1.6 * k; l.connect(lg).connect(lp.frequency); l.start(t); l.stop(t + dur + 0.05); }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.035); g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.05, dur - 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  [[1, 'sawtooth', 1], [1.006, 'sawtooth', 0.6], [0.995, 'sawtooth', 0.6], [0.5, 'triangle', 0.5]].forEach(([d, type, lvl]) => {
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; og.gain.value = lvl * 0.5;
    o.frequency.setValueAtTime(f * d * 0.93, t); o.frequency.exponentialRampToValueAtTime(f * d, t + 0.04);
    if (vib) { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.4; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * d * vib, t + dur * 0.6); lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05); }
    o.connect(og).connect(mix); o.start(t); o.stop(t + dur + 0.05);
  });
  mix.connect(lp).connect(g); sndOut(ctx, g, rv);
  noise(ctx, { at, dur: 0.06, vol: vol * 0.5, type: 'bandpass', f: f * 4, q: 1.2, rv }); // дыхание
}
// ----- Оркестр для боя: литавры, малый барабан, тарелки, струнные, казу, свисток -----
// Литавра: удар с лёгким падением тона и мягким шумом палочки
function timpani(ctx, { f = 73.4, at = 0, vol = 0.12, dur = 0.9, rv = 0.35 } = {}) {
  tone(ctx, { f: f * 1.05, f2: f, type: 'sine', at, dur, vol, atk: 0.003, rv });
  tone(ctx, { f: f * 2.01, f2: f * 1.98, type: 'sine', at, dur: dur * 0.5, vol: vol * 0.35, atk: 0.003, rv });
  noise(ctx, { at, dur: 0.05, vol: vol * 0.5, type: 'lowpass', f: 900, q: 0.7, rv });
}
// Тарелка: длинный яркий шум, медленно гаснет
function crash(ctx, { at = 0, vol = 0.08, dur = 1.8, rv = 0.45 } = {}) {
  noise(ctx, { at, dur, vol, type: 'highpass', f: 5200, q: 0.5, shape: 1.4, rv, pan: 0.25 });
  noise(ctx, { at, dur: dur * 0.6, vol: vol * 0.6, type: 'bandpass', f: 3200, q: 0.8, shape: 1.8, rv, pan: -0.25 });
}
// Струнные: широкий хор пил через фильтр, плавная атака — подложка под медь
function strings(ctx, { notes, at = 0, dur = 1.4, vol = 0.03, rv = 0.5 } = {}) {
  const t = ctx.currentTime + at;
  const lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.6;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.25); g.gain.setValueAtTime(vol, t + dur - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(g); sndOut(ctx, g, rv);
  for (const f of notes) for (const d of [0.994, 1, 1.007]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * d;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5 + Math.random(); lg.gain.value = f * 0.004; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur);
    o.connect(lp); o.start(t); o.stop(t + dur);
  }
}
// Казу: гнусавая «пила» через узкую полосу, с быстрым дрожанием — для насмешки
function kazoo(ctx, { f, f2 = null, at = 0, dur = 0.14, vol = 0.05, rv = 0.25 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 9; lg.gain.value = f * 0.025; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
  bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 2.2;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(bp).connect(g); sndOut(ctx, g, rv); o.start(t); o.stop(t + dur + 0.05);
}
// Взрыв: низкий удар, грохот через закрывающийся фильтр и треск обломков
function blast(ctx, { at = 0, vol = 0.5, len = 0.9, crackle = 6, rv = 0.4 } = {}) {
  const t = ctx.currentTime + at;
  tone(ctx, { f: 140, f2: 38, type: 'sine', at, dur: len * 0.6, vol: vol * 0.9, atk: 0.002 });
  const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf(ctx, len, 2.2); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1300, t); lp.frequency.exponentialRampToValueAtTime(60, t + len * 0.8);
  g.gain.setValueAtTime(vol, t);
  src.connect(lp).connect(g); sndOut(ctx, g, rv); src.start(t);
  for (let i = 0; i < crackle; i++) noise(ctx, { at: at + 0.04 + Math.random() * len * 0.6, dur: 0.02 + Math.random() * 0.03, vol: vol * 0.15 * Math.random(), type: 'bandpass', f: 1800 + Math.random() * 1500, q: 1.5, rv, pan: Math.random() * 1.4 - 0.7 });
}
const boom = (ctx, at, vol = 0.5, len = 0.7) => blast(ctx, { at, vol, len, crackle: 2, rv: 0.25 });
// Глубокий взрыв: суб-удар с падающим тоном, рокот и сатурация. Сатурация нужна, чтобы низ слышали
// и динамики телефона — они не играют ниже 150 Гц, но слышат обертоны, и мозг «достраивает» бас
const satCurve = (k) => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; };
function deepBoom(ctx, { at = 0, vol = 0.6, len = 1.2, f0 = 90, drive = 3, bright = 1800, rv = 0.35, pan = null } = {}) {
  const t = ctx.currentTime + at;
  const mix = ctx.createGain(), sh = ctx.createWaveShaper(), tone = ctx.createBiquadFilter(), out = ctx.createGain();
  sh.curve = satCurve(drive); sh.oversample = '2x';
  tone.type = 'lowpass'; tone.Q.value = 0.7; tone.frequency.setValueAtTime(bright, t); tone.frequency.exponentialRampToValueAtTime(140, t + len * 0.6);
  out.gain.setValueAtTime(vol, t);
  mix.connect(sh).connect(tone).connect(out); sndOut(ctx, out, rv, pan);
  // Суб: удар грудью — тон падает в самый низ
  [[f0, 0.9], [f0 * 0.62, 0.6]].forEach(([f, a]) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(18, f * 0.28), t + len * 0.55);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + len * 0.75);
    o.connect(g).connect(mix); o.start(t); o.stop(t + len);
  });
  // Тело: тёмный шум, фильтр закрывается — «бу-у-ум», а не «пш-ш»
  const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
  src.buffer = noiseBuf(ctx, len, 1.4); lp.type = 'lowpass'; lp.Q.value = 1.1;
  lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(55, t + len * 0.9);
  ng.gain.value = 0.9; src.connect(lp).connect(ng).connect(mix); src.start(t);
  // Рокот после удара: медленно катится и уходит
  const rs = ctx.createBufferSource(), rl = ctx.createBiquadFilter(), rg = ctx.createGain();
  rs.buffer = noiseBuf(ctx, len * 1.6, 0.8); rl.type = 'lowpass'; rl.frequency.value = 160; rl.Q.value = 0.8;
  rg.gain.setValueAtTime(0.0001, t); rg.gain.exponentialRampToValueAtTime(0.7, t + 0.12); rg.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.6);
  rs.connect(rl).connect(rg).connect(mix); rs.start(t);
}
// Выстрел пушки: глухой толчок, без шипения
const cannon = (ctx, at = 0) => deepBoom(ctx, { at, vol: 0.32, len: 0.55, f0: 75, drive: 2.2, bright: 900, rv: 0.25, pan: -0.3 });
// Обломки: низкий треск и стук, не высокое шуршание
function debris(ctx, { at = 0, n = 5, spread = 0.7, vol = 0.12 } = {}) {
  for (let i = 0; i < n; i++) noise(ctx, { at: at + 0.05 + Math.random() * spread, dur: 0.03 + Math.random() * 0.05, vol: vol * (0.4 + Math.random() * 0.6), type: 'bandpass', f: 280 + Math.random() * 650, q: 2, rv: 0.3, pan: Math.random() * 1.2 - 0.6 });
}
// Пузырьки: короткие синусы с подъёмом тона
function bubbles(ctx, { at = 0, n = 6, spread = 0.5, vol = 0.05 } = {}) {
  for (let i = 0; i < n; i++) { const f = 350 + Math.random() * 600; tone(ctx, { f, f2: f * 1.9, type: 'sine', at: at + Math.random() * spread, dur: 0.05 + Math.random() * 0.04, vol: vol * (0.5 + Math.random() * 0.5), atk: 0.003, rv: 0.25, pan: Math.random() - 0.5 }); }
}
// Улетающий «вжух»: шум с растущим тоном уходит вправо и затихает
function whoosh(ctx, { at = 0, dur = 0.38, vol = 0.16, from = 500, to = 3800, pan = -0.5, pan2 = 0.9 } = {}) {
  noise(ctx, { at, dur, vol, type: 'bandpass', f: from, f2: to, q: 2.2, shape: 1, rv: 0.25, pan, pan2 });
}

// Каждый звук — свой характер: по нему без взгляда понятно, что произошло
// Гул трибуны: широкий шум с нарастанием и спадом, проходит слева направо — как волна по стадиону
function crowd(ctx, { at = 0, dur = 1.6, vol = 0.09, f = 900, pan = -0.9, pan2 = 0.9 } = {}) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf(ctx, dur, 0);
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * 0.6, t); lp.frequency.linearRampToValueAtTime(f * 2.2, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(f * 0.8, t + dur);
  bp.type = 'peaking'; bp.frequency.value = 700; bp.gain.value = 8; bp.Q.value = 1.2; // «а-а-а» — гласная трибуны
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(bp).connect(g);
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.setValueAtTime(pan, t); p.pan.linearRampToValueAtTime(pan2, t + dur); g.connect(p); sndOut(ctx, p, 0.25); } else sndOut(ctx, g, 0.25);
  src.start(t); src.stop(t + dur + 0.05);
}
// Свист в два пальца — «свистнуть своих»: синус с резким подъёмом и лёгким дыханием
function whistle(ctx, { at = 0, vol = 0.06 } = {}) {
  tone(ctx, { f: 1500, f2: 2600, type: 'sine', at, dur: 0.22, vol, atk: 0.01 });
  tone(ctx, { f: 2300, f2: 3000, type: 'sine', at: at + 0.24, dur: 0.5, vol: vol * 1.1, atk: 0.02, rv: 0.2 });
  noise(ctx, { at, dur: 0.75, vol: vol * 0.25, type: 'bandpass', f: 2600, q: 3, shape: 1 });
}
// «Эй!» толпы: короткий хор голосов с подъёмом высоты
function hey(ctx, { at = 0, vol = 0.05 } = {}) {
  for (const f of [196, 247, 294, 330]) tone(ctx, { f, f2: f * 1.18, type: 'sawtooth', at: at + Math.random() * 0.03, dur: 0.24, vol: vol / 4, atk: 0.02, rv: 0.2 });
  noise(ctx, { at, dur: 0.22, vol: vol * 0.6, type: 'bandpass', f: 1100, q: 0.8, shape: 1.5, rv: 0.2 });
}
const SOUNDS = {
  // Волна: запуск — свист в два пальца и гул; встал — гул проходит по трибуне и «Эй!»; встала вся банда — гул, «Эй!» и фанфары дудкой
  // Батарейка: заряд набирается короткими «блипами» вверх; бодрый итог — с аккордом
  charge: (c) => { [392, 494, 587, 784].forEach((f, i) => tone(c, { f, type: 'sine', at: i * 0.11, dur: 0.12, vol: 0.035, atk: 0.008 })); tone(c, { f: 988, f2: 1175, type: 'triangle', at: 0.46, dur: 0.35, vol: 0.03, rv: 0.25 }); },
  chargeLow: (c) => { [392, 440, 494].forEach((f, i) => tone(c, { f, type: 'sine', at: i * 0.14, dur: 0.14, vol: 0.03, atk: 0.01 })); tone(c, { f: 523, type: 'sine', at: 0.44, dur: 0.4, vol: 0.025, rv: 0.3 }); },
  waveHorn: (c) => { whistle(c); crowd(c, { at: 0.55, dur: 1.8, vol: 0.06 }); hey(c, { at: 1.2, vol: 0.04 }); },
  waveCrowd: (c) => { crowd(c, { dur: 1.7, vol: 0.1 }); hey(c, { at: 0.75 }); },
  waveFull: (c) => { crowd(c, { dur: 2.2, vol: 0.12 }); hey(c, { at: 0.6 }); hey(c, { at: 1.1, vol: 0.06 }); whistle(c, { at: 1.4 }); },
  // Интерфейс: короткие щелчки
  tap: (c) => tick(c),
  tab: (c) => tick(c, { f: 2100, body: 1100, vol: 0.14 }),
  pick: (c) => tick(c, { f: 3600, body: 2200, vol: 0.08, dur: 0.005 }),
  on: (c) => { tick(c, { f: 2000, body: 1000, vol: 0.1 }); tick(c, { at: 0.045, f: 3400, body: 1900, vol: 0.1 }); },
  off: (c) => { tick(c, { f: 3400, body: 1900, vol: 0.1 }); tick(c, { at: 0.045, f: 2000, body: 1000, vol: 0.1 }); },
  open: (c) => { tick(c, { f: 1800, body: 900, vol: 0.11 }); noise(c, { dur: 0.12, vol: 0.025, f: 700, f2: 2000, q: 0.8, shape: 1 }); },
  close: (c) => { noise(c, { dur: 0.1, vol: 0.022, f: 2000, f2: 700, q: 0.8, shape: 1 }); tick(c, { at: 0.06, f: 1800, body: 800, vol: 0.1 }); },
  expand: (c) => tick(c, { f: 3000, body: 1600, vol: 0.09 }),
  collapse: (c) => tick(c, { f: 2400, body: 1200, vol: 0.09 }),
  tick: (c) => tick(c, { f: 4200, body: 2600, vol: 0.06, dur: 0.004 }),
  click: (c) => { tick(c, { f: 2600, body: 1300, vol: 0.13 }); tick(c, { at: 0.05, f: 3800, body: 2000, vol: 0.07 }); },
  vote: (c) => { tick(c, { vol: 0.11 }); tone(c, { f: 520, f2: 980, type: 'sine', at: 0.01, dur: 0.05, vol: 0.04, atk: 0.003 }); },
  // Отправка: щелчок кнопки и сообщение улетает
  send: (c) => { tick(c, { vol: 0.1 }); whoosh(c, { at: 0.02 }); tone(c, { f: 420, f2: 1400, type: 'sine', at: 0.03, dur: 0.3, vol: 0.022, pan: 0.4 }); },
  swish: (c) => whoosh(c, { dur: 0.3, vol: 0.18, from: 700, to: 4500, pan: 0.6, pan2: -0.6 }),
  // «Раз-два-три»: три удара кулака о ладонь в такт качанию рук, на третий — хлопок и вспышка
  rps3: (c) => {
    [0.3, 0.63, 0.99].forEach((t, i) => { noise(c, { at: t, dur: 0.07, vol: 0.13 + i * 0.02, type: 'lowpass', f: 420, f2: 160, q: 0.9, shape: 3 }); tone(c, { f: 120, f2: 80, type: 'sine', at: t, dur: 0.09, vol: 0.05, atk: 0.002 }); whoosh(c, { at: t - 0.16, dur: 0.15, vol: 0.05, from: 500, to: 1600 }); });
    noise(c, { at: 1.02, dur: 0.06, vol: 0.16, type: 'bandpass', f: 1900, q: 0.8, shape: 4, rv: 0.3 }); noise(c, { at: 1.04, dur: 0.18, vol: 0.06, type: 'highpass', f: 2500, shape: 2, rv: 0.2 });
  },
  // Верный ответ — две ноты вверх с блеском; неверный — мягкое «бу-у» вниз
  right: (c) => { tone(c, { f: 784, type: 'triangle', dur: 0.12, vol: 0.07 }); tone(c, { f: 1175, type: 'triangle', at: 0.09, dur: 0.22, vol: 0.07, rv: 0.25 }); noise(c, { at: 0.1, dur: 0.12, vol: 0.03, type: 'highpass', f: 6000, rv: 0.2 }); },
  // «Неверно»: два нисходящих тона в средних частотах — слышно и из динамика телефона
  wrong: (c) => { tone(c, { f: 523, f2: 466, type: 'triangle', dur: 0.14, vol: 0.08, atk: 0.004 }); tone(c, { f: 392, f2: 330, type: 'triangle', at: 0.15, dur: 0.24, vol: 0.08, atk: 0.004 }); tone(c, { f: 196, f2: 165, type: 'sine', at: 0.15, dur: 0.24, vol: 0.04 }); },
  // Маркер по доске: короткий скрип двумя штрихами
  marker: (c) => { noise(c, { dur: 0.13, vol: 0.07, type: 'bandpass', f: 2600, f2: 3400, q: 3, shape: 0.8 }); noise(c, { at: 0.17, dur: 0.12, vol: 0.06, type: 'bandpass', f: 3200, f2: 2400, q: 3, shape: 0.8 }); },
  // Итоги действий: мягкие колокольчики вместо писка
  // Лифт приехал — изнутри кабины, близко к уху. По порядку: удар молоточка по пластине, низкий «динь»
  // с биением и отражениями от стенок кабины, щелчок замка и стук соленоида, разгон привода,
  // две створки расходятся влево и вправо, ролики постукивают по направляющей, створки упираются в упор.
  lift: (c) => {
    // Фон кабины: вентилятор и дроссель лампы — тихо, чтобы было ощущение замкнутого места
    tone(c, { f: 100, type: 'sine', dur: 1.9, vol: 0.008, atk: 0.25 });
    noise(c, { dur: 1.9, vol: 0.012, type: 'lowpass', f: 500, q: 0.5, shape: 0.4 });
    // Молоточек: сухой щелчок и короткий удар корпуса
    noise(c, { dur: 0.012, vol: 0.09, type: 'bandpass', f: 3200, q: 1.6, shape: 5 });
    tone(c, { f: 260, f2: 180, type: 'sine', dur: 0.05, vol: 0.05, atk: 0.001 });
    // Пластина: низкая основная нота с биением, металлические обертоны, ранние отражения от стен кабины
    const plate = (at, g, pan) => [[1, 1, 2.2], [1.0035, 0.6, 2.0], [0.5, 0.12, 1.2], [2.76, 0.3, 0.9], [5.4, 0.12, 0.45], [8.93, 0.04, 0.25]]
      .forEach(([k, a, d]) => tone(c, { f: 698 * k, type: 'sine', at, dur: d, vol: 0.055 * a * g, atk: 0.002, pan }));
    plate(0.002, 1, null); plate(0.011, 0.32, -0.65); plate(0.019, 0.22, 0.65); plate(0.031, 0.1, 0);
    // Замок створок: два щелчка и глухой стук соленоида
    tick(c, { at: 0.56, f: 2600, body: 800, vol: 0.1 }); tick(c, { at: 0.585, f: 1900, body: 600, vol: 0.07 });
    noise(c, { at: 0.59, dur: 0.06, vol: 0.07, type: 'lowpass', f: 420, f2: 160, q: 1, shape: 3 });
    // Привод дверей набирает обороты
    tone(c, { f: 140, f2: 185, type: 'sawtooth', at: 0.62, dur: 0.82, vol: 0.012, atk: 0.12 });
    tone(c, { f: 280, f2: 370, type: 'triangle', at: 0.62, dur: 0.82, vol: 0.016, atk: 0.12 });
    // Две створки: шорох из центра расходится влево и вправо
    noise(c, { at: 0.66, dur: 0.72, vol: 0.024, type: 'bandpass', f: 520, f2: 820, q: 2.4, shape: 0.7, pan: 0, pan2: -0.85 });
    noise(c, { at: 0.66, dur: 0.72, vol: 0.024, type: 'bandpass', f: 560, f2: 880, q: 2.4, shape: 0.7, pan: 0, pan2: 0.85 });
    // Ролики по направляющей: неровное постукивание, по очереди слева и справа
    [0.7, 0.77, 0.86, 0.93, 1.01, 1.1, 1.17, 1.24, 1.3].forEach((t, k) =>
      noise(c, { at: t, dur: 0.01, vol: 0.06 - k * 0.003, type: 'bandpass', f: 1700 + (k % 3) * 450, q: 3, shape: 4, pan: k % 2 ? 0.6 : -0.6 }));
    // Упор: створки встают — глухой удар, низ корпуса и маленький отскок
    noise(c, { at: 1.4, dur: 0.11, vol: 0.11, type: 'lowpass', f: 240, f2: 80, q: 1, shape: 3 });
    tone(c, { f: 92, f2: 55, type: 'sine', at: 1.4, dur: 0.16, vol: 0.06, atk: 0.003 });
    noise(c, { at: 1.41, dur: 0.03, vol: 0.04, type: 'bandpass', f: 1200, q: 2.5, shape: 4, pan: -0.7 });
    noise(c, { at: 1.415, dur: 0.03, vol: 0.04, type: 'bandpass', f: 1300, q: 2.5, shape: 4, pan: 0.7 });
    tick(c, { at: 1.49, f: 1800, body: 500, vol: 0.04 });    // Выход на этаж: из открытых дверей тянет воздухом и шумом офиса, сверху — тёплый двойной сигнал «приехали»
    noise(c, { at: 1.42, dur: 0.9, vol: 0.02, type: 'highpass', f: 1800, f2: 5200, q: 0.5, shape: 0.6, rv: 0.5 });
    noise(c, { at: 1.5, dur: 1.1, vol: 0.014, type: 'bandpass', f: 380, f2: 620, q: 0.8, shape: 0.9, rv: 0.6 });
    bell(c, { f: 880, at: 1.52, vol: 0.03, dur: 0.9, rv: 0.5 }); bell(c, { f: 1109, at: 1.66, vol: 0.028, dur: 1.2, rv: 0.5 });
  },
  confirm: (c) => { tick(c, { vol: 0.08 }); bell(c, { f: 1047, at: 0.01, vol: 0.04, dur: 0.6 }); bell(c, { f: 1568, at: 0.08, vol: 0.035, dur: 0.8 }); },
  coin: (c) => { bell(c, { f: 1976, vol: 0.04, dur: 0.5 }); bell(c, { f: 2637, at: 0.07, vol: 0.045, dur: 1.0, rv: 0.4 }); noise(c, { at: 0.07, dur: 0.15, vol: 0.02, type: 'highpass', f: 7000, rv: 0.4 }); },
  danger: (c) => { tick(c, { f: 1500, body: 600, vol: 0.12 }); tone(c, { f: 420, f2: 300, type: 'triangle', at: 0.01, dur: 0.16, vol: 0.07, atk: 0.003 }); tone(c, { f: 200, f2: 130, type: 'sine', at: 0.01, dur: 0.16, vol: 0.05, atk: 0.003 }); },
  error: (c) => { tone(c, { f: 660, f2: 600, type: 'triangle', dur: 0.11, vol: 0.06, atk: 0.004 }); tone(c, { f: 523, f2: 466, type: 'triangle', at: 0.13, dur: 0.18, vol: 0.06, atk: 0.004 }); tone(c, { f: 262, f2: 233, type: 'sine', at: 0.13, dur: 0.18, vol: 0.03 }); },
  // Морской бой: сначала выстрел пушки, через четверть секунды — что случилось у цели
  splash: (c) => {
    if (playSample(c, 'splash')) return;
    cannon(c);
    deepBoom(c, { at: 0.26, vol: 0.34, len: 0.8, f0: 62, drive: 1.6, bright: 600, rv: 0.4, pan: 0.25 }); // снаряд уходит в воду
    noise(c, { at: 0.27, dur: 0.6, vol: 0.14, type: 'lowpass', f: 1400, f2: 180, q: 0.7, shape: 1.8, rv: 0.4, pan: 0.25 });
    bubbles(c, { at: 0.5, n: 5, spread: 0.5, vol: 0.035 });
  },
  hit: (c) => {
    if (playSample(c, 'hit')) return;
    cannon(c);
    deepBoom(c, { at: 0.24, vol: 0.75, len: 1.4, f0: 95, drive: 4, bright: 2200, rv: 0.4, pan: 0.2 });
    debris(c, { at: 0.26, n: 5 });
  },
  sunk: (c) => {
    if (playSample(c, 'sunk')) return;
    cannon(c);
    deepBoom(c, { at: 0.24, vol: 0.85, len: 2.0, f0: 100, drive: 5, bright: 2600, rv: 0.5, pan: 0.15 });
    deepBoom(c, { at: 0.75, vol: 0.55, len: 1.6, f0: 70, drive: 3.5, bright: 1400, rv: 0.5, pan: 0.35 }); // детонация погреба
    debris(c, { at: 0.3, n: 9, spread: 1.2, vol: 0.14 });
    brass(c, { f: 49, at: 1.0, dur: 1.4, vol: 0.05, dark: true, wah: 1.1, rv: 0.45 }); // стон металла
    bubbles(c, { at: 1.6, n: 8, spread: 0.9, vol: 0.03 });
  },
  // Грустный тромбон: «вау-вау-вау-ваааа»
  // Проигрыш: тромбон с туба «уа-уа-уа-уааа» с сурдиной, казу хихикает «ха-ха-ха», свисток падает,
  // и барабанщик добивает «ба-дум-тсс»
  lose: (c) => {
    if (playSample(c, 'lose')) return;
    [[294, 0, 0.3], [277, 0.34, 0.3], [262, 0.68, 0.3], [247, 1.02, 0.95]].forEach(([f, at, dur], i) => {
      brass(c, { f, at, dur, vol: 0.09, dark: true, wah: i === 3 ? 5.5 : 3.5, vib: i === 3 ? 0.02 : 0, rv: 0.35 });
      brass(c, { f: f / 2, at, dur, vol: 0.07, dark: true, rv: 0.3 });
    });
    timpani(c, { f: 61.7, at: 1.02, vol: 0.08, dur: 0.9 });
    [[523, 2.0], [494, 2.13], [466, 2.26]].forEach(([f, at]) => kazoo(c, { f, f2: f * 0.93, at, dur: 0.1, vol: 0.06 }));
    tone(c, { f: 1700, f2: 420, type: 'sine', at: 2.0, dur: 0.42, vol: 0.035, rv: 0.25 });
    tone(c, { f: 200, f2: 130, type: 'sine', at: 2.5, dur: 0.16, vol: 0.12, atk: 0.003, rv: 0.2 });
    noise(c, { at: 2.5, dur: 0.06, vol: 0.06, type: 'bandpass', f: 1800, q: 1, rv: 0.2 });
    tone(c, { f: 150, f2: 95, type: 'sine', at: 2.66, dur: 0.2, vol: 0.13, atk: 0.003, rv: 0.2 });
    noise(c, { at: 2.66, dur: 0.06, vol: 0.06, type: 'bandpass', f: 1500, q: 1, rv: 0.2 });
    crash(c, { at: 2.84, vol: 0.06, dur: 0.6, rv: 0.3 });
  },
  bugle: (c) => {
    if (playSample(c, 'bugle')) return;
    // В бой! Литавры и малый барабан нарастают, удар тутти с тарелкой и большим барабаном,
    // валторны трубят призыв ля-ре-ЛЯ и держат высокое РЕ над тромбонами и струнными
    const D2 = 73.42, A2 = 110, D3 = 146.83, A3 = 220, D4 = 293.66, Fs4 = 369.99, A4 = 440, D5 = 587.33;
    for (let i = 0; i < 16; i++) {
      const at = i * 0.052, k = 0.18 + (i / 15) * 0.82;
      timpani(c, { f: D2, at, vol: 0.09 * k, dur: 0.3, rv: 0.3 });
      noise(c, { at: at + 0.026, dur: 0.03, vol: 0.035 * k, type: 'bandpass', f: 2600, q: 1.1, rv: 0.25 });
    }
    const hit = 0.86;
    deepBoom(c, { at: hit, vol: 0.5, len: 1.3, f0: 85, drive: 2.4, bright: 1300, rv: 0.45 });
    crash(c, { at: hit, vol: 0.09, dur: 2.2 });
    timpani(c, { f: D2, at: hit, vol: 0.16, dur: 1.2 });
    [D3, A3, D4, Fs4].forEach((f) => brass(c, { f, at: hit, dur: 0.42, vol: 0.06, rv: 0.45 }));
    strings(c, { notes: [D3, A3, D4, Fs4, A4], at: hit, dur: 2.2, vol: 0.022 });
    // Призыв валторн
    [[A3, hit + 0.46, 0.13], [D4, hit + 0.6, 0.13], [A4, hit + 0.74, 0.16]].forEach(([f, at, dur]) => { brass(c, { f, at, dur, vol: 0.09, rv: 0.45 }); brass(c, { f: f / 2, at, dur, vol: 0.05, dark: true, rv: 0.4 }); });
    const hold = hit + 0.94;
    brass(c, { f: D5, at: hold, dur: 1.15, vol: 0.075, vib: 0.01, rv: 0.5 });
    brass(c, { f: D4, at: hold, dur: 1.15, vol: 0.07, vib: 0.008, rv: 0.5 });
    [D3, A2].forEach((f) => brass(c, { f, at: hold, dur: 1.15, vol: 0.06, dark: true, rv: 0.45 }));
    timpani(c, { f: A2 / 1.5, at: hold, vol: 0.12, dur: 1 });
    timpani(c, { f: D2, at: hold + 0.18, vol: 0.14, dur: 1.1 });
    crash(c, { at: hold, vol: 0.06, dur: 1.6 });
  },

  // Звуки отметки из Лавки
  chip: (c) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, { f, type: 'square', at: i * 0.075, dur: 0.07, vol: 0.035, atk: 0.002 })); tone(c, { f: 1568, type: 'square', at: 0.42, dur: 0.22, vol: 0.04, atk: 0.002 }); },
  cuckoo: (c) => { [[659, 0], [523, 0.22], [659, 0.62], [523, 0.84]].forEach(([f, at]) => { tone(c, { f, type: 'sine', at, dur: 0.18, vol: 0.09, atk: 0.01, rv: 0.35 }); tone(c, { f: f * 2, type: 'sine', at, dur: 0.1, vol: 0.015, rv: 0.2 }); }); noise(c, { at: 0, dur: 0.05, vol: 0.02, type: 'bandpass', f: 1800, q: 3 }); },
  // Победа: литавры и медный аккорд
  // Победа в бою и дуэли — живой оркестр; без файла — синтезированные фанфары
  victory: (c) => { if (!playSample(c, 'victory')) SOUNDS.fanfare(c); },
  ...Object.fromEntries(['lol', 'angry', 'bored', 'smart', 'oops', 'clap', 'mercy', 'easy'].map((k) => [`emo_${k}`, (c) => { if (!playSample(c, `emo_${k}`)) SOUNDS.vote(c); }])),
  // Гудок банды из Лавки: боевой рог — валторны с тубой
  gangHorn: (c) => { if (!playSample(c, 'gangHorn')) SOUNDS.waveHorn(c); },
  fanfare: (c) => {
    if (playSample(c, 'fanfare')) return;
    [0, 0.18, 0.36].forEach((at, i) => { tone(c, { f: 98, f2: 92, type: 'sine', at, dur: 0.5, vol: 0.14 - i * 0.02, atk: 0.003, rv: 0.4 }); noise(c, { at, dur: 0.12, vol: 0.08, type: 'lowpass', f: 600, rv: 0.4 }); });
    [[392, 0.6, 0.14], [523, 0.76, 0.14], [659, 0.92, 0.14]].forEach(([f, at, dur]) => brass(c, { f, at, dur, vol: 0.08, rv: 0.35 }));
    [523, 659, 784, 1047].forEach((f) => brass(c, { f, at: 1.1, dur: 1.0, vol: 0.05, vib: 0.008, rv: 0.45 }));
    tone(c, { f: 65, type: 'sine', at: 1.1, dur: 1.0, vol: 0.08, rv: 0.3 });
  },
  flap: (c) => { [0, 0.13, 0.26].forEach((at, i) => noise(c, { at, dur: 0.09, vol: 0.14 - i * 0.03, f: 1400 - i * 150, f2: 500, q: 0.9, rv: 0.2, pan: -0.3 + i * 0.4 })); whoosh(c, { at: 0.3, dur: 0.3, vol: 0.08 }); },
  // Кости: деревянные стуки о стол и финальный глухой удар
  // Кости: трясутся в ладони, летят и стучат по столу, подпрыгивают и замирают
  dice: (c) => { [0, 0.05, 0.11, 0.16, 0.22, 0.3, 0.36].forEach((t, i) => noise(c, { at: t, dur: 0.012, vol: 0.05, type: 'bandpass', f: 3000 + (i % 3) * 300, q: 2, shape: 4 })); },
  diceLand: (c) => {
    [[0.42, 0.13], [0.48, 0.1], [0.58, 0.08], [0.63, 0.07], [0.72, 0.05], [0.76, 0.04], [0.82, 0.03]].forEach(([t, v], i) => {
      noise(c, { at: t, dur: 0.014, vol: v, type: 'bandpass', f: 2400 + (i % 3) * 500, q: 2.2, shape: 4, pan: i % 2 ? 0.3 : -0.3 });
      noise(c, { at: t, dur: 0.04, vol: v * 0.6, type: 'lowpass', f: 380, q: 0.8, shape: 3 });
    });
  },
  chicken: (c) => {
    if (playSample(c, 'chicken')) return;
    // «ко-ко-ко… кудах!»: короткие писклявые вскрики с резким подъёмом тона
    [0, 0.17, 0.34].forEach((at) => tone(c, { f: 620, f2: 1250, type: 'square', at, dur: 0.11, vol: 0.04, rv: 0.15 }));
    tone(c, { f: 700, f2: 1700, type: 'sawtooth', at: 0.56, dur: 0.16, vol: 0.05, rv: 0.15 });
    tone(c, { f: 1500, f2: 520, type: 'sawtooth', at: 0.72, dur: 0.38, vol: 0.04, rv: 0.2 });
  }
};
// Выравнивание громкости: морской бой был на 20 дБ громче дуэлей, кости — почти не слышны
const SOUND_GAIN = { hit: 0.2, sunk: 0.22, splash: 0.53, dice: 4.7, diceLand: 4 };
// Вибрация под стать звуку: короткий «тик» на нажатия, узор — на события
const BUZZ = { victory: [60, 60, 60, 60, 200], bugle: [50, 40, 50, 40, 50, 40, 260], tap: 8, tab: 10, on: 6, off: 6, pick: 5, open: 8, close: 6, expand: 5, collapse: 5, send: 14, confirm: [12, 40, 18], danger: [25, 50, 25], error: [35, 45, 35],
  lift: [35, 525, 20, 815, 60], vote: 10, coin: [8, 30, 8], click: 8, tick: 4, splash: 15, hit: [30, 40, 60], sunk: [40, 30, 90], lose: [80, 60, 160], chicken: [30, 40, 30], fanfare: [60, 60, 60, 60, 200], waveHorn: [40, 60, 40, 60, 200], waveCrowd: [10, 30, 20, 30, 40, 30, 80], waveFull: [20, 30, 40, 30, 80, 60, 200] };
let lastSfx = { name: '', at: 0 };
function sfx(name, arg) {
  const now = performance.now();
  if (lastSfx.name === name && now - lastSfx.at < 40) return; // двойной вызов на один тап — один звук
  lastSfx = { name, at: now };
  const c = actx();
  if (c && SOUNDS[name]) { sfxGain = SOUND_GAIN[name] || 1; try { SOUNDS[name](c, arg); } catch {} sfxGain = 1; }
  if (vibroOn() && navigator.vibrate && BUZZ[name] != null) { try { navigator.vibrate(BUZZ[name]); } catch {} }
}
const tabSound = (tab) => sfx('tab', tab);

// Какой звук у какого нажатия. Свои звуки у вкладок, выстрелов, сдачи и Лавки — их играют сами действия
const FEEL_SELF = new Set(['todo-done', 'wave-launch', 'wave-join', 'tr-buy', 'tr-vote', 'tr-equip', 'duel-go', 'war-bet', 'war-cheer', 'war-volunteer', 'tourney-reg', 'duel-rps', 'duel-roll', 'duel-cell', 'duel-new', 'war-start', 'war-send', 'war-accept', 'tab', 'blitz-pick', 'bshoot', 'bresign', 'sound-toggle', 'vibro-toggle', 'sound-test', 'splash-skip']);
const FEEL = {
  open: 'open', 'open-sec': 'open', person: 'open', 'find-open': 'open', 'poll-new': 'open', 'gev-new': 'open', 'ava-open': 'open', 'ava-open-vac': 'open', 'vac-party': 'open', 'meme-open': 'open', 'pcall-open': 'open',
  'call-open': 'open', 'dm-call-open': 'open', 'battle-new': 'open', 'crew-share': 'open',
  'gang-open': 'open', 'dm-open': 'open', 'battle-open': 'open', 'inbox-open': 'open', 'inbox-go': 'open', 'gev-edit': 'open', 'quest-go': 'open',
  close: 'close', 'close-bg': 'close', 'chats-back': 'close', 'dm-back': 'close', 'battle-back': 'close', 'onb-back': 'close', 'nick-no': 'close', 'food-cancel': 'close', 'feed-close': 'close', 'coach-skip': 'close',
  'poll-vote': 'vote', vote: 'vote', 'quiz-pick': 'vote', 'guess-pick': 'vote', 'food-pick': 'vote', reply: 'vote', 'dm-reply': 'vote', 'coffee-reply': 'vote',
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
  if (/(^|-)(send|create|go|add|share|submit)$|^gift$|signal-send|thanks-send|thx-send|chat-send|find-invite|gang-invite/.test(act)) return 'send';
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
const OUTFIT_NAMES = { hoodie: 'Худи', tee: 'Футболка', dev: 'Футболка разработчика', shirt: 'Рубашка', suit: 'Костюм', jacket: 'Бомбер', puffer: 'Пуховик', dress: 'Платье', cami: 'Топ на бретельках', biker: 'Косуха', cyber: 'Неон', armor: 'Доспехи', vampire: 'Плащ вампира', nysweater: 'Новогодний свитер', telnyashka: 'Тельняшка' };
const MASK_NAMES = { none: 'Без маски', medical: 'Медицинская', gauze: 'Марлевая', visor: 'Кибервизор', scuba: 'Аквалангист' };
const COLOR_NAMES = { same: 'Как одежда', red: 'Красный', blue: 'Синий', green: 'Зелёный', violet: 'Фиолетовый', navy: 'Тёмно-синий', black: 'Чёрный', white: 'Белый', beige: 'Бежевый', yellow: 'Жёлтый', pink: 'Розовый', orange: 'Оранжевый', khaki: 'Хаки', burgundy: 'Бордовый', grey: 'Серый' };
const NECK_NAMES = { none: 'Ничего', tie: 'Галстук', tie_crooked: 'Галстук набок', bow: 'Бабочка', badge: 'Пропуск', beads: 'Бусы', chain: 'Цепочка', tie_gold: 'Золотой галстук', chain_gold: 'Золотая цепь', snake: 'Змея', garland: 'Ёлочная гирлянда' };
const PET_NAMES = { none: 'Без питомца', corgi: 'Корги', pug: 'Мопс', frenchie: 'Французский бульдог', parrot: 'Попугай на плече', cat: 'Кот на клавиатуре', aquarium: 'Аквариум', cactus: 'Кактус' };
const LENS_NAMES = { clear: 'Прозрачные', grey: 'Серые', brown: 'Коричневые', blue: 'Голубые', green: 'Зелёные', pink: 'Розовые', yellow: 'Жёлтые' };
const LENS_SWATCH = { clear: 'repeating-linear-gradient(45deg,#fff 0 4px,#E3E8F2 4px 8px)', grey: '#555B68', brown: '#7A5232', blue: '#4A86E0', green: '#3A9A68', pink: '#F08BB4', yellow: '#F2C230' };
const HAT_NAMES = { none: 'Без шапки', beanie: 'Шапка', cap: 'Кепка', headset: 'Гарнитура', laurel: 'Лавровый венок', knight: 'Рыцарский шлем', royal: 'Корона', fedora: 'Шляпа', ushanka: 'Ушанка', tricorn: 'Треуголка капитана', dedmoroz: 'Шапка Деда Мороза', kokoshnik: 'Кокошник Снегурочки', wreath: 'Весенний венок', shawl: 'Расписной платок' };
const EYE_NAMES = { normal: 'Круглые', almond: 'Миндаль', narrow: 'Узкие', hooded: 'Нависшее веко', down: 'Опущенные уголки', up: 'Приподнятые уголки', tired: 'После совещания', sly: 'Хитрые', wide: 'Удивлённые', anime: 'Аниме' };
const EYE_ANAT = ['normal', 'almond', 'narrow', 'hooded', 'down', 'up', 'anime'];
const BROW_NAMES = { auto: 'Как у всех', straight: 'Прямые', arch: 'Дугой', peak: 'Домиком', thin: 'Тонкие', thick: 'Густые', uni: 'Сросшиеся' };
const GAP_NAMES = { close: 'Близко', normal: 'Обычно', wide: 'Широко' };
const AGE_NAMES = { 0: 'Без морщин', 1: 'Лёгкие у глаз', 2: 'Выраженные' };
const HAIRLINE_NAMES = { normal: 'Обычная', high: 'Высокий лоб', receding: 'Залысины', m: 'Глубокие залысины' };
const PART_NAMES = { left: 'Слева', right: 'Справа' };
const LIPS_NAMES = { thin: 'Тонкие', normal: 'Средние', full: 'Пухлые' };
const MOLE_NAMES = { none: 'Нет', cheekL: 'Щека слева', cheekR: 'Щека справа', lip: 'Над губой', chin: 'Подбородок' };
const HAIR_COLOR_NAMES = { '#0F0E12': 'Чёрный', '#2B1D14': 'Тёмно-каштановый', '#4A3326': 'Тёмно-русый', '#6B3E26': 'Каштановый', '#8C6A4F': 'Русый', '#B5532A': 'Медный', '#C2412F': 'Рыжий', '#CFAE74': 'Пшеничный', '#E0B04B': 'Блонд', '#F2E6C9': 'Платина', '#6E6A66': 'Соль с перцем', '#9AA3B5': 'Седой', '#7C4DFF': 'Фиолетовый', '#FF6FA8': 'Розовый' };
const PROP_NAMES = { sign_lunch: 'Ушёл на обед', sign_dnd: 'Не беспокоить', sign_ask: 'Я просто спросить', sign_coffee: 'Кофе? Я угощаю', sign_deadline: 'Дедлайн вчера', sign_plan: 'Всё по плану', sign_friday: 'Пятница!', sign_domik: 'Я в домике', sign_tz: 'Где ТЗ?', sign_thanks: 'Спасибо!', sign_innocent: 'Это не я', sign_vacation: 'Хочу в отпуск', none: 'Ничего', torch: 'Факел', phone: 'Телефон', mimosa: 'Букет мимозы', pancakes: 'Стопка блинов', mug: 'Кружка', papers: 'Квартальный отчёт', sign: 'Табличка', laptop: 'Ноутбук', mug_best: 'Лучший сотрудник', trophy: 'Кубок Лиги' };
// Две группы: «Внешность» — кто ты (по этому узнают), «Стиль» — что на тебе надето и вокруг
const AVA_CATS = [['face', 'Лицо'], ['eyes', 'Глаза и брови'], ['hair', 'Волосы'], ['mouth', 'Рот'], ['beard', 'Борода'], ['makeup', 'Макияж'], ['age', 'Возраст и приметы'], ['outfit', 'Одежда'], ['acc', 'Аксессуары'], ['pet', 'Питомец'], ['bg', 'Фон'], ['meme', 'Мемы']];
// Что по умолчанию снимаем в превью вкладки, чтобы оно не закрывало выбираемую часть
const COVER_AUTO = { face: ['hat', 'hair', 'mask'], hair: ['hat', 'mask'], eyes: ['glasses', 'hat', 'mask', 'hair'], mouth: ['mask', 'beard', 'glasses'], beard: ['mask'], makeup: ['mask', 'glasses'], age: ['hat', 'mask', 'glasses'] };
const AVA_LOOKS = ['face', 'eyes', 'hair', 'mouth', 'beard', 'makeup', 'age'];
const DEF_LOOK = { eyeGap: 'normal', browShape: 'auto', browColor: 'same', age: '0', hairline: 'normal', part: 'left', lips: 'normal', mole: 'none', hatColor: 'same', mask: 'none', glassesColor: 'black', lensColor: 'clear', pet: 'none', eyeSize: 'm', nose: 'button', ears: 'normal', makeup: 'none', earrings: 'none', glassesStyle: 'classic', beardColor: 'same', mustacheColor: 'same' };
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
  { id: 'tired', name: 'Устал|Устала, но держусь', look: { outfit: 'hoodie', neck: 'none', hat: 'none', prop: 'mug', mouth: 'neutral', eyeShape: 'tired' } },
  { id: 'excel', name: 'Гений Excel', look: { outfit: 'shirt', hoodie: 'green', neck: 'tie', hat: 'none', prop: 'papers', mouth: 'grin', eyeShape: 'wide', glasses: true } },
  { id: 'nothing', name: 'Я ничего не трогал|трогала', look: { outfit: 'dev', neck: 'none', hat: 'none', prop: 'none', mouth: 'wow', eyeShape: 'wide' } },
  { id: 'report', name: 'Снова квартальный отчёт', look: { outfit: 'shirt', hoodie: 'blue', neck: 'tie_crooked', hat: 'none', prop: 'papers', mouth: 'neutral', eyeShape: 'tired' } },
  { id: 'control', name: 'Всё под контролем', look: { outfit: 'suit', hoodie: 'red', neck: 'tie', hat: 'headset', prop: 'mug', mouth: 'smile', eyeShape: 'normal' } },
  // Легендарные образы: детали за зёрна в Лавке, примерить можно бесплатно
  { id: 'biker', legend: true, name: 'Байкер', look: { outfit: 'biker', neck: 'chain_gold', hat: 'none', mask: 'none', glasses: true, glassesStyle: 'aviator', glassesColor: 'gold', lensColor: 'grey', hairStyle: 'slick', mouth: 'smirk', eyeShape: 'sly', prop: 'none', bg: 'street' } },
  { id: 'cyber', legend: true, name: 'Киберпанк', look: { outfit: 'cyber', mask: 'visor', neck: 'none', hat: 'none', glasses: false, hairStyle: 'mohawk', hair: '#FF6FA8', mouth: 'neutral', prop: 'none', bg: 'slate' } },
  { id: 'anime', legend: true, name: 'Аниме-герой', look: { hairStyle: 'anime', eyeShape: 'anime', outfit: 'jacket', hoodie: 'orange', hat: 'none', mask: 'none', glasses: false, mouth: 'grin', prop: 'none', bg: 'sun' } },
  { id: 'knight', legend: true, name: 'Рыцарь банды', look: { outfit: 'armor', hat: 'knight', mask: 'none', glasses: false, prop: 'none', neck: 'none', mouth: 'neutral', bg: 'slate' } },
  { id: 'king', legend: true, name: 'Король этажа', look: { outfit: 'suit', hoodie: 'burgundy', hat: 'royal', mask: 'none', neck: 'chain_gold', prop: 'none', mouth: 'smirk', bg: 'sun' } },
  { id: 'diver', legend: true, name: 'Ныряю в задачи', look: { outfit: 'tee', hoodie: 'blue', hat: 'none', mask: 'scuba', glasses: false, prop: 'none', neck: 'none', mouth: 'smile', bg: 'sky' } },
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
  for (const k of ['preset', 'face', 'skin', 'eyes', 'hairStyle', 'hoodie', 'outfit', 'nose', 'eyeGap', 'browShape', 'lips']) r[k] = pick(free(k));
  r.hair = pick(L.hair.slice(0, 12)); r.mouth = pick(['smile', 'neutral', 'smirk', 'grin']); r.eyeShape = pick(EYE_ANAT.slice(0, 6));
  r.age = pick(['0', '0', '1', '2']); r.hairline = Math.random() < 0.7 ? 'normal' : pick(L.hairline); r.part = pick(L.part);
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
// href — картинка аватара, вшитая в сам SVG (data:): нужна, когда мем сохраняется файлом, — внешние ссылки туда не попадают
function memeSvg(look, sceneId, emoId, width = 220, standalone = false, href = '') {
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
    <g clip-path="url(#${id}c)"><rect x="16" y="52" width="88" height="88" fill="#FFE7B3"/>${AVA3D ? `<image x="14" y="50" width="92" height="92" href="${href || avaSrc(l, 400)}"/>` : `<svg x="14" y="50" width="92" height="92" viewBox="0 0 100 100">${avatarInner(l)}</svg>`}</g>
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
// Сцены для мем-открыток: праздничные видны только в свой сезон; для чата банды — только праздничные
function memeScenes(holidayOnly) {
  const all = (S.cat.memes || []).filter((x) => x.on !== false);
  const hol = all.filter((x) => x.season);
  return holidayOnly && hol.length ? hol : all;
}
function renderMemeMaker() {
  const m = S.meme;
  const crew = S.people || (S.crew && S.crew.list) || [];
  const scenes = memeScenes(!!m.gang);
  const gname = m.gang ? ((S.me.gangs.find((x) => x.id === m.gang) || {}).name || 'банды') : '';
  return `<div class="meme-ed">
    <div class="meme-prev">${memeSvg(S.me.look, m.scene, m.emo, 230)}</div>
    <div class="field">${m.gang ? 'Праздник' : 'Ситуация'}<div class="scenes">${scenes.map((x) => `<button class="scene ${m.scene === x.id ? 'on' : ''}" style="background:linear-gradient(160deg, ${x.bg[0]}, ${x.bg[1]})" data-act="meme-scene" data-v="${x.id}">${esc(x.caption)}</button>`).join('')}</div></div>
    <div class="field">Эмоция<div class="chips">${Object.entries(S.cat.memeEmos).map(([k, v]) => `<button class="chip ${m.emo === k ? 'on' : ''}" data-act="meme-emo" data-v="${k}">${esc(v.label)}</button>`).join('')}</div></div>
    ${m.gang ? `<button class="btn" data-act="meme-send-gang">В чат «${esc(gname)}»</button>` : crew.length ? `<div class="field">Кому отправить<div class="chips">${crew.map((f) => `<button class="chip ${m.to === f.id ? 'on' : ''}" data-act="meme-to" data-v="${f.id}">${nk(f)}</button>`).join('')}</div></div>` : '<p class="small" style="margin:0">Отправлять мемы можно членам твоих банд. А картинкой — куда угодно.</p>'}
    <div class="row">${m.to && !m.gang ? `<button class="btn grow" data-act="meme-send">Отправить ${esc((crew.find((f) => f.id === m.to) || {}).nick || '')}</button>` : ''}<button class="btn ${m.to || m.gang ? 'ghost' : ''} grow" data-act="meme-share">${navigator.share ? 'Поделиться картинкой' : 'Скачать картинку'}</button></div>
    <p class="small" style="margin:0">На открытке твой текущий аватар. Подписи — из готового списка, чтобы мемы оставались добрыми.</p>
  </div>`;
}

// ----- Конструктор аватара: черновик, категории, пресеты, случайный -----
function renderAvatarEditor() {
  const d = S.draft, L = S.cat.look;
  const cat = (S.avaCat === 'makeup' && d.preset !== 'f') || (S.avaCat === 'beard' && d.preset === 'f') ? 'face' : (S.avaCat || 'face');
  const sw = (key, vals) => `<div class="row" style="flex-wrap:wrap;gap:8px">${vals.map((v) => `<button class="swatch ${d[key] === v ? 'on' : ''}" style="background:${HOODIE[v] || v}" data-act="ava-set" data-k="${key}" data-v="${v}" aria-label="${COLOR_NAMES[v] || key + ' ' + v}" title="${COLOR_NAMES[v] || ''}"></button>`).join('')}</div>`;
  // Превью без лишнего: то, что закрывает выбираемую часть, по умолчанию снято — шапка не прячет брови,
  // маска не закрывает рот, очки не мешают глазам. Это только показ: в сохранённый аватар ничего не попадает.
  // Кнопками над вкладкой можно вернуть или, наоборот, снять ещё что-то
  const auto = Object.fromEntries((COVER_AUTO[cat] || []).map((k) => [k, true]));
  const hide = { ...auto, ...((S.avaHide || {})[cat] || {}) };
  const view = (l) => ({ ...l, ...(hide.hat ? { hat: 'none', phones: false, crown: false } : {}), ...(hide.hair ? { hairStyle: 'bald' } : {}), ...(hide.glasses ? { glasses: false } : {}), ...(hide.beard ? { beard: 'none' } : {}), ...(hide.mask ? { mask: 'none' } : {}) });
  const hasHat = (d.hat && d.hat !== 'none') || d.phones;
  const hideChip = (k, on, off) => `<button class="chip ${hide[k] ? 'on' : ''}" data-act="ava-hide" data-k="${k}" data-c="${cat}" data-v="${hide[k] ? '0' : '1'}">${hide[k] ? on : off}</button>`;
  const lookTab = AVA_LOOKS.includes(cat);
  const hideBar = !lookTab ? '' : [
    hasHat ? hideChip('hat', 'Головной убор скрыт', 'Скрыть головной убор') : '',
    d.hairStyle !== 'bald' && cat !== 'hair' && cat !== 'mouth' && cat !== 'beard' ? hideChip('hair', 'Волосы скрыты', 'Скрыть волосы') : '',
    d.glasses ? hideChip('glasses', 'Очки скрыты', 'Скрыть очки') : '',
    d.mask && d.mask !== 'none' ? hideChip('mask', 'Маска скрыта', 'Скрыть маску') : '',
    d.preset !== 'f' && d.beard && d.beard !== 'none' && cat !== 'beard' && cat !== 'eyes' && cat !== 'hair' ? hideChip('beard', 'Борода скрыта', 'Скрыть бороду') : ''
  ].filter(Boolean).join('');
  const offSeason = (key, v) => { const pt = (S.cat.parts || []).find((x) => x.slot === key && x.value === v); return pt && ((pt.season && !pt.on) || pt.award) && !(S.me.owned || []).includes(pt.id) && d[key] !== v && !(pt.award && pt.slot !== 'neck'); };
  const tiles = (key, vals, names, zoom = false) => `<div class="ava-tiles">${vals.filter((v) => !offSeason(key, v)).map((v) => {
    const lock = partLocked(key, v);
    return `<button class="ava-tile ${(d[key] || DEF_LOOK[key]) === v ? 'on' : ''} ${lock ? 'paid' : ''}" data-act="ava-set" data-k="${key}" data-v="${v}">${avatar(view({ ...d, [key]: v, frame: null, crown: false, ...(zoom ? { pet: 'none', prop: 'none' } : {}) }), 60, zoom)}<span>${hy(names[v] || v)}</span>${lock ? `<em>${lock.award ? 'trophy Лига' : `${lock.price} ${BEAN}`}</em>` : ''}</button>`;
  }).join('')}</div>`;
  const tog = (k, label) => `<button class="chip ${(d[k] ?? (k === 'lashes' && d.preset === 'f')) ? 'on' : ''}" data-act="ava-toggle" data-k="${k}">${label}</button>`;
  const sex = d.preset === 'f' ? 'f' : 'm';
  const hairSw = (key) => `<div class="row" style="flex-wrap:wrap;gap:8px"><button class="swatch same ${!d[key] || d[key] === 'same' ? 'on' : ''}" data-act="ava-set" data-k="${key}" data-v="same" aria-label="Как волосы" title="Как волосы">=</button>${L.hair.map((v) => `<button class="swatch ${d[key] === v ? 'on' : ''}" style="background:${v}" data-act="ava-set" data-k="${key}" data-v="${v}" aria-label="${HAIR_COLOR_NAMES[v] || v}" title="${HAIR_COLOR_NAMES[v] || ''}"></button>`).join('')}</div>`;
  const hairColors = (key) => `<div class="row" style="flex-wrap:wrap;gap:8px">${L.hair.map((v) => `<button class="swatch ${d[key] === v ? 'on' : ''}" style="background:${v}" data-act="ava-set" data-k="${key}" data-v="${v}" aria-label="${HAIR_COLOR_NAMES[v] || v}" title="${HAIR_COLOR_NAMES[v] || ''}"></button>`).join('')}</div>`;
  const chipsOf = (key, vals, names) => `<div class="chips">${vals.map((v) => `<button class="chip ${(d[key] || DEF_LOOK[key]) === v ? 'on' : ''}" data-act="ava-set" data-k="${key}" data-v="${v}">${names[v] || v}</button>`).join('')}</div>`;
  // Очки: «без очков» + оправы; выбор оправы сам включает очки
  const glassesTiles = `<div class="ava-tiles">${['none', ...GLASSES_ORDER[sex]].map((v) => {
    const on = v === 'none' ? !d.glasses : d.glasses && (d.glassesStyle || 'classic') === v;
    return `<button class="ava-tile ${on ? 'on' : ''}" data-act="ava-glasses" data-v="${v}">${avatar({ ...d, glasses: v !== 'none', glassesStyle: v === 'none' ? d.glassesStyle : v, frame: null, crown: false, pet: 'none', prop: 'none', mask: 'none' }, 60, true)}<span>${GLASSES_NAMES[v]}</span></button>`;
  }).join('')}</div>`;
  const body = {
    face: `<div class="chips">${['m', 'f'].map((v) => `<button class="chip ${d.preset === v ? 'on' : ''}" data-act="ava-set" data-k="preset" data-v="${v}">${v === 'm' ? 'М' : 'Ж'}</button>`).join('')}</div>
      <p class="small" style="margin:0">${AVA3D ? '«М» и «Ж» задают брови по умолчанию и обращение к тебе: «ушёл» или «ушла», «разыграл» или «разыграла».' : '«М» — шире челюсть и плечи, густые брови. «Ж» — мягкий подбородок, высокие скулы, ресницы.'}</p>
      ${AVA3D ? '' : `<div class="field">Форма лица${tiles('face', L.face, FACE_NAMES, true)}</div>`}
      <div class="field">Нос${tiles('nose', L.nose, NOSE_NAMES, true)}</div>
      ${AVA3D ? '' : `<div class="field">Уши${chipsOf('ears', L.ears, EARS_NAMES)}</div>`}
      <div class="field">Тон кожи${sw('skin', L.skin)}</div>`,
    hair: `<div class="field">Причёска${tiles('hairStyle', HAIR_ORDER[sex].concat(L.hairStyle.filter((v) => !HAIR_ORDER[sex].includes(v))), HAIR_NAMES, 'hair')}</div><div class="field">Цвет волос${hairColors('hair')}</div>
      ${!AVA3D && HAIRLINE_OK.includes(d.hairStyle || 'short') ? `<div class="field">Линия роста волос${tiles('hairline', L.hairline, HAIRLINE_NAMES, 'top')}</div>` : ''}
      ${d.hairStyle !== 'bald' ? `<div class="field">Пробор и чёлка${chipsOf('part', L.part, PART_NAMES)}</div>` : ''}
      <p class="small" style="margin:0">Цвет бороды и усов настраивается отдельно — во вкладке «Борода».</p>`,
    eyes: `<div class="field">Форма глаз${tiles('eyeShape', EYE_ANAT, EYE_NAMES, 'eyes')}</div>
      <div class="field">Посадка${chipsOf('eyeGap', L.eyeGap, GAP_NAMES)}</div><div class="field">Размер${chipsOf('eyeSize', L.eyeSize, EYESIZE_NAMES)}</div>
      ${AVA3D ? '' : `<div class="chips">${tog('lashes', 'Выразительные ресницы')}</div>`}
      <div class="field">Цвет глаз${sw('eyes', L.eyes)}</div>
      <div class="field">Брови${tiles('browShape', L.browShape, BROW_NAMES, 'eyes')}</div><div class="field">Цвет бровей${hairSw('browColor')}</div>`,
    age: `<div class="field">Возраст${tiles('age', L.age, AGE_NAMES, true)}</div>
      <div class="field">Родинка${tiles('mole', L.mole, MOLE_NAMES, true)}</div><div class="chips">${tog('freckles', 'Веснушки')}${AVA3D ? '' : tog('dimples', 'Ямочки')}</div>
      <p class="small" style="margin:0">Седину выбирай в цвете волос: «Соль с перцем» или «Седой».</p>`,
    pet: `<div class="field">Питомец рядом${tiles('pet', L.pet, PET_NAMES)}</div>`,
    mouth: `<div class="field">Губы${chipsOf('lips', L.lips, LIPS_NAMES)}</div><div class="field">Обычное выражение${tiles('mouth', ['smile', 'neutral', 'smirk', 'grin'], MOUTH_NAMES, 'mouth')}</div><p class="small" style="margin:0">Грусть и удивление аватар покажет сам — в играх и мемах.</p>`,
    beard: `<div class="field">Борода и усы${tiles('beard', L.beard, BEARD_NAMES, true)}</div>
      <div class="field">Цвет бороды${hairSw('beardColor')}</div><div class="field">Цвет усов${hairSw('mustacheColor')}</div>
      <p class="small" style="margin:0">«=» — как волосы. Седая борода при тёмных волосах, рыжие усы — пожалуйста.</p>`,
    makeup: `<div class="field">Макияж${tiles('makeup', L.makeup, MAKEUP_NAMES, true)}</div><div class="field">Серьги${tiles('earrings', L.earrings, EARRING_NAMES, true)}</div>`,
    outfit: `<div class="field">Одежда${tiles('outfit', L.outfit, OUTFIT_NAMES)}</div><div class="field">Цвет одежды${sw('hoodie', L.hoodie)}</div>`,
    acc: `<div class="field">Очки${glassesTiles}</div>${d.glasses ? `<div class="field">Цвет оправы<div class="row" style="flex-wrap:wrap;gap:8px">${L.glassesColor.map((v) => `<button class="swatch gc ${(d.glassesColor || 'black') === v ? 'on' : ''}" style="background:${GLASS_SWATCH[v]}" data-act="ava-set" data-k="glassesColor" data-v="${v}" aria-label="${GLASS_COLOR_NAMES[v]}" title="${GLASS_COLOR_NAMES[v]}"></button>`).join('')}</div></div>
      <div class="field">Цвет стёкол<div class="row" style="flex-wrap:wrap;gap:8px">${L.lensColor.map((v) => `<button class="swatch gc ${(d.lensColor || 'clear') === v ? 'on' : ''}" style="background:${LENS_SWATCH[v]}" data-act="ava-set" data-k="lensColor" data-v="${v}" aria-label="${LENS_NAMES[v]}" title="${LENS_NAMES[v]}"></button>`).join('')}</div></div>` : ''}<div class="field">Серьги${tiles('earrings', L.earrings, EARRING_NAMES, true)}</div><div class="field">На шее${tiles('neck', L.neck, NECK_NAMES)}</div><div class="field">На голове${tiles('hat', L.hat, HAT_NAMES)}</div>${d.hat === 'cap' ? `<div class="field">Значок на кепке${tiles('capBadge', L.capBadge || ['none'], CAP_BADGE_NAMES)}</div>` : ''}${d.hat && d.hat !== 'none' && d.hat !== 'headset' ? `<div class="field">Цвет головного убора<div class="row" style="flex-wrap:wrap;gap:8px"><button class="swatch same ${!d.hatColor || d.hatColor === 'same' ? 'on' : ''}" data-act="ava-set" data-k="hatColor" data-v="same" title="Как одежда" aria-label="Как одежда">=</button>${L.hoodie.map((v) => `<button class="swatch ${d.hatColor === v ? 'on' : ''}" style="background:${HOODIE[v]}" data-act="ava-set" data-k="hatColor" data-v="${v}" title="${COLOR_NAMES[v]}" aria-label="${COLOR_NAMES[v]}"></button>`).join('')}</div></div>` : ''}<div class="field">Маска${tiles('mask', L.mask, MASK_NAMES, true)}</div><div class="chips">${tog('phones', 'Наушники')}</div>
      <div class="field">В руке${tiles('prop', ['none', 'mug', 'mug_best', 'phone', 'torch', 'mimosa', 'pancakes'], { none: 'Ничего', mug: 'Кружка', mug_best: 'Лучший сотрудник', phone: 'Телефон', torch: 'Факел', mimosa: 'Букет мимозы', pancakes: 'Стопка блинов' })}</div>
`,
    bg: `<div class="field">Фон${tiles('bg', L.bg, BG_NAMES)}</div><p class="small" style="margin:0">«Под кожу» сам подбирает цвет, на котором лицо не сливается с фоном.</p>`,
    meme: `<div class="field">В руках${tiles('prop', ['none', 'papers', 'sign', 'sign_lunch', 'sign_dnd', 'sign_ask', ...(AVA3D ? ['sign_coffee', 'sign_deadline', 'sign_plan', 'sign_friday', 'sign_domik', 'sign_tz', 'sign_thanks', 'sign_innocent', 'sign_vacation'] : []), 'laptop', 'trophy'], PROP_NAMES)}</div><p class="small" style="margin:0">Детали с ценой можно примерить бесплатно, а сохранить — после покупки в Лавке. Корона и рамки — тоже в Лавке.</p>`
  }[cat];
  const locked = draftLocked();
  return `<div class="ava-ed">
    <div class="ava-stage">${avatar(view(d), 170)}
      <div class="ava-tools"><button class="tool" data-act="ava-random" aria-label="Случайный аватар">dice</button><button class="tool" data-act="ava-reset" aria-label="Вернуть как было">↺</button></div>
    </div>
    <div class="presets">${AVA_PRESETS.map((pr) => { const cost = Object.entries(pr.look).reduce((a, [k, v]) => { const it = partLocked(k, v); return a + (it ? it.price : 0); }, 0);
      return `<button class="preset ${pr.legend ? 'legend' : ''}" data-act="ava-preset" data-v="${pr.id}">${avatar({ ...d, ...pr.look, frame: null, crown: false }, 52)}<span>${pr.legend ? 'star ' : ''}${esc(pr.name)}</span>${cost ? `<em>${cost} ${BEAN}</em>` : ''}</button>`; }).join('')}</div>
    <div class="ava-group" role="tablist"><button class="${AVA_LOOKS.includes(cat) ? 'on' : ''}" data-act="ava-cat" data-v="face">Внешность</button><button class="${AVA_LOOKS.includes(cat) ? '' : 'on'}" data-act="ava-cat" data-v="outfit">Стиль</button></div>
    <div class="cats" role="tablist">${AVA_CATS.filter(([id]) => AVA_LOOKS.includes(id) === AVA_LOOKS.includes(cat)).filter(([id]) => (id !== 'makeup' || d.preset === 'f') && (id !== 'beard' || d.preset !== 'f')).map(([id, label]) => `<button class="cat ${cat === id ? 'on' : ''}" role="tab" aria-selected="${cat === id}" data-act="ava-cat" data-v="${id}">${label}</button>`).join('')}</div>
    ${hideBar ? `<div class="hide-bar"><span class="small">В превью:</span>${hideBar}<span class="small">— на аватар не влияет</span></div>` : ''}
    <div class="cat-body">${body}</div>
    <div class="ava-foot">
      ${locked && locked.award ? `<button class="btn grow" disabled>«${esc(locked.name)}» — только за победу в Лиге банд</button>`
        : locked ? `<button class="btn grow" data-act="ava-buy" data-v="${locked.id}" ${S.me.beans < locked.price ? 'disabled' : ''}>Купить «${esc(locked.name)}» · ${locked.price} ${BEAN}</button>`
        : `<button class="btn grow" data-act="ava-save">${S.avaMode === 'vacation' ? 'Сохранить образ для отпуска' : 'Сохранить'}</button>`}
      <button class="btn ghost" data-act="close">Отмена</button>
    </div>
    ${!locked && S.avaMode !== 'vacation' ? '<button class="linkbtn" data-act="ava-save-vac" style="align-self:center">Сохранить как образ для отпуска</button>' : ''}
  </div>`;
}

const MOUTH_NAMES = { smile: 'Улыбка', grin: 'До ушей', smirk: 'Ухмылка', neutral: 'Серьёзный|Серьёзная', sad: 'Грустный|Грустная', wow: 'Удивлён|Удивлена' };
const BEARD_NAMES = { none: 'Нет', stubble: 'Щетина', beard: 'Борода', mustache: 'Усы', goatee: 'Эспаньолка' };
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
    <label class="field"><span class="hidden">Текст</span><textarea id="fb-text" rows="5" maxlength="1000" placeholder="${bug ? meG('Что делал → что ожидал → что получилось.', 'Что делала → что ожидала → что получилось.') + ' Например: в чате банды нажимаю «На кофе» — пуш никому не приходит' : 'Чего не хватает или что сделать удобнее. Например: хочу видеть, кто сегодня обедает в столовой'}">${esc(f.text)}</textarea></label>
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
    <div class="row"><button class="btn grow" data-act="ava-open">palette Конструктор</button><button class="btn ghost grow" data-act="meme-open">image Сделать мем</button></div>
    <p class="small" style="margin:0">${vac ? 'Пока ты в отпуске, банда видит второй образ. ' + '<button class="linkbtn" data-act="vac-look-clear">Убрать образ для отпуска</button>' : 'В конструкторе можно собрать и второй образ — для отпуска. Банда увидит его, пока ты отдыхаешь.'}</p>`;

  const nameBody = `
    <div class="field">Никнейм
      ${S.nickConfirm ? `<div class="note warn" style="margin:0">Сменить ${nk(me)} на <b>${esc(S.nickConfirm)}</b> ${me.nickFree ? 'бесплатно? Бесплатная смена одна, следующие — за ' + S.cat.nickPrice + ' зёрен.' : `за ${S.cat.nickPrice} зёрен?`} Старый ник освободится, и его сможет занять кто-то другой.</div>
      <div class="row"><button class="btn small grow" data-act="nick-yes">Да, сменить</button><button class="btn small ghost grow" data-act="nick-no">Отмена</button></div>`
      : `<div class="row"><label class="grow" style="display:flex"><span class="hidden">Новый никнейм</span><input id="p-nick" maxlength="14" value="${esc(me.nick)}" aria-label="Новый никнейм"></label>
      <button class="btn small" data-act="nick-change" ${!me.nickFree && me.beans < S.cat.nickPrice ? 'disabled' : ''}>Сменить</button></div>
      <span class="small" style="font-weight:600">${me.nickFree ? 'Первая смена бесплатно, дальше — ' + S.cat.nickPrice + ' зёрен. Буквы, цифры и «_», от 3 до 14 символов.' : me.beans < S.cat.nickPrice ? `Смена стоит ${S.cat.nickPrice} зёрен, у тебя ${me.beans}.` : `Стоит ${S.cat.nickPrice} зёрен. Буквы, цифры и «_», от 3 до 20 символов.`}</span>`}</div>
    <div class="row" style="gap:8px">
      <label class="field grow">Имя<input id="p-first" maxlength="30" value="${esc(p.firstName)}" autocomplete="given-name"></label>
      <label class="field grow">Фамилия<input id="p-last" maxlength="30" value="${esc(p.lastName)}" autocomplete="family-name"></label>
    </div>
    <p class="small" style="margin:0">Имя и фамилию видят все коллеги в Этаже.</p>
    <button class="btn ghost" data-act="name-save">Сохранить имя</button>`;

  const workBody = `
    <label class="field">Чем занимаюсь<input id="p-role" maxlength="80" value="${esc(p.role || '')}" placeholder="Аналитика тарифов B2B, отчётность для ДФК"></label>
    <label class="field">Спроси меня про… <span class="small" style="font-weight:600">— до пяти тем через запятую</span><input id="p-ask" maxlength="140" value="${esc((p.askMe || []).join(', '))}" placeholder="Jira, тарифы B2B, пропуска и парковка"></label>
    <button class="btn ghost small" data-act="work-save" style="justify-self:start">Сохранить</button>
    <span class="small" style="font-weight:600">По этим темам коллеги найдут тебя в «Кто знает?» на вкладке «Офис», а вопросы с доски по твоей теме придут в сводку «Этажа».</span>
    <div class="field">Статус<div class="chips">${Object.entries(meG(S.cat.moods, S.cat.moodsF || S.cat.moods)).map(([k, l]) => `<button class="chip ${p.mood === k ? 'on' : ''}" data-act="prof" data-k="mood" data-v="${k}">${esc(l)}</button>`).join('')}</div></div>
    <label class="field">Мой офис — на главной кнопке отметки<select id="home-office">
      <option value="">Не выбран</option>${S.cat.offices.slice().sort((x, y) => x.name.localeCompare(y.name, 'ru')).map((o) => `<option value="${esc(o.id)}" ${p.home === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
    <div class="field">План недели — нажимай, чтобы переключить: офис → дом → не знаю
      <div class="plan">${S.cat.days.map((d) => { const v = p.plan[d]; return `<button class="plan-day ${v || 'none'}" data-act="plan-day" data-v="${d}" aria-label="${d}: ${v === 'office' ? 'офис' : v === 'home' ? 'дом' : 'не задано'}"><b>${d}</b><span>${v === 'office' ? 'Офис' : v === 'home' ? 'Дом' : '—'}</span></button>`; }).join('')}</div>
      <span class="small" style="font-weight:600">Банда видит «по плану из дома» или «собирается в офис». Отметка в офисе всегда важнее плана.</span></div>`;

  const vacBody = `
    ${p.vacations.length ? p.vacations.map((v, i) => `<div class="item"><span class="grow" style="color:var(--ink);font-weight:800">sun ${ddmm(v.from)} — ${ddmm(v.to)}</span><button class="btn small danger" data-act="vac-del" data-v="${i}">Удалить</button></div>`).join('') : '<span class="small" style="font-weight:600">Пока пусто. В эти дни банда увидит «в отпуске до …», а зовы не будут присылать пуши.</span>'}
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
    ${MATCH_ON ? `<label class="check"><input type="checkbox" data-act="match-toggle" ${p.matchShow ? 'checked' : ''}> <span>«Совпадаем»: показывать коллегам, в какие дни я в офисе и дома (ник, имя, офис, общие интересы)</span></label>` : ''}
    <label class="check"><input type="checkbox" data-act="autosign-toggle" ${p.autoSign !== false ? 'checked' : ''}> <span>Таблички сами: пока включён «В фокус», аватар держит «Тихо, работаю», а после ответа «Скоро буду» или «Бегу» — «Скоро буду» на 20 минут. Свой предмет в руке потом вернётся</span></label>
    <label class="check"><input type="checkbox" data-act="monday-toggle" ${p.monday !== false ? 'checked' : ''}> <span>Неделя банды: в первый рабочий день недели около 9:30 — пуш, кто из банды в отпуске, болеет и у кого день рождения</span></label>
    <label class="check"><input type="checkbox" data-act="weather-toggle" ${p.weather !== false ? 'checked' : ''}> <span>Погода на завтра: вечером накануне офисного дня — пуш, если ждёт дождь, снег, мороз или жара</span></label>
    <label class="check"><input type="checkbox" data-act="digest-toggle" ${p.digest !== false ? 'checked' : ''}> <span>Утренняя сводка: один пуш в рабочий день около 11:30, если есть дела и ты ещё не заходил${meG('', 'а')}</span></label>
    <label class="check"><input type="checkbox" data-act="findable-toggle" ${p.findable !== false ? 'checked' : ''}> <span>Меня можно найти по нику и рабочей почте — и позвать в банду</span></label>
    <div class="field">Кто может писать мне в личку<div class="chips">${[['all', 'Все'], ['gang', 'Моя банда'], ['none', 'Никто']].map(([k, t]) => `<button class="chip ${(p.dmFrom || 'all') === k ? 'on' : ''}" data-act="dm-from" data-v="${k}">${t}</button>`).join('')}</div>
      <span class="small" style="font-weight:600">Подельники (избранные) могут писать всегда. Уже начатые переписки ограничение не обрывает — их закрывают крестиком.</span></div>
    <div class="field">Оформление<div class="seg">${[['auto', 'Как в телефоне'], ['light', ico('sun', 16) + ' Светлое'], ['dark', ico('moon', 16) + ' Тёмное']].map(([k, t]) => `<button class="seg-b ${themePref() === k ? 'on' : ''}" data-act="theme-set" data-v="${k}">${t}</button>`).join('')}</div></div>
    <div class="snd-set">
      <label class="field" style="gap:4px"><span>Громкость звуков: <b id="vol-n">${soundVol() ? soundVol() + '%' : 'выкл'}</b></span>
        <input type="range" id="snd-vol" min="0" max="100" step="5" value="${soundVol()}" aria-label="Громкость звуков интерфейса"></label>
      <div class="row" style="justify-content:space-between;gap:8px">
        <label class="check" style="margin:0"><input type="checkbox" data-act="vibro-toggle" ${vibroOn() ? 'checked' : ''}> <span>Вибрация${navigator.vibrate ? '' : ' <span class="small">(этот браузер не умеет)</span>'}</span></label>
        <button class="btn small ghost" data-act="sound-test">Послушать</button>
      </div>
    </div>
    ${COFFEE_ON ? `<label class="check"><input type="checkbox" data-act="coffee-toggle" ${p.coffee ? 'checked' : ''}> <span>Участвовать в случайном кофе${p.home ? '' : ' (сначала укажи «Мой офис» в разделе «Работа»)'}</span></label>` : ''}
    ${pushState === 'granted' && !(me.completion.steps.find((x) => x.id === 'push') || {}).done ? `<div class="note warn" style="margin:0">Браузер разрешил уведомления, но этот телефон не подключён к серверу — пуши не придут.</div><button class="btn blue" data-act="push-enable" ${S.vapidKey ? '' : 'disabled'}>Подключить уведомления</button>`
      : pushState === 'granted' ? '<div class="row"><span class="note good grow">Уведомления включены</span><button class="btn small ghost" data-act="push-test">Проверить</button></div>'
      : pushState === 'unsupported' ? `<div class="note warn">${isIOS() && !isStandalone() ? 'На iPhone уведомления работают только из установленного приложения.' : 'Этот браузер не поддерживает уведомления.'}</div>`
      : pushState === 'denied' ? '<div class="note warn">Уведомления запрещены в настройках браузера.</div>'
      : `<button class="btn blue" data-act="push-enable" ${S.vapidKey ? '' : 'disabled'}>Включить уведомления</button>`}
    <button class="btn ghost" data-act="open" data-v="install">Как установить на телефон</button>`;

  return `
    <div class="prof-hero">${progressRing(me.completion.pct, avatar(look, 72))}<div class="grow">
      <div class="nick" style="color:var(--ink)">${nk(me)}</div>
      ${name ? `<div class="small" style="font-weight:700">${esc(name)}</div>` : ''}
      ${me.status ? `<div class="status" style="color:var(--tint-y-fg)">${esc(me.status)}</div>` : ''}
      <div class="small">${me.beans} ${plural(me.beans, 'зерно', 'зерна', 'зёрен')}</div></div></div>
    ${renderCompletion(true)}
    <div class="p-group">Обо мне</div>
    ${section('look', 'Внешность', `${OUTFIT_NAMES[look.outfit] || 'Худи'} · ${(HAIR_NAMES[look.hairStyle] || '').toLowerCase()}${look.prop && look.prop !== 'none' ? ' · ' + (PROP_NAMES[look.prop] || '').toLowerCase() : ''}`, lookBody)}
    ${section('name', 'Ник, имя и фамилия', name ? `${esc(name)}` : 'Имя не указано', nameBody)}
    ${section('ach', 'Ачивки', got == null ? '' : `${got} из ${S.fx.achievements.length}`, renderAchievements())}
    ${section('work', 'Работа', `${office || 'офис не указан'} · ${plan}`, workBody)}
    ${section('vac', 'Отпуска', p.vacations.length ? p.vacations.map((v) => `${ddmm(v.from)}–${ddmm(v.to)}`).join(', ') : 'не запланированы', vacBody)}
    ${section('about', 'О себе', [p.about && esc(p.about), p.bday && 'ДР ' + esc(p.bday)].filter(Boolean).join(' · ') || 'интересы, пара слов, день рождения', aboutBody)}
    <div class="p-group">Для себя</div>
    <button class="fb-entry battery-entry" data-act="open" data-v="battery"><span class="st-ico bt-ico">bolt</span><span class="grow"><b>Батарейка недели</b><span class="small">Пять вопросов по пятницам: сколько сил осталось. Видишь только ты</span></span><span class="chev" aria-hidden="true">›</span></button>
    <button class="fb-entry style-entry" data-act="open" data-v="style"><span class="st-ico">spark</span><span class="grow"><b>Мой стиль</b><span class="small">Какой ты в Этаже: ритм, привычки, бейджи, с кем на связи. Видишь только ты</span></span><span class="chev" aria-hidden="true">›</span></button>
    <div class="p-group">Настройки</div>
    ${section('priv', 'Приватность, звук и уведомления', `${me.shareOffice ? 'банда видит, где я' : 'где я — скрыто'}${me.quiet ? ' · тихие часы' : ''} · ${soundVol() ? 'звук ' + soundVol() + '%' : 'без звука'}`, privBody)}
    <div class="p-group">Про Этаж</div>
    <button class="fb-entry about-entry" data-act="open" data-v="about"><span class="grow"><b>Об Этаже</b><span class="small">Зачем он и что тут есть — коротко и без канцелярита</span></span><span class="chev" aria-hidden="true">›</span></button>
    <button class="fb-entry" data-act="open" data-v="guide"><span class="grow"><b>Как тут всё устроено</b><span class="small">Каждая вкладка и меню: что нажимать и зачем</span></span><span class="chev" aria-hidden="true">›</span></button>
    <button class="fb-entry" data-act="open" data-v="changes"><span class="grow"><b>Что нового</b><span class="small">${S.changes && S.changes[0] ? 'Последнее обновление — ' + esc(ddmm(S.changes[0].day)) : 'Что добавили и починили — по дням'}</span></span>${changesFresh() ? '<span class="fb-count">новое</span>' : '<span class="chev" aria-hidden="true">›</span>'}</button>
    <button class="fb-entry" data-act="open" data-v="feedback"><span class="grow"><b>Есть идея или нашёл ошибку?</b><span class="small">Напиши — ответим. За принятую идею +10 зёрен</span></span>${(S.state && S.state.badges && S.state.badges.feedback) ? `<span class="fb-count">${S.state.badges.feedback}</span>` : '<span class="chev" aria-hidden="true">›</span>'}</button>
    ${me.isAdmin ? '<a class="btn violet" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="/admin.html">Модерация</a>' : ''}
    <div class="row" style="justify-content:space-between">
      <button class="linkbtn" data-act="logout">Выйти</button>
      <a class="linkbtn" href="/privacy.html" target="_blank" rel="noopener">Политика</a>
      <button class="linkbtn" style="color:var(--tint-r-fg)" data-act="delete-account">Удалить аккаунт</button>
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
    if (!x.me && !x.name && S.state && S.state.nameLock !== undefined && !(S.me.profile && S.me.profile.firstName)) rows.push(['Имя', '<button class="linkbtn" data-act="open-sec" data-v="name">скрыто — укажи своё, чтобы видеть имена</button>']);
  }
  return `<div class="person-card">
    <div class="person-ava">${avatar(x.look, 180)}</div>
    <div class="nick" style="color:var(--ink);text-align:center">${nk(x)}${x.me ? ' (ты)' : ''}</div>
    ${x.name ? `<div class="sub" style="text-align:center;margin:0;font-weight:700">${esc(x.name)}</div>` : ''}
    ${x.status ? `<div class="status" style="color:var(--tint-y-fg);text-align:center">${esc(x.status)}</div>` : ''}
    ${x.role ? `<div class="person-role">${ico('office', 16)} ${esc(x.role)}</div>` : ''}
    ${x.badges && x.badges.length ? `<div class="card-badges">${x.badges.map((b) => `<span class="cbadge" title="${esc(b.desc)}">${ico(b.icon, 16)} ${esc(b.title)}</span>`).join('')}</div>` : ''}
    ${x.askMe && x.askMe.length ? `<div class="ask-box"><span class="small">Спроси меня про</span><div class="chips" style="justify-content:center">${x.askMe.map((t) => `<span class="chip ask-chip">${esc(t)}</span>`).join('')}</div></div>` : ''}
    ${x.about ? `<p class="person-about">«${esc(x.about)}»</p>` : ''}
    ${x.tags && x.tags.length ? `<div class="chips" style="justify-content:center">${x.tags.map((t) => `<span class="chip on" style="cursor:default">${esc(t)}</span>`).join('')}</div>` : ''}
    ${rows.length ? `<div class="person-rows">${rows.map(([k, v]) => `<div><span class="small">${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
    ${x.respects ? `<p class="respects" title="Сколько раз коллеги выразили респект. Кто и за что — видит только сам человек">${ico('hand', 16)} Респектов: <b>${x.respects}</b></p>` : ''}
    ${!x.full ? '<p class="small" style="text-align:center">Подробности видят члены общих банд.</p>' : ''}
    ${x.me ? '<button class="btn ghost" data-act="open" data-v="profile">Редактировать мой профиль</button>'
      : `<button class="btn thx-btn" data-act="thx-open" data-id="${x.id}" data-nick="${esc(x.nick)}">hand Респект</button>
        <button class="btn ghost small todo-for" data-act="todo-for" data-id="${x.id}" data-nick="${esc(x.nick)}">${ico('check', 15)} В мои дела</button>
        <div class="row">${x.canDm ? `<button class="btn grow" data-act="dm-open" data-id="${x.id}">chat Написать</button>` : '<span class="small grow">Личку принимает не от всех</span>'}${x.full ? `<button class="btn ghost grow" data-act="pcall-open" data-id="${x.id}">megaphone Позвать</button>` : ''}</div>`}
  </div>`;
}

// ===== Лавка =====
// Вкладки вместо одного длинного списка; сверху — товар дня, «по карману сейчас» и сезонное.
// Внутри вкладки: сначала то, на что хватает зёрен, потом дороже, купленное — в конце, свёрнуто
const SHOP_TABS = [['me', 'Для меня'], ['style', 'Стиль'], ['fun', 'Приколы'], ['gang', 'Для банды'], ['awards', 'Трофеи'], ['earn', 'Как заработать']];
const shopTabOf = (it) => (it.award ? 'awards' : it.kind === 'part' ? 'me' : it.kind === 'prank' ? 'fun' : it.kind === 'gang' ? 'gang' : 'style');
const GIFTABLE = (it) => !it.award && !['gang', 'prank'].includes(it.kind) && !it.limit;
const dateOf = (ts) => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
const SND_NAMES = { lift: 'лифт', fanfare: 'фанфары', chip: '8-бит', cuckoo: 'ку-ку' };
const PRANK_ABOUT = { coffee: 'Кофейное пятно на одежде и опрокинутая кружка', sticker: 'Жёлтый стикер «Я ♥ понедельники» на лбу', phones: 'Розовые наушники и ноты вокруг головы' };
const NFX_ABOUT = { gold: 'Ник переливается золотом', rainbow: 'Ник радугой', glitch: 'Ник с помехами, как в старом телевизоре' };
// Как вещь выглядит на тебе: для деталей и рамок — твой аватар с ней
// Примерка в Лавке: снимаем то, что закрывает примеряемую вещь — шапка не прячет причёску, очки не прячут глаза,
// табличка в руках не прячет куртку, борода — галстук. Это только показ, на сохранённый аватар не влияет
const TRY_UNCOVER = {
  hairStyle: { hat: 'none', phones: false },
  eyeShape: { glasses: false, mask: 'none' },
  mask: { glasses: false },
  neck: { beard: 'none' },
  outfit: { prop: 'none' }
};
const tryLook = (it) => ({ ...S.me.look, ...(TRY_UNCOVER[it.slot] || {}), [it.slot]: it.value, frame: null, crown: false, prank: null });
function shopPrev(it, size = 44, plain = false) {
  if (it.kind === 'part') return avatar(tryLook(it), size);
  if (it.kind === 'frame') return avatar({ ...S.me.look, frame: it.id, crown: false, prank: null }, size);
  if (it.kind === 'crown') return avatar({ ...S.me.look, crown: true, prank: null }, size);
  if (it.kind === 'prank') return avatar({ ...S.me.look, frame: null, crown: false, prank: { v: it.value, until: Date.now() + 6e4 } }, size);
  if (it.kind === 'nickfx') return `<span class="shop-ico nfx-ico"><span class="nfx nfx-${it.value}" data-t="Аа">Аа</span></span>`;
  if (it.kind === 'sound' && plain) return '<span class="shop-ico snd-ico">▶</span>';
  if (it.kind === 'sound') return `<button class="shop-ico snd-ico" data-act="shop-listen" data-v="${it.value}" aria-label="Послушать: ${esc(it.name)}">▶</button>`;
  if (it.kind === 'status') return '<span class="shop-ico">medal</span>';
  if (it.kind === 'gang') return `<span class="shop-ico">${{ g_gold: 'flag', g_motto: 'chat', g_flag: 'flag', g_horn: 'megaphone', g_pizza: '🍕' }[it.id] || 'shield'}</span>`;
  return '<span class="shop-ico">star</span>';
}
const priceBtn = (it) => `<button class="btn small" data-act="buy" data-v="${it.id}" ${S.shop.beans < it.price ? 'disabled' : ''}>${it.was ? `<s class="was">${it.was}</s> ` : ''}${it.price} ${BEAN}</button>`;
const giftBtn = (it) => (GIFTABLE(it) ? `<button class="icon-btn gift-btn" data-act="gift-open" data-v="${it.id}" aria-label="Подарить подельнику: ${esc(it.name)}" title="Подарить">gift</button>` : '');
function shopSort(list) {
  const b = S.shop.beans;
  const rank = (it) => (it.owned ? 2 : it.price <= b ? 0 : 1);
  return [...list].sort((x, y) => rank(x) - rank(y) || x.price - y.price);
}
// Строка товара (всё, кроме деталей аватара — они плиткой)
function shopRow(it) {
  let action, sub = '';
  if (it.award) {
    action = !it.owned ? '<span class="small">не продаётся</span>'
      : it.kind === 'frame' ? `<button class="btn small ${it.equipped ? 'worn' : 'ghost wear'}" data-act="equip" data-v="${it.id}" data-on="${it.equipped ? '0' : '1'}">${it.equipped ? 'check Надето' : 'Надеть'}</button>`
      : `<button class="btn small ghost" data-act="ava-open" data-cat="${it.slot === 'prop' ? 'meme' : 'acc'}">В конструктор</button>`;
    sub = it.owned ? 'твой трофей' : 'за ' + esc(it.how);
  } else if (it.kind === 'gang') {
    const g = S.gang && S.gang.gang && S.gang.gang.id === (S.shopGang || S.activeGang) ? S.gang.gang : null;
    const has = g && { g_gold: g.gold, g_motto: g.mottoOwned, g_flag: g.flag, g_horn: g.horn }[it.id];
    const pz = it.id === 'g_pizza' && g && g.pizza;
    action = !S.me.gangs.length ? '<span class="small">нужна банда</span>' : has ? '<span class="small">check есть у банды</span>' : pz ? `<span class="small">ещё едят: ${pz.left} из ${pz.slices}</span>` : priceBtn(it);
    sub = { g_gold: 'Золотая рамка у карточки банды', g_motto: 'Строчка под названием банды', g_flag: 'Флаг цвета банды над твоим офисом на экране «Офис»', g_horn: 'Гудок, когда кто-то из банды открывает чат', g_pizza: `${it.slices} кусков в чате банды: каждый берёт по куску и +1 зерно. Сам угощающий не ест` }[it.id] || '';
  } else if (it.kind === 'nickfx') {
    action = priceBtn(it).replace(`${it.price} ${BEAN}`, `${it.active ? '+7 дн · ' : ''}${it.price} ${BEAN}`);
    sub = it.active ? `<b>до ${dateOf(it.active)}</b>` : `${NFX_ABOUT[it.value] || ''} · на ${it.days} дней`;
  } else if (it.kind === 'sound') {
    action = it.owned ? `<button class="btn small ${it.equipped ? 'worn' : 'ghost wear'}" data-act="equip" data-v="${it.id}" data-on="${it.equipped ? '0' : '1'}">${it.equipped ? 'check Включён' : 'Включить'}</button>` : priceBtn(it);
    sub = 'Играет, когда отмечаешься в офисе · нажми ▶, чтобы послушать';
  } else if (it.kind === 'prank') {
    action = `<button class="btn small" data-act="gift-open" data-v="${it.id}" data-mode="prank" ${S.shop.beans < it.price ? 'disabled' : ''}>Разыграть · ${it.price} ${BEAN}</button>`;
    sub = `${PRANK_ABOUT[it.value] || ''} — на час на аватаре подельника`;
  } else if (it.owned) {
    action = `<button class="btn small ${it.equipped ? 'worn' : 'ghost wear'}" data-act="equip" data-v="${it.id}" data-on="${it.equipped ? '0' : '1'}">${it.equipped ? 'check Надето' : 'Надеть'}</button>`;
  } else if (it.left === 0) {
    action = '<span class="small">тираж закончился</span>';
  } else action = priceBtn(it);
  if (!sub && it.left !== undefined) sub = `осталось ${it.left}`;
  if (it.until && !it.owned) sub = (sub ? sub + ' · ' : '') + `в продаже до ${ddmm(it.until)}`;
  const gift = !it.award && !it.owned && it.kind !== 'prank' ? giftBtn(it) : it.owned && GIFTABLE(it) ? giftBtn(it) : '';
  return `<div class="item shop-row" data-item="${it.id}">${shopPrev(it)}<div class="grow" style="min-width:0"><div style="font-weight:900">${it.color ? `<span class="dot" style="background:${it.color}"></span>` : ''}${esc(it.name)}${it.was ? ' <span class="deal-tag">−30%</span>' : ''}</div>${sub ? `<div class="small">${sub}</div>` : ''}</div>${gift}${action}</div>`;
}
// Плитка детали аватара: нажатие — примерка на большом аватаре сверху
function shopTile(it) {
  const on = S.shopTry === it.id;
  return `<button class="shop-tile ${on ? 'on' : ''} ${it.owned ? 'own' : ''}" data-act="shop-try" data-v="${it.id}" data-item="${it.id}" aria-pressed="${on}">
    ${avatar(tryLook(it), 64)}
    <span class="st-name">${it.legend ? 'star ' : ''}${esc(it.name)}</span>
    <span class="st-price ${it.owned ? 'own' : S.shop.beans < it.price ? 'far' : ''}">${it.owned ? 'check твоё' : `${it.was ? `<s>${it.was}</s> ` : ''}${it.price} ${BEAN}`}</span></button>`;
}
function shopTryCard(items) {
  const it = items.find((x) => x.id === S.shopTry) || null;
  const look = it ? tryLook(it) : { ...S.me.look, prank: null };
  const cat = (x) => (x.slot === 'prop' ? 'meme' : x.slot === 'outfit' ? 'outfit' : x.slot === 'hairStyle' ? 'hair' : x.slot === 'eyeShape' ? 'eyes' : x.slot === 'pet' ? 'pet' : 'acc');
  const act = !it ? '<p class="small" style="margin:0">Нажми на любую вещь ниже — примеришь её здесь. Бесплатно и без покупки.</p>'
    : it.owned ? `<div class="row" style="gap:8px"><button class="btn small ghost" data-act="ava-open" data-cat="${cat(it)}">Надеть в конструкторе</button>${giftBtn(it)}</div>`
    : `<div class="row" style="gap:8px">${priceBtn(it)}${giftBtn(it)}</div>${S.shop.beans < it.price ? `<span class="small">Не хватает ${it.price - S.shop.beans} зёрен</span>` : ''}`;
  return `<div class="shop-try">${avatar(look, 92)}<div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:6px">
    <b>${it ? esc(it.name) : 'Примерочная'}</b>${it && it.until ? `<span class="small">в продаже до ${ddmm(it.until)}</span>` : ''}${act}</div></div>`;
}
function renderShop() {
  if (!S.shop) return '<p class="sub">Загружаем…</p>';
  const items = S.shop.items, beans = S.shop.beans;
  const tab = S.shopTab || 'me';
  const buyable = items.filter((it) => !it.award && !['gang', 'prank'].includes(it.kind) && !it.owned && it.left !== 0);
  // Товар дня
  const deal = S.shop.deal && items.find((x) => x.id === S.shop.deal.id);
  const dealCard = deal ? `<div class="deal" data-item="${deal.id}"><span class="deal-badge">Товар дня · −30%</span>${shopPrev(deal, 56)}<div class="grow" style="min-width:0"><b>${esc(deal.name)}</b><span class="small">до полуночи, у всех одинаковый</span></div>
    ${deal.owned ? '<span class="small">check уже твоё</span>' : `<div class="deal-act">${priceBtn(deal)}${giftBtn(deal)}</div>`}</div>` : '';
  // По карману сейчас + ближайшая цель
  const can = buyable.filter((x) => x.price <= beans && (!deal || x.id !== deal.id)).sort((a, b) => b.price - a.price).slice(0, 6);
  const goal = buyable.filter((x) => x.price > beans).sort((a, b) => a.price - b.price)[0];
  const canStrip = can.length ? `<div class="shop-sec"><span class="eyebrow">По карману сейчас</span><div class="shop-strip">${can.map((x) => `<button class="mini-item" data-act="shop-go" data-v="${x.id}">${shopPrev(x, 40, true)}<span class="ellipsis">${esc(x.name)}</span><b>${x.price} ${BEAN}</b></button>`).join('')}</div></div>` : '';
  const goalLine = goal ? `<button class="goal-line" data-act="shop-go" data-v="${goal.id}">Ещё <b>${goal.price - beans}</b> ${BEAN} — и твоё «${esc(goal.name)}» ›</button>` : '';
  // Только сейчас: сезонное
  const season = items.filter((x) => x.until && !x.owned);
  const seasonStrip = season.length ? `<div class="shop-sec"><span class="eyebrow">Только сейчас</span><div class="shop-strip">${season.map((x) => `<button class="mini-item season" data-act="shop-go" data-v="${x.id}">${shopPrev(x, 40, true)}<span class="ellipsis">${esc(x.name)}</span><b>до ${ddmm(x.until)}</b></button>`).join('')}</div></div>` : '';
  const counts = Object.fromEntries(SHOP_TABS.map(([k]) => [k, items.filter((x) => shopTabOf(x) === k).length]));
  const tabs = `<div class="shop-tabs" role="tablist">${SHOP_TABS.filter(([k]) => k === 'earn' || counts[k]).map(([k, l]) => `<button role="tab" class="chip ${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="shop-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
  const inTab = items.filter((x) => shopTabOf(x) === tab);
  const ownedFold = (list, render, label = 'Твоё') => (list.length ? `<details class="shop-own" ${S.shopOwnOpen ? 'open' : ''}><summary data-act="shop-own">${label} · ${list.length}</summary>${render(list)}</details>` : '');
  let body = '';
  if (tab === 'me') {
    const rest = shopSort(inTab.filter((x) => !x.owned)), mine = inTab.filter((x) => x.owned);
    body = `${shopTryCard(inTab)}<div class="shop-grid">${rest.map(shopTile).join('')}</div>${ownedFold(mine, (l) => `<div class="shop-grid">${l.map(shopTile).join('')}</div>`)}`;
  } else if (tab === 'style') {
    const groups = [['nickfx', 'Эффект ника · на неделю'], ['sound', 'Звук отметки в офисе'], ['status', 'Статусы'], ['frame', 'Рамки аватара'], ['crown', 'Особое']];
    body = groups.map(([k, t]) => { const l = shopSort(inTab.filter((x) => x.kind === k)); return l.length ? `<h3>${t}</h3>${l.map(shopRow).join('')}` : ''; }).join('');
  } else if (tab === 'fun') {
    const pr = S.me.look.prank && S.me.look.prank.until > Date.now();
    body = `<p class="sub" style="margin:0">Подлянка живёт час на аватаре подельника, и он видит, от кого. Снимается одним касанием. Не больше 5 в день.</p>
      ${shopSort(inTab).map(shopRow).join('')}
      ${(() => { const on = !(S.me.profile && S.me.profile.noPranks); return `<button class="toggle-row" role="switch" aria-checked="${on}" data-act="pranks-allow" data-v="${on ? '0' : '1'}"><span class="grow"><b>Меня можно разыгрывать</b><span class="small">Выключишь — подельники не смогут повесить подлянку на твой аватар</span></span><span class="sw ${on ? 'on' : ''}" aria-hidden="true"></span></button>`; })()}
      ${pr ? '<button class="btn ghost small" data-act="prank-off">Снять подлянку со своего аватара</button>' : ''}
      <div class="note" style="margin:0">gift <b>Подарки.</b> Любую вещь из Лавки можно подарить подельнику — кнопка с подарком рядом с ценой. Платишь ты, вещь появится у него, а в личку придёт открытка.</div>`;
  } else if (tab === 'gang') {
    const gangSel = S.me.gangs.length > 1 ? `<div class="field">Покупка для банды<div class="chips">${S.me.gangs.map((g) => `<button class="chip ${g.id === (S.shopGang || S.activeGang) ? 'on' : ''}" data-act="shop-gang" data-v="${g.id}">${esc(g.name)}</button>`).join('')}</div></div>` : '';
    body = `${gangSel}${inTab.map(shopRow).join('')}
      ${S.gang && S.gang.gang.mottoOwned ? `<label class="field">Девиз банды «${esc(S.gang.gang.name)}»<input id="motto" maxlength="40" value="${esc(S.gang.gang.motto || '')}"></label><button class="btn ghost" data-act="motto-save">Сохранить девиз</button>` : ''}`;
  } else if (tab === 'awards') {
    body = `<p class="sub" style="margin:0">Не продаются — только заслужить.</p>${inTab.map(shopRow).join('')}`;
  } else body = SHOP_EARN;
  return `<div class="shop-top"><div class="shop-wallet">${art('beans', 30)} У тебя <b>${beans}</b> зёрен${S.shop.nickfx ? ` · ник ${{ gold: 'золотой', rainbow: 'радужный', glitch: 'глитч' }[S.shop.nickfx.v]} до ${dateOf(S.shop.nickfx.until)}` : ''}</div>${goalLine}</div>
    ${dealCard}${canStrip}${seasonStrip}
    ${tabs}
    <div class="shop-body">${body}</div>`;
}
// Выбор подельника: подарить вещь или разыграть
function renderGiftPick() {
  const it = S.shop && S.shop.items.find((x) => x.id === S.giftItem);
  if (!it) return '<p class="sub">Вещь не найдена.</p>';
  const prank = it.kind === 'prank';
  const favs = (S.chats && S.chats.favorites) || null;
  const list = !favs ? '<p class="sub">Загружаем подельников…</p>' : !favs.length ? '<p class="sub">Подельников пока нет. Добавь их в личке — значок диалога наверху, звёздочка в карточке человека.</p>'
    : favs.map((f) => `<div class="chat-row">${avatar(f.look, 36)}<span class="grow ellipsis"><b>${nk(f)}</b></span><button class="btn small" data-act="gift-send" data-id="${f.id}">${prank ? 'Разыграть' : 'Подарить'}</button></div>`).join('');
  return `<div class="item">${shopPrev(it)}<div class="grow"><b>${esc(it.name)}</b><div class="small">${it.price} ${BEAN} — спишутся с тебя${prank ? ' · на час на аватаре' : ''}</div></div></div>
    <span class="eyebrow">${prank ? 'Кого разыграть' : 'Кому подарить'}</span>${list}`;
}

const SHOP_EARN = `<div class="earn">
      <div class="earn-g"><b>where Каждый день</b><span>Отметка в офисе или «из дома» — +5</span><span>Столовая — +2 (до 2 раз)</span><span>Ответ на зов — +1 (до 10)</span><span>Подтверждённый сигнал офиса — +2 (до 3)</span><span>Задания дня — +3 за каждое, +5 за все</span><span>Респект от коллеги — +2 (до 3 в день)</span></div>
      <div class="earn-g"><b>game Игры</b><span>game <b>Дуэли</b> (камень-ножницы-бумага, кости, крестики-нолики) — +2 за победу, до 3 раз в день</span><span>coin Дуэль на ставку — победитель забирает обе ставки (5 или 10 зёрен)</span><span>anchor Морской бой — +5 за первую победу в день</span><span>Квиз недели — +3 за верный ответ, блиц — до +10</span><span>«Кто из наших?» — +1 за верный ответ</span></div>
      <div class="earn-g"><b>swords Банда</b><span>Битва банд: герою-победителю +20, всей банде по +5</span><span>Ставки в битвах — делите банк соперника</span><span>Кубок месяца: чемпионам по +15, финалистам по +5</span><span>Призовые места в Лиге: до +30 за неделю и до +100 за месяц</span><span>Банда набрала 3 человек — залог 50 вернётся</span></div>
      <div class="earn-g"><b>medal Прочее</b><span>Ачивки: обычные, редкие и легендарные — в том числе за дуэли</span><span>Приведи новичка по своей ссылке — +15</span><span>Принятая идея или найденный баг — +10</span></div>
    </div>`;

// ---------- Действия ----------
// Опасное действие подтверждается вторым нажатием в течение 4 секунд
function confirmTwice(id, text) {
  const t = Date.now();
  if (S.confirmId === id && t - S.confirmAt < 4000) { S.confirmId = null; return true; }
  S.confirmId = id; S.confirmAt = t; toast(text, { top: true }); return false;
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
      const r = await post('/api/auth/request', { email, consent: true, join: store.get('pendingJoin', null) || undefined, crew: store.get('pendingCrew', null) || undefined });
      // Компании ещё нет в Этаже — сервер прислал письмо для подтверждения заявки
      S.onb = { ...S.onb, step: r.access ? 'access' : 'sent', error: '', devLink: r.devLink || null, devCode: r.devCode || null };
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
    if (!S.onb.preset) { S.onb.error = 'Выбери «Он» или «Она» — так приложение будет обращаться к тебе правильно.'; return render(); }
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
    const again = S.tab === el.dataset.v;
    if (!again) tabSound(el.dataset.v);
    // Повторное нажатие на открытую вкладку — к её главному экрану: из банды, лички и партии — в список чатов, и наверх
    if (again) {
      const nested = S.dmList || S.dm || S.battle;
      S.chatGang = false; S.dm = null; S.dmView = null; S.battle = null; S.bv = null;
      if (nested) sfx('close');
    }
    S.dmList = false; S.tab = el.dataset.v; S.sheet = null; if (S.tab === 'chats') { ensureGang(); S.gangTab = S.gangTab || 'chat'; } render();
    if (again) window.scrollTo(0, 0);
    await run(() => refresh());
  },
  'near-more': () => { S.nearMore = !S.nearMore; try { store.set('nearMore', S.nearMore); } catch {} render(); },
  checkin: (el) => run(async () => {
    S.sheet = null;
    const r = await post('/api/checkin', { office: el.dataset.v });
    try { store.set('recentOffices', [el.dataset.v, ...recentOffices().filter((id) => id !== el.dataset.v)].slice(0, 5)); } catch {}
    S.officeQ = '';
    if (r.streak && S.me) S.me.streak = r.streak;
    // Свой звук отметки из Лавки
    const snd = S.me && S.me.look && S.me.look.snd;
    if (snd && SOUNDS[snd]) sfx(snd);
    if (r.streak) showStreak(r); else if (r.beans) toast(`+${r.beans} зёрен за отметку`);
    await refresh({ all: true });
  }),
  checkout: () => run(async () => { await post('/api/checkout'); toast('Хорошего вечера!'); await refresh(); }),
  'canteen-in': () => run(async () => { const r = await post('/api/canteen/in'); toast(r.beans ? `Приятного аппетита! +${r.beans}` : 'Приятного аппетита!'); await Promise.all([loadState(), loadFeatures()]); }),
  'canteen-out': () => run(async () => { await post('/api/canteen/out'); await loadState(); }),
  'share-on': () => run(async () => { await post('/api/me/profile', { shareOffice: true }); S.me.shareOffice = true; await loadState(); }),

  'gang-select': (el) => run(async () => { S.activeGang = Number(el.dataset.v); store.set('activeGang', S.activeGang); S.thanksTo = null; await Promise.all([loadGang(), loadGangExtra()]); }),
  'gang-find': () => run(async () => { S.gfind = S.gfind || { q: '', area: '', items: null }; S.sheet = 'gang-find'; render(); await loadGangFind(); }),
  'gang-find-go': () => run(async () => { S.gfind.q = ($('#gfind-q') || {}).value || ''; await loadGangFind(); }),
  'gang-find-area'(el) { S.gfind.q = ($('#gfind-q') || {}).value || ''; S.gfind.area = el.dataset.v; run(loadGangFind); },
  'gang-profile': (el) => run(async () => { S.gprofile = null; S.sheet = 'gang-profile'; render(); S.gprofile = await get(`/api/gangs/${el.dataset.id}/profile`); }),
  'dm-close': (el) => run(async () => {
    const id = Number(el.dataset.id);
    const it = ((S.chats && S.chats.items) || []).find((x) => x.type === 'dm' && x.id === id);
    const closedByOther = (it && it.closed) || (S.dmView && S.dm === id && S.dmView.closedByOther);
    if (!closedByOther && !confirmInline('dm-close' + id, 'Нажми ещё раз: переписка удалится у вас обоих, а собеседник увидит, что ты закрыл|закрыла личку')) return;
    await post(`/api/dm/${id}/close`);
    if (S.dm === id) { S.dm = null; S.dmView = null; }
    toast(closedByOther ? 'Убрали из списка' : 'Личка закрыта');
    await Promise.all([loadChats(), loadState()]);
  }),
  'dm-from': (el) => run(async () => { await post('/api/me/profile', { profile: { dmFrom: el.dataset.v } }); await loadMe(); toast('Сохранили'); }),
  'about-ok'() { store.set('aboutSeen', true); S.sheet = null; render(); },
  'crest-open'(el) {
    const ctx = (el && el.dataset.ctx) || 'view';
    let src;
    if (ctx === 'new') { saveGangForm('new'); src = S.gnew; }
    else if (ctx === 'set') { saveGangForm('set'); src = S.gset; }
    else { const g = S.gang.gang; src = { name: g.name, color: g.color, area: g.area, interests: g.interests, crest: g.crest }; }
    const gid = ctx === 'new' ? 0 : S.gang.gang.id;
    const base = { id: gid, name: src.name || 'Банда', color: src.color, area: src.area, interests: src.interests, crest: src.crest };
    S.crestEd = { ctx, gid, base, crest: crestOf(base), mottoText: (ctx !== 'new' && S.gang && S.gang.gang.motto) || src.name || 'Банда', tab: 'shape' };
    S.sheet = 'crest'; render();
  },
  'war-new': () => run(async () => {
    S.warDraft = { to: null, kind: 'blitz', topic: null, hero: null }; S.warMeta = null; S.sheet = 'war-new'; render();
    S.warMeta = await get(`/api/gangwar/rivals?gang=${S.activeGang}`);
  }),
  'war-set': (el) => run(async () => {
    const k = el.dataset.k; const v = ['to', 'hero'].includes(k) ? Number(el.dataset.v) : el.dataset.v;
    S.warDraft[k] = v; sfx('pick');
    if (k === 'to') { S.warDraft.topic = null; S.warMeta = await get(`/api/gangwar/rivals?gang=${S.activeGang}&vs=${v}`); }
  }),
  'war-send': () => run(async () => {
    const d = S.warDraft;
    await post(`/api/gangs/${S.activeGang}/wars`, { to: d.to, kind: d.kind, topic: d.topic, hero: d.hero });
    S.sheet = null; sfx('fanfare'); toast('Вызов брошен! Ждём ответа соперника'); await Promise.all([loadWars(), loadGang()]);
  }),
  'war-accept-open': (el) => run(async () => {
    const w = S.wars.items.find((x) => x.id === Number(el.dataset.id));
    S.warAccept = { id: w.id, kind: w.kind, hero: null }; S.warMeta = null; S.sheet = 'war-accept'; render();
    S.warMeta = await get(`/api/gangwar/rivals?gang=${S.activeGang}`);
  }),
  'war-hero-pick'(el) { S.warDraft.hero = Number(el.dataset.v); sfx('pick'); render(); },
  'war-hero-pick2'(el) { S.warHero.hero = Number(el.dataset.v); sfx('pick'); render(); },
  'war-hero-open': (el) => run(async () => { S.warHero = { id: Number(el.dataset.id), hero: null }; S.warMeta = null; S.sheet = 'war-hero'; render(); S.warMeta = await get(`/api/gangwar/rivals?gang=${S.activeGang}`); }),
  'war-hero-save': () => run(async () => { await post(`/api/wars/${S.warHero.id}/hero`, { hero: S.warHero.hero }); S.sheet = null; toast('Герой назначен — ему придёт пуш'); await loadWars(); }),
  'war-step-down': (el) => run(async () => { if (!confirmInline('war-sd' + el.dataset.id, 'Нажми ещё раз: владелец назначит замену')) return; await post(`/api/wars/${el.dataset.id}/step-down`); toast('Владелец получит пуш'); await loadWars(); }),
  'war-volunteer': (el) => run(async () => { await post(`/api/gangs/${S.activeGang}/volunteer`, { on: el.dataset.v === '1' }); sfx(el.dataset.v === '1' ? 'confirm' : 'off'); toast(el.dataset.v === '1' ? 'Владелец увидит тебя первым|первой' : 'Убрали из добровольцев'); await loadWars(); }),
  'war-bet': (el) => run(async () => { if (!confirmInline('war-bet' + el.dataset.id + el.dataset.v, `Нажми ещё раз: ставка ${el.dataset.v} ${plural(Number(el.dataset.v), 'зерно', 'зерна', 'зёрен')} за свою банду`)) return; await post(`/api/wars/${el.dataset.id}/bet`, { amount: Number(el.dataset.v) }); sfx('coin'); await Promise.all([loadWars(), loadMe()]); }),
  'war-cheer': (el) => run(async () => { await post(`/api/wars/${el.dataset.id}/cheer`); sfx('fanfare'); if (navigator.vibrate && vibroOn()) navigator.vibrate([30, 30, 60]); await loadWars(); }),
  'treasury-open': () => run(async () => { S.sheet = 'treasury'; render(); await loadTreasury(); }),
  'tr-buy': (el) => run(async () => {
    const it = S.tr.items.find((x) => x.id === el.dataset.v);
    if (!confirmInline('tr-buy' + it.id, it.needVote ? `Нажми ещё раз: вынесем «${it.name}» на голосование банды` : `Нажми ещё раз: потратим ${it.price} славы на «${it.name}»`)) return;
    S.tr = await post(`/api/gangs/${S.activeGang}/treasury/buy`, { item: it.id }); sfx(it.needVote ? 'vote' : 'coin');
    toast(it.needVote ? (S.tr.vote ? 'Голосование началось — банда получит пуш' : 'Решено сразу') : 'Куплено и надето'); await loadGang();
  }),
  'tr-vote': (el) => run(async () => { S.tr = await post(`/api/gangs/${S.activeGang}/treasury/vote`, { vote: Number(el.dataset.v) }); sfx('vote'); if (!S.tr.vote) { toast('Голосование решено'); await loadGang(); } }),
  'tr-equip': (el) => run(async () => {
    S.tr = await post(`/api/gangs/${S.activeGang}/treasury/equip`, el.dataset.on === '1' ? { item: el.dataset.v } : { slot: el.dataset.slot });
    sfx(el.dataset.on === '1' ? 'on' : 'off'); await loadGang();
  }),
  'tourney-open': () => run(async () => { S.sheet = 'tourney'; render(); await loadTour(); }),
  'tourney-reg': (el) => run(async () => { S.tour = await post('/api/tourney/register', { off: el.dataset.v === 'off' }); sfx('fanfare'); }),
  'war-acc-hero'(el) { S.warAccept.hero = Number(el.dataset.v); sfx('pick'); render(); },
  'war-accept': () => run(async () => {
    await post(`/api/wars/${S.warAccept.id}/accept`, { hero: S.warAccept.hero });
    S.sheet = null; sfx('fanfare'); toast('Бой принят! У героев — рабочая неделя'); await Promise.all([loadWars(), loadGang()]);
  }),
  'war-decline': (el) => run(async () => {
    if (!confirmInline('war-decline' + el.dataset.id, 'Нажми ещё раз для подтверждения')) return;
    await post(`/api/wars/${el.dataset.id}/decline`); await loadWars();
  }),
  'war-play': (el) => run(async () => {
    S.blitzWar = Number(el.dataset.id); S.blitzFb = null; S.blitzLastTick = null;
    S.blitz = await get(`/api/wars/${S.blitzWar}/play`); S.sheet = 'blitz'; blitzTick();
  }),
  'war-start': () => run(async () => { S.blitz = await post(`/api/wars/${S.blitzWar}/start`); S.blitzFb = null; S.blitzLastTick = null; sfx('fanfare'); blitzTick(); }),
  'war-play-close': () => run(async () => { S.sheet = null; S.blitzWar = null; await Promise.all([loadBlitz(), loadWars()]); }),
  'duel-new': (el) => run(async () => {
    const r = await post('/api/duels', { to: Number(el.dataset.to), game: el.dataset.v, stake: S.duelStake || 0 });
    if (S.duelStake) loadMe().catch(() => {});
    sfx(r.existing ? 'open' : 'fanfare'); toast(r.existing ? 'Эта дуэль уже идёт' : 'Вызов брошен!'); await loadDuels(S.dm);
  }),
  'dm-sea'() { S.dmSea = !S.dmSea; sfx('pick'); render(); },
  'duel-pick'(el) { S.duelGame = el.dataset.v; S.sheet = 'duel-pick'; S.lastSheet = null; render(); },
  'sea-mode'(el) { S.seaMode = el.dataset.v; sfx('pick'); render(); },
  'duel-go': (el) => run(async () => {
    const to = Number(el.dataset.id);
    if (S.duelGame === 'sea') {
      const r = await post('/api/battle', { to, mode: S.seaMode || 'calm', stake: S.duelStake || 0 });
      sfx(r.existing ? 'open' : 'bugle'); toast(r.existing ? 'С ним партия уже идёт — открываем' : 'Вызов отправлен. Расставь флот');
      S.sheet = null; S.tab = 'chats'; S.chatGang = false; S.dm = to; S.battle = r.id; S.bv = null; render();
      await Promise.all([loadBattle(), loadMe()]); window.scrollTo(0, 0);
      return;
    }
    const r = await post('/api/duels', { to, game: S.duelGame, stake: S.duelStake || 0 });
    sfx(r.existing ? 'open' : 'fanfare'); toast(r.existing ? 'Эта дуэль уже идёт — открываем' : 'Вызов брошен!');
    S.sheet = null; S.tab = 'chats'; S.chatGang = false; S.battle = null; S.dm = to; S.dmView = null; render();
    await Promise.all([loadDm(), loadMe()]); window.scrollTo(0, 0);
  }),
  'pr-start'(el) { S.sheet = null; S.tab = 'games'; prNew(el.dataset.v); sfx('open'); render(); window.scrollTo(0, 0); },
  'pr-again'() { prNew(S.practice.game); sfx('open'); render(); window.scrollTo(0, 0); },
  'pr-back'() { S.practice = null; S.bv = null; S.bEmote = null; render(); window.scrollTo(0, 0); },
  'pr-level'(el) {
    const all = store.get('practiceLevel', {}); all[S.practice.game] = el.dataset.v; store.set('practiceLevel', all);
    sfx('pick'); prNew(S.practice.game); toast(`${PR.LEVELS[el.dataset.v]} уровень — новая партия`); render();
  },
  'duel-stake'(el) { S.duelStake = Number(el.dataset.v); sfx('pick'); render(); },
  'duel-rps': (el) => run(async () => {
    if (el.dataset.id === 'bot') { sfx('swish'); PR.duelPlay(S.practice.st, el.dataset.v); prDuelDone(PR.duelView(S.practice.st)); return; }
    sfx('swish'); const d = await post(`/api/duels/${el.dataset.id}/move`, { move: el.dataset.v });
    S.duelAnim = { id: d.id, seq: d.seq, until: Date.now() + 2600 }; S.duelSeqSeen = { ...(S.duelSeqSeen || {}), [d.id]: d.seq }; duelOutcomeSfx(d); await loadDuels(S.dm);
  }),
  'duel-roll': (el) => run(async () => {
    if (el.dataset.id === 'bot') {
      const P = S.practice; S.duelRolling = 'bot'; sfx('dice'); render();
      await new Promise((r) => setTimeout(r, 750));
      S.duelRolling = null; if (S.practice !== P) return;
      PR.duelPlay(P.st); sfx('diceLand'); prDuelDone(PR.duelView(P.st)); return;
    }
    const id = Number(el.dataset.id); S.duelRolling = id; sfx('dice'); render();
    const [d] = await Promise.all([post(`/api/duels/${id}/move`, {}), new Promise((r) => setTimeout(r, 750))]);
    S.duelRolling = null; S.duelAnim = { id: d.id, seq: d.seq, until: Date.now() + 2600 }; S.duelSeqSeen = { ...(S.duelSeqSeen || {}), [d.id]: d.seq }; sfx('diceLand'); duelOutcomeSfx(d); await loadDuels(S.dm);
  }),
  'duel-cell': (el) => run(async () => {
    if (el.dataset.id === 'bot' && S.practice.server) { sfx('marker'); await prMove({ cell: Number(el.dataset.v) }); return; }
    if (el.dataset.id === 'bot') { sfx('marker'); PR.tttMe(S.practice.st, Number(el.dataset.v)); prDuelDone(PR.duelView(S.practice.st)); prTttBot(); return; }
    sfx('marker'); const d = await post(`/api/duels/${el.dataset.id}/move`, { cell: Number(el.dataset.v) });
    S.duelAnim = { id: d.id, seq: d.seq, until: Date.now() + 2600 }; S.duelSeqSeen = { ...(S.duelSeqSeen || {}), [d.id]: d.seq }; duelOutcomeSfx(d); await loadDuels(S.dm);
  }),
  'duel-resign': (el) => run(async () => {
    if (el.dataset.id === 'bot') {
      if (!confirmInline('duel-resign-bot', 'Нажми ещё раз — сдаёшься')) return;
      if (S.practice.server) { await prMove({ resign: true }); sfx('lose'); return; }
      const st = S.practice.st; st.status = 'done'; st.result = 'lose'; st.resigned = true; st.turn = null; st.seq++; prCount('lose'); sfx('lose'); return;
    }
    const soft = el.dataset.soft === '1';
    if (!confirmInline('duel-resign' + el.dataset.id, soft ? 'Нажми ещё раз — откажешься без потерь' : 'Нажми ещё раз — засчитаем поражение')) return;
    await post(`/api/duels/${el.dataset.id}/resign`); sfx(soft ? 'off' : 'lose'); await Promise.all([loadDuels(S.dm), loadMe()]);
  }),
  'cv-vote': (el) => run(async () => {
    const r = await post(`/api/crest-vote/${el.dataset.id}/vote`, { vote: Number(el.dataset.v) });
    S.cv = r; if (r.status === 'accepted') { toast('Большинство за — у банды новый герб!'); await Promise.all([loadMe(), loadGang()]); }
  }),
  'cv-withdraw': (el) => run(async () => { S.cv = await post(`/api/crest-vote/${el.dataset.id}/withdraw`); toast('Сняли с голосования'); }),
  'crest-tab'(el) { S.crestEd.tab = el.dataset.v; render(); },
  'crest-set'(el) { const k = el.dataset.k; S.crestEd.isAuto = false; S.crestEd.crest = { ...S.crestEd.crest, [k]: k === 'motto' ? el.dataset.v === '1' : el.dataset.v }; sfx('pick'); render(); },
  'crest-random'() { S.crestEd.isAuto = false; S.crestEd.crest = randomCrest(S.crestEd.base); sfx('pick'); render(); },
  'crest-auto'() { S.crestEd.isAuto = false; S.crestEd.crest = { ...randomCrest(S.crestEd.base), charge: autoCrest(S.crestEd.base).charge }; sfx('pick'); render(); },
  'crest-reset'() { S.crestEd.crest = autoCrest(S.crestEd.base); S.crestEd.isAuto = true; render(); },
  'crest-save': () => run(async () => {
    const e = S.crestEd;
    const val = e.isAuto ? null : e.crest;
    if (e.ctx === 'new') { S.gnew.crest = val; S.sheet = 'gang-new'; }
    else if (e.ctx === 'set') { S.gset.crest = val; S.sheet = 'gang-settings'; }
    else {
      if (e.isAuto) throw new Error('Собери герб: выбери форму, поле или фигуру — «Авто» на голосование не выносят.');
      const r = await post(`/api/gangs/${e.gid}/crest-vote`, { crest: e.crest });
      S.sheet = null; toast(r.status === 'accepted' ? 'Герб принят — в банде ты один|одна' : 'Герб вынесен на голосование на 48 часов');
      await Promise.all([loadMe(), loadGang(), loadChats()]);
    }
    S.crestEd = null;
  }),
  'league-open': () => run(async () => { S.sheet = 'league'; render(); await loadLeague(); }),
  'league-tab': (el) => run(async () => { S.leagueType = el.dataset.v; render(); await loadLeague(el.dataset.v); }),
  'gang-switch-go': () => run(async () => { const a = S.switchAsk; S.switchAsk = null; S.sheet = null; if (a) await a.go(); }),
  'gang-apply': (el) => run(async () => {
    const c = (S.gfind && S.gfind.items || []).find((x) => x.id === Number(el.dataset.id)) || S.gprofile || {};
    await switchable((sw) => applyGang(Number(el.dataset.id), sw), { request: c.access === 'request' });
  }),

  'gang-apply-cancel': (el) => run(async () => {
    await post(`/api/gangs/${el.dataset.id}/apply/cancel`);
    if (S.gfind && S.gfind.items) S.gfind.items = S.gfind.items.map((c) => (c.id === Number(el.dataset.id) ? { ...c, requested: false } : c));
    if (S.gprofile && S.gprofile.id === Number(el.dataset.id)) S.gprofile = { ...S.gprofile, requested: false };
  }),
  'gs-emoji'(el) { const k = S.sheet === 'gang-settings' ? 'set' : 'new'; saveGangForm(k); const d = k === 'set' ? S.gset : S.gnew; d.emoji = d.emoji === el.dataset.v ? null : el.dataset.v; render(); },
  'gs-color'(el) { saveGangForm('set'); S.gset.color = el.dataset.v; render(); },
  'gs-access'(el) { const k = S.sheet === 'gang-settings' ? 'set' : 'new'; saveGangForm(k); (k === 'set' ? S.gset : S.gnew).access = el.dataset.v; render(); },
  'gs-who'(el) { saveGangForm('set'); S.gset.whoInvites = el.dataset.v; render(); },
  'gs-int'(el) {
    const k = S.sheet === 'gang-settings' ? 'set' : 'new'; saveGangForm(k);
    const d = k === 'set' ? S.gset : S.gnew; const t = el.dataset.v;
    d.interests = d.interests.includes(t) ? d.interests.filter((x) => x !== t) : d.interests.length >= 6 ? d.interests : [...d.interests, t];
    render();
  },
  'gang-settings': () => run(async () => {
    const g = S.gang.gang;
    S.gset = { name: g.name, emoji: g.emoji, crest: g.crest || null, color: g.color, area: g.area, about: g.about, interests: [...(g.interests || [])], access: g.access, whoInvites: g.whoInvites, maxMembers: g.maxSet, office: g.office };
    S.sheet = 'gang-settings';
  }),
  'gs-save': () => run(async () => {
    saveGangForm('set'); const d = S.gset;
    await post(`/api/gangs/${S.gang.gang.id}/settings`, { name: d.name, emoji: d.emoji, crest: d.crest, color: d.color, area: d.area || null, about: d.about, interests: d.interests, access: d.access, whoInvites: d.whoInvites, maxMembers: Number(d.maxMembers) || 0, office: d.office || null });
    S.sheet = null; toast('Настройки сохранены'); await loadMe(); await loadGang();
  }),
  greq: (el) => run(async () => { await post(`/api/gangs/${S.gang.gang.id}/requests/${el.dataset.id}/${el.dataset.v}`); toast(el.dataset.v === 'accept' ? 'Принят в банду' : 'Заявка отклонена'); await loadGang(); await loadState(); }),
  'gm-menu'(el) { const id = Number(el.dataset.id); S.gmMenu = S.gmMenu === id ? null : id; render(); },
  'gm-kick': (el) => run(async () => { if (!confirmInline('gm-kick' + el.dataset.id, 'Нажми ещё раз, чтобы убрать из банды')) return; await post(`/api/gangs/${S.gang.gang.id}/kick/${el.dataset.id}`); S.gmMenu = null; toast('Убран из банды'); await loadGang(); }),
  'gm-owner': (el) => run(async () => { if (!confirmInline('gm-owner' + el.dataset.id, 'Нажми ещё раз — банда перейдёт этому человеку')) return; await post(`/api/gangs/${S.gang.gang.id}/owner/${el.dataset.id}`); S.gmMenu = null; toast('Банда передана'); await loadGang(); }),
  'gang-create': () => run(async () => {
    saveGangForm('new'); const d = S.gnew || {};
    let r;
    await switchable(async (sw) => {
      r = await post('/api/gangs', { name: d.name, area: d.area || null, about: d.about, interests: d.interests, emoji: d.emoji, crest: d.crest || autoCrest({ id: 0, name: d.name || 'Банда', area: d.area, interests: d.interests }), access: d.access, switch: sw });
      if (sw) await afterCreate(r);
    });
    if (r) await afterCreate(r);
  }),
  'gang-join': () => run(async () => joinByCode($('#gang-code').value)),
  'gang-leave': () => run(async () => {
    if (!confirmInline('gang-leave')) return;
    await post(`/api/gangs/${S.activeGang}/leave`);
    S.activeGang = null; await loadMe(); await loadGang();
  }),
  'invite-share': async () => {
    const link = S.gang.gang.link;
    if (!link) return toast('В этой банде зовёт только владелец');
    await shareLink(`Вступай в банду «${S.gang.gang.name}» в Этаже`, link);
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
    toast(r.away ? `Зов отправлен. ${r.away === 1 && c.to ? 'Человек в отпуске' : 'Кто-то в отпуске'} — пуш не придёт, увидит в чате` : r.focus ? `Зов отправлен. ${r.focus === 1 && c.to ? 'Человек' : 'Кто-то'} в фокусе — увидит позже` : r.quiet ? 'Отправлено. Сейчас тихие часы — у кого они включены, пуш не придёт' : 'Зов отправлен');
    await loadGang(); if (inGang()) markSeen('chat');
  }),
  reply: (el) => run(async () => { const r = await post(`/api/messages/${el.dataset.id}/reply`, { label: el.dataset.v }); if (r.beans) toast(`+${r.beans} зерно`); await loadGang(); }),
  'rec-start': (el) => run(async () => {
    if (REC.on) return actions['rec-send']();
    if (!canRecord()) throw new Error('Этот браузер не умеет записывать звук');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { throw new Error('Нет доступа к микрофону. Разреши его в настройках браузера'); }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/aac'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    Object.assign(REC, { on: true, where: el.dataset.v, t0: Date.now(), rec, chunks: [], stream, mime, cancel: false, dm: S.dm, gang: S.activeGang });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) REC.chunks.push(e.data); };
    rec.onstop = () => run(async () => {
      const dur = Math.min(VOICE_MAX, Math.max(1, Math.round((Date.now() - REC.t0) / 1000)));
      const { where, dm, gang, cancel } = REC;
      const blob = new Blob(REC.chunks, { type: (REC.rec && REC.rec.mimeType) || REC.mime || 'audio/webm' });
      Object.assign(REC, { on: false, rec: null, stream: null, chunks: [] });
      render();
      if (cancel) return;
      if ((Date.now() - REC.t0) < 700) throw new Error('Слишком коротко — держи запись хотя бы секунду');
      const audio = await blobB64(blob);
      const body = { type: 'voice', audio, mime: blob.type, dur };
      if (where === 'dm') { await post(`/api/crew/${dm}/messages`, body); pigeon(dm, true); await loadDm(); } else { await post(`/api/gangs/${gang}/messages`, body); await loadGang(); markSeen('chat'); }
      sfx('send');
    });
    rec.start(250);
    REC.timer = setInterval(recTick, 200);
    sfx('on'); render();
  }),
  'rec-send'() { if (REC.on) recStop(false); },
  'rec-cancel'() { if (REC.on) { recStop(true); toast('Запись удалена'); } },
  'voice-play': (el) => run(async () => {
    const token = el.dataset.v;
    if (PLAY.token === token && PLAY.audio) { if (PLAY.audio.paused) PLAY.audio.play(); else PLAY.audio.pause(); return; }
    if (PLAY.audio) { PLAY.audio.pause(); URL.revokeObjectURL(PLAY.url); }
    const mime = el.dataset.mime;
    const probe = document.createElement('audio');
    if (mime && !probe.canPlayType(mime)) throw new Error('Твой браузер не играет этот формат — голосовое записано на другом устройстве');
    const r = await fetch('/api/voice/' + encodeURIComponent(token), { credentials: 'same-origin' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Не получилось загрузить голосовое'); }
    const url = URL.createObjectURL(await r.blob());
    const audio = new Audio(url);
    Object.assign(PLAY, { token, audio, url });
    const ui = () => {
      document.querySelectorAll(`[data-vt="${token}"]`).forEach((box) => {
        const b = box.querySelector('.voice-play'); if (b) b.textContent = audio.paused ? '▶' : '❚❚';
        const i = box.querySelector('.voice-track i'); if (i && audio.duration && isFinite(audio.duration)) i.style.width = (audio.currentTime / audio.duration) * 100 + '%';
        const d = box.querySelector('.voice-d'); if (d && !audio.paused) d.textContent = vmmss(audio.currentTime);
      });
    };
    audio.ontimeupdate = ui; audio.onplay = ui; audio.onpause = ui;
    audio.onended = () => { ui(); document.querySelectorAll(`[data-vt="${token}"] .voice-track i`).forEach((i) => { i.style.width = '100%'; }); PLAY.token = null; };
    await audio.play();
  }),
  'chat-send': () => run(async () => {
    const text = $('#chat-text').value;
    if (!text.trim()) return;
    await post(`/api/gangs/${S.activeGang}/messages`, { type: 'text', text });
    await loadGang(); markSeen('chat');
  }),
  'dm-open': (el) => run(async () => {
    S.tab = 'chats'; S.chatGang = false; S.battle = null; S.sheet = null; S.dm = Number(el.dataset.id); S.dmView = null; S.dmSecret = false; render();
    await Promise.all([loadDm(), S.crew ? null : loadCrew()]);
    if (S.crew) { const f = S.crew.list.find((x) => x.id === S.dm); if (f) f.unread = 0; recountCrewBadge(); }
    window.scrollTo(0, 0);
  }),
  'battle-new': (el) => run(async () => {
    const r = await post('/api/battle', { to: Number(el.dataset.id), mode: el.dataset.mode || 'calm', stake: Number(el.dataset.stake) || 0 });
    if (Number(el.dataset.stake)) loadMe().catch(() => {});
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
    sfx(`emo_${e}`); render(); setTimeout(() => { if (S.battle || S.practice) render(); }, 3300);
    if (prSea()) { if (Math.random() < 0.5) prBotEmote(['lol', 'clap', 'bored', 'easy', 'mercy']); return; }
    post(`/api/battle/${S.battle}/emote`, { e }).catch(() => {});
  },
  bshuffle: () => run(async () => { if (prSea() && S.practice.server) { await prMove({ shuffle: true }); sfx('pick'); return; } if (prSea()) { PR.seaShuffle(S.practice.st); sfx('pick'); setBattleView(PR.seaView(S.practice.st, prScore('sea'))); return; } setBattleView(await post(`/api/battle/${S.battle}/shuffle`)); }),
  bready: () => run(async () => { if (prSea() && S.practice.server) { await prMove({ start: true }); return; } if (prSea()) { PR.seaStart(S.practice.st); setBattleView(PR.seaView(S.practice.st, prScore('sea'))); return; } setBattleView(await post(`/api/battle/${S.battle}/ready`)); }),
  bresign: () => run(async () => {
    const playing = S.bv && S.bv.status === 'play';
    if (!confirmTwice('bresign', playing ? 'Нажми ещё раз, чтобы сдаться' : 'Нажми ещё раз, чтобы отказаться')) return;
    S.bResigned = true;
    if (prSea() && S.practice.server) { await prMove({ resign: true }); sfx('chicken'); return; }
    if (prSea()) { PR.seaResign(S.practice.st); prCount('lose'); setBattleView(PR.seaView(S.practice.st, prScore('sea'))); sfx('chicken'); return; }
    S.bv = await post(`/api/battle/${S.battle}/resign`); S.bvAt = Date.now();
    sfx('chicken');
  }),
  bshoot: (el) => {
    if (prSea() && S.practice.server) {
      const P = S.practice; if (S.bBusy) return; S.bBusy = true;
      run(async () => {
        try {
          const r = await post(`/api/botgame/${P.id}/move`, { x: Number(el.dataset.x), y: Number(el.dataset.y) });
          const v = r.steps[0], mine = v.last && v.last.mine ? v.last.r : 'miss';
          const t = { miss: meG('Промахнулся', 'Промахнулась'), hit: `${meG('Попал', 'Попала')}! Стреляй ещё`, sunk: `${meG('Потопил', 'Потопила')}! Стреляй ещё` }[mine];
          S.bShout = { text: v.status === 'done' ? 'Победа!' : t, cls: v.status === 'done' ? 'sunk' : mine, until: Date.now() + 1400, board: 'o' };
          sfx(v.status === 'done' ? 'sunk' : mine === 'miss' ? 'splash' : mine);
          if (mine === 'sunk' && v.status === 'play' && Math.random() < 0.35) prBotEmote(['oops', 'angry', 'clap']);
          prPlay(P, r);
        } finally { S.bBusy = false; }
      });
      return;
    }
    if (prSea()) {
      const P = S.practice;
      run(async () => {
        const r = PR.seaShoot(P.st, Number(el.dataset.x), Number(el.dataset.y));
        if (P.st.status === 'done') prCount('win');
        setBattleView(PR.seaView(P.st, prScore('sea')));
        const t = { miss: meG('Промахнулся', 'Промахнулась'), hit: `${meG('Попал', 'Попала')}! Стреляй ещё`, sunk: `${meG('Потопил', 'Потопила')}! Стреляй ещё` }[r.result];
        S.bShout = { text: P.st.status === 'done' ? 'Победа!' : t, cls: P.st.status === 'done' ? 'sunk' : r.result, until: Date.now() + 1400, board: 'o' };
        sfx(P.st.status === 'done' ? 'sunk' : r.result === 'miss' ? 'splash' : r.result);
        if (r.result === 'sunk' && P.st.status === 'play' && Math.random() < 0.35) prBotEmote(['oops', 'angry', 'clap']);
        setTimeout(() => { if (S.practice === P) render(); }, 1500);
        prSeaBot();
      });
      return;
    }
    if (S.bBusy) return; S.bBusy = true;

    run(async () => {
      try {
        const r = await post(`/api/battle/${S.battle}/shoot`, { x: Number(el.dataset.x), y: Number(el.dataset.y) });
        setBattleView(r.view);
        const t = { miss: meG('Промахнулся', 'Промахнулась'), hit: `${meG('Попал', 'Попала')}! Стреляй ещё`, sunk: `${meG('Потопил', 'Потопила')}! Стреляй ещё` }[r.result];
        S.bShout = { text: r.view.status === 'done' ? (r.beans ? `Победа! +${r.beans} зёрен` : 'Победа!') : t, cls: r.view.status === 'done' ? 'sunk' : r.result, until: Date.now() + 1400, board: 'o' };
        sfx(r.view.status === 'done' ? 'sunk' : r.result === 'miss' ? 'splash' : r.result);
        if (r.view.status === 'done') { loadMe().catch(() => {}); loadFeatures().catch(() => {}); }
        setTimeout(() => { if (S.battle) render(); }, 1500);
      } finally { S.bBusy = false; }
    });
  },
  'dm-list': () => run(async () => {
    // Повторное нажатие: из переписки — к списку, из списка — туда, откуда пришёл
    if (S.tab === 'chats' && S.dmList && !S.dm) return actions['dmlist-close']();
    if (!(S.tab === 'chats' && (S.dm || S.dmList))) S.dmFrom = S.tab;
    sfx('open'); S.tab = 'chats'; S.dmList = true; S.dm = null; S.dmView = null; S.battle = null; S.bv = null; S.sheet = null; render(); window.scrollTo(0, 0); await refresh();
  }),
  'dmlist-close': () => run(async () => { sfx('close'); S.dmList = false; S.dm = null; S.dmView = null; S.tab = S.dmFrom || 'chats'; S.dmFrom = null; if (S.tab === 'chats') ensureGang(); render(); window.scrollTo(0, 0); await refresh(); }),
  'dm-back': () => run(async () => { S.dm = null; S.dmView = null; S.dmList = true; await Promise.all([loadChats(), loadCrew(), loadState()]); }),
  'chats-back': () => run(async () => { S.chatGang = false; S.dmList = false; ensureGang(); await Promise.all([loadChats(), loadState()]); }),
  'gang-open': (el) => run(async () => {
    S.tab = 'chats'; S.dm = null; S.chatGang = true; S.dmList = false; S.gangTab = 'chat'; S.activeGang = Number(el.dataset.id); store.set('activeGang', S.activeGang);
    const sg = store.get('seenGang', {}); sg[S.activeGang] = Date.now(); store.set('seenGang', sg);
    render(); await Promise.all([loadGang(), loadGangExtra()]); markSeen('chat'); window.scrollTo(0, 0);
    // Гудок банды из Лавки — когда заходишь в чат
    if (S.gang && S.gang.gang.horn) sfx('gangHorn');
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
    let r;
    await switchable(async (sw) => { r = await post(`/api/invites/${el.dataset.id}/accept`, { switch: sw }); if (sw) await afterInvite(r); });
    if (r) await afterInvite(r);
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
    pigeon(S.dm);
    await loadDm();
  }),
  'dm-call-open'(el) {
    const def = S.cat.calls[el.dataset.kind];
    S.compose = { kind: el.dataset.kind, dm: S.dm, opt: def.opts[0] || null, text: '' };
    S.sheet = 'compose'; S.error = ''; render();
  },
  'dm-reply': (el) => run(async () => { await post(`/api/dm/${el.dataset.id}/reply`, { label: el.dataset.v }); await loadDm(); }),
  'find-crew': (el) => run(async () => {
    const r = await post('/api/crew/add', { nick: el.dataset.v });
    toast(r.accepted ? 'Теперь можно переписываться!' : r.already ? 'Вы уже на связи' : 'Заявка в подельники ушла. Ждём ответа');
  }),
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
    toast(r.accepted ? 'Теперь вы подельники!' : 'Заявка в подельники ушла');
    await Promise.all([loadCrew(), S.dm ? loadDm() : null]);
  }),
  'crew-accept': (el) => run(async () => { await post(`/api/crew/${el.dataset.id}/accept`); toast('Теперь вы подельники!'); await Promise.all([loadCrew(), loadChats(), loadState(), S.dm ? loadDm() : null]); }),
  'crew-decline': (el) => run(async () => { await post(`/api/crew/${el.dataset.id}/remove`); await Promise.all([loadCrew(), loadChats(), loadState()]); }),
  'crew-remove': (el) => run(async () => {
    if (!confirmInline('crew-remove', 'Нажми ещё раз: уберём из подельников, переписка удалится у вас обоих')) return;
    await post(`/api/crew/${el.dataset.id}/remove`);
    toast('Больше не подельник'); await Promise.all([loadCrew(), loadChats(), S.dm ? loadDm() : null]);
  }),
  'crew-block': (el) => run(async () => {
    if (!confirmInline('crew-block', 'Нажми ещё раз: он больше не сможет писать и звать тебя')) return;
    await post(`/api/crew/${el.dataset.id}/block`);
    S.dm = null; S.dmView = null; toast('Заблокирован. Он об этом не узнает'); await loadCrew();
  }),
  'crew-unblock': (el) => run(async () => { await post(`/api/crew/${el.dataset.id}/unblock`); await loadCrew(); }),
  'crew-share': async () => {
    store.set('inviteShared', true);
    if (!S.crew) await loadCrew().catch(() => {});
    const link = S.crew && S.crew.link;
    if (!link) return toast('Не получилось получить ссылку. Попробуй ещё раз');
    await shareLink('Залетай в Этаж — видно, кто из своих в офисе, зовы на кофе и обед, морской бой. По этой ссылке мы сразу будем на связи', link);
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
    if (S.sheet === 'style') await run(async () => { S.style = await get('/api/me/style'); });
    if (S.sheet === 'battery') { S.bt = { step: 0, answers: [] }; await run(async () => { S.battery = await get('/api/battery'); }); }
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
  'vac-tell': () => run(async () => {
    const v = S.state.nextVacation; const gid = S.me.gangs[0].id;
    const range = `${ddmm(v.from)}${v.to !== v.from ? `–${ddmm(v.to)}` : ''}`;
    const text = `Ухожу в отпуск ${range}, выхожу ${v.backDow.toLowerCase()} ${ddmm(v.back)}. Если что-то срочное — ловите до ${ddmm(v.lastWork)}`;
    await post(`/api/gangs/${gid}/messages`, { type: 'text', text });
    store.set('vacAnn:' + v.from, 1); toast('Написал|Написала в чат банды'); sfx('confirm'); render();
  }),
  'vac-party': () => run(async () => {
    const v = S.state.nextVacation;
    S.activeGang = S.me.gangs[0].id; await loadGEvents();
    S.gevDraft = { kind: 'party', title: 'Проводы в отпуск', day: v.lastWork, time: '18:00', place: '', note: `Ухожу ${ddmm(v.from)}, выхожу ${ddmm(v.back)}` };
    S.sheet = 'gev-new'; S.error = ''; render();
  }),
  'gev-new'(el) {
    const x = el && el.dataset.sug !== undefined && S.gev ? S.gev.suggestions[Number(el.dataset.sug)] : null;
    S.gevDraft = { kind: x ? x.kind : 'meet', title: x ? x.title : '', day: x ? x.day : '', time: '', place: '', note: '', guest: '' };
    S.sheet = 'gev-new'; S.error = ''; render();
    if (!S.gevGuests && S.activeGang) get(`/api/gangs/${S.activeGang}/gevent-guests`).then((r) => { S.gevGuests = r.items; if (S.sheet === 'gev-new') { gevSync(); render(); } }).catch(() => {});
  },
  'gev-edit'(el) {
    const e = S.gev && S.gev.upcoming.find((x) => x.id === Number(el.dataset.id));
    if (!e) return;
    S.gevDraft = { editId: e.id, kind: e.kind, title: e.title, day: e.day, time: e.time || '', place: e.place || '', note: e.note || '' };
    S.sheet = 'gev-new'; S.error = ''; render();
  },
  'gev-kind'(el) { gevSync(); S.gevDraft.kind = el.dataset.v; render(); },
  'gev-save': () => run(async () => {
    gevSync();
    const d = S.gevDraft;
    if (d.editId) {
      const r = await post(`/api/gevents/${d.editId}/edit`, d);
      S.sheet = null; S.gevDraft = null; toast(r.notified ? 'Сохранено — кто идёт, получит пуш' : 'Сохранено'); sfx('confirm');
      await Promise.all([loadGEvents(), loadGang()]);
      return;
    }
    await post(`/api/gangs/${S.activeGang}/gevents`, d);
    S.sheet = null; S.gevDraft = null; toast('Событие создано — банда получит пуш'); sfx('confirm');
    await Promise.all([loadGEvents(), loadGang()]);
  }),
  'gev-rsvp': (el) => run(async () => {
    const r = await post(`/api/gevents/${el.dataset.id}/rsvp`, { answer: el.dataset.v });
    S.gev.upcoming = S.gev.upcoming.map((e) => (e.id === r.event.id ? r.event : e));
  }),
  'gev-cancel': (el) => run(async () => {
    if (!confirmInline('gev-cancel' + el.dataset.id, 'Нажми ещё раз: событие отменится, кто собирался — получит пуш')) return;
    await post(`/api/gevents/${el.dataset.id}/cancel`); toast('Событие отменено'); await Promise.all([loadGEvents(), loadGang()]);
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
  'inbox-open': () => run(async () => { S.sheet = 'inbox'; S.lastSheet = null; render(); await loadInbox(); markInboxSeen(); }),
  async 'inbox-go'(el) {
    let g = {};
    try { g = JSON.parse(el.dataset.go || '{}'); } catch {}
    S.sheet = null;
    const fake = { dataset: { v: g.v, id: g.id, opp: g.opp, nick: g.nick }, classList: { contains: () => false } };
    if (g.act === 'tab') { S.tab = g.v; S.chatGang = false; S.dmList = false; S.dm = null; S.battle = null; render(); await run(() => refresh()); }
    else if (actions[g.act]) await actions[g.act](fake);
    if (g.to) requestAnimationFrame(() => setTimeout(() => { const t = findInGangTabs(g.to); if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 150));
  },
  'match-toggle': (el) => run(async () => { await post('/api/me/profile', { profile: { matchShow: el.checked } }); await Promise.all([loadMe(), loadMatch()]); toast(el.checked ? 'Твои дни видны в «Совпадаем»' : 'Твои дни скрыты — и чужие тоже'); }),
  'push-nudge-hide'() { try { store.set('pushNudgeHidden', Date.now() + 7 * 864e5); } catch {} render(); },
  'gang-reqs': (el) => run(async () => {
    await actions['gang-open'](el);
    S.gangTab = 'crew'; render();
    setTimeout(() => { const c = findInGangTabs('.g-req'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 80);
  }),
  'chats-jump'(el) { const t = document.querySelector(el.dataset.v); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600); } },
  'g-help'() { S.gHelp = !S.gHelp; render(); },
  'weeknote-hide'(el) { try { store.set('weekNoteHidden', el.dataset.v); } catch {} render(); },
  'autosign-toggle': (el) => run(async () => { await post('/api/me/profile', { profile: { autoSign: el.checked } }); await loadMe(); toast(el.checked ? 'Аватар сам покажет табличку, когда ты в фокусе или уже бежишь' : 'Таблички сами больше не появятся'); }, { rerender: true }),
  'monday-toggle': (el) => run(async () => { await post('/api/me/profile', { profile: { monday: el.checked } }); await loadMe(); toast(el.checked ? 'В понедельник пришлю, что у банды на неделе' : 'Понедельничную сводку больше не пришлю'); }),
  'focus-set': (el) => run(async () => {
    await post('/api/me/profile', { profile: { focus: el.dataset.v === 'eod' ? 'eod' : Number(el.dataset.v) } });
    S.sheet = null; await loadMe();
    toast(`В фокусе до ${hhmm(S.me.profile.focus)}. Пуши подождут`);
  }),
  'focus-off': () => run(async () => { await post('/api/me/profile', { profile: { focus: null } }); await loadMe(); toast('Снова на связи'); }),
  'tpl-edit'() { S.tplEdit = !S.tplEdit; render(); },
  'tpl-save': () => run(async () => {
    saveComposeText();
    const c = S.compose;
    if (c.dm) throw new Error('Шаблоны — для зовов банде');
    const list = (S.me.profile.callTpl || []).slice();
    if (list.length >= 4) throw new Error('Не больше четырёх шаблонов. Удали лишний: «изменить» под быстрыми зовами');
    const r = await post('/api/me/profile', { profile: { callTpl: [...list, { kind: c.kind, gang: c.gang, opt: c.opt, text: c.text, to: c.to }] } });
    void r; await loadMe();
    toast(S.me.profile.callTpl.length > list.length ? 'Шаблон сохранён — он под быстрыми зовами на «Рядом»' : 'Такой шаблон уже есть');
  }),
  'tpl-del': (el) => run(async () => {
    const list = (S.me.profile.callTpl || []).slice();
    list.splice(Number(el.dataset.i), 1);
    await post('/api/me/profile', { profile: { callTpl: list } });
    await loadMe(); if (!list.length) S.tplEdit = false;
  }),
  'tpl-send'(el) {
    const t = (S.me.profile.callTpl || [])[Number(el.dataset.i)];
    if (!t) return;
    // Отправка в один тап, но с паузой на «Отменить» — чтобы случайное касание никого не дёрнуло
    undoBar(`Зов «${tplLabel(t)}» уйдёт через`, () => run(async () => {
      const r = await post(`/api/gangs/${t.gang}/messages`, { type: 'call', kind: t.kind, to: t.to, opt: t.opt, text: t.text || '' });
      toast(r.focus ? 'Зов отправлен. Кто-то в фокусе — увидит позже' : r.away ? 'Зов отправлен. Кто-то в отпуске — пуш не придёт' : r.quiet ? 'Отправлено. Сейчас тихие часы — пуш может не прийти' : 'Зов отправлен');
      if (S.gang && S.gang.gang.id === t.gang) await loadGang();
    }));
  },
  'weather-hide'(el) { try { store.set('weatherHidden', el.dataset.v); } catch {} render(); },
  'weather-toggle': (el) => run(async () => { await post('/api/me/profile', { profile: { weather: el.checked } }); await loadMe(); toast(el.checked ? 'Напомню про погоду накануне офиса' : 'Про погоду больше не пишу'); }),
  'digest-toggle': (el) => run(async () => { await post('/api/me/profile', { profile: { digest: el.checked } }); await loadMe(); toast(el.checked ? 'Утренняя сводка включена' : 'Утреннюю сводку больше не пришлю'); }),
  'match-on': () => run(async () => { await post('/api/me/profile', { profile: { matchShow: true } }); await Promise.all([loadMe(), loadMatch()]); toast('Твои дни открыты коллегам'); }),
  'match-day'(el) { S.matchDay = Number(el.dataset.v); render(); },
  'board-filter'(el) { S.boardScope = el.dataset.v; S.boardAll = false; render(); },
  'board-cat'(el) { S.boardCat = el.dataset.v; S.boardAll = false; render(); },
  'board-time'(el) { boardSync(); S.boardDraft.time = el.dataset.v; render(); },
  'board-all'() { S.boardAll = true; render(); },
  'lunch-all'() { S.lunchAll = true; render(); },
  'board-new'(el) {
    const t = new Date(Date.now() + 3 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);
    const home = S.me.profile && S.me.profile.home, gid = ((S.me.gangs || [])[0] || {}).id || null;
    const kind = (el && el.dataset && el.dataset.v) || 'other';
    const ci = S.state && S.state.checkin && S.state.checkin.office;
    // Угощение на кухне имеет смысл только в своём офисе — туда и ставим по умолчанию
    S.boardDraft = { kind, text: '', until: t, place: '', time: '', gang: S.boardScope === 'gang' ? gid : null, office: S.boardScope === 'gang' ? '' : kind === 'kitchen' ? (ci || home || '') : S.boardScope === 'office' ? home || '' : '' };
    S.sheet = 'board-new'; S.error = ''; render(); loadBoard().then(() => { if (S.sheet === 'board-new') render(); });
  },
  'board-kind'(el) { boardSync(); S.boardDraft.kind = el.dataset.v; if (el.dataset.v === 'kitchen' && !S.boardDraft.office && !S.boardDraft.gang) S.boardDraft.office = (S.state && S.state.checkin && S.state.checkin.office) || (S.me.profile && S.me.profile.home) || ''; render(); },
  'board-office'(el) { boardSync(); const g = el.dataset.v === 'gang'; S.boardDraft.gang = g ? ((S.me.gangs || [])[0] || {}).id || null : null; S.boardDraft.office = g ? '' : el.dataset.v; render(); },
  'board-save': () => run(async () => {
    boardSync();
    await post('/api/board', S.boardDraft);
    const k = S.boardDraft.kind; S.sheet = null; S.boardDraft = null; toast(k === 'lunch' ? meG('Позвал на обед — кто пойдёт, придёт пуш', 'Позвала на обед — кто пойдёт, придёт пуш') : 'Объявление на доске'); sfx('confirm'); if (k === 'kitchen') S.boardCat = 'kitchen'; await loadBoard();
  }),
  'board-metoo': (el) => run(async () => {
    const r = await post(`/api/board/${el.dataset.id}/metoo`);
    S.board.items = S.board.items.map((x) => (x.id === r.item.id ? r.item : x));
    if (r.item.iMetoo) toast(r.item.kind === 'lunch' ? `Ты в компании на ${r.item.time}` : r.item.kind === 'kitchen' ? 'Автор узнает, что ты сказал спасибо' : 'Автор узнает. Можно сразу написать ему');
  }),
  'board-remove': (el) => run(async () => {
    if (!confirmInline('board-rm' + el.dataset.id, 'Нажми ещё раз — объявление исчезнет')) return;
    await post(`/api/board/${el.dataset.id}/remove`); toast('Снято'); await loadBoard();
  }),
  'secret-open': (el) => run(async () => { S.tab = 'chats'; S.chatGang = false; S.battle = null; S.sheet = null; S.dm = Number(el.dataset.id); S.dmSecret = true; S.dmView = null; render(); await Promise.all([loadDm(), loadSecret()]); window.scrollTo(0, 0); }),
  'dm-mode': (el) => run(async () => { S.dmSecret = el.dataset.v === 'secret'; render(); if (S.dmSecret) { await loadSecret(); render(); const c = $('#sc-chat'); if (c) c.scrollTop = c.scrollHeight; } }),
  'secret-send': () => run(async () => {
    const el = $('#sc-text'); const text = (el.value || '').trim();
    if (!text) return;
    const x = S.secret, my = await E2E.mine(S.me.id);
    const [lo, hi] = S.me.id < S.dm ? [S.me.id, S.dm] : [S.dm, S.me.id];
    const m = await E2E.encrypt(my, x.theirs, lo, hi, text);
    await post(`/api/secret/${S.dm}`, m);
    el.value = ''; sfx('send');
    await loadSecret(); render(); const c = $('#sc-chat'); if (c) c.scrollTop = c.scrollHeight;
  }),
  'secret-adopt': () => run(async () => {
    if (!confirmInline('secret-adopt', 'Нажми ещё раз: на прежнем устройстве секретные чаты перестанут открываться')) return;
    const my = await E2E.mine(S.me.id); await post('/api/e2e/key', { pub: my.pub }); await loadSecret(); toast('Это устройство теперь основное для секретных чатов');
  }),
  'secret-invite': () => run(async () => {
    await post(`/api/crew/${S.dm}/messages`, { type: 'text', text: 'Открой со мной секретный чат — вкладка «Секретный» в нашей переписке. Его не прочитает даже сервер.' });
    toast('Позвали — ответ придёт в обычную личку');
  }),
  'ex-find': () => run(async () => { await loadExperts(($('#ex-q') || {}).value || ''); }),
  'ex-tag': (el) => run(async () => { await loadExperts(el.dataset.v); }),
  'friday-send': (el) => run(async () => {
    const inp = $('#fr-' + el.dataset.q); const text = inp ? inp.value : '';
    const wasDone = S.friday && S.friday.done;
    const r = await post(`/api/gangs/${S.activeGang}/friday`, { q: el.dataset.q, text });
    S.friday = r; S.fridayEdit = null; sfx('send');
    if (r.done && !wasDone) { S.fridayOpen = false; const m = store.get('frSeen', {}) || {}; m[frSeenKey(r)] = r.othersCount; store.set('frSeen', m); if (!r.beans) toast('Пятиминутка сдана — свернули, чтобы не мешала'); }
    if (r.beans) { toast(`+${r.beans} зерна за пятиминутку`); loadMe().catch(() => {}); }
  }),
  'friday-edit'(el) { S.fridayEdit = el.dataset.q; render(); requestAnimationFrame(() => { const i = $('#fr-' + el.dataset.q); if (i) i.focus(); }); },
  'friday-react': (el) => run(async () => { S.friday = await post(`/api/friday/${el.dataset.id}/react`, { e: el.dataset.v }); }),
  'quest-open'(el) { S.questOpen = S.questOpen === el.dataset.v ? null : el.dataset.v; render(); },
  'quest-swap': () => run(async () => { await post('/api/quests/dmnew/swap', {}); await loadFeatures(); toast('Другой человек — тоже свой'); }),
  'quest-go'(el) {
    const go = el.dataset.v, to = el.dataset.to;
    if (go === 'battery') { S.questOpen = null; return actions.open({ dataset: { v: 'battery' } }); }
    if (go === 'look') { S.questOpen = null; return actions['ava-open'](); }
    if (to) setTimeout(() => { const t = findInGangTabs(to); if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 700);
    const qAnchor = { guess: '.guess', quiz: '.quiz', sea: '.duels-card', wguess: '.guess', wquiz: '.quiz', blitz: '.blitz' }[el.dataset.q];
    S.questOpen = null;
    if (qAnchor && go === 'games') { render(); requestAnimationFrame(() => { const t = document.querySelector(qAnchor); if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); return; }
    S.sheet = null;
    const firstGang = S.activeGang || (S.me.gangs[0] || {}).id;
    if (go === 'near') { S.tab = 'near'; tabSound('near'); }
    else if (go === 'office') { S.tab = 'office'; tabSound('office'); }
    else if (go === 'games') { S.tab = 'games'; tabSound('games'); }
    else if (go === 'gang' && firstGang) { S.tab = 'chats'; S.chatGang = true; S.dmList = false; S.dm = null; S.activeGang = firstGang; store.set('activeGang', firstGang); }
    else if (go === 'dm') { S.tab = 'chats'; S.dm = null; S.chatGang = false; S.dmList = true; return actions.open({ dataset: { v: 'dm-pick' } }); }
    else S.tab = 'chats';
    window.scrollTo(0, 0);
    run(() => refresh());
  },
  'blitz-start': () => run(async () => {
    S.blitzWar = null; S.blitzOver = false; S.blitzBusy = false;
    S.blitz = await post('/api/blitz/start'); S.blitzFb = null; S.blitzLastTick = null;
    S.sheet = 'blitz'; blitzTick();
  }),
  'blitz-open': () => run(async () => { S.blitzWar = null; S.blitzBusy = false; await loadBlitz(); S.blitzFb = null; S.sheet = 'blitz'; blitzTick(); }),
  'blitz-pick': (el) => {
    if (S.blitzBusy || S.blitzOver) return;
    S.blitzBusy = true;
    const n = Number(el.dataset.n), pick = Number(el.dataset.v);
    run(async () => {
      try {
        const r = await post(S.blitzWar ? `/api/wars/${S.blitzWar}/answer` : '/api/blitz/answer', { n, pick });
        if (r.result) {
          S.blitzFb = { n, pick, right: r.result.right };
          S.blitzStreak = r.result.correct ? (S.blitzStreak || 0) + 1 : 0;
          sfx(r.result.correct ? 'right' : 'wrong');
          render();
          await new Promise((res) => setTimeout(res, r.result.correct ? 380 : 750));
        }
        const left = S.blitzEnd ? S.blitzEnd - Date.now() : r.leftMs;
        S.blitz = r; if (r.state === 'play') S.blitz.leftMs = left;
        S.blitzFb = null;
        if (r.state === 'done') { clearInterval(blitzTimer); sfx(r.score >= 10 ? 'fanfare' : 'confirm'); loadMe().catch(() => {}); if (S.blitzWar) loadWars().catch(() => {}); else loadFeatures().catch(() => {}); }
      } finally { S.blitzBusy = false; }
    });
  },
  'splash-skip'() { if (S.splashDone) { sfx('lift'); S.splashDone(); } },
  close() { S.sheet = null; S.error = ''; render(); },
  'close-bg'(el, e) { if (e.target === el) actions.close(); },
  'b-mine-big'() { S.bMineBig = !S.bMineBig; sfx('pick'); render(); if (S.bMineBig) setTimeout(() => { const m = document.querySelector('.b-sea.mine'); if (m) m.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50); },
  'shop-gang'(el) { S.shopGang = Number(el.dataset.v); render(); },
  'shop-tab'(el) { S.shopTab = el.dataset.v; S.shopTry = null; sfx('pick'); render(); const b = document.querySelector('.shop-tabs'); if (b) b.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
  'shop-try'(el) { S.shopTry = S.shopTry === el.dataset.v ? null : el.dataset.v; sfx('pick'); render(); const t = document.querySelector('.shop-try'); if (t && S.shopTry) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
  'shop-own'(el, ev) { if (ev) ev.preventDefault(); S.shopOwnOpen = !S.shopOwnOpen; render(); },
  // Переход к вещи из «По карману» и «Только сейчас»: открыть её вкладку и подсветить
  'shop-go'(el) {
    const it = S.shop.items.find((x) => x.id === el.dataset.v); if (!it) return;
    S.shopTab = shopTabOf(it); if (it.kind === 'part') S.shopTry = it.id;
    render();
    const n = document.querySelector(it.kind === 'part' ? '.shop-try' : `.shop-body [data-item="${it.id}"]`);
    if (n) { n.scrollIntoView({ block: 'center', behavior: 'smooth' }); n.classList.add('flash'); setTimeout(() => n.classList.remove('flash'), 1600); }
  },
  'shop-listen'(el, ev) { if (ev) ev.stopPropagation(); sfx(el.dataset.v); },
  'gift-open': (el) => run(async () => {
    S.giftItem = el.dataset.v; S.giftMode = (S.shop.items.find((x) => x.id === el.dataset.v) || {}).kind === 'prank' ? 'prank' : 'gift';
    S.sheet = 'gift-pick'; render();
    S.chats = await get('/api/chats');
  }),
  'gift-send': (el) => run(async () => {
    const prank = S.giftMode === 'prank';
    await post(prank ? '/api/shop/prank' : '/api/shop/gift', { item: S.giftItem, to: Number(el.dataset.id) });
    sfx(prank ? 'swish' : 'coin');
    toast(prank ? 'Готово! Подлянка висит час' : 'Подарок отправлен — открытка ушла в личку');
    S.sheet = 'shop'; await loadMe(); S.shop = await get('/api/shop');
  }),
  'prank-off': () => run(async () => { await post('/api/me/prank/off'); toast('Чисто!'); await loadMe(); if (S.sheet === 'shop') S.shop = await get('/api/shop'); }),
  'pranks-allow': (el) => run(async () => { const on = el.dataset.v === '1'; await post('/api/me/pranks', { allow: on }); await loadMe(); toast(on ? 'Подельники могут тебя разыгрывать' : 'Подлянки выключены'); }),
  'pizza-take': () => run(async () => {
    const r = await post(`/api/gangs/${S.gang.gang.id}/pizza/take`);
    sfx('coin'); toast(r.beans ? `Вкусно! +${r.beans} зерно` : 'Кусок твой!'); await Promise.all([loadGang(), loadMe()]);
  }),
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
    const gang = el && el.dataset.gang ? Number(el.dataset.gang) : null;
    const scenes = memeScenes(!!gang);
    const prev = S.meme && scenes.find((x) => x.id === S.meme.scene);
    S.meme = { scene: prev ? prev.id : scenes[0].id, emo: (S.meme && S.meme.emo) || 'calm', to: el && el.dataset.to ? Number(el.dataset.to) : null, gang };
    S.sheet = 'meme'; S.lastSheet = null; render();
    if (!S.people) loadPeople().then(render).catch(() => {});
  },
  'meme-scene'(el) { S.meme.scene = el.dataset.v; render(); },
  'meme-emo'(el) { S.meme.emo = el.dataset.v; render(); },
  'meme-to'(el) { const v = Number(el.dataset.v); S.meme.to = S.meme.to === v ? null : v; render(); },
  'meme-send': () => run(async () => {
    const to = S.meme.to;
    await post(`/api/crew/${to}/messages`, { type: 'meme', kind: S.meme.scene, opt: S.meme.emo });
    pigeon(to, true); S.sheet = null; toast('Голубь унёс мем');
    if (S.tab === 'chats' && S.dm === to) await loadDm();
  }),
  'meme-send-gang': () => run(async () => {
    const gid = S.meme.gang;
    await post(`/api/gangs/${gid}/messages`, { type: 'meme', kind: S.meme.scene, opt: S.meme.emo });
    S.sheet = null; sfx('send'); toast('Открытка в чате банды');
    if (S.activeGang === gid) await loadGang();
  }),
  'santa-join': () => run(async () => { S.santa = await post(`/api/gangs/${S.activeGang}/santa/join`, { wish: ($('#santa-wish') || {}).value || '' }); S.santaEdit = false; toast('Ты в Тайном Санте'); }),
  'santa-wish': () => run(async () => { S.santa = await post(`/api/gangs/${S.activeGang}/santa/wish`, { wish: ($('#santa-wish') || {}).value || '' }); S.santaEdit = false; toast('Пожелание сохранено'); }),
  'santa-edit'() { S.santaEdit = !S.santaEdit; render(); if (S.santaEdit) requestAnimationFrame(() => { const t = $('#santa-wish'); if (t) t.focus(); }); },
  'santa-leave': (el) => run(async () => {
    if (!confirmInline('santa-leave', 'Нажми ещё раз, чтобы выйти из Тайного Санты')) return;
    S.santa = await post(`/api/gangs/${S.activeGang}/santa/leave`); toast('Ты вышел|вышла из Тайного Санты');
  }),
  'santa-draw': () => run(async () => {
    if (!confirmInline('santa-draw', `Нажми ещё раз: жеребьёвка на ${S.santa.count} человек, потом записаться будет нельзя`)) return;
    S.santa = await post(`/api/gangs/${S.activeGang}/santa/draw`); toast('Жеребьёвка прошла'); await loadGang();
  }),
  'santa-gifted': () => run(async () => { S.santa = await post(`/api/gangs/${S.activeGang}/santa/gifted`); toast('Отмечено. Хорошего праздника!'); }),
  'advent-open': () => run(async () => {
    const r = await post('/api/advent/open');
    S.advent = r;
    if (r.prize) toast('Гирлянда твоя! Надень её в конструкторе аватара');
    else toast(r.beans ? `Окошко открыто · +${r.beans} зерна` : 'Окошко открыто');
    if (r.beans) await loadMe();
  }),
  'meme-share': () => run(async () => {
    let href = '';
    if (AVA3D) {
      const e = (S.cat.memeEmos || {})[S.meme.emo] || {};
      const res = await fetch(avaSrc({ ...S.me.look, mouth: e.mouth || S.me.look.mouth, eyeShape: e.eyeShape || S.me.look.eyeShape }, 400));
      if (!res.ok) throw new Error('Не получилось собрать картинку. Попробуй ещё раз.');
      const blob = await res.blob();
      href = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(blob); });
    }
    const svg = memeSvg(S.me.look, S.meme.scene, S.meme.emo, 720, true, href);
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
  'ava-toggle'(el) { const k = el.dataset.k; const cur = S.draft[k] ?? (k === 'lashes' && S.draft.preset === 'f'); S.draft = { ...S.draft, [k]: !cur }; render(); },
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
    if (el.dataset.v === 'slack') toast('Признание засчитано ');
    if (el.dataset.v === 'home') { if (r.streak) showStreak(r); else toast('Отмечено: сегодня из дома'); loadFeatures().then(render).catch(() => {}); }
  }),
  'plan-day': (el) => run(async () => {
    const plan = { ...S.me.profile.plan };
    const cur = plan[el.dataset.v];
    if (!cur) plan[el.dataset.v] = 'office'; else if (cur === 'office') plan[el.dataset.v] = 'home'; else delete plan[el.dataset.v];
    const r = await post('/api/me/profile', { profile: { plan } }); await loadMe();
    if (r.planBeans) toast(`План недели готов · +${r.planBeans} зёрен. Банда видит твои офисные дни`);
  }),
  'sick-now': () => run(async () => {
    await post('/api/me/profile', { profile: { today: { kind: 'sick', to: $('#sick-until').value || S.state.today } } });
    S.sheet = null; await loadMe(); await loadState(); toast('Выздоравливай! Зовы не будут беспокоить');
  }),
  'thx-pick'() { S.thxPick = !S.thxPick; if (!S.thxPick) S.thanksTo = null; render(); },
  'thx-all'() { S.thxAll = !S.thxAll; render(); },
  'mem-menu'(el) { const id = Number(el.dataset.id); S.memMenu = S.memMenu === id ? null : id; render(); },
  'members-all'() { S.membersAll = !S.membersAll; render(); },
  'thanks-to'(el) { S.thanksTo = Number(el.dataset.v); render(); },
  'thanks-send': () => run(async () => {
    const r = await post('/api/thanks', { gang: S.activeGang, to: S.thanksTo, text: ($('#thanks-text') || {}).value || '' });
    S.thanksTo = null; S.thxPick = false; toast(`Спасибо отправлено. Осталось ${r.left} на сегодня`);
    await Promise.all([loadGangExtra(), loadMe()]);
  }),
  gift: (el) => run(async () => { await post('/api/gift', { to: Number(el.dataset.id) }); toast('Поздравление отправлено'); await Promise.all([loadMe(), loadFeatures(), loadGangExtra()]); }),
  'lunch-time'(el) { S.lunchTime = el.dataset.v; const pl = $('#lunch-place'); const v = pl ? pl.value : ''; render(); if ($('#lunch-place')) $('#lunch-place').value = v; },
  'lunch-create': () => run(async () => { await post('/api/lunch', { time: S.lunchTime, place: $('#lunch-place').value }); S.sheet = null; toast('Сбор открыт'); await loadFeatures(); }),
  'lunch-join': (el) => run(async () => { await post(`/api/lunch/${el.dataset.id}/join`); toast('Приятного аппетита!'); await loadFeatures(); }),
  'lunch-leave': (el) => run(async () => { await post(`/api/lunch/${el.dataset.id}/leave`); await loadFeatures(); }),
  'lunch-cancel': (el) => run(async () => { await post(`/api/lunch/${el.dataset.id}/cancel`); await loadFeatures(); }),
  'coffee-off': () => run(async () => {
    if (!confirmInline('coffee-off', 'Нажми ещё раз — больше не будем подбирать пару')) return;
    await post('/api/me/profile', { profile: { coffee: false } }); toast('Случайный кофе выключен'); await Promise.all([loadMe(), loadFeatures()]);
  }),
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
    S.quizFresh = { id: r.quiz.id, until: Date.now() + 2500 };
    sfx(r.quiz.pick === r.quiz.correct ? 'right' : 'wrong');
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
  'theme-set'(el) { store.set('theme', el.dataset.v); if (window.etazhTheme) window.etazhTheme.apply(); render(); },
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
  'name-save': () => run(async () => {
    const f = nameCase($('#p-first').value), l = nameCase($('#p-last').value);
    if (!f || !l) throw new Error('Имя и фамилия обязательны.');
    await post('/api/me/profile', { profile: { firstName: f, lastName: l } }); await loadMe(); toast('Сохранено');
  }),
  'name-step-save': () => run(async () => {
    const f = nameCase($('#n-first').value), l = nameCase($('#n-last').value);
    if (!f || !l) { S.error = 'Нужны и имя, и фамилия.'; return; }
    S.error = '';
    await post('/api/me/profile', { profile: { firstName: f, lastName: l } });
    await loadMe(); S.nameDraft = null; toast(`Приятно познакомиться, ${f}!`); sfx('confirm');
    try { await refresh({ all: true }); } catch {}
  }),
  'nick-change'() {
    const nick = $('#p-nick').value.trim().replace(/^@+/, '');
    if (nick.toLowerCase() === S.me.nick.toLowerCase()) { S.error = 'Впиши новый никнейм'; render(); return; }
    if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]{3,14}$/.test(nick)) { S.error = 'От 3 до 14 символов: буквы, цифры и «_», без пробелов.'; render(); return; }
    S.error = null; S.nickConfirm = nick; render();
  },
  'nick-no'() { S.nickConfirm = null; render(); },
  'nick-yes': () => run(async () => {
    const nick = S.nickConfirm; S.nickConfirm = null;
    const r = await post('/api/me/nick', { nick }); await loadMe(); toast(`Теперь ты ${r.nick}`);
  }),
  'gang-tab'(el) { S.gangTab = el.dataset.v; render(); const h = document.querySelector('.g-head'); if (h) h.scrollIntoView({ block: 'start' }); },
  'gang-go'(el) { S.gangTab = el.dataset.v; render(); setTimeout(() => { const c = findInGangTabs(el.dataset.to); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60); },
  'friday-open'() { const f = S.friday; if (f) { const m = store.get('frSeen', {}) || {}; m[frSeenKey(f)] = f.othersCount; store.set('frSeen', m); } S.fridayOpen = true; render(); },
  'friday-close'() { S.fridayOpen = false; S.fridayEdit = null; render(); },
  'friday-poke': () => run(async () => {
    const r = await post(`/api/gangs/${S.activeGang}/friday/poke`, {});
    S.friday = r; render();
    toast(r.sent ? `Пнули ${r.sent} ${plural(r.sent, 'человека', 'человек', 'человек')}. Ждём их строчки` : 'Пинать некого — все молодцы или без уведомлений');
  }),
  'todo-add-open'() { S.todoAdd = false; S.todoWhen = 'today'; S.todoPerson = null; S.todoTime = ''; S.todoDraft = ''; S.tab = 'near'; render(); setTimeout(() => { const i = $('#todo-text'); if (i) { i.scrollIntoView({ block: 'center', behavior: 'smooth' }); i.focus(); } }, 80); },
  'todo-more'() { const i = $('#todo-text'); S.todoDraft = i ? i.value : ''; S.todoAdd = !S.todoAdd; render(); setTimeout(() => { const j = $('#todo-text'); if (j) j.focus(); }, 30); },
  'todo-tm'(el) { const i = $('#todo-text'); S.todoDraft = i ? i.value : ''; S.todoTime = el.dataset.v; render(); },
  'todo-done-toggle'() { S.todoDoneOpen = !S.todoDoneOpen; },
  'todo-today': (el) => run(async () => { S.todos = await post(`/api/todos/${el.dataset.id}/move`, { when: 'today' }); render(); toast('Перенесено на сегодня'); }),
  // Из карточки человека: «В дела» — строка с его именем уже заполнена
  'todo-for'(el) {
    S.sheet = null; S.tab = 'near'; S.todoAdd = true; S.todoWhen = 'today'; S.todoTime = '';
    S.todoPerson = Number(el.dataset.id); S.todoPersonObj = { id: S.todoPerson, nick: el.dataset.nick, look: {} };
    S.todoDraft = ''; render(); setTimeout(() => { const i = $('#todo-text'); if (i) { i.scrollIntoView({ block: 'center', behavior: 'smooth' }); i.focus(); } }, 80);
  },
  'todo-add-close'() { S.todoAdd = false; render(); },
  'todo-tpl'(el) { const i = $('#todo-text'); if (!i) return; i.value = el.dataset.v + ' '; S.todoDraft = i.value; i.focus(); },
  'todo-when'(el) { const i = $('#todo-text'); S.todoDraft = i ? i.value : ''; S.todoWhen = el.dataset.v; if (el.dataset.v !== 'today') S.todoTime = S.todoTime && S.todoTime >= '10:00' ? S.todoTime : ''; render(); },
  'todo-person'(el) { const i = $('#todo-text'); S.todoDraft = i ? i.value : ''; const id = Number(el.dataset.id); S.todoPerson = S.todoPerson === id ? null : id; render(); },
  'todo-add': () => run(async () => {
    const text = ($('#todo-text') || {}).value || '', time = ($('#todo-time') || {}).value || '';
    S.todos = await post('/api/todos', { text, when: S.todoWhen || 'today', time: time || null, person: S.todoPerson || null });
    S.todoAdd = false; S.todoDraft = ''; S.todoTime = ''; S.todoPerson = null; S.todoWhen = 'today'; render();
    setTimeout(() => { const i = $('#todo-text'); if (i) i.focus(); }, 30); // можно сразу записать следующее
    toast(S.todoWhen === 'today' || !S.todoWhen ? (time ? `Напомню в ${time}` : 'Записано на сегодня') : 'Записано — напомню в нужный день');
  }),
  'todo-done': (el) => run(async () => {
    const done = el.dataset.v === '1';
    const r = await post(`/api/todos/${el.dataset.id}/done`, { done });
    S.todos = r; render();
    if (r.praise) { sfx('charge'); todoParty(r.praise); toast(`${r.praise}${r.beans ? ` · +${r.beans} ${plural(r.beans, 'зерно', 'зерна', 'зёрен')}` : ''}`); if (r.beans) await loadMe(); }
    else if (done) { sfx('confirm'); toast(TODO_DONE[Math.floor(Math.random() * TODO_DONE.length)]); }
  }),
  'todo-move': (el) => run(async () => { S.todos = await post(`/api/todos/${el.dataset.id}/move`, { when: 'tomorrow' }); render(); toast('Перенесено на завтра — без осуждения'); }),
  'todo-remove': (el) => run(async () => { S.todos = await post(`/api/todos/${el.dataset.id}/remove`, {}); render(); toast('Удалено. Иногда это тоже решение'); }),
  'bt-pick': (el) => run(async () => {
    const st = S.bt || (S.bt = { step: 0, answers: [] });
    st.answers[st.step] = Number(el.dataset.v);
    st.step++;
    if (st.step < S.battery.questions.length) { render(); return; }
    S.battery = await post('/api/battery', { answers: st.answers });
    S.bt = { step: 0, answers: [] }; S.btAnim = true;
    const lvl = S.battery.mine.level;
    sfx(lvl >= 60 ? 'charge' : 'chargeLow'); render();
    setTimeout(() => { S.btAnim = false; }, 1500);
  }),
  'bt-retake'() { S.bt = { step: 0, answers: [], retake: true }; render(); },
  'bt-ask': (el) => run(async () => {
    S.battery = await post('/api/battery/ask', { on: el.dataset.v === '1' });
    render();
    toast(S.battery.mine.ask ? 'Просьба отправлена своим — ждём подзарядку' : 'Просьба снята');
  }),
  'bt-remind': (el) => run(async () => { await post('/api/me/profile', { profile: { battery: el.checked } }); await loadMe(); toast(el.checked ? 'Напомню в пятницу вечером' : 'Больше не напоминаю'); }),
  'boost-open'(el) { S.boostTo = { id: Number(el.dataset.id), nick: el.dataset.nick, sent: [] }; S.sheet = 'boost'; render(); },
  'boost-send': (el) => run(async () => {
    const r = await post('/api/battery/boost', { to: S.boostTo.id, kind: el.dataset.v });
    S.boostTo.sent = r.sent; sfx('send'); render();
    toast(`Заряд ушёл: ${S.boostTo.nick} получит пуш`);
  }),
  'badge-toggle': (el) => run(async () => {
    const s = S.style; if (!s) return;
    const id = el.dataset.v, cur = s.badges.filter((b) => b.shown).map((b) => b.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (next.length > s.showMax) { toast(`В карточке помещается ${s.showMax} бейджа — сними один`); return; }
    await post('/api/me/badges', { ids: next });
    s.badges.forEach((b) => { b.shown = next.includes(b.id); });
    render();
    toast(next.includes(id) ? 'Бейдж в карточке — коллеги увидят' : 'Бейдж убран из карточки');
  }),
  'wave-launch-open'() { S.sheet = 'wave-launch'; render(); },
  'wave-launch': () => run(async () => {
    S.wave = await post(`/api/gangs/${S.activeGang}/wave`, {});
    if (S.wave.active) S.waveOff = S.wave.active.now - Date.now();
    S.sheet = null; sfx('waveHorn'); waveSweep(S.me.look); render();
    setTimeout(() => { const c = document.querySelector('.wave'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
    toast('Отмашка дана — банда встаёт');
  }),
  'wave-join': (el) => run(async () => {
    const r = await post(`/api/waves/${el.dataset.id}/join`, {});
    S.wave = r; if (r.active) S.waveOff = r.active.now - Date.now();
    const full = r.active && r.active.joined >= r.active.size;
    sfx(full ? 'waveFull' : 'waveCrowd'); waveSweep(S.me.look); render();
    const wj = WAVE_JOINED();
    toast(`${wj[Math.floor(Math.random() * wj.length)]}${r.beans ? ` +${r.beans} ${plural(r.beans, 'зерно', 'зерна', 'зёрен')}` : ''}`);
    if (r.beans) await loadMe();
  }),
  'wave-open': (el) => run(async () => {
    await actions['gang-open'](el);
    setTimeout(() => { const c = findInGangTabs('.wave'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 250);
  }),
  'thx-open': (el) => run(async () => {
    S.thx = { id: Number(el.dataset.id), nick: el.dataset.nick }; S.thxLeft = null; S.sheet = 'thanks-person'; render();
    loadChats().catch(() => {});
    S.thxLeft = (await get('/api/thanks/left')).left; render();
  }),
  'respect-pick': () => run(async () => { S.sheet = 'respect-pick'; render(); if (!S.chats) { await loadChats(); } }),
  'calls-toggle'() { S.callsOpen = !S.callsOpen; render(); },
  'thx-reason'(el) { const i = $('#thx-text'); if (i) { i.value = el.dataset.v === 'просто так' ? 'Просто так' : el.dataset.v[0].toUpperCase() + el.dataset.v.slice(1); i.focus(); } },
  'thx-send': () => run(async () => {
    const r = await post('/api/thanks', { to: S.thx.id, text: ($('#thx-text') || {}).value || '' });
    toast(`Респект ушёл: ${S.thx.nick}. Осталось ${r.left} на сегодня`);
    S.sheet = null; S.thx = null; render();
  }),
  'guide-toggle'(el) { S.guideOpen = S.guideOpen === el.dataset.v ? null : el.dataset.v; render(); },
  'guide-go'(el) {
    const g = GUIDE.find((x) => x.id === el.dataset.v);
    if (!g || !g.go) return;
    if (g.go.sheet) { actions.open({ dataset: { v: g.go.sheet } }); return; }
    S.sheet = null; S.tab = g.go.tab; S.chatGang = false; S.dmList = false; S.dm = null; S.battle = null; render(); window.scrollTo(0, 0); run(() => refresh());
  },
  'guide-tour'() { S.sheet = null; S.tab = 'near'; S.coach = 1; S.coachStart = 1; render(); window.scrollTo(0, 0); },
  'work-save': () => run(async () => { await post('/api/me/profile', { profile: { role: $('#p-role').value, askMe: $('#p-ask').value } }); await loadMe(); loadExperts((S.experts && S.experts.q) || '').then(render); toast('Сохранено — теперь тебя можно найти по темам'); }),
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
  toast(text, { top: true });
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
// Поделиться ссылкой ровно один раз: в «Поделиться» текст и ссылка идут раздельно (иначе мессенджеры склеивают две копии),
// а в буфер обмена — одной строкой
async function shareLink(text, link) {
  try {
    if (navigator.share) await navigator.share({ title: 'Этаж', text: plain(text), url: link });
    else { await navigator.clipboard.writeText(`${plain(text)}: ${link}`); toast('Ссылка скопирована'); }
  } catch {}
}
function saveSignalText() { if (!S.signal) S.signal = {}; const z = $('#s-zone'); const c = $('#s-comment'); if (z) S.signal.zone = z.value; if (c) S.signal.comment = c.value; }

async function joinByCode(code) {
  await switchable(async (sw) => afterJoin(await post('/api/gangs/join', { code, switch: sw })));
}
async function afterJoin(r) {
  S.activeGang = r.id; store.set('activeGang', r.id); S.tab = 'chats'; S.chatGang = true; S.dmList = false; S.dm = null; S.sheet = null;
  await loadMe(); await loadGang();
  toast(r.already ? 'Ты уже в этой банде' : 'Ты в банде!');
}

// Банда может быть только одна: если сервер ответил «ты уже в банде», спрашиваем и повторяем с переходом
async function switchable(fn, { request = false } = {}) {
  try { await fn(false); } catch (e) {
    if (!/^Ты уже в банде/.test(e.message)) throw e;
    const m = /«(.+?)»/.exec(e.message);
    S.switchAsk = { from: m ? m[1] : 'твоей банды', request, go: () => fn(true) };
    S.sheet = 'gang-switch'; S.error = '';
  }
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
  if (holdFired && Date.now() - holdFired < 700) { holdFired = 0; e.preventDefault(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  if (el.dataset.act === 'close-bg' && e.target !== el) return; // клик внутри шторки — не закрываем и не мешаем ссылкам
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); const snd = feelFor(el.dataset.act, el); if (snd) sfx(snd); fn(el, e); }
});
// Удержание: элемент с data-hold через 450 мс вызывает это действие вместо обычного нажатия
let holdT = null, holdXY = null, holdFired = 0;
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-hold]');
  if (!el || e.target.closest('button:not([data-hold])')) return;
  holdXY = [e.clientX, e.clientY];
  holdT = setTimeout(() => { holdT = null; holdFired = Date.now(); try { navigator.vibrate && navigator.vibrate(12); } catch {} sfx('pick'); actions[el.dataset.hold](el); }, 450);
});
const holdCancel = () => { if (holdT) { clearTimeout(holdT); holdT = null; } };
document.addEventListener('pointerup', holdCancel);
document.addEventListener('pointercancel', holdCancel);
document.addEventListener('pointermove', (e) => { if (holdT && holdXY && Math.hypot(e.clientX - holdXY[0], e.clientY - holdXY[1]) > 10) holdCancel(); });
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-hold]')) e.preventDefault(); });
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
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d || !d.dataset || !d.dataset.hint) return;
  S.hintOpen = S.hintOpen || {}; S.hintOpen[d.dataset.hint] = d.open;
}, true);
document.addEventListener('change', (e) => {
  if (e.target.id === 'snd-vol') { sfx('pick'); return; }
  if (e.target.id === 'home-office') { sfx('pick'); run(async () => { await post('/api/me/profile', { profile: { home: e.target.value || null } }); await loadMe(); toast(e.target.value ? 'Мой офис сохранён' : 'Мой офис сброшен'); }); return; }
  const el = e.target;
  if (el.tagName === 'INPUT' && el.type === 'checkbox' && el.dataset.act && actions[el.dataset.act]) { if (!FEEL_SELF.has(el.dataset.act)) sfx(el.checked ? 'on' : 'off'); actions[el.dataset.act](el, e); }
  else if (el.tagName === 'INPUT' && el.type === 'checkbox') sfx(el.checked ? 'on' : 'off');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id) {
    const map = { 'gfind-q': 'gang-find-go', 'find-q': 'find-go', email: 'login-submit', code: 'code-submit', nick: 'nick-submit', 'chat-text': 'chat-send', 'thanks-text': 'thanks-send', 'thx-text': 'thx-send', 'todo-text': 'todo-add', 'lunch-place': 'lunch-create', 'dm-text': 'dm-send', 'crew-nick': 'crew-add' };
    if (map[e.target.id]) { e.preventDefault(); actions[map[e.target.id]](); }
    else if (e.target.id && e.target.id.startsWith('poll-add-')) { e.preventDefault(); actions['poll-add']({ dataset: { id: e.target.id.slice(9) } }); }
  }
  if (e.key === 'Escape' && S.sheet) actions.close();
});

// ---------- Обновление в фоне ----------
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
// Фоновое обновление: раз в 20 секунд, а если три раза подряд ничего не поменялось — раз в минуту
const POLL = { idle: 0, at: 0, sig: '' };
const pollSig = () => JSON.stringify([S.state && S.state.badges, S.state && S.state.checkin, (S.people || []).map((p) => p.id + p.where + (p.office || '') + (p.focus || '') + (p.unread || 0)), (S.inbox || []).length]);
setInterval(async () => {
  if (document.hidden || !S.me || !S.me.nick || typing() || S.sheet) return;
  if (POLL.idle >= 3 && Date.now() - POLL.at < 60000) return;
  POLL.at = Date.now();
  try {
    await refresh();
    const sig = pollSig();
    POLL.idle = sig === POLL.sig ? POLL.idle + 1 : 0; POLL.sig = sig;
    render();
  } catch {}
}, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) POLL.idle = 0; });
document.addEventListener('click', () => { POLL.idle = 0; }, true);
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
  if (S.dmSecret) {
    const before = S.secret ? S.secret.items.map((m) => m.id + (m.read ? 'r' : '')).join() + '|' + !!S.secret.theirs : '';
    try { await loadSecret(); } catch {}
    const after = S.secret ? S.secret.items.map((m) => m.id + (m.read ? 'r' : '')).join() + '|' + !!S.secret.theirs : '';
    if (after !== before && !typing()) { render(); const c = $('#sc-chat'); if (c) c.scrollTop = c.scrollHeight; }
    return;
  }
  const sig = () => (S.dmView ? S.dmView.messages.map((m) => m.id + ':' + (m.reply || '') + (m.read ? 'r' : '')).join() : '') + '|' + (S.duelsWith || []).map((d) => d.id + ':' + d.seq).join();
  const before = sig();
  try {
    await loadDm();
    const after = sig();
    const nd = (S.duelsWith || []).find((d) => S.duelSeqSeen && S.duelSeqSeen[d.id] !== undefined && S.duelSeqSeen[d.id] !== d.seq);
    S.duelSeqSeen = Object.fromEntries((S.duelsWith || []).map((d) => [d.id, d.seq]));
    if (nd) { S.duelAnim = { id: nd.id, seq: nd.seq, until: Date.now() + 2600 }; if (nd.game === 'dice') sfx('diceLand'); else if (nd.game === 'ttt') sfx('marker'); duelOutcomeSfx(nd); }
    if (after !== before) render();
  } catch {}
}, 3500);
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && reloadIfStale()) return;
  if (!document.hidden && S.me && S.me.nick && !typing()) { try { await refresh(); render(); } catch {} }
});

// ---------- Старт ----------
// Ссылки из пушей: #gang/ID, #crew/ID, #battle/ID, #feed, #feedback
function applyHash(hash) {
  if (hash.startsWith('#gang/')) { S.tab = 'chats'; S.chatGang = true; S.dmList = false; S.dm = null; S.activeGang = Number(hash.slice(6)) || S.activeGang; }
  if (hash === '#feed') { S.dmList = false; S.tab = 'office'; S.chatGang = false; S.dm = null; setTimeout(() => { const c = document.querySelector('.myfeed'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 900); }
  if (hash === '#kitchen') { S.dmList = false; S.tab = 'office'; S.chatGang = false; S.dm = null; S.boardCat = 'kitchen'; }
  if (hash === '#lunch' || hash === '#office') { S.dmList = false; S.tab = hash === '#lunch' ? 'near' : 'office'; S.chatGang = false; S.dm = null; if (hash === '#lunch') setTimeout(() => { const c = document.querySelector('.lunch-card'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 800); }
  if (hash === '#near') { S.dmList = false; S.tab = 'near'; S.chatGang = false; S.dm = null; }
  if (hash === '#rate') { S.tab = 'office'; S.chatGang = false; S.dm = null; setTimeout(() => { const c = document.querySelector('.food'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 800); }
  if (hash === '#todos') { S.tab = 'near'; S.chatGang = false; S.dm = null; setTimeout(() => { const c = document.querySelector('.todos'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 600); }
  if (hash === '#battery') { S.sheet = 'battery'; S.bt = { step: 0, answers: [] }; get('/api/battery').then((b) => { S.battery = b; render(); }).catch(() => {}); }
  if (hash.startsWith('#wave/')) { S.tab = 'chats'; S.chatGang = true; S.dmList = false; S.dm = null; S.activeGang = Number(hash.slice(6)) || S.activeGang; S.waveScroll = true; }
  if (hash === '#feed') S.tab = 'office';
  if (hash === '#crew' || hash === '#chats') { S.tab = 'chats'; S.dmList = hash === '#crew'; }
  if (hash.startsWith('#crew/')) { S.tab = 'chats'; S.dm = Number(hash.slice(6)) || null; S.dmSecret = false; }
  if (hash.startsWith('#secret/')) { S.tab = 'chats'; S.chatGang = false; S.battle = null; S.dm = Number(hash.slice(8)) || null; S.dmSecret = true; Promise.all([loadDm(), loadSecret()]).then(render).catch(() => {}); }
  if (hash.startsWith('#battle/')) { S.tab = 'chats'; S.battle = Number(hash.slice(8)) || null; }
  if (hash === '#league') S.tab = 'games';
  if (hash === '#inbox') { S.tab = 'chats'; S.chatGang = false; S.dm = null; S.sheet = 'inbox'; }
}

// Открытое приложение: пуш меняет только хэш, страница не перезагружается — разбираем его здесь
window.addEventListener('hashchange', async () => {
  const hash = location.hash;
  if (!hash || !S.me || !S.me.nick || /^#(join|crew)=/i.test(hash)) return;
  applyHash(hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (hash === '#feedback') { S.sheet = 'feedback'; render(); await run(loadFeedback); return; }
  if (hash === '#league') { S.sheet = 'league'; render(); await run(() => loadLeague('W')); return; }
  if (hash === '#inbox') { render(); await run(loadInbox); markInboxSeen(); return; }
  S.sheet = null;
  try { await refresh(); } catch {}
  render();
});

// ----- Приветствие при входе: по времени суток, где ты сегодня, дню недели и дню рождения -----
// Повторный вход в той же ситуации — другая фраза из набора, а не та же самая
// Род: {ушёл|ушла} — по полу аватара; {a} — обращение, {A} — оно же с большой буквы, {hol} — название праздника
const GREET = {
  bday: ['С днём рождения, {a}! cake Банда уже в курсе', '{Именинник|Именинница} на этаже! С днём рождения, {a} party', 'Сегодня твой день, {a}. Торт сам себя не съест cake', 'Ещё один уровень пройден, {a}! С днём рождения', 'С днём рождения, {a}! Сегодня можно всё, кроме созвонов в 18:00'],
  vacation: ['Ты же в отпуске, {a}! Что ты тут {забыл|забыла}? sun', 'Отпуск, {a}! Закрывай приложение и иди на пляж', 'Работа подождёт, {a}. Отдыхай sun', '{A}, отпуск — это когда рабочие приложения не открывают. Ну ладно', 'Почту в отпуске не проверяешь? Правильно. А сюда зачем, {a}?'],
  sick: ['Выздоравливай, {a}! Чай с лимоном — приказ', 'Лежи и лечись, {a}. Банда держит оборону', 'Поправляйся, {a}! Без тебя тут скучно', 'Банда шлёт тебе виртуальный бульон, {a}'],
  night: ['Ночной лифт, {a}. Едем тихо, все спят', 'Не спится, {a}?', 'Ночная смена, {a}? Офисы спят, а ты нет', 'Совы одобряют, {a}. Но утром будет тяжело', '{A}, в это время даже кофемашина спит', 'Тсс, {a}. Этаж спит, говори шёпотом'],
  weekend: ['Выходной же, {a}! Отдыхай', 'Выходной, {a}. Этаж подождёт', 'В выходной на работу? {A}, ты легенда', 'Выходной, {a}. Офис отдыхает от нас, мы — от него', '{A}, сегодня единственный дедлайн — обед'],
  holiday: ['С праздником, {a}! Офисы закрыты, совесть чиста', 'Сегодня {hol}, {a}. Отдыхай!', 'Праздник, {a}! Этаж работает, ты — нет', '{A}, в праздник отмечаться не надо. Только праздновать'],
  preholiday: ['Завтра выходной, {a}! Осталось чуть-чуть', 'Предпраздничный день, {a}: работаем на час меньше, мечтаем на час больше', '{A}, завтра {hol}. Мысленно ты уже там', 'Короткий день, {a}. Главное — не начинать ничего большого'],
  preholiday_late: ['Завтра выходной, {a}! Можно выдохнуть', 'Всё, {a}, впереди {hol}. Ноутбук — спать', '{A}, работа подождёт до конца праздника. Отдыхай'],
  mon_morning: ['Понедельник, {a}. Лифт едет вверх, настроение догонит', 'Понедельник, {a}. Держись!', 'Утречка, {a}! Понедельник — это ненадолго', 'Новая неделя, {a}. Погнали coffee', 'Понедельник, {a}. Делаем вид, что всё по плану'],
  fri_evening: ['Пятница, {a}! Этот лифт идёт прямо в выходные', 'Пятница, {a}! Ещё чуть-чуть', 'Пятничный вечер, {a}. Ты {справился|справилась} party', 'Почти выходные, {a}! Держись', '{A}, в пятницу после пяти новые задачи не берут. Это закон'],
  fri_late: ['Пятница, вечер, {a}! Выходные официально начались party', '{A}, ноутбук закрыт? Выходные же', 'Неделя позади, {a}. Заслуженный отдых', 'Пятничный вечер, {a}. Рабочий чат можно не читать до понедельника'],
  office_morning: ['Двери открываются. {A}, твой этаж', 'Лифт приехал, {a}. Дальше — только кофе', 'Утречка, {a}! Ты уже на этаже coffee', 'Доброе утро, {a}! Офис рад тебя видеть', 'Ранняя пташка, {a}! Кофе ждёт', '{A} в здании! Кофемашина, готовься'],
  office_day: ['Осторожно, двери открываются: {a} на этаже', '{A}, лифт привёз тебя вовремя. Почти', 'Хорошего дня, {a}!', 'Как там на этаже, {a}?', 'Держим темп, {a}!', '{A}, если что — переговорка свободна. Наверное'],
  office_evening: ['Лифт вниз скоро, {a}. Ещё пара дел — и поехали', 'Финишная прямая, {a}!', 'Вечереет, {a}. Не засиживайся', 'Ещё чуть-чуть, {a}, и домой', '{A}, лифты уже скучают по тебе'],
  office_late: ['{A}, ты ещё в офисе? Свет выключить не забудь', 'Поздновато, {a}. Офис уже зевает', 'Охрана интересуется, всё ли у тебя хорошо, {a}', 'Рабочий день кончился, {a}. Домой!'],
  home_morning: ['Домашний лифт — это три шага от кровати, {a}', '{A}, твой этаж сегодня — кухня', 'Утречка, {a}! Работаем из пижамы? coffee', 'Доброе утро, {a}! Кот уже на рабочем месте', 'Утро дома, {a}. Сначала кофе', 'Утро дома, {a}. Камеру можно не включать'],
  home_day: ['Дома лифта нет, {a}, зато холодильник рядом', 'Хорошего дня, {a}! Домашний офис на связи', 'Как там дома, {a}? Не забудь пообедать', 'Работаем из дома, {a}. Банда на связи', 'Дресс-код дома, {a}: сверху рубашка, снизу — секрет'],
  home_evening: ['Ещё чуть-чуть, {a}, и отдыхать', 'Вечереет, {a}. Скоро закрывай ноутбук', 'Финишная прямая, {a}! До дивана три шага'],
  home_late: ['Рабочий день окончен, {a}. Ноутбук — спать', 'Вечер дома, {a}. Диван заждался', '{A}, всё, что не успели, — проблема завтрашнего дня'],
  none_morning: ['Лифт подан, {a}! На какой этаж едем?', 'Заходи, {a}. Кнопку этажа нажмёшь {сам|сама}?', 'Утречка, {a}! Где сегодня работаем?', 'Доброе утро, {a}! Отметься — банда ждёт', 'Привет, {a}! Офис или дом?', 'Утро, {a}! Кофе или ещё пять минут?'],
  none_day: ['Двери закрываются, {a}. Следующая остановка — обед', '{A}, ты как раз вовремя: лифт без очереди', 'Хорошего дня, {a}!', 'Привет, {a}! Ты где сегодня?', 'О, {a}! Банда тебя потеряла', '{A}, ты сегодня в режиме невидимки?'],
  none_evening: ['Вечерний рейс, {a}. Едем вниз или ещё поработаем?', 'Добрый вечер, {a}!', 'Вечереет, {a}. Как прошёл день?', 'Крепись, {a}! Рабочий день почти всё', 'Финишная прямая, {a}!'],
  none_late: ['Добрый вечер, {a}!', 'Рабочий день позади, {a}. Как всё прошло?', '{A}, вечер — время для дуэли. Или для дивана', 'Вечер, {a}. Банда наверняка уже обсуждает ужин']
};
// Кнопка «дальше» — под настроение ситуации
const GREET_GO = {
  bday: ['Где мой торт? cake', 'Принимаю поздравления', 'Погнали праздновать'], vacation: ['Я только глянуть', 'Одним глазком', 'Ладно, на минутку'],
  sick: ['Ладно, лягу', 'Только проверю чат', 'Я тихонько'], night: ['Ещё пять минут', 'Совы не спят', 'Я быстро'],
  weekend: ['Я на минутку', 'Только посмотреть', 'Отдыхаю, честно'], holiday: ['Я на минутку', 'Только поздравить', 'Отдыхаю, честно'],
  preholiday: ['Ещё чуть-чуть', 'Добиваем день', 'Погнали!'], preholiday_late: ['Только гляну', 'На минутку', 'Уже отдыхаю'],
  mon_morning: ['Держусь!', 'За дело!', 'Кофе — и погнали'],
  fri_evening: ['Скорее бы выходные', 'Ещё чуть-чуть', 'Погнали!'], fri_late: ['Только гляну', 'Уже отдыхаю', 'На минутку'],
  morning: ['За дело!', 'Погнали!', 'Кофе — и в бой', 'Поехали!'],
  day: ['За дело!', 'Погнали!', 'Работаем', 'Вперёд!'], evening: ['Добиваем день', 'Ещё немного', 'Погнали!'], late: ['Только гляну', 'На минутку', 'Я быстро']
};
// Обращения: своё для каждого рода и общие
const GREET_ADDR = { m: ['бандит', 'шеф', 'дружище', 'босс', 'чемпион', 'коллега', 'легенда'], f: ['бандитка', 'звезда', 'королева', 'шефиня', 'чемпионка', 'коллега', 'легенда'] };
// Части суток по Москве: вечер — до 19:00 (конец рабочего дня), потом «поздний вечер» — уже после работы
function dayPart(h) { return h < 5 || h >= 23 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'day' : h < 19 ? 'evening' : 'late'; }
function greeting() {
  const me = S.me, st = S.state || {};
  const sex = me.look && me.look.preset === 'f' ? 'f' : 'm';
  // Время и дата — московские, с сервера; если их нет — по часам телефона
  const now = new Date();
  const h = st.msk ? Number(st.msk.slice(0, 2)) : now.getHours();
  const todayIso = st.today || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dow = new Date(todayIso + 'T12:00:00Z').getUTCDay();
  const part = dayPart(h);
  const pres = st.presence || {};
  const p = pres.where || 'none';
  const dd = todayIso.slice(8, 10) + '.' + todayIso.slice(5, 7);
  const holName = (x) => String(x || '').replace(/\s*\(.*\)\s*/, '').trim();
  let key, hol = '';
  if (me.profile && me.profile.bday === dd) key = 'bday';
  else if (p === 'vacation') key = 'vacation';
  else if (p === 'sick') key = 'sick';
  else if (part === 'night') key = 'night';
  else if (p === 'weekend' && pres.holiday) { key = 'holiday'; hol = holName(pres.holiday); }
  else if (p === 'weekend') key = 'weekend';
  else if (st.tomorrowHoliday && part !== 'morning') { key = part === 'late' ? 'preholiday_late' : 'preholiday'; hol = holName(st.tomorrowHoliday); }
  else if (dow === 1 && part === 'morning' && p !== 'office') key = 'mon_morning';
  else if (dow === 5 && (part === 'evening' || part === 'late')) key = part === 'late' ? 'fri_late' : 'fri_evening';
  else key = `${st.checkin ? 'office' : p === 'home' ? 'home' : 'none'}_${part}`;
  let list = GREET[key] || GREET.none_day;
  if (!hol) list = list.filter((t) => !t.includes('{hol}'));
  let last = {};
  try { last = store.get('greet', {}) || {}; } catch {}
  const i = last.key === key ? (last.i + 1) % list.length : Math.floor(Math.random() * list.length);
  const ai = last.key === key ? ((last.ai || 0) + 1) % GREET_ADDR[sex].length : Math.floor(Math.random() * GREET_ADDR[sex].length);
  try { store.set('greet', { key, i, ai }); } catch {}
  // Иногда вместо «бандит» — ник: так приветствие звучит лично
  const addr = Math.random() < 0.3 ? me.nick : GREET_ADDR[sex][ai];
  const text = greetFill(list[i], addr, sex, hol);
  const day = new Date(todayIso + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const gk = GREET_GO[key] || GREET_GO[part] || GREET_GO.day;
  return { text, day, go: gk[i % gk.length] };
}
function greetFill(t, addr, sex, hol = '') {
  return t.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, (m, a, b) => (sex === 'f' ? b : a))
    .replace(/\{a\}/g, addr).replace(/\{A\}/g, addr[0].toUpperCase() + addr.slice(1)).replace(/\{hol\}/g, hol);
}
// Заставка: логотип, аватар и приветствие. До 10 секунд (полоска показывает, сколько осталось), кнопка — дальше сразу
const SPLASH_MS = 10000;
// Табло лифта: куда приехали — по времени суток
const LIFT_FLOORS = {
  night: ['Этаж сов', 'Этаж «не спится»', 'Ночной этаж'],
  morning: ['Этаж кофе', 'Этаж «ещё пять минут»', 'Этаж бодрости', 'Этаж первых созвонов'],
  day: ['Этаж дедлайнов', 'Этаж, где обед', 'Этаж созвонов', 'Этаж «сейчас гляну»'],
  evening: ['Этаж последних правок', 'Этаж «добиваем день»', 'Этаж «почти всё»'],
  late: ['Этаж дивана', 'Этаж «только гляну»', 'Этаж заслуженного отдыха']
};
async function splash() {
  try { await loadState(); } catch {}
  const g = greeting();
  const st = S.state || {};
  const part = dayPart(st.msk ? Number(st.msk.slice(0, 2)) : new Date().getHours());
  const names = LIFT_FLOORS[part] || LIFT_FLOORS.day;
  const floorName = names[Math.floor(Math.random() * names.length)];
  // Табло едет до этажа твоей банды; без банды — случайный этаж повыше
  const mine = (S.me.gangs || []).find((x) => x.id === S.activeGang) || (S.me.gangs || [])[0];
  const target = mine && mine.floor ? mine.floor : 4 + Math.floor(Math.random() * 9);
  // Кабина лежит поверх приложения: пока створки закрыты, под ними уже рисуется экран — двери открываются сразу на этаж
  const el = document.createElement('div');
  el.className = 'lift';
  // Холл у лифта: стальные створки в стене, табло над ними, впереди — стойка с терминалом пропусков.
  // Здоровается терминал (как настоящая проходная), а не двери; пропуск — карточка с аватаром
  el.innerHTML = `<div class="lift-scene">
      <div class="lift-way"><div class="lift-glow"></div><div class="lift-door l"></div><div class="lift-door r"></div></div>
      <img class="lift-wall" src="/art/lift/wall.webp" alt="">
      <div class="lift-top"><div class="lift-disp"><i class="lift-arrow"></i><b class="lift-num">1</b></div><span class="lift-floor">${esc(mine && mine.floor ? mine.name : floorName)}</span></div>
    </div>
    <div class="lift-desk">
      <div class="lift-term"><i class="lift-led"></i><p class="lift-hi">${esc(g.text)}</p><p class="lift-day">${esc(g.day)}</p></div>
      <div class="lift-row"><div class="lift-pass"><i class="lift-clip"></i>${avatar(S.me.look, 64)}<b>${esc(S.me.nick)}</b><span>Этаж<em>.</em> пропуск</span></div>
        <div class="lift-act"><button class="btn splash-go" data-act="splash-skip">${esc(g.go)} →</button><div class="splash-bar"><i style="animation-duration:${SPLASH_MS}ms"></i></div></div></div>
    </div>`;
  document.body.appendChild(el);
  root.innerHTML = '';
  // Табло отсчитывает этажи, потом показывает, куда приехали
  const num = el.querySelector('.lift-num');
  let n = 1;
  const ride = setInterval(() => {
    n = Math.min(target, n + Math.max(1, Math.ceil((target - 1) / 30))); num.textContent = n;
    if (n >= target) { clearInterval(ride); el.classList.add('here'); }
  }, Math.max(60, 2200 / Math.max(1, target - 1)));
  let tapped = false;
  await new Promise((res) => { S.splashDone = () => { tapped = true; res(); }; setTimeout(res, SPLASH_MS); });
  S.splashDone = null;
  clearInterval(ride); num.textContent = target;
  // По нажатию звенит гонг, щёлкает замок — и только потом едут створки, в такт звуку. Без нажатия открываемся сразу
  el.classList.add('here', 'go');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => el.classList.add('open'), tapped && !reduce ? 620 : 60);
  setTimeout(() => el.remove(), (tapped && !reduce ? 620 : 60) + (reduce ? 350 : 1750));
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
      store.set('pendingCrew', null); S.tab = 'chats'; S.dmList = true;
      try { const r = await post('/api/crew/add', { code: pendingCrew }); toast(r.accepted ? 'Теперь можно переписываться!' : r.already ? 'Вы уже на связи' : 'Заявка ушла. Ждём ответа'); } catch (e) { toast(e.message); }
    }
    await refresh({ all: true });
    const coachDone = Number(store.get('coachDone', 0));
    if (coachDone < 2) { S.coach = coachDone === 1 ? 3 : 1; S.coachStart = S.coach; }
    else if (!store.get('ia2', 0)) { S.sheet = 'whatsnew'; } // уже знакомы с приложением — коротко покажем, что поменялось
    syncPush().then(render).catch(() => {});
    if (openFeedback) { S.sheet = 'feedback'; loadFeedback().then(render).catch(() => {}); }
    if (hash === '#league') { S.sheet = 'league'; loadLeague('W').then(render).catch(() => {}); }
  }
  if (hash) history.replaceState(null, '', location.pathname + (location.search.includes('login=') ? '' : location.search));
  render();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot().catch((e) => { root.innerHTML = `<div class="onb"><div class="card"><h2>Не получилось загрузиться</h2><p class="sub">${esc(e.message)}</p></div></div>`; });

// Для проверки сочетаний деталей аватара (скриншоты-матрицы)
window.__etazhAvatar = avatar;

// ---------- Подсказка прокрутки ----------
// Где есть что листать — полосы с карточками, вкладки, шторки, переписка — у края появляется маленькая
// стрелка и покачивается в сторону прокрутки. Долистал до конца — пропадает. Нажатие листает дальше.
// Стрелки живут в отдельном слое поверх страницы и не меняют вёрстку самих полос.
const SCROLLERS = '.sheet, .chat, .presets, .cats, .scenes, .chips.scroll-x, .fav-strip, .bracket, .match-strip, .tmr-list, .shop-strip, .shop-tabs, .b-emotes, .war-rivals, .hero-list';
let hintRaf = 0;
const hintLayer = (() => { const d = document.createElement('div'); d.id = 'scroll-hints'; d.setAttribute('aria-hidden', 'true'); document.body.appendChild(d); return d; })();
function scheduleHints() { if (!hintRaf) hintRaf = requestAnimationFrame(() => { hintRaf = 0; drawHints(); }); }
function drawHints() {
  const out = [];
  const sheet = document.querySelector('.sheet');
  // Нижняя панель вкладок закрывает край экрана — стрелки над ней не рисуем
  const nav = !sheet && document.querySelector('nav.tabs');
  const vw = window.innerWidth, vh = nav ? Math.min(window.innerHeight, nav.getBoundingClientRect().top) : window.innerHeight;
  const els = [...document.querySelectorAll(SCROLLERS)];
  // Под открытой шторкой страницу не подсказываем — только то, что внутри шторки
  els.forEach((el, i) => {
    if (sheet && el !== sheet && !sheet.contains(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) return;
    // Видимая часть: экран, а внутри шторки — ещё и сама шторка
    let top = Math.max(0, r.top), bottom = Math.min(vh, r.bottom), left = Math.max(0, r.left), right = Math.min(vw, r.right);
    if (sheet && el !== sheet) { const s = sheet.getBoundingClientRect(); top = Math.max(top, s.top); bottom = Math.min(bottom, s.bottom); }
    if (bottom - top < 16 || right - left < 30) return;
    const horiz = el.scrollWidth - el.clientWidth > 6 && getComputedStyle(el).overflowX !== 'hidden';
    if (horiz) {
      const y = Math.round((top + bottom) / 2 - 13);
      if (el.scrollLeft + el.clientWidth < el.scrollWidth - 6) out.push(`<button class="sh-arrow r" style="left:${Math.round(right - 30)}px;top:${y}px" data-hint="${i}" data-dir="r">›</button>`);
      if (el.scrollLeft > 6) out.push(`<button class="sh-arrow l" style="left:${Math.round(left + 4)}px;top:${y}px" data-hint="${i}" data-dir="l">‹</button>`);
    } else if (el.scrollHeight - el.clientHeight > 12 && el.scrollTop + el.clientHeight < el.scrollHeight - 12) {
      out.push(`<button class="sh-arrow d" style="left:${Math.round((left + right) / 2 - 13)}px;top:${Math.round(bottom - 34)}px" data-hint="${i}" data-dir="d">›</button>`);
    }
  });
  // Основной экран: в начале длинной страницы — «вниз, до конца», со второй половины — «наверх».
  // Одна кнопка в правом нижнем углу над панелью вкладок, чтобы не мешать
  if (!sheet && nav) {
    const y = window.scrollY, rest = document.documentElement.scrollHeight - window.innerHeight - y;
    const navTop = nav.getBoundingClientRect().top;
    if (document.documentElement.scrollHeight - window.innerHeight > window.innerHeight * 0.6) {
      // Кнопка у самого края и не поверх кнопок: ищем свободное место снизу вверх, не нашли — не показываем
      const busy = (x, yy) => document.elementsFromPoint(x, yy).some((n) => !n.closest('#scroll-hints') && n.closest('button, a, input, select, textarea, label, [data-act]'));
      let top = null;
      for (let k = 0; k < 5 && top === null; k++) {
        const t = navTop - 44 - k * 46, x0 = vw - 38;
        if (t < 80) break;
        if (![[x0 + 2, t + 2], [x0 + 32, t + 2], [x0 + 2, t + 32], [x0 + 32, t + 32], [x0 + 17, t + 17]].some(([x, yy]) => busy(x, yy))) top = t;
      }
      const pos = top === null ? null : `left:${Math.round(vw - 38)}px;top:${Math.round(top)}px`;
      // Прошёл половину страницы (или полтора экрана) — ведём наверх, иначе — вниз
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (!pos) { /* места нет — без кнопки */ }
      else if (y > Math.min(window.innerHeight * 1.2, maxY * 0.5)) out.push(`<button class="sh-arrow pg up" style="${pos}" data-dir="top" aria-label="Наверх">›</button>`);
      else if (rest > 200) out.push(`<button class="sh-arrow pg d" style="${pos}" data-dir="bottom" aria-label="В конец страницы">›</button>`);
    }
  }
  const html = out.join('');
  if (hintLayer.innerHTML !== html) { hintLayer.innerHTML = html; hintLayer._els = els; }
  else hintLayer._els = els;
}
hintLayer.addEventListener('click', (e) => {
  const b = e.target.closest('.sh-arrow'); if (!b) return;
  if (b.dataset.dir === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (b.dataset.dir === 'bottom') { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); return; }
  const el = (hintLayer._els || [])[Number(b.dataset.hint)]; if (!el) return;
  const d = b.dataset.dir;
  if (d === 'd') el.scrollBy({ top: el.clientHeight * 0.7, behavior: 'smooth' });
  else el.scrollBy({ left: (d === 'r' ? 1 : -1) * el.clientWidth * 0.7, behavior: 'smooth' });
});
document.addEventListener('scroll', scheduleHints, true);
window.addEventListener('resize', scheduleHints);
new MutationObserver((list) => { if (list.some((m) => m.target !== hintLayer && !hintLayer.contains(m.target))) scheduleHints(); }).observe(document.body, { childList: true, subtree: true });
