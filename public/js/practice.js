// Тренировка с ботом: все партии идут прямо в браузере, сервер о них не знает.
// Ни зёрен, ни рейтинга, ни уведомлений — просто набить руку перед боем со своими.
// Здесь только правила и «мозги» бота; рисует app.js теми же функциями, что и настоящие дуэли.

export const BOT = {
  id: 0, nick: 'Противник', bot: true,
  look: { preset: 'm', skin: '#C9D3E3', face: 'square', hairStyle: 'bald', eyes: '#3A86FF', mouth: 'smirk', outfit: 'cyber', hoodie: 'navy', mask: 'visor', hat: 'none', bg: 'slate', glasses: false, beard: 'none' }
};

export const LEVELS = { easy: 'Лёгкий', hard: 'Сильный' };
const RPS = ['rock', 'scissors', 'paper'];
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const BEATEN_BY = { rock: 'paper', scissors: 'rock', paper: 'scissors' };
const WIN_TO = 2;
const MAX_ROUNDS = 9;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
const roll = (rnd) => 1 + Math.floor(rnd() * 6);

// ---------- Дуэли: КНБ, кости, крестики-нолики ----------
// Состояние хранится «от меня»: me — я, opp — бот. view() отдаёт ту же форму, что сервер для живой дуэли
export function newDuel(game, { first = 'me' } = {}) {
  const st = { id: 'bot', game, status: 'play', seq: 0, result: null, resigned: false, history: [] };
  if (game === 'ttt') { st.board = Array(9).fill(null); st.line = null; st.mark = first === 'me' ? 'x' : 'o'; st.turn = first; }
  else { st.rounds = [{ me: null, opp: null, win: null }]; st.score = { me: 0, opp: 0 }; }
  return st;
}

export function duelView(st) {
  const base = { id: 'bot', game: st.game, status: st.status, seq: st.seq, opp: { id: 0, nick: BOT.nick, look: BOT.look }, result: st.result, resigned: st.resigned, mine: true, stake: 0, needPay: false, oppPaid: true, practice: true };
  if (st.game === 'ttt') return { ...base, board: [...st.board], mark: st.mark, line: st.line, myTurn: st.status === 'play' && st.turn === 'me' };
  return { ...base, rounds: st.rounds.map((r) => ({ ...r })), score: { ...st.score }, winTo: WIN_TO, myTurn: st.status === 'play' };
}

// Бот в КНБ: треть ходов случайно, остальное — ловит привычки человека.
// Люди часто повторяют победный ход и меняют проигравший — на этом и играем
export function botRps(history, level = 'hard', rnd = Math.random) {
  if (level === 'easy' || !history.length || rnd() < 0.34) return pick(RPS, rnd);
  const last = history[history.length - 1];
  const count = {}; for (const h of history) count[h.me] = (count[h.me] || 0) + 1;
  const fav = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  // Выиграл — скорее повторит; проиграл — скорее сменит на то, что бьёт ход бота
  const guess = last.win === 'me' ? last.me : last.win === 'opp' ? BEATEN_BY[last.opp] : rnd() < 0.5 ? fav : last.me;
  return BEATEN_BY[guess];
}

// Ход человека в КНБ или костях: бот отвечает сразу, раунд закрывается
export function duelPlay(st, move, { level = 'hard', rnd = Math.random } = {}) {
  if (st.status !== 'play') throw new Error('Партия уже закончилась');
  const cur = st.rounds[st.rounds.length - 1];
  if (st.game === 'rps') {
    if (!RPS.includes(move)) throw new Error('Камень, ножницы или бумага?');
    cur.me = move; cur.opp = botRps(st.history, level, rnd);
    cur.win = cur.me === cur.opp ? 'draw' : BEATS[cur.me] === cur.opp ? 'me' : 'opp';
  } else {
    cur.me = [roll(rnd), roll(rnd)]; cur.opp = [roll(rnd), roll(rnd)];
    const a = cur.me[0] + cur.me[1], b = cur.opp[0] + cur.opp[1];
    cur.win = a === b ? 'draw' : a > b ? 'me' : 'opp';
  }
  st.history.push({ me: cur.me, opp: cur.opp, win: cur.win });
  if (cur.win !== 'draw') st.score[cur.win]++;
  st.seq++;
  if (st.score.me >= WIN_TO || st.score.opp >= WIN_TO) { st.status = 'done'; st.result = st.score.me >= WIN_TO ? 'win' : 'lose'; }
  else if (st.rounds.length >= MAX_ROUNDS) { st.status = 'done'; st.result = 'draw'; }
  else st.rounds.push({ me: null, opp: null, win: null });
  return st;
}

