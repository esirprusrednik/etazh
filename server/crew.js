// Подельники: личные контакты один на один, отдельно от банд.
// Дружба взаимная (заявка → принять), переписка и зовы видны только двоим.
// Модератор видит личное сообщение, только если получатель на него пожаловался.
// Подключается из api.js через register(ctx), как features.js.
const { CALLS } = require('./catalog');

const DM_TTL_DAYS = 7;          // сколько живут личные сообщения
const MAX_CREW = 50;            // подельников у одного человека
const REQUESTS_PER_DAY = 20;    // заявок в день — защита от спама
const PENDING_TTL_DAYS = 30;    // неотвеченная заявка сгорает
const DM_CALLS = ['coffee', 'lunch', 'call', 'where', 'online', 'wait', 'room']; // «Домой — кто с ним?» в личке не нужен

function register(ctx) {
  const { db, q, route, requireUser, bad, U, config, notify, fireAndForget, rateLimit, memberStatus, HttpError } = ctx;

  db.exec(`
  -- Пара хранится упорядоченно: lo < hi. status: pending | ok
  CREATE TABLE IF NOT EXISTS crew (
    lo INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hi INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (lo, hi)
  );
  CREATE INDEX IF NOT EXISTS crew_hi ON crew(hi);

  CREATE TABLE IF NOT EXISTS crew_blocks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    PRIMARY KEY (user_id, blocked_id)
  );

  -- Личная ссылка «стань моим подельником»: /p/ABC123
  CREATE TABLE IF NOT EXISTS crew_codes (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE
  );

  -- Личные сообщения и зовы живут ${DM_TTL_DAYS} дней. Удаление аккаунта стирает переписку целиком.
  CREATE TABLE IF NOT EXISTS dms (
    id INTEGER PRIMARY KEY,
    lo INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hi INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,              -- text | call
    kind TEXT,
    opt TEXT,
    text TEXT,
    reply TEXT,
    reply_at INTEGER,
    read_at INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS dms_pair_at ON dms(lo, hi, at);
  CREATE INDEX IF NOT EXISTS dms_unread ON dms(to_id, read_at);
  `);

  const pair = (a, b) => (a < b ? [a, b] : [b, a]);
  const link = (a, b) => q('SELECT * FROM crew WHERE lo = ? AND hi = ?').get(...pair(a, b)) || null;
  const areCrew = (a, b) => { const l = link(a, b); return !!l && l.status === 'ok'; };
  const blocked = (by, who) => !!q('SELECT 1 FROM crew_blocks WHERE user_id = ? AND blocked_id = ?').get(by, who);
  const crewCount = (uid) => q("SELECT COUNT(*) AS n FROM crew WHERE (lo = ? OR hi = ?) AND status = 'ok'").get(uid, uid).n;
  const userRow = (id) => q('SELECT * FROM users WHERE id = ? AND nick IS NOT NULL').get(id);

  function codeOf(uid) {
    const row = q('SELECT code FROM crew_codes WHERE user_id = ?').get(uid);
    if (row) return row.code;
    let code;
    do code = U.shortCode(6); while (q('SELECT 1 FROM crew_codes WHERE code = ?').get(code));
    q('INSERT INTO crew_codes (user_id, code) VALUES (?, ?)').run(uid, code);
    return code;
  }

  function unread(uid) {
    const msgs = q('SELECT COUNT(*) AS n FROM dms WHERE to_id = ? AND read_at IS NULL AND hidden = 0').get(uid).n;
    const reqs = q(`SELECT COUNT(*) AS n FROM crew WHERE (lo = ? OR hi = ?) AND status = 'pending' AND from_id != ?
                    AND from_id NOT IN (SELECT blocked_id FROM crew_blocks WHERE user_id = ?)`).get(uid, uid, uid, uid).n;
    return msgs + reqs;
  }

  function friendOr404(u, id) {
    const f = userRow(Number(id));
    if (!f || !areCrew(u.id, f.id)) throw new HttpError(404, 'Это не твой подельник.');
    return f;
  }

  // Переписку удаляем у обоих, кроме сообщений с открытой жалобой: их ещё должен увидеть модератор
  const dropChat = (lo, hi) => q(`DELETE FROM dms WHERE lo = ? AND hi = ?
    AND id NOT IN (SELECT object_id FROM reports WHERE object_type = 'dm' AND status = 'open')`).run(lo, hi);

  function preview(m) {
    if (!m) return null;
    if (m.type === 'call') return (CALLS[m.kind] || {}).verb || 'зов';
    return m.text;
  }

  // ---------- Список, заявки, ссылка ----------
  route('GET', '/api/crew', async (req) => {
    const u = requireUser(req);
    const rows = q(`SELECT c.*, u.id AS uid, u.nick, u.look, u.profile, u.share_office FROM crew c
                    JOIN users u ON u.id = CASE WHEN c.lo = ? THEN c.hi ELSE c.lo END
                    WHERE (c.lo = ? OR c.hi = ?) AND u.nick IS NOT NULL`).all(u.id, u.id, u.id);
    const list = [];
    const incoming = [];
    const outgoing = [];
    for (const r of rows) {
      const person = { id: r.uid, nick: r.nick, look: { ...JSON.parse(r.look || '{}') } };
      if (r.status === 'pending') {
        if (r.from_id === u.id) outgoing.push({ ...person, at: r.at });
        else if (!blocked(u.id, r.uid)) incoming.push({ ...person, at: r.at });
        continue;
      }
      const st = memberStatus({ id: r.uid, nick: r.nick, look: r.look, profile: r.profile, share_office: r.share_office });
      const last = q('SELECT * FROM dms WHERE lo = ? AND hi = ? AND hidden = 0 ORDER BY at DESC LIMIT 1').get(r.lo, r.hi);
      const un = q('SELECT COUNT(*) AS n FROM dms WHERE lo = ? AND hi = ? AND to_id = ? AND read_at IS NULL AND hidden = 0').get(r.lo, r.hi, u.id).n;
      list.push({
        ...st, unread: un, lastAt: last ? last.at : r.at, lastTime: last ? U.msk(last.at).hhmm : null,
        last: last ? { mine: last.from_id === u.id, text: preview(last) } : null
      });
    }
    list.sort((a, b) => b.unread - a.unread || b.lastAt - a.lastAt);
    const blockedList = q('SELECT u.id, u.nick FROM crew_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.at DESC').all(u.id);
    return {
      list, incoming, outgoing, blocked: blockedList, max: MAX_CREW, ttlDays: DM_TTL_DAYS,
      calls: DM_CALLS, link: `${config.baseUrl}/p/${codeOf(u.id)}`
    };
  });

  // Позвать в подельники: по нику, по личной ссылке или по id (из банды)
  route('POST', '/api/crew/add', async (req, body) => {
    const u = requireUser(req);
    let target = null;
    let viaLink = false;
    if (body.code) {
      viaLink = true;
      const m = /([A-Z2-9]{6})\s*$/i.exec(String(body.code).trim());
      const row = m && q('SELECT user_id FROM crew_codes WHERE code = ?').get(m[1].toUpperCase());
      if (!row) throw bad('Ссылка не найдена. Попроси прислать её ещё раз.');
      target = userRow(row.user_id);
    } else if (body.nick) {
      // Ники хранятся с «@». COLLATE NOCASE в SQLite не понимает кириллицу, поэтому сверяем в JS
      const nick = '@' + U.cleanText(body.nick, 40).replace(/^@+/, '');
      target = q('SELECT * FROM users WHERE nick = ?').get(nick);
      if (!target) {
        const low = nick.toLocaleLowerCase('ru');
        const hit = q('SELECT id, nick FROM users WHERE nick IS NOT NULL AND length(nick) = ?').all(nick.length).find((x) => x.nick.toLocaleLowerCase('ru') === low);
        target = hit ? userRow(hit.id) : null;
      }
      if (!target) throw bad('Нет такого ника. Проверь написание или попроси личную ссылку.');
    } else if (body.id) {
      target = userRow(Number(body.id));
    }
    if (!target) throw bad('Человек не найден.');
    if (target.id === u.id) throw bad('Себя в подельники не берут.');
    if (blocked(u.id, target.id)) throw bad('Ты его заблокировал. Сначала разблокируй в списке подельников.');

    const l = link(u.id, target.id);
    if (l && l.status === 'ok') return { ok: true, already: true, id: target.id };
    // Встречная заявка — значит, оба хотят: сразу подельники
    if (l && l.status === 'pending' && l.from_id === target.id) {
      if (crewCount(u.id) >= MAX_CREW) throw bad(`Больше ${MAX_CREW} подельников не бывает. Кого-то придётся отпустить.`);
      q("UPDATE crew SET status = 'ok', at = ? WHERE lo = ? AND hi = ?").run(U.now(), l.lo, l.hi);
      fireAndForget(notify([target.id], { title: 'Новый подельник', body: `${u.nick} принял заявку`, url: `/#crew/${u.id}`, tag: `crew-${u.id}` }));
      return { ok: true, accepted: true, id: target.id };
    }
    // Личную ссылку человек отправил сам — это и есть согласие, заявку подтверждать не нужно
    if (viaLink && !blocked(target.id, u.id)) {
      if (crewCount(u.id) >= MAX_CREW || crewCount(target.id) >= MAX_CREW) throw bad(`У кого-то из вас уже ${MAX_CREW} подельников.`);
      if (l) q("UPDATE crew SET status = 'ok', at = ? WHERE lo = ? AND hi = ?").run(U.now(), l.lo, l.hi);
      else q('INSERT INTO crew (lo, hi, from_id, status, at) VALUES (?, ?, ?, ?, ?)').run(...pair(u.id, target.id), u.id, 'ok', U.now());
      fireAndForget(notify([target.id], { title: 'Новый подельник', body: `${u.nick} пришёл по твоей ссылке`, url: `/#crew/${u.id}`, tag: `crew-${u.id}` }));
      return { ok: true, accepted: true, id: target.id };
    }
    if (l && l.status === 'pending') return { ok: true, pending: true };
    if (crewCount(u.id) >= MAX_CREW) throw bad(`Больше ${MAX_CREW} подельников не бывает. Кого-то придётся отпустить.`);
    const day = U.now() - 864e5;
    if (q("SELECT COUNT(*) AS n FROM crew WHERE from_id = ? AND at > ?").get(u.id, day).n >= REQUESTS_PER_DAY) throw bad('На сегодня заявок хватит. Завтра продолжишь.');
    // Если нас заблокировали, заявка сохраняется и видна отправителю как обычная, но получатель её не видит:
    // заблокированный не должен узнать о блоке
    q('INSERT INTO crew (lo, hi, from_id, status, at) VALUES (?, ?, ?, ?, ?)').run(...pair(u.id, target.id), u.id, 'pending', U.now());
    if (blocked(target.id, u.id)) return { ok: true, pending: true };
    fireAndForget(notify([target.id], { title: 'Заявка в подельники', body: `${u.nick} зовёт в подельники`, url: '/#crew', tag: `crew-req-${u.id}` }));
    return { ok: true, pending: true };
  });

  route('POST', '/api/crew/:id/accept', async (req, body, query, params) => {
    const u = requireUser(req);
    const l = link(u.id, Number(params.id));
    if (!l || l.status !== 'pending' || l.from_id === u.id || blocked(u.id, l.from_id)) throw bad('Заявки нет.');
    if (crewCount(u.id) >= MAX_CREW) throw bad(`Больше ${MAX_CREW} подельников не бывает. Кого-то придётся отпустить.`);
    q("UPDATE crew SET status = 'ok', at = ? WHERE lo = ? AND hi = ?").run(U.now(), l.lo, l.hi);
    fireAndForget(notify([l.from_id], { title: 'Новый подельник', body: `${u.nick} принял заявку`, url: `/#crew/${u.id}`, tag: `crew-${u.id}` }));
    return { ok: true };
  });

  // Отклонить входящую, отменить исходящую или отпустить подельника — переписка удаляется у обоих
  route('POST', '/api/crew/:id/remove', async (req, body, query, params) => {
    const u = requireUser(req);
    const [lo, hi] = pair(u.id, Number(params.id));
    q('DELETE FROM crew WHERE lo = ? AND hi = ?').run(lo, hi);
    dropChat(lo, hi);
    return { ok: true };
  });

  route('POST', '/api/crew/:id/block', async (req, body, query, params) => {
    const u = requireUser(req);
    const t = userRow(Number(params.id));
    if (!t || t.id === u.id) throw bad('Человек не найден.');
    const [lo, hi] = pair(u.id, t.id);
    q('DELETE FROM crew WHERE lo = ? AND hi = ?').run(lo, hi);
    dropChat(lo, hi);
    q('INSERT OR IGNORE INTO crew_blocks (user_id, blocked_id, at) VALUES (?, ?, ?)').run(u.id, t.id, U.now());
    return { ok: true };
  });

  route('POST', '/api/crew/:id/unblock', async (req, body, query, params) => {
    const u = requireUser(req);
    q('DELETE FROM crew_blocks WHERE user_id = ? AND blocked_id = ?').run(u.id, Number(params.id));
    return { ok: true };
  });

  // ---------- Переписка ----------
  route('GET', '/api/crew/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    const f = friendOr404(u, params.id);
    const [lo, hi] = pair(u.id, f.id);
    const msgs = q('SELECT * FROM dms WHERE lo = ? AND hi = ? AND hidden = 0 AND at > ? ORDER BY at ASC LIMIT 300')
      .all(lo, hi, U.now() - DM_TTL_DAYS * 864e5);
    q('UPDATE dms SET read_at = ? WHERE lo = ? AND hi = ? AND to_id = ? AND read_at IS NULL').run(U.now(), lo, hi, u.id);
    const today = U.msk().day;
    return {
      friend: memberStatus(f),
      ttlDays: DM_TTL_DAYS,
      calls: DM_CALLS,
      messages: msgs.map((m) => {
        const mine = m.from_id === u.id;
        const def = m.type === 'call' ? CALLS[m.kind] : null;
        const d = U.msk(m.at);
        return {
          id: m.id, type: m.type, kind: m.kind, mine, at: m.at,
          time: d.day === today ? d.hhmm : `${d.day.slice(8, 10)}.${d.day.slice(5, 7)} ${d.hhmm}`,
          text: m.text, opt: m.opt, callText: def ? def.verb : null, reply: m.reply,
          read: mine ? !!m.read_at : undefined,
          canReply: !!def && !mine && !m.reply, replyOptions: def && !mine && !m.reply ? def.replies : []
        };
      })
    };
  });

  route('POST', '/api/crew/:id/messages', async (req, body, query, params) => {
    const u = requireUser(req);
    const f = friendOr404(u, params.id);
    if (blocked(f.id, u.id)) throw bad('Сообщение не доставлено.');
    rateLimit('dm:' + u.id, 30, 60e3);
    const [lo, hi] = pair(u.id, f.id);
    const ins = q('INSERT INTO dms (lo, hi, from_id, to_id, type, kind, opt, text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    if (body.type === 'text') {
      const text = U.cleanText(body.text, 500);
      if (!text) throw bad('Пустое сообщение.');
      const prob = U.moderationProblem(text, { allowAt: true });
      if (prob) throw bad(prob);
      ins.run(lo, hi, u.id, f.id, 'text', null, null, text, U.now());
      // Текст в пуш не кладём: уведомление видно на заблокированном экране
      fireAndForget(notify([f.id], { title: u.nick, body: 'Личное сообщение', url: `/#crew/${u.id}`, tag: `dm-${u.id}` }));
      return { ok: true };
    }
    const def = CALLS[body.kind];
    if (body.type !== 'call' || !def || !DM_CALLS.includes(body.kind)) throw bad('Неизвестный тип сообщения.');
    if (q("SELECT COUNT(*) AS n FROM dms WHERE from_id = ? AND to_id = ? AND type = 'call' AND at > ?").get(u.id, f.id, U.now() - 3600e3).n >= 5) {
      throw bad('Не больше 5 зовов в час одному подельнику.');
    }
    const opt = def.opts.includes(body.opt) ? body.opt : def.opts[0] || null;
    let text = null;
    if (def.needsText) {
      text = U.cleanText(body.text, 40);
      if (!text) throw bad('Укажи, какая переговорка.');
      const prob = U.moderationProblem(text);
      if (prob) throw bad(prob);
    }
    ins.run(lo, hi, u.id, f.id, 'call', body.kind, opt, text, U.now());
    fireAndForget(notify([f.id], { title: u.nick, body: `${def.verb}${opt ? ' · ' + opt.toLowerCase() : ''}`, url: `/#crew/${u.id}`, tag: `dm-${u.id}` }));
    return { ok: true, quiet: U.isQuietHour() };
  });

  route('POST', '/api/dm/:id/reply', async (req, body, query, params) => {
    const u = requireUser(req);
    const m = q("SELECT * FROM dms WHERE id = ? AND type = 'call' AND hidden = 0").get(Number(params.id));
    if (!m || m.to_id !== u.id || !areCrew(m.from_id, u.id)) throw bad('Зов не найден.');
    if (m.reply) throw bad('Ты уже ответил.');
    const def = CALLS[m.kind];
    if (!def || !def.replies.includes(body.label)) throw bad('Неизвестный ответ.');
    q('UPDATE dms SET reply = ?, reply_at = ? WHERE id = ?').run(body.label, U.now(), m.id);
    fireAndForget(notify([m.from_id], { title: u.nick, body: `Ответ: ${body.label}`, url: `/#crew/${u.id}`, tag: `dm-${u.id}` }));
    return { ok: true };
  });

  function cleanup() {
    const t = U.now();
    // Сообщения с открытой жалобой ждут модератора, остальные удаляются по сроку
    q(`DELETE FROM dms WHERE at < ? AND id NOT IN (SELECT object_id FROM reports WHERE object_type = 'dm' AND status = 'open')`).run(t - DM_TTL_DAYS * 864e5);
    q("DELETE FROM crew WHERE status = 'pending' AND at < ?").run(t - PENDING_TTL_DAYS * 864e5);
  }

  return { unread, cleanup, codeOf };
}

module.exports = { register, DM_TTL_DAYS };
