// Морской бой для подельников: пошагово, без лимита времени на ход.
// Поле 10×10, флот 4+3+3+2+2+2+1+1+1+1, корабли не касаются даже углами.
// Попал — стреляешь ещё раз. Потопил — клетки вокруг корабля открываются сами.
// Чужой флот клиенту не отдаётся, пока игра идёт: только результаты выстрелов.
// Подключается из api.js через register(ctx), как crew.js.

const N = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
const MAX_ACTIVE = 10;          // одновременных партий у одного человека
const DONE_TTL_DAYS = 7;        // законченная партия хранится неделю (чтобы посмотреть итог)
const IDLE_TTL_DAYS = 30;       // партия, где месяц никто не ходил, удаляется
// Реакции во время партии — как эмоуты в Clash Royale. Только из списка, без свободного текста
const EMOTES = ['lol', 'angry', 'bored', 'smart', 'oops', 'clap', 'mercy', 'easy'];
const EMOTE_GAP_MS = 2500;      // не чаще одной реакции в 2,5 секунды
// Быстрая партия: шахматные часы, у каждого полторы минуты — вся партия не дольше трёх.
// Часы идут только в твой ход, поэтому выигрывать «на зависании» не выйдет: кто тянет, тот и проигрывает
const FAST_MS = 90 * 1000;

// ---------- Чистая логика (экспортируется для тестов) ----------
const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const key = (x, y) => x * N + y;

function randomFleet(rnd = Math.random) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const busy = new Set(); // клетки кораблей и их окрестность
    const ships = [];
    let ok = true;
    for (const len of FLEET) {
      let placed = false;
      for (let t = 0; t < 300 && !placed; t++) {
        const horiz = rnd() < 0.5;
        const x0 = Math.floor(rnd() * (horiz ? N - len + 1 : N));
        const y0 = Math.floor(rnd() * (horiz ? N : N - len + 1));
        const cells = Array.from({ length: len }, (_, i) => (horiz ? [x0 + i, y0] : [x0, y0 + i]));
        if (cells.some(([x, y]) => busy.has(key(x, y)))) continue;
        for (const [x, y] of cells) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (inside(x + dx, y + dy)) busy.add(key(x + dx, y + dy));
        ships.push(cells);
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return ships;
  }
  throw new Error('fleet');
}

// Выстрел по флоту. shots — уже сделанные выстрелы по этому флоту.
// Возвращает { result: 'miss'|'hit'|'sunk', add: [новые записи выстрелов], ship?, allSunk }
function fire(ships, shots, x, y) {
  if (!inside(x, y)) throw new Error('outside');
  const done = new Set(shots.map((s) => key(s.x, s.y)));
  if (done.has(key(x, y))) throw new Error('repeat');
  const ship = ships.find((c) => c.some(([sx, sy]) => sx === x && sy === y));
  if (!ship) return { result: 'miss', add: [{ x, y, r: 'miss' }], allSunk: false };
  const hits = new Set(shots.filter((s) => s.r !== 'miss').map((s) => key(s.x, s.y)));
  hits.add(key(x, y));
  const sunk = ship.every(([sx, sy]) => hits.has(key(sx, sy)));
  if (!sunk) return { result: 'hit', add: [{ x, y, r: 'hit' }], allSunk: false };
  const add = [{ x, y, r: 'sunk' }];
  const seen = new Set([...done, key(x, y)]);
  for (const [sx, sy] of ship) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const nx = sx + dx, ny = sy + dy;
    if (!inside(nx, ny) || seen.has(key(nx, ny)) || ship.some(([a, b]) => a === nx && b === ny)) continue;
    seen.add(key(nx, ny));
    add.push({ x: nx, y: ny, r: 'miss', auto: true });
  }
  const allHits = new Set([...hits]);
  const allSunk = ships.every((c) => c.every(([sx, sy]) => allHits.has(key(sx, sy))));
  return { result: 'sunk', add, ship, allSunk };
}

