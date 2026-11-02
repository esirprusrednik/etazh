// Личные дуэли: камень-ножницы-бумага, кости и крестики-нолики. Только один на один, в личке.
// Бросить вызов можно тому, кому можно написать лично. Дуэль начинается сразу, соперник может сдаться.
//  • КНБ: ходы вслепую, раунд открывается, когда сходили оба. До двух побед.
//  • Кости: каждый бросает две кости, у кого сумма больше — тот взял раунд. До двух побед. Бросает сервер — честно.
//  • Крестики-нолики: вызвавший ходит крестиками первым.
// Победителю — пара зёрен (не больше трёх раз в день). Брошенная на 3 дня дуэль закрывается без победителя.

const GAMES = { rps: 'Камень, ножницы, бумага', dice: 'Кости', ttt: 'Крестики-нолики' };
const RPS = ['rock', 'scissors', 'paper'];
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const WIN_TO = 2;
const MAX_ROUNDS = 9;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const STALE_DAYS = 3;
const roll = () => 1 + Math.floor(Math.random() * 6);

function register(ctx) {
  const { db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, addBeans, canDm, publicLook, onEvent } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS duels (
    id INTEGER PRIMARY KEY,
    a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'play',
    state TEXT NOT NULL, turn INTEGER, winner INTEGER, resigned INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS duels_a ON duels(a, status);
  CREATE INDEX IF NOT EXISTS duels_b ON duels(b, status);
  `);

  const userRow = (id) => q('SELECT * FROM users WHERE id = ? AND nick IS NOT NULL').get(id);
  const side = (d, uid) => (d.a === uid ? 'a' : d.b === uid ? 'b' : null);
  const other = (s) => (s === 'a' ? 'b' : 'a');
  const load = (id, uid) => {
    const d = q('SELECT * FROM duels WHERE id = ?').get(Number(id));
    if (!d || !side(d, uid)) throw new HttpError(404, 'Дуэль не найдена.');
    return d;
  };
  function initState(game) {
    if (game === 'ttt') return { board: Array(9).fill(null), line: null };
    return { rounds: [{ a: null, b: null }], score: { a: 0, b: 0 } };
  }

  function view(d, uid) {
    const s = side(d, uid), o = other(s);
    const st = JSON.parse(d.state);
    const opp = userRow(d[o]);
    const base = {
      id: d.id, game: d.game, gameName: GAMES[d.game], status: d.status, seq: d.seq, me: s,
      opp: opp ? { id: opp.id, nick: opp.nick, look: publicLook(opp) } : { id: 0, nick: 'удалённый аккаунт', look: {} },
      result: d.status === 'done' ? (d.winner ? (d.winner === uid ? 'win' : 'lose') : 'draw') : null, resigned: !!d.resigned,
      mine: d.a === uid
    };
    if (d.game === 'ttt') {
      return { ...base, board: st.board.map((c) => (c ? (c === s ? 'me' : 'opp') : null)), mark: s === 'a' ? 'x' : 'o', line: st.line, myTurn: d.status === 'play' && d.turn === uid };
    }
    // КНБ и кости: ход соперника в текущем раунде скрыт, пока не сходил я
    const rounds = st.rounds.map((r, i) => {
      const last = i === st.rounds.length - 1 && d.status === 'play';
      const both = r.a !== null && r.b !== null;
      return { me: r[s], opp: both || !last ? r[o] : r[o] !== null ? 'hidden' : null, win: both ? r.win === s ? 'me' : r.win === o ? 'opp' : 'draw' : null };
    });
    const cur = st.rounds[st.rounds.length - 1];
    return { ...base, rounds, score: { me: st.score[s], opp: st.score[o] }, winTo: WIN_TO, myTurn: d.status === 'play' && cur[s] === null };
  }

  function save(d, st, patch = {}) {
    const f = { ...patch, state: JSON.stringify(st), seq: d.seq + 1, updated_at: U.now() };
    const keys = Object.keys(f);
    q(`UPDATE duels SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), d.id);
    return q('SELECT * FROM duels WHERE id = ?').get(d.id);
  }
  function finish(d, winner) {
    if (winner) {
      addBeans(winner, 'duel_win');
      if (onEvent) onEvent('duel_win', winner);
    }
  }
  const ping = (uid, by, d, text) => fireAndForget(notify([uid], { title: `${GAMES[d.game]}: ${by.nick}`, body: text, url: `/#crew/${by.id}`, tag: `duel-${d.id}` }));

  route('GET', '/api/duels', async (req, body, query) => {
    const u = requireUser(req);
    const w = Number(query.with) || null;
    const rows = w
      ? q(`SELECT * FROM duels WHERE ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND (status = 'play' OR updated_at > ?) ORDER BY id DESC LIMIT 6`).all(u.id, w, w, u.id, U.now() - 864e5)
      : q("SELECT * FROM duels WHERE (a = ? OR b = ?) AND status = 'play' ORDER BY updated_at DESC LIMIT 20").all(u.id, u.id);
    return { items: rows.map((d) => view(d, u.id)), games: GAMES };
  });

  route('POST', '/api/duels', async (req, body) => {
    const u = requireUser(req);
    const t = userRow(Number(body.to));
    if (!t || t.id === u.id) throw bad('С кем дуэль?');
    if (!GAMES[body.game]) throw bad('Выбери игру.');
    if (!canDm(u, t)) throw bad('Этому человеку сейчас нельзя написать — значит, и вызвать нельзя.');
    const ex = q(`SELECT id FROM duels WHERE status = 'play' AND game = ? AND ((a = ? AND b = ?) OR (a = ? AND b = ?))`).get(body.game, u.id, t.id, t.id, u.id);
    if (ex) return { id: ex.id, existing: true };
    if (q("SELECT COUNT(*) AS n FROM duels WHERE status = 'play' AND (a = ? OR b = ?)").get(u.id, u.id).n >= 10) throw bad('Одновременно — не больше 10 дуэлей. Доиграй какую-нибудь.');
    const now = U.now();
    const id = Number(q('INSERT INTO duels (a, b, game, state, turn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(u.id, t.id, body.game, JSON.stringify(initState(body.game)), body.game === 'ttt' ? u.id : null, now, now).lastInsertRowid);
    ping(t.id, u, { id, game: body.game }, `${U.g(u.look, 'Вызвал', 'Вызвала')} тебя на дуэль — ответь в личке`);
    if (onEvent) onEvent('duel', u.id);
    return { id, duel: view(q('SELECT * FROM duels WHERE id = ?').get(id), u.id) };
  });

  route('GET', '/api/duels/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    return view(load(params.id, u.id), u.id);
  });

  route('POST', '/api/duels/:id/move', async (req, body, query, params) => {
    const u = requireUser(req);
    let d = load(params.id, u.id);
    if (d.status !== 'play') throw bad('Дуэль уже закончилась.');
    const s = side(d, u.id), o = other(s);
    const st = JSON.parse(d.state);
    const opp = d[o];
    let extra = {};
    if (d.game === 'ttt') {
      if (d.turn !== u.id) throw bad('Сейчас ход соперника.');
      const cell = Number(body.cell);
      if (!Number.isInteger(cell) || cell < 0 || cell > 8 || st.board[cell]) throw bad('Эта клетка занята.');
      st.board[cell] = s;
      const line = LINES.find((l) => l.every((i) => st.board[i] === s));
      if (line) { st.line = line; d = save(d, st, { status: 'done', winner: u.id, turn: null }); finish(d, u.id); ping(opp, u, d, 'Три в ряд — партия за мной!'); }
      else if (st.board.every(Boolean)) { d = save(d, st, { status: 'done', winner: null, turn: null }); ping(opp, u, d, 'Ничья — поле кончилось'); }
      else { d = save(d, st, { turn: opp }); ping(opp, u, d, 'Твой ход в крестиках-ноликах'); }
      return view(d, u.id);
    }
    const cur = st.rounds[st.rounds.length - 1];
    if (cur[s] !== null) throw bad('Ждём соперника.');
    if (d.game === 'rps') {
      if (!RPS.includes(body.move)) throw bad('Камень, ножницы или бумага?');
      cur[s] = body.move;
    } else {
      cur[s] = [roll(), roll()];
      extra.rolled = cur[s];
    }
    if (cur[o] !== null) {
      const win = d.game === 'rps'
        ? (cur.a === cur.b ? null : BEATS[cur.a] === cur.b ? 'a' : 'b')
        : (cur.a[0] + cur.a[1] === cur.b[0] + cur.b[1] ? null : cur.a[0] + cur.a[1] > cur.b[0] + cur.b[1] ? 'a' : 'b');
      cur.win = win;
      if (win) st.score[win]++;
      if (st.score.a >= WIN_TO || st.score.b >= WIN_TO) {
        const w = st.score.a >= WIN_TO ? d.a : d.b;
        d = save(d, st, { status: 'done', winner: w }); finish(d, w);
        ping(opp, u, d, w === u.id ? 'Дуэль за мной. Реванш?' : 'Ты победил(а) в дуэли!');
      } else if (st.rounds.length >= MAX_ROUNDS) {
        d = save(d, st, { status: 'done', winner: null }); ping(opp, u, d, 'Ничья — раунды кончились');
      } else {
        st.rounds.push({ a: null, b: null });
        d = save(d, st);
        ping(opp, u, d, `Раунд сыгран: ${st.score[o]}:${st.score[s]}. Твой ход`);
      }
    } else {
      d = save(d, st);
      ping(opp, u, d, d.game === 'rps' ? 'Сделал(а) ход — твоя очередь' : 'Бросил(а) кости — твоя очередь');
    }
    return { ...view(d, u.id), ...extra };
  });

  route('POST', '/api/duels/:id/resign', async (req, body, query, params) => {
    const u = requireUser(req);
    let d = load(params.id, u.id);
    if (d.status !== 'play') return view(d, u.id);
    const opp = d[other(side(d, u.id))];
    d = save(d, JSON.parse(d.state), { status: 'done', winner: opp, resigned: 1, turn: null });
    finish(d, opp);
    ping(opp, u, d, 'Сдался(лась) — победа твоя');
    return view(d, u.id);
  });

  function cleanup() {
    q("UPDATE duels SET status = 'done', winner = NULL WHERE status = 'play' AND updated_at < ?").run(U.now() - STALE_DAYS * 864e5);
    q("DELETE FROM duels WHERE status = 'done' AND updated_at < ?").run(U.now() - 30 * 864e5);
  }
  // Сколько дуэлей ждут моего хода — для бейджа «Игр»
  function myTurns(uid) {
    return q("SELECT * FROM duels WHERE status = 'play' AND (a = ? OR b = ?)").all(uid, uid).filter((d) => view(d, uid).myTurn).length;
  }

  return { cleanup, myTurns };
}

module.exports = { register, GAMES };
