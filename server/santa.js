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
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, onEvent } = ctx;

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
    if (members.length < MIN_PEOPLE) return false;
    const a = [...members];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const set = q('UPDATE santa_members SET target_id = ? WHERE gang_id = ? AND year = ? AND user_id = ?');
    a.forEach((uid, i) => set.run(a[(i + 1) % a.length], gid, year, uid));
    q("UPDATE santa SET status = 'drawn', drawn_at = ? WHERE gang_id = ? AND year = ?").run(U.now(), gid, year);
    const g = q('SELECT owner_id FROM gangs WHERE id = ?').get(gid);
    chat(gid, g ? g.owner_id : null, `Тайный Санта: жеребьёвка прошла, участников — ${a.length}. Открой карточку банды — там твой подопечный и его пожелание. Подарок — до ${BUDGET} ₽`);
    fireAndForget(notify(a, { title: 'Тайный Санта', body: 'Жеребьёвка прошла — узнай, кому даришь', url: `/#gang/${gid}`, tag: `santa-${gid}` }));
    return true;
  }

  function view(u, g) {
    const s = season();
    const r = row(g.id, s.year) || { status: 'open' };
    const me = q('SELECT * FROM santa_members WHERE gang_id = ? AND year = ? AND user_id = ?').get(g.id, s.year, u.id);
    const count = q('SELECT COUNT(*) AS n FROM santa_members WHERE gang_id = ? AND year = ?').get(g.id, s.year).n;
    const gifted = q('SELECT COUNT(*) AS n FROM santa_members WHERE gang_id = ? AND year = ? AND gifted_at IS NOT NULL').get(g.id, s.year).n;
    const today = U.msk().day;
    let target = null;
    if (r.status === 'drawn' && me && me.target_id) {
      const t = q('SELECT id, nick FROM users WHERE id = ?').get(me.target_id);
      const tw = q('SELECT wish FROM santa_members WHERE gang_id = ? AND year = ? AND user_id = ?').get(g.id, s.year, me.target_id);
      if (t) target = { id: t.id, nick: t.nick, wish: tw ? tw.wish : '' };
    }
    return {
      visible: s.visible, year: s.year, status: r.status, drawDay: drawDay(s.year),
      regOpen: s.visible && r.status === 'open' && today < drawDay(s.year),
      count, gifted, min: MIN_PEOPLE, budget: BUDGET, joined: !!me, wish: me ? me.wish : '', keptWish: me ? '' : keptWish(g.id, s.year, u.id), wishLocked: !!(me && me.wish), target, myGifted: !!(me && me.gifted_at)
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

  route('POST', '/api/gangs/:id/santa/gifted', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params);
    const s = season();
    const res = q('UPDATE santa_members SET gifted_at = ? WHERE gang_id = ? AND year = ? AND user_id = ? AND target_id IS NOT NULL AND gifted_at IS NULL').run(U.now(), g.id, s.year, u.id);
    if (res.changes && onEvent) onEvent('santa', u.id);
    return view(u, g);
  });

  // 4 декабря: жеребьёвка во всех бандах, где записались трое и больше; где меньше — отменяем с объяснением
  // 29 декабря, с полудня: мягкое напоминание тем, кто ещё не отметил «Подарок вручён». Один раз
  const remindDay = (year) => `${year}-12-29`;
  function remind(s) {
    const now = U.msk();
    if (now.day < remindDay(s.year) || now.hour < 12 || now.day.slice(5, 7) !== '12') return;
    const rows = q(`SELECT m.gang_id, m.user_id, t.nick AS target FROM santa_members m JOIN santa s ON s.gang_id = m.gang_id AND s.year = m.year
                    JOIN users t ON t.id = m.target_id WHERE m.year = ? AND s.status = 'drawn' AND m.gifted_at IS NULL AND m.reminded = 0`).all(s.year);
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
