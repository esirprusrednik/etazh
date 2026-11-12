// Доска объявлений на весь «Этаж»: «ищу компанию на обед», «отдам билеты», «кто едет на конференцию», «нашёл зонт».
// Объявление живёт до даты, которую выбрал автор (не дольше двух недель), и само исчезает.
// «Я тоже» — отметка интереса: автору приходит пуш (один раз на человека), дальше общение в личке.
// Кому: весь Этаж, только свой офис или только своя банда — объявление банды видят только её участники.

// «Обед» и «На кухне» — короткие: обед висит до часа после назначенного времени и снимается сам, когда автор
// отметил в столовой «Поел» или ушёл из офиса; угощение на кухне — ровно час, за это время его обычно разбирают.
const KINDS = {
  lunch: { name: 'Обед', icon: 'lunch', short: true },
  kitchen: { name: 'На кухне', icon: 'gift', short: true },
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
const HOUR = 60 * 60e3;
// Время обеда: с 11:00 до 16:00 с шагом 15 минут, прошедшее — не предлагаем
const LUNCH_FROM = 11 * 60, LUNCH_TO = 16 * 60;

function register(ctx) {
  const { db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, rateLimit, officeById, publicLook, fullName, isMember, gangMembers, onEvent } = ctx;

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
  for (const col of ['gang_id INTEGER', 'expires_at INTEGER', 'lunch_time TEXT', 'place TEXT']) { try { db.exec(`ALTER TABLE board_posts ADD COLUMN ${col}`); } catch {} }
  const kitchenPinged = new Map(); // кому и когда последний раз приходил пуш про кухню
  const canSee = (p, uid) => !p.gang_id || (isMember && isMember(p.gang_id, uid));

  const today = () => U.msk().day;
  const nowMin = () => { const m = U.msk(); return m.hour * 60 + m.minute; };
  const hm = (t) => { const [h, mi] = String(t).split(':').map(Number); return h * 60 + mi; };
  function lunchTimes() {
    const out = []; const from = Math.max(LUNCH_FROM, Math.ceil((nowMin() + 5) / 15) * 15);
    for (let t = from; t <= LUNCH_TO; t += 15) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    return out;
  }
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  function view(p, uid) {
    const who = q('SELECT nick, look, profile FROM users WHERE id = ?').get(p.user_id) || { nick: 'удалённый аккаунт', look: '{}', profile: '{}' };
    const wp = (() => { try { return JSON.parse(who.profile || '{}'); } catch { return {}; } })();
    const me = q('SELECT 1 FROM board_metoo WHERE post_id = ? AND user_id = ?').get(p.id, uid);
    // У обеда список идущих видят все — как в «Обеде компанией»; у остальных — только автор
    const fans = p.user_id === uid || p.kind === 'lunch' ? q('SELECT u.id, u.nick FROM board_metoo m JOIN users u ON u.id = m.user_id WHERE m.post_id = ? ORDER BY m.at').all(p.id) : null;
    const o = p.office_id ? officeById(p.office_id) : null;
    const g = p.gang_id ? q('SELECT id, name FROM gangs WHERE id = ?').get(p.gang_id) : null;
    return {
      id: p.id, kind: p.kind, kindName: (KINDS[p.kind] || KINDS.other).name, icon: (KINDS[p.kind] || KINDS.other).icon,
      text: p.text, until: p.until, office: o ? { id: o.id, name: o.name } : null, gang: g ? { id: g.id, name: g.name } : null,
      author: { id: p.user_id, nick: who.nick, name: fullName ? fullName(wp, 'all') : '', look: publicLook ? publicLook(who) : {} }, mine: p.user_id === uid,
      metoo: q('SELECT COUNT(*) AS n FROM board_metoo WHERE post_id = ?').get(p.id).n, iMetoo: !!me, fans, at: p.at,
      time: p.lunch_time || null, place: p.place || null, expiresAt: p.expires_at || null
    };
  }

  route('GET', '/api/board', async (req, body, query) => {
    const u = requireUser(req);
    // Доска — внутри своей компании
    const rows = q("SELECT p.* FROM board_posts p JOIN users x ON x.id = p.user_id WHERE p.hidden = 0 AND p.until >= ? AND (p.expires_at IS NULL OR p.expires_at > ?) AND x.company = ? ORDER BY p.at DESC LIMIT 100").all(today(), U.now(), u.company || 'mts');
    const office = query.office ? String(query.office) : '';
    const items = rows.filter((p) => canSee(p, u.id) && (!office || !p.office_id || p.office_id === office)).map((p) => view(p, u.id));
    return { items, kinds: Object.entries(KINDS).map(([id, k]) => ({ id, ...k })), maxDays: MAX_DAYS, lunchTimes: lunchTimes() };
  });

  route('POST', '/api/board', async (req, body) => {
    const u = requireUser(req);
    rateLimit('board:' + u.id, PER_DAY, 24 * 3600e3);
    const kind = KINDS[body.kind] ? body.kind : 'other';
    let text = U.cleanText(body.text, TEXT_MAX);
    const place = kind === 'lunch' ? U.cleanText(body.place, 40) || null : null;
    const time = kind === 'lunch' ? String(body.time || '') : null;
    if (kind === 'lunch' && !lunchTimes().includes(time)) throw bad('Во сколько обед? Выбери время.');
    if (kind === 'lunch' && text.length < 5) text = text || '';
    else if (text.length < 5) throw bad(kind === 'kitchen' ? 'Что на кухне? Например: «Яблоки и мармелад на 3-м».' : 'Напиши пару слов: что ищешь или предлагаешь.');
    if (place) { const pp = U.moderationProblem(place); if (pp) throw bad(pp); }
    const prob = text ? U.moderationProblem(text) : null;
    if (prob) throw bad(prob);
    const t = today();
    let until = String(body.until || addDays(t, 3));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || isNaN(Date.parse(until)) || until < t) throw bad('До какого дня висит объявление?');
    if (until > addDays(t, MAX_DAYS)) until = addDays(t, MAX_DAYS);
    let expires = null;
    if (kind === 'kitchen') { until = t; expires = U.now() + HOUR; }
    if (kind === 'lunch') {
      until = t; expires = U.now() + (hm(time) - nowMin()) * 60e3 + HOUR;
      // Один сбор на обед в день: новый заменяет прежний, а кто шёл на прежний — узнает
      for (const old of q("SELECT * FROM board_posts WHERE user_id = ? AND kind = 'lunch' AND until = ?").all(u.id, t)) cancelLunch(old, 'Сбор перенесён — посмотри новый на Доске');
    }
    const gang = body.gang ? Number(body.gang) : null;
    if (gang && !(isMember && isMember(gang, u.id))) throw bad('Повесить объявление можно только в своей банде.');
    const office = !gang && body.office && officeById(String(body.office)) ? String(body.office) : null;
    const id = Number(q('INSERT INTO board_posts (user_id, kind, text, office_id, until, at, gang_id, expires_at, lunch_time, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(u.id, kind, text, office, until, U.now(), gang, expires, time, place).lastInsertRowid);
    if ((kind === 'company' || kind === 'lunch') && onEvent) onEvent('board_company', u.id);
    // Угощение на кухне — пуш только тем, кто сейчас отмечен в этом офисе, и не чаще раза в час на человека
    if (kind === 'kitchen' && office && !U.isAfterCheckinCutoff()) {
      const here = q('SELECT DISTINCT c.user_id FROM checkins c JOIN users x ON x.id = c.user_id WHERE c.office_id = ? AND c.day = ? AND c.left_at IS NULL AND x.company = ?')
        .all(office, t, u.company || 'mts').map((r) => r.user_id).filter((x) => x !== u.id && U.now() - (kitchenPinged.get(x) || 0) >= HOUR);
      for (const x of here) kitchenPinged.set(x, U.now());
      if (here.length) fireAndForget(notify(here, { title: 'На кухне', body: `${u.nick}: ${text.slice(0, 80)}`, url: '/#kitchen', tag: `board-${id}` }));
    }
    // Обед для банды — своим сразу пуш: их немного, и это то, ради чего банда
    if (kind === 'lunch' && gang && gangMembers) {
      const to = gangMembers(gang).map((m) => m.id).filter((x) => x !== u.id);
      if (to.length) fireAndForget(notify(to, { title: 'Кто на обед?', body: `${u.nick} зовёт на обед в ${time}${place ? ' · ' + place : ''}`, url: '/#office', tag: `board-${id}` }));
    }
    return { item: view(q('SELECT * FROM board_posts WHERE id = ?').get(id), u.id) };
  });

  // Отмена обеда: идущим — пуш
  function cancelLunch(p, why) {
    const joiners = q('SELECT user_id FROM board_metoo WHERE post_id = ?').all(p.id).map((r) => r.user_id);
    q('DELETE FROM board_posts WHERE id = ?').run(p.id);
    if (why && joiners.length) fireAndForget(notify(joiners, { title: 'Обед', body: `${why}: ${p.lunch_time || ''}`.trim(), url: '/#office', tag: `board-${p.id}` }));
  }
  // Автор пообедал («Поел» в столовой) или ушёл из офиса — его сбор на обед снимается сам, без пушей
  function authorAte(uid) { q("DELETE FROM board_posts WHERE user_id = ? AND kind = 'lunch' AND until = ?").run(uid, today()); }

  const postOr404 = (id) => {
    const p = q('SELECT * FROM board_posts WHERE id = ? AND hidden = 0').get(Number(id));
    if (!p || p.until < today() || (p.expires_at && p.expires_at <= U.now())) throw new HttpError(404, 'Объявление уже снято.');
    return p;
  };

  // «Я тоже»: повторное нажатие снимает отметку. Автору — пуш, но только при первой отметке этого человека
  route('POST', '/api/board/:id/metoo', async (req, body, query, params) => {
    const u = requireUser(req);
    const p = postOr404(params.id);
    if (p.user_id === u.id) throw bad('Это твоё объявление.');
    if (((q('SELECT company FROM users WHERE id = ?').get(p.user_id) || {}).company || 'mts') !== (u.company || 'mts') || !canSee(p, u.id)) throw new HttpError(404, 'Объявление не найдено.');
    const had = q('SELECT 1 FROM board_metoo WHERE post_id = ? AND user_id = ?').get(p.id, u.id);
    if (had) q('DELETE FROM board_metoo WHERE post_id = ? AND user_id = ?').run(p.id, u.id);
    else {
      const r = q('INSERT OR IGNORE INTO board_metoo (post_id, user_id, at) VALUES (?, ?, ?)').run(p.id, u.id, U.now());
      if (r.changes && (p.kind === 'company' || p.kind === 'lunch') && onEvent) onEvent('board_company', u.id);
      const msg = p.kind === 'lunch' ? { title: 'Обед', body: `${u.nick} идёт с тобой в ${p.lunch_time}` }
        : p.kind === 'kitchen' ? { title: 'На кухне', body: `${u.nick} говорит спасибо за угощение` }
        : { title: 'Доска «Этажа»', body: `${u.nick}: «я тоже» — ${p.text.slice(0, 60)}` };
      if (r.changes) fireAndForget(notify([p.user_id], { ...msg, url: p.kind === 'lunch' ? '/#office' : `/#crew/${u.id}`, tag: `board-${p.id}` }));
    }
    return { item: view(p, u.id) };
  });

  route('POST', '/api/board/:id/remove', async (req, body, query, params) => {
    const u = requireUser(req);
    const p = q('SELECT * FROM board_posts WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Объявление уже снято.');
    if (p.user_id !== u.id && !u.isAdmin) throw bad('Снять может только автор.');
    if (p.kind === 'lunch') cancelLunch(p, 'Сбор на обед отменён'); else q('DELETE FROM board_posts WHERE id = ?').run(p.id);
    return { ok: true };
  });

  function cleanup() { q('DELETE FROM board_posts WHERE until < ? OR (expires_at IS NOT NULL AND expires_at < ?)').run(addDays(today(), -1), U.now() - HOUR); }

  return { cleanup, KINDS, authorAte };
}

module.exports = { register, KINDS };