const tttWinner = (b) => { const l = LINES.find((x) => b[x[0]] && b[x[0]] === b[x[1]] && b[x[1]] === b[x[2]]); return l ? { who: b[l[0]], line: l } : null; };
// Минимакс: на сильном уровне бот не проигрывает никогда. Быстрее выигрывает, дольше тянет проигрыш
function minimax(b, who, depth = 0) {
  const w = tttWinner(b);
  if (w) return { score: w.who === 'opp' ? 10 - depth : depth - 10 };
  const free = b.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  if (!free.length) return { score: 0 };
  let best = null;
  for (const i of free) {
    b[i] = who; const r = minimax(b, who === 'opp' ? 'me' : 'opp', depth + 1); b[i] = null;
    if (!best || (who === 'opp' ? r.score > best.score : r.score < best.score)) best = { score: r.score, cell: i };
  }
  return best;
}
export function botTtt(board, level = 'hard', rnd = Math.random) {
  const free = board.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  if (!free.length) return null;
  const finish = (who) => free.find((i) => { const b = [...board]; b[i] = who; return tttWinner(b) && tttWinner(b).who === who; });
  if (level === 'easy') {
    // Лёгкий: свою тройку видит, чужую — через раз, остальное наугад
    const win = finish('opp'); if (win !== undefined) return win;
    const block = finish('me'); if (block !== undefined && rnd() < 0.5) return block;
    return pick(free, rnd);
  }
  // Первым ходом не тратим время на перебор: центр или угол
  if (free.length >= 8) return board[4] ? pick([0, 2, 6, 8], rnd) : 4;
  return minimax([...board], 'opp').cell;
}

function tttPut(st, cell, who) {
  if (st.status !== 'play') throw new Error('Партия уже закончилась');
  if (st.turn !== who) throw new Error('Сейчас ход соперника');
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || st.board[cell]) throw new Error('Эта клетка занята');
  st.board[cell] = who; st.seq++;
  const w = tttWinner(st.board);
  if (w) { st.line = w.line; st.status = 'done'; st.result = w.who === 'me' ? 'win' : 'lose'; st.turn = null; }
  else if (st.board.every(Boolean)) { st.status = 'done'; st.result = 'draw'; st.turn = null; }
  else st.turn = who === 'me' ? 'opp' : 'me';
  return st;
}
export const tttMe = (st, cell) => tttPut(st, cell, 'me');
export function tttBot(st, { level = 'hard', rnd = Math.random } = {}) {
  if (st.status !== 'play' || st.turn !== 'opp') return st;
  return tttPut(st, botTtt(st.board, level, rnd), 'opp');
}

// ---------- Морской бой ----------
// Те же правила, что на сервере: 10×10, флот 4+3+3+2+2+2+1+1+1+1, корабли не касаются даже углами.
// Попал — стреляешь ещё. Потопил — клетки вокруг открываются сами
export const N = 10;
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const key = (x, y) => x * N + y;

export function randomFleet(rnd = Math.random) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const busy = new Set(); const ships = []; let ok = true;
    for (const len of FLEET) {
      let placed = false;
      for (let t = 0; t < 300 && !placed; t++) {
        const horiz = rnd() < 0.5;
        const x0 = Math.floor(rnd() * (horiz ? N - len + 1 : N));
        const y0 = Math.floor(rnd() * (horiz ? N : N - len + 1));
        const cells = Array.from({ length: len }, (_, i) => (horiz ? [x0 + i, y0] : [x0, y0 + i]));
        if (cells.some(([x, y]) => busy.has(key(x, y)))) continue;
        for (const [x, y] of cells) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (inside(x + dx, y + dy)) busy.add(key(x + dx, y + dy));
        ships.push(cells); placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return ships;
  }
  throw new Error('fleet');
}

