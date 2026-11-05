// Доска объявлений на весь «Этаж»: «ищу компанию на обед», «отдам билеты», «кто едет на конференцию», «нашёл зонт».
// Объявление живёт до даты, которую выбрал автор (не дольше двух недель), и само исчезает.
// «Я тоже» — отметка интереса: автору приходит пуш (один раз на человека), дальше общение в личке.

const KINDS = {
  company: { name: 'Ищу компанию', icon: 'coffee' },
  give: { name: 'Отдам / продам', icon: 'gift' },
  trip: { name: 'Поездка, конференция', icon: 'flag' },
  found: { name: 'Нашёл / потерял', icon: 'search' },
  ask: { name: 'Вопрос коллегам', icon: 'help' },
  other: { name: 'Другое', icon: 'megaphone' }
};
const TEXT_MAX = 200;
const MAX_DAYS = 14;
const PER_DAY = 5;

function register(ctx) {
  const { db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, rateLimit, officeById, publicLook } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS board_posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, text TEXT NOT NULL, office_id TEXT, until TEXT NOT NULL,
    at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS board_until ON board_posts(until);
  CREATE TABLE IF NOT EXISTS board_metoo (
    post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id)
  );
  `);

  const today = () => U.msk().day;
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  function view(p, uid) {
    const who = q('SELECT nick, look FROM users WHERE id = ?').get(p.user_id) || { nick: 'удалённый аккаунт', look: '{}' };
    const me = q('SELECT 1 FROM board_metoo WHERE post_id = ? AND user_id = ?').get(p.id, uid);
    const fans = p.user_id === uid ? q('SELECT u.id, u.nick FROM board_metoo m JOIN users u ON u.id = m.user_id WHERE m.post_id = ? ORDER BY m.at').all(p.id) : null;
    const o = p.office_id ? officeById(p.office_id) : null;
    return {
      id: p.id, kind: p.kind, kindName: (KINDS[p.kind] || KINDS.other).name, icon: (KINDS[p.kind] || KINDS.other).icon,
      text: p.text, until: p.until, office: o ? { id: o.id, name: o.name } : null,
      author: { id: p.user_id, nick: who.nick, look: publicLook ? publicLook(who) : {} }, mine: p.user_id === uid,
      metoo: q('SELECT COUNT(*) AS n FROM board_metoo WHERE post_id = ?').get(p.id).n, iMetoo: !!me, fans, at: p.at
    };
  }

  route('GET', '/api/board', async (req, body, query) => {
    const u = requireUser(req);
    const rows = q('SELECT * FROM board_posts WHERE hidden = 0 AND until >= ? ORDER BY at DESC LIMIT 100').all(today());
    const office = query.office ? String(query.office) : '';
    const items = rows.filter((p) => !office || !p.office_id || p.office_id === office).map((p) => view(p, u.id));
    return { items, kinds: Object.entries(KINDS).map(([id, k]) => ({ id, ...k })), maxDays: MAX_DAYS };
  });

  route('POST', '/api/board', async (req, body) => {
    const u = requireUser(req);
    rateLimit('board:' + u.id, PER_DAY, 24 * 3600e3);
    const kind = KINDS[body.kind] ? body.kind : 'other';
    const text = U.cleanText(body.text, TEXT_MAX);
    if (text.length < 5) throw bad('Напиши пару слов: что ищешь или предлагаешь.');
    const prob = U.moderationProblem(text);
    if (prob) throw bad(prob);
    const t = today();
    let until = String(body.until || addDays(t, 3));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || isNaN(Date.parse(until)) || until < t) throw bad('До какого дня висит объявление?');
    if (until > addDays(t, MAX_DAYS)) until = addDays(t, MAX_DAYS);
    const office = body.office && officeById(String(body.office)) ? String(body.office) : null;
    const id = Number(q('INSERT INTO board_posts (user_id, kind, text, office_id, until, at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, kind, text, office, until, U.now()).lastInsertRowid);
    return { item: view(q('SELECT * FROM board_posts WHERE id = ?').get(id), u.id) };
  });

  const postOr404 = (id) => {
    const p = q('SELECT * FROM board_posts WHERE id = ? AND hidden = 0').get(Number(id));
    if (!p || p.until < today()) throw new HttpError(404, 'Объявление уже снято.');
    return p;
  };

  // «Я тоже»: повторное нажатие снимает отметку. Автору — пуш, но только при первой отметке этого человека
  route('POST', '/api/board/:id/metoo', async (req, body, query, params) => {
    const u = requireUser(req);
    const p = postOr404(params.id);
    if (p.user_id === u.id) throw bad('Это твоё объявление.');
    const had = q('SELECT 1 FROM board_metoo WHERE post_id = ? AND user_id = ?').get(p.id, u.id);
    if (had) q('DELETE FROM board_metoo WHERE post_id = ? AND user_id = ?').run(p.id, u.id);
    else {
      const r = q('INSERT OR IGNORE INTO board_metoo (post_id, user_id, at) VALUES (?, ?, ?)').run(p.id, u.id, U.now());
      if (r.changes) fireAndForget(notify([p.user_id], { title: 'Доска «Этажа»', body: `${u.nick}: «я тоже» — ${p.text.slice(0, 60)}`, url: `/#crew/${u.id}`, tag: `board-${p.id}` }));
    }
    return { item: view(p, u.id) };
  });

  route('POST', '/api/board/:id/remove', async (req, body, query, params) => {
    const u = requireUser(req);
    const p = q('SELECT * FROM board_posts WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Объявление уже снято.');
    if (p.user_id !== u.id && !u.isAdmin) throw bad('Снять может только автор.');
    q('DELETE FROM board_posts WHERE id = ?').run(p.id);
    return { ok: true };
  });

  function cleanup() { q('DELETE FROM board_posts WHERE until < ?').run(addDays(today(), -1)); }

  return { cleanup, KINDS };
}

module.exports = { register, KINDS };
