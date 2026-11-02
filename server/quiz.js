// Квизы.
// 1) «Угадай коллегу» — вопросы собираются сами из того, что участники банды рассказали о себе
//    (аватар, «О себе», интересы). Чем полнее профили, тем интереснее игра — это и есть мотивация заполнять.
// 2) «Квиз недели» — вопрос от модератора для всех, после ответа видно, как ответили остальные.
// Подключается из api.js через register(ctx), как crew.js.

const GUESS_PER_DAY = 3;      // вопросов «Угадай коллегу» в день
const QUIZ_TTL_DAYS = 30;     // закрытый квиз и ответы на него удаляются через месяц

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function register(ctx) {
  const { db, q, route, requireUser, requireAdmin, bad, U, addBeans, isMember, gangMembers, readProfile, HttpError, onEvent, DEFAULT_LOOK, publicLook } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS guess_q (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gang_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,             -- avatar | about | tags
    options TEXT NOT NULL,          -- [user_id, ...]
    day TEXT NOT NULL,
    pick INTEGER, correct INTEGER
  );
  CREATE INDEX IF NOT EXISTS guess_q_user_day ON guess_q(user_id, day);
  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL, options TEXT NOT NULL, correct INTEGER NOT NULL, explain TEXT,
    created_at INTEGER NOT NULL, closes_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quiz_answers (
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pick INTEGER NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (quiz_id, user_id)
  );
  `);

  const lookOf = (row) => publicLook(row);
  const nickOf = (id) => (q('SELECT nick FROM users WHERE id = ?').get(id) || { nick: 'удалённый аккаунт' }).nick;

  // ---------- Угадай коллегу ----------
  function guessView(row, uid) {
    const t = q('SELECT id, nick, look, profile, share_office FROM users WHERE id = ?').get(row.target_id);
    const prof = t ? readProfile(t.profile) : { about: '', tags: [] };
    const options = JSON.parse(row.options).map((id) => ({ id, nick: nickOf(id) }));
    const base = { id: row.id, kind: row.kind, options, answered: row.pick != null };
    if (row.kind === 'avatar') base.look = t ? lookOf(t) : {};
    if (row.kind === 'about') base.about = prof.about;
    if (row.kind === 'tags') base.tags = prof.tags;
    if (row.pick != null) Object.assign(base, { pick: row.pick, correct: !!row.correct, answer: row.target_id, answerNick: t ? t.nick : '' });
    const today = U.msk().day;
    base.left = GUESS_PER_DAY - q('SELECT COUNT(*) AS n FROM guess_q WHERE user_id = ? AND day = ? AND pick IS NOT NULL').get(uid, today).n;
    return base;
  }

  // Текущий вопрос: неотвеченный сегодняшний или новый, пока не исчерпан дневной лимит
  route('GET', '/api/gangs/:id/guess', async (req, body, query, params) => {
    const u = requireUser(req);
    const gangId = Number(params.id);
    if (!isMember(gangId, u.id)) throw new HttpError(404, 'Банда не найдена.');
    const today = U.msk().day;
    const open = q('SELECT * FROM guess_q WHERE user_id = ? AND gang_id = ? AND day = ? AND pick IS NULL ORDER BY id DESC').get(u.id, gangId, today);
    if (open) return { question: guessView(open, u.id) };
    const answered = q('SELECT * FROM guess_q WHERE user_id = ? AND day = ? AND pick IS NOT NULL').all(u.id, today);
    if (answered.length >= GUESS_PER_DAY) return { question: null, done: true, left: 0 };
    const others = gangMembers(gangId).filter((m) => m.id !== u.id && m.nick);
    if (others.length < 3) return { question: null, small: true, need: 3 - others.length };
    const usedToday = new Set(answered.map((r) => r.target_id));
    // Кандидаты-вопросы: аватар есть у всех, «О себе» и интересы — у тех, кто их заполнил
    const pool = [];
    for (const m of others) {
      if (usedToday.has(m.id)) continue;
      const p = readProfile(m.profile);
      if (p.about) pool.push({ m, kind: 'about' }, { m, kind: 'about' });
      if ((p.tags || []).length >= 2) pool.push({ m, kind: 'tags' });
      pool.push({ m, kind: 'avatar' });
    }
    if (!pool.length) return { question: null, done: true, left: 0 };
    const pickQ = pool[Math.floor(Math.random() * pool.length)];
    const wrong = shuffle(others.filter((m) => m.id !== pickQ.m.id)).slice(0, 3).map((m) => m.id);
    const options = shuffle([pickQ.m.id, ...wrong]);
    const r = q('INSERT INTO guess_q (user_id, gang_id, target_id, kind, options, day) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, gangId, pickQ.m.id, pickQ.kind, JSON.stringify(options), today);
    return { question: guessView(q('SELECT * FROM guess_q WHERE id = ?').get(Number(r.lastInsertRowid)), u.id) };
  });

  route('POST', '/api/guess/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    const row = q('SELECT * FROM guess_q WHERE id = ? AND user_id = ?').get(Number(params.id), u.id);
    if (!row) throw new HttpError(404, 'Вопрос не найден.');
    if (row.pick != null) throw bad('Ответ уже принят.');
    const pick = Number(body.pick);
    if (!JSON.parse(row.options).includes(pick)) throw bad('Выбери вариант из списка.');
    const correct = pick === row.target_id ? 1 : 0;
    q('UPDATE guess_q SET pick = ?, correct = ? WHERE id = ?').run(pick, correct, row.id);
    let beans = 0;
    if (correct) { beans = addBeans(u.id, 'guess') || 0; if (onEvent) onEvent('guess_ok', u.id); }
    if (onEvent) onEvent('guess_any', u.id);
    return { question: guessView(q('SELECT * FROM guess_q WHERE id = ?').get(row.id), u.id), beans };
  });

  // ---------- Квиз недели ----------
  function quizView(z, uid, admin = false) {
    const mine = q('SELECT pick FROM quiz_answers WHERE quiz_id = ? AND user_id = ?').get(z.id, uid);
    const options = JSON.parse(z.options);
    const v = { id: z.id, text: z.text, options, closesAt: z.closes_at, closed: z.closes_at <= U.now(), answered: !!mine };
    if (mine || admin || v.closed) {
      const rows = q('SELECT pick, COUNT(*) AS n FROM quiz_answers WHERE quiz_id = ? GROUP BY pick').all(z.id);
      const total = rows.reduce((s, r) => s + r.n, 0);
      v.stats = options.map((_, i) => { const n = (rows.find((r) => r.pick === i) || { n: 0 }).n; return { n, pct: total ? Math.round((n / total) * 100) : 0 }; });
      v.total = total;
      v.correct = z.correct; v.explain = z.explain || '';
      if (mine) v.pick = mine.pick;
    }
    return v;
  }

  route('GET', '/api/quiz', async (req) => {
    const u = requireUser(req);
    const t = U.now();
    const rows = q('SELECT * FROM quizzes WHERE closes_at > ? ORDER BY id DESC LIMIT 5').all(t);
    const items = rows.map((z) => quizView(z, u.id));
    // Первым — неотвеченный
    items.sort((a, b) => Number(a.answered) - Number(b.answered));
    return { items };
  });

  route('POST', '/api/quiz/:id/answer', async (req, body, query, params) => {
    const u = requireUser(req);
    const z = q('SELECT * FROM quizzes WHERE id = ?').get(Number(params.id));
    if (!z) throw new HttpError(404, 'Квиз не найден.');
    if (z.closes_at <= U.now()) throw bad('Квиз уже закрыт.');
    const pick = Number(body.pick);
    if (!Number.isInteger(pick) || pick < 0 || pick >= JSON.parse(z.options).length) throw bad('Выбери вариант.');
    const r = q('INSERT OR IGNORE INTO quiz_answers (quiz_id, user_id, pick, at) VALUES (?, ?, ?, ?)').run(z.id, u.id, pick, U.now());
    if (!r.changes) throw bad('Ответ уже принят.');
    let beans = 0;
    if (pick === z.correct) { beans = addBeans(u.id, 'quiz') || 0; if (onEvent) onEvent('quiz_ok', u.id); }
    if (onEvent) onEvent('quiz_any', u.id);
    return { quiz: quizView(z, u.id), beans };
  });

  // Модерация: создать, список, закрыть
  route('GET', '/api/admin/quizzes', async (req) => {
    const u = requireAdmin(req);
    return { items: q('SELECT * FROM quizzes ORDER BY id DESC LIMIT 20').all().map((z) => quizView(z, u.id, true)) };
  });

  route('POST', '/api/admin/quizzes', async (req, body) => {
    requireAdmin(req);
    const text = U.cleanText(body.text, 200);
    const options = (Array.isArray(body.options) ? body.options : []).map((o) => U.cleanText(o, 80)).filter(Boolean);
    const correct = Number(body.correct);
    const days = Math.max(1, Math.min(14, Number(body.days) || 7));
    if (text.length < 5) throw bad('Напиши вопрос.');
    if (options.length < 2 || options.length > 4) throw bad('Нужно от 2 до 4 вариантов.');
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw bad('Отметь правильный ответ.');
    const t = U.now();
    const r = q('INSERT INTO quizzes (text, options, correct, explain, created_at, closes_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(text, JSON.stringify(options), correct, U.cleanText(body.explain || '', 200), t, t + days * 864e5);
    return { id: Number(r.lastInsertRowid) };
  });

  route('POST', '/api/admin/quizzes/:id/close', async (req, body, query, params) => {
    requireAdmin(req);
    q('UPDATE quizzes SET closes_at = ? WHERE id = ?').run(U.now(), Number(params.id));
    return { ok: true };
  });

  function cleanup() {
    const t = U.now();
    q('DELETE FROM quizzes WHERE closes_at < ?').run(t - QUIZ_TTL_DAYS * 864e5);
    q('DELETE FROM guess_q WHERE day < ?').run(new Date(t - 30 * 864e5).toISOString().slice(0, 10));
  }

  return { cleanup };
}

module.exports = { register };
