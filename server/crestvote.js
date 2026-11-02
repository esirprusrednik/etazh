// Герб банды выбирают голосованием: любой участник собирает герб и выносит его на голосование.
// Чтобы было честно:
//  • голос тайный — видно только «за» и «против», без ников, никто не давит на соседа;
//  • у владельца нет вето и нет лишнего голоса — один человек, один голос;
//  • досрочно решается, когда «за» или «против» — больше половины всей банды;
//  • иначе через 48 часов: принят, если «за» больше, чем «против», и «за» проголосовала хотя бы треть банды (кворум),
//    чтобы двое ночью не сменили герб банде на 30 человек;
//  • одно голосование за раз, один человек — одно предложение в сутки.

const DURATION_MS = 48 * 3600e3;
const KEEP_DAYS = 3;

function register(ctx) {
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, crestClean } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS crest_proposals (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    crest TEXT NOT NULL, at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', decided_at INTEGER, za INTEGER, protiv INTEGER
  );
  CREATE INDEX IF NOT EXISTS crest_proposals_gang ON crest_proposals(gang_id, status);
  CREATE TABLE IF NOT EXISTS crest_votes (
    proposal_id INTEGER NOT NULL REFERENCES crest_proposals(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote INTEGER NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (proposal_id, user_id)
  );
  `);

  const memberCount = (gid) => q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(gid).n;
  // Голоса считаем только тех, кто сейчас в банде
  const tally = (p) => q(`SELECT COALESCE(SUM(v.vote = 1), 0) AS za, COALESCE(SUM(v.vote = -1), 0) AS protiv FROM crest_votes v
    JOIN gang_members m ON m.user_id = v.user_id AND m.gang_id = ? WHERE v.proposal_id = ?`).get(p.gang_id, p.id);

  function finish(p, status, t) {
    q('UPDATE crest_proposals SET status = ?, decided_at = ?, za = ?, protiv = ? WHERE id = ?').run(status, U.now(), t.za, t.protiv, p.id);
    const g = q('SELECT name FROM gangs WHERE id = ?').get(p.gang_id);
    if (status === 'accepted') q('UPDATE gangs SET crest = ? WHERE id = ?').run(p.crest, p.gang_id);
    const text = status === 'accepted' ? `Новый герб принят: за — ${t.za}, против — ${t.protiv}` : status === 'rejected' ? `Герб не прошёл: за — ${t.za}, против — ${t.protiv}` : null;
    if (text) {
      q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(p.gang_id, p.user_id, 'text', text, U.now());
      if (status === 'accepted') fireAndForget(notify(gangMembers(p.gang_id).map((m) => m.id), { title: g ? g.name : 'Банда', body: 'У банды новый герб — посмотри', url: `/#gang/${p.gang_id}`, tag: `crest-${p.id}` }));
    }
  }

  // Проверить, не пора ли решить: досрочно по большинству всей банды или по сроку с кворумом
  function decide(p) {
    if (!p || p.status !== 'open') return p;
    const t = tally(p);
    const n = memberCount(p.gang_id);
    if (t.za * 2 > n) finish(p, 'accepted', t);
    else if (t.protiv * 2 >= n && n > 0) finish(p, 'rejected', t);
    else if (U.now() >= p.ends_at) finish(p, t.za > t.protiv && t.za * 3 >= n ? 'accepted' : 'rejected', t);
    return q('SELECT * FROM crest_proposals WHERE id = ?').get(p.id);
  }

  const openOf = (gid) => decide(q("SELECT * FROM crest_proposals WHERE gang_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(gid));

  function view(gid, uid) {
    const p = openOf(gid);
    const n = memberCount(gid);
    const active = p && p.status === 'open' ? (() => {
      const t = tally(p);
      const my = q('SELECT vote FROM crest_votes WHERE proposal_id = ? AND user_id = ?').get(p.id, uid);
      const author = p.user_id ? (q('SELECT nick FROM users WHERE id = ?').get(p.user_id) || {}).nick : null;
      return { id: p.id, crest: JSON.parse(p.crest), author: author || 'удалённый аккаунт', mine: p.user_id === uid, za: t.za, protiv: t.protiv, my: my ? my.vote : 0,
        endsAt: p.ends_at, members: n, needEarly: Math.floor(n / 2) + 1, quorum: Math.ceil(n / 3) };
    })() : null;
    const lastRow = q("SELECT * FROM crest_proposals WHERE gang_id = ? AND status IN ('accepted', 'rejected') AND decided_at > ? ORDER BY decided_at DESC LIMIT 1").get(gid, U.now() - KEEP_DAYS * 864e5);
    return { active, last: lastRow ? { status: lastRow.status, crest: JSON.parse(lastRow.crest), za: lastRow.za, protiv: lastRow.protiv, at: lastRow.decided_at } : null };
  }

  const gangOr404 = (gid, uid) => {
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(gid));
    if (!g || !isMember(g.id, uid)) throw new HttpError(404, 'Банда не найдена.');
    return g;
  };

  route('GET', '/api/gangs/:id/crest-vote', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    return view(g.id, u.id);
  });

  route('POST', '/api/gangs/:id/crest-vote', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    const cur = openOf(g.id);
    if (cur && cur.status === 'open') throw bad('Уже идёт голосование за герб — дождитесь итога.');
    if (q('SELECT 1 FROM crest_proposals WHERE gang_id = ? AND user_id = ? AND at > ?').get(g.id, u.id, U.now() - 864e5)) throw bad('Предлагать герб можно раз в сутки.');
    if (!body.crest || typeof body.crest !== 'object') throw bad('Собери герб.');
    const crest = crestClean(body.crest);
    if (crest === g.crest) throw bad('Это и есть нынешний герб.');
    const t = U.now();
    const id = Number(q('INSERT INTO crest_proposals (gang_id, user_id, crest, at, ends_at) VALUES (?, ?, ?, ?, ?)').run(g.id, u.id, crest, t, t + DURATION_MS).lastInsertRowid);
    q('INSERT INTO crest_votes (proposal_id, user_id, vote, at) VALUES (?, ?, 1, ?)').run(id, u.id, t);
    const p = decide(q('SELECT * FROM crest_proposals WHERE id = ?').get(id)); // банда из одного человека — сразу принят
    if (p.status === 'open') {
      q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(g.id, u.id, 'text', 'Предлагаю новый герб банды — голосуй выше, голос тайный', t);
      const others = gangMembers(g.id).filter((m) => m.id !== u.id).map((m) => m.id);
      fireAndForget(notify(others, { title: `${g.name}: новый герб?`, body: `${u.nick} ${U.g(u.look, 'предложил', 'предложила')} герб — голосование 48 часов`, url: `/#gang/${g.id}`, tag: `crest-${id}` }));
    }
    return { id, status: p.status, ...view(g.id, u.id) };
  });

  const propOr404 = (id, uid) => {
    const p = q('SELECT * FROM crest_proposals WHERE id = ?').get(Number(id));
    if (!p || !isMember(p.gang_id, uid)) throw new HttpError(404, 'Голосование не найдено.');
    return p;
  };

  route('POST', '/api/crest-vote/:id/vote', async (req, body, query, params) => {
    const u = requireUser(req);
    let p = decide(propOr404(params.id, u.id));
    if (p.status !== 'open') return view(p.gang_id, u.id);
    const v = Number(body.vote);
    if (v !== 1 && v !== -1) throw bad('За или против?');
    q('INSERT OR REPLACE INTO crest_votes (proposal_id, user_id, vote, at) VALUES (?, ?, ?, ?)').run(p.id, u.id, v, U.now());
    p = decide(p);
    return { status: p.status, ...view(p.gang_id, u.id) };
  });

  route('POST', '/api/crest-vote/:id/withdraw', async (req, body, query, params) => {
    const u = requireUser(req);
    const p = propOr404(params.id, u.id);
    if (p.user_id !== u.id) throw bad('Снять с голосования может только автор.');
    if (p.status === 'open') q("UPDATE crest_proposals SET status = 'withdrawn', decided_at = ? WHERE id = ?").run(U.now(), p.id);
    return view(p.gang_id, u.id);
  });

  // Для строки банды в «Чатах»: идёт ли голосование и голосовал ли я
  function pending(gid, uid) {
    const p = openOf(gid);
    if (!p || p.status !== 'open') return null;
    return { voted: !!q('SELECT 1 FROM crest_votes WHERE proposal_id = ? AND user_id = ?').get(p.id, uid) };
  }
  function tick() {
    for (const p of q("SELECT * FROM crest_proposals WHERE status = 'open' AND ends_at <= ?").all(U.now())) decide(p);
    q("DELETE FROM crest_proposals WHERE status != 'open' AND decided_at < ?").run(U.now() - 30 * 864e5);
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('crestvote', e); } }, 10 * 60e3).unref();

  return { pending, tick };
}

module.exports = { register, DURATION_MS };
