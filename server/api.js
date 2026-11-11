const { config } = require('./config');
const U = require('./util');
const { CREST, GANG_AREAS, GANG_INTERESTS, GANG_EMOJI, MOODS_F, MOODS, CALLS, SIGNALS, SHOP, EARN, GANG_DEPOSIT, GANG_COLORS, MEMES, MEME_EMOS, STREAK_BEANS, streakBeans, COMPANIES } = require('./catalog');
const { sendLoginLink } = require('./mailer');
const { sendPush } = require('./webpush');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

// ---------- Ограничение частоты запросов (в памяти) ----------
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const t = U.now();
  const b = buckets.get(key) || { n: 0, reset: t + windowMs };
  if (t > b.reset) { b.n = 0; b.reset = t + windowMs; }
  b.n += 1;
  buckets.set(key, b);
  if (b.n > max) throw new HttpError(429, 'Слишком часто. Подожди немного.');
}
setInterval(() => {
  const t = U.now();
  for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k);
}, 60e3).unref();

// ---------- Внешний вид аватара: допустимые значения ----------
const HAIR_COLORS = ['#0F0E12', '#2B1D14', '#4A3326', '#6B3E26', '#8C6A4F', '#B5532A', '#C2412F', '#CFAE74', '#E0B04B', '#F2E6C9', '#6E6A66', '#9AA3B5', '#7C4DFF', '#FF6FA8'];
const LOOK = {
  preset: ['m', 'f'],
  hairStyle: ['short', 'long', 'tail', 'curly', 'bob', 'bun', 'side', 'mohawk', 'afro', 'bald',
    'undercut', 'quiff', 'crop', 'slick', 'buzz', 'manbun', 'waves', 'bangs', 'lob', 'pixie', 'ponytail', 'braid', 'buns', 'anime'],
  // Натуральные цвета: чёрный, тёмно-каштановый, тёмно-русый, каштановый, русый, медный, рыжий, пшеничный, блонд, платина, «соль с перцем», седой; яркие — в конце
  hair: HAIR_COLORS,
  face: ['oval', 'round', 'square', 'long', 'heart'],
  mouth: ['smile', 'grin', 'smirk', 'neutral', 'sad', 'wow'],
  beard: ['none', 'stubble', 'beard', 'mustache', 'goatee'],
  eyes: ['#22252D', '#6B4226', '#8A6A2E', '#A8762A', '#3C8D5A', '#3A7BD5', '#6E8BA6', '#8A8F9C'],
  skin: ['#FBE3CF', '#F6D3B3', '#EBC3A0', '#E8B48A', '#D7A774', '#C98E62', '#A86F48', '#8D5A3B', '#704530', '#5E3A26'],
  // Одежда, головной убор, маска — каждый своим цветом из общей палитры
  hoodie: ['red', 'blue', 'green', 'violet', 'navy', 'black', 'white', 'beige', 'yellow', 'pink', 'orange', 'khaki', 'burgundy', 'grey'],
  hatColor: ['same', 'red', 'blue', 'green', 'violet', 'navy', 'black', 'white', 'beige', 'yellow', 'pink', 'orange', 'khaki', 'burgundy', 'grey'],
  // Анатомия: круглые, миндаль, узкие, нависшее веко, опущенные и приподнятые уголки. tired/sly/wide — старые «взгляды», остаются для совместимости и эмоций
  eyeShape: ['normal', 'almond', 'narrow', 'hooded', 'down', 'up', 'tired', 'sly', 'wide', 'anime'],
  eyeGap: ['close', 'normal', 'wide'],
  browShape: ['auto', 'straight', 'arch', 'peak', 'thin', 'thick', 'uni'],
  age: ['0', '1', '2'],
  hairline: ['normal', 'high', 'receding', 'm'],
  part: ['left', 'right'],
  lips: ['thin', 'normal', 'full'],
  mole: ['none', 'cheekL', 'cheekR', 'lip', 'chin'],
  outfit: ['hoodie', 'tee', 'dev', 'shirt', 'suit', 'jacket', 'puffer', 'dress', 'cami', 'biker', 'cyber', 'armor', 'vampire', 'nysweater', 'telnyashka'],
  neck: ['none', 'tie', 'tie_crooked', 'bow', 'badge', 'beads', 'chain', 'tie_gold', 'chain_gold', 'snake', 'garland'],
  hat: ['none', 'beanie', 'cap', 'headset', 'laurel', 'knight', 'royal', 'fedora', 'ushanka', 'tricorn', 'dedmoroz', 'kokoshnik', 'wreath', 'shawl'],
  mask: ['none', 'medical', 'gauze', 'visor', 'scuba'],
  prop: ['none', 'mug', 'papers', 'sign', 'laptop', 'mug_best', 'trophy', 'phone', 'torch', 'mimosa', 'pancakes', 'sign_lunch', 'sign_dnd', 'sign_ask', 'sign_coffee', 'sign_deadline', 'sign_plan', 'sign_friday', 'sign_domik', 'sign_tz', 'sign_thanks', 'sign_innocent', 'sign_vacation'],
  bg: ['auto', 'sky', 'mint', 'peach', 'lilac', 'sun', 'slate', 'office', 'meeting', 'home', 'street', 'cafe'],
  // Черты лица: размер глаз, нос, уши
  eyeSize: ['s', 'm', 'l'],
  nose: ['button', 'straight', 'wide', 'long', 'snub', 'roman'],
  ears: ['small', 'normal', 'big'],
  // Макияж и серьги — показываем в конструкторе для «Ж», но доступны всем
  makeup: ['none', 'light', 'lips', 'smoky', 'evening', 'bright'],
  earrings: ['none', 'studs', 'pearls', 'hoops', 'drops', 'cross'],
  // Форма очков (сами очки включаются отдельной галочкой)
  glassesStyle: ['classic', 'round', 'square', 'aviator', 'cat'],
  glassesColor: ['black', 'tortoise', 'gold', 'silver', 'red', 'navy', 'pink'],
  lensColor: ['clear', 'grey', 'brown', 'blue', 'green', 'pink', 'yellow'],
  pet: ['none', 'corgi', 'pug', 'frenchie', 'parrot', 'cat', 'aquarium', 'cactus'],
  capBadge: ['none', 'star', 'bolt', 'heart', 'crown', 'paw', 'e', 'one'],
  // Отдельный цвет бороды и усов; same — как волосы
  beardColor: ['same', ...HAIR_COLORS],
  mustacheColor: ['same', ...HAIR_COLORS],
  browColor: ['same', ...HAIR_COLORS]
};
const LOOK_ENUMS = ['eyeGap', 'browShape', 'browColor', 'age', 'hairline', 'part', 'lips', 'mole', 'capBadge', 'preset', 'face', 'eyes', 'mouth', 'beard', 'hairStyle', 'hair', 'skin', 'hoodie', 'eyeShape', 'outfit', 'neck', 'hat', 'prop', 'bg', 'eyeSize', 'nose', 'ears', 'makeup', 'earrings', 'glassesStyle', 'glassesColor', 'lensColor', 'pet', 'beardColor', 'mustacheColor', 'hatColor', 'mask'];
// Платные детали: значение слота → предмет Лавки, который нужно купить
const PAID_PARTS = Object.fromEntries(SHOP.filter((it) => it.kind === 'part').map((it) => [`${it.slot}:${it.value}`, it.id]));
// Собрать внешность из присланного: только допустимые значения и только купленные платные детали
function applyLook(base, l, owned) {
  const look = { ...base };
  if (!l || typeof l !== 'object') return look;
  for (const k of LOOK_ENUMS) {
    if (l[k] === undefined || !LOOK[k].includes(l[k])) continue;
    const need = PAID_PARTS[`${k}:${l[k]}`];
    if (need && !owned.has(need)) throw bad('Эта деталь продаётся в Лавке.');
    look[k] = l[k];
  }
  for (const k of ['glasses', 'phones', 'freckles', 'lashes', 'dimples']) if (l[k] !== undefined) look[k] = !!l[k];
  // Борода — только у «М», макияж — только у «Ж»
  if (look.preset === 'f') look.beard = 'none'; else look.makeup = 'none';
  // Капюшон убран из конструктора — у кого был, просто без головного убора
  if (look.hat === 'hood') look.hat = 'none';
  return look;
}
const NICK_PRICE = 50;
// Версия интерфейса: отпечаток файлов клиента. Открытое приложение сравнивает её со своей и перезагружается,
// иначе у коллег, которые неделями не закрывают вкладку, остаётся старая отрисовка (например, аватаров)
const BUILD = (() => {
  const fs = require('node:fs'), path = require('node:path'), h = require('node:crypto').createHash('sha1');
  for (const f of ['js/app.js', 'js/building.js', 'js/crest.js', 'js/ships.js', 'js/duelart.js', 'js/practice.js', 'css/app.css']) { try { h.update(fs.readFileSync(path.join(__dirname, '..', 'public', f))); } catch {} }
  return h.digest('hex').slice(0, 10);
})();
const DEFAULT_LOOK = { preset: 'm', face: 'oval', eyes: '#22252D', mouth: 'smile', beard: 'none', freckles: false, eyeShape: 'normal', outfit: 'hoodie', neck: 'none', hat: 'none', prop: 'none', bg: 'auto', hairStyle: 'short', hair: '#2B1D14', skin: '#E8B48A', hoodie: 'blue', glasses: false, phones: false, status: null, frame: null, crown: false,
  eyeSize: 'm', nose: 'button', ears: 'normal', makeup: 'none', earrings: 'none', glassesStyle: 'classic', glassesColor: 'black', lensColor: 'clear', pet: 'none', hatColor: 'same', mask: 'none', beardColor: 'same', mustacheColor: 'same' };
// plan — где обычно работаю по дням недели: { Пн: 'office' | 'home' }
// today — ручной статус на сегодня: { kind: 'home' | 'vacation', day: 'YYYY-MM-DD' }
// vacations — график отпусков: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }]
const DEFAULT_PROFILE = { coffee: false, mood: 'coffee', home: null, days: [], plan: {}, today: null, vacations: [], about: '', tags: [], bday: '', showBday: true, firstName: '', lastName: '', nameVis: 'gang', vacationLook: null, findable: true, dmFrom: 'all' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
// Отпуск вместе с прилегающими выходными и праздниками: когда реально начинается и кончается отдых,
// какой последний рабочий день перед ним и когда выходить. «2 дня отпуска → 5 дней отдыха».
function vacRest(v, today, night) {
  let restFrom = v.from;
  for (let i = 0; i < 14 && !weekdayName(addDays(restFrom, -1)); i++) restFrom = addDays(restFrom, -1);
  let back = addDays(v.to, 1);
  for (let i = 0; i < 14 && !weekdayName(back); i++) back = addDays(back, 1);
  const lastWork = addDays(restFrom, -1);
  let workLeft = 0;
  for (let d = today; d <= lastWork && workLeft < 60; d = addDays(d, 1)) if (weekdayName(d) && !(d === today && night)) workLeft++;
  const vacDays = dayDiff(v.from, v.to) + 1;
  return { from: v.from, to: v.to, in: dayDiff(today, v.from), restIn: dayDiff(today, (() => { let r = v.from; for (let i = 0; i < 14 && !weekdayName(addDays(r, -1)); i++) r = addDays(r, -1); return r; })()), vacDays, restFrom, restDays: dayDiff(restFrom, back), back, backDow: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(back + 'T00:00:00Z').getUTCDay()], lastWork, workLeft };
}
// День плана недели для рабочего дня; null — выходной или праздник по производственному календарю
const HOL = require('./holidays');
const SEASON = require('./seasons');
const VOICE_MOD = 'голосовое — звук модератору не передаётся и сгорает через час';
const weekdayName = (day) => HOL.workdayName(day);

// Имя и фамилия: scope 'gang' — смотрит кто-то из общей банды, 'all' — любой коллега
// Взаимность имён: кто сам не указал имя, тот не видит имён коллег (только ники).
// Кто смотрит — знаем из контекста запроса (AsyncLocalStorage), его заполняет requireUser
const { AsyncLocalStorage } = require('node:async_hooks');
const viewerCtx = new AsyncLocalStorage();
const hasOwnName = (prof) => !!String((prof && prof.firstName) || '').trim();
// Регистр имени: «иВАН» → «Иван», «римский-корсаков» → «Римский-Корсаков», «анна мария» → «Анна Мария»
function nameCase(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru')
    .replace(/(^|[\s-])([a-zа-яё])/g, (m, sep, ch) => sep + ch.toLocaleUpperCase('ru'));
}
function fullName(prof, scope) {
  const v = viewerCtx.getStore();
  if (v && v.noName) return '';
  // Имя видно всем коллегам: без него не получится общаться за пределами банды (личка, кофе, доска)
  return [prof.firstName, prof.lastName].filter(Boolean).join(' ');
}

// Заполненность профиля. Первый шаг — ник — засчитан сразу: начатое дело люди доводят до конца охотнее.
// Имя, фамилия и день рождения в процент не входят: личные данные — по желанию (но имена коллег видит только тот, кто указал своё).
const LOOK_KEYS = ['eyeGap', 'browShape', 'browColor', 'age', 'hairline', 'part', 'lips', 'mole', 'lashes', 'dimples', 'face', 'hairStyle', 'hair', 'skin', 'eyes', 'hoodie', 'mouth', 'beard', 'glasses', 'phones', 'freckles', 'preset', 'eyeShape', 'outfit', 'neck', 'hat', 'prop', 'bg', 'eyeSize', 'nose', 'ears', 'makeup', 'earrings', 'glassesStyle', 'glassesColor', 'lensColor', 'pet', 'beardColor', 'mustacheColor', 'hatColor', 'mask'];
function profileCompletion(look, prof, hasPush) {
  const steps = [
    { id: 'nick', label: 'Выбрать ник', done: true },
    { id: 'look', label: 'Настроить аватар', sec: 'look', done: LOOK_KEYS.some((k) => look[k] !== undefined && look[k] !== DEFAULT_LOOK[k]) },
    { id: 'home', label: 'Указать свой офис', sec: 'work', done: !!prof.home },
    { id: 'plan', label: 'Заполнить план недели', sec: 'work', done: Object.keys(prof.plan || {}).length >= 3 },
    { id: 'tags', label: 'Выбрать 2 интереса', sec: 'about', done: (prof.tags || []).length >= 2 },
    { id: 'about', label: 'Написать пару слов о себе', sec: 'about', done: !!prof.about },
    { id: 'push', label: 'Включить уведомления', sec: 'priv', done: !!hasPush }
  ];
  const done = steps.filter((s) => s.done).length;
  return { pct: Math.round((done / steps.length) * 100), steps };
}

function readProfile(json) {
  const prof = { ...DEFAULT_PROFILE, ...JSON.parse(json || '{}') };
  // Старое поле days («обычно в офисе») превращается в план
  if (prof.days.length && !Object.keys(prof.plan).length) prof.plan = Object.fromEntries(prof.days.map((d) => [d, 'office']));
  const today = U.msk().day;
  // Прошедший отпуск держим ещё неделю: выходные сразу после него — тоже «в отпуске»
  prof.vacations = prof.vacations.filter((v) => addDays(v.to, 7) >= today);
  // today: { kind, day, to } — ручной статус; «болею» может длиться несколько дней
  if (prof.today && (prof.today.to || prof.today.day) < today) prof.today = null;
  if (prof.today && prof.today.day > today) prof.today = null;
  return prof;
}

// Где человек сегодня. Приоритет: отметка в офисе (факт) → отпуск → болею → ручной статус → план → шутка
// seed — чтобы шуточный статус у человека был один на весь день, а не прыгал при каждом обновлении
function presenceOf(prof, checkin, seed = 0) {
  const day = U.msk().day;
  const manual = prof.today ? prof.today.kind : null;
  if (checkin) return { where: 'office', office: checkin.office_id };
  // Отпуск вместе с прилегающими выходными и праздниками: «в отпуске» уже с первого нерабочего дня перед ним
  // и до последнего выходного после — в эти дни зовы тоже не беспокоят
  for (const v of prof.vacations) {
    const r = vacRest(v, day, true);
    if (r.restFrom <= day && day < r.back) return { where: 'vacation', until: addDays(r.back, -1) };
  }
  if (manual === 'vacation') return { where: 'vacation', until: day };
  if (manual === 'sick') return { where: 'sick', until: prof.today.to || day };
  if (!weekdayName(day)) return { where: 'weekend', holiday: HOL.holidayName(day) };
  if (U.isAfterCheckinCutoff()) return { where: 'night' };
  if (manual === 'home') return { where: 'home', planned: false };
  if (manual === 'slack') return { where: 'slack' };
  const plan = prof.plan[weekdayName(day)];
  if (plan === 'home') return { where: 'home', planned: true };
  // План «в офис», но к 11:00 отметки нет — значит, план не сбылся: дальше шутка
  if (plan === 'office' && U.msk().hour < 11) return { where: 'plan_office', planned: true };
  if (U.msk().hour < 11) return { where: 'none' };
  const n = [...(day + ':' + seed)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return { where: 'idle', joke: n % IDLE_JOKES.length };
}
// Шуточные статусы для тех, кто не отметился к 11:00 и ничего не указал.
// Нарочно без «отлынивает»: система не знает, почему человека не видно, — обвинять нельзя.
const IDLE_JOKES = ['в астрале', 'где-то между Wi-Fi и кофе', 'режим невидимки', 'в параллельной вселенной', 'на секретной миссии', 'ушёл в себя, скоро вернётся'];
const IDLE_JOKES_F = ['в астрале', 'где-то между Wi-Fi и кофе', 'режим невидимки', 'в параллельной вселенной', 'на секретной миссии', 'ушла в себя, скоро вернётся'];
const TAGS = ['Кофе', 'Настолки', 'Бег', 'Велосипед', 'Викторины', 'Кино', 'Музыка', 'Книги', 'Путешествия', 'Кулинария', 'Футбол', 'Йога'];
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];

