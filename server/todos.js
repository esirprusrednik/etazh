// «Дела дня»: короткая напоминалка про жизнь в офисе — позвать на кофе, вернуть зонт, поздравить.
// Не больше пяти дел на день. Срок — «сегодня», «завтра» или «в следующий офисный день» по плану недели.
// Время необязательно: если указано — придёт пуш. Всё сделано — похвала, +2 зерна и серия «дней без хвостов».
// Не сделано — вечером добродушный подкол. Тексты шифруются в базе, видит только автор, через 14 дней удаляются.

const MAX_PER_DAY = 5; // было 3 — оказалось тесно: «позвать», «вернуть», «поздравить» и пара рабочих мелочей
const TEXT_MAX = 80;
const KEEP_DAYS = 14;
const EVENING_FROM = 18, EVENING_TO = 18.5;

const PRAISE = ['Чистый день. Ни одного хвоста', 'Все дела закрыты — кофе с чистой совестью', 'Сегодня ты продуктивнее кофемашины', 'Минус дела, плюс уважение', 'Вот это план — и вот это выполнение'];
const ROAST = [
  (n, w) => `${n} ${w} переехали на завтра. Они не обиделись, но запомнили`,
  (n, w) => `Хвосты дня: ${n}. Завтра — шанс реабилитироваться`,
  (n, w) => `${n} ${w} ждали тебя весь день. Может, завтра повезёт`,
  (n, w) => `${n} ${w} висят. Перенеси или удали — честность тоже продуктивность`
];