export function fire(ships, shots, x, y) {
  if (!inside(x, y)) throw new Error('Мимо поля');
  const done = new Set(shots.map((s) => key(s.x, s.y)));
  if (done.has(key(x, y))) throw new Error('Сюда уже стреляли');
  const ship = ships.find((c) => c.some(([sx, sy]) => sx === x && sy === y));
  if (!ship) return { result: 'miss', add: [{ x, y, r: 'miss' }], allSunk: false };
  const hits = new Set(shots.filter((s) => s.r !== 'miss').map((s) => key(s.x, s.y)));
  hits.add(key(x, y));
  if (!ship.every(([sx, sy]) => hits.has(key(sx, sy)))) return { result: 'hit', add: [{ x, y, r: 'hit' }], allSunk: false };
  const add = [{ x, y, r: 'sunk' }];
  const seen = new Set([...done, key(x, y)]);
  for (const [sx, sy] of ship) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const nx = sx + dx, ny = sy + dy;
    if (!inside(nx, ny) || seen.has(key(nx, ny)) || ship.some(([a, b]) => a === nx && b === ny)) continue;
    seen.add(key(nx, ny)); add.push({ x: nx, y: ny, r: 'miss', auto: true });
  }
  return { result: 'sunk', add, allSunk: ships.every((c) => c.every(([sx, sy]) => hits.has(key(sx, sy)))) };
}
export const sunkShips = (ships, shots) => {
  const hits = new Set(shots.filter((s) => s.r !== 'miss').map((s) => key(s.x, s.y)));
  return ships.filter((c) => c.every(([x, y]) => hits.has(key(x, y))));
};

export function newSea(rnd = Math.random) {
  return { id: 'bot', status: 'setup', seq: 0, myShips: randomFleet(rnd), botShips: randomFleet(rnd), myShots: [], botShots: [], turn: 'me', last: null, winner: null, resigned: false };
}
export function seaView(st, score = { me: 0, opp: 0 }) {
  const left = (ships, shots) => ships.length - sunkShips(ships, shots).length;
  return {
    id: 'bot', practice: true, status: st.status, seq: st.seq, myTurn: st.status === 'play' && st.turn === 'me',
    ready: st.status !== 'setup', oppReady: true, opp: { id: 0, nick: BOT.nick, look: BOT.look },
    myShips: st.myShips, myShots: st.myShots, oppShots: st.botShots,
    oppSunk: sunkShips(st.botShips, st.myShots), myLeft: left(st.myShips, st.botShots), oppLeft: left(st.botShips, st.myShots),
    oppShips: st.status === 'done' ? st.botShips : null, winner: st.winner, resigned: st.resigned, timeout: false,
    mode: 'calm', stake: 0, needPay: false, oppPaid: true, clock: null, last: st.last, score: { ...score }, fleet: FLEET, emotes: {}, now: Date.now()
  };
}
export function seaShuffle(st, rnd = Math.random) { if (st.status === 'setup') st.myShips = randomFleet(rnd); return st; }
export function seaStart(st) { if (st.status === 'setup') { st.status = 'play'; st.turn = 'me'; st.seq++; } return st; }

function shoot(st, who, x, y) {
  const mine = who === 'me';
  const ships = mine ? st.botShips : st.myShips;
  const shots = mine ? st.myShots : st.botShots;
  const r = fire(ships, shots, x, y);
  shots.push(...r.add);
  st.last = { mine, x, y, r: r.result }; st.seq++;
  if (r.allSunk) { st.status = 'done'; st.winner = who === 'me' ? 'me' : 'opp'; st.turn = null; }
  else if (r.result === 'miss') st.turn = mine ? 'opp' : 'me';
  return r;
}
export function seaShoot(st, x, y) {
  if (st.status !== 'play' || st.turn !== 'me') throw new Error('Сейчас ход противника');
  return shoot(st, 'me', x, y);
}

