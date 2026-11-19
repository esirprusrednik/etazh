// Тайный Санта банды.
// С 1 ноября любой член банды записывается и пишет пожелание (что любит, чего не надо дарить).
// 4 декабря — автоматическая жеребьёвка (владелец может провести раньше, если записались трое и больше).
// Каждый видит только своего подопечного и его пожелание; кто дарит ему самому — не видит никто.
// Пожелание пишется один раз, при записи, и потом не меняется: Санта должен быть уверен, что готовит то, о чём просили.
// Вышел и записался снова — пожелание останется прежним (оно хранится отдельно).
// Подарки вручают на встрече банды; «Подарок вручён» отмечает дарящий. Карточка видна до 15 января.

const WISH_MAX = 200;
const MIN_PEOPLE = 3;
const BUDGET = 500; // потолок цены подарка, ₽ — чтобы никому не было неловко
// Чётность не важна: дарим по кругу (A→B→C→A), при любом числе от трёх у каждого ровно один даритель и один подопечный

function register(ctx) {
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, onEvent, rateLimit, config } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS santa (
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',   -- open | drawn | cancelled
    drawn_at INTEGER,
    PRIMARY KEY (gang_id, year)
  );
  CREATE TABLE IF NOT EXISTS santa_members (
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wish TEXT NOT NULL DEFAULT '',
    target_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    gifted_at INTEGER,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (gang_id, year, user_id)
  );
  `);
  try { db.exec('ALTER TABLE santa_members ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0'); } catch {}
  db.exec(`CREATE TABLE IF NOT EXISTS santa_wish_lock (
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE, year INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, wish TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (gang_id, year, user_id))`);
  // Гости: люди без аккаунта, которых позвали по ссылке. Оставляют имя и пожелание, получают личную ссылку —
  // по ней 4 декабря узнают подопечного и отмечают подарок. Храним имя, пожелание и хеш ссылки; почты и устройства нет.
  // Подопечным участника может оказаться гость и наоборот, поэтому цель записывается в одну из двух колонок
  db.exec(`
  CREATE TABLE IF NOT EXISTS santa_guests (
    id INTEGER PRIMARY KEY, gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE, year INTEGER NOT NULL,
    name TEXT NOT NULL, wish TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, via_user INTEGER,
    target_user INTEGER, target_guest INTEGER, gifted_at INTEGER, joined_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS santa_links (token_hash TEXT PRIMARY KEY, gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE, year INTEGER NOT NULL, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  `);
  try { db.exec('ALTER TABLE santa_members ADD COLUMN target_guest INTEGER'); } catch {}
  const MAX_GUESTS = 30;
  const guestsOf = (gid, year) => q('SELECT * FROM santa_guests WHERE gang_id = ? AND year = ? ORDER BY joined_at').all(gid, year);
  const total = (gid, year) => q('SELECT COUNT(*) AS n FROM santa_members WHERE gang_id = ? AND year = ?').get(gid, year).n + q('SELECT COUNT(*) AS n FROM santa_guests WHERE gang_id = ? AND year = ?').get(gid, year).n;
  const giftedN = (gid, year) => q('SELECT COUNT(*) AS n FROM santa_members WHERE gang_id = ? AND year = ? AND gifted_at IS NOT NULL').get(gid, year).n + q('SELECT COUNT(*) AS n FROM santa_guests WHERE gang_id = ? AND year = ? AND gifted_at IS NOT NULL').get(gid, year).n;
  // Подопечный по паре колонок (участник или гость): как его зовут и чего он хочет
  function targetOf(gid, year, userId, guestId) {
    if (userId) {
      const t = q('SELECT id, nick FROM users WHERE id = ?').get(userId);
      const w = q('SELECT wish FROM santa_members WHERE gang_id = ? AND year = ? AND user_id = ?').get(gid, year, userId);
      return t ? { id: t.id, nick: t.nick, wish: w ? w.wish : '' } : null;
    }
    if (guestId) { const g = q('SELECT name, wish FROM santa_guests WHERE id = ?').get(guestId); return g ? { id: null, nick: g.name, wish: g.wish, guest: true } : null; }
    return null;
  }
  const WISH_MIN = 3;
  const keptWish = (gid, year, uid) => (q('SELECT wish FROM santa_wish_lock WHERE gang_id = ? AND year = ? AND user_id = ?').get(gid, year, uid) || {}).wish || '';
  const lockWish = (gid, year, uid, wish) => q('INSERT OR IGNORE INTO santa_wish_lock (gang_id, year, user_id, wish, at) VALUES (?, ?, ?, ?, ?)').run(gid, year, uid, wish, U.now());
  const needWish = (w) => { const t = cleanWish(w); if (t.length < WISH_MIN) throw bad('Напиши пожелание — пару слов о том, что любишь. Потом его не изменить.'); return t; };

  // Сезон Санты: ноябрь–декабрь текущего года и январь (до 15-го) — прошлого
  function season(day = U.msk().day) {
    const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)), d = Number(day.slice(8, 10));
    if (m >= 11) return { year: y, visible: true };
    if (m === 1 && d <= 15) return { year: y - 1, visible: true };
    return { year: y, visible: false };
  }
  const drawDay = (year) => `${year}-12-04`;
  const row = (gid, year) => q('SELECT * FROM santa WHERE gang_id = ? AND year = ?').get(gid, year);
  const ensure = (gid, year) => { q('INSERT OR IGNORE INTO santa (gang_id, year) VALUES (?, ?)').run(gid, year); return row(gid, year); };
  const chat = (gid, uid, text) => q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(gid, uid, 'text', text, U.now());
  const cleanWish = (w) => {
    const t = U.cleanText(w, WISH_MAX) || '';
    const prob = t && U.moderationProblem(t);
    if (prob) throw bad(prob);
    return t;
  };
  function gangOr404(req, params) {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(params.id));
    if (!g || !isMember(g.id, u.id)) throw new HttpError(404, 'Банда не найдена.');
    return { u, g };
  }

  // Жеребьёвка: перемешиваем и каждый дарит следующему по кругу — никто не вытянет сам себя
  function draw(gid, year) {
    const members = q('SELECT user_id FROM santa_members WHERE gang_id = ? AND year = ?').all(gid, year).map((r) => r.user_id);
    const a = [...members.map((id) => ({ u: id })), ...guestsOf(gid, year).map((g) => ({ g: g.id }))];
    if (a.length < MIN_PEOPLE) return false;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const setM = q('UPDATE santa_members SET target_id = ?, target_guest = ? WHERE gang_id = ? AND year = ? AND user_id = ?');
    const setG = q('UPDATE santa_guests SET target_user = ?, target_guest = ? WHERE id = ?');
    a.forEach((p, i) => { const t = a[(i + 1) % a.length]; if (p.u) setM.run(t.u || null, t.g || null, gid, year, p.u); else setG.run(t.u || null, t.g || null, p.g); });
    q("UPDATE santa SET status = 'drawn', drawn_at = ? WHERE gang_id = ? AND year = ?").run(U.now(), gid, year);
    const g = q('SELECT owner_id FROM gangs WHERE id = ?').get(gid);
    chat(gid, g ? g.owner_id : null, `Тайный Санта: жеребьёвка прошла, участников — ${a.length}. Открой карточку банды — там твой подопечный и его пожелание`);
    fireAndForget(notify(members, { title: 'Тайный Санта', body: 'Жеребьёвка прошла — узнай, кому даришь', url: `/#gang/${gid}`, tag: `santa-${gid}` }));
    return true;
  }

  function view(u, g) {
    const s = season();
    const r = row(g.id, s.year) || { status: 'open' };
    const me = q('SELECT * FROM santa_members WHERE gang_id = ? AND year = ? AND user_id = ?').get(g.id, s.year, u.id);
    const count = total(g.id, s.year);
    const gifted = giftedN(g.id, s.year);
    const today = U.msk().day;
    let target = null;
    if (r.status === 'drawn' && me) target = targetOf(g.id, s.year, me.target_id, me.target_guest);
    return {
      visible: s.visible, year: s.year, status: r.status, drawDay: drawDay(s.year),
      regOpen: s.visible && r.status === 'open' && today < drawDay(s.year),
      count, gifted, min: MIN_PEOPLE, budget: BUDGET, joined: !!me, wish: me ? me.wish : '', keptWish: me ? '' : keptWish(g.id, s.year, u.id), wishLocked: !!(me && me.wish), target, myGifted: !!(me && me.gifted_at),
      guests: guestsOf(g.id, s.year).map((x) => ({ id: x.id, name: x.name })), canRemoveGuest: g.owner_id === u.id && r.status === 'open'
    };
  }

  route('GET', '/api/gangs/:id/santa', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params);
    return view(u, g);
  });

  route('POST', '/api/gangs/:id/santa/join', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params);
    const s = season();
    if (!s.visible) throw bad('Тайный Санта открывается 1 ноября.');
    const r = ensure(g.id, s.year);
    if (r.status !== 'open' || U.msk().day >= drawDay(s.year)) throw bad('Запись закрыта — жеребьёвка уже прошла.');
    // Пожелание — одна попытка: если человек уже писал его в этом году, берём прежнее
    const wish = keptWish(g.id, s.year, u.id) || needWish(body.wish);
    const ins = q('INSERT OR IGNORE INTO santa_members (gang_id, year, user_id, wish, joined_at) VALUES (?, ?, ?, ?, ?)').run(g.id, s.year, u.id, wish, U.now());
    if (ins.changes) lockWish(g.id, s.year, u.id, wish);
    return view(u, g);
  });

  route('POST', '/api/gangs/:id/santa/leave', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params);
    const s = season();
    const r = row(g.id, s.year);
    if (!r || r.status !== 'open') throw bad('После жеребьёвки выйти нельзя — твой Санта уже готовит подарок.');
    q('DELETE FROM santa_members WHERE gang_id = ? AND year = ? AND user_id = ?').run(g.id, s.year, u.id);
    return view(u, g);
  });

  route('POST', '/api/gangs/:id/santa/wish', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params);
    const s = season();
    // Дописать можно только пустое пожелание (записались до этого правила) — и тоже один раз
    const me = q('SELECT wish FROM santa_members WHERE gang_id = ? AND year = ? AND user_id = ?').get(g.id, s.year, u.id);
    if (!me) throw bad('Сначала запишись в Тайного Санту.');
    if (me.wish) throw bad('Пожелание уже отправлено — изменить его нельзя.');
    if ((row(g.id, s.year) || {}).status === 'drawn') throw bad('Жеребьёвка прошла — пожелание уже не дописать.');
    const wish = needWish(body.wish);
    q('UPDATE santa_members SET wish = ? WHERE gang_id = ? AND year = ? AND user_id = ?').run(wish, g.id, s.year, u.id);
    lockWish(g.id, s.year, u.id, wish);
    return view(u, g);
  });

  // Досрочной жеребьёвки нет: срок один для всех банд, 4 декабря. Проводит её только таймер ниже

  // ---------- Гости Санты ----------
  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = (n) => Array.from(require('node:crypto').randomBytes(n), (b) => ABC[b % ABC.length]).join('');
  const open = (gid, year) => { const r = ensure(gid, year); return season().visible && r.status === 'open' && U.msk().day < drawDay(year); };
  // Ссылка для гостей: её можно пересылать, работает до жеребьёвки
  route('POST', '/api/gangs/:id/santa/guest-link', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params);
    const s = season();
    if (g.who_invites === 'owner' && g.owner_id !== u.id) throw bad('В этой банде зовёт только владелец.');
    if (!open(g.id, s.year)) throw bad('Запись в Тайного Санту закрыта.');
    rateLimit('santa-link:' + u.id, 10, 864e5);
    const token = rnd(12);
    q('INSERT INTO santa_links (token_hash, gang_id, year, user_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(U.sha256(token), g.id, s.year, u.id, Date.parse(drawDay(s.year) + 'T00:00:00Z') - 3 * 3600e3);
    return { link: `${config.baseUrl}/s/${token}` };
  });
  route('POST', '/api/gangs/:id/santa/guests/:gid/remove', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params);
    const s = season();
    if (g.owner_id !== u.id) throw bad('Убрать гостя может только владелец банды.');
    if ((row(g.id, s.year) || {}).status !== 'open') throw bad('После жеребьёвки гостя не убрать — у него уже есть подопечный.');
    q('DELETE FROM santa_guests WHERE id = ? AND gang_id = ? AND year = ?').run(Number(params.gid), g.id, s.year);
    return view(u, g);
  });
  const linkOr404 = (t) => {
    const l = /^[A-Za-z0-9]{12}$/.test(String(t)) ? q('SELECT * FROM santa_links WHERE token_hash = ? AND expires_at > ?').get(U.sha256(String(t).toUpperCase()), U.now()) : null;
    const g = l ? q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(l.gang_id) : null;
    if (!g || !open(g.id, l.year)) throw new HttpError(404, 'Запись по этой ссылке закрыта — попроси новую или спроси у своих.');
    return { l, g };
  };
  const pubGang = (g) => ({ name: g.name, color: g.color, ...U.crestPub(g) });
  route('GET', '/api/santa-invite/:token', async (req, body, query, params) => {
    rateLimit('santa-view:' + (req.ip || ''), 120, 3600e3);
    const { l, g } = linkOr404(params.token);
    const from = q('SELECT nick FROM users WHERE id = ?').get(l.user_id);
    return { gang: pubGang(g), from: from ? from.nick : null, count: total(g.id, l.year), drawDay: drawDay(l.year), budget: BUDGET, min: MIN_PEOPLE };
  });
  route('POST', '/api/santa-invite/:token/join', async (req, body, query, params) => {
    rateLimit('santa-go:' + (req.ip || ''), 8, 3600e3);
    const { l, g } = linkOr404(params.token);
    if (!body.consent) throw bad('Отметь согласие: без него имя и пожелание записать нельзя.');
    const name = U.cleanText(body.name, 40) || '';
    if (name.length < 2) throw bad('Напиши имя и фамилию — так, как тебя знают свои.');
    const prob = U.moderationProblem(name);
    if (prob) throw bad(prob);
    const wish = needWish(body.wish);
    if (guestsOf(g.id, l.year).length >= MAX_GUESTS) throw bad('Гостей уже слишком много — напиши тому, кто позвал.');
    if (guestsOf(g.id, l.year).some((x) => x.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) throw bad('Гость с таким именем уже записан. Если это ты — открой свою личную ссылку.');
    const code = rnd(14);
    q('INSERT INTO santa_guests (gang_id, year, name, wish, code_hash, via_user, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(g.id, l.year, name, wish, U.sha256('sg:' + code), l.user_id, U.now());
    fireAndForget(notify([...new Set([g.owner_id, l.user_id])], { title: 'Тайный Санта', body: `${name} участвует как гость — по ссылке`, url: `/#gang/${g.id}`, tag: `santa-guest-${g.id}` }));
    return { code, link: `${config.baseUrl}/sg/${code}` };
  });
  // Личная ссылка гостя — единственный его ключ. По ней: до жеребьёвки — «ты записан», после — кому дарить
  const guestOr404 = (code) => {
    const x = /^[A-Za-z0-9]{14}$/.test(String(code)) ? q('SELECT * FROM santa_guests WHERE code_hash = ?').get(U.sha256('sg:' + String(code).toUpperCase())) : null;
    if (!x) throw new HttpError(404, 'Такой записи нет. Проверь ссылку — она длинная, её легко обрезать.');
    return x;
  };
  function guestView(x) {
    const g = q('SELECT * FROM gangs WHERE id = ?').get(x.gang_id) || {};
    const r = row(x.gang_id, x.year) || { status: 'open' };
    return {
      gang: pubGang(g), name: x.name, wish: x.wish, status: r.status, drawDay: drawDay(x.year), budget: BUDGET, count: total(x.gang_id, x.year), gifted: giftedN(x.gang_id, x.year),
      target: r.status === 'drawn' ? (() => { const t = targetOf(x.gang_id, x.year, x.target_user, x.target_guest); return t ? { name: t.nick, wish: t.wish } : null; })() : null,
      myGifted: !!x.gifted_at
    };
  }
  route('GET', '/api/santa-guest/:code', async (req, body, query, params) => { rateLimit('santa-g:' + (req.ip || ''), 120, 3600e3); return guestView(guestOr404(params.code)); });
  route('POST', '/api/santa-guest/:code/gifted', async (req, body, query, params) => {
    const x = guestOr404(params.code);
    q('UPDATE santa_guests SET gifted_at = ? WHERE id = ? AND gifted_at IS NULL AND (target_user IS NOT NULL OR target_guest IS NOT NULL)').run(U.now(), x.id);
    return guestView(guestOr404(params.code));
  });
  route('POST', '/api/santa-guest/:code/leave', async (req, body, query, params) => {
    const x = guestOr404(params.code);
    if ((row(x.gang_id, x.year) || {}).status !== 'open') throw bad('После жеребьёвки выйти нельзя — твой Санта уже готовит подарок.');
    q('DELETE FROM santa_guests WHERE id = ?').run(x.id);
    return { ok: true };
  });

  route('POST', '/api/gangs/:id/santa/gifted', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params);
    const s = season();
    const res = q('UPDATE santa_members SET gifted_at = ? WHERE gang_id = ? AND year = ? AND user_id = ? AND (target_id IS NOT NULL OR target_guest IS NOT NULL) AND gifted_at IS NULL').run(U.now(), g.id, s.year, u.id);
    if (res.changes && onEvent) onEvent('santa', u.id);
    return view(u, g);
  });

  // 4 декабря: жеребьёвка во всех бандах, где записались трое и больше; где меньше — отменяем с объяснением
  // 29 декабря, с полудня: мягкое напоминание тем, кто ещё не отметил «Подарок вручён». Один раз
  const remindDay = (year) => `${year}-12-29`;
  function remind(s) {
    const now = U.msk();
    if (now.day < remindDay(s.year) || now.hour < 12 || now.day.slice(5, 7) !== '12') return;
    const rows = q(`SELECT m.gang_id, m.user_id, COALESCE(t.nick, sg.name) AS target FROM santa_members m JOIN santa s ON s.gang_id = m.gang_id AND s.year = m.year
                    LEFT JOIN users t ON t.id = m.target_id LEFT JOIN santa_guests sg ON sg.id = m.target_guest WHERE (t.id IS NOT NULL OR sg.id IS NOT NULL) AND m.year = ? AND s.status = 'drawn' AND m.gifted_at IS NULL AND m.reminded = 0`).all(s.year);
    for (const r of rows) {
      q('UPDATE santa_members SET reminded = 1 WHERE gang_id = ? AND year = ? AND user_id = ?').run(r.gang_id, s.year, r.user_id);
      fireAndForget(notify([r.user_id], { title: 'Тайный Санта', body: `До Нового года пара дней. Если подарок для ${r.target} уже вручён — отметь в карточке, если нет — ещё успеваешь`, url: `/#gang/${r.gang_id}`, tag: `santa-remind-${r.gang_id}` }));
    }
  }

  function tick() {
    const s = season();
    if (s.visible) remind(s);
    // Пожелания и пары прошлых сезонов не храним: после 15 января всё стирается
    q('DELETE FROM santa_members WHERE year < ?').run(s.year);
    q('DELETE FROM santa_guests WHERE year < ?').run(s.year);
    q('DELETE FROM santa_links WHERE year < ? OR expires_at < ?').run(s.year, U.now());
    q('DELETE FROM santa WHERE year < ?').run(s.year);
    if (!s.visible || U.msk().day < drawDay(s.year)) return;
    for (const r of q("SELECT * FROM santa WHERE year = ? AND status = 'open'").all(s.year)) {
      if (!draw(r.gang_id, r.year)) {
        q("UPDATE santa SET status = 'cancelled' WHERE gang_id = ? AND year = ?").run(r.gang_id, r.year);
        const g = q('SELECT owner_id FROM gangs WHERE id = ?').get(r.gang_id);
        chat(r.gang_id, g ? g.owner_id : null, `Тайный Санта в этом году не состоялся: записалось меньше ${MIN_PEOPLE} человек`);
      }
    }
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('santa', e); } }, 10 * 60e3).unref();
  // И сразу после запуска: если сервер перезапустили в день жеребьёвки, не ждём десять минут
  setTimeout(() => { try { tick(); } catch (e) { console.error('santa', e); } }, 1500).unref();

  return { tick, season, view, remindDay };
}

module.exports = { register };