function createApi(db) {
  let features = null;
  let access = null;
  let league = null;
  let gevents = null;
  let crestvote = null;
  let gangwar = null;
  let duels = null;
  let tourney = null;
  let treasury = null;
  const MAX_MEMBERS = 30;      // больше 30 — уже не банда, а отдел
  const gangLimit = (g) => Math.min(g.max_members || MAX_MEMBERS, MAX_MEMBERS);
  let crew = null;
  let voice = null;
  let santa = null;
  let inbox = null;
  let board = null;
  let weather = null;
  let secret = null;
  let friday = null;
  let wave = null;
  let style = null;
  let battery = null;
  let todos = null;
  let advent = null;
  let battle = null;
  let quiz = null;
  let feedback = null;
  let polls = null;
  let blitz = null;
  const q = (sql) => db.prepare(sql);
  const adminHashes = new Set(config.adminEmails.map((e) => U.hashEmail(e)));

  // ---------- Пользователь и сессия ----------
  function parseCookies(req) {
    const out = {};
    (req.headers.cookie || '').split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out;
  }

  function sessionCookie(token, maxAgeSec) {
    const parts = [`etazh_s=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (config.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  function currentUser(req) {
    const token = parseCookies(req).etazh_s;
    if (!token) return null;
    const row = q(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                   WHERE s.token_hash = ? AND s.expires_at > ?`).get(U.sha256(token), U.now());
    if (!row) return null;
    row.look = { ...DEFAULT_LOOK, ...JSON.parse(row.look || '{}') };
    row.profile = readProfile(row.profile);
    row.isAdmin = adminHashes.has(row.email_hash);
    return row;
  }

  function requireUser(req, { nick = true } = {}) {
    const u = currentUser(req);
    if (!u) throw new HttpError(401, 'Нужно войти заново.');
    if (u.banned_until && u.banned_until > U.now()) throw new HttpError(403, 'Аккаунт временно заблокирован модератором.');
    if (nick && !u.nick) throw new HttpError(409, 'Сначала выбери никнейм.');
    const vc = viewerCtx.getStore();
    if (vc) vc.noName = !hasOwnName(u.profile);
    if (features && u.nick) features.onEvent('active', u.id);
    return u;
  }

  // ---------- Зёрна ----------
  // Серия: сколько рабочих дней подряд была отметка — в офисе или «из дома» (по журналу зёрен, он хранится всегда).
  // Выходные и праздники серию не рвут. Если сегодня ещё не отмечался — считаем до вчера: серия жива, пока не кончился день
  function markStreak(uid) {
    const days = new Set(q("SELECT DISTINCT day FROM ledger WHERE user_id = ? AND reason IN ('checkin', 'home') ORDER BY day DESC LIMIT 120").all(uid).map((r) => r.day));
    let n = 0, d = U.msk().day;
    if (!days.has(d)) d = addDays(d, -1);
    for (let guard = 0; guard < 150; guard++, d = addDays(d, -1)) {
      if (!weekdayName(d)) continue;
      if (days.has(d)) n++; else break;
    }
    return n;
  }
  // Награда за сегодняшнюю отметку: серия до вчера + сегодняшний день
  const todayMarkBeans = (uid) => streakBeans(markStreak(uid) + 1);
  // Серия для всплывающего окна: сколько дней подряд, сколько дали сегодня и сколько дадут завтра
  function streakInfo(uid) {
    const n = markStreak(uid);
    return { streak: n, streakBeans: STREAK_BEANS, today: streakBeans(n), tomorrow: streakBeans(n + 1) };
  }
  function addBeans(userId, reason, amountOverride) {
    const rule = EARN[reason];
    const amount = amountOverride || (rule ? rule.amount : 0);
    if (!amount) return 0;
    if (rule) {
      const day = U.msk().day;
      const n = q('SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND day = ? AND reason = ?').get(userId, day, reason).n;
      if (n >= rule.perDay) return 0;
    }
    q('INSERT INTO ledger (user_id, amount, reason, day, at) VALUES (?, ?, ?, ?, ?)').run(userId, amount, reason, U.msk().day, U.now());
    q('UPDATE users SET beans = beans + ? WHERE id = ?').run(amount, userId);
    if (league) league.award(userId, amount, reason);
    return amount;
  }

  function spendBeans(userId, amount, reason) {
    const r = q('UPDATE users SET beans = beans - ? WHERE id = ? AND beans >= ?').run(amount, userId, amount);
    if (!r.changes) return false;
    q('INSERT INTO ledger (user_id, amount, reason, day, at) VALUES (?, ?, ?, ?, ?)').run(userId, -amount, reason, U.msk().day, U.now());
    return true;
  }

  // ---------- Офис и столовая ----------
  const offices = (company) => q('SELECT * FROM offices ' + (company ? 'WHERE company = ? ' : '') + 'ORDER BY sort').all(...(company ? [company] : []));
  const companyOf = (x) => (x && x.company) || 'mts';
  const officeById = (id) => q('SELECT * FROM offices WHERE id = ?').get(id);

  function activeCheckin(userId) {
    if (U.isAfterCheckinCutoff()) return null;
    return q('SELECT * FROM checkins WHERE user_id = ? AND day = ? AND left_at IS NULL ORDER BY at DESC LIMIT 1').get(userId, U.msk().day) || null;
  }

  // Закон Литтла: людей в зале ≈ поток отметок × среднее время обеда ÷ доля пользователей
  function canteenEstimate(office) {
    const t = U.now();
    const n15 = q('SELECT COUNT(*) AS n FROM canteen WHERE office_id = ? AND at > ? AND at <= ?').get(office.id, t - 15 * 60e3, t).n;
    const prev = q('SELECT COUNT(*) AS n FROM canteen WHERE office_id = ? AND at > ? AND at <= ?').get(office.id, t - 30 * 60e3, t - 15 * 60e3).n;
    const est = ((n15 / 15) * office.lunch_w) / office.share_p;
    const load = est / office.seats;
    let label;
    let tone;
    if (load < 0.4) { label = 'Выбирай любой стол'; tone = 'good'; }
    else if (load < 0.75) { label = 'Место найдётся'; tone = 'ok'; }
    else if (load < 1) { label = 'Стулья на вес золота'; tone = 'warn'; }
    else { label = 'Негде сесть'; tone = 'bad'; }
    // Очередь ступенями: её либо нет, либо около 5, либо около 10 минут — дольше не бывает
    const raw = load > 1 ? (est - office.seats) / (office.seats / office.lunch_w) : 0;
    const wait = raw <= 0 ? 0 : raw <= 6 ? 5 : 10;
    const diff = n15 - prev;
    const trend = diff >= 3 ? 'up' : diff <= -3 ? 'down' : 'flat';
    let advice;
    if (wait >= 10) advice = { tone: 'bad', text: 'Очередь минут 10 — это долго. Если можно, сходи через полчаса или позови банду на поздний обед.' };
    else if (wait > 0) advice = { tone: 'warn', text: 'Небольшая очередь, минут 5. Терпимо, но через 20 минут будет свободнее.' };
    else if (load >= 0.75 && trend === 'up') advice = { tone: 'warn', text: 'Столовая забивается. Успей сейчас или подожди минут 30.' };
    else if (load >= 0.75) advice = { tone: 'warn', text: 'Мест мало, но поток стихает — через 15–20 минут станет свободнее.' };
    else if (load < 0.4) advice = { tone: 'good', text: 'Лучшее время пообедать: в зале свободно.' };
    else advice = { tone: 'good', text: 'Место в столовой найдётся, очереди нет.' };
    return {
      label, tone, pct: Math.min(100, Math.round(load * 100)), wait, trend, n15,
      lowData: n15 < 3, lunchW: Math.round(office.lunch_w), shareP: Math.round(office.share_p * 100), advice,
      forecast: canteenForecast(office)
    };
  }

  // Прогноз загрузки 12:00–14:30 по 15 минут: те же дни недели за 4 прошлые недели.
  // Время отметок хранится обезличенно 30 дней — этого хватает.
  function canteenForecast(office) {
    const today = U.msk().day;
    const tz = config.tzOffsetHours * 3600e3;
    const dayStart = (d) => Date.parse(d + 'T00:00:00Z') - tz;
    const weeks = [7, 14, 21, 28].map((n) => addDays(today, -n));
    const slots = [];
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const minute = 12 * 60 + i * 15 + 7.5; // середина слота
      let sum = 0;
      for (const d of weeks) {
        const t = dayStart(d) + minute * 60e3;
        sum += q('SELECT COUNT(*) AS n FROM canteen WHERE office_id = ? AND at > ? AND at <= ?').get(office.id, t - office.lunch_w * 60e3, t).n;
      }
      total += sum;
      const load = sum / weeks.length / office.share_p / office.seats;
      const h = Math.floor(minute / 60);
      const m = Math.floor((minute % 60) / 15) * 15;
      slots.push({ t: `${h}:${String(m).padStart(2, '0')}`, load: Math.round(load * 100) / 100 });
    }
    const now = U.msk();
    const nowMin = now.hour * 60 + now.minute;
    const current = nowMin >= 720 && nowMin < 870 ? Math.floor((nowMin - 720) / 15) : -1;
    const peak = slots.reduce((best, s, i) => (s.load > slots[best].load ? i : best), 0);
    return { slots, current, peak: slots[peak].t, enough: total >= 20 };
  }

  function recomputeLunchW(officeId) {
    const rows = q('SELECT at, done_at FROM canteen WHERE office_id = ? AND done_at IS NOT NULL AND at > ?').all(officeId, U.now() - 30 * 864e5);
    const ds = rows.map((r) => (r.done_at - r.at) / 60e3).filter((d) => d >= 5 && d <= 90);
    const w = (25 * 5 + ds.reduce((a, b) => a + b, 0)) / (5 + ds.length);
    q('UPDATE offices SET lunch_w = ? WHERE id = ?').run(Math.round(w * 10) / 10, officeId);
  }

  // Обезличенная статистика для плашки сверху: только счётчики, без ников и банд. Кэш на минуту
  const statsCache = new Map();
  function appStats(company = 'mts') {
    const hit = statsCache.get(company);
    if (hit && hit.until > U.now()) return hit.v;
    const day = U.msk().day;
    const tn = Number(day.replace(/-/g, ''));
    const weekAgo = Number(new Date(Date.parse(day + 'T00:00:00Z') - 6 * 864e5).toISOString().slice(0, 10).replace(/-/g, ''));
    const C = company;
    const v = {
      users: q('SELECT COUNT(*) AS n FROM users WHERE nick IS NOT NULL AND company = ?').get(C).n,
      gangs: q('SELECT COUNT(*) AS n FROM gangs WHERE hidden = 0 AND company = ?').get(C).n,
      inGangs: q('SELECT COUNT(DISTINCT m.user_id) AS n FROM gang_members m JOIN gangs g ON g.id = m.gang_id WHERE g.hidden = 0 AND g.company = ?').get(C).n,
      today: q("SELECT COUNT(*) AS n FROM counters c JOIN users x ON x.id = c.user_id WHERE c.key = 'last_active' AND c.n >= ? AND x.company = ?").get(tn, C).n,
      week: q("SELECT COUNT(*) AS n FROM counters c JOIN users x ON x.id = c.user_id WHERE c.key = 'last_active' AND c.n >= ? AND x.company = ?").get(weekAgo, C).n,
      inOffice: q('SELECT COUNT(DISTINCT c.user_id) AS n FROM checkins c JOIN users x ON x.id = c.user_id WHERE c.day = ? AND c.left_at IS NULL AND x.company = ?').get(day, C).n,
      newWeek: q('SELECT COUNT(*) AS n FROM users WHERE nick IS NOT NULL AND created_at > ? AND company = ?').get(U.now() - 7 * 864e5, C).n,
      msgsToday: q('SELECT COUNT(*) AS n FROM messages m JOIN gangs g ON g.id = m.gang_id WHERE m.at > ? AND g.company = ?').get(Date.parse(day + 'T00:00:00Z') - config.tzOffsetHours * 3600e3, C).n
    };
    statsCache.set(company, { v, until: U.now() + 60e3 });
    return v;
  }

  // ---------- Банды ----------
  const myGangs = (userId) => q(`SELECT g.* FROM gangs g JOIN gang_members m ON m.gang_id = g.id
                                 WHERE m.user_id = ? AND g.hidden = 0 ORDER BY m.joined_at`).all(userId);
  const isMember = (gangId, userId) => !!q('SELECT 1 FROM gang_members WHERE gang_id = ? AND user_id = ?').get(gangId, userId);
  const memberCount = (gangId) => q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(gangId).n;

  // Как аватар человека видят другие — одно правило для всех экранов (банда, подельники, бой, кофе, квизы).
  // Отпускной образ — только если человек в отпуске и сам показывает банде, где он.
  function publicLook(row) {
    const look = { ...DEFAULT_LOOK, ...JSON.parse(row.look || '{}') };
    if (row.profile === undefined) return look;
    const prof = readProfile(row.profile);
    let out = look;
    if (row.share_office && prof.vacationLook && presenceOf(prof, activeCheckin(row.id), row.id).where === 'vacation') {
      out = { ...look, ...prof.vacationLook, status: look.status, frame: look.frame, crown: look.crown };
    }
    // Таблички сами: «Скоро буду» — 20 минут после такого ответа на зов, «Тихо, работаю» — пока включён фокус.
    // Это не место и не здоровье, поэтому от «показывать, где я» не зависит; выключается в настройках
    if (prof.autoSign !== false) {
      if (prof.soon && prof.soon > U.now()) out = { ...out, prop: 'sign_soon' };
      else if (focusUntil(prof)) out = { ...out, prop: 'sign_quiet' };
    }
    return out;
  }

  function memberStatus(member) {
    const prof = readProfile(member.profile);
    const pr = member.share_office ? presenceOf(prof, activeCheckin(member.id), member.id) : { where: 'hidden' };
    const look = publicLook(member);
    return {
      id: member.id, nick: member.nick, name: fullName(prof, 'gang'), mood: (U.fem(look) && MOODS_F[prof.mood]) || MOODS[prof.mood] || '', where: pr.where, office: pr.office || null,
      until: pr.until || null, planned: !!pr.planned, joke: pr.joke ?? null, look, status: statusName(look.status),
      charge: battery ? battery.asking(member.id) : false, focus: focusUntil(prof),
      vacSoon: member.share_office && pr.where !== 'vacation' ? ((prof.vacations || []).find((v) => v.from > U.msk().day && dayDiff(U.msk().day, v.from) <= 5) || {}).from || null : null
    };
  }

  // «В фокусе»: до этого времени пуши не приходят, банда видит наушники
  const focusUntil = (prof) => (prof && prof.focus && prof.focus > U.now() ? prof.focus : null);

  const statusName = (id) => (SHOP.find((s) => s.id === id && s.kind === 'status') || {}).name || null;

  function gangMembers(gangId) {
    return q(`SELECT u.* FROM gang_members m JOIN users u ON u.id = m.user_id WHERE m.gang_id = ? ORDER BY m.joined_at`).all(gangId);
  }

  // ---------- Пуши ----------
  async function notify(userIds, payload, { ignoreQuiet = false } = {}) {
    if (!userIds.length) return;
    const quietNow = U.isQuietHour();
    for (const uid of userIds) {
      const u = q('SELECT quiet, profile FROM users WHERE id = ?').get(uid);
      if (!u) continue;
      if (!ignoreQuiet && quietNow && u.quiet) continue;
      // В отпуске зовы не беспокоят — увидит в чате, когда вернётся
      if (!ignoreQuiet && ['vacation', 'sick'].includes(presenceOf(readProfile(u.profile), activeCheckin(uid)).where)) continue;
      if (!ignoreQuiet && focusUntil(readProfile(u.profile))) continue;
      const subs = q('SELECT * FROM push_subs WHERE user_id = ?').all(uid);
      for (const s of subs) {
        const r = await sendPush(s, payload);
        if (r.gone) q('DELETE FROM push_subs WHERE id = ?').run(s.id);
      }
    }
  }

  const fireAndForget = (p) => p.catch((e) => console.error('[push]', e.message));

  function pushEvent(officeId, userId, text, kind = null) {
    q('INSERT INTO events (office_id, user_id, text, at, kind) VALUES (?, ?, ?, ?, ?)').run(officeId, userId, text, U.now(), kind);
  }
  const eventKind = (e) => e.kind || (e.office_id ? 'office' : /ачивк/.test(e.text) ? 'ach' : /купил/.test(e.text) ? 'shop' : /присоединил/.test(e.text) ? 'join' : 'other');

  // ---------- Маршруты ----------
  const routes = [];
  // Лимит тела запроса: в сообщения банды и лички может прийти голосовое (до 30 с), остальным хватает 64 КБ
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, maxBody: opts.maxBody || (method === 'POST' && pattern.endsWith('/messages') ? 600 * 1024 : 64 * 1024) });
  };

  // Вход: одноразовая ссылка на рабочую почту
  route('POST', '/api/auth/request', async (req, body) => {
    const email = U.normalizeEmail(body.email);
    rateLimit('auth-ip:' + req.ip, 10, 15 * 60e3);
    const company = U.companyByEmail(email);
    if (body.consent !== true) throw bad('Нужно согласие с политикой и правилами.');
    // Компании ещё нет в Этаже — заявка модератору через подтверждение почты
    if (!company) return access.request(email, req);
    const emailHash = U.hashEmail(email);
    rateLimit('auth-mail:' + emailHash, 3, 15 * 60e3);
    const token = U.randomToken(32);
    const code = String(require('node:crypto').randomInt(0, 1e6)).padStart(6, '0');
    q('INSERT INTO login_tokens (token_hash, email_hash, code_hash, expires_at, company) VALUES (?, ?, ?, ?, ?)')
      .run(U.sha256(token), emailHash, U.sha256(emailHash + ':' + code), U.now() + config.loginTokenMinutes * 60e3, company);
    // Пришёл по приглашению в банду или «стань подельником» — код едет в ссылке из письма:
    // письмо часто открывают в другом браузере, где приглашение из адресной строки потерялось бы
    const inv = [['j', body.join], ['c', body.crew]].filter(([, v]) => /^[A-Za-z0-9]{6}$/.test(String(v || ''))).map(([k, v]) => `&${k}=${String(v).toUpperCase()}`).join('');
    const link = `${config.baseUrl}/auth/verify?t=${token}${inv}`;
    try {
      await sendLoginLink(email, link, code);
    } catch (e) {
      // В лог — причина, но без адресов почты
      console.error('[mail] не отправлено:', String(e.message).replace(/[^\s<>@]+@[^\s<>@]+/g, '***'));
      throw new HttpError(502, 'Не удалось отправить письмо. Попробуй через пару минут — мы уже разбираемся.');
    }
    // Почта дальше нигде не используется и не сохраняется
    const dev = config.mailMode === 'console';
    return { ok: true, devLink: dev ? link : undefined, devCode: dev ? code : undefined };
  });

  // Вход по коду: нужен на iPhone, где установленное приложение не видит вход, сделанный в Safari
  route('POST', '/api/auth/code', async (req, body) => {
    const email = U.normalizeEmail(body.email);
    const emailHash = U.hashEmail(email);
    rateLimit('code-ip:' + req.ip, 20, 15 * 60e3);
    rateLimit('code-mail:' + emailHash, 5, 15 * 60e3);
    const code = String(body.code || '').replace(/\D/g, '');
    const row = q('SELECT token_hash FROM login_tokens WHERE email_hash = ? AND code_hash = ? AND used = 0 AND expires_at > ?')
      .get(emailHash, U.sha256(emailHash + ':' + code), U.now());
    if (!row) throw bad('Код не подошёл или устарел. Запроси новый.');
    const cookie = loginByTokenHash(row.token_hash);
    return { ok: true, _setCookie: cookie };
  });

  route('POST', '/api/auth/logout', async (req) => {
    const token = parseCookies(req).etazh_s;
    if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(U.sha256(token));
    return { ok: true, _setCookie: sessionCookie('', 0) };
  });

  // Удалить аккаунт и все данные
  route('DELETE', '/api/me', async (req) => {
    const u = requireUser(req, { nick: false });
    // У других тоже стираем упоминание этого человека в счётчиках ачивок (кто с кем переписывался)
    try { q('DELETE FROM ach_pairs WHERE other_id = ?').run(u.id); } catch {}
    q('DELETE FROM users WHERE id = ?').run(u.id);
    return { ok: true, _setCookie: sessionCookie('', 0) };
  });

  route('GET', '/api/me', async (req) => {
    const u = currentUser(req);
    if (!u) return { user: null, vapidKey: config.vapid.publicKey || null };
    const owned = q('SELECT item_id FROM owned WHERE user_id = ?').all(u.id).map((r) => r.item_id);
    const streak = markStreak(u.id);
    const earned = q('SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE user_id = ? AND amount > 0').get(u.id).s;
    const level = 1 + Math.floor(Math.sqrt(earned / 15));
    const completion = profileCompletion(u.look, u.profile, !!q('SELECT 1 FROM push_subs WHERE user_id = ?').get(u.id));
    // Что из Лавки уже по карману и ещё не куплено — для точки на плашке зёрен
    const affordable = SHOP.filter((it) => it.kind !== 'gang' && !owned.includes(it.id) && it.price <= u.beans
      && (!it.limit || q('SELECT COUNT(*) AS n FROM owned WHERE item_id = ?').get(it.id).n < it.limit)).map((it) => it.id);
    return {
      user: {
        completion, affordable,
        id: u.id, nick: u.nick, company: companyOf(u), companyName: (U.companyInfo(companyOf(u)) || {}).name || '', beans: u.beans, look: u.look, profile: u.profile, shareOffice: !!u.share_office, quiet: !!u.quiet,
        welcomed: !!u.welcomed, isAdmin: u.isAdmin, owned, newbie: U.now() - (u.created_at || 0) < 7 * 864e5, newbie3: U.now() - (u.created_at || 0) < 3 * 864e5, status: statusName(u.look.status), streak, level,
        // Погода на завтра для «Рядом»: с 15:00 накануне офисного дня, только если погода необычная
        weather: weather && U.msk().hour >= 15 ? weather.adviceFor(u.id, u.profile) : null,
        nickChangeableAt: u.nick_changed_at ? u.nick_changed_at + 30 * 864e5 : null, nickFree: !!u.nick && !u.nick_free_used,
        gangs: myGangs(u.id).map((g) => ({ id: g.id, name: g.name, color: g.color, emoji: g.emoji || null, ...U.crestPub(g) }))
      },
      vapidKey: config.vapid.publicKey || null, build: BUILD,
      domains: config.allowedDomains,
      catalog: {
        gangAreas: GANG_AREAS, gangItems: require('./treasury').ITEMS.map(({ id, slot, name }) => ({ id, slot, name })), gangInterests: GANG_INTERESTS, gangEmoji: GANG_EMOJI,
        moods: MOODS, moodsF: { ...MOODS, ...MOODS_F }, idleJokesF: IDLE_JOKES_F,
        calls: Object.fromEntries(Object.entries(CALLS).map(([k, v]) => [k, { label: v.label, opts: v.opts, needsText: !!v.needsText, textLabel: v.textLabel || (v.needsText ? 'Уточни' : null), textHint: v.textHint || '' }])),
        signals: Object.fromEntries(Object.entries(SIGNALS).map(([k, v]) => [k, v.label])),
        tags: TAGS, days: DAYS, look: LOOK, nickPrice: NICK_PRICE, memes: MEMES.map((m) => ({ ...m, on: SEASON.seasonOn(m.season, U.msk().day) })), memeEmos: MEME_EMOS, seasons: SEASON.activeSeasons(U.msk().day),
        parts: SHOP.filter((it) => it.kind === 'part').map(({ id, slot, value, name, price, legend, award, season }) => ({ id, slot, value, name, price, legend: !!legend, award: !!award, season: season || null, on: SEASON.seasonOn(season, U.msk().day), until: season && SEASON.seasonOn(season, U.msk().day) ? SEASON.nextWindow(season, U.msk().day).to : null })), gangColors: GANG_COLORS, idleJokes: IDLE_JOKES,
        offices: offices(companyOf(u)).map((o) => ({ id: o.id, name: o.name, color: o.color }))
      }
    };
  });

  route('GET', '/api/nick-suggestions', async () => {
    const adjs = ['бодрый', 'ночной', 'быстрый', 'тихий', 'весёлый', 'хитрый', 'солнечный', 'кофейный', 'смелый', 'мудрый'];
    const nouns = ['енот', 'кит', 'барсук', 'дракон', 'филин', 'ниндзя', 'пельмень', 'бобр', 'лис', 'ёж'];
    const out = new Set();
    let guard = 0;
    while (out.size < 4 && guard++ < 50) {
      const n = adjs[Math.floor(Math.random() * adjs.length)] + '_' + nouns[Math.floor(Math.random() * nouns.length)];
      if (!q('SELECT 1 FROM users WHERE nick = ?').get(n)) out.add(n);
    }
    return { nicks: [...out] };
  });

  route('POST', '/api/me/nick', async (req, body) => {
    const u = requireUser(req, { nick: false });
    const nick = U.cleanText(body.nick, 21).replace(/^@+/, '');
    if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]{3,20}$/.test(nick)) throw bad('От 3 до 20 символов: буквы, цифры и «_», без пробелов.');
    const prob = U.moderationProblem(nick);
    if (prob) throw bad(prob);
    if (u.nick && nick === u.nick) throw bad('Это и так твой никнейм.');
    // COLLATE NOCASE в SQLite не понимает кириллицу, поэтому занятость сверяем в JS без учёта регистра
    const low = nick.toLocaleLowerCase('ru');
    if (q('SELECT nick FROM users WHERE nick IS NOT NULL AND id != ? AND length(nick) = ?').all(u.id, nick.length).some((x) => x.nick.toLocaleLowerCase('ru') === low)) throw bad('Такой никнейм уже занят.');
    const first = !u.nick;
    // Первый ник бесплатный; одна смена тоже бесплатная, дальше — за зёрна
    const free = !first && !u.nick_free_used;
    if (!first && !free && !spendBeans(u.id, NICK_PRICE, 'nick')) throw bad(`Смена никнейма стоит ${NICK_PRICE} зёрен. Пока не хватает.`);
    q('UPDATE users SET nick = ?, nick_changed_at = ?, nick_free_used = nick_free_used + ? WHERE id = ?').run(nick, first ? null : U.now(), free ? 1 : 0, u.id);
    if (first && !u.welcomed) {
      addBeans(u.id, 'welcome');
      q('UPDATE users SET welcomed = 1 WHERE id = ?').run(u.id);
      pushEvent(null, u.id, `${nick} ${U.g(u.look, 'присоединился', 'присоединилась')} к Этажу`, 'join');
    }
    return { ok: true, nick, free };
  });

  route('POST', '/api/me/profile', async (req, body) => {
    const u = requireUser(req);
    const look = { ...u.look };
    const ownedSet = new Set(q('SELECT item_id FROM owned WHERE user_id = ?').all(u.id).map((r) => r.item_id));
    if (body.look) Object.assign(look, applyLook(look, body.look, ownedSet));
    const prof = { ...u.profile };
    if (body.profile) {
      const p = body.profile;
      // Образ для отпуска: второй аватар, который коллеги видят, пока ты в отпуске
      if (p.vacationLook !== undefined) prof.vacationLook = p.vacationLook === null ? null : applyLook({ ...DEFAULT_LOOK, ...u.look, status: null, frame: null, crown: false }, p.vacationLook, ownedSet);
      if (p.mood !== undefined && MOODS[p.mood]) prof.mood = p.mood;
      if (p.home !== undefined && (p.home === null || (officeById(p.home) && (officeById(p.home).company || 'mts') === companyOf(u)))) prof.home = p.home;
      if (p.plan && typeof p.plan === 'object') {
        prof.plan = {};
        for (const d of DAYS) if (p.plan[d] === 'office' || p.plan[d] === 'home') prof.plan[d] = p.plan[d];
        prof.days = [];
      }
      if (p.today !== undefined) {
        if (p.today === null) prof.today = null;
        else if (['home', 'vacation', 'slack'].includes(p.today.kind)) prof.today = { kind: p.today.kind, day: U.msk().day };
        else if (p.today.kind === 'sick') {
          const day = U.msk().day;
          const to = DATE_RE.test(p.today.to || '') ? p.today.to : day;
          if (to < day || to > addDays(day, 14)) throw bad('«Болею» можно поставить максимум на 14 дней вперёд.');
          prof.today = { kind: 'sick', day, to };
        }
        else throw bad('Неизвестный статус.');
      }
      if (Array.isArray(p.vacations)) {
        const today = U.msk().day;
        const maxDay = addDays(today, 400);
        const list = [];
        for (const v of p.vacations.slice(0, 12)) {
          if (!v || !DATE_RE.test(v.from) || !DATE_RE.test(v.to)) throw bad('Даты отпуска в формате ГГГГ-ММ-ДД.');
          if (v.to < v.from) throw bad('Конец отпуска раньше начала.');
          if (v.to > maxDay) throw bad('Планировать отпуск можно не дальше чем на год вперёд.');
          if (Date.parse(v.to) - Date.parse(v.from) > 60 * 864e5) throw bad('Один отпуск — не длиннее 60 дней. Разбей на части.');
          if (addDays(v.to, 7) >= today) list.push({ from: v.from, to: v.to });
        }
        list.sort((a, b) => a.from.localeCompare(b.from));
        for (let i = 1; i < list.length; i++) if (list[i].from <= list[i - 1].to) throw bad('Отпуска пересекаются.');
        prof.vacations = list;
      }
      if (p.about !== undefined) {
        const about = U.cleanText(p.about, 60);
        const prob = U.moderationProblem(about);
        if (prob) throw bad(prob);
        prof.about = about;
      }
      if (Array.isArray(p.tags)) prof.tags = TAGS.filter((t) => p.tags.includes(t)).slice(0, 5);
      if (p.bday !== undefined) {
        const b = String(p.bday || '');
        if (b && !/^(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])$/.test(b)) throw bad('День рождения в формате ДД.ММ, например 14.03.');
        prof.bday = b;
      }
      if (p.showBday !== undefined) prof.showBday = !!p.showBday;
      for (const k of ['firstName', 'lastName']) {
        if (p[k] === undefined) continue;
        const v = nameCase(U.cleanText(p[k], 30));
        // Имя и фамилия обязательны: заполненные стереть нельзя, только заменить
        if (!v && prof[k]) throw bad(k === 'firstName' ? 'Имя обязательно.' : 'Фамилия обязательна.');
        if (v && v.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '').length < 2) throw bad(k === 'firstName' ? 'Имя — хотя бы две буквы.' : 'Фамилия — хотя бы две буквы.');
        if (v && !/^[a-zA-Zа-яА-ЯёЁ][a-zA-Zа-яА-ЯёЁ' -]{0,29}$/.test(v)) throw bad('В имени и фамилии — только буквы, дефис и пробел.');
        const prob = v && U.moderationProblem(v);
        if (prob) throw bad(prob);
        prof[k] = v;
      }
      // nameVis больше не используется: имя видно всем коллегам
      if (p.coffee !== undefined) prof.coffee = !!p.coffee;
      // «Чем занимаюсь» и «Спроси меня про…»: по ним коллеги находят, кто за что отвечает
      if (p.role !== undefined) {
        const v = U.cleanText(p.role, 80);
        const prob = v && U.moderationProblem(v);
        if (prob) throw bad(prob);
        prof.role = v;
      }
      if (p.askMe !== undefined) {
        const list = (Array.isArray(p.askMe) ? p.askMe : String(p.askMe || '').split(','))
          .map((x) => U.cleanText(x, 24)).filter((x) => x.length >= 2);
        const uniq = [];
        for (const t of list) { const c = t[0].toLocaleUpperCase('ru') + t.slice(1); if (!uniq.some((x) => x.toLocaleLowerCase('ru') === c.toLocaleLowerCase('ru'))) uniq.push(c); }
        for (const t of uniq) { const prob = U.moderationProblem(t); if (prob) throw bad(prob); }
        if (uniq.length > 5) throw bad('Не больше пяти тем.');
        prof.askMe = uniq;
      }
      if (p.digest !== undefined) prof.digest = !!p.digest;
      if (p.matchShow !== undefined) prof.matchShow = !!p.matchShow;
      if (p.weather !== undefined) prof.weather = !!p.weather;
      if (p.monday !== undefined) prof.monday = !!p.monday;
      if (p.autoSign !== undefined) prof.autoSign = !!p.autoSign;
      if (p.focus !== undefined) {
        if (p.focus === null) prof.focus = null;
        else if (p.focus === 'eod') {
          const m = U.msk();
          const left = (19 * 60) - (m.hour * 60 + m.minute);
          if (left <= 0) throw bad('Рабочий день уже закончился — пуши и так стихли.');
          prof.focus = U.now() + left * 60e3;
        } else if ([30, 60, 120].includes(Number(p.focus))) prof.focus = U.now() + Number(p.focus) * 60e3;
        else throw bad('Фокус — на 30 минут, час, два или до конца дня.');
      }
      if (p.callTpl !== undefined) {
        if (!Array.isArray(p.callTpl)) throw bad('Шаблоны — списком.');
        const mine = new Set(myGangs(u.id).map((g) => g.id));
        const list = [];
        for (const t of p.callTpl.slice(0, 4)) {
          const def = t && CALLS[t.kind];
          if (!def) throw bad('Неизвестный зов.');
          const gang = Number(t.gang);
          if (!mine.has(gang)) throw bad('Шаблон — только для своей банды.');
          const opt = def.opts.includes(t.opt) ? t.opt : def.opts[0] || null;
          let text = def.textLabel ? U.cleanText(t.text, 40) || null : null;
          const prob = text && U.moderationProblem(text);
          if (prob) throw bad(prob);
          let to = null, toNick = null;
          if (t.to) {
            const r = q('SELECT id, nick FROM users WHERE id = ?').get(Number(t.to));
            if (!r || r.id === u.id || !isMember(gang, r.id)) throw bad('Этого человека нет в банде.');
            to = r.id; toNick = r.nick;
          }
          const key = [t.kind, gang, opt, text, to].join('|');
          if (list.some((x) => [x.kind, x.gang, x.opt, x.text, x.to].join('|') === key)) continue;
          list.push({ kind: t.kind, gang, opt, text, to, toNick });
        }
        if (p.callTpl.length > 4) throw bad('Не больше четырёх шаблонов.');
        prof.callTpl = list;
      }
      if (p.findable !== undefined) prof.findable = !!p.findable;
      if (['all', 'gang', 'none'].includes(p.dmFrom)) prof.dmFrom = p.dmFrom;
    }
    const share = body.shareOffice === undefined ? u.share_office : body.shareOffice ? 1 : 0;
    const quiet = body.quiet === undefined ? u.quiet : body.quiet ? 1 : 0;
    q('UPDATE users SET look = ?, profile = ?, share_office = ?, quiet = ? WHERE id = ?').run(JSON.stringify(look), JSON.stringify(prof), share, quiet, u.id);
    let homeBeans = 0;
    if (body.profile && body.profile.today && body.profile.today.kind === 'home') {
      if (weekdayName(U.msk().day) && !q('SELECT 1 FROM ledger WHERE user_id = ? AND day = ? AND reason = ?').get(u.id, U.msk().day, 'checkin')) homeBeans = addBeans(u.id, 'home', todayMarkBeans(u.id)) || 0;
      if (features) features.onEvent('home', u.id);
    }
    // План недели заполнен (от 3 дней) — +5 раз в неделю
    let planBeans = 0;
    if (body.profile && body.profile.plan && Object.keys(prof.plan || {}).length >= 3) {
      const d = U.msk().day, monday = addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
      if (!q("SELECT 1 FROM ledger WHERE user_id = ? AND reason = 'plan' AND day >= ?").get(u.id, monday)) planBeans = addBeans(u.id, 'plan') || 0;
    }
    if (features) features.onEvent('profile', u.id, { look: body.look !== undefined && Object.keys(body.look || {}).length > 0, slack: !!(body.profile && body.profile.today && body.profile.today.kind === 'slack') });
    return { ok: true, beans: homeBeans, planBeans, ...(homeBeans ? streakInfo(u.id) : {}) };
  });

  // Главный экран: офис, столовая, банда сейчас, счётчики новых событий
  route('GET', '/api/state', async (req, body, query) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    const office = ci ? officeById(ci.office_id) : null;
    const gangs = myGangs(u.id);
    const seen = new Set();
    const rows = [];
    for (const g of gangs) {
      for (const m of gangMembers(g.id)) {
        if (m.id === u.id || seen.has(m.id)) continue;
        seen.add(m.id);
        const st = memberStatus(m);
        const order = { office: 1, plan_office: 2, home: 3, slack: 3, idle: 4, none: 4, night: 4, weekend: 4, sick: 5, vacation: 5, hidden: 6 };
        const rank = st.where === 'office' && ci && st.office === ci.office_id ? 0 : order[st.where];
        rows.push({ ...st, gangId: g.id, rank });
      }
    }
    rows.sort((a, b) => a.rank - b.rank);
    const seenChat = Number(query.seenChat || 0);
    const seenFeed = Number(query.seenFeed || 0);
    const gangIds = gangs.map((g) => g.id);
    const newChat = gangIds.length
      ? q(`SELECT COUNT(*) AS n FROM messages WHERE gang_id IN (${gangIds.map(() => '?').join(',')}) AND at > ? AND hidden = 0 AND (user_id IS NULL OR user_id != ?)`).get(...gangIds, seenChat, u.id).n
      : 0;
    const newFeed = q('SELECT COUNT(*) AS n FROM events e WHERE at > ? AND (office_id IS NULL OR office_id = ?) AND (user_id IS NULL OR (user_id != ? AND EXISTS (SELECT 1 FROM users x WHERE x.id = e.user_id AND x.company = ?)))').get(seenFeed, ci ? ci.office_id : '', u.id, companyOf(u)).n
      + (ci ? q('SELECT COUNT(*) AS n FROM signals WHERE office_id = ? AND at > ? AND hidden = 0 AND expires_at > ?').get(ci.office_id, seenFeed, U.now()).n : 0);
    const canteenOpen = ci ? q('SELECT * FROM canteen WHERE user_id = ? AND done_at IS NULL AND at > ? ORDER BY at DESC LIMIT 1').get(u.id, U.now() - 60 * 60e3) : null;
    return {
      now: U.now(), msk: U.msk().hhmm, night: U.isAfterCheckinCutoff(),
      // Вечером — кто из банд в офисе в следующий рабочий день
      tomorrow: U.isAfterCheckinCutoff() && features ? features.gangTomorrow(u.id) : null,
      weekNote: features ? features.weekNote(u.id) : null,
      beans: q('SELECT beans FROM users WHERE id = ?').get(u.id).beans,
      checkin: ci ? { office: ci.office_id, name: office.name, at: ci.at, since: U.msk(ci.at).hhmm } : null,
      today: U.msk().day, build: BUILD,
      // Для приветствия: завтра праздник (а сегодня рабочий день) — «предпраздничный» набор фраз
      tomorrowHoliday: weekdayName(U.msk().day) ? HOL.holidayName(addDays(U.msk().day, 1)) : null,
      presence: presenceOf(u.profile, ci, u.id),
      // Имена коллег скрыты, пока не укажешь своё: сколько бандитов уже указали
      nameLock: hasOwnName(u.profile) ? null : (() => {
        const ids = new Set(); gangs.forEach((g) => gangMembers(g.id).forEach((m) => { if (m.id !== u.id) ids.add(m.id); }));
        const rows = [...ids].map((id) => q('SELECT profile FROM users WHERE id = ?').get(id)).filter(Boolean).map((r) => readProfile(r.profile));
        const named = rows.filter((p) => hasOwnName(p)).length;
        return named ? { named, total: rows.length } : null;
      })(),
      nextVacation: (() => { const v = u.profile.vacations.filter((x) => x.from > U.msk().day).sort((a, b) => (a.from < b.from ? -1 : 1))[0]; return v ? vacRest(v, U.msk().day, U.isAfterCheckinCutoff()) : null; })(),
      vacNow: (() => { const pr = presenceOf(u.profile, ci, u.id); return pr.where === 'vacation' ? vacRest({ from: U.msk().day, to: pr.until || U.msk().day }, U.msk().day, true) : null; })(),
      canteen: office ? canteenEstimate(office) : null,
      inCanteen: !!canteenOpen,
      gangNow: { hasGang: gangs.length > 0, rows: rows.slice(0, 6), more: Math.max(0, rows.length - 6) },
      stats: appStats(companyOf(u)),
      badges: { chat: newChat, feed: newFeed, crew: (crew ? crew.unread(u.id) : 0) + (secret ? secret.unread(u.id) : 0), invites: q("SELECT COUNT(*) AS n FROM gang_invites WHERE to_id = ? AND status = 'pending'").get(u.id).n, feedback: feedback ? feedback.unseen(u.id) : 0, gangRequests: q("SELECT COUNT(*) AS n FROM gang_requests r JOIN gangs g ON g.id = r.gang_id WHERE g.owner_id = ? AND r.status = 'pending'").get(u.id).n, polls: polls ? polls.unvoted(u.id) : 0, duels: duels ? duels.myTurns(u.id) : 0 }
    };
  });

  route('POST', '/api/checkin', async (req, body) => {
    const u = requireUser(req);
    if (U.isAfterCheckinCutoff()) throw bad('Отметки откроются завтра утром.');
    const office = officeById(body.office);
    if (!office || (office.company || 'mts') !== companyOf(u)) throw bad('Нет такого офиса.');
    const day = U.msk().day;
    const ci = activeCheckin(u.id);
    if (ci && ci.office_id === office.id) return { ok: true, beans: 0 };
    if (ci) q('UPDATE checkins SET left_at = ? WHERE id = ?').run(U.now(), ci.id);
    q('INSERT INTO checkins (user_id, office_id, day, at) VALUES (?, ?, ?, ?)').run(u.id, office.id, day, U.now());
    // Пришёл в офис — ручной статус «дома/отпуск» на сегодня больше не актуален
    if (u.profile.today) q('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify({ ...u.profile, today: null }), u.id);
    // За день — одна награда: офис или «из дома». Если «из дома» уже оплачено, отметку пишем с нулём:
    // запись в журнале нужна для серии дней в офисе
    let got = 0;
    if (q('SELECT 1 FROM ledger WHERE user_id = ? AND day = ? AND reason = ?').get(u.id, U.msk().day, 'home')) q('INSERT INTO ledger (user_id, amount, reason, day, at) VALUES (?, 0, ?, ?, ?)').run(u.id, 'checkin', day, U.now());
    else got = addBeans(u.id, 'checkin', todayMarkBeans(u.id));
    if (features) features.onEvent('checkin', u.id, { office: office.id });
    if (u.share_office) pushEvent(office.id, u.id, `${u.nick} в офисе`, 'office');
    return { ok: true, beans: got, ...(got ? streakInfo(u.id) : {}) };
  });

  route('POST', '/api/checkout', async (req) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    if (ci) q('UPDATE checkins SET left_at = ? WHERE id = ?').run(U.now(), ci.id);
    q('UPDATE canteen SET done_at = ? WHERE user_id = ? AND done_at IS NULL').run(U.now(), u.id);
    if (ci && features) features.onEvent('checkout', u.id, { since: ci.at });
    return { ok: true };
  });

  route('POST', '/api/canteen/in', async (req) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    if (!ci) throw bad('Сначала отметься в офисе.');
    const open = q('SELECT 1 FROM canteen WHERE user_id = ? AND done_at IS NULL AND at > ?').get(u.id, U.now() - 60 * 60e3);
    if (open) throw bad('Ты уже отмечен в столовой.');
    q('INSERT INTO canteen (user_id, office_id, at) VALUES (?, ?, ?)').run(u.id, ci.office_id, U.now());
    const got = addBeans(u.id, 'canteen');
    if (features) features.onEvent('canteen', u.id);
    return { ok: true, beans: got };
  });

  route('POST', '/api/canteen/out', async (req) => {
    const u = requireUser(req);
    const row = q('SELECT * FROM canteen WHERE user_id = ? AND done_at IS NULL ORDER BY at DESC LIMIT 1').get(u.id);
    if (!row) return { ok: true, counted: false };
    q('UPDATE canteen SET done_at = ? WHERE id = ?').run(U.now(), row.id);
    const minutes = Math.round((U.now() - row.at) / 60e3);
    if (minutes >= 5 && minutes <= 90) recomputeLunchW(row.office_id);
    return { ok: true, counted: minutes >= 5 && minutes <= 90, minutes };
  });

  // ---------- Банды ----------
  route('POST', '/api/gangs', async (req, body) => {
    const u = requireUser(req);
    const name = U.cleanText(body.name, 30);
    if (name.length < 2) throw bad('Придумай банде название.');
    const prob = U.moderationProblem(name);
    if (prob) throw bad(prob === 'Такой текст не пройдёт модерацию.' ? 'Такое название не пройдёт модерацию. Банда — за что-то, а не против кого-то.' : prob);
    if (q('SELECT 1 FROM gangs WHERE name = ? COLLATE NOCASE').get(name)) throw bad('Банда с таким названием уже есть.');
    const color = GANG_COLORS.includes(body.color) ? body.color : GANG_COLORS[Math.floor(Math.random() * GANG_COLORS.length)];
    const was = myGangs(u.id);
    if (was.length && !body.switch) throw inGangError(was[0]);
    if (!spendBeans(u.id, GANG_DEPOSIT, 'gang_deposit')) throw bad(`Нужно ${GANG_DEPOSIT} зёрен на залог. Залог вернётся, когда в банде будет 3 человека.`);
    let code;
    do code = U.shortCode(6); while (q('SELECT 1 FROM gangs WHERE code = ?').get(code));
    const prof = gangProfileInput(body, {});
    const r = q('INSERT INTO gangs (name, color, code, owner_id, deposit, created_at, about, area, interests, emoji, access, crest, company) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, color, code, u.id, U.now(), prof.about, prof.area, JSON.stringify(prof.interests), prof.emoji, prof.access || 'request', prof.crest || null, companyOf(u));
    for (const o of was) leaveGang(u.id, o.id);
    q('INSERT INTO gang_members (gang_id, user_id, joined_at) VALUES (?, ?, ?)').run(r.lastInsertRowid, u.id, U.now());
    if (league) league.touch(Number(r.lastInsertRowid), [u.id]);
    if (features) features.onEvent('gang_join', u.id);
    return { ok: true, id: Number(r.lastInsertRowid), code };
  });

  route('POST', '/api/gangs/join', async (req, body) => {
    const u = requireUser(req);
    const m = /([A-Z2-9]{6})\s*$/i.exec(String(body.code || '').trim());
    if (!m) throw bad('Это не похоже на ссылку банды.');
    const g = q('SELECT * FROM gangs WHERE code = ? AND hidden = 0').get(m[1].toUpperCase());
    if (!g) throw bad('Ссылка банды не найдена или банда закрыта.');
    if (isMember(g.id, u.id)) return { ok: true, id: g.id, already: true };
    joinGang(u, g, { switch: !!body.switch });
    return { ok: true, id: g.id };
  });

  // Выйти из банды: владелец передаёт банду самому раннему участнику, пустая банда удаляется
  function leaveGang(uid, gid) {
    const g = q('SELECT * FROM gangs WHERE id = ?').get(gid);
    if (!g) return;
    if (league) league.touch(gid, [uid]);
    q('DELETE FROM gang_members WHERE gang_id = ? AND user_id = ?').run(gid, uid);
    const next = q('SELECT user_id FROM gang_members WHERE gang_id = ? ORDER BY joined_at LIMIT 1').get(gid);
    if (!next) q('DELETE FROM gangs WHERE id = ?').run(gid);
    else if (g.owner_id === uid) q('UPDATE gangs SET owner_id = ? WHERE id = ?').run(next.user_id, gid);
  }
  const otherGangs = (uid, gid) => myGangs(uid).filter((x) => x.id !== gid);
  const inGangError = (o) => bad(`Ты уже в банде «${o.name}». Банда может быть только одна: выйди из неё или подтверди переход.`);

  // Банда у человека одна: вступление в новую = выход из старой, но только с явного согласия (opts.switch)
  // Банды — только внутри своей компании
  const otherCompany = (u, g) => companyOf(g) !== companyOf(u);
  const companyErr = () => bad('Это банда другой компании. Банды собираются внутри своей компании — а дружить можно подельниками.');
  function joinGang(u, g, opts = {}) {
    if (otherCompany(u, g)) throw companyErr();
    if (!isMember(g.id, u.id) && memberCount(g.id) >= gangLimit(g)) throw bad(gangLimit(g) === MAX_MEMBERS ? `В банде уже ${MAX_MEMBERS} — это максимум.` : `В банде уже ${gangLimit(g)} — это предел, который поставил владелец.`);
    const others = otherGangs(u.id, g.id);
    if (others.length && !opts.switch) throw inGangError(others[0]);
    for (const o of others) leaveGang(u.id, o.id);
    if (league) league.touch(g.id, [u.id]);
    q("DELETE FROM gang_requests WHERE gang_id = ? AND user_id = ?").run(g.id, u.id);
    q('INSERT OR IGNORE INTO gang_members (gang_id, user_id, joined_at) VALUES (?, ?, ?)').run(g.id, u.id, U.now());
    if (g.deposit && memberCount(g.id) >= 3 && g.owner_id) {
      q('UPDATE gangs SET deposit = 0 WHERE id = ?').run(g.id);
      addBeans(g.owner_id, 'deposit_back');
    }
    if (features) features.onEvent('gang_join', u.id);
  }

  // ---------- Профиль банды, поиск банд, заявки, настройки ----------
  const ACCESS = ['open', 'request', 'invite'];
  function crestClean(c) {
    const ok = (list, v, d) => (list.includes(v) ? v : d);
    return JSON.stringify({ shape: ok(CREST.shape, c.shape, 'heater'), div: ok(CREST.div, c.div, 'plain'), c1: ok(CREST.tincture, c.c1, 'blue'), c2: ok(CREST.tincture, c.c2, 'gold'),
      charge: ok(CREST.charge, c.charge, 'star'), cc: ok(CREST.tincture, c.cc, 'gold'), top: ok(CREST.top, c.top, 'none'), motto: c.motto !== false });
  }
  function gangProfileInput(b, cur) {
    const out = {};
    if (b.about !== undefined) {
      const t = U.cleanText(b.about || '', 160);
      const prob = t && U.moderationProblem(t);
      if (prob) throw bad(prob);
      out.about = t || null;
    } else out.about = cur.about || null;
    out.area = b.area !== undefined ? (GANG_AREAS.includes(b.area) ? b.area : null) : cur.area || null;
    out.interests = b.interests !== undefined ? (Array.isArray(b.interests) ? [...new Set(b.interests.filter((x) => GANG_INTERESTS.includes(x)))].slice(0, 6) : []) : JSON.parse(cur.interests || '[]');
    out.emoji = b.emoji !== undefined ? (GANG_EMOJI.includes(b.emoji) ? b.emoji : null) : cur.emoji || null;
    out.access = b.access !== undefined ? (ACCESS.includes(b.access) ? b.access : 'request') : cur.access;
    // Герб: только известные части; null — вернуть автогерб
    if (b.crest === null) out.crest = null;
    else if (b.crest && typeof b.crest === 'object') out.crest = crestClean(b.crest);
    else out.crest = cur.crest || null;
    return out;
  }
  // После 19:00 отметки уже не действуют: «в офисе» у банды — 0, как и у отдельных людей
  const gangOffice = (gid) => U.isAfterCheckinCutoff() ? 0 : q(`SELECT COUNT(*) AS n FROM gang_members m JOIN users u ON u.id = m.user_id
    WHERE m.gang_id = ? AND u.share_office = 1 AND EXISTS (SELECT 1 FROM checkins c WHERE c.user_id = u.id AND c.day = ? AND c.left_at IS NULL)`).get(gid, U.msk().day).n;
  // «Легенда ноября» — только пока идёт следующий месяц
  const legendLabel = (ym) => { const d = U.msk().day; const [y, m] = ym.split('-').map(Number); const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; return d.slice(0, 7) === next ? `Легенда ${league.MONTHS_GEN[m - 1]}` : null; };
  // Карточка банды: её видят и те, кто не в банде, если банда открыта для поиска
  function gangCard(g, uid) {
    const count = memberCount(g.id);
    const owner = g.owner_id ? (q('SELECT nick FROM users WHERE id = ?').get(g.owner_id) || {}).nick : null;
    const faces = q('SELECT u.id, u.nick, u.look, u.profile, u.share_office FROM gang_members m JOIN users u ON u.id = m.user_id WHERE m.gang_id = ? ORDER BY m.joined_at LIMIT 8').all(g.id)
      .map((m) => ({ id: m.id, nick: m.nick, look: publicLook(m) }));
    const req = uid ? q('SELECT status FROM gang_requests WHERE gang_id = ? AND user_id = ?').get(g.id, uid) : null;
    return {
      id: g.id, name: g.name, color: g.color, emoji: g.emoji || null, about: g.about || '', area: g.area || null, interests: JSON.parse(g.interests || '[]'),
      access: g.access || 'invite', count, max: gangLimit(g), full: count >= gangLimit(g), owner,
      ...U.crestPub(g), glory: treasury ? treasury.balance(g.id) : 0, wars: gangwar ? gangwar.record(g.id) : null, cups: tourney ? tourney.cups(g.id) : 0, trophies: league ? league.trophies(g.id) : null, legend: g.legend_month && league ? legendLabel(g.legend_month) : null, motto: g.motto || '', gold: !!g.gold,
      officeName: g.office_id ? (officeById(g.office_id) || {}).name || null : null,
      inOffice: gangOffice(g.id), msgsWeek: q('SELECT COUNT(*) AS n FROM messages WHERE gang_id = ? AND at > ?').get(g.id, U.now() - 7 * 864e5).n,
      since: g.created_at, faces, member: uid ? isMember(g.id, uid) : false, requested: !!(req && req.status === 'pending')
    };
  }

  route('GET', '/api/gangs/search', async (req, body, query) => {
    const u = requireUser(req);
    rateLimit('gsearch:' + u.id, 60, 3600e3);
    const needle = String(query.q || '').trim().toLocaleLowerCase('ru').slice(0, 40);
    const area = GANG_AREAS.includes(query.area) ? query.area : null;
    const interest = GANG_INTERESTS.includes(query.interest) ? query.interest : null;
    let rows = q("SELECT * FROM gangs WHERE hidden = 0 AND access IN ('open', 'request') AND company = ?").all(companyOf(u));
    if (area) rows = rows.filter((g) => g.area === area);
    if (interest) rows = rows.filter((g) => JSON.parse(g.interests || '[]').includes(interest));
    if (needle) rows = rows.filter((g) => [g.name, g.about, g.area, ...(JSON.parse(g.interests || '[]'))].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(needle));
    if (!needle && !area && !interest) {
      // Ничего не ввели — рекомендуем: банды из твоего офиса, живые, с местами
      const myOffice = (q('SELECT office_id FROM checkins WHERE user_id = ? ORDER BY at DESC LIMIT 1').get(u.id) || {}).office_id || null;
      const items = rows.map((g) => {
        const c = gangCard(g, u.id);
        const why = [];
        let rank = 0;
        if (myOffice && g.office_id === myOffice) { rank += 3; why.push('твой офис'); }
        if (c.inOffice) rank += 1 + Math.min(c.inOffice, 5) / 5;
        if (c.msgsWeek >= 10) { rank += 1; why.push('живой чат'); }
        if (c.trophies && c.trophies.w[0] + c.trophies.m[0]) { rank += 1; why.push('призёр Лиги'); }
        if (c.full) rank -= 10;
        return { ...c, why: why.join(' · '), rank: rank + Math.min(c.count, 30) / 60 };
      }).filter((c) => !c.member).sort((a, b) => b.rank - a.rank).slice(0, 12);
      return { items, recommended: true };
    }
    const items = rows.map((g) => gangCard(g, u.id)).sort((a, b) => Number(a.member) - Number(b.member) || b.count - a.count).slice(0, 30);
    return { items };
  });

  route('GET', '/api/gangs/:id/profile', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(params.id));
    if (!g || (!isMember(g.id, u.id) && (!['open', 'request'].includes(g.access) || otherCompany(u, g)))) throw new HttpError(404, 'Банда не найдена или скрыта.');
    return gangCard(g, u.id);
  });

  // Открытая банда — вступаешь сразу; по заявке — владелец решает; «только по приглашению» — только ссылкой или приглашением
  route('POST', '/api/gangs/:id/apply', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(params.id));
    if (!g) throw new HttpError(404, 'Банда не найдена.');
    if (isMember(g.id, u.id)) return { ok: true, member: true, id: g.id };
    if (otherCompany(u, g)) throw companyErr();
    if (g.access === 'open') { joinGang(u, g, { switch: !!body.switch }); return { ok: true, member: true, id: g.id }; }
    if (g.access !== 'request') throw bad('В эту банду попадают только по приглашению.');
    if (memberCount(g.id) >= gangLimit(g)) throw bad('В банде нет мест.');
    // Заявка из другой банды — только с согласием: когда владелец примет, человек перейдёт
    const others = otherGangs(u.id, g.id);
    if (others.length && !body.switch) throw inGangError(others[0]);
    rateLimit('gapply:' + u.id, 10, 24 * 3600e3);
    const was = q('SELECT status FROM gang_requests WHERE gang_id = ? AND user_id = ?').get(g.id, u.id);
    if (was && was.status === 'declined') throw bad('Заявку уже отклонили. Попробуй позже или попроси приглашение.');
    q("INSERT OR REPLACE INTO gang_requests (gang_id, user_id, at, status) VALUES (?, ?, ?, 'pending')").run(g.id, u.id, U.now());
    if (g.owner_id) fireAndForget(notify([g.owner_id], { title: g.name, body: `${u.nick} ${U.g(u.look, 'хочет', 'хочет')} в банду — прими или откажи`, url: `/#gang/${g.id}`, tag: `greq-${g.id}` }));
    return { ok: true, requested: true };
  });
  route('POST', '/api/gangs/:id/apply/cancel', async (req, body, query, params) => {
    const u = requireUser(req);
    q("DELETE FROM gang_requests WHERE gang_id = ? AND user_id = ? AND status = 'pending'").run(Number(params.id), u.id);
    return { ok: true };
  });

  const ownGang = (u, id) => {
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(id));
    if (!g || !isMember(g.id, u.id)) throw new HttpError(404, 'Банда не найдена.');
    if (g.owner_id !== u.id) throw bad('Это может только владелец банды.');
    return g;
  };
  route('POST', '/api/gangs/:id/requests/:uid/:action', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    const r = q("SELECT * FROM gang_requests WHERE gang_id = ? AND user_id = ? AND status = 'pending'").get(g.id, Number(params.uid));
    if (!r) throw bad('Заявка уже неактуальна.');
    const who = q('SELECT * FROM users WHERE id = ?').get(r.user_id);
    if (params.action === 'accept') {
      joinGang({ ...who, look: JSON.parse(who.look || '{}') }, g, { switch: true });
      fireAndForget(notify([who.id], { title: g.name, body: 'Заявка принята — ты в банде!', url: `/#gang/${g.id}`, tag: `greq-${g.id}` }));
      return { ok: true };
    }
    q("UPDATE gang_requests SET status = 'declined', at = ? WHERE gang_id = ? AND user_id = ?").run(U.now(), g.id, who.id);
    return { ok: true };
  });

  route('POST', '/api/gangs/:id/settings', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    const p = gangProfileInput({ ...body, crest: undefined }, g); // герб меняется только голосованием банды
    let name = g.name;
    if (body.name !== undefined && U.cleanText(body.name, 30) !== g.name) {
      name = U.cleanText(body.name, 30);
      if (name.length < 2) throw bad('Название — от 2 символов.');
      const prob = U.moderationProblem(name);
      if (prob) throw bad(prob);
      if (q('SELECT 1 FROM gangs WHERE name = ? COLLATE NOCASE AND id != ?').get(name, g.id)) throw bad('Банда с таким названием уже есть.');
    }
    const max = body.maxMembers !== undefined ? Math.max(0, Math.min(MAX_MEMBERS, Number(body.maxMembers) || 0)) : g.max_members;
    if (max && max < memberCount(g.id)) throw bad(`В банде уже ${memberCount(g.id)} — предел не может быть меньше.`);
    const who = body.whoInvites !== undefined ? (body.whoInvites === 'owner' ? 'owner' : 'all') : g.who_invites;
    const office = body.office !== undefined ? (body.office && officeById(body.office) ? body.office : null) : g.office_id;
    const color = GANG_COLORS.includes(body.color) ? body.color : g.color;
    q('UPDATE gangs SET name = ?, about = ?, area = ?, interests = ?, emoji = ?, access = ?, max_members = ?, who_invites = ?, office_id = ?, color = ?, crest = ? WHERE id = ?')
      .run(name, p.about, p.area, JSON.stringify(p.interests), p.emoji, p.access, max, who, office, color, p.crest, g.id);
    // Открыли банду — висящие заявки принимаем сразу
    if (p.access === 'open') for (const r of q("SELECT user_id FROM gang_requests WHERE gang_id = ? AND status = 'pending'").all(g.id)) {
      const who2 = q('SELECT * FROM users WHERE id = ?').get(r.user_id);
      try { joinGang({ ...who2, look: JSON.parse(who2.look || '{}') }, { ...g, max_members: max }, { switch: true }); } catch {}
    }
    return { ok: true };
  });

  route('POST', '/api/gangs/:id/kick/:uid', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    const uid = Number(params.uid);
    if (uid === u.id) throw bad('Себя не выгоняют — передай банду и выйди.');
    if (league) league.touch(g.id, [uid]);
    q('DELETE FROM gang_members WHERE gang_id = ? AND user_id = ?').run(g.id, uid);
    // Чтобы не вернулся заявкой на следующий же день — только новым приглашением
    q("INSERT OR REPLACE INTO gang_requests (gang_id, user_id, at, status) VALUES (?, ?, ?, 'declined')").run(g.id, uid, U.now());
    return { ok: true };
  });
  route('POST', '/api/gangs/:id/owner/:uid', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    const uid = Number(params.uid);
    if (!isMember(g.id, uid)) throw bad('Передать можно только участнику банды.');
    q('UPDATE gangs SET owner_id = ? WHERE id = ?').run(uid, g.id);
    fireAndForget(notify([uid], { title: g.name, body: `${u.nick} ${U.g(u.look, 'передал', 'передала')} тебе банду — теперь ты владелец`, url: `/#gang/${g.id}`, tag: `gown-${g.id}` }));
    return { ok: true };
  });

  // ---------- Поиск коллег по базе ----------
  // По нику — всех, кто не отключил поиск; по имени — только тех, кто открыл имя всем;
  // по почте — точное совпадение отпечатка (почту мы не храним, перебрать список нельзя)
  // «Кто знает про…»: поиск по темам «Спроси меня про» и по строке «Чем занимаюсь» — на весь Этаж
  route('GET', '/api/experts', async (req, body, query) => {
    const u = requireUser(req);
    rateLimit('experts:' + u.id, 60, 3600e3);
    const raw = String(query.q || '').trim().toLocaleLowerCase('ru').slice(0, 40);
    // «парковку» находит «Парковка»: ищем по основе без окончания
    const needle = raw.length > 5 ? raw.slice(0, -2) : raw;
    const rows = q("SELECT id, nick, look, profile FROM users WHERE nick IS NOT NULL AND id != ? AND company = ?").all(u.id, companyOf(u)).map((r) => ({ r, p: readProfile(r.profile) }));
    // Популярные темы — подсказки для поиска
    const count = new Map();
    for (const { p } of rows) for (const t of p.askMe || []) { const k = t.toLocaleLowerCase('ru'); const c = count.get(k) || { t, n: 0 }; c.n++; count.set(k, c); }
    const popular = [...count.values()].sort((a, b) => b.n - a.n).slice(0, 12).map((x) => x.t);
    if (needle.length < 2) return { items: [], popular, mine: { role: u.profile.role || '', askMe: u.profile.askMe || [] } };
    const day = U.msk().day;
    const items = rows.map(({ r, p }) => {
      const tags = (p.askMe || []).filter((t) => t.toLocaleLowerCase('ru').includes(needle));
      const roleHit = (p.role || '').toLocaleLowerCase('ru').includes(needle);
      if (!tags.length && !roleHit) return null;
      // Ближайший офисный день по плану — чтобы сразу понять, когда поймать вживую
      let officeDay = null;
      for (let i = 0; i < 7 && !officeDay; i++) { const d = addDays(day, i); const w = weekdayName(d); if (w && p.plan[w] === 'office') officeDay = i === 0 ? 'сегодня' : i === 1 ? 'завтра' : w; }
      return { id: r.id, nick: r.nick, name: fullName(p, 'all'), look: publicLook(r), role: p.role || '', tags, allTags: p.askMe || [], office: (officeById(p.home) || {}).name || null, officeDay, rank: tags.length * 2 + (roleHit ? 1 : 0) };
    }).filter(Boolean).sort((a, b) => b.rank - a.rank || a.nick.localeCompare(b.nick, 'ru')).slice(0, 30);
    return { items, popular, mine: { role: u.profile.role || '', askMe: u.profile.askMe || [] } };
  });

  route('GET', '/api/search', async (req, body, query) => {
    const u = requireUser(req);
    rateLimit('search:' + u.id, 30, 3600e3);
    const raw = String(query.q || '').trim().slice(0, 80);
    if (raw.length < 2) return { items: [], hint: 'Введи хотя бы 2 буквы ника или рабочую почту целиком' };
    let rows = [];
    if (raw.includes('@')) {
      if (!U.emailDomainAllowed(raw)) return { items: [], hint: 'Ищем только по рабочей почте' };
      rows = q('SELECT * FROM users WHERE email_hash = ? AND nick IS NOT NULL').all(U.hashEmail(raw));
    } else {
      const needle = raw.replace(/^@+/, '').toLocaleLowerCase('ru');
      const all = q('SELECT * FROM users WHERE nick IS NOT NULL AND id != ?').all(u.id);
      // Из другой компании находим только по нику целиком или по почте: чужой список коллег не листаем
      rows = all.filter((r) => {
        if (companyOf(r) !== companyOf(u)) return r.nick.toLocaleLowerCase('ru') === needle;
        if (r.nick.toLocaleLowerCase('ru').includes(needle)) return true;
        const p = readProfile(r.profile);
        if (!hasOwnName(u.profile)) return false; // по имени ищет тот, кто сам указал имя
        return [p.firstName, p.lastName].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(needle);
      });
    }
    let blockedIds = new Set();
    try { blockedIds = new Set(q('SELECT blocked_id AS id FROM crew_blocks WHERE user_id = ? UNION SELECT user_id AS id FROM crew_blocks WHERE blocked_id = ?').all(u.id, u.id).map((r) => r.id)); } catch {}
    const mine = myGangs(u.id);
    const items = rows.filter((r) => r.id !== u.id && !blockedIds.has(r.id) && readProfile(r.profile).findable !== false).slice(0, 20).map((r) => {
      const prof = readProfile(r.profile);
      const shared = mine.filter((g) => isMember(g.id, r.id));
      const invitable = mine.filter((g) => !isMember(g.id, r.id) && companyOf(g) === companyOf(r)).map((g) => ({
        id: g.id, name: g.name,
        pending: !!q("SELECT 1 FROM gang_invites WHERE gang_id = ? AND to_id = ? AND status = 'pending'").get(g.id, r.id)
      }));
      return { id: r.id, nick: r.nick, look: publicLook({ look: r.look }), company: companyOf(r) !== companyOf(u) ? (U.companyInfo(companyOf(r)) || {}).name || null : null, name: companyOf(r) !== companyOf(u) ? '' : fullName(prof, 'all'), status: statusName(JSON.parse(r.look || '{}').status), shared: shared.map((g) => g.name), invitable };
    });
    return { items, hint: items.length ? '' : 'Никого не нашли. Человек мог отключить поиск в настройках — тогда позови его ссылкой' };
  });

  route('POST', '/api/gangs/:id/invite', async (req, body, query, params) => {
    const u = requireUser(req);
    { const g0 = q('SELECT owner_id, who_invites FROM gangs WHERE id = ?').get(Number(params.id)); if (g0 && g0.who_invites === 'owner' && g0.owner_id !== u.id) throw bad('В этой банде зовёт только владелец.'); }
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(params.id));
    if (!g || !isMember(g.id, u.id)) throw bad('Позвать можно только в свою банду.');
    const t = q('SELECT * FROM users WHERE id = ? AND nick IS NOT NULL').get(Number(body.to));
    if (!t || t.id === u.id || readProfile(t.profile).findable === false) throw bad('Этого человека нельзя позвать.');
    if (companyOf(t) !== companyOf(g)) throw bad('Он из другой компании: в банду зовём только своих. Добавь в подельники — сможете переписываться.');
    if (isMember(g.id, t.id)) throw bad(U.g(t.look, 'Он уже в банде.', 'Она уже в банде.'));
    try { if (q('SELECT 1 FROM crew_blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').get(t.id, u.id, u.id, t.id)) throw bad('Этого человека нельзя позвать.'); } catch (e) { if (e instanceof HttpError) throw e; }
    if (q("SELECT 1 FROM gang_invites WHERE gang_id = ? AND to_id = ? AND status = 'pending'").get(g.id, t.id)) throw bad('Уже позвали — ждём ответа.');
    if (q("SELECT COUNT(*) AS n FROM gang_invites WHERE gang_id = ? AND to_id = ? AND status = 'declined'").get(g.id, t.id).n >= 2) throw bad(U.g(t.look, 'Он дважды отказался от этой банды. Больше не зовём.', 'Она дважды отказалась от этой банды. Больше не зовём.'));
    if (q('SELECT COUNT(*) AS n FROM gang_invites WHERE from_id = ? AND at > ?').get(u.id, U.now() - 864e5).n >= 20) throw bad('Не больше 20 приглашений в день.');
    q('INSERT INTO gang_invites (gang_id, from_id, to_id, at) VALUES (?, ?, ?, ?)').run(g.id, u.id, t.id, U.now());
    fireAndForget(notify([t.id], { title: 'Зовут в банду', body: `${u.nick} зовёт в банду «${g.name}»`, url: '/#chats', tag: `ginv-${g.id}` }));
    return { ok: true };
  });

  route('GET', '/api/invites', async (req) => {
    const u = requireUser(req);
    const rows = q(`SELECT i.id, i.at, g.id AS gid, g.name, g.color, g.crest, g.area, g.interests, g.style, f.nick AS from_nick FROM gang_invites i JOIN gangs g ON g.id = i.gang_id
                    LEFT JOIN users f ON f.id = i.from_id WHERE i.to_id = ? AND i.status = 'pending' AND g.hidden = 0 ORDER BY i.at DESC`).all(u.id);
    return { items: rows.map((r) => ({ id: r.id, gang: { id: r.gid, name: r.name, color: r.color, ...U.crestPub(r), members: memberCount(r.gid) }, from: r.from_nick || 'кто-то' })) };
  });

  route('POST', '/api/invites/:id/:action', async (req, body, query, params) => {
    const u = requireUser(req);
    const inv = q("SELECT * FROM gang_invites WHERE id = ? AND to_id = ? AND status = 'pending'").get(Number(params.id), u.id);
    if (!inv) throw bad('Приглашение уже неактуально.');
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(inv.gang_id);
    if (params.action === 'accept') {
      if (!g) throw bad('Банда закрыта.');
      joinGang(u, g, { switch: !!body.switch });
      q("UPDATE gang_invites SET status = 'accepted' WHERE gang_id = ? AND to_id = ? AND status = 'pending'").run(g.id, u.id);
      if (inv.from_id && features) features.onEvent('recruit', inv.from_id);
      if (inv.from_id) fireAndForget(notify([inv.from_id], { title: g.name, body: `${u.nick} ${U.g(u.look, 'вступил', 'вступила')} в банду`, url: `/#gang/${g.id}`, tag: `ginv-${g.id}` }));
      return { ok: true, gang: g.id };
    }
    if (params.action === 'decline') { q("UPDATE gang_invites SET status = 'declined' WHERE id = ?").run(inv.id); return { ok: true }; }
    throw bad('Неизвестное действие.');
  });

  route('POST', '/api/gangs/:id/leave', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ?').get(Number(params.id));
    if (!g || !isMember(g.id, u.id)) throw bad('Ты не в этой банде.');
    leaveGang(u.id, g.id);
    if (features) features.onEvent('gang_leave', u.id);
    return { ok: true };
  });

  route('POST', '/api/gangs/:id/motto', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ?').get(Number(params.id));
    if (!g || !isMember(g.id, u.id)) throw bad('Ты не в этой банде.');
    if (!g.motto_owned) throw bad('Сначала купи девиз в лавке.');
    const motto = U.cleanText(body.motto, 40);
    const prob = U.moderationProblem(motto);
    if (prob) throw bad(prob);
    q('UPDATE gangs SET motto = ? WHERE id = ?').run(motto || null, g.id);
    return { ok: true };
  });

  // Карточка коллеги: большой аватар и то, что он сам разрешил показать.
  // Полная карточка — тем, с кем есть общая банда, подельникам и паре по кофе; остальным — ник и аватар.
  route('GET', '/api/users/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    const t = q('SELECT id, nick, look, profile, share_office FROM users WHERE id = ? AND nick IS NOT NULL').get(Number(params.id));
    if (!t) throw new HttpError(404, 'Пользователь не найден.');
    const me = t.id === u.id;
    const sharedGangs = q(`SELECT g.name FROM gang_members a JOIN gang_members b ON a.gang_id = b.gang_id JOIN gangs g ON g.id = a.gang_id
                           WHERE a.user_id = ? AND b.user_id = ? AND g.hidden = 0`).all(u.id, t.id).map((r) => r.name);
    const [lo, hi] = u.id < t.id ? [u.id, t.id] : [t.id, u.id];
    let crewMate = false;
    try { crewMate = !!q("SELECT 1 FROM crew WHERE lo = ? AND hi = ? AND status = 'ok'").get(lo, hi); } catch {}
    let coffeeMate = false;
    try { coffeeMate = !!q('SELECT 1 FROM coffee_pairs WHERE ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND week >= ?').get(u.id, t.id, t.id, u.id, addDays(U.msk().day, -7)); } catch {}
    const close = me || sharedGangs.length > 0 || crewMate;
    const prof = readProfile(t.profile);
    const look = { ...DEFAULT_LOOK, ...JSON.parse(t.look || '{}') };
    const card = { id: t.id, nick: t.nick, name: me ? '' : fullName(prof, 'all'), role: prof.role || '', askMe: prof.askMe || [], badges: style ? style.shownBadges(t.id, prof) : [], me, look, status: statusName(look.status), full: close || coffeeMate, canDm: !me && crew ? crew.canDm(u, t) : false };
    if (!card.full) return card;
    const st = memberStatus(t);
    return {
      ...card, look: st.look,
      name: me ? [prof.firstName, prof.lastName].filter(Boolean).join(' ') : fullName(prof, close ? 'gang' : 'all'),
      about: prof.about, tags: prof.tags, bday: prof.showBday ? prof.bday : '',
      mood: st.mood, where: st.where, office: st.office, until: st.until, planned: st.planned,
      gangs: sharedGangs, crew: crewMate, home: (officeById(prof.home) || {}).name || null
    };
  });

  route('GET', '/api/gangs/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(params.id));
    if (!g || !isMember(g.id, u.id)) throw new HttpError(404, 'Банда не найдена.');
    const members = gangMembers(g.id);
    const statuses = members.map((m) => ({ ...memberStatus(m), me: m.id === u.id }));
    const msgs = q(`SELECT m.*, a.nick AS author, t.nick AS to_nick FROM messages m
                    LEFT JOIN users a ON a.id = m.user_id LEFT JOIN users t ON t.id = m.to_user_id
                    WHERE m.gang_id = ? AND m.hidden = 0 AND m.at > ? ORDER BY m.at ASC LIMIT 300`).all(g.id, U.now() - 24 * 3600e3);
    const replies = msgs.length
      ? q(`SELECT r.*, u.nick FROM replies r JOIN users u ON u.id = r.user_id WHERE r.message_id IN (${msgs.map(() => '?').join(',')}) ORDER BY r.at`).all(...msgs.map((m) => m.id))
      : [];
    const officeName = Object.fromEntries(offices().map((o) => [o.id, o.name]));
    return {
      gang: {
        id: g.id, name: g.name, color: g.color, motto: g.motto, gold: !!g.gold, mottoOwned: !!g.motto_owned, flag: !!g.flag, horn: !!g.horn, pizza: pizzaOf(g.id, u.id),
        code: (g.who_invites || 'all') === 'all' || g.owner_id === u.id ? g.code : null, link: (g.who_invites || 'all') === 'all' || g.owner_id === u.id ? `${config.baseUrl}/g/${g.code}` : null, isOwner: g.owner_id === u.id,
        depositPending: !!g.deposit && members.length < 3, count: members.length,
        about: g.about || '', ...U.crestPub(g), emoji: g.emoji || null, access: g.access || 'invite',
        max: gangLimit(g), maxSet: g.max_members || 0, glory: treasury ? treasury.balance(g.id) : 0, league: league ? league.weekPlace(g.id) : null, trophies: league ? league.trophies(g.id) : null, legend: g.legend_month && league ? legendLabel(g.legend_month) : null, whoInvites: g.who_invites || 'all', office: g.office_id || null, canInvite: (g.who_invites || 'all') === 'all' || g.owner_id === u.id
      },
      requests: g.owner_id === u.id ? q(`SELECT r.user_id AS id, r.at, x.nick, x.look, x.profile, x.share_office FROM gang_requests r JOIN users x ON x.id = r.user_id WHERE r.gang_id = ? AND r.status = 'pending' ORDER BY r.at`).all(g.id).map((r) => ({ id: r.id, nick: r.nick, look: publicLook(r) })) : [],
      members: statuses.map((s) => ({ ...s, officeName: s.office ? officeName[s.office] : null })),
      messages: msgs.map((m) => {
        const mine = m.user_id === u.id;
        const rs = replies.filter((r) => r.message_id === m.id).map((r) => ({ nick: r.nick, label: r.label, me: r.user_id === u.id }));
        const def = m.type === 'call' ? CALLS[m.kind] : null;
        return {
          id: m.id, type: m.type, kind: m.kind, author: m.author || 'удалённый аккаунт', mine, at: m.at, time: U.msk(m.at).hhmm,
          toNick: m.to_nick, toMe: m.to_user_id === u.id, opt: m.opt, text: m.type === 'voice' || m.type === 'meme' ? null : U.unseal(m.text),
          voice: m.type === 'voice' ? { dur: Number(m.opt), ...(voice.info(m.text) || { gone: true }) } : undefined,
          look: m.type === 'meme' ? JSON.parse(m.text || '{}') : undefined,
          callText: def ? def.verb : null, replies: rs,
          canReply: !!def && !mine && (m.to_user_id === null || m.to_user_id === u.id) && !rs.some((r) => r.me),
          replyOptions: def ? def.replies : []
        };
      })
    };
  });

  route('POST', '/api/gangs/:id/messages', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(params.id));
    if (!g || !isMember(g.id, u.id)) throw bad('Ты не в этой банде.');
    rateLimit('msg:' + u.id, 30, 60e3);
    if (body.type === 'meme') {
      // Праздничная открытка банде: только праздничные сюжеты и только в сезон, не больше 3 в день
      const m = MEMES.find((x) => x.id === body.kind);
      if (!m || !m.season || !SEASON.seasonOn(m.season, U.msk().day) || !MEME_EMOS[body.opt]) throw bad('Открытку банде можно отправить только в праздники.');
      if (q("SELECT COUNT(*) AS n FROM messages WHERE gang_id = ? AND user_id = ? AND type = 'meme' AND at > ?").get(g.id, u.id, U.now() - 864e5).n >= 3) throw bad('Не больше трёх открыток банде в день.');
      q('INSERT INTO messages (gang_id, user_id, type, kind, opt, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(g.id, u.id, 'meme', m.id, body.opt, JSON.stringify(u.look || {}), U.now());
      if (features) features.onEvent('gang_meme', u.id, {});
      return { ok: true };
    }
    if (body.type === 'voice') {
      const v = voice.store(u.id, { gangId: g.id }, body);
      q('INSERT INTO messages (gang_id, user_id, type, opt, text, at) VALUES (?, ?, ?, ?, ?, ?)').run(g.id, u.id, 'voice', String(v.dur), v.token, U.now());
      if (features) features.onEvent('text', u.id);
      return { ok: true };
    }
    if (body.type === 'text') {
      const text = U.cleanText(body.text, 300);
      if (!text) throw bad('Пустое сообщение.');
      const prob = U.moderationProblem(text, { allowAt: true });
      if (prob) throw bad(prob);
      q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(g.id, u.id, 'text', U.seal(text), U.now());
      if (features) features.onEvent('text', u.id);
      return { ok: true };
    }
    const def = CALLS[body.kind];
    if (body.type !== 'call' || !def) throw bad('Неизвестный тип сообщения.');
    const hourAgo = U.now() - 3600e3;
    if (q("SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND type = 'call' AND at > ?").get(u.id, hourAgo).n >= 3) throw bad('Не больше 3 зовов в час — береги нервы банды.');
    let toId = null;
    if (body.to) {
      const t = q('SELECT id FROM users WHERE id = ?').get(Number(body.to));
      if (!t || !isMember(g.id, t.id) || t.id === u.id) throw bad('Этого человека нет в банде.');
      toId = t.id;
    }
    const opt = def.opts.includes(body.opt) ? body.opt : def.opts[0] || null;
    let text = null;
    if (def.needsText || def.textLabel) {
      text = U.cleanText(body.text, 40) || null;
      if (def.needsText && !text) throw bad('Заполни поле.');
      const prob = text && U.moderationProblem(text);
      if (prob) throw bad(prob);
    }
    q('INSERT INTO messages (gang_id, user_id, type, kind, to_user_id, opt, text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(g.id, u.id, 'call', body.kind, toId, opt, U.seal(text), U.now());
    if (features) features.onEvent('call', u.id);
    // Текст пуша нейтральный: без названий офисов и подробностей
    const recipients = toId ? [toId] : gangMembers(g.id).map((m) => m.id).filter((id) => id !== u.id);
    fireAndForget(notify(recipients, { title: g.name, body: `${u.nick} ${def.verb}${opt ? ' · ' + opt.toLowerCase() : ''}`, url: `/#gang/${g.id}`, tag: `gang-${g.id}` }));
    const away = recipients.filter((id) => {
      const r = q('SELECT profile FROM users WHERE id = ?').get(id);
      return r && ['vacation', 'sick'].includes(presenceOf(readProfile(r.profile), activeCheckin(id)).where);
    }).length;
    const focus = recipients.filter((id) => { const r = q('SELECT profile FROM users WHERE id = ?').get(id); return r && focusUntil(readProfile(r.profile)); }).length;
    return { ok: true, quiet: U.isQuietHour(), away, focus };
  });

  route('POST', '/api/messages/:id/reply', async (req, body, query, params) => {
    const u = requireUser(req);
    const m = q("SELECT * FROM messages WHERE id = ? AND type = 'call' AND hidden = 0").get(Number(params.id));
    if (!m || !isMember(m.gang_id, u.id)) throw bad('Зов не найден.');
    if (m.user_id === u.id) throw bad('Это твой зов.');
    if (m.to_user_id !== null && m.to_user_id !== u.id) throw bad('Этот зов адресован не тебе.');
    const def = CALLS[m.kind];
    if (!def.replies.includes(body.label)) throw bad('Неизвестный ответ.');
    const r = q('INSERT OR IGNORE INTO replies (message_id, user_id, label, at) VALUES (?, ?, ?, ?)').run(m.id, u.id, body.label, U.now());
    if (!r.changes) throw bad(U.g(u.look, 'Ты уже ответил.', 'Ты уже ответила.'));
    if (['Скоро буду', 'Бегу', '5 минут'].includes(body.label)) {
      // «уже иду»: на 20 минут аватар держит табличку «Скоро буду» (если человек не выключил таблички в настройках)
      const pr = readProfile(q('SELECT profile FROM users WHERE id = ?').get(u.id).profile);
      pr.soon = U.now() + 20 * 60e3;
      q('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify(pr), u.id);
    }
    const got = addBeans(u.id, 'reply');
    if (features) features.onEvent('reply', u.id);
    if (m.user_id) fireAndForget(notify([m.user_id], { title: 'Ответ на зов', body: `${u.nick}: ${body.label}`, url: `/#gang/${m.gang_id}`, tag: `reply-${m.id}` }));
    return { ok: true, beans: got };
  });

  // ---------- Сигналы офиса и лента ----------
  route('GET', '/api/events', async (req) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    const officeId = ci ? ci.office_id : null;
    const events = q(`SELECT e.*, o.name AS office_name FROM events e LEFT JOIN offices o ON o.id = e.office_id
                      WHERE e.at > ? AND (e.office_id IS NULL OR e.office_id = ?) AND (e.user_id IS NULL OR EXISTS (SELECT 1 FROM users x WHERE x.id = e.user_id AND x.company = ?)) ORDER BY e.at DESC LIMIT 60`).all(U.now() - 48 * 3600e3, officeId || '', companyOf(u));
    const signals = officeId
      ? q('SELECT * FROM signals WHERE office_id = ? AND hidden = 0 AND expires_at > ? ORDER BY at DESC').all(officeId, U.now())
      : [];
    // «Свои» — из общих банд и подельники: для фильтра «только свои»
    const close = new Set(q(`SELECT b.user_id AS id FROM gang_members a JOIN gang_members b ON a.gang_id = b.gang_id WHERE a.user_id = ?`).all(u.id).map((r) => r.id));
    try { for (const r of q("SELECT CASE WHEN lo = ? THEN hi ELSE lo END AS id FROM crew WHERE (lo = ? OR hi = ?) AND status = 'ok'").all(u.id, u.id, u.id)) close.add(r.id); } catch {}
    const votes = (id) => q('SELECT COALESCE(SUM(vote = 1), 0) AS up, COALESCE(SUM(vote = -1), 0) AS down FROM signal_votes WHERE signal_id = ?').get(id);
    return {
      office: officeId,
      events: events.map((e) => ({ id: e.id, text: e.text, at: e.at, time: U.msk(e.at).hhmm, office: e.office_name || null, kind: eventKind(e), close: e.user_id === u.id || close.has(e.user_id) })),
      signals: signals.map((s) => {
        const v = votes(s.id);
        const my = q('SELECT vote FROM signal_votes WHERE signal_id = ? AND user_id = ?').get(s.id, u.id);
        return {
          id: s.id, type: s.type, label: SIGNALS[s.type] ? SIGNALS[s.type].label : s.type, zone: s.zone, comment: s.comment,
          at: s.at, time: U.msk(s.at).hhmm, up: Number(v.up), down: Number(v.down), confirmed: !!s.confirmed_at,
          mine: s.user_id === u.id, myVote: my ? my.vote : 0
        };
      })
    };
  });

  route('POST', '/api/signals', async (req, body) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    if (!ci) throw bad('Сигналы можно отправлять, когда ты отмечен в офисе.');
    const def = SIGNALS[body.type];
    if (!def) throw bad('Выбери тип сигнала.');
    rateLimit('signal:' + u.id, 6, 3600e3);
    const zone = U.cleanText(body.zone, 30) || null;
    const comment = U.cleanText(body.comment, 60) || null;
    for (const t of [zone, comment]) {
      const prob = t && U.moderationProblem(t);
      if (prob) throw bad(prob);
    }
    q('INSERT INTO signals (office_id, type, zone, comment, user_id, at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ci.office_id, body.type, zone, comment, u.id, U.now(), U.now() + def.hours * 3600e3);
    if (features) features.onEvent('signal_sent', u.id);
    return { ok: true };
  });

  route('POST', '/api/signals/:id/vote', async (req, body, query, params) => {
    const u = requireUser(req);
    const s = q('SELECT * FROM signals WHERE id = ? AND hidden = 0 AND expires_at > ?').get(Number(params.id), U.now());
    if (!s) throw bad('Сигнал уже не актуален.');
    const ci = activeCheckin(u.id);
    if (!ci || ci.office_id !== s.office_id) throw bad('Голосовать можно, когда ты в этом офисе.');
    if (s.user_id === u.id) throw bad('Это твой сигнал.');
    const vote = body.vote === -1 ? -1 : 1;
    q('INSERT INTO signal_votes (signal_id, user_id, vote) VALUES (?, ?, ?) ON CONFLICT(signal_id, user_id) DO UPDATE SET vote = excluded.vote').run(s.id, u.id, vote);
    const v = q('SELECT COALESCE(SUM(vote = 1), 0) AS up, COALESCE(SUM(vote = -1), 0) AS down FROM signal_votes WHERE signal_id = ?').get(s.id);
    if (Number(v.down) >= 3) q('UPDATE signals SET hidden = 1 WHERE id = ?').run(s.id);
    if (Number(v.up) >= 2 && !s.confirmed_at) {
      q('UPDATE signals SET confirmed_at = ? WHERE id = ?').run(U.now(), s.id);
      if (s.user_id) addBeans(s.user_id, 'signal_confirmed');
      if (s.user_id && features) features.onEvent('signal_confirmed', s.user_id);
      const here = q('SELECT DISTINCT user_id FROM checkins WHERE office_id = ? AND day = ? AND left_at IS NULL').all(s.office_id, U.msk().day).map((r) => r.user_id);
      const label = SIGNALS[s.type].label;
      fireAndForget(notify(here.filter((id) => id !== s.user_id), { title: 'Сигнал офиса', body: label + (s.zone ? ' · ' + s.zone : ''), url: '/#feed', tag: `signal-${s.id}` }));
    }
    return { ok: true };
  });

  // ---------- Жалобы ----------
  route('POST', '/api/report', async (req, body) => {
    const u = requireUser(req);
    const type = ['gang', 'message', 'signal', 'dm', 'board'].includes(body.type) ? body.type : null;
    const id = Number(body.id);
    if (!type || !id) throw bad('Непонятно, на что жалоба.');
    // На личное сообщение жалуется только тот, кому оно пришло. Модератор увидит только его
    if (type === 'dm' && !q('SELECT 1 FROM dms WHERE id = ? AND to_id = ?').get(id, u.id)) throw bad('Сообщение не найдено.');
    q('INSERT OR IGNORE INTO reports (reporter_id, object_type, object_id, reason, at) VALUES (?, ?, ?, ?, ?)').run(u.id, type, id, U.cleanText(body.reason, 200) || null, U.now());
    const n = q("SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE object_type = ? AND object_id = ? AND status = 'open'").get(type, id).n;
    if (n >= 3) {
      const table = { gang: 'gangs', message: 'messages', signal: 'signals', dm: 'dms', board: 'board_posts' }[type];
      q(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(id);
    }
    return { ok: true };
  });

  // ---------- Лавка ----------
  // Товар дня: один на компанию, каждый день новый, скидка 30%. Считается от даты — у всех одинаковый
  const DEAL_OFF = 0.3;
  function dealOf(company) {
    const day = U.msk().day;
    const pool = SHOP.filter((it) => !it.award && !['gang', 'prank'].includes(it.kind) && it.price >= 40 && (!it.season || SEASON.seasonOn(it.season, day)));
    let h = 7; for (const ch of day + ':' + (company || 'mts')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const it = pool[h % pool.length];
    return { id: it.id, price: Math.round(it.price * (1 - DEAL_OFF)), was: it.price, name: it.name };
  }
  const priceOf = (it, u) => { const d = dealOf(companyOf(u)); return d.id === it.id ? d.price : it.price; };
  const fxOn = (x) => !!(x && x.until && x.until > U.now());
  const userLook = (row) => ({ ...DEFAULT_LOOK, ...JSON.parse(row.look || '{}') });
  const saveLook = (id, look) => q('UPDATE users SET look = ? WHERE id = ?').run(JSON.stringify(look), id);
  const pizzaOf = (gangId, uid) => {
    const p = q('SELECT p.*, u.nick FROM gang_pizza p JOIN users u ON u.id = p.by_id WHERE p.gang_id = ? AND p.until > ? ORDER BY p.id DESC LIMIT 1').get(gangId, U.now());
    if (!p) return null;
    const taken = q('SELECT user_id FROM gang_pizza_taken WHERE pizza_id = ?').all(p.id).map((r) => r.user_id);
    return { id: p.id, by: p.nick, mine: p.by_id === uid, left: Math.max(0, p.slices - taken.length), slices: p.slices, took: taken.includes(uid), until: p.until };
  };

  route('GET', '/api/shop', async (req) => {
    const u = requireUser(req);
    const owned = new Set(q('SELECT item_id FROM owned WHERE user_id = ?').all(u.id).map((r) => r.item_id));
    const deal = dealOf(companyOf(u));
    return {
      beans: u.beans, deal,
      nickfx: fxOn(u.look.nfx) ? u.look.nfx : null,
      // Сезонные вещи вне сезона не показываем — если уже не куплены
      items: SHOP.filter((it) => !it.season || owned.has(it.id) || SEASON.seasonOn(it.season, U.msk().day)).map((it) => ({
        ...it,
        price: it.id === deal.id ? deal.price : it.price, was: it.id === deal.id ? deal.was : undefined,
        until: it.season && SEASON.seasonOn(it.season, U.msk().day) ? SEASON.nextWindow(it.season, U.msk().day).to : undefined,
        owned: ['gang', 'prank', 'nickfx'].includes(it.kind) ? undefined : owned.has(it.id),
        active: it.kind === 'nickfx' && fxOn(u.look.nfx) && u.look.nfx.v === it.value ? u.look.nfx.until : undefined,
        equipped: it.kind === 'status' ? u.look.status === it.id : it.kind === 'frame' ? u.look.frame === it.id : it.kind === 'crown' ? !!u.look.crown : it.kind === 'sound' ? u.look.snd === it.value : undefined,
        left: it.limit ? Math.max(0, it.limit - q('SELECT COUNT(*) AS n FROM owned WHERE item_id = ?').get(it.id).n) : undefined
      }))
    };
  });

  route('POST', '/api/shop/buy', async (req, body) => {
    const u = requireUser(req);
    const it = SHOP.find((s) => s.id === body.item);
    if (!it) throw bad('Нет такого предмета.');
    if (it.award) throw bad(it.how ? `Это не купить — только заслужить: ${it.how}.` : 'Это не купить — только выиграть в Лиге банд.');
    if (it.season && !SEASON.seasonOn(it.season, U.msk().day)) throw bad('Сезон этой вещи закончился — она вернётся к следующему празднику.');
    if (it.kind === 'prank') throw bad('Подлянку покупают сразу для подельника: нажми «Разыграть» и выбери кого.');
    const price = priceOf(it, u);
    if (it.kind === 'gang') {
      const g = q('SELECT * FROM gangs WHERE id = ?').get(Number(body.gangId));
      if (!g || !isMember(g.id, u.id)) throw bad('Выбери свою банду.');
      if (it.id === 'g_pizza') {
        if (pizzaOf(g.id, u.id)) throw bad('Пицца ещё не доедена — подожди, пока разберут куски.');
        if (!spendBeans(u.id, price, 'shop:' + it.id)) throw bad('Не хватает зёрен.');
        q('INSERT INTO gang_pizza (gang_id, by_id, slices, at, until) VALUES (?, ?, ?, ?, ?)').run(g.id, u.id, it.slices, U.now(), U.now() + 24 * 3600e3);
        const others = gangMembers(g.id).map((m) => m.id).filter((id) => id !== u.id);
        fireAndForget(notify(others, { title: g.name, body: `${u.nick} ${U.g(u.look, 'угощает', 'угощает')} банду пиццей — возьми кусок, пока есть`, url: `/#gang/${g.id}`, tag: `pizza-${g.id}` }));
        return { ok: true };
      }
      const col = { g_gold: 'gold', g_motto: 'motto_owned', g_flag: 'flag', g_horn: 'horn' }[it.id];
      if (g[col]) throw bad('У банды это уже есть.');
      if (!spendBeans(u.id, price, 'shop:' + it.id)) throw bad('Не хватает зёрен.');
      q(`UPDATE gangs SET ${col} = 1 WHERE id = ?`).run(g.id);
      return { ok: true };
    }
    if (it.kind === 'nickfx') {
      if (!spendBeans(u.id, price, 'shop:' + it.id)) throw bad('Не хватает зёрен.');
      const cur = u.look.nfx;
      const from = fxOn(cur) && cur.v === it.value ? cur.until : U.now();
      const look = { ...u.look, nfx: { v: it.value, until: from + it.days * 864e5 } };
      saveLook(u.id, look);
      return { ok: true, until: look.nfx.until };
    }
    if (q('SELECT 1 FROM owned WHERE user_id = ? AND item_id = ?').get(u.id, it.id)) throw bad('Уже куплено.');
    if (it.limit && q('SELECT COUNT(*) AS n FROM owned WHERE item_id = ?').get(it.id).n >= it.limit) throw bad('Тираж этого сезона закончился.');
    if (!spendBeans(u.id, price, 'shop:' + it.id)) throw bad('Не хватает зёрен.');
    q('INSERT INTO owned (user_id, item_id, at) VALUES (?, ?, ?)').run(u.id, it.id, U.now());
    const look = { ...u.look };
    if (it.kind === 'status') look.status = it.id;
    if (it.kind === 'frame') look.frame = it.id;
    if (it.kind === 'crown') look.crown = true;
    if (it.kind === 'sound') look.snd = it.value;
    saveLook(u.id, look);
    pushEvent(null, u.id, `${u.nick} ${U.g(u.look, 'купил', 'купила')} в лавке «${it.name}»`, 'shop');
    return { ok: true };
  });

  route('POST', '/api/shop/equip', async (req, body) => {
    const u = requireUser(req);
    const it = SHOP.find((s) => s.id === body.item && !['gang', 'prank', 'nickfx'].includes(s.kind));
    if (!it || !q('SELECT 1 FROM owned WHERE user_id = ? AND item_id = ?').get(u.id, it.id)) throw bad('Сначала купи предмет.');
    const look = { ...u.look };
    const on = !!body.on;
    if (it.kind === 'status') look.status = on ? it.id : null;
    if (it.kind === 'frame') look.frame = on ? it.id : null;
    if (it.kind === 'crown') look.crown = on;
    if (it.kind === 'sound') look.snd = on ? it.value : null;
    saveLook(u.id, look);
    return { ok: true };
  });

  // Подарок подельнику: платишь ты, вещь появляется в его Лавке, в личку — открытка от тебя
  route('POST', '/api/shop/gift', async (req, body) => {
    const u = requireUser(req);
    const it = SHOP.find((s) => s.id === body.item);
    if (!it || it.award || ['gang', 'prank'].includes(it.kind) || it.limit) throw bad('Это не подарить.');
    if (it.season && !SEASON.seasonOn(it.season, U.msk().day)) throw bad('Сезон этой вещи закончился.');
    const t = q('SELECT * FROM users WHERE id = ?').get(Number(body.to));
    if (!t || t.id === u.id || !crew || !crew.areCrew(u.id, t.id)) throw bad('Дарить можно только подельникам.');
    rateLimit('gift:' + u.id, 10, 864e5);
    const price = priceOf(it, u);
    if (it.kind !== 'nickfx' && q('SELECT 1 FROM owned WHERE user_id = ? AND item_id = ?').get(t.id, it.id)) throw bad(`У ${t.nick} это уже есть — выбери другое.`);
    if (!spendBeans(u.id, price, 'gift:' + it.id)) throw bad('Не хватает зёрен.');
    if (it.kind === 'nickfx') {
      const tl = userLook(t); const cur = tl.nfx;
      tl.nfx = { v: it.value, until: (fxOn(cur) && cur.v === it.value ? cur.until : U.now()) + it.days * 864e5 };
      saveLook(t.id, tl);
    } else q('INSERT INTO owned (user_id, item_id, at) VALUES (?, ?, ?)').run(t.id, it.id, U.now());
    const where = it.kind === 'nickfx' ? 'Уже действует — неделю.' : it.kind === 'part' ? 'Надень в конструкторе аватара.' : 'Уже в твоей Лавке, во вкладке «Твоё».';
    crew.systemDm(u, t, `🎁 Дарю тебе «${it.name}». ${where}`);
    fireAndForget(notify([t.id], { title: u.nick, body: `${U.g(u.look, 'Подарил', 'Подарила')} тебе «${it.name}»`, url: `/#crew/${u.id}`, tag: `gift-${u.id}` }));
    return { ok: true };
  });

  // Подлянка: на час на аватаре подельника. Тот может снять одним касанием или запретить подлянки в профиле
  route('POST', '/api/shop/prank', async (req, body) => {
    const u = requireUser(req);
    const it = SHOP.find((s) => s.id === body.item && s.kind === 'prank');
    if (!it) throw bad('Такой подлянки нет.');
    const t = q('SELECT * FROM users WHERE id = ?').get(Number(body.to));
    if (!t || t.id === u.id || !crew || !crew.areCrew(u.id, t.id)) throw bad('Разыгрывать можно только подельников.');
    if (JSON.parse(t.profile || '{}').noPranks) throw bad(`${t.nick} попросил|попросила не разыгрывать — давай без этого.`.replace('попросил|попросила', U.g(userLook(t), 'попросил', 'попросила')));
    const tl = userLook(t);
    if (fxOn(tl.prank)) throw bad(`На аватаре ${t.nick} уже висит подлянка — подожди часок.`);
    rateLimit('prank:' + u.id, 5, 864e5);
    rateLimit(`prank:${u.id}:${t.id}`, 2, 864e5);
    if (!spendBeans(u.id, priceOf(it, u), 'prank:' + it.id)) throw bad('Не хватает зёрен.');
    tl.prank = { v: it.value, until: U.now() + 3600e3, from: u.nick, f: U.fem(u.look) ? 1 : 0 };
    saveLook(t.id, tl);
    fireAndForget(notify([t.id], { title: u.nick, body: `${U.g(u.look, 'Разыграл', 'Разыграла')} тебя: «${it.name}» на аватаре на час. Снять можно одним касанием`, url: '/#near', tag: `prank-${t.id}` }));
    return { ok: true };
  });
  route('POST', '/api/me/prank/off', async (req) => {
    const u = requireUser(req);
    const look = { ...u.look }; delete look.prank;
    saveLook(u.id, look);
    return { ok: true };
  });
  route('POST', '/api/me/pranks', async (req, body) => {
    const u = requireUser(req);
    const prof = JSON.parse(q('SELECT profile FROM users WHERE id = ?').get(u.id).profile || '{}');
    prof.noPranks = !body.allow;
    q('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify(prof), u.id);
    return { ok: true };
  });

  // Пицца банды: кусок — +1 зерно, по одному каждому, кроме угощающего
  route('POST', '/api/gangs/:id/pizza/take', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ?').get(Number(params.id));
    if (!g || !isMember(g.id, u.id)) throw bad('Это не твоя банда.');
    const p = pizzaOf(g.id, u.id);
    if (!p) throw bad('Пицца уже закончилась.');
    if (p.mine) throw bad('Это твоя пицца — угощай других.');
    if (p.took) throw bad('Свой кусок ты уже взял|взяла.'.replace('взял|взяла', U.g(u.look, 'взял', 'взяла')));
    if (!p.left) throw bad('Куски закончились — в следующий раз будь быстрее.');
    q('INSERT INTO gang_pizza_taken (pizza_id, user_id, at) VALUES (?, ?, ?)').run(p.id, u.id, U.now());
    const beans = addBeans(u.id, 'pizza_slice', 1);
    return { ok: true, beans };
  });

  // ---------- Пуш-подписки ----------
  route('POST', '/api/push/subscribe', async (req, body) => {
    const u = requireUser(req);
    const s = body.subscription || {};
    const endpoint = String(s.endpoint || '');
    if (!/^https:\/\//.test(endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) throw bad('Некорректная подписка.');
    q(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(u.id, endpoint, s.keys.p256dh, s.keys.auth, U.now());
    if (features) features.onEvent('profile', u.id);
    return { ok: true };
  });

  route('POST', '/api/push/test', async (req) => {
    const u = requireUser(req);
    await notify([u.id], { title: 'Этаж', body: 'Уведомления работают', url: '/' }, { ignoreQuiet: true });
    return { ok: true };
  });

  // ---------- Админка ----------
  const requireAdmin = (req) => {
    const u = requireUser(req);
    if (!u.isAdmin) throw new HttpError(403, 'Только для администраторов.');
    return u;
  };

  route('GET', '/api/admin/overview', async (req) => {
    requireAdmin(req);
    const reports = q(`SELECT object_type, object_id, COUNT(*) AS n, MAX(at) AS last, GROUP_CONCAT(reason, ' | ') AS reasons
                       FROM reports WHERE status = 'open' GROUP BY object_type, object_id ORDER BY last DESC LIMIT 100`).all();
    const preview = (r) => {
      if (r.object_type === 'board') { const b = q('SELECT text, hidden FROM board_posts WHERE id = ?').get(r.object_id); return b ? { text: `[доска] ${b.text}`, hidden: !!b.hidden } : null; }
      if (r.object_type === 'gang') { const g = q('SELECT name, motto, hidden FROM gangs WHERE id = ?').get(r.object_id); return g ? { text: `${g.name}${g.motto ? ' — «' + g.motto + '»' : ''}`, hidden: !!g.hidden } : null; }
      if (r.object_type === 'dm') { const m = q('SELECT type, text, kind, opt, hidden FROM dms WHERE id = ?').get(r.object_id); if (m && m.type !== 'voice' && m.type !== 'meme') m.text = U.unseal(m.text); return m ? { text: `[личное] ${m.type === 'voice' ? VOICE_MOD : m.text || `${m.kind} ${m.opt || ''}`}`, hidden: m.hidden === 1 } : null; }
      if (r.object_type === 'message') { const m = q('SELECT type, text, opt, kind, hidden FROM messages WHERE id = ?').get(r.object_id); if (m && m.type !== 'voice' && m.type !== 'meme') m.text = U.unseal(m.text); return m ? { text: m.type === 'voice' ? VOICE_MOD : m.text || `${m.kind} ${m.opt || ''}`, hidden: !!m.hidden } : null; }
      const s = q('SELECT type, zone, comment, hidden FROM signals WHERE id = ?').get(r.object_id);
      return s ? { text: `${s.type} ${s.zone || ''} ${s.comment || ''}`, hidden: !!s.hidden } : null;
    };
    return {
      users: q('SELECT COUNT(*) AS n FROM users').get().n,
      activeToday: q('SELECT COUNT(DISTINCT user_id) AS n FROM checkins WHERE day = ?').get(U.msk().day).n,
      gangs: q('SELECT COUNT(*) AS n FROM gangs').get().n,
      offices: offices(),
      reports: reports.map((r) => ({ ...r, preview: preview(r) })),
      facilities: q(`SELECT s.id, o.name AS office, s.type, s.zone, s.comment, s.at FROM signals s JOIN offices o ON o.id = s.office_id
                     WHERE s.confirmed_at IS NOT NULL AND s.hidden = 0 AND s.expires_at > ? ORDER BY s.at DESC`).all(U.now())
        .filter((s) => SIGNALS[s.type] && SIGNALS[s.type].toFacilities)
        .map((s) => ({ ...s, type: SIGNALS[s.type].label }))
    };
  });

  route('POST', '/api/admin/report', async (req, body) => {
    requireAdmin(req);
    const table = { gang: 'gangs', message: 'messages', signal: 'signals', dm: 'dms', board: 'board_posts' }[body.type];
    if (!table) throw bad('Неизвестный тип.');
    const id = Number(body.id);
    if (body.action === 'hide') q(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(id);
    if (body.action === 'restore') q(`UPDATE ${table} SET hidden = 0 WHERE id = ?`).run(id);
    q("UPDATE reports SET status = 'closed' WHERE object_type = ? AND object_id = ?").run(body.type, id);
    return { ok: true };
  });

  route('POST', '/api/admin/office', async (req, body) => {
    requireAdmin(req);
    const o = officeById(body.id);
    if (!o) throw bad('Нет такого офиса.');
    const seats = Math.max(10, Math.min(2000, Number(body.seats) || o.seats));
    const share = Math.max(0.02, Math.min(1, Number(body.share_p) || o.share_p));
    q('UPDATE offices SET seats = ?, share_p = ? WHERE id = ?').run(seats, share, o.id);
    return { ok: true };
  });

  // ---------- Заявки новых компаний ----------
  const adminIds = () => q('SELECT id, email_hash FROM users').all().filter((r) => adminHashes.has(r.email_hash)).map((r) => r.id);
  access = require('./access').register({ db, q, route, U, config, bad, HttpError, rateLimit, notify, fireAndForget, requireAdmin, adminIds });

  // ---------- Функции второго этапа ----------
  features = require('./features').register({
    db, q, route, requireUser, requireAdmin, bad, U, config, addBeans, spendBeans, notify, fireAndForget,
    isMember, gangMembers, myGangs, activeCheckin, readProfile, presenceOf, fullName, weekdayName, addDays, pushEvent, officeById, publicLook,
    profilePct: (row) => profileCompletion({ ...DEFAULT_LOOK, ...JSON.parse(row.look || '{}') }, readProfile(row.profile), !!q('SELECT 1 FROM push_subs WHERE user_id = ?').get(row.id)).pct
  });

  // ---------- Голосовые: до 30 секунд, живут час ----------
  voice = require('./voice').register({ db, q, route, requireUser, bad, U, HttpError, isMember, rateLimit });
  // Объёмные аватары: картинка собирается на сервере из слоёв (включается на клиенте отдельно)
  require('./ava').register({ route, requireUser, bad, U });

  // ---------- Праздники: Тайный Санта банды и адвент-календарь ----------
  santa = require('./santa').register({ db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  advent = require('./advent').register({ db, q, route, requireUser, bad, U, config, addBeans, workdayName: weekdayName, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });

  // ---------- Подельники: личные контакты ----------
  crew = require('./crew').register({
    voice,
    addBeans,
    pollsUnvoted: (uid, gid) => (polls ? polls.unvoted(uid, gid) : 0),
    // Важное о банде для карточки «Моя банда»: кто в офисе, место в Лиге, ближайшее событие, голосование за герб
    gangSummary: (gid, uid) => ({ inOffice: gangOffice(gid), league: league ? league.weekPlace(gid) : null, next: gevents ? gevents.next(gid) : null, glory: treasury ? treasury.balance(gid) : 0, crestVote: crestvote ? crestvote.pending(gid, uid) : null, wars: gangwar ? gangwar.summary(gid, uid) : null }),
    db, q, route, requireUser, bad, U, config, notify, fireAndForget, rateLimit, memberStatus, HttpError, publicLook,
    onEvent: (t, uid, d) => features && features.onEvent(t, uid, d)
  });
  quiz = require('./quiz').register({ db, q, route, requireUser, requireAdmin, bad, U, addBeans, isMember, gangMembers, readProfile, HttpError, DEFAULT_LOOK, publicLook, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  battle = require('./battle').register({ db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, publicLook, addBeans, spendBeans, canDm: (u, t) => (crew ? crew.canDm(u, t) : false), onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  blitz = require('./blitz').register({ db, q, route, requireUser, bad, U, addBeans, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  polls = require('./polls').register({ db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, rateLimit, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  gevents = require('./gevents').register({ db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, rateLimit, readProfile, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  treasury = require('./treasury').register({ db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError });
  crestvote = require('./crestvote').register({ db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, crestClean });
  require('./botgames').register({ db, q, route, requireUser, bad, U, HttpError, rateLimit, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  duels = require('./duels').register({ db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, addBeans, spendBeans, publicLook, canDm: (u, t) => (crew ? crew.canDm(u, t) : false), onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  gangwar = require('./gangwar').register({ db, q, route, requireUser, requireAdmin, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, spendBeans, battle, publicLook });
  league = require('./league').register({ db, q, route, requireUser, U, addBeans, notify, fireAndForget });
  tourney = require('./tourney').register({ db, q, route, requireUser, requireAdmin, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, gangwar, league });
  // ---------- Доска объявлений на весь «Этаж» ----------
  board = require('./board').register({ db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, rateLimit, officeById, publicLook, fullName });
  // ---------- Секретный чат один на один (сквозное шифрование) ----------
  secret = require('./secret').register({ db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, rateLimit, canDm: (u, t) => (crew ? crew.canDm(u, t) : true) });
  // ---------- Пятничная пятиминутка банды ----------
  friday = require('./friday').register({ db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, readProfile, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  // ---------- «Мой стиль»: личная карточка поведения по действиям (без текстов), видит только сам человек ----------
  {
    style = require('./style').register({ db, q, route, requireUser, U, publicLook, myGangs, gangMembers, bad });
    const orig = features.onEvent;
    features.onEvent = (t, uid, d) => { style.track(t, uid, d); return orig(t, uid, d); };
  }
  // ---------- «Батарейка недели»: самотест на усталость, результат — только себе; подзарядка от своих по просьбе ----------
  battery = require('./battery').register({ db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, readProfile, myGangs, gangMembers, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d), areCrew: (a, b) => !!q("SELECT 1 FROM crew WHERE lo = ? AND hi = ? AND status = 'ok'").get(Math.min(a, b), Math.max(a, b)), publicLook });
  // ---------- «Дела дня»: напоминалка про жизнь в офисе, до трёх дел, похвала и подкол ----------
  todos = require('./todos').register({ db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, readProfile, features, addBeans, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d), myGangs, gangMembers, publicLook });
  // ---------- «Волна» по банде: клич раз в неделю ----------
  wave = require('./wave').register({ db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, publicLook, weekdayName, onEvent: (t, uid, d) => features && features.onEvent(t, uid, d) });
  // ---------- Погода на завтра: вечером накануне офисного дня ----------
  weather = require('./weather').register({ db, q, U, notify, fireAndForget, readProfile, weekdayName, features });
  // ---------- «Этаж» пишет сам: живая сводка и один утренний пуш ----------
  // Задания дня знают, что сейчас доступно: дела, пятиминутка, волна, блиц, батарейка
  if (features && features.setQuestProviders) features.setQuestProviders({
    todos: (uid) => (todos ? todos.pending(uid) : 0),
    friday: (uid) => !!(friday && friday.pending(uid, myGangs(uid)).length),
    wave: (uid) => !!(wave && wave.pending(uid, myGangs(uid)).length),
    battery: (uid) => !!(battery && battery.pending(uid)),
    blitz: (uid) => { const set = blitz && blitz.activeSet(); return !!(set && !q('SELECT 1 FROM blitz_runs WHERE user_id = ? AND set_id = ?').get(uid, set.id)); }
  });
  inbox = require('./inbox').register({ markStreak, db, q, route, requireUser, U, notify, fireAndForget, myGangs, readProfile, weekdayName, features, blitz, advent, santa, duels, gevents, polls, weather, friday, wave, battery: () => battery, todos: () => todos });
  feedback = require('./feedback').register({ db, q, route, requireUser, requireAdmin, bad, U, addBeans, notify, fireAndForget, HttpError, BUILD });

  // Разово шифруем старую переписку, лежащую в базе открытым текстом (повторный запуск ничего не меняет)
  try {
    for (const t of ['messages', 'dms']) {
      const rows = q(`SELECT id, text FROM ${t} WHERE type IN ('text', 'call') AND text IS NOT NULL AND text != '' AND text NOT LIKE 'e1:%'`).all();
      if (!rows.length) continue;
      const up = q(`UPDATE ${t} SET text = ? WHERE id = ?`);
      db.exec('BEGIN'); for (const r of rows) up.run(U.seal(r.text), r.id); db.exec('COMMIT');
    }
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} console.error('seal migrate', e.message); }

  // ---------- Обработчик ----------
  // Пачка GET-запросов одним махом: клиент собирает запросы одного мгновения (старт, обновление, смена вкладки)
  // и шлёт их вместе — вместо 10–30 отдельных. Каждый выполняется как обычный GET с теми же проверками
  route('POST', '/api/batch', async (req, body) => {
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 40) : [];
    const out = [];
    for (const raw of paths) {
      try {
        const url = new URL(String(raw), 'http://x');
        if (!url.pathname.startsWith('/api/') || url.pathname === '/api/batch') throw new HttpError(400, 'Не тот адрес.');
        const r = routes.find((x) => x.method === 'GET' && x.re.test(url.pathname));
        if (!r) throw new HttpError(404, 'Не найдено.');
        const m = r.re.exec(url.pathname);
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const sub = Object.create(req); sub.method = 'GET'; sub.url = url.pathname + url.search;
        const res = await viewerCtx.run({}, () => r.handler(sub, {}, Object.fromEntries(url.searchParams), params));
        if (res && (res._raw || res._setCookie)) throw new HttpError(400, 'Этот запрос — только отдельно.');
        out.push({ s: 200, j: res === undefined ? {} : res });
      } catch (e) {
        out.push(e instanceof HttpError ? { s: e.status, j: { error: e.message } } : (console.error('[batch]', e), { s: 500, j: { error: 'Что-то сломалось. Попробуй ещё раз.' } }));
      }
    }
    return { r: out };
  }, { maxBody: 16 * 1024 });

  async function handle(req, res, pathname, query) {
    const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
    if (!r) throw new HttpError(404, 'Не найдено.');
    if (req.method !== 'GET') {
      // Защита от CSRF: только JSON с нашего же сайта
      const ct = req.headers['content-type'] || '';
      if (req.method !== 'DELETE' && !ct.includes('application/json')) throw bad('Ожидается JSON.');
      const origin = req.headers.origin;
      if (origin && origin !== config.baseUrl) throw new HttpError(403, 'Запрос с чужого сайта.');
    }
    const m = r.re.exec(pathname);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = req.method === 'GET' ? {} : await readJson(req, r.maxBody);
    return viewerCtx.run({}, () => r.handler(req, body, query, params));
  }

  function verifyLogin(token) {
    return loginByTokenHash(U.sha256(String(token || '')));
  }

  function loginByTokenHash(tokenHash) {
    const row = q('SELECT * FROM login_tokens WHERE token_hash = ?').get(tokenHash);
    if (!row || row.used || row.expires_at < U.now()) return null;
    q('UPDATE login_tokens SET used = 1 WHERE token_hash = ?').run(row.token_hash);
    let user = q('SELECT * FROM users WHERE email_hash = ?').get(row.email_hash);
    if (!user) {
      const r = q('INSERT INTO users (email_hash, created_at, consent_at, look, profile, company) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.email_hash, U.now(), U.now(), JSON.stringify(DEFAULT_LOOK), JSON.stringify(DEFAULT_PROFILE), row.company || 'mts');
      user = { id: Number(r.lastInsertRowid) };
    }
    const session = U.randomToken(32);
    q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(U.sha256(session), user.id, U.now(), U.now() + config.sessionDays * 864e5);
    return sessionCookie(session, config.sessionDays * 86400);
  }

  // Удаление устаревших данных — раз в 10 минут
  function cleanup() {
    const t = U.now();
    q('DELETE FROM messages WHERE at < ?').run(t - 24 * 3600e3);
    q('UPDATE canteen SET user_id = NULL WHERE at < ? AND user_id IS NOT NULL').run(t - 24 * 3600e3);
    q('DELETE FROM canteen WHERE at < ?').run(t - 30 * 864e5);
    q("DELETE FROM gang_invites WHERE at < ? AND status != 'pending'").run(t - 30 * 864e5);
    q('DELETE FROM gang_invites WHERE at < ?').run(t - 30 * 864e5);
    q('DELETE FROM checkins WHERE day < ?').run(U.msk().day);
    q('DELETE FROM login_tokens WHERE expires_at < ?').run(t - 3600e3);
    q('DELETE FROM sessions WHERE expires_at < ?').run(t);
    q('DELETE FROM signals WHERE expires_at < ?').run(t - 24 * 3600e3);
    q('DELETE FROM events WHERE at < ?').run(t - 7 * 864e5);
    // Истёкшие «болею» и прошедшие отпуска физически удаляются из профиля, а не только скрываются
    for (const r of q("SELECT id, profile FROM users WHERE profile LIKE '%\"today\":{%' OR profile LIKE '%\"from\"%'").all()) {
      const clean = JSON.stringify(readProfile(r.profile));
      if (clean !== r.profile) q('UPDATE users SET profile = ? WHERE id = ?').run(clean, r.id);
    }
    if (features) features.cleanup();
    if (crew) crew.cleanup();
    if (battle) battle.cleanup();
    if (quiz) quiz.cleanup();
    if (board) board.cleanup();
    if (secret) secret.cleanup();
    if (friday) friday.cleanup();
    if (wave) wave.cleanup();
    if (battery) battery.cleanup();
    if (todos) todos.cleanup();
    if (feedback) feedback.cleanup();
    if (polls) polls.cleanup();
    if (gevents) gevents.cleanup();
    if (duels) duels.cleanup();
    if (voice) voice.cleanup();
  }

  return { handle, verifyLogin, confirmAccess: (t) => access.confirm(t), cleanup, HttpError };
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Слишком большой запрос.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Некорректный JSON.')); }
    });
    req.on('error', reject);
  });
}

module.exports = { nameCase, createApi, HttpError, LOOK };
