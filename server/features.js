// Функции второго этапа: метрики пилота, неделя банды, «Спасибо», ачивки и задания,
// случайный кофе, обед компанией, дни рождения, еженедельная сводка.
// Подключается из api.js через register(ctx) и получает оттуда общие помощники.
const crypto = require('node:crypto');

const ACH = [
  { id: 'first_checkin', tier: 'common', name: 'Первый шаг', desc: 'Отметиться в офисе', test: (c) => c.checkins >= 1 },
  { id: 'gang', tier: 'common', name: 'В банде', desc: 'Вступить в банду или создать свою', test: (c) => c.gangs >= 1 },
  { id: 'reply', tier: 'common', name: 'На связи', desc: 'Ответить на зов банды', test: (c) => c.replies >= 1 },
  { id: 'thanks_give', tier: 'common', name: 'Вежливость', desc: 'Сказать коллеге спасибо', test: (c) => c.thanks_given >= 1 },
  { id: 'canteen5', tier: 'common', name: 'Завсегдатай', desc: '5 раз отметиться в столовой', test: (c) => c.canteen >= 5 },
  { id: 'streak5', tier: 'rare', name: 'Пятидневка', desc: '5 рабочих дней подряд в офисе', test: (c) => c.streak >= 5 },
  { id: 'two_offices', tier: 'rare', name: 'Путешественник', desc: 'Побывать в двух офисах', test: (c) => c.offices >= 2 },
  { id: 'thanks10', tier: 'rare', name: 'Душа банды', desc: 'Получить 10 спасибо', test: (c) => c.thanks_got >= 10 },
  { id: 'signals5', tier: 'rare', name: 'Глаза офиса', desc: '5 подтверждённых сигналов', test: (c) => c.signals >= 5 },
  { id: 'coffee', tier: 'rare', name: 'Новые лица', desc: 'Договориться о случайном кофе', test: (c) => c.coffee >= 1 },
  { id: 'streak20', tier: 'legendary', name: 'Железная воля', desc: '20 рабочих дней подряд в офисе', test: (c) => c.streak >= 20 },
  { id: 'all_offices', tier: 'legendary', name: 'Все этажи', desc: 'Побывать во всех трёх офисах', test: (c) => c.offices >= 3 },
  { id: 'thanks50', tier: 'legendary', name: 'Легенда банды', desc: 'Получить 50 спасибо', test: (c) => c.thanks_got >= 50 }
];
const ACH_REWARD = { common: 5, rare: 15, legendary: 40 };

const QUESTS = [
  { id: 'checkin', name: 'Отметься в офисе' },
  { id: 'reply', name: 'Ответь на зов банды' },
  { id: 'thanks', name: 'Скажи кому-нибудь спасибо' }
];
const QUEST_REWARD = 3;
const QUEST_ALL_BONUS = 5;
const THANKS_PER_DAY = 3;
const GIFT_BEANS = 10;
const COFFEE_OPTS = ['Сегодня в 11:00', 'Сегодня в 15:00', 'Завтра в 11:00', 'Завтра в 15:00'];
const COFFEE_REPLIES = ['Иду', 'Давай в другое время', 'Не смогу'];
const LUNCH_TIMES = ['11:30', '11:45', '12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30', '13:45', '14:00', '14:15', '14:30'];
const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function migrate(db) {
  db.exec(`
  -- Метрики пилота: только обезличенные агрегаты
  CREATE TABLE IF NOT EXISTS activity (day TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (day, uid));
  CREATE TABLE IF NOT EXISTS stats (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key));

  CREATE TABLE IF NOT EXISTS thanks (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    from_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT, day TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS thanks_gang_at ON thanks(gang_id, at);

  CREATE TABLE IF NOT EXISTS achievements (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ach TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, ach));
  CREATE TABLE IF NOT EXISTS counters (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, key));
  -- Только набор офисов, где человек бывал, без дат
  CREATE TABLE IF NOT EXISTS user_offices (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, office_id TEXT NOT NULL, PRIMARY KEY (user_id, office_id));
  CREATE TABLE IF NOT EXISTS quests_done (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, quest TEXT NOT NULL, PRIMARY KEY (user_id, day, quest));

  CREATE TABLE IF NOT EXISTS coffee_pairs (
    id INTEGER PRIMARY KEY, week TEXT NOT NULL, office_id TEXT,
    a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ping_by INTEGER, ping_opt TEXT, ping_at INTEGER, reply TEXT, reply_at INTEGER, at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lunches (
    id INTEGER PRIMARY KEY, office_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    time TEXT NOT NULL, place TEXT, day TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lunch_joins (
    lunch_id INTEGER NOT NULL REFERENCES lunches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, PRIMARY KEY (lunch_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS gifts (from_id INTEGER NOT NULL, to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (from_id, to_id, day));
  `);
}

