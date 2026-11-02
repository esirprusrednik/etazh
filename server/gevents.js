// События банды: встречи, сабантуи к праздникам, дни рождения и другие важные дела.
// Создать может любой член банды. Остальные отвечают «Иду / Может быть / Не смогу».
// Отменить может автор или владелец банды. Утром в день события — напоминание тем, кто идёт или думает.
// Прошедшие события хранятся ещё 7 дней (чтобы было видно «как сходили»), потом удаляются.

const { OFF } = require('./holidays');

const KINDS = {
  meet: { emoji: '🤝', name: 'Встреча' },
  party: { emoji: '🎉', name: 'Сабантуй' },
  bday: { emoji: '🎂', name: 'День рождения' },
  holiday: { emoji: '🎆', name: 'Праздник' },
  lunch: { emoji: '🍕', name: 'Обед или ужин' },
  sport: { emoji: '⚽', name: 'Спорт' },
  work: { emoji: '📌', name: 'Важное по работе' },
  other: { emoji: '✨', name: 'Другое' }
};
const RSVP = ['yes', 'maybe', 'no'];
const MAX_UPCOMING = 20;      // будущих событий в банде одновременно
const PER_DAY = 10;           // создать событий в день одному человеку
const KEEP_DAYS = 7;
const AHEAD_DAYS = 366;
// Профессиональные и просто любимые даты, которых нет среди выходных
const EXTRA_DATES = { '05-07': 'День радио — праздник связистов', '09-13': 'День программиста', '12-25': 'Католическое Рождество', '04-01': 'День смеха' };

