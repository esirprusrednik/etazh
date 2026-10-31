const { config } = require('./config');
const U = require('./util');
const { MOODS, CALLS, SIGNALS, SHOP, EARN, GANG_DEPOSIT, GANG_COLORS } = require('./catalog');
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
const LOOK = {
  preset: ['m', 'f'],
  hairStyle: ['short', 'long', 'tail', 'curly'],
  hair: ['#2B1D14', '#6B3E26', '#E0B04B', '#C2412F', '#9AA3B5'],
  skin: ['#F6D3B3', '#E8B48A', '#C98E62', '#8D5A3B'],
  hoodie: ['red', 'blue', 'green', 'violet', 'navy']
};
const DEFAULT_LOOK = { preset: 'm', hairStyle: 'short', hair: '#2B1D14', skin: '#E8B48A', hoodie: 'blue', glasses: false, phones: false, status: null, frame: null, crown: false };
// plan — где обычно работаю по дням недели: { Пн: 'office' | 'home' }
// today — ручной статус на сегодня: { kind: 'home' | 'vacation', day: 'YYYY-MM-DD' }
// vacations — график отпусков: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }]
const DEFAULT_PROFILE = { coffee: false, mood: 'coffee', home: null, days: [], plan: {}, today: null, vacations: [], about: '', tags: [], bday: '', showBday: true };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekdayName = (day) => [null, 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', null][new Date(day + 'T00:00:00Z').getUTCDay()];

function readProfile(json) {
  const prof = { ...DEFAULT_PROFILE, ...JSON.parse(json || '{}') };
  // Старое поле days («обычно в офисе») превращается в план
  if (prof.days.length && !Object.keys(prof.plan).length) prof.plan = Object.fromEntries(prof.days.map((d) => [d, 'office']));
  const today = U.msk().day;
  prof.vacations = prof.vacations.filter((v) => v.to >= today);
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
  const vac = prof.vacations.find((v) => v.from <= day && day <= v.to);
  if (vac) return { where: 'vacation', until: vac.to };
  if (manual === 'vacation') return { where: 'vacation', until: day };
  if (manual === 'sick') return { where: 'sick', until: prof.today.to || day };
  if (!weekdayName(day)) return { where: 'weekend' };
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
const TAGS = ['Кофе', 'Настолки', 'Бег', 'Велосипед', 'Викторины', 'Кино', 'Музыка', 'Книги', 'Путешествия', 'Кулинария', 'Футбол', 'Йога'];
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];

function createApi(db) {
  let features = null;
  let crew = null;
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
    if (features && u.nick) features.onEvent('active', u.id);
    return u;
  }

  // ---------- Зёрна ----------
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
    return amount;
  }

  function spendBeans(userId, amount, reason) {
    const r = q('UPDATE users SET beans = beans - ? WHERE id = ? AND beans >= ?').run(amount, userId, amount);
    if (!r.changes) return false;
    q('INSERT INTO ledger (user_id, amount, reason, day, at) VALUES (?, ?, ?, ?, ?)').run(userId, -amount, reason, U.msk().day, U.now());
    return true;
  }

  // ---------- Офис и столовая ----------
  const offices = () => q('SELECT * FROM offices ORDER BY sort').all();
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

  // ---------- Банды ----------
  const myGangs = (userId) => q(`SELECT g.* FROM gangs g JOIN gang_members m ON m.gang_id = g.id
                                 WHERE m.user_id = ? AND g.hidden = 0 ORDER BY m.joined_at`).all(userId);
  const isMember = (gangId, userId) => !!q('SELECT 1 FROM gang_members WHERE gang_id = ? AND user_id = ?').get(gangId, userId);
  const memberCount = (gangId) => q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(gangId).n;

  function memberStatus(member) {
    const prof = readProfile(member.profile);
    const look = { ...DEFAULT_LOOK, ...JSON.parse(member.look || '{}') };
    const pr = member.share_office ? presenceOf(prof, activeCheckin(member.id), member.id) : { where: 'hidden' };
    return {
      id: member.id, nick: member.nick, mood: MOODS[prof.mood] || '', where: pr.where, office: pr.office || null,
      until: pr.until || null, planned: !!pr.planned, joke: pr.joke ?? null, look, status: statusName(look.status)
    };
  }

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
      const subs = q('SELECT * FROM push_subs WHERE user_id = ?').all(uid);
      for (const s of subs) {
        const r = await sendPush(s, payload);
        if (r.gone) q('DELETE FROM push_subs WHERE id = ?').run(s.id);
      }
    }
  }

  const fireAndForget = (p) => p.catch((e) => console.error('[push]', e.message));

  function pushEvent(officeId, userId, text) {
    q('INSERT INTO events (office_id, user_id, text, at) VALUES (?, ?, ?, ?)').run(officeId, userId, text, U.now());
  }

  // ---------- Маршруты ----------
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  // Вход: одноразовая ссылка на рабочую почту
  route('POST', '/api/auth/request', async (req, body) => {
    const email = U.normalizeEmail(body.email);
    rateLimit('auth-ip:' + req.ip, 10, 15 * 60e3);
    if (!U.emailDomainAllowed(email)) throw bad(`Регистрация только с рабочей почты ${config.allowedDomains.map((d) => '@' + d).join(', ')}.`);
    if (body.consent !== true) throw bad('Нужно согласие с политикой и правилами.');
    const emailHash = U.hashEmail(email);
    rateLimit('auth-mail:' + emailHash, 3, 15 * 60e3);
    const token = U.randomToken(32);
    const code = String(require('node:crypto').randomInt(0, 1e6)).padStart(6, '0');
    q('INSERT INTO login_tokens (token_hash, email_hash, code_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(U.sha256(token), emailHash, U.sha256(emailHash + ':' + code), U.now() + config.loginTokenMinutes * 60e3);
    const link = `${config.baseUrl}/auth/verify?t=${token}`;
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
    q('DELETE FROM users WHERE id = ?').run(u.id);
    return { ok: true, _setCookie: sessionCookie('', 0) };
  });

  route('GET', '/api/me', async (req) => {
    const u = currentUser(req);
    if (!u) return { user: null, vapidKey: config.vapid.publicKey || null, domains: config.allowedDomains };
    const owned = q('SELECT item_id FROM owned WHERE user_id = ?').all(u.id).map((r) => r.item_id);
    // Серия: сколько рабочих дней подряд была отметка в офисе (по журналу зёрен, он хранится всегда)
    const days = new Set(q("SELECT DISTINCT day FROM ledger WHERE user_id = ? AND reason = 'checkin' ORDER BY day DESC LIMIT 90").all(u.id).map((r) => r.day));
    let streak = 0;
    let d = U.msk().day;
    if (!days.has(d)) d = addDays(d, -1);
    for (let guard = 0; guard < 120; guard++, d = addDays(d, -1)) {
      if (!weekdayName(d)) continue;
      if (days.has(d)) streak++; else break;
    }
    const earned = q('SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE user_id = ? AND amount > 0').get(u.id).s;
    const level = 1 + Math.floor(Math.sqrt(earned / 15));
    return {
      user: {
        id: u.id, nick: u.nick, beans: u.beans, look: u.look, profile: u.profile, shareOffice: !!u.share_office, quiet: !!u.quiet,
        welcomed: !!u.welcomed, isAdmin: u.isAdmin, owned, status: statusName(u.look.status), streak, level,
        nickChangeableAt: u.nick_changed_at ? u.nick_changed_at + 30 * 864e5 : null,
        gangs: myGangs(u.id).map((g) => ({ id: g.id, name: g.name, color: g.color }))
      },
      vapidKey: config.vapid.publicKey || null,
      domains: config.allowedDomains,
      catalog: {
        moods: MOODS,
        calls: Object.fromEntries(Object.entries(CALLS).map(([k, v]) => [k, { label: v.label, opts: v.opts, needsText: !!v.needsText }])),
        signals: Object.fromEntries(Object.entries(SIGNALS).map(([k, v]) => [k, v.label])),
        tags: TAGS, days: DAYS, look: LOOK, gangColors: GANG_COLORS, idleJokes: IDLE_JOKES,
        offices: offices().map((o) => ({ id: o.id, name: o.name, color: o.color }))
      }
    };
  });

  route('GET', '/api/nick-suggestions', async () => {
    const adjs = ['бодрый', 'ночной', 'быстрый', 'тихий', 'весёлый', 'хитрый', 'солнечный', 'кофейный', 'смелый', 'мудрый'];
    const nouns = ['енот', 'кит', 'барсук', 'дракон', 'филин', 'ниндзя', 'пельмень', 'бобр', 'лис', 'ёж'];
    const out = new Set();
    let guard = 0;
    while (out.size < 4 && guard++ < 50) {
      const n = '@' + adjs[Math.floor(Math.random() * adjs.length)] + '_' + nouns[Math.floor(Math.random() * nouns.length)];
      if (!q('SELECT 1 FROM users WHERE nick = ?').get(n)) out.add(n);
    }
    return { nicks: [...out] };
  });

  route('POST', '/api/me/nick', async (req, body) => {
    const u = requireUser(req, { nick: false });
    let nick = U.cleanText(body.nick, 21);
    if (!nick.startsWith('@')) nick = '@' + nick;
    if (!/^@[a-zA-Zа-яА-ЯёЁ0-9_]{3,20}$/.test(nick)) throw bad('От 3 до 20 символов: буквы, цифры и «_», без пробелов.');
    const prob = U.moderationProblem(nick.slice(1));
    if (prob) throw bad(prob);
    if (u.nick && u.nick_changed_at && U.now() - u.nick_changed_at < 30 * 864e5) throw bad('Никнейм можно менять не чаще раза в 30 дней.');
    if (q('SELECT 1 FROM users WHERE nick = ? COLLATE NOCASE AND id != ?').get(nick, u.id)) throw bad('Такой никнейм уже занят.');
    const first = !u.nick;
    q('UPDATE users SET nick = ?, nick_changed_at = ? WHERE id = ?').run(nick, first ? null : U.now(), u.id);
    if (first && !u.welcomed) {
      addBeans(u.id, 'welcome');
      q('UPDATE users SET welcomed = 1 WHERE id = ?').run(u.id);
      pushEvent(null, u.id, `${nick} присоединился к Этажу`);
    }
    return { ok: true, nick };
  });

  route('POST', '/api/me/profile', async (req, body) => {
    const u = requireUser(req);
    const look = { ...u.look };
    if (body.look) {
      const l = body.look;
      for (const k of ['preset', 'hairStyle', 'hair', 'skin', 'hoodie']) if (l[k] !== undefined && LOOK[k].includes(l[k])) look[k] = l[k];
      if (l.glasses !== undefined) look.glasses = !!l.glasses;
      if (l.phones !== undefined) look.phones = !!l.phones;
    }
    const prof = { ...u.profile };
    if (body.profile) {
      const p = body.profile;
      if (p.mood !== undefined && MOODS[p.mood]) prof.mood = p.mood;
      if (p.home !== undefined && (p.home === null || officeById(p.home))) prof.home = p.home;
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
          if (v.to >= today) list.push({ from: v.from, to: v.to });
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
      if (p.coffee !== undefined) prof.coffee = !!p.coffee;
    }
    const share = body.shareOffice === undefined ? u.share_office : body.shareOffice ? 1 : 0;
    const quiet = body.quiet === undefined ? u.quiet : body.quiet ? 1 : 0;
    q('UPDATE users SET look = ?, profile = ?, share_office = ?, quiet = ? WHERE id = ?').run(JSON.stringify(look), JSON.stringify(prof), share, quiet, u.id);
    return { ok: true };
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
    const newFeed = q('SELECT COUNT(*) AS n FROM events WHERE at > ? AND (office_id IS NULL OR office_id = ?) AND (user_id IS NULL OR user_id != ?)').get(seenFeed, ci ? ci.office_id : '', u.id).n
      + (ci ? q('SELECT COUNT(*) AS n FROM signals WHERE office_id = ? AND at > ? AND hidden = 0 AND expires_at > ?').get(ci.office_id, seenFeed, U.now()).n : 0);
    const canteenOpen = ci ? q('SELECT * FROM canteen WHERE user_id = ? AND done_at IS NULL AND at > ? ORDER BY at DESC LIMIT 1').get(u.id, U.now() - 60 * 60e3) : null;
    return {
      now: U.now(), msk: U.msk().hhmm, night: U.isAfterCheckinCutoff(),
      beans: q('SELECT beans FROM users WHERE id = ?').get(u.id).beans,
      checkin: ci ? { office: ci.office_id, name: office.name, at: ci.at, since: U.msk(ci.at).hhmm } : null,
      today: U.msk().day,
      presence: presenceOf(u.profile, ci, u.id),
      nextVacation: u.profile.vacations.find((v) => v.from > U.msk().day) || null,
      canteen: office ? canteenEstimate(office) : null,
      inCanteen: !!canteenOpen,
      gangNow: { hasGang: gangs.length > 0, rows: rows.slice(0, 6), more: Math.max(0, rows.length - 6) },
      badges: { chat: newChat, feed: newFeed, crew: crew ? crew.unread(u.id) : 0 }
    };
  });

  route('POST', '/api/checkin', async (req, body) => {
    const u = requireUser(req);
    if (U.isAfterCheckinCutoff()) throw bad('Отметки откроются завтра утром.');
    const office = officeById(body.office);
    if (!office) throw bad('Нет такого офиса.');
    const day = U.msk().day;
    const ci = activeCheckin(u.id);
    if (ci && ci.office_id === office.id) return { ok: true, beans: 0 };
    if (ci) q('UPDATE checkins SET left_at = ? WHERE id = ?').run(U.now(), ci.id);
    q('INSERT INTO checkins (user_id, office_id, day, at) VALUES (?, ?, ?, ?)').run(u.id, office.id, day, U.now());
    // Пришёл в офис — ручной статус «дома/отпуск» на сегодня больше не актуален
    if (u.profile.today) q('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify({ ...u.profile, today: null }), u.id);
    const got = addBeans(u.id, 'checkin');
    if (features) features.onEvent('checkin', u.id, { office: office.id });
    if (u.share_office) pushEvent(office.id, u.id, `${u.nick} в офисе`);
    return { ok: true, beans: got };
  });

  route('POST', '/api/checkout', async (req) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    if (ci) q('UPDATE checkins SET left_at = ? WHERE id = ?').run(U.now(), ci.id);
    q('UPDATE canteen SET done_at = ? WHERE user_id = ? AND done_at IS NULL').run(U.now(), u.id);
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
    const color = GANG_COLORS.includes(body.color) ? body.color : GANG_COLORS[0];
    if (!spendBeans(u.id, GANG_DEPOSIT, 'gang_deposit')) throw bad(`Нужно ${GANG_DEPOSIT} зёрен на залог. Залог вернётся, когда в банде будет 3 человека.`);
    let code;
    do code = U.shortCode(6); while (q('SELECT 1 FROM gangs WHERE code = ?').get(code));
    const r = q('INSERT INTO gangs (name, color, code, owner_id, deposit, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(name, color, code, u.id, U.now());
    q('INSERT INTO gang_members (gang_id, user_id, joined_at) VALUES (?, ?, ?)').run(r.lastInsertRowid, u.id, U.now());
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
    q('INSERT INTO gang_members (gang_id, user_id, joined_at) VALUES (?, ?, ?)').run(g.id, u.id, U.now());
    if (g.deposit && memberCount(g.id) >= 3 && g.owner_id) {
      q('UPDATE gangs SET deposit = 0 WHERE id = ?').run(g.id);
      addBeans(g.owner_id, 'deposit_back');
    }
    if (features) features.onEvent('gang_join', u.id);
    return { ok: true, id: g.id };
  });

  route('POST', '/api/gangs/:id/leave', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ?').get(Number(params.id));
    if (!g || !isMember(g.id, u.id)) throw bad('Ты не в этой банде.');
    q('DELETE FROM gang_members WHERE gang_id = ? AND user_id = ?').run(g.id, u.id);
    const next = q('SELECT user_id FROM gang_members WHERE gang_id = ? ORDER BY joined_at LIMIT 1').get(g.id);
    if (!next) q('DELETE FROM gangs WHERE id = ?').run(g.id);
    else if (g.owner_id === u.id) q('UPDATE gangs SET owner_id = ? WHERE id = ?').run(next.user_id, g.id);
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
        id: g.id, name: g.name, color: g.color, motto: g.motto, gold: !!g.gold, mottoOwned: !!g.motto_owned,
        code: g.code, link: `${config.baseUrl}/g/${g.code}`, isOwner: g.owner_id === u.id,
        depositPending: !!g.deposit && members.length < 3, count: members.length
      },
      members: statuses.map((s) => ({ ...s, officeName: s.office ? officeName[s.office] : null })),
      messages: msgs.map((m) => {
        const mine = m.user_id === u.id;
        const rs = replies.filter((r) => r.message_id === m.id).map((r) => ({ nick: r.nick, label: r.label, me: r.user_id === u.id }));
        const def = m.type === 'call' ? CALLS[m.kind] : null;
        return {
          id: m.id, type: m.type, kind: m.kind, author: m.author || 'удалённый аккаунт', mine, at: m.at, time: U.msk(m.at).hhmm,
          toNick: m.to_nick, toMe: m.to_user_id === u.id, opt: m.opt, text: m.text,
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
    if (body.type === 'text') {
      const text = U.cleanText(body.text, 300);
      if (!text) throw bad('Пустое сообщение.');
      const prob = U.moderationProblem(text, { allowAt: true });
      if (prob) throw bad(prob);
      q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(g.id, u.id, 'text', text, U.now());
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
    if (def.needsText) {
      text = U.cleanText(body.text, 40);
      if (!text) throw bad('Укажи, какая переговорка.');
      const prob = U.moderationProblem(text);
      if (prob) throw bad(prob);
    }
    q('INSERT INTO messages (gang_id, user_id, type, kind, to_user_id, opt, text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(g.id, u.id, 'call', body.kind, toId, opt, text, U.now());
    if (features) features.onEvent('call', u.id);
    // Текст пуша нейтральный: без названий офисов и подробностей
    const recipients = toId ? [toId] : gangMembers(g.id).map((m) => m.id).filter((id) => id !== u.id);
    fireAndForget(notify(recipients, { title: g.name, body: `${u.nick} ${def.verb}${opt ? ' · ' + opt.toLowerCase() : ''}`, url: `/#gang/${g.id}`, tag: `gang-${g.id}` }));
    const away = recipients.filter((id) => {
      const r = q('SELECT profile FROM users WHERE id = ?').get(id);
      return r && ['vacation', 'sick'].includes(presenceOf(readProfile(r.profile), activeCheckin(id)).where);
    }).length;
    return { ok: true, quiet: U.isQuietHour(), away };
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
    if (!r.changes) throw bad('Ты уже ответил.');
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
                      WHERE e.at > ? AND (e.office_id IS NULL OR e.office_id = ?) ORDER BY e.at DESC LIMIT 60`).all(U.now() - 48 * 3600e3, officeId || '');
    const signals = officeId
      ? q('SELECT * FROM signals WHERE office_id = ? AND hidden = 0 AND expires_at > ? ORDER BY at DESC').all(officeId, U.now())
      : [];
    const votes = (id) => q('SELECT COALESCE(SUM(vote = 1), 0) AS up, COALESCE(SUM(vote = -1), 0) AS down FROM signal_votes WHERE signal_id = ?').get(id);
    return {
      office: officeId,
      events: events.map((e) => ({ id: e.id, text: e.text, at: e.at, time: U.msk(e.at).hhmm, office: e.office_name || null })),
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
    const type = ['gang', 'message', 'signal', 'dm'].includes(body.type) ? body.type : null;
    const id = Number(body.id);
    if (!type || !id) throw bad('Непонятно, на что жалоба.');
    // На личное сообщение жалуется только тот, кому оно пришло. Модератор увидит только его
    if (type === 'dm' && !q('SELECT 1 FROM dms WHERE id = ? AND to_id = ?').get(id, u.id)) throw bad('Сообщение не найдено.');
    q('INSERT OR IGNORE INTO reports (reporter_id, object_type, object_id, reason, at) VALUES (?, ?, ?, ?, ?)').run(u.id, type, id, U.cleanText(body.reason, 200) || null, U.now());
    const n = q("SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE object_type = ? AND object_id = ? AND status = 'open'").get(type, id).n;
    if (n >= 3) {
      const table = { gang: 'gangs', message: 'messages', signal: 'signals', dm: 'dms' }[type];
      q(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(id);
    }
    return { ok: true };
  });

  // ---------- Лавка ----------
  route('GET', '/api/shop', async (req) => {
    const u = requireUser(req);
    const owned = new Set(q('SELECT item_id FROM owned WHERE user_id = ?').all(u.id).map((r) => r.item_id));
    return {
      beans: u.beans,
      items: SHOP.map((it) => ({
        ...it,
        owned: it.kind === 'gang' ? undefined : owned.has(it.id),
        equipped: it.kind === 'status' ? u.look.status === it.id : it.kind === 'frame' ? u.look.frame === it.id : it.kind === 'crown' ? !!u.look.crown : undefined,
        left: it.limit ? Math.max(0, it.limit - q('SELECT COUNT(*) AS n FROM owned WHERE item_id = ?').get(it.id).n) : undefined
      }))
    };
  });

  route('POST', '/api/shop/buy', async (req, body) => {
    const u = requireUser(req);
    const it = SHOP.find((s) => s.id === body.item);
    if (!it) throw bad('Нет такого предмета.');
    if (it.kind === 'gang') {
      const g = q('SELECT * FROM gangs WHERE id = ?').get(Number(body.gangId));
      if (!g || !isMember(g.id, u.id)) throw bad('Выбери свою банду.');
      const col = it.id === 'g_gold' ? 'gold' : 'motto_owned';
      if (g[col]) throw bad('У банды это уже есть.');
      if (!spendBeans(u.id, it.price, 'shop:' + it.id)) throw bad('Не хватает зёрен.');
      q(`UPDATE gangs SET ${col} = 1 WHERE id = ?`).run(g.id);
      return { ok: true };
    }
    if (q('SELECT 1 FROM owned WHERE user_id = ? AND item_id = ?').get(u.id, it.id)) throw bad('Уже куплено.');
    if (it.limit && q('SELECT COUNT(*) AS n FROM owned WHERE item_id = ?').get(it.id).n >= it.limit) throw bad('Тираж этого сезона закончился.');
    if (!spendBeans(u.id, it.price, 'shop:' + it.id)) throw bad('Не хватает зёрен.');
    q('INSERT INTO owned (user_id, item_id, at) VALUES (?, ?, ?)').run(u.id, it.id, U.now());
    const look = { ...u.look };
    if (it.kind === 'status') look.status = it.id;
    if (it.kind === 'frame') look.frame = it.id;
    if (it.kind === 'crown') look.crown = true;
    q('UPDATE users SET look = ? WHERE id = ?').run(JSON.stringify(look), u.id);
    pushEvent(null, u.id, `${u.nick} купил в лавке «${it.name}»`);
    return { ok: true };
  });

  route('POST', '/api/shop/equip', async (req, body) => {
    const u = requireUser(req);
    const it = SHOP.find((s) => s.id === body.item && s.kind !== 'gang');
    if (!it || !q('SELECT 1 FROM owned WHERE user_id = ? AND item_id = ?').get(u.id, it.id)) throw bad('Сначала купи предмет.');
    const look = { ...u.look };
    const on = !!body.on;
    if (it.kind === 'status') look.status = on ? it.id : null;
    if (it.kind === 'frame') look.frame = on ? it.id : null;
    if (it.kind === 'crown') look.crown = on;
    q('UPDATE users SET look = ? WHERE id = ?').run(JSON.stringify(look), u.id);
    return { ok: true };
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
      if (r.object_type === 'gang') { const g = q('SELECT name, motto, hidden FROM gangs WHERE id = ?').get(r.object_id); return g ? { text: `${g.name}${g.motto ? ' — «' + g.motto + '»' : ''}`, hidden: !!g.hidden } : null; }
      if (r.object_type === 'dm') { const m = q('SELECT text, kind, opt, hidden FROM dms WHERE id = ?').get(r.object_id); return m ? { text: `[личное] ${m.text || `${m.kind} ${m.opt || ''}`}`, hidden: !!m.hidden } : null; }
      if (r.object_type === 'message') { const m = q('SELECT text, opt, kind, hidden FROM messages WHERE id = ?').get(r.object_id); return m ? { text: m.text || `${m.kind} ${m.opt || ''}`, hidden: !!m.hidden } : null; }
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
    const table = { gang: 'gangs', message: 'messages', signal: 'signals', dm: 'dms' }[body.type];
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

  // ---------- Функции второго этапа ----------
  features = require('./features').register({
    db, q, route, requireUser, requireAdmin, bad, U, config, addBeans, spendBeans, notify, fireAndForget,
    isMember, gangMembers, myGangs, activeCheckin, readProfile, presenceOf, weekdayName, addDays, pushEvent, officeById
  });

  // ---------- Подельники: личные контакты ----------
  crew = require('./crew').register({
    db, q, route, requireUser, bad, U, config, notify, fireAndForget, rateLimit, memberStatus, HttpError
  });

  // ---------- Обработчик ----------
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
    const body = req.method === 'GET' ? {} : await readJson(req);
    return r.handler(req, body, query, params);
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
      const r = q('INSERT INTO users (email_hash, created_at, consent_at, look, profile) VALUES (?, ?, ?, ?, ?)')
        .run(row.email_hash, U.now(), U.now(), JSON.stringify(DEFAULT_LOOK), JSON.stringify(DEFAULT_PROFILE));
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
  }

  return { handle, verifyLogin, cleanup, HttpError };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new HttpError(413, 'Слишком большой запрос.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Некорректный JSON.')); }
    });
    req.on('error', reject);
  });
}

module.exports = { createApi, HttpError };
