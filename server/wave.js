// «Волна» как на стадионе: один из банды кидает клич, остальным приходит смешной пуш,
// и у трибуны 10 минут, чтобы «встать» — нажать кнопку. Встали больше половины — волна обошла стадион.
// Запустить можно раз в календарную неделю (с понедельника) и одну волну на банду за раз.
// За то, что встал, — +2 зерна (раз в день). Пуши уважают тихие часы и отпуск.

const WINDOW_MIN = 10;
const MIN_GANG = 3;
const SHOW_RESULT_H = 24;

// Пуш-тексты: {nick}, {gang}, {v} — «запустил/запустила», {st} — «стоит/стоит»
const CALLS = [
  ['Волна в «{gang}»', '{nick} {v} волну! Встань и подними руки — у трибуны 10 минут'],
  ['Сектор «{gang}», подъём!', 'Волна уже на подходе. Не сиди — она без тебя не пройдёт'],
  ['Ла-ола!', '{nick} уже стоит с поднятыми руками. Твоя очередь'],
  ['Внимание, трибуны', 'Это волна. Кто не встанет — тот её и сломал'],
  ['Это не учения', 'Повторяем: это волна. Встать, руки вверх, нажать кнопку'],
  ['Разминка от {nick}', 'Встань, потянись, нажми кнопку. Спина скажет спасибо, банда — тоже'],
  ['Трибуна «{gang}» встаёт', 'А ты пока сидишь. Неловко получается'],
  ['Мексиканская волна', 'Офисная версия: без стадиона, но с душой. {nick} уже начал'],
  ['Гол! Ну почти', '{nick} {v} волну в «{gang}». Поддержи, пока не стихло']
];