function register(ctx) {
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, rateLimit, readProfile, onEvent } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS gang_events (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL, title TEXT NOT NULL, day TEXT NOT NULL, time TEXT, place TEXT, note TEXT,
    at INTEGER NOT NULL, reminded INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS gang_events_gang ON gang_events(gang_id, day);
  CREATE TABLE IF NOT EXISTS gang_event_rsvp (
    event_id INTEGER NOT NULL REFERENCES gang_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    answer TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );
  `);

  const today = () => U.msk().day;
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const daysTo = (day) => Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 864e5);
  const lookOf = (r) => { try { return JSON.parse(r.look || '{}'); } catch { return {}; } };

  function clean(s, max) {
    const t = U.cleanText(s || '', max);
    const prob = t && U.moderationProblem(t);
    if (prob) throw bad(prob);
    return t;
  }

  function view(e, uid, ownerId) {
    const rs = q('SELECT r.user_id, r.answer, u.nick, u.look FROM gang_event_rsvp r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? ORDER BY r.at').all(e.id);
    const author = e.user_id ? q('SELECT nick FROM users WHERE id = ?').get(e.user_id) : null;
    const k = KINDS[e.kind] || KINDS.other;
    const mine = rs.find((r) => r.user_id === uid);
    return {
      id: e.id, kind: e.kind, emoji: k.emoji, kindName: k.name, title: e.title, day: e.day, time: e.time, place: e.place || '', note: e.note || '',
      inDays: daysTo(e.day), past: e.day < today(),
      author: author ? author.nick : 'удалённый аккаунт', mine: e.user_id === uid, canCancel: e.user_id === uid || ownerId === uid,
      my: mine ? mine.answer : null,
      yes: rs.filter((r) => r.answer === 'yes').map((r) => ({ id: r.user_id, nick: r.nick, look: lookOf(r) })),
      maybe: rs.filter((r) => r.answer === 'maybe').map((r) => r.nick),
      no: rs.filter((r) => r.answer === 'no').length
    };
  }

  const gangOr404 = (gid, uid) => {
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(gid));
    if (!g || !isMember(g.id, uid)) throw new HttpError(404, 'Банда не найдена.');
    return g;
  };

  // Подсказки: дни рождения банды и праздники в ближайшие три недели, по которым ещё нет события
  function suggestions(g) {
    const t = today();
    const out = [];
    const taken = new Set(q('SELECT day FROM gang_events WHERE gang_id = ? AND day >= ?').all(g.id, t).map((r) => r.day));
    for (const m of gangMembers(g.id)) {
      const p = readProfile(m.profile);
      if (!p.showBday || !/^\d{2}\.\d{2}$/.test(p.bday || '')) continue;
      for (const y of [Number(t.slice(0, 4)), Number(t.slice(0, 4)) + 1]) {
        const day = `${y}-${p.bday.slice(3, 5)}-${p.bday.slice(0, 2)}`;
        const n = daysTo(day);
        if (n >= 0 && n <= 21) { if (!taken.has(day)) out.push({ kind: 'bday', day, title: `ДР: ${m.nick}`, hint: `${m.nick} — ${n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`}` }); break; }
      }
    }
    const seen = new Set();
    for (let i = 0; i <= 21; i++) {
      const day = addDays(t, i);
      const name = OFF[day] || EXTRA_DATES[day.slice(5)];
      if (!name || /^перенос/i.test(name)) continue;
      const short = name.replace(/\s*\(.*\)$/, '');
      if (seen.has(short)) continue;
      seen.add(short);
      // Сабантуй — в последний рабочий день перед праздником (если праздник выпал на выходной)
      let party = day;
      for (let k = 1; k <= 7; k++) {
        const d = addDays(day, -k);
        if (d < t) break;
        const dow = new Date(d + 'T00:00:00Z').getUTCDay();
        if (dow >= 1 && dow <= 5 && !OFF[d]) { party = d; break; }
      }
      if (taken.has(party)) continue;
      out.push({ kind: OFF[day] ? 'holiday' : 'party', day: party, title: `Сабантуй: ${short}`, hint: `${short} — ${day.slice(8)}.${day.slice(5, 7)}` });
    }
    return out.slice(0, 6);
  }

  route('GET', '/api/gangs/:id/gevents', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    const rows = q('SELECT * FROM gang_events WHERE gang_id = ? AND day >= ? ORDER BY day ASC, COALESCE(time, \'99:99\') ASC').all(g.id, addDays(today(), -KEEP_DAYS));
    const items = rows.map((e) => view(e, u.id, g.owner_id));
    return {
      upcoming: items.filter((e) => !e.past), past: items.filter((e) => e.past).reverse().slice(0, 3),
      kinds: Object.entries(KINDS).map(([id, k]) => ({ id, ...k })), suggestions: suggestions(g)
    };
  });

  route('POST', '/api/gangs/:id/gevents', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    rateLimit('gevent:' + u.id, PER_DAY, 24 * 3600e3);
    const kind = KINDS[body.kind] ? body.kind : 'other';
    const title = clean(body.title, 60);
    if (title.length < 3) throw bad('Как назовём событие?');
    const day = String(body.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(Date.parse(day))) throw bad('Выбери дату.');
    if (day < today()) throw bad('Эта дата уже прошла.');
    if (daysTo(day) > AHEAD_DAYS) throw bad('Не дальше чем на год вперёд.');
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time || '') ? body.time : null;
    const place = clean(body.place, 60) || null;
    const note = clean(body.note, 300) || null;
    if (q('SELECT COUNT(*) AS n FROM gang_events WHERE gang_id = ? AND day >= ?').get(g.id, today()).n >= MAX_UPCOMING) throw bad(`В банде уже ${MAX_UPCOMING} будущих событий — хватит планов, пора отдыхать.`);
    const t = U.now();
    const id = Number(q('INSERT INTO gang_events (gang_id, user_id, kind, title, day, time, place, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(g.id, u.id, kind, title, day, time, place, note, t).lastInsertRowid);
    q('INSERT INTO gang_event_rsvp (event_id, user_id, answer, at) VALUES (?, ?, ?, ?)').run(id, u.id, 'yes', t);
    const k = KINDS[kind];
    const when = `${day.slice(8)}.${day.slice(5, 7)}${time ? ' в ' + time : ''}`;
    q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(g.id, u.id, 'text', `${k.emoji} Событие: «${title}» — ${when}. Отметься в «Событиях» выше`, t);
    const others = gangMembers(g.id).filter((m) => m.id !== u.id).map((m) => m.id);
    fireAndForget(notify(others, { title: `${k.emoji} ${g.name}: ${title}`, body: `${when}${place ? ' · ' + place : ''} — ${u.nick} зовёт`, url: `/#gang/${g.id}`, tag: `gevent-${id}` }));
    if (onEvent) onEvent('gang_event', u.id);
    return { id, event: view(q('SELECT * FROM gang_events WHERE id = ?').get(id), u.id, g.owner_id) };
  });

  const eventOr404 = (id, uid) => {
    const e = q('SELECT * FROM gang_events WHERE id = ?').get(Number(id));
    if (!e || !isMember(e.gang_id, uid)) throw new HttpError(404, 'Событие не найдено.');
    return e;
  };

  route('POST', '/api/gevents/:id/rsvp', async (req, body, query, params) => {
    const u = requireUser(req);
    const e = eventOr404(params.id, u.id);
    if (e.day < today()) throw bad('Событие уже прошло.');
    if (!RSVP.includes(body.answer)) throw bad('Иду, может быть или не смогу?');
    const was = q('SELECT answer FROM gang_event_rsvp WHERE event_id = ? AND user_id = ?').get(e.id, u.id);
    if (was && was.answer === body.answer) q('DELETE FROM gang_event_rsvp WHERE event_id = ? AND user_id = ?').run(e.id, u.id);
    else q('INSERT OR REPLACE INTO gang_event_rsvp (event_id, user_id, answer, at) VALUES (?, ?, ?, ?)').run(e.id, u.id, body.answer, U.now());
    // Автору — пуш, когда кто-то идёт (не чаще одного на событие в час, тег перезаписывает)
    if (body.answer === 'yes' && e.user_id && e.user_id !== u.id && !(was && was.answer === 'yes')) {
      fireAndForget(notify([e.user_id], { title: e.title, body: `${u.nick} ${U.g(u.look, 'идёт', 'идёт')}`, url: `/#gang/${e.gang_id}`, tag: `gevent-yes-${e.id}` }));
    }
    const g = q('SELECT owner_id FROM gangs WHERE id = ?').get(e.gang_id);
    return { event: view(e, u.id, g ? g.owner_id : null) };
  });

  route('POST', '/api/gevents/:id/cancel', async (req, body, query, params) => {
    const u = requireUser(req);
    const e = eventOr404(params.id, u.id);
    const g = q('SELECT * FROM gangs WHERE id = ?').get(e.gang_id);
    if (e.user_id !== u.id && (!g || g.owner_id !== u.id)) throw bad('Отменить может автор события или владелец банды.');
    const going = q("SELECT user_id FROM gang_event_rsvp WHERE event_id = ? AND answer IN ('yes', 'maybe') AND user_id != ?").all(e.id, u.id).map((r) => r.user_id);
    q('DELETE FROM gang_events WHERE id = ?').run(e.id);
    if (e.day >= today()) {
      q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(e.gang_id, u.id, 'text', `Отменено: «${e.title}» (${e.day.slice(8)}.${e.day.slice(5, 7)})`, U.now());
      fireAndForget(notify(going, { title: `Отменено: ${e.title}`, body: `${u.nick} ${U.g(u.look, 'отменил', 'отменила')} событие`, url: `/#gang/${e.gang_id}`, tag: `gevent-${e.id}` }));
    }
    return { ok: true };
  });

  // Утреннее напоминание в день события — тем, кто идёт или думает
  function remind() {
    const m = U.msk();
    if (m.hour < 9) return;
    for (const e of q('SELECT e.*, g.name AS gname FROM gang_events e JOIN gangs g ON g.id = e.gang_id WHERE e.day = ? AND e.reminded = 0').all(m.day)) {
      q('UPDATE gang_events SET reminded = 1 WHERE id = ?').run(e.id);
      const ids = q("SELECT user_id FROM gang_event_rsvp WHERE event_id = ? AND answer IN ('yes', 'maybe')").all(e.id).map((r) => r.user_id);
      const k = KINDS[e.kind] || KINDS.other;
      if (ids.length) fireAndForget(notify(ids, { title: `${k.emoji} Сегодня: ${e.title}`, body: `${e.gname}${e.time ? ' · ' + e.time : ''}${e.place ? ' · ' + e.place : ''}`, url: `/#gang/${e.gang_id}`, tag: `gevent-${e.id}` }));
    }
  }
  setInterval(() => { try { remind(); } catch (err) { console.error('gevents', err); } }, 5 * 60e3).unref();

  function cleanup() {
    q('DELETE FROM gang_events WHERE day < ?').run(addDays(today(), -KEEP_DAYS));
  }
  // Ближайшее событие — для строки банды в чатах
  const next = (gid) => q('SELECT title, day, time, kind FROM gang_events WHERE gang_id = ? AND day >= ? ORDER BY day, COALESCE(time, \'99:99\') LIMIT 1').get(gid, today()) || null;

  return { cleanup, remind, next, KINDS };
}

module.exports = { register, KINDS };
