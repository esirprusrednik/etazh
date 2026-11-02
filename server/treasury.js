// Казна банды: «слава» — общая валюта банды, отдельная от личных зёрен.
//  • Слава даётся только за общие результаты: битвы, места в Лиге, Кубок месяца, дни «банда в сборе».
//  • Зёрна в славу не превращаются и наоборот — слава показывает заслуги, а не кошелёк.
//  • Тратится только на внешний вид банды: плашка названия, статус, сияние герба, фон карточки, тема чата.
//    Никаких преимуществ в Лиге, битвах и лимитах за славу не купить.
//  • Недорогое (до 100 славы) покупает владелец — покупка видна в чате. Дорогое — тайным голосованием банды,
//    как герб: досрочно решает больше половины, иначе через 48 часов при кворуме в треть банды.
// Начисления идемпотентны (банда, причина, ссылка уникальны), поэтому сканер можно запускать сколько угодно —
// он же один раз начисляет славу за всё, что банды заработали до появления казны.

const ITEMS = [
  // Плашки названия
  { id: 'plate_neon', slot: 'plate', name: 'Неоновая плашка', price: 40 },
  { id: 'plate_gold', slot: 'plate', name: 'Золотая плашка', price: 60 },
  { id: 'plate_ice', slot: 'plate', name: 'Ледяная плашка', price: 50 },
  { id: 'plate_pixel', slot: 'plate', name: 'Пиксельная плашка', price: 50 },
  { id: 'plate_fire', slot: 'plate', name: 'Огненная плашка', price: 120 },
  // Статусы под названием
  { id: 'st_blitz', slot: 'status', name: 'Гроза блица', price: 30 },
  { id: 'st_sea', slot: 'status', name: 'Морские волки', price: 30 },
  { id: 'st_coffee', slot: 'status', name: 'Кофейная мафия', price: 30 },
  { id: 'st_quiet', slot: 'status', name: 'Тихие гении', price: 30 },
  { id: 'st_legends', slot: 'status', name: 'Офисные легенды', price: 60 },
  { id: 'st_unbeaten', slot: 'status', name: 'Непобедимые', price: 100 },
  // Сияние герба
  { id: 'aura_gold', slot: 'aura', name: 'Золотое сияние', price: 60 },
  { id: 'aura_neon', slot: 'aura', name: 'Неоновое сияние', price: 80 },
  { id: 'aura_fire', slot: 'aura', name: 'Живое пламя', price: 150 },
  // Фон карточки банды
  { id: 'bg_sunset', slot: 'cardbg', name: 'Закат', price: 70 },
  { id: 'bg_city', slot: 'cardbg', name: 'Ночной город', price: 90 },
  { id: 'bg_space', slot: 'cardbg', name: 'Космос', price: 120 },
  { id: 'bg_matrix', slot: 'cardbg', name: 'Матрица', price: 120 },
  // Тема чата
  { id: 'chat_sea', slot: 'chat', name: 'Морской чат', price: 50 },
  { id: 'chat_forest', slot: 'chat', name: 'Лесной чат', price: 50 },
  { id: 'chat_night', slot: 'chat', name: 'Ночной чат', price: 50 }
];
const SLOTS = { plate: 'Плашка названия', status: 'Статус банды', aura: 'Сияние герба', cardbg: 'Фон карточки', chat: 'Тема чата' };
const VOTE_FROM = 100;
const VOTE_MS = 48 * 3600e3;
// Сколько славы за что
const GLORY = { warWin: 10, warDraw: 3, weekly: [15, 10, 5], monthly: [40, 25, 15], tourWin: 50, tourFinal: 20, together: 1 };
const REASON_NAMES = { war_win: 'Победа в битве', war_draw: 'Ничья в битве', league_w: 'Лига недели', league_m: 'Лига месяца', tour_win: 'Кубок месяца', tour_final: 'Финал Кубка', together: 'Банда в сборе', buy: 'Покупка', refund: 'Возврат' };