// Какие корабли потоплены — по выстрелам
const sunkShips = (ships, shots) => {
  const hits = new Set(shots.filter((s) => s.r !== 'miss').map((s) => key(s.x, s.y)));
  return ships.filter((c) => c.every(([x, y]) => hits.has(key(x, y))));
};

function register(ctx) {
  const { db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, onEvent, publicLook } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY,
    a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,              -- setup | play | done
    a_ships TEXT NOT NULL, b_ships TEXT NOT NULL,
    a_ready INTEGER NOT NULL DEFAULT 0, b_ready INTEGER NOT NULL DEFAULT 0,
    a_shots TEXT NOT NULL DEFAULT '[]', -- выстрелы игрока a по флоту b
    b_shots TEXT NOT NULL DEFAULT '[]',
    turn INTEGER, winner INTEGER, resigned INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL DEFAULT 0,     -- номер последнего события, клиенту для анимации
    last TEXT,                          -- последний выстрел: { by, x, y, r }
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS battles_a ON battles(a, status);
  CREATE INDEX IF NOT EXISTS battles_b ON battles(b, status);
  CREATE TABLE IF NOT EXISTS battle_emotes (
    battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emote TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (battle_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS battle_scores (
    lo INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hi INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lo_wins INTEGER NOT NULL DEFAULT 0, hi_wins INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (lo, hi)
  );
  `);

  for (const col of ["mode TEXT NOT NULL DEFAULT 'calm'", 'clock_a INTEGER', 'clock_b INTEGER', 'turn_started INTEGER', 'timeout INTEGER NOT NULL DEFAULT 0']) {
    try { db.exec(`ALTER TABLE battles ADD COLUMN ${col}`); } catch {}
  }

  const areCrew = (x, y) => {
    const [lo, hi] = x < y ? [x, y] : [y, x];
    return !!q("SELECT 1 FROM crew WHERE lo = ? AND hi = ? AND status = 'ok'").get(lo, hi)
      || !!q('SELECT 1 FROM gang_members a JOIN gang_members b ON a.gang_id = b.gang_id WHERE a.user_id = ? AND b.user_id = ?').get(x, y);
  };
  const userRow = (id) => q('SELECT id, nick, look, profile, share_office FROM users WHERE id = ?').get(id);
  const pub = (u) => (u ? { id: u.id, nick: u.nick, look: publicLook(u) } : { id: 0, nick: 'удалённый аккаунт', look: {} });
  const side = (g, uid) => (g.a === uid ? 'a' : g.b === uid ? 'b' : null);
  const other = (s) => (s === 'a' ? 'b' : 'a');
  const load = (id, uid) => {
    let g = q('SELECT * FROM battles WHERE id = ?').get(Number(id));
    if (!g || !side(g, uid)) throw new HttpError(404, 'Партия не найдена.');
    if (checkTimeout(g)) g = q('SELECT * FROM battles WHERE id = ?').get(g.id);
    return g;
  };
  // Сколько осталось на часах у игрока прямо сейчас
  const clockLeft = (g, who) => {
    const base = g['clock_' + who] ?? FAST_MS;
    return g.status === 'play' && g.turn === g[who] ? base - (U.now() - (g.turn_started || U.now())) : base;
  };
  // Флажок упал: у того, чей ход, кончилось время — победа сопернику
  function checkTimeout(g) {
    if (g.mode !== 'fast' || g.status !== 'play') return false;
    const who = g.turn === g.a ? 'a' : 'b';
    if (clockLeft(g, who) > 0) return false;
    const winner = g[other(who)];
    q(`UPDATE battles SET status = 'done', winner = ?, timeout = 1, clock_${who} = 0, turn = NULL, seq = seq + 1, updated_at = ? WHERE id = ? AND status = 'play'`).run(winner, U.now(), g.id);
    addWin(winner, g[who]);
    const loser = userRow(g[who]);
    ping(winner, g.id, `${loser ? loser.nick : 'Соперник'} ${loser ? U.g(loser.look, 'не успел', 'не успела') : 'не успел'} — время вышло. Победа твоя!`);
    ping(g[who], g.id, 'Время вышло — партия проиграна');
    return true;
  }
  const score = (x, y) => {
    const [lo, hi] = x < y ? [x, y] : [y, x];
    const r = q('SELECT * FROM battle_scores WHERE lo = ? AND hi = ?').get(lo, hi);
    if (!r) return { me: 0, opp: 0 };
    return x === lo ? { me: r.lo_wins, opp: r.hi_wins } : { me: r.hi_wins, opp: r.lo_wins };
  };
  const addWin = (winner, loser) => {
    const [lo, hi] = winner < loser ? [winner, loser] : [loser, winner];
    q('INSERT INTO battle_scores (lo, hi) VALUES (?, ?) ON CONFLICT DO NOTHING').run(lo, hi);
    q(`UPDATE battle_scores SET ${winner === lo ? 'lo_wins' : 'hi_wins'} = ${winner === lo ? 'lo_wins' : 'hi_wins'} + 1 WHERE lo = ? AND hi = ?`).run(lo, hi);
  };
  const ping = (uid, gameId, body) => fireAndForget(notify([uid], { title: 'Морской бой', body, url: `/#battle/${gameId}`, tag: `battle-${gameId}` }));

  function view(g, uid) {
    const s = side(g, uid), o = other(s);
    const myShips = JSON.parse(g[s + '_ships']);
    const oppShips = JSON.parse(g[o + '_ships']);
    const myShots = JSON.parse(g[s + '_shots']);   // мои выстрелы по сопернику
    const oppShots = JSON.parse(g[o + '_shots']);  // его выстрелы по мне
    const last = g.last ? JSON.parse(g.last) : null;
    const oppId = g[o];
    const left = (ships, shots) => ships.length - sunkShips(ships, shots).length;
    return {
      id: g.id, status: g.status, seq: g.seq,
      myTurn: g.status === 'play' && g.turn === uid,
      ready: !!g[s + '_ready'], oppReady: !!g[o + '_ready'],
      opp: pub(userRow(oppId)),
      myShips, myShots, oppShots,
      oppSunk: sunkShips(oppShips, myShots),
      myLeft: left(myShips, oppShots), oppLeft: left(oppShips, myShots),
      oppShips: g.status === 'done' ? oppShips : null,
      winner: g.status === 'done' ? (g.winner === uid ? 'me' : 'opp') : null,
      resigned: !!g.resigned, timeout: !!g.timeout,
      mode: g.mode || 'calm',
      clock: g.mode === 'fast' ? { me: Math.max(0, clockLeft(g, s)), opp: Math.max(0, clockLeft(g, o)), total: FAST_MS } : null,
      last: last ? { mine: last.by === uid, x: last.x, y: last.y, r: last.r } : null,
      score: score(uid, oppId),
      fleet: FLEET,
      emotes: Object.fromEntries(q('SELECT user_id, emote, at FROM battle_emotes WHERE battle_id = ?').all(g.id)
        .map((r) => [r.user_id === uid ? 'mine' : 'opp', { e: r.emote, at: r.at }])),
      now: U.now()
    };
  }

  // Активная партия с подельником (для кнопки в переписке)
  route('GET', '/api/battles', async (req) => {
    const u = requireUser(req);
    const pick = () => q(`SELECT * FROM battles WHERE (a = ? OR b = ?) AND (status != 'done' OR updated_at > ?) ORDER BY updated_at DESC`)
      .all(u.id, u.id, U.now() - 864e5);
    let rows = pick();
    if (rows.some((g) => checkTimeout(g))) rows = pick();
    return {
      items: rows.map((g) => {
        const s = side(g, u.id);
        return {
          id: g.id, status: g.status, oppId: g[other(s)], mode: g.mode || 'calm',
          myTurn: (g.status === 'play' && g.turn === u.id) || (g.status === 'setup' && !g[s + '_ready']),
          winner: g.status === 'done' ? (g.winner === u.id ? 'me' : 'opp') : null
        };
      })
    };
  });

  route('POST', '/api/battle', async (req, body) => {
    const u = requireUser(req);
    const to = Number(body.to);
    if (!to || to === u.id) throw bad('С кем играем?');
    if (!areCrew(u.id, to)) throw bad('Морской бой — с членами твоих банд.');
    const ex = q(`SELECT id FROM battles WHERE status != 'done' AND ((a = ? AND b = ?) OR (a = ? AND b = ?))`).get(u.id, to, to, u.id);
    if (ex) return { id: ex.id, existing: true };
    const active = q("SELECT COUNT(*) AS n FROM battles WHERE status != 'done' AND (a = ? OR b = ?)").get(u.id, u.id).n;
    if (active >= MAX_ACTIVE) throw bad(`Одновременно можно вести ${MAX_ACTIVE} партий. Доиграй какую-нибудь.`);
    const t = U.now();
    const mode = body.mode === 'fast' ? 'fast' : 'calm';
    const r = q('INSERT INTO battles (a, b, status, a_ships, b_ships, created_at, updated_at, mode, clock_a, clock_b) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(u.id, to, 'setup', JSON.stringify(randomFleet()), JSON.stringify(randomFleet()), t, t, mode, FAST_MS, FAST_MS);
    if (onEvent) onEvent('battle_start', u.id);
    ping(to, Number(r.lastInsertRowid), mode === 'fast' ? `${u.nick} зовёт на быструю партию в морской бой — 3 минуты` : `${u.nick} вызывает на морской бой`);
    return { id: Number(r.lastInsertRowid) };
  });

  route('GET', '/api/battle/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    return view(load(params.id, u.id), u.id);
  });

  // Перемешать свой флот — пока не нажал «Готов»
  route('POST', '/api/battle/:id/shuffle', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = load(params.id, u.id);
    const s = side(g, u.id);
    if (g.status !== 'setup' || g[s + '_ready']) throw bad('Флот уже расставлен.');
    q(`UPDATE battles SET ${s}_ships = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(randomFleet()), U.now(), g.id);
    return view(load(g.id, u.id), u.id);
  });

  route('POST', '/api/battle/:id/ready', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = load(params.id, u.id);
    const s = side(g, u.id), o = other(s);
    if (g.status !== 'setup') throw bad('Партия уже идёт.');
    q(`UPDATE battles SET ${s}_ready = 1, updated_at = ? WHERE id = ?`).run(U.now(), g.id);
    if (g[o + '_ready']) {
      const first = Math.random() < 0.5 ? g.a : g.b;
      q("UPDATE battles SET status = 'play', turn = ?, turn_started = ?, seq = seq + 1 WHERE id = ?").run(first, U.now(), g.id);
      ping(g[o], g.id, first === g[o] ? `${u.nick} ${U.g(u.look, 'готов', 'готова')}. Твой выстрел первый!` : `${u.nick} ${U.g(u.look, 'готов', 'готова')} и стреляет первым`);
    } else {
      ping(g[o], g.id, `${u.nick} ${U.g(u.look, 'расставил', 'расставила')} флот и ждёт тебя`);
    }
    return view(load(g.id, u.id), u.id);
  });

  route('POST', '/api/battle/:id/shoot', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = load(params.id, u.id);
    const s = side(g, u.id), o = other(s);
    if (g.status !== 'play') throw bad(g.status === 'done' ? 'Партия закончена.' : 'Ещё расставляем флот.');
    if (g.turn !== u.id) throw bad('Сейчас ход соперника.');
    if (onEvent) onEvent('sea_shot', u.id);
    const x = Number(body.x), y = Number(body.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw bad('Куда стреляем?');
    const ships = JSON.parse(g[o + '_ships']);
    const shots = JSON.parse(g[s + '_shots']);
    let res;
    try { res = fire(ships, shots, x, y); } catch (e) { throw bad(e.message === 'repeat' ? 'Сюда уже стреляли.' : 'Мимо поля.'); }
    const t = U.now();
    const done = res.allSunk;
    const turn = res.result === 'miss' ? g[o] : u.id;
    // Быстрая партия: списываем с часов стрелявшего потраченное время, часы соперника запускаем заново
    const myClock = g.mode === 'fast' ? Math.max(0, clockLeft(g, s)) : g['clock_' + s];
    q(`UPDATE battles SET ${s}_shots = ?, turn = ?, status = ?, winner = ?, seq = seq + 1, last = ?, updated_at = ?, clock_${s} = ?, turn_started = ? WHERE id = ?`)
      .run(JSON.stringify([...shots, ...res.add]), done ? null : turn, done ? 'done' : 'play', done ? u.id : null,
        JSON.stringify({ by: u.id, x, y, r: res.result }), t, myClock, t, g.id);
    if (done) {
      const newRival = score(u.id, g[o]).me === 0;
      const myShips = JSON.parse(g[s + '_ships']);
      const clean = sunkShips(myShips, JSON.parse(g[o + '_shots'])).length === 0;
      addWin(u.id, g[o]);
      const before = q('SELECT beans FROM users WHERE id = ?').get(u.id).beans;
      if (onEvent) onEvent('sea_win', u.id, { clean, newRival });
      res.beans = q('SELECT beans FROM users WHERE id = ?').get(u.id).beans - before;
      ping(g[o], g.id, `${u.nick} ${U.g(u.look, 'потопил', 'потопила')} весь твой флот. Реванш?`);
    }
    else if (res.result === 'miss') ping(g[o], g.id, `${u.nick} ${U.g(u.look, 'промахнулся', 'промахнулась')}. Твой ход!`);
    return { result: res.result, beans: res.beans || 0, view: view(load(g.id, u.id), u.id) };
  });

  route('POST', '/api/battle/:id/emote', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = load(params.id, u.id);
    const e = String(body.e || '');
    if (!EMOTES.includes(e)) throw bad('Такой реакции нет.');
    const last = q('SELECT at FROM battle_emotes WHERE battle_id = ? AND user_id = ?').get(g.id, u.id);
    const t = U.now();
    if (last && t - last.at < EMOTE_GAP_MS) throw bad('Не так часто 🙂');
    q(`INSERT INTO battle_emotes (battle_id, user_id, emote, at) VALUES (?, ?, ?, ?)
       ON CONFLICT(battle_id, user_id) DO UPDATE SET emote = excluded.emote, at = excluded.at`).run(g.id, u.id, e, t);
    return { ok: true, at: t };
  });

  route('POST', '/api/battle/:id/resign', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = load(params.id, u.id);
    const o = other(side(g, u.id));
    if (g.status === 'done') throw bad('Партия уже закончена.');
    q("UPDATE battles SET status = 'done', winner = ?, resigned = 1, turn = NULL, seq = seq + 1, updated_at = ? WHERE id = ?").run(g[o], U.now(), g.id);
    if (g.status === 'play') addWin(g[o], u.id);
    ping(g[o], g.id, g.status === 'play' ? `${u.nick} ${U.g(u.look, 'сдался', 'сдалась')}. Победа твоя!` : `${u.nick} ${U.g(u.look, 'отказался', 'отказалась')} от партии`);
    return view(load(g.id, u.id), u.id);
  });

  function cleanup() {
    const t = U.now();
    q("DELETE FROM battles WHERE status = 'done' AND updated_at < ?").run(t - DONE_TTL_DAYS * 864e5);
    q("DELETE FROM battles WHERE status != 'done' AND updated_at < ?").run(t - IDLE_TTL_DAYS * 864e5);
  }

  return { cleanup };
}

module.exports = { register, randomFleet, fire, sunkShips, FLEET, N };