// Куда стрелять боту. Видит только то, что видел бы человек: свои промахи, попадания и потопленные корабли.
//  • Лёгкий: добивает раненый корабль, но часто отвлекается и стреляет наугад.
//  • Сильный: добивает по линии, а ищет по «карте вероятностей» — считает, сколько оставшихся кораблей
//    может пройти через каждую клетку, и бьёт туда, где их больше всего.
export function botAim(ships, shots, level = 'hard', rnd = Math.random) {
  const shot = new Set(shots.map((s) => key(s.x, s.y)));
  const sunk = sunkShips(ships, shots);
  const sunkCells = new Set(sunk.flat().map(([x, y]) => key(x, y)));
  const open = shots.filter((s) => s.r !== 'miss' && !sunkCells.has(key(s.x, s.y)));
  const free = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (!shot.has(key(x, y))) free.push([x, y]);
  const ok = ([x, y]) => inside(x, y) && !shot.has(key(x, y));
  // Корабли не касаются углами: клетки по диагонали от попадания пустые
  const diag = new Set();
  for (const h of open) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) diag.add(key(h.x + dx, h.y + dy));
  if (open.length && !(level === 'easy' && rnd() < 0.75)) {
    // Раненый корабль — это попадания, связанные с первым по горизонтали или вертикали
    const openSet = new Set(open.map((h) => key(h.x, h.y)));
    const cluster = [[open[0].x, open[0].y]]; const seen = new Set([key(open[0].x, open[0].y)]);
    for (let i = 0; i < cluster.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cluster[i][0] + dx, ny = cluster[i][1] + dy;
      if (openSet.has(key(nx, ny)) && inside(nx, ny) && !seen.has(key(nx, ny))) { seen.add(key(nx, ny)); cluster.push([nx, ny]); }
    }
    let cand;
    if (cluster.length >= 2) {
      const horiz = cluster[0][1] === cluster[1][1];
      const line = cluster.map(([x, y]) => (horiz ? x : y));
      const lo = Math.min(...line), hi = Math.max(...line), c = horiz ? cluster[0][1] : cluster[0][0];
      cand = horiz ? [[lo - 1, c], [hi + 1, c]] : [[c, lo - 1], [c, hi + 1]];
    } else {
      const [hx, hy] = cluster[0];
      cand = [[hx + 1, hy], [hx - 1, hy], [hx, hy + 1], [hx, hy - 1]];
    }
    cand = cand.filter(ok);
    if (!cand.length) cand = open.flatMap((h) => [[h.x + 1, h.y], [h.x - 1, h.y], [h.x, h.y + 1], [h.x, h.y - 1]]).filter(ok);
    if (cand.length) return pick(cand, rnd);
  }
  if (level === 'easy') {
    return pick(free, rnd);
  }
  // Карта вероятностей по оставшимся кораблям
  const left = [...FLEET];
  for (const s of sunk) left.splice(left.indexOf(s.length), 1);
  const heat = new Map();
  for (const len of left) {
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (const horiz of [true, false]) {
      const cells = Array.from({ length: len }, (_, i) => (horiz ? [x + i, y] : [x, y + i]));
      if (!cells.every(ok) || cells.some(([cx, cy]) => diag.has(key(cx, cy)))) continue;
      for (const [cx, cy] of cells) heat.set(key(cx, cy), (heat.get(key(cx, cy)) || 0) + 1);
    }
  }
  let best = -1, top = [];
  for (const [x, y] of free) { const h = heat.get(key(x, y)) || 0; if (h > best) { best = h; top = [[x, y]]; } else if (h === best) top.push([x, y]); }
  return pick(top.length ? top : free, rnd);
}
export function seaBotShot(st, { level = 'hard', rnd = Math.random } = {}) {
  if (st.status !== 'play' || st.turn !== 'opp') return null;
  const [x, y] = botAim(st.myShips, st.botShots, level, rnd);
  return shoot(st, 'opp', x, y);
}
export function seaResign(st) { if (st.status !== 'done') { st.status = 'done'; st.winner = 'opp'; st.resigned = true; st.turn = null; st.seq++; } return st; }
