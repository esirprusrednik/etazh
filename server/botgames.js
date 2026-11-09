// Тренировка с сильным ботом — на сервере, чтобы ачивки нельзя было нарисовать.
// Лёгкий уровень и КНБ с костями живут только в браузере: за них ничего не дают.
// Здесь крестики-нолики и морской бой против сильного бота: сервер держит партию, флот бота клиенту не отдаёт,
// сам отвечает ходами бота. Правила и «мозги» — те же, что у клиента (public/js/practice.js).
// Зёрен за саму партию нет: только ачивки (за них — как за любые ачивки).

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const GAMES = ['ttt', 'sea'];
const KEEP_MS = 2 * 86400e3;

function register(ctx) {
  const { db, q, route, requireUser, bad, U, HttpError, rateLimit, onEvent } = ctx;
  let PR = null;
  const ready = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'practice.js')).href).then((m) => { PR = m; });

  db.exec(`
  CREATE TABLE IF NOT EXISTS bot_games (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL, state TEXT NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bot_games_user ON bot_games(user_id, game);
  `);

  const view = (g, st) => (g.game === 'sea' ? PR.seaView(st) : PR.duelView(st));
  const load = (id, uid) => {
    const g = q('SELECT * FROM bot_games WHERE id = ? AND user_id = ?').get(Number(id), uid);
    if (!g) throw new HttpError(404, 'Партия не найдена. Начни новую.');
    return g;
  };
  const save = (g, st) => q('UPDATE bot_games SET state = ?, status = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(st), st.status, U.now(), g.id);
  const resultOf = (g, st) => (g.game === 'sea' ? (st.winner === 'me' ? 'win' : st.winner ? 'lose' : null) : st.result);

  route('POST', '/api/botgame', async (req, body) => {
    const u = requireUser(req);
    await ready;
    if (!GAMES.includes(body.game)) throw bad('Такой игры нет.');
    rateLimit('botgame:' + u.id, 120, 3600e3);
    // Одна партия на игру: новая заменяет брошенную
    q('DELETE FROM bot_games WHERE (user_id = ? AND game = ?) OR updated_at < ?').run(u.id, body.game, U.now() - KEEP_MS);
    let st;
    if (body.game === 'sea') st = PR.newSea();
    else {
      // Первый ход по очереди: клиент присылает, кто начинает
      st = PR.newDuel('ttt', { first: body.first === 'opp' ? 'opp' : 'me' });
    }
    const steps = [];
    if (st.game === 'ttt' && st.turn === 'opp') { PR.tttBot(st, { level: 'hard' }); }
    const t = U.now();
    const id = Number(q('INSERT INTO bot_games (user_id, game, state, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, body.game, JSON.stringify(st), st.status, t, t).lastInsertRowid);
    steps.push(view({ game: body.game }, st));
    return { id, steps };
  });

  // Ход человека и ответ бота. steps — виды после каждого шага, чтобы клиент проиграл их по очереди
  route('POST', '/api/botgame/:id/move', async (req, body, query, params) => {
    const u = requireUser(req);
    await ready;
    const g = load(params.id, u.id);
    const st = JSON.parse(g.state);
    if (st.status === 'done') throw bad('Партия уже закончилась.');
    const steps = [];
    const was = st.status;
    try {
      if (body.resign) {
        if (g.game === 'sea') PR.seaResign(st);
        else { st.status = 'done'; st.result = 'lose'; st.resigned = true; st.turn = null; st.seq++; }
        steps.push(view(g, st));
      } else if (g.game === 'ttt') {
        PR.tttMe(st, Number(body.cell)); steps.push(view(g, st));
        if (st.status === 'play') { PR.tttBot(st, { level: 'hard' }); steps.push(view(g, st)); }
      } else if (body.shuffle) { PR.seaShuffle(st); steps.push(view(g, st)); }
      else if (body.start) { PR.seaStart(st); steps.push(view(g, st)); }
      else {
        PR.seaShoot(st, Number(body.x), Number(body.y)); steps.push(view(g, st));
        let guard = 0;
        while (st.status === 'play' && st.turn === 'opp' && guard++ < 100) { PR.seaBotShot(st, { level: 'hard' }); steps.push(view(g, st)); }
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw bad(e.message);
    }
    save(g, st);
    let ach = [];
    if (was !== 'done' && st.status === 'done' && !st.resigned && onEvent) {
      const result = resultOf(g, st);
      ach = onEvent('bot_game', u.id, { game: g.game, result }) || [];
    }
    return { steps, ach };
  });

  // Уборка: брошенные партии старше двух дней
  setInterval(() => { try { q('DELETE FROM bot_games WHERE updated_at < ?').run(U.now() - KEEP_MS); } catch {} }, 3600e3).unref();
  return {};
}

module.exports = { register };
