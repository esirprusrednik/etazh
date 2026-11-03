// Личка и подельники.
// Писать лично можно любому, если он сам не ограничил: в профиле «Кто может писать мне» — всем, банде или никому.
// Подельники — избранные контакты (взаимно: заявка → принять или личная ссылка). Им можно писать всегда, кроме блока.
// Любую переписку можно закрыть крестиком: она удаляется у обоих, у собеседника остаётся «собеседник закрыл личку»,
// и написать он не сможет, пока закрывший не напишет сам. Переписка и зовы видны только двоим.
// Модератор видит личное сообщение, только если получатель на него пожаловался.
// Подключается из api.js через register(ctx), как features.js.
const { CALLS, MEMES, MEME_EMOS } = require('./catalog');

const DM_TTL_DAYS = 7;          // сколько живут личные сообщения
const MAX_CREW = 50;            // подельников у одного человека
const REQUESTS_PER_DAY = 20;    // заявок в день — защита от спама
const PENDING_TTL_DAYS = 30;    // неотвеченная заявка сгорает
const DM_CALLS = ['coffee', 'lunch', 'call', 'where', 'online', 'wait', 'room']; // «Домой — кто с ним?» в личке не нужен

function register(ctx) {
  const { db, q, route, requireUser, bad, U, config, notify, fireAndForget, rateLimit, memberStatus, HttpError, publicLook, onEvent, pollsUnvoted, addBeans, gangSummary, voice } = ctx;

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

  -- Закрытая личка: by_id закрыл переписку с other_id. dismissed — other_id убрал уведомление из списка
  CREATE TABLE IF NOT EXISTS dm_closed (
    by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    other_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (by_id, other_id)
  );
  `);

  const pair = (a, b) => (a < b ? [a, b] : [b, a]);
  const link = (a, b) => q('SELECT * FROM crew WHERE lo = ? AND hi = ?').get(...pair(a, b)) || null;
  const areCrew = (a, b) => { const l = link(a, b); return !!l && l.status === 'ok'; };
  // Участники общей банды могут писать друг другу лично без заявки
  const shareGang = (a, b) => !!q(`SELECT 1 FROM gang_members x JOIN gang_members y ON x.gang_id = y.gang_id JOIN gangs g ON g.id = x.gang_id
                                   WHERE x.user_id = ? AND y.user_id = ? AND g.hidden = 0`).get(a, b);
  const dmPolicy = (row) => { try { return JSON.parse(row.profile || '{}').dmFrom || 'all'; } catch { return 'all'; } };
  const closedBy = (by, other) => !!q('SELECT 1 FROM dm_closed WHERE by_id = ? AND other_id = ?').get(by, other);
  const hasThread = (a, b) => !!q('SELECT 1 FROM dms WHERE lo = ? AND hi = ? AND hidden = 0 LIMIT 1').get(...pair(a, b));
  // Может ли a написать b. Возвращает null или причину отказа — её покажем вместо поля ввода
  function writeBlock(a, b) {
    if (closedBy(b.id, a.id)) return 'Собеседник закрыл личку. Написать получится, когда он сам напишет.';
    if (blocked(b.id, a.id)) return null; // о блоке не говорим: сообщение «уйдёт», но не дойдёт
    if (areCrew(a.id, b.id)) return null;
    const pol = dmPolicy(b);
    if (pol === 'all') return null;
    if (pol === 'gang' && shareGang(a.id, b.id)) return null;
    // Начатую переписку не обрываем: ограничение — только для новых
    if (hasThread(a.id, b.id)) return null;
    return pol === 'gang' ? `${b.nick} принимает личку только от своей банды и подельников.` : `${b.nick} принимает личку только от подельников.`;
  }
  const canTalk = (a, b) => areCrew(a, b) || shareGang(a, b);
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
    if (!f || f.id === u.id) throw new HttpError(404, 'Пользователь не найден.');
    return f;
  }
  // Кто не в банде и не подельник, видит в шапке переписки только ник и аватар — где он, не видно
  const headerOf = (u, f) => (canTalk(u.id, f.id) ? memberStatus(f) : { id: f.id, nick: f.nick, look: publicLook(f), where: null });

  // Переписку удаляем у обоих, кроме сообщений с открытой жалобой: их ещё должен увидеть модератор
  // Оставленные для модератора помечаем hidden = 2: собеседники их больше не видят
  const dropChat = (lo, hi) => {
    q(`DELETE FROM dms WHERE lo = ? AND hi = ?
      AND id NOT IN (SELECT object_id FROM reports WHERE object_type = 'dm' AND status = 'open')`).run(lo, hi);
    q('UPDATE dms SET hidden = 2 WHERE lo = ? AND hi = ? AND hidden = 0').run(lo, hi);
  };

  function preview(m) {
    if (!m) return null;
    if (m.type === 'call') return (CALLS[m.kind] || {}).verb || 'зов';
    if (m.type === 'voice') return `Голосовое 0:${String(m.opt || 0).padStart(2, '0')}`;
    if (m.type === 'meme') return 'мем: «' + ((MEMES.find((x) => x.id === m.kind) || {}).caption || '') + '»';
    return m.text;
  }

  // ---------- Мои люди: все из моих банд и подельники, одним списком ----------
  function myPeople(uid) {
    const map = new Map();
    const gangRows = q(`SELECT u.*, g.id AS gid, g.name AS gname FROM gang_members me JOIN gang_members m ON m.gang_id = me.gang_id
                        JOIN gangs g ON g.id = me.gang_id JOIN users u ON u.id = m.user_id
                        WHERE me.user_id = ? AND m.user_id != ? AND g.hidden = 0 AND u.nick IS NOT NULL`).all(uid, uid);
    for (const r of gangRows) {
      const p = map.get(r.id) || { row: r, gangs: [], crew: false };
      p.gangs.push({ id: r.gid, name: r.gname });
      map.set(r.id, p);
    }
    const crewRows = q(`SELECT u.* FROM crew c JOIN users u ON u.id = CASE WHEN c.lo = ? THEN c.hi ELSE c.lo END
                        WHERE (c.lo = ? OR c.hi = ?) AND c.status = 'ok' AND u.nick IS NOT NULL`).all(uid, uid, uid);
    for (const r of crewRows) { const p = map.get(r.id) || { row: r, gangs: [], crew: false }; p.crew = true; map.set(r.id, p); }
    for (const id of map.keys()) if (blocked(uid, id)) map.delete(id);
    return map;
  }

  route('GET', '/api/people', async (req) => {
    const u = requireUser(req);
    const people = [...myPeople(u.id).values()].map(({ row, gangs, crew }) => {
      const [lo, hi] = pair(u.id, row.id);
      const unreadN = q('SELECT COUNT(*) AS n FROM dms WHERE lo = ? AND hi = ? AND to_id = ? AND read_at IS NULL AND hidden = 0').get(lo, hi, u.id).n;
      return { ...memberStatus(row), gangs, crew, unread: unreadN };
    });
    return { people };
  });

  // ---------- Чаты: банды и личные переписки в одном списке ----------
  route('GET', '/api/chats', async (req) => {
    const u = requireUser(req);
    const items = [];
    const gangs = q(`SELECT g.* FROM gangs g JOIN gang_members m ON m.gang_id = g.id WHERE m.user_id = ? AND g.hidden = 0 ORDER BY m.joined_at`).all(u.id);
    for (const g of gangs) {
      const last = q('SELECT m.*, u.nick FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.gang_id = ? AND m.hidden = 0 ORDER BY m.at DESC LIMIT 1').get(g.id);
      const n = q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(g.id).n;
      items.push({
        type: 'gang', id: g.id, name: g.name, color: g.color, emoji: g.emoji || null, ...U.crestPub(g), members: n, lastAt: last ? last.at : g.created_at || 0,
        polls: pollsUnvoted ? pollsUnvoted(u.id, g.id) : 0,
        ...(gangSummary ? gangSummary(g.id, u.id) : {}), motto: g.motto || '',
        lastTime: last ? U.msk(last.at).hhmm : null,
        last: last ? { mine: last.user_id === u.id, who: last.nick, text: last.type === 'call' ? (CALLS[last.kind] || {}).verb || 'зов' : last.type === 'voice' || last.type === 'meme' ? preview(last) : last.text } : null
      });
    }
    const people = myPeople(u.id);
    // Переписки: со всеми, с кем есть сообщения. Подельники — отдельной полосой «избранных»
    const threads = q(`SELECT CASE WHEN lo = ? THEN hi ELSE lo END AS other, MAX(at) AS at FROM dms WHERE (lo = ? OR hi = ?) AND hidden = 0 GROUP BY other`).all(u.id, u.id, u.id);
    for (const t of threads) {
      const row = userRow(t.other);
      if (!row || blocked(u.id, row.id)) continue;
      const p = people.get(row.id);
      const [lo, hi] = pair(u.id, row.id);
      const last = q('SELECT * FROM dms WHERE lo = ? AND hi = ? AND hidden = 0 ORDER BY at DESC LIMIT 1').get(lo, hi);
      const un = q('SELECT COUNT(*) AS n FROM dms WHERE lo = ? AND hi = ? AND to_id = ? AND read_at IS NULL AND hidden = 0').get(lo, hi, u.id).n;
      const st = headerOf(u, row);
      items.push({
        type: 'dm', id: row.id, nick: st.nick, look: st.look, where: st.where, office: st.office, until: st.until, crew: !!(p && p.crew),
        unread: un, lastAt: last ? last.at : 0, lastTime: last ? U.msk(last.at).hhmm : null,
        last: last ? { mine: last.from_id === u.id, text: preview(last) } : null
      });
    }
    // Кто закрыл со мной личку — показываем строкой «собеседник закрыл личку», пока я её не уберу
    for (const c of q('SELECT * FROM dm_closed WHERE other_id = ? AND dismissed = 0').all(u.id)) {
      const row = userRow(c.by_id);
      if (!row || items.some((x) => x.type === 'dm' && x.id === row.id)) continue;
      items.push({ type: 'dm', id: row.id, nick: row.nick, look: publicLook(row), where: null, closed: true, crew: areCrew(u.id, row.id), unread: 0, lastAt: c.at, lastTime: U.msk(c.at).hhmm, last: { mine: false, text: 'Собеседник закрыл личку' } });
    }
    const favorites = [...people.values()].filter((p) => p.crew).map((p) => {
      const st = memberStatus(p.row);
      return { id: st.id, nick: st.nick, look: st.look, where: st.where, office: st.office, until: st.until };
    }).sort((a, b) => a.nick.localeCompare(b.nick, 'ru'));
    items.sort((a, b) => (b.unread || 0) - (a.unread || 0) || b.lastAt - a.lastAt);
    const requests = q(`SELECT u.id, u.nick, u.look, u.profile, u.share_office FROM crew c JOIN users u ON u.id = c.from_id
                        WHERE (c.lo = ? OR c.hi = ?) AND c.status = 'pending' AND c.from_id != ?`).all(u.id, u.id, u.id)
      .filter((r) => !blocked(u.id, r.id)).map((r) => ({ id: r.id, nick: r.nick, look: publicLook(r) }));
    return { items, requests, favorites, dmFrom: dmPolicy(q('SELECT profile FROM users WHERE id = ?').get(u.id)) };
  });

  // Закрыть личку крестиком: переписка удаляется у обоих, собеседник видит, что её закрыли.
  // Если личку уже закрыл собеседник — крестик просто убирает уведомление из списка
  route('POST', '/api/dm/:id/close', async (req, body, query, params) => {
    const u = requireUser(req);
    const other = Number(params.id);
    if (closedBy(other, u.id)) {
      q('UPDATE dm_closed SET dismissed = 1 WHERE by_id = ? AND other_id = ?').run(other, u.id);
      return { ok: true, dismissed: true };
    }
    if (!userRow(other)) throw bad('Пользователь не найден.');
    const [lo, hi] = pair(u.id, other);
    dropChat(lo, hi);
    q('INSERT OR REPLACE INTO dm_closed (by_id, other_id, at, dismissed) VALUES (?, ?, ?, 0)').run(u.id, other, U.now());
    return { ok: true, closed: true };
  });

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
      const person = { id: r.uid, nick: r.nick, look: publicLook({ id: r.uid, look: r.look, profile: r.profile, share_office: r.share_office }) };
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
      // Ники хранятся без «@», но человек может его вписать. COLLATE NOCASE не понимает кириллицу — сверяем в JS
      const nick = U.cleanText(body.nick, 40).replace(/^@+/, '');
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
    if (blocked(u.id, target.id)) throw bad('Этот человек у тебя в блоке. Сначала разблокируй его в списке.');

    const l = link(u.id, target.id);
    if (l && l.status === 'ok') return { ok: true, already: true, id: target.id };
    // Встречная заявка — значит, оба хотят: сразу подельники
    if (l && l.status === 'pending' && l.from_id === target.id) {
      if (crewCount(u.id) >= MAX_CREW) throw bad(`Больше ${MAX_CREW} подельников не бывает. Кого-то придётся отпустить.`);
      q("UPDATE crew SET status = 'ok', at = ? WHERE lo = ? AND hi = ?").run(U.now(), l.lo, l.hi);
      fireAndForget(notify([target.id], { title: 'Новый подельник', body: `${u.nick} ${U.g(u.look, 'принял', 'приняла')} заявку`, url: `/#crew/${u.id}`, tag: `crew-${u.id}` }));
      return { ok: true, accepted: true, id: target.id };
    }
    // Личную ссылку человек отправил сам — это и есть согласие, заявку подтверждать не нужно
    if (viaLink && !blocked(target.id, u.id)) {
      if (crewCount(u.id) >= MAX_CREW || crewCount(target.id) >= MAX_CREW) throw bad(`У кого-то из вас уже ${MAX_CREW} подельников.`);
      if (l) q("UPDATE crew SET status = 'ok', at = ? WHERE lo = ? AND hi = ?").run(U.now(), l.lo, l.hi);
      else q('INSERT INTO crew (lo, hi, from_id, status, at) VALUES (?, ?, ?, ?, ?)').run(...pair(u.id, target.id), u.id, 'ok', U.now());
      // Позвал нового человека в Этаж — +15 зёрен пригласившему (один раз за каждого новичка)
      let bonus = 0;
      const fresh = q('SELECT created_at FROM users WHERE id = ?').get(u.id);
      if (addBeans && fresh && U.now() - fresh.created_at < 2 * 864e5 && !q('SELECT 1 FROM ledger WHERE user_id = ? AND reason = ?').get(target.id, 'referral:' + u.id)) {
        bonus = addBeans(target.id, 'referral:' + u.id, 15) || 0;
      }
      fireAndForget(notify([target.id], { title: bonus ? `+${bonus} зёрен за приглашение` : 'Новый контакт', body: `${u.nick} ${U.g(u.look, 'пришёл', 'пришла')} по твоей ссылке${bonus ? ' — добро пожаловать в Этаж!' : ''}`, url: `/#crew/${u.id}`, tag: `crew-${u.id}` }));
      return { ok: true, accepted: true, id: target.id, inviter: target.nick };
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
    fireAndForget(notify([l.from_id], { title: 'Новый подельник', body: `${u.nick} ${U.g(u.look, 'принял', 'приняла')} заявку`, url: `/#crew/${u.id}`, tag: `crew-${u.id}` }));
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
    if (blocked(u.id, f.id)) throw new HttpError(404, 'Этот человек у тебя в блоке.');
    const [lo, hi] = pair(u.id, f.id);
    const crewLink = link(u.id, f.id);
    const msgs = q('SELECT * FROM dms WHERE lo = ? AND hi = ? AND hidden = 0 AND at > ? ORDER BY at ASC LIMIT 300')
      .all(lo, hi, U.now() - DM_TTL_DAYS * 864e5);
    q('UPDATE dms SET read_at = ? WHERE lo = ? AND hi = ? AND to_id = ? AND read_at IS NULL').run(U.now(), lo, hi, u.id);
    const today = U.msk().day;
    return {
      friend: { ...headerOf(u, f), crew: !!crewLink && crewLink.status === 'ok' },
      crewState: !crewLink ? 'none' : crewLink.status === 'ok' ? 'ok' : crewLink.from_id === u.id ? 'sent' : 'incoming',
      closedByOther: closedBy(f.id, u.id), closedByMe: closedBy(u.id, f.id),
      cantWrite: writeBlock(u, f),
      ttlDays: DM_TTL_DAYS,
      calls: DM_CALLS,
      messages: msgs.map((m) => {
        const mine = m.from_id === u.id;
        const def = m.type === 'call' ? CALLS[m.kind] : null;
        const d = U.msk(m.at);
        return {
          id: m.id, type: m.type, kind: m.kind, mine, at: m.at,
          time: d.day === today ? d.hhmm : `${d.day.slice(8, 10)}.${d.day.slice(5, 7)} ${d.hhmm}`,
          text: m.type === 'meme' || m.type === 'voice' ? null : m.text, look: m.type === 'meme' ? JSON.parse(m.text || '{}') : undefined,
          opt: m.opt, callText: def ? def.verb : null, reply: m.reply,
          voice: m.type === 'voice' ? { dur: Number(m.opt), ...(voice.info(m.text) || { gone: true }) } : undefined,
          read: mine ? !!m.read_at : undefined,
          canReply: !!def && !mine && !m.reply, replyOptions: def && !mine && !m.reply ? def.replies : []
        };
      })
    };
  });

  route('POST', '/api/crew/:id/messages', async (req, body, query, params) => {
    const u = requireUser(req);
    const f = friendOr404(u, params.id);
    if (blocked(u.id, f.id)) throw bad('Этот человек у тебя в блоке. Сначала разблокируй его.');
    const why = writeBlock(u, f);
    if (why) throw bad(why);
    if (blocked(f.id, u.id)) throw bad('Сообщение не доставлено.');
    rateLimit('dm:' + u.id, 30, 60e3);
    // Сам закрыл личку и пишешь снова — значит, открыл её обратно
    q('DELETE FROM dm_closed WHERE by_id = ? AND other_id = ?').run(u.id, f.id);
    const [lo, hi] = pair(u.id, f.id);
    const ins = q('INSERT INTO dms (lo, hi, from_id, to_id, type, kind, opt, text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    if (body.type === 'voice') {
      const v = voice.store(u.id, { lo, hi }, body);
      ins.run(lo, hi, u.id, f.id, 'voice', null, String(v.dur), v.token, U.now());
      if (onEvent) onEvent('dm', u.id, { to: f.id });
      fireAndForget(notify([f.id], { title: u.nick, body: 'Голосовое сообщение', url: `/#crew/${u.id}`, tag: `dm-${u.id}` }));
      return { ok: true };
    }
    if (body.type === 'text') {
      const text = U.cleanText(body.text, 500);
      if (!text) throw bad('Пустое сообщение.');
      const prob = U.moderationProblem(text, { allowAt: true });
      if (prob) throw bad(prob);
      ins.run(lo, hi, u.id, f.id, 'text', null, null, text, U.now());
      if (onEvent) onEvent('dm', u.id, { to: f.id });
      // Текст в пуш не кладём: уведомление видно на заблокированном экране
      fireAndForget(notify([f.id], { title: u.nick, body: 'Личное сообщение', url: `/#crew/${u.id}`, tag: `dm-${u.id}` }));
      return { ok: true };
    }
    // Мем-открытка: аватар отправителя (как он есть сейчас), ситуация и эмоция из списка
    if (body.type === 'meme') {
      if (!MEMES.some((x) => x.id === body.kind && require('./seasons').seasonOn(x.season, U.msk().day)) || !MEME_EMOS[body.opt]) throw bad('Выбери ситуацию и эмоцию из списка.');
      if (q("SELECT COUNT(*) AS n FROM dms WHERE from_id = ? AND to_id = ? AND type = 'meme' AND at > ?").get(u.id, f.id, U.now() - 3600e3).n >= 10) {
        throw bad('Не больше 10 мемов в час одному человеку.');
      }
      ins.run(lo, hi, u.id, f.id, 'meme', body.kind, body.opt, JSON.stringify(u.look || {}), U.now());
      if (onEvent) onEvent('meme', u.id, { to: f.id });
      fireAndForget(notify([f.id], { title: u.nick, body: 'Прислал мем-открытку', url: `/#crew/${u.id}`, tag: `dm-${u.id}` }));
      return { ok: true };
    }
    const def = CALLS[body.kind];
    if (body.type !== 'call' || !def || !DM_CALLS.includes(body.kind)) throw bad('Неизвестный тип сообщения.');
    if (q("SELECT COUNT(*) AS n FROM dms WHERE from_id = ? AND to_id = ? AND type = 'call' AND at > ?").get(u.id, f.id, U.now() - 3600e3).n >= 5) {
      throw bad('Не больше 5 зовов в час одному человеку.');
    }
    const opt = def.opts.includes(body.opt) ? body.opt : def.opts[0] || null;
    let text = null;
    if (def.needsText || def.textLabel) {
      text = U.cleanText(body.text, 40) || null;
      if (def.needsText && !text) throw bad('Заполни поле.');
      const prob = text && U.moderationProblem(text);
      if (prob) throw bad(prob);
    }
    ins.run(lo, hi, u.id, f.id, 'call', body.kind, opt, text, U.now());
    if (onEvent) onEvent('dm', u.id, { to: f.id, call: true });
    fireAndForget(notify([f.id], { title: u.nick, body: `${def.verb}${opt ? ' · ' + opt.toLowerCase() : ''}`, url: `/#crew/${u.id}`, tag: `dm-${u.id}` }));
    return { ok: true, quiet: U.isQuietHour() };
  });

  route('POST', '/api/dm/:id/reply', async (req, body, query, params) => {
    const u = requireUser(req);
    const m = q("SELECT * FROM dms WHERE id = ? AND type = 'call' AND hidden = 0").get(Number(params.id));
    if (!m || m.to_id !== u.id || closedBy(m.from_id, u.id) || blocked(m.from_id, u.id)) throw bad('Зов не найден.');
    if (m.reply) throw bad(U.g(u.look, 'Ты уже ответил.', 'Ты уже ответила.'));
    const def = CALLS[m.kind];
    if (!def || !def.replies.includes(body.label)) throw bad('Неизвестный ответ.');
    q('UPDATE dms SET reply = ?, reply_at = ? WHERE id = ?').run(body.label, U.now(), m.id);
    if (onEvent) onEvent('dm_reply', u.id);
    fireAndForget(notify([m.from_id], { title: u.nick, body: `Ответ: ${body.label}`, url: `/#crew/${u.id}`, tag: `dm-${u.id}` }));
    return { ok: true };
  });

  function cleanup() {
    const t = U.now();
    // Сообщения с открытой жалобой ждут модератора, остальные удаляются по сроку
    q(`DELETE FROM dms WHERE at < ? AND id NOT IN (SELECT object_id FROM reports WHERE object_type = 'dm' AND status = 'open')`).run(t - DM_TTL_DAYS * 864e5);
    q("DELETE FROM crew WHERE status = 'pending' AND at < ?").run(t - PENDING_TTL_DAYS * 864e5);
  }

  return { unread, cleanup, codeOf, canDm: (u, t) => !blocked(u.id, t.id) && !writeBlock(u, t) };
}

module.exports = { register, DM_TTL_DAYS };