function register(ctx) {
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, publicLook, onEvent } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS waves (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    week TEXT NOT NULL, at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
    size INTEGER NOT NULL, full_noted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS waves_gang ON waves(gang_id, at);
  CREATE TABLE IF NOT EXISTS wave_joins (
    wave_id INTEGER NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, PRIMARY KEY (wave_id, user_id)
  );
  `);

  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const mondayOf = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const week = () => mondayOf(U.msk().day);
  const activeWave = (gid) => q('SELECT * FROM waves WHERE gang_id = ? AND ends_at > ? ORDER BY at DESC LIMIT 1').get(gid, U.now());
  const lastWave = (gid) => q('SELECT * FROM waves WHERE gang_id = ? AND ends_at <= ? AND ends_at > ? ORDER BY at DESC LIMIT 1').get(gid, U.now(), U.now() - SHOW_RESULT_H * 3600e3);
  const launchedThisWeek = (uid) => !!q('SELECT 1 FROM waves WHERE by_id = ? AND week = ?').get(uid, week());
  const joinsOf = (wid) => q('SELECT j.user_id, j.at, u.nick, u.look FROM wave_joins j JOIN users u ON u.id = j.user_id WHERE j.wave_id = ? ORDER BY j.at').all(wid);

  const gangOr404 = (req, id) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(id));
    if (!g || !isMember(g.id, u.id)) throw new HttpError(404, 'Банда не найдена.');
    return { u, g };
  };

  // Итог волны: сколько встало и как это назвать
  function result(w) {
    const n = joinsOf(w.id).length, size = Math.max(w.size, n);
    const last = q('SELECT MAX(at) AS t FROM wave_joins WHERE wave_id = ?').get(w.id).t || w.at;
    const mins = Math.max(1, Math.round((last - w.at) / 60e3));
    const kind = n >= size ? 'full' : n * 2 >= size ? 'ok' : 'fail';
    const text = kind === 'full' ? `Вся трибуна встала! ${n} из ${size} — легендарно`
      : kind === 'ok' ? `Волна обошла стадион: ${n} из ${size} за ${mins} мин`
      : `Волна захлебнулась на ${n}-м ряду. Через неделю — реванш`;
    return { kind, joined: n, size, mins, text };
  }

  function view(g, uid) {
    const members = gangMembers(g.id);
    const w = activeWave(g.id);
    const can = members.length >= MIN_GANG && !launchedThisWeek(uid) && !w;
    const why = members.length < MIN_GANG ? `Волну можно запустить, когда в банде ${MIN_GANG} человека.`
      : w ? '' : launchedThisWeek(uid) ? 'Твоя волна на этой неделе уже была. Следующая — с понедельника.' : '';
    const out = { canLaunch: can, why, windowMin: WINDOW_MIN, active: null, last: null };
    if (w) {
      const joins = joinsOf(w.id);
      const order = new Map(joins.map((j, i) => [j.user_id, i]));
      const by = q('SELECT id, nick, look FROM users WHERE id = ?').get(w.by_id) || { id: 0, nick: 'кто-то', look: '{}' };
      out.active = {
        id: w.id, by: { id: by.id, nick: by.nick, fem: U.fem(by.look) }, endsAt: w.ends_at, now: U.now(),
        joined: joins.length, size: Math.max(w.size, joins.length), mine: order.has(uid),
        fans: members.map((m) => ({ id: m.id, nick: m.nick, look: publicLook(m), up: order.has(m.id), i: order.has(m.id) ? order.get(m.id) : null, me: m.id === uid }))
          .sort((a, b) => (a.up === b.up ? (a.i ?? 0) - (b.i ?? 0) : a.up ? -1 : 1))
      };
    } else {
      const l = lastWave(g.id);
      if (l) {
        const by = q('SELECT nick FROM users WHERE id = ?').get(l.by_id);
        out.last = { ...result(l), by: by ? by.nick : 'кто-то', mine: !!q('SELECT 1 FROM wave_joins WHERE wave_id = ? AND user_id = ?').get(l.id, uid) };
      }
    }
    return out;
  }

  route('GET', '/api/gangs/:id/wave', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params.id);
    return view(g, u.id);
  });

  route('POST', '/api/gangs/:id/wave', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params.id);
    const members = gangMembers(g.id);
    if (members.length < MIN_GANG) throw bad(`Для волны нужна трибуна: хотя бы ${MIN_GANG} человека в банде.`);
    if (activeWave(g.id)) throw bad('Волна уже идёт — вставай!');
    if (launchedThisWeek(u.id)) throw bad('Твоя волна на этой неделе уже была. Следующая — с понедельника.');
    const now = U.now();
    const id = Number(q('INSERT INTO waves (gang_id, by_id, week, at, ends_at, size) VALUES (?, ?, ?, ?, ?, ?)').run(g.id, u.id, week(), now, now + WINDOW_MIN * 60e3, members.length).lastInsertRowid);
    q('INSERT INTO wave_joins (wave_id, user_id, at) VALUES (?, ?, ?)').run(id, u.id, now);
    const look = u.look || {};
    const [t, b] = CALLS[Math.floor(Math.random() * CALLS.length)];
    const fill = (s) => s.replace(/\{nick\}/g, u.nick).replace(/\{gang\}/g, g.name).replace(/\{v\}/g, U.g(look, 'запустил', 'запустила')).replace('уже начал', U.g(look, 'уже начал', 'уже начала'));
    const ids = members.map((m) => m.id).filter((x) => x !== u.id);
    fireAndForget(notify(ids, { title: fill(t), body: fill(b), url: `/#wave/${g.id}`, tag: `wave-${g.id}` }));
    if (onEvent) onEvent('wave_launch', u.id, { gang: g.id });
    return view(g, u.id);
  });

  route('POST', '/api/waves/:id/join', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = q('SELECT * FROM waves WHERE id = ?').get(Number(params.id));
    if (!w || !isMember(w.gang_id, u.id)) throw new HttpError(404, 'Волна не найдена.');
    if (w.ends_at <= U.now()) throw bad('Волна уже прошла. В следующий раз — быстрее!');
    const r = q('INSERT OR IGNORE INTO wave_joins (wave_id, user_id, at) VALUES (?, ?, ?)').run(w.id, u.id, U.now());
    let beans = 0;
    if (r.changes) {
      beans = addBeans ? addBeans(u.id, 'wave') : 0;
      if (onEvent) onEvent('wave_join', u.id, { gang: w.gang_id });
      const n = joinsOf(w.id).length;
      // Встала вся банда — дирижёру ачивка и пуш (один раз)
      if (n >= w.size && !w.full_noted) {
        q('UPDATE waves SET full_noted = 1 WHERE id = ?').run(w.id);
        if (w.by_id) {
          if (onEvent) onEvent('wave_full', w.by_id, { gang: w.gang_id });
          if (w.by_id !== u.id) fireAndForget(notify([w.by_id], { title: 'Вся трибуна встала!', body: `Твоя волна прошла по всей банде: ${n} из ${w.size}. Дирижёр!`, url: `/#wave/${w.gang_id}`, tag: `wave-${w.gang_id}` }));
        }
      }
    }
    const g = q('SELECT * FROM gangs WHERE id = ?').get(w.gang_id);
    return { ...view(g, u.id), beans };
  });

  // Для сводки «Этажа»: идёт волна, а ты ещё сидишь
  function pending(uid, gangs) {
    const out = [];
    for (const g of gangs) {
      const w = activeWave(g.id);
      if (w && !q('SELECT 1 FROM wave_joins WHERE wave_id = ? AND user_id = ?').get(w.id, uid)) out.push({ gang: g, wave: w });
    }
    return out;
  }

  function cleanup() { q('DELETE FROM waves WHERE at < ?').run(U.now() - 60 * 864e5); }

  return { pending, cleanup };
}

module.exports = { register, CALLS, WINDOW_MIN };