function register(ctx) {
  const { db, q, route, requireUser, requireAdmin, bad, U, config, addBeans, spendBeans, notify, fireAndForget,
    isMember, gangMembers, myGangs, activeCheckin, readProfile, presenceOf, weekdayName, addDays, pushEvent, officeById } = ctx;
  migrate(db);

  const meta = {
    get: (k) => (q('SELECT value FROM meta WHERE key = ?').get(k) || {}).value,
    set: (k, v) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
  };
  const today = () => U.msk().day;
  const mondayOf = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const dayStartTs = (day) => Date.parse(day + 'T00:00:00Z') - config.tzOffsetHours * 3600e3;
  const ddmm = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
  const userRow = (id) => q('SELECT id, nick, look, profile, share_office FROM users WHERE id = ?').get(id);
  const lookOf = (row) => JSON.parse(row.look || '{}');

  // ---------- Метрики ----------
  const seenToday = new Set();
  function markActive(uid) {
    const key = today() + ':' + uid;
    if (seenToday.has(key)) return;
    if (seenToday.size > 20000) seenToday.clear();
    seenToday.add(key);
    // Псевдоним вместо id: связь с аккаунтом не восстановить без секрета сервера
    const alias = crypto.createHmac('sha256', config.emailPepper).update('activity:' + uid).digest('hex').slice(0, 16);
    q('INSERT OR IGNORE INTO activity (day, uid) VALUES (?, ?)').run(today(), alias);
  }
  const stat = (key, n = 1) => q('INSERT INTO stats (day, key, n) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n').run(today(), key, n);
  const bump = (uid, key, n = 1) => q('INSERT INTO counters (user_id, key, n) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET n = n + excluded.n').run(uid, key, n);
  const counter = (uid, key) => (q('SELECT n FROM counters WHERE user_id = ? AND key = ?').get(uid, key) || { n: 0 }).n;

  // ---------- Серия и ачивки ----------
  function streakOf(uid) {
    const days = new Set(q("SELECT DISTINCT day FROM ledger WHERE user_id = ? AND reason = 'checkin' ORDER BY day DESC LIMIT 90").all(uid).map((r) => r.day));
    let streak = 0;
    let d = today();
    if (!days.has(d)) d = addDays(d, -1);
    for (let guard = 0; guard < 120; guard++, d = addDays(d, -1)) {
      if (!weekdayName(d)) continue;
      if (days.has(d)) streak++; else break;
    }
    return streak;
  }

  function checkAchievements(uid) {
    const u = userRow(uid);
    if (!u || !u.nick) return [];
    const have = new Set(q('SELECT ach FROM achievements WHERE user_id = ?').all(uid).map((r) => r.ach));
    if (have.size === ACH.length) return [];
    const c = {
      checkins: counter(uid, 'checkins'), replies: counter(uid, 'replies'), thanks_given: counter(uid, 'thanks_given'),
      thanks_got: counter(uid, 'thanks_got'), canteen: counter(uid, 'canteen'), signals: counter(uid, 'signals'), coffee: counter(uid, 'coffee'),
      gangs: q('SELECT COUNT(*) AS n FROM gang_members WHERE user_id = ?').get(uid).n,
      offices: q('SELECT COUNT(*) AS n FROM user_offices WHERE user_id = ?').get(uid).n,
      streak: streakOf(uid)
    };
    const got = [];
    for (const a of ACH) {
      if (have.has(a.id) || !a.test(c)) continue;
      q('INSERT OR IGNORE INTO achievements (user_id, ach, at) VALUES (?, ?, ?)').run(uid, a.id, U.now());
      addBeans(uid, 'ach', ACH_REWARD[a.tier]);
      pushEvent(null, uid, `${u.nick} получил ачивку «${a.name}»`);
      got.push(a.id);
    }
    return got;
  }

  function completeQuest(uid, quest) {
    const r = q('INSERT OR IGNORE INTO quests_done (user_id, day, quest) VALUES (?, ?, ?)').run(uid, today(), quest);
    if (!r.changes) return;
    addBeans(uid, 'quest', QUEST_REWARD);
    const n = q('SELECT COUNT(*) AS n FROM quests_done WHERE user_id = ? AND day = ?').get(uid, today()).n;
    if (n === QUESTS.length) addBeans(uid, 'quest_all', QUEST_ALL_BONUS);
  }

  function onEvent(type, uid, data = {}) {
    try {
      if (type === 'active') return markActive(uid);
      if (type === 'checkin') {
        bump(uid, 'checkins'); stat('checkins'); completeQuest(uid, 'checkin');
        q('INSERT OR IGNORE INTO user_offices (user_id, office_id) VALUES (?, ?)').run(uid, data.office);
      }
      if (type === 'canteen') { bump(uid, 'canteen'); stat('canteen'); }
      if (type === 'reply') { bump(uid, 'replies'); stat('replies'); completeQuest(uid, 'reply'); }
      if (type === 'call') stat('calls');
      if (type === 'text') stat('messages');
      if (type === 'signal_confirmed') { bump(uid, 'signals'); stat('signals_confirmed'); }
      if (type === 'signal') stat('signals');
      checkAchievements(uid);
    } catch (e) {
      console.error('[features]', type, e.message);
    }
  }

  // ---------- Неделя банды ----------
  function weekDays() {
    const out = [];
    let d = today();
    while (out.length < 5) {
      if (weekdayName(d)) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  function cellFor(prof, uid, day) {
    const vac = prof.vacations.find((v) => v.from <= day && day <= v.to);
    if (vac) return 'vacation';
    if (day === today()) {
      const p = presenceOf(prof, activeCheckin(uid), uid).where;
      if (p === 'office') return 'office';
      if (p === 'home' || p === 'sick' || p === 'vacation') return p;
      if (p === 'plan_office') return 'office';
    }
    if (prof.today && prof.today.kind === 'sick' && prof.today.day <= day && day <= (prof.today.to || prof.today.day)) return 'sick';
    const plan = prof.plan[weekdayName(day)];
    return plan === 'office' ? 'office' : plan === 'home' ? 'home' : 'unknown';
  }

  function gangWeek(gangId, meId) {
    const days = weekDays();
    const members = gangMembers(gangId).filter((m) => m.share_office || m.id === meId);
    const rows = members.map((m) => {
      const prof = readProfile(m.profile);
      return { id: m.id, nick: m.nick, me: m.id === meId, look: lookOf(m), cells: days.map((d) => cellFor(prof, m.id, d)) };
    });
    const cols = days.map((d, i) => ({
      day: d,
      label: `${DAY_NAMES[new Date(d + 'T00:00:00Z').getUTCDay()]} ${ddmm(d)}`,
      office: rows.filter((r) => r.cells[i] === 'office').length
    }));
    let best = null;
    cols.forEach((c) => { if (c.office >= 2 && (!best || c.office > best.office)) best = c; });
    return { days: cols, rows, best: best ? { label: best.label, office: best.office, total: rows.length, today: best.day === today() } : null, hidden: gangMembers(gangId).length - members.length };
  }

  // ---------- Дни рождения ----------
  function bdayInDays(bday) {
    if (!/^\d{2}\.\d{2}$/.test(bday || '')) return null;
    const t = today();
    const year = Number(t.slice(0, 4));
    for (const y of [year, year + 1]) {
      const d = `${y}-${bday.slice(3, 5)}-${bday.slice(0, 2)}`;
      if (isNaN(Date.parse(d))) return null;
      const diff = Math.round((Date.parse(d) - Date.parse(t)) / 864e5);
      if (diff >= 0) return diff;
    }
    return null;
  }

  function gangBirthdays(gangId, meId) {
    return gangMembers(gangId)
      .map((m) => ({ m, prof: readProfile(m.profile) }))
      .filter(({ prof }) => prof.showBday && prof.bday)
      .map(({ m, prof }) => ({ id: m.id, nick: m.nick, me: m.id === meId, look: lookOf(m), bday: prof.bday, inDays: bdayInDays(prof.bday) }))
      .filter((b) => b.inDays !== null && b.inDays <= 14)
      .map((b) => ({ ...b, gifted: b.inDays === 0 && !!q('SELECT 1 FROM gifts WHERE from_id = ? AND to_id = ? AND day = ?').get(meId, b.id, today()) }))
      .sort((a, b) => a.inDays - b.inDays);
  }

  // ---------- Спасибо ----------
  const thanksLeft = (uid) => THANKS_PER_DAY - q('SELECT COUNT(*) AS n FROM thanks WHERE from_id = ? AND day = ?').get(uid, today()).n;

  route('POST', '/api/thanks', async (req, body) => {
    const u = requireUser(req);
    const gangId = Number(body.gang);
    const toId = Number(body.to);
    if (!isMember(gangId, u.id) || !isMember(gangId, toId)) throw bad('Спасибо можно сказать только коллеге из своей банды.');
    if (toId === u.id) throw bad('Себе спасибо не говорят — только другим.');
    if (thanksLeft(u.id) <= 0) throw bad(`Не больше ${THANKS_PER_DAY} спасибо в день — так они ценнее.`);
    const text = U.cleanText(body.text, 80) || null;
    if (text) { const prob = U.moderationProblem(text); if (prob) throw bad(prob); }
    q('INSERT INTO thanks (gang_id, from_id, to_id, text, day, at) VALUES (?, ?, ?, ?, ?, ?)').run(gangId, u.id, toId, text, today(), U.now());
    const got = addBeans(toId, 'thanks');
    bump(u.id, 'thanks_given'); bump(toId, 'thanks_got'); stat('thanks');
    completeQuest(u.id, 'thanks');
    checkAchievements(u.id); checkAchievements(toId);
    fireAndForget(notify([toId], { title: 'Тебе спасибо!', body: `${u.nick}: ${text || 'спасибо за помощь'}${got ? ' · +1 зерно' : ''}`, url: `/#gang/${gangId}`, tag: `thanks-${u.id}` }));
    return { ok: true, left: thanksLeft(u.id) };
  });

  // Всё дополнительное по банде одним запросом: неделя, спасибо, дни рождения
  route('GET', '/api/gangs/:id/extra', async (req, body, query, params) => {
    const u = requireUser(req);
    const gangId = Number(params.id);
    if (!isMember(gangId, u.id)) throw bad('Ты не в этой банде.');
    const thanks = q(`SELECT t.*, f.nick AS from_nick, r.nick AS to_nick FROM thanks t
                      LEFT JOIN users f ON f.id = t.from_id JOIN users r ON r.id = t.to_id
                      WHERE t.gang_id = ? AND t.at > ? ORDER BY t.at DESC LIMIT 30`).all(gangId, U.now() - 7 * 864e5)
      .map((t) => ({ id: t.id, from: t.from_nick || 'удалённый аккаунт', to: t.to_nick, text: t.text, toMe: t.to_id === u.id, mine: t.from_id === u.id, when: t.day === today() ? 'сегодня' : ddmm(t.day) }));
    return { week: gangWeek(gangId, u.id), thanks, thanksLeft: thanksLeft(u.id), birthdays: gangBirthdays(gangId, u.id) };
  });

  // ---------- Подарок на день рождения ----------
  route('POST', '/api/gift', async (req, body) => {
    const u = requireUser(req);
    const toId = Number(body.to);
    const to = userRow(toId);
    if (!to || toId === u.id) throw bad('Некому дарить.');
    const shared = myGangs(u.id).some((g) => isMember(g.id, toId));
    if (!shared) throw bad('Подарить можно только коллеге из своей банды.');
    const prof = readProfile(to.profile);
    if (!prof.showBday || bdayInDays(prof.bday) !== 0) throw bad('Подарок можно отправить только в день рождения.');
    if (q('SELECT 1 FROM gifts WHERE from_id = ? AND to_id = ? AND day = ?').get(u.id, toId, today())) throw bad('Ты уже поздравил.');
    if (!spendBeans(u.id, GIFT_BEANS, 'gift')) throw bad(`Нужно ${GIFT_BEANS} зёрен.`);
    q('INSERT INTO gifts (from_id, to_id, day, at) VALUES (?, ?, ?, ?)').run(u.id, toId, today(), U.now());
    addBeans(toId, 'gift_got', GIFT_BEANS);
    stat('gifts');
    fireAndForget(notify([toId], { title: 'С днём рождения!', body: `${u.nick} дарит тебе ${GIFT_BEANS} зёрен`, url: '/', tag: `gift-${u.id}` }, { ignoreQuiet: true }));
    return { ok: true };
  });

  // ---------- Случайный кофе ----------
  function pairNow(force = false) {
    const week = mondayOf(today());
    if (!force && meta.get('coffee_week') === week) return 0;
    meta.set('coffee_week', week);
    q('DELETE FROM coffee_pairs WHERE week = ?').run(week);
    const users = q('SELECT id, nick, profile FROM users WHERE nick IS NOT NULL').all()
      .map((r) => ({ id: r.id, nick: r.nick, prof: readProfile(r.profile) }))
      .filter((r) => r.prof.coffee && r.prof.home);
    const lastWeek = addDays(week, -7);
    const lastPairs = new Set(q('SELECT a, b FROM coffee_pairs WHERE week = ?').all(lastWeek).map((p) => [p.a, p.b].sort().join(':')));
    const gangSets = new Map(users.map((x) => [x.id, new Set(myGangs(x.id).map((g) => g.id))]));
    const sharesGang = (a, b) => [...gangSets.get(a)].some((g) => gangSets.get(b).has(g));
    let made = 0;
    const byOffice = {};
    users.forEach((x) => { (byOffice[x.prof.home] = byOffice[x.prof.home] || []).push(x); });
    for (const [officeId, list] of Object.entries(byOffice)) {
      const pool = list.sort(() => Math.random() - 0.5);
      while (pool.length >= 2) {
        const a = pool.shift();
        let idx = pool.findIndex((b) => !sharesGang(a.id, b.id) && !lastPairs.has([a.id, b.id].sort().join(':')));
        if (idx === -1) idx = pool.findIndex((b) => !lastPairs.has([a.id, b.id].sort().join(':')));
        if (idx === -1) idx = 0;
        const b = pool.splice(idx, 1)[0];
        q('INSERT INTO coffee_pairs (week, office_id, a, b, at) VALUES (?, ?, ?, ?, ?)').run(week, officeId, a.id, b.id, U.now());
        made++;
        const office = officeById(officeId);
        fireAndForget(notify([a.id], { title: 'Случайный кофе', body: `На этой неделе: ты и ${b.nick}${office ? ' · ' + office.name : ''}. Договоритесь о времени в приложении.`, url: '/', tag: 'coffee' }));
        fireAndForget(notify([b.id], { title: 'Случайный кофе', body: `На этой неделе: ты и ${a.nick}${office ? ' · ' + office.name : ''}. Договоритесь о времени в приложении.`, url: '/', tag: 'coffee' }));
      }
    }
    stat('coffee_pairs', made);
    return made;
  }

  function myPair(uid) {
    const p = q('SELECT * FROM coffee_pairs WHERE week = ? AND (a = ? OR b = ?)').get(mondayOf(today()), uid, uid);
    if (!p) return null;
    const partnerId = p.a === uid ? p.b : p.a;
    const partner = userRow(partnerId);
    if (!partner) return null;
    const office = p.office_id ? officeById(p.office_id) : null;
    return {
      id: p.id, partner: { id: partner.id, nick: partner.nick, look: lookOf(partner) }, office: office ? office.name : null,
      ping: p.ping_by ? { mine: p.ping_by === uid, opt: p.ping_opt, reply: p.reply } : null,
      canReply: !!p.ping_by && p.ping_by !== uid && !p.reply,
      options: COFFEE_OPTS, replies: COFFEE_REPLIES
    };
  }

  route('POST', '/api/coffee/ping', async (req, body) => {
    const u = requireUser(req);
    const p = q('SELECT * FROM coffee_pairs WHERE week = ? AND (a = ? OR b = ?)').get(mondayOf(today()), u.id, u.id);
    if (!p) throw bad('На этой неделе у тебя нет пары для кофе.');
    if (!COFFEE_OPTS.includes(body.opt)) throw bad('Выбери время.');
    if (p.ping_by === u.id && p.ping_at > U.now() - 30 * 60e3 && !p.reply) throw bad('Ты уже предложил время — дождись ответа.');
    q('UPDATE coffee_pairs SET ping_by = ?, ping_opt = ?, ping_at = ?, reply = NULL, reply_at = NULL WHERE id = ?').run(u.id, body.opt, U.now(), p.id);
    const partnerId = p.a === u.id ? p.b : p.a;
    fireAndForget(notify([partnerId], { title: 'Случайный кофе', body: `${u.nick} предлагает: ${body.opt.toLowerCase()}`, url: '/', tag: 'coffee' }));
    return { ok: true };
  });

  route('POST', '/api/coffee/reply', async (req, body) => {
    const u = requireUser(req);
    const p = q('SELECT * FROM coffee_pairs WHERE week = ? AND (a = ? OR b = ?)').get(mondayOf(today()), u.id, u.id);
    if (!p || !p.ping_by || p.ping_by === u.id) throw bad('Пока нечего отвечать.');
    if (!COFFEE_REPLIES.includes(body.label)) throw bad('Неизвестный ответ.');
    if (p.reply) throw bad('Ты уже ответил.');
    q('UPDATE coffee_pairs SET reply = ?, reply_at = ? WHERE id = ?').run(body.label, U.now(), p.id);
    if (body.label === 'Иду') {
      [p.a, p.b].forEach((id) => { bump(id, 'coffee'); checkAchievements(id); });
      stat('coffee_agreed');
    }
    fireAndForget(notify([p.ping_by], { title: 'Случайный кофе', body: `${u.nick}: ${body.label}`, url: '/', tag: 'coffee' }));
    return { ok: true };
  });

  // ---------- Обед компанией ----------
  function lunchesFor(uid) {
    const ci = activeCheckin(uid);
    if (!ci) return { office: null, items: [], times: LUNCH_TIMES };
    const rows = q(`SELECT l.*, u.nick FROM lunches l JOIN users u ON u.id = l.user_id WHERE l.office_id = ? AND l.day = ? ORDER BY l.time`).all(ci.office_id, today());
    const items = rows.map((l) => {
      const joins = q('SELECT j.user_id, u.nick FROM lunch_joins j JOIN users u ON u.id = j.user_id WHERE j.lunch_id = ? ORDER BY j.at').all(l.id);
      return {
        id: l.id, time: l.time, place: l.place, nick: l.nick, mine: l.user_id === uid,
        joined: joins.some((j) => j.user_id === uid), count: joins.length, who: joins.slice(0, 4).map((j) => j.nick)
      };
    });
    return { office: ci.office_id, items, times: LUNCH_TIMES };
  }

  route('POST', '/api/lunch', async (req, body) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    if (!ci) throw bad('Сбор на обед можно открыть, когда ты отмечен в офисе.');
    if (!LUNCH_TIMES.includes(body.time)) throw bad('Выбери время.');
    const place = U.cleanText(body.place, 30) || null;
    if (place) { const prob = U.moderationProblem(place); if (prob) throw bad(prob); }
    q('DELETE FROM lunches WHERE user_id = ? AND day = ?').run(u.id, today());
    q('INSERT INTO lunches (office_id, user_id, time, place, day, at) VALUES (?, ?, ?, ?, ?, ?)').run(ci.office_id, u.id, body.time, place, today(), U.now());
    stat('lunches');
    return { ok: true };
  });

  route('POST', '/api/lunch/:id/join', async (req, body, query, params) => {
    const u = requireUser(req);
    const l = q('SELECT * FROM lunches WHERE id = ? AND day = ?').get(Number(params.id), today());
    const ci = activeCheckin(u.id);
    if (!l || !ci || ci.office_id !== l.office_id) throw bad('Сбор не найден или он в другом офисе.');
    if (l.user_id === u.id) throw bad('Это твой сбор.');
    const r = q('INSERT OR IGNORE INTO lunch_joins (lunch_id, user_id, at) VALUES (?, ?, ?)').run(l.id, u.id, U.now());
    if (r.changes) fireAndForget(notify([l.user_id], { title: 'Обед компанией', body: `${u.nick} идёт с тобой в ${l.time}`, url: '/', tag: `lunch-${l.id}` }));
    return { ok: true };
  });

  route('POST', '/api/lunch/:id/leave', async (req, body, query, params) => {
    const u = requireUser(req);
    q('DELETE FROM lunch_joins WHERE lunch_id = ? AND user_id = ?').run(Number(params.id), u.id);
    return { ok: true };
  });

  route('POST', '/api/lunch/:id/cancel', async (req, body, query, params) => {
    const u = requireUser(req);
    const l = q('SELECT * FROM lunches WHERE id = ?').get(Number(params.id));
    if (!l || l.user_id !== u.id) throw bad('Можно отменить только свой сбор.');
    const joiners = q('SELECT user_id FROM lunch_joins WHERE lunch_id = ?').all(l.id).map((r) => r.user_id);
    q('DELETE FROM lunches WHERE id = ?').run(l.id);
    fireAndForget(notify(joiners, { title: 'Обед компанией', body: `Сбор на ${l.time} отменён`, url: '/', tag: `lunch-${l.id}` }));
    return { ok: true };
  });

  // ---------- Сводка для главного экрана и профиля ----------
  route('GET', '/api/features', async (req, body, query) => {
    const u = requireUser(req);
    const done = new Set(q('SELECT quest FROM quests_done WHERE user_id = ? AND day = ?').all(u.id, today()).map((r) => r.quest));
    const owned = Object.fromEntries(q('SELECT ach, at FROM achievements WHERE user_id = ?').all(u.id).map((r) => [r.ach, r.at]));
    const gangs = myGangs(u.id);
    const gangId = Number(query.gang) && gangs.some((g) => g.id === Number(query.gang)) ? Number(query.gang) : (gangs[0] || {}).id;
    const prof = readProfile(u.profile ? (typeof u.profile === 'string' ? u.profile : JSON.stringify(u.profile)) : '{}');
    const bdaysToday = [];
    const seen = new Set();
    for (const g of gangs) {
      for (const b of gangBirthdays(g.id, u.id)) {
        if (b.inDays === 0 && !seen.has(b.id)) { seen.add(b.id); bdaysToday.push(b); }
      }
    }
    return {
      quests: { items: QUESTS.map((x) => ({ ...x, done: done.has(x.id) })), reward: QUEST_REWARD, bonus: QUEST_ALL_BONUS },
      achievements: ACH.map((a) => ({ id: a.id, tier: a.tier, name: a.name, desc: a.desc, reward: ACH_REWARD[a.tier], got: !!owned[a.id], at: owned[a.id] || null })),
      weekHint: gangId ? gangWeek(gangId, u.id).best : null,
      coffee: { optIn: !!prof.coffee, hasHome: !!prof.home, pair: myPair(u.id) },
      lunches: lunchesFor(u.id),
      birthdaysToday: bdaysToday,
      giftBeans: GIFT_BEANS
    };
  });

  // ---------- Админка: метрики ----------
  route('GET', '/api/admin/metrics', async (req) => {
    requireAdmin(req);
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(addDays(today(), -i));
    const rows = days.map((d) => {
      const s = Object.fromEntries(q('SELECT key, n FROM stats WHERE day = ?').all(d).map((r) => [r.key, r.n]));
      return { day: ddmm(d), active: q('SELECT COUNT(*) AS n FROM activity WHERE day = ?').get(d).n, checkins: s.checkins || 0, calls: s.calls || 0, replies: s.replies || 0, thanks: s.thanks || 0, lunches: s.lunches || 0, messages: s.messages || 0 };
    });
    const w0 = addDays(today(), -6);
    const w1 = addDays(today(), -13);
    const wau = q('SELECT COUNT(DISTINCT uid) AS n FROM activity WHERE day >= ?').get(w0).n;
    const prev = q('SELECT COUNT(DISTINCT uid) AS n FROM activity WHERE day >= ? AND day < ?').get(w1, w0).n;
    const kept = q(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT uid FROM activity WHERE day >= ? AND day < ?) p
                    WHERE p.uid IN (SELECT uid FROM activity WHERE day >= ?)`).get(w1, w0, w0).n;
    return { rows, wau, prevWau: prev, retention: prev ? Math.round((kept / prev) * 100) : null, coffeeWeek: q('SELECT COUNT(*) AS n FROM coffee_pairs WHERE week = ?').get(mondayOf(today())).n };
  });

  route('POST', '/api/admin/coffee-now', async (req) => {
    requireAdmin(req);
    return { ok: true, pairs: pairNow(true) };
  });

  // ---------- Фоновые задачи (раз в 10 минут) ----------
  function tick() {
    const now = U.msk();
    const day = now.day;
    const dow = new Date(day + 'T00:00:00Z').getUTCDay();
    try {
      // Случайный кофе: понедельник с 10:00
      if (dow === 1 && now.hour >= 10) pairNow(false);
      // Дни рождения: пуш банде в 10:00
      if (now.hour >= 10 && now.hour < 19 && meta.get('bday_day') !== day) {
        meta.set('bday_day', day);
        for (const r of q('SELECT id, nick, profile FROM users WHERE nick IS NOT NULL').all()) {
          const prof = readProfile(r.profile);
          if (!prof.showBday || bdayInDays(prof.bday) !== 0) continue;
          const mates = new Set();
          myGangs(r.id).forEach((g) => gangMembers(g.id).forEach((m) => { if (m.id !== r.id) mates.add(m.id); }));
          fireAndForget(notify([...mates], { title: 'День рождения в банде', body: `Сегодня день рождения у ${r.nick}! Поздравь и подари ${GIFT_BEANS} зёрен.`, url: '/', tag: `bday-${r.id}` }));
        }
      }
      // Сводка недели: пятница с 16:00
      if (dow === 5 && now.hour >= 16 && now.hour < 19 && meta.get('digest_week') !== mondayOf(day)) {
        meta.set('digest_week', mondayOf(day));
        const since = dayStartTs(mondayOf(day));
        for (const r of q('SELECT DISTINCT user_id AS id FROM push_subs').all()) {
          const u = userRow(r.id);
          if (!u || !u.nick) continue;
          const t = q('SELECT COUNT(*) AS n FROM thanks WHERE to_id = ? AND at >= ?').get(u.id, since).n;
          const rep = q("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND reason = 'reply' AND at >= ?").get(u.id, since).n;
          const ach = q('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND at >= ?').get(u.id, since).n;
          const st = streakOf(u.id);
          const parts = [`спасибо: ${t}`, `ответов на зовы: ${rep}`, `серия: ${st} дн.`];
          if (ach) parts.push(`новых ачивок: ${ach}`);
          fireAndForget(notify([u.id], { title: 'Неделя в Этаже', body: parts.join(' · '), url: '/', tag: 'digest' }));
        }
      }
    } catch (e) {
      console.error('[tick]', e.message);
    }
  }

  function cleanup() {
    const t = U.now();
    const d = today();
    q('DELETE FROM activity WHERE day < ?').run(addDays(d, -35));
    q('DELETE FROM stats WHERE day < ?').run(addDays(d, -120));
    q('DELETE FROM thanks WHERE at < ?').run(t - 30 * 864e5);
    q('DELETE FROM lunches WHERE day < ?').run(d);
    q('DELETE FROM coffee_pairs WHERE week < ?').run(addDays(d, -56));
    q('DELETE FROM quests_done WHERE day < ?').run(addDays(d, -7));
    q('DELETE FROM gifts WHERE day < ?').run(addDays(d, -400));
    tick();
  }

  return { onEvent, cleanup, tick, pairNow };
}

module.exports = { register, ACH, QUESTS };
