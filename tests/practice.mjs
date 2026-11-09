// Тренировка с ботом: правила и «мозги» бота без браузера. node tests/practice.mjs
import assert from 'node:assert/strict';
import * as P from '../public/js/practice.js';
let passed = 0;
const step = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
// Детерминированный генератор, чтобы прогоны повторялись
const seeded = (s) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };

step('КНБ и кости: до двух побед, форма как у живой дуэли', () => {
  for (const game of ['rps', 'dice']) {
    const rnd = seeded(7);
    const st = P.newDuel(game);
    let guard = 0;
    while (st.status === 'play' && guard++ < 20) P.duelPlay(st, 'rock', { rnd });
    const v = P.duelView(st);
    assert.equal(v.status, 'done');
    assert.ok(['win', 'lose', 'draw'].includes(v.result));
    assert.ok(v.rounds.every((r) => r.win === null || r.me));
    if (v.result !== 'draw') assert.equal(Math.max(v.score.me, v.score.opp), 2);
  }
});
step('КНБ: против «всегда камень» сильный бот выигрывает чаще, чем проигрывает', () => {
  let w = 0, l = 0; const rnd = seeded(11);
  for (let i = 0; i < 200; i++) { const st = P.newDuel('rps'); while (st.status === 'play') P.duelPlay(st, 'rock', { rnd }); st.result === 'lose' ? w++ : st.result === 'win' ? l++ : 0; }
  assert.ok(w > l * 1.5, `бот ${w}, человек ${l}`);
});
step('крестики-нолики: сильный бот не проигрывает случайному игроку', () => {
  const rnd = seeded(3);
  for (let g = 0; g < 60; g++) {
    const st = P.newDuel('ttt', { first: g % 2 ? 'opp' : 'me' });
    if (st.turn === 'opp') P.tttBot(st, { rnd });
    while (st.status === 'play') {
      const free = st.board.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
      P.tttMe(st, free[Math.floor(rnd() * free.length)]);
      P.tttBot(st, { rnd });
    }
    assert.notEqual(st.result, 'win', 'человек обыграл непобедимого бота');
  }
});
step('крестики-нолики: лёгкий бот проигрывает хотя бы иногда, занятые клетки не принимает', () => {
  const rnd = seeded(5); let lost = 0;
  for (let g = 0; g < 80; g++) {
    const st = P.newDuel('ttt');
    while (st.status === 'play') { const free = st.board.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0); P.tttMe(st, free[Math.floor(rnd() * free.length)]); P.tttBot(st, { level: 'easy', rnd }); }
    if (st.result === 'win') lost++;
  }
  assert.ok(lost > 5, 'лёгкий бот проиграл ' + lost);
  const st = P.newDuel('ttt'); P.tttMe(st, 4); P.tttBot(st);
  assert.throws(() => P.tttMe(st, 4));
});
step('морской бой: флот по правилам, бот топит всё быстрее случайной стрельбы', () => {
  const rnd = seeded(9);
  let hardShots = 0, easyShots = 0;
  for (let g = 0; g < 30; g++) {
    for (const level of ['hard', 'easy']) {
      const st = P.newSea(rnd); P.seaStart(st); st.turn = 'opp';
      let n = 0;
      while (st.status === 'play' && n < 100) { if (st.turn === 'me') st.turn = 'opp'; P.seaBotShot(st, { level, rnd }); n++; }
      assert.equal(st.winner, 'opp');
      const cells = st.myShips.flat();
      assert.equal(cells.length, 20);
      if (level === 'hard') hardShots += n; else easyShots += n;
    }
  }
  assert.ok(hardShots / 30 < 62, 'сильный бот в среднем ' + hardShots / 30);
  assert.ok(hardShots < easyShots, `сильный ${hardShots}, лёгкий ${easyShots}`);
});
step('морской бой: мой ход, повтор выстрела запрещён, сдаться — поражение', () => {
  const st = P.newSea(seeded(1)); P.seaStart(st);
  P.seaShoot(st, 0, 0);
  if (st.turn === 'me') assert.throws(() => P.seaShoot(st, 0, 0));
  const v = P.seaView(P.seaResign(st));
  assert.equal(v.winner, 'opp'); assert.ok(v.oppShips && v.resigned);
});
console.log(`practice: ${passed} ok`);
