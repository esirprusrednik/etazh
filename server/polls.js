// Опросы внутри банды: «куда идём обедать», «когда собираемся» и т. п.
// Голосуют только члены банды, голоса видны по никам (это банда, а не выборы).
// Автор может разрешить участникам дописывать свои варианты.

const MAX_OPTIONS = 12;        // всего вариантов, включая добавленные участниками
const MAX_START = 10;          // вариантов при создании
const MAX_ADD_PER_USER = 3;    // своих вариантов от одного человека
const DURATIONS = [1, 3, 7];   // дней
const KEEP_CLOSED_DAYS = 7;

function register(ctx) {
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, rateLimit, onEvent } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    question TEXT NOT NULL, multi INTEGER NOT NULL DEFAULT 0, open INTEGER NOT NULL DEFAULT 1,
    at INTEGER NOT NULL, closes_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS polls_gang ON polls(gang_id, closes_at);
  CREATE TABLE IF NOT EXISTS poll_options (
    id INTEGER PRIMARY KEY,
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    PRIMARY KEY (poll_id, option_id, user_id)
  );
  `);

  const cleanOption = (s) => {
    const t = U.cleanText(s || '', 40);
    const prob = t && U.moderationProblem(t);
    if (prob) throw bad(prob);
    return t;
  };

  function view(p, uid) {
    const opts = q('SELECT o.*, u.nick FROM poll_options o LEFT JOIN users u ON u.id = o.user_id WHERE o.poll_id = ? ORDER BY o.id').all(p.id);
    const votes = q('SELECT v.option_id, v.user_id, u.nick FROM poll_votes v JOIN users u ON u.id = v.user_id WHERE v.poll_id = ? ORDER BY v.at').all(p.id);
    const voters = new Set(votes.map((v) => v.user_id));
    const max = Math.max(0, ...opts.map((o) => votes.filter((v) => v.option_id === o.id).length));
    const author = p.user_id ? (q('SELECT nick FROM users WHERE id = ?').get(p.user_id) || {}).nick : null;
    const closed = p.closes_at <= U.now();
    return {
      id: p.id, question: p.question, author: author || 'удалённый аккаунт', mine: p.user_id === uid,
      multi: !!p.multi, open: !!p.open, closesAt: p.closes_at, closed, total: voters.size,
      voted: voters.has(uid),
      canAdd: !!p.open && !closed && opts.length < MAX_OPTIONS && opts.filter((o) => o.user_id === uid && p.user_id !== uid).length < MAX_ADD_PER_USER,
      options: opts.map((o) => {
        const vs = votes.filter((v) => v.option_id === o.id);
        return {
          id: o.id, text: o.text, n: vs.length, pct: voters.size ? Math.round((vs.length / voters.size) * 100) : 0,
          me: vs.some((v) => v.user_id === uid), lead: closed && max > 0 && vs.length === max,
          voters: vs.map((v) => v.nick), addedBy: o.user_id && o.user_id !== p.user_id ? o.nick : null
        };
      })
    };
  }

  const pollOr404 = (id, uid) => {
    const p = q('SELECT * FROM polls WHERE id = ?').get(Number(id));
    if (!p || !isMember(p.gang_id, uid)) throw new HttpError(404, 'Опрос не найден.');
    return p;
  };

  route('GET', '/api/gangs/:id/polls', async (req, body, query, params) => {
    const u = requireUser(req);
    const gangId = Number(params.id);
    if (!isMember(gangId, u.id)) throw new HttpError(404, 'Банда не найдена.');
    // Активные — сверху; завершённые показываем ещё сутки, чтобы все увидели итог
    const rows = q('SELECT * FROM polls WHERE gang_id = ? AND closes_at > ? ORDER BY (closes_at <= ?) ASC, at DESC LIMIT 20')
      .all(gangId, U.now() - 24 * 3600e3, U.now());
    return { items: rows.map((p) => view(p, u.id)), durations: DURATIONS };
  });

  route('POST', '/api/gangs/:id/polls', async (req, body, query, params) => {
    const u = requireUser(req);
    const gangId = Number(params.id);
    if (!isMember(gangId, u.id)) throw new HttpError(404, 'Банда не найдена.');
    rateLimit('poll:' + u.id, 10, 24 * 3600e3);
    const question = U.cleanText(body.question || '', 120);
    if (question.length < 3) throw bad('Напиши вопрос.');
    const prob = U.moderationProblem(question);
    if (prob) throw bad(prob);
    const options = [];
    for (const o of (Array.isArray(body.options) ? body.options : []).slice(0, MAX_START)) {
      const t = cleanOption(o);
      if (t && !options.some((x) => x.toLocaleLowerCase('ru') === t.toLocaleLowerCase('ru'))) options.push(t);
    }
    const open = body.open !== false;
    if (options.length < (open ? 1 : 2)) throw bad(open ? 'Добавь хотя бы один вариант — остальные допишет банда.' : 'Нужно хотя бы два варианта.');
    const days = DURATIONS.includes(Number(body.days)) ? Number(body.days) : 1;
    const t = U.now();
    const r = q('INSERT INTO polls (gang_id, user_id, question, multi, open, at, closes_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(gangId, u.id, question, body.multi ? 1 : 0, open ? 1 : 0, t, t + days * 864e5);
    const pid = Number(r.lastInsertRowid);
    const ins = q('INSERT INTO poll_options (poll_id, text, user_id, at) VALUES (?, ?, ?, ?)');
    for (const o of options) ins.run(pid, o, u.id, t);
    // В чат — короткая отметка, чтобы опрос заметили
    q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(gangId, u.id, 'text', `Опрос: «${question}» — голосуй выше`, t);
    const g = q('SELECT name FROM gangs WHERE id = ?').get(gangId);
    const others = gangMembers(gangId).filter((m) => m.id !== u.id).map((m) => m.id);
    fireAndForget(notify(others, { title: g ? g.name : 'Опрос', body: `${u.nick}: ${question}`, url: `/#gang/${gangId}`, tag: `poll-${pid}` }));
    if (onEvent) onEvent('poll', u.id);
    return { id: pid, poll: view(q('SELECT * FROM polls WHERE id = ?').get(pid), u.id) };
  });

  route('POST', '/api/polls/:id/vote', async (req, body, query, params) => {
    const u = requireUser(req);
    const p = pollOr404(params.id, u.id);
    if (p.closes_at <= U.now()) throw bad('Опрос уже завершён.');
    const opt = q('SELECT * FROM poll_options WHERE id = ? AND poll_id = ?').get(Number(body.option), p.id);
    if (!opt) throw bad('Нет такого варианта.');
    const has = q('SELECT 1 FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?').get(p.id, opt.id, u.id);
    const firstVote = !q('SELECT 1 FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(p.id, u.id);
    // Повторное нажатие снимает голос; в одиночном выборе новый голос заменяет старый
    if (has) q('DELETE FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?').run(p.id, opt.id, u.id);
    else {
      if (!p.multi) q('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(p.id, u.id);
      q('INSERT INTO poll_votes (poll_id, option_id, user_id, at) VALUES (?, ?, ?, ?)').run(p.id, opt.id, u.id, U.now());
      if (firstVote && onEvent) onEvent('poll_vote', u.id);
    }
    return { poll: view(p, u.id) };
  });

  route('POST', '/api/polls/:id/options', async (req, body, query, params) => {
    const u = requireUser(req);
    const p = pollOr404(params.id, u.id);
    if (p.closes_at <= U.now()) throw bad('Опрос уже завершён.');
    if (!p.open && p.user_id !== u.id) throw bad('Автор не разрешил добавлять варианты.');
    const opts = q('SELECT * FROM poll_options WHERE poll_id = ?').all(p.id);
    if (opts.length >= MAX_OPTIONS) throw bad(`Вариантов уже ${MAX_OPTIONS} — хватит, выбирайте.`);
    if (p.user_id !== u.id && opts.filter((o) => o.user_id === u.id).length >= MAX_ADD_PER_USER) throw bad(`Своих вариантов — не больше ${MAX_ADD_PER_USER}.`);
    const text = cleanOption(body.text);
    if (!text) throw bad('Напиши вариант.');
    const same = opts.find((o) => o.text.toLocaleLowerCase('ru') === text.toLocaleLowerCase('ru'));
    const optId = same ? same.id : Number(q('INSERT INTO poll_options (poll_id, text, user_id, at) VALUES (?, ?, ?, ?)').run(p.id, text, u.id, U.now()).lastInsertRowid);
    // Свой вариант — значит, за него и голосуешь
    const firstVote = !q('SELECT 1 FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(p.id, u.id);
    if (firstVote && onEvent) onEvent('poll_vote', u.id);
    if (!q('SELECT 1 FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?').get(p.id, optId, u.id)) {
      if (!p.multi) q('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(p.id, u.id);
      q('INSERT INTO poll_votes (poll_id, option_id, user_id, at) VALUES (?, ?, ?, ?)').run(p.id, optId, u.id, U.now());
    }
    return { poll: view(p, u.id), existed: !!same };
  });

  route('POST', '/api/polls/:id/close', async (req, body, query, params) => {
    const u = requireUser(req);
    const p = pollOr404(params.id, u.id);
    if (p.user_id !== u.id) throw bad('Завершить опрос может только автор.');
    if (p.closes_at > U.now()) q('UPDATE polls SET closes_at = ? WHERE id = ?').run(U.now(), p.id);
    return { poll: view(q('SELECT * FROM polls WHERE id = ?').get(p.id), u.id) };
  });

  function cleanup() {
    q('DELETE FROM polls WHERE closes_at < ?').run(U.now() - KEEP_CLOSED_DAYS * 864e5);
  }

  // Опросы, где ты ещё не голосовал (свои не считаем): для бейджа «Чаты» и строки банды
  function unvoted(uid, gangId = null) {
    return q(`SELECT COUNT(*) AS n FROM polls p JOIN gang_members gm ON gm.gang_id = p.gang_id AND gm.user_id = ?
      WHERE p.closes_at > ? AND (p.user_id IS NULL OR p.user_id != ?)
      AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = p.id AND v.user_id = ?)${gangId ? ' AND p.gang_id = ?' : ''}`).get(uid, U.now(), uid, uid, ...(gangId ? [gangId] : [])).n;
  }

  return { cleanup, unvoted };
}

module.exports = { register };