function register(ctx) {
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS glory_ledger (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT NOT NULL, at INTEGER NOT NULL,
    UNIQUE (gang_id, reason, ref)
  );
  CREATE TABLE IF NOT EXISTS gang_owned (
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (gang_id, item_id)
  );
  CREATE TABLE IF NOT EXISTS gang_buy_votes (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    at INTEGER NOT NULL, ends_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', decided_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS gang_buy_ballots (
    vote_id INTEGER NOT NULL REFERENCES gang_buy_votes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (vote_id, user_id)
  );
  `);
  try { db.exec('ALTER TABLE gangs ADD COLUMN style TEXT'); } catch {}

  const today = () => U.msk().day;
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const balance = (gid) => q('SELECT COALESCE(SUM(amount), 0) AS n FROM glory_ledger WHERE gang_id = ?').get(gid).n;
  const award = (gid, amount, reason, ref) => (gid && amount ? q('INSERT OR IGNORE INTO glory_ledger (gang_id, amount, reason, ref, at) VALUES (?, ?, ?, ?, ?)').run(gid, amount, reason, String(ref), U.now()).changes > 0 : false);
  const memberCount = (gid) => q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(gid).n;
  const itemById = (id) => ITEMS.find((x) => x.id === id) || null;
  const styleOf = (g) => { try { return g && g.style ? JSON.parse(g.style) : {}; } catch { return {}; } };
  const exists = (t) => !!q("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const chat = (gid, uid, text) => q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(gid, uid, 'text', text, U.now());

  // Сканер начислений: битвы, Лига, Кубок, «в сборе» за вчера. Всё идемпотентно
  function scan() {
    if (exists('gang_wars')) {
      for (const w of q("SELECT * FROM gang_wars WHERE status = 'done'").all()) {
        if (w.winner_gang) award(w.winner_gang, GLORY.warWin, 'war_win', w.id);
        else { award(w.from_gang, GLORY.warDraw, 'war_draw', w.id); award(w.to_gang, GLORY.warDraw, 'war_draw', w.id); }
      }
    }
    if (exists('league_results')) {
      for (const r of q('SELECT * FROM league_results').all()) {
        const weekly = r.period.startsWith('W:');
        const pts = (weekly ? GLORY.weekly : GLORY.monthly)[r.place - 1];
        if (pts) award(r.gang_id, pts, weekly ? 'league_w' : 'league_m', r.period);
      }
    }
    if (exists('tourneys')) {
      for (const t of q("SELECT * FROM tourneys WHERE status = 'done'").all()) {
        award(t.champion, GLORY.tourWin, 'tour_win', t.month);
        if (t.runner_up) award(t.runner_up, GLORY.tourFinal, 'tour_final', t.month);
      }
    }
    // «Банда в сборе» за вчера: отметились (офис или дом) не меньше 70% и не меньше трёх
    const y = addDays(today(), -1);
    for (const g of q('SELECT id FROM gangs WHERE hidden = 0').all()) {
      const n = memberCount(g.id);
      if (n < 3) continue;
      const came = q(`SELECT COUNT(DISTINCT l.user_id) AS n FROM ledger l JOIN gang_members m ON m.user_id = l.user_id AND m.gang_id = ? WHERE l.reason IN ('checkin', 'home') AND l.day = ?`).get(g.id, y).n;
      if (came >= Math.max(3, Math.ceil(n * 0.7))) award(g.id, GLORY.together, 'together', y);
    }
    for (const v of q("SELECT * FROM gang_buy_votes WHERE status = 'open' AND ends_at <= ?").all(U.now())) decide(v);
  }
  setInterval(() => { try { scan(); } catch (e) { console.error('treasury', e); } }, 5 * 60e3).unref();
  setTimeout(() => { try { scan(); } catch (e) { console.error('treasury', e); } }, 2000).unref();

  function grant(g, item, uid, how) {
    q('INSERT INTO glory_ledger (gang_id, amount, reason, ref, at) VALUES (?, ?, ?, ?, ?)').run(g.id, -item.price, 'buy', `${item.id}:${U.now()}`, U.now());
    q('INSERT OR IGNORE INTO gang_owned (gang_id, item_id, at) VALUES (?, ?, ?)').run(g.id, item.id, U.now());
    const st = styleOf(g); st[item.slot] = item.id;
    q('UPDATE gangs SET style = ? WHERE id = ?').run(JSON.stringify(st), g.id);
    chat(g.id, uid, `🏛 ${how}: «${item.name}» за ${item.price} славы. В казне осталось ${balance(g.id)}`);
  }

  // ---------- Голосование за дорогую покупку ----------
  const tally = (v) => q(`SELECT COALESCE(SUM(b.vote = 1), 0) AS za, COALESCE(SUM(b.vote = -1), 0) AS protiv FROM gang_buy_ballots b
    JOIN gang_members m ON m.user_id = b.user_id AND m.gang_id = ? WHERE b.vote_id = ?`).get(v.gang_id, v.id);
  function decide(v) {
    if (!v || v.status !== 'open') return v;
    const t = tally(v), n = memberCount(v.gang_id);
    let status = null;
    if (t.za * 2 > n) status = 'accepted';
    else if (t.protiv * 2 >= n) status = 'rejected';
    else if (U.now() >= v.ends_at) status = t.za > t.protiv && t.za * 3 >= n ? 'accepted' : 'rejected';
    if (!status) return v;
    const g = q('SELECT * FROM gangs WHERE id = ?').get(v.gang_id);
    const item = itemById(v.item_id);
    if (status === 'accepted' && (!item || balance(g.id) < item.price || q('SELECT 1 FROM gang_owned WHERE gang_id = ? AND item_id = ?').get(g.id, item.id))) status = 'failed';
    q('UPDATE gang_buy_votes SET status = ?, decided_at = ? WHERE id = ?').run(status, U.now(), v.id);
    if (status === 'accepted') {
      grant(g, item, v.user_id, `Банда проголосовала (за — ${t.za}, против — ${t.protiv}) и купила`);
      fireAndForget(notify(gangMembers(g.id).map((m) => m.id), { title: g.name, body: `Казна: банда купила «${item.name}»`, url: `/#gang/${g.id}`, tag: `buy-${v.id}` }));
    } else chat(g.id, v.user_id, status === 'failed' ? `🏛 Покупка «${item ? item.name : ''}» не состоялась: славы в казне уже не хватает` : `🏛 Покупка «${item ? item.name : ''}» не прошла голосование: за — ${t.za}, против — ${t.protiv}`);
    return q('SELECT * FROM gang_buy_votes WHERE id = ?').get(v.id);
  }

  function view(g, uid) {
    const owned = new Set(q('SELECT item_id FROM gang_owned WHERE gang_id = ?').all(g.id).map((r) => r.item_id));
    const st = styleOf(g);
    const open = decide(q("SELECT * FROM gang_buy_votes WHERE gang_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(g.id));
    let vote = null;
    if (open && open.status === 'open') {
      const t = tally(open), n = memberCount(g.id);
      const my = q('SELECT vote FROM gang_buy_ballots WHERE vote_id = ? AND user_id = ?').get(open.id, uid);
      vote = { id: open.id, item: itemById(open.item_id), author: (q('SELECT nick FROM users WHERE id = ?').get(open.user_id) || {}).nick || '—', za: t.za, protiv: t.protiv, my: my ? my.vote : 0, members: n, endsAt: open.ends_at, needEarly: Math.floor(n / 2) + 1, quorum: Math.ceil(n / 3) };
    }
    return {
      balance: balance(g.id), isOwner: g.owner_id === uid, voteFrom: VOTE_FROM, glory: GLORY, slots: SLOTS,
      style: st, vote,
      items: ITEMS.map((it) => ({ ...it, owned: owned.has(it.id), equipped: st[it.slot] === it.id, needVote: it.price >= VOTE_FROM })),
      history: q('SELECT amount, reason, ref, at FROM glory_ledger WHERE gang_id = ? ORDER BY at DESC, id DESC LIMIT 15').all(g.id)
        .map((r) => ({ amount: r.amount, reason: REASON_NAMES[r.reason] || r.reason, item: r.reason === 'buy' ? (itemById(r.ref.split(':')[0]) || {}).name : null, at: r.at }))
    };
  }
  const gangOr404 = (gid, uid) => {
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(gid));
    if (!g || !isMember(g.id, uid)) throw new HttpError(404, 'Банда не найдена.');
    return g;
  };

  route('GET', '/api/gangs/:id/treasury', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    scan();
    return view(q('SELECT * FROM gangs WHERE id = ?').get(g.id), u.id);
  });

  // Купить недорогое (владелец) или вынести дорогое на голосование (любой член банды)
  route('POST', '/api/gangs/:id/treasury/buy', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    const item = itemById(body.item);
    if (!item) throw bad('Нет такой вещи.');
    if (q('SELECT 1 FROM gang_owned WHERE gang_id = ? AND item_id = ?').get(g.id, item.id)) throw bad('У банды это уже есть — надень в казне.');
    if (balance(g.id) < item.price) throw bad(`Не хватает славы: нужно ${item.price}, в казне ${balance(g.id)}. Слава — за победы банды.`);
    if (item.price < VOTE_FROM) {
      if (g.owner_id !== u.id) throw bad('Недорогое покупает владелец. Предложи ему в чате банды.');
      grant(g, item, u.id, 'Владелец купил');
      return view(q('SELECT * FROM gangs WHERE id = ?').get(g.id), u.id);
    }
    if (q("SELECT 1 FROM gang_buy_votes WHERE gang_id = ? AND status = 'open'").get(g.id)) throw bad('Уже идёт голосование за покупку — дождитесь итога.');
    const t = U.now();
    const id = Number(q('INSERT INTO gang_buy_votes (gang_id, item_id, user_id, at, ends_at) VALUES (?, ?, ?, ?, ?)').run(g.id, item.id, u.id, t, t + VOTE_MS).lastInsertRowid);
    q('INSERT INTO gang_buy_ballots (vote_id, user_id, vote, at) VALUES (?, ?, 1, ?)').run(id, u.id, t);
    const v = decide(q('SELECT * FROM gang_buy_votes WHERE id = ?').get(id));
    if (v.status === 'open') {
      chat(g.id, u.id, `🏛 Предлагаю потратить ${item.price} славы на «${item.name}» — голосуй в казне, голос тайный`);
      fireAndForget(notify(gangMembers(g.id).filter((m) => m.id !== u.id).map((m) => m.id), { title: `${g.name}: тратим славу?`, body: `«${item.name}» за ${item.price} — голосование 48 часов`, url: `/#gang/${g.id}`, tag: `buy-${id}` }));
    }
    return view(q('SELECT * FROM gangs WHERE id = ?').get(g.id), u.id);
  });

  route('POST', '/api/gangs/:id/treasury/vote', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    const v = q("SELECT * FROM gang_buy_votes WHERE gang_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(g.id);
    if (!v) throw bad('Голосования нет.');
    const vote = Number(body.vote);
    if (vote !== 1 && vote !== -1) throw bad('За или против?');
    q('INSERT OR REPLACE INTO gang_buy_ballots (vote_id, user_id, vote, at) VALUES (?, ?, ?, ?)').run(v.id, u.id, vote, U.now());
    decide(v);
    return view(q('SELECT * FROM gangs WHERE id = ?').get(g.id), u.id);
  });

  // Надеть или снять купленное — владелец, бесплатно
  route('POST', '/api/gangs/:id/treasury/equip', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    if (g.owner_id !== u.id) throw bad('Оформление меняет владелец.');
    const st = styleOf(g);
    if (body.slot && SLOTS[body.slot] && !body.item) delete st[body.slot];
    else {
      const item = itemById(body.item);
      if (!item || !q('SELECT 1 FROM gang_owned WHERE gang_id = ? AND item_id = ?').get(g.id, item.id)) throw bad('Сначала купите это за славу.');
      st[item.slot] = item.id;
    }
    q('UPDATE gangs SET style = ? WHERE id = ?').run(JSON.stringify(st), g.id);
    return view(q('SELECT * FROM gangs WHERE id = ?').get(g.id), u.id);
  });

  // Для карточек банды: оформление и баланс
  const pub = (g) => ({ style: styleOf(g), statusName: (itemById(styleOf(g).status) || {}).name || null });
  return { scan, balance, pub, award, ITEMS };
}

module.exports = { register, ITEMS, GLORY };