function register(ctx) {
  const { db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, readProfile, features, addBeans, onEvent, myGangs, gangMembers, publicLook } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL, due TEXT NOT NULL, time TEXT, person_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL, done_at INTEGER, done_day TEXT, pushed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS todos_user ON todos(user_id, due);
  CREATE TABLE IF NOT EXISTS todo_meta (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_clean TEXT, streak INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0, evening TEXT
  );
  `);

  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const today = () => U.msk().day;
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  const meta = (uid) => q('SELECT * FROM todo_meta WHERE user_id = ?').get(uid) || { last_clean: null, streak: 0, best: 0, evening: null };
  const saveMeta = (uid, m) => q(`INSERT INTO todo_meta (user_id, last_clean, streak, best, evening) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_clean = excluded.last_clean, streak = excluded.streak, best = excluded.best, evening = excluded.evening`).run(uid, m.last_clean, m.streak, m.best, m.evening);

  // Следующий офисный день по плану недели (после сегодняшнего), в пределах двух недель
  function nextOfficeDay(uid, prof) {
    if (!features || !features.cellFor) return null;
    for (let i = 1; i <= 14; i++) { const d = addDays(today(), i); if (features.cellFor(prof, uid, d) === 'office') return d; }
    return null;
  }
  function dueFor(when, u) {
    const t = today();
    if (when === 'today') return t;
    if (when === 'tomorrow') return addDays(t, 1);
    if (when === 'office') {
      const d = nextOfficeDay(u.id, u.profile);
      if (!d) throw bad('В плане недели нет офисных дней. Заполни план в профиле или выбери «Завтра».');
      return d;
    }
    throw bad('Когда напомнить?');
  }
  // Сколько дел висит на дне: на сегодня считаются и вчерашние хвосты
  const countOn = (uid, day) => day === today()
    ? q('SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND ((due = ?) OR (due < ? AND done_at IS NULL))').get(uid, day, day).n
    : q('SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND due = ?').get(uid, day).n;

  const item = (r) => {
    const p = r.person_id ? q('SELECT id, nick, look FROM users WHERE id = ?').get(r.person_id) : null;
    return { id: r.id, text: U.unseal(r.text), due: r.due, time: r.time, done: !!r.done_at, tail: !r.done_at && r.due < today() ? r.due : null,
      person: p ? { id: p.id, nick: p.nick, look: publicLook(p) } : null };
  };

  function view(u) {
    const t = today();
    const rows = q('SELECT * FROM todos WHERE user_id = ? AND (due <= ? AND (done_at IS NULL OR done_day = ?) OR due > ?) ORDER BY due, COALESCE(time, \'99\'), id').all(u.id, t, t, t);
    const todayItems = rows.filter((r) => r.due <= t).map(item);
    const later = rows.filter((r) => r.due > t).map(item);
    const m = meta(u.id);
    // Серия жива, если последний чистый день был не раньше трёх дней назад (выходные не ломают)
    const streak = m.last_clean && m.last_clean >= addDays(t, -3) ? m.streak : 0;
    const office = nextOfficeDay(u.id, u.profile);
    // Свои — чтобы привязать дело к человеку («позвать Лёшу на кофе»)
    const ppl = new Map();
    for (const g of myGangs(u.id)) for (const mm of gangMembers(g.id)) if (mm.id !== u.id && ppl.size < 12) ppl.set(mm.id, { id: mm.id, nick: mm.nick, look: publicLook(mm) });
    return { today: todayItems, later, max: MAX_PER_DAY, left: Math.max(0, MAX_PER_DAY - countOn(u.id, t)), streak, best: m.best, cleanToday: m.last_clean === t, officeDay: office, tomorrow: addDays(t, 1), people: [...ppl.values()] };
  }

  route('GET', '/api/todos', async (req) => view(requireUser(req)));

  route('POST', '/api/todos', async (req, body) => {
    const u = requireUser(req);
    const text = U.cleanText(body.text, TEXT_MAX);
    if (text.length < 2) throw bad('Что не забыть? Пара слов.');
    const due = dueFor(body.when || 'today', u);
    if (countOn(u.id, due) >= MAX_PER_DAY) throw bad(`На этот день уже ${MAX_PER_DAY} дела — больше не влезет. Выбери главное или перенеси.`);
    let time = null;
    if (body.time) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time))) throw bad('Время в формате ЧЧ:ММ.'); time = String(body.time); }
    let person = null;
    if (body.person) { const p = q('SELECT id FROM users WHERE id = ? AND nick IS NOT NULL').get(Number(body.person)); if (p && p.id !== u.id) person = p.id; }
    q('INSERT INTO todos (user_id, text, due, time, person_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, U.seal(text), due, time, person, U.now());
    return view(u);
  });

  const mine = (u, id) => {
    const r = q('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(Number(id), u.id);
    if (!r) throw new HttpError(404, 'Дело не найдено.');
    return r;
  };

  route('POST', '/api/todos/:id/done', async (req, body, query, params) => {
    const u = requireUser(req);
    const r = mine(u, params.id);
    const t = today();
    const done = body.done !== false;
    q('UPDATE todos SET done_at = ?, done_day = ? WHERE id = ?').run(done ? U.now() : null, done ? t : null, r.id);
    if (done && onEvent) onEvent('todo_done', u.id, {});
    let praise = null, beans = 0;
    // Все дела на сегодня закрыты (и хотя бы одно было) — похвала, зёрна раз в день, серия
    const open = q('SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND due <= ? AND done_at IS NULL').get(u.id, t).n;
    const m = meta(u.id);
    if (done && !open && m.last_clean !== t) {
      const prevOk = m.last_clean && m.last_clean >= addDays(t, -3);
      m.streak = prevOk ? m.streak + 1 : 1;
      m.best = Math.max(m.best, m.streak);
      m.last_clean = t;
      saveMeta(u.id, m);
      beans = addBeans ? addBeans(u.id, 'todo_day') : 0;
      if (onEvent) onEvent('todo_clean', u.id, { streak: m.streak });
      praise = PRAISE[Math.floor(Math.random() * PRAISE.length)];
    }
    return { ...view(u), praise, beans };
  });

  route('POST', '/api/todos/:id/move', async (req, body, query, params) => {
    const u = requireUser(req);
    const r = mine(u, params.id);
    const due = dueFor(body.when || 'tomorrow', u);
    if (due !== r.due && countOn(u.id, due) >= MAX_PER_DAY) throw bad(`На этот день уже ${MAX_PER_DAY} дела.`);
    q('UPDATE todos SET due = ?, pushed = 0, done_at = NULL, done_day = NULL WHERE id = ?').run(due, r.id);
    return view(u);
  });

  route('POST', '/api/todos/:id/remove', async (req, body, query, params) => {
    const u = requireUser(req);
    const r = mine(u, params.id);
    q('DELETE FROM todos WHERE id = ?').run(r.id);
    return view(u);
  });

  // Для сводки «Этажа»: что осталось на сегодня
  function pending(uid) {
    return q('SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND due <= ? AND done_at IS NULL').get(uid, today()).n;
  }

  // Пуши: дело со временем — в это время; в 18:00 по будням — итог с подколом, если что-то не сделано
  function tick() {
    const m = U.msk(), t = m.day, hhmm = `${String(m.hour).padStart(2, '0')}:${String(m.minute).padStart(2, '0')}`;
    for (const r of q('SELECT * FROM todos WHERE due = ? AND time IS NOT NULL AND time <= ? AND done_at IS NULL AND pushed = 0').all(t, hhmm)) {
      q('UPDATE todos SET pushed = 1 WHERE id = ?').run(r.id);
      fireAndForget(notify([r.user_id], { title: 'Напоминалка', body: U.unseal(r.text), url: '/#todos', tag: `todo-${r.id}` }));
    }
    const h = m.hour + m.minute / 60;
    const dow = new Date(t + 'T12:00:00Z').getUTCDay();
    if (h < EVENING_FROM || h >= EVENING_TO || dow === 0 || dow === 6) return;
    for (const row of q('SELECT user_id AS id, COUNT(*) AS n FROM todos WHERE due <= ? AND done_at IS NULL GROUP BY user_id').all(t)) {
      const u = q('SELECT id, profile FROM users WHERE id = ?').get(row.id);
      if (!u || readProfile(u.profile).digest === false) continue;
      const mt = meta(u.id);
      if (mt.evening === t) continue;
      mt.evening = t; saveMeta(u.id, mt);
      const w = plural(row.n, 'дело', 'дела', 'дел');
      fireAndForget(notify([u.id], { title: 'Итог дня', body: ROAST[Math.floor(Math.random() * ROAST.length)](row.n, w), url: '/#todos', tag: 'todo-evening' }));
    }
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('todos', e); } }, 60e3).unref();

  function cleanup() { q('DELETE FROM todos WHERE due < ?').run(addDays(today(), -KEEP_DAYS)); }

  return { pending, cleanup, tick };
}

module.exports = { register, PRAISE, ROAST, MAX_PER_DAY };
