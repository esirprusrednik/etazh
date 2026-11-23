// Морской бой подельников: node tests/battle.js
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etazh-b-'));
const server = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server', 'index.js')], {
  env: {
    ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_PATH: path.join(dir, 'db.sqlite'),
    EMAIL_PEPPER: 'test-pepper-test-pepper-test-pepper-123', MAIL_MODE: 'console', SECURE_COOKIES: 'false', ADMIN_EMAILS: 'boss@mts.ru',
    TZ_OFFSET_HOURS: String(12 - new Date().getUTCHours())
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body) {
    const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: this.cookie, Origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    let json = null;
    try { json = JSON.parse(await res.text()); } catch {}
    return { status: res.status, json };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  async login(email, nick) {
    const r = await this.post('/api/auth/request', { email, consent: true });
    await this.post('/api/auth/code', { email, code: r.json.devCode });
    await this.post('/api/me/nick', { nick });
    this.id = (await this.get('/api/me')).json.user.id;
    return this;
  }
}
let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); throw e; }
}
const mskToday = () => new Date(Date.now() + (12 - new Date().getUTCHours()) * 3600e3).toISOString().slice(0, 10);

const { randomFleet, fire, FLEET, N } = require('../server/battle');
let winnerBeans = 0;

(async () => {
  await step('флот: правильный состав, в поле, корабли не касаются', async () => {
    for (let i = 0; i < 300; i++) {
      const f = randomFleet();
      assert.deepEqual(f.map((s) => s.length).sort(), [...FLEET].sort());
      const owner = new Map();
      f.forEach((ship, si) => ship.forEach(([x, y]) => { assert.ok(x >= 0 && y >= 0 && x < N && y < N); owner.set(x * N + y, si); }));
      f.forEach((ship, si) => ship.forEach(([x, y]) => {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const o = owner.get((x + dx) * N + (y + dy));
          if (x + dx >= 0 && x + dx < N && y + dy >= 0 && y + dy < N && o !== undefined) assert.equal(o, si);
        }
      }));
    }
  });

  await step('выстрелы: мимо, ранил, потопил с обводкой, повтор запрещён', async () => {
    const ships = [[[0, 0], [1, 0]], [[5, 5]]];
    let shots = [];
    let r = fire(ships, shots, 3, 3); assert.equal(r.result, 'miss'); shots.push(...r.add);
    assert.throws(() => fire(ships, shots, 3, 3));
    r = fire(ships, shots, 0, 0); assert.equal(r.result, 'hit'); shots.push(...r.add);
    r = fire(ships, shots, 1, 0); assert.equal(r.result, 'sunk'); shots.push(...r.add);
    assert.ok(r.add.some((s) => s.auto && s.x === 2 && s.y === 1));
    assert.ok(!r.allSunk);
    r = fire(ships, shots, 5, 5); assert.ok(r.allSunk);
  });

  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const a = await new Client().login('anna@mts.ru', 'бодрый_енот');
  const b = await new Client().login('boris@mts.ru', 'ночной_филин');
  const c = await new Client().login('cat@mts.ru', 'чужой_кот');

  let id;
  await step('вызов: любому, кто принимает личку; одна партия на пару', async () => {
    await b.post('/api/me/profile', { profile: { dmFrom: 'none' } });
    assert.equal((await a.post('/api/battle', { to: b.id })).status, 400, 'личка закрыта — вызвать нельзя');
    await b.post('/api/me/profile', { profile: { dmFrom: 'all' } });
    await a.post('/api/crew/add', { nick: 'ночной_филин' });
    await b.post(`/api/crew/${a.id}/accept`);
    id = (await a.post('/api/battle', { to: b.id })).json.id;
    assert.ok(id);
    assert.equal((await a.post('/api/battle', { to: b.id })).json.id, id);
    assert.equal((await c.get(`/api/battle/${id}`)).status, 404);
  });

  await step('расстановка: перемешать, готовность, чужой флот скрыт', async () => {
    const v1 = (await a.get(`/api/battle/${id}`)).json;
    assert.equal(v1.status, 'setup'); assert.equal(v1.oppShips, null);
    const v2 = (await a.post(`/api/battle/${id}/shuffle`)).json;
    assert.equal(v2.myShips.length, 10);
    await a.post(`/api/battle/${id}/ready`);
    assert.equal((await a.post(`/api/battle/${id}/shuffle`)).status, 400);
    const v3 = (await b.post(`/api/battle/${id}/ready`)).json;
    assert.equal(v3.status, 'play');
    assert.ok(!JSON.stringify(v3).includes('"b_ships"'));
  });

  await step('бой до победы: ход переходит после промаха, победитель и счёт', async () => {
    let guard = 0;
    while (guard++ < 400) {
      const va = (await a.get(`/api/battle/${id}`)).json;
      if (va.status === 'done') break;
      const shooter = va.myTurn ? a : b;
      const other = va.myTurn ? b : a;
      const v = (await shooter.get(`/api/battle/${id}`)).json;
      assert.equal((await other.post(`/api/battle/${id}/shoot`, { x: 0, y: 0 })).status, 400);
      // стреляем по клетке корабля соперника, если знаем; иначе по первой свободной
      const theirShips = (await other.get(`/api/battle/${id}`)).json.myShips.flat();
      const shotSet = new Set(v.myShots.map((s) => s.x * 10 + s.y));
      const target = theirShips.find(([x, y]) => !shotSet.has(x * 10 + y));
      const r = await shooter.post(`/api/battle/${id}/shoot`, { x: target[0], y: target[1] });
      assert.equal(r.status, 200);
      assert.notEqual(r.json.result, 'miss');
    }
    const fa = (await a.get(`/api/battle/${id}`)).json;
    const fb = (await b.get(`/api/battle/${id}`)).json;
    assert.equal(fa.status, 'done');
    assert.notEqual(fa.winner, fb.winner);
    assert.ok(fa.oppShips && fa.oppShips.length === 10);
    assert.equal(fa.score.me + fa.score.opp, 1);
    const winner = fa.winner === 'me' ? a : b;
    const f = (await winner.get('/api/features')).json.achievements;
    assert.ok(f.find((x) => x.id === 'sea_first').got, 'ачивка «Юнга»');
    assert.ok(f.find((x) => x.id === 'sea_clean').got, 'соперник не стрелял — «Ни царапины»');
    const ledger = winnerBeans = (await winner.get('/api/me')).json.user.beans;
    assert.ok(ledger > 0);
  });

  await step('реакции: только из списка, не чаще раза в 2,5 с, сопернику видно', async () => {
    assert.equal((await a.post(`/api/battle/${id}/emote`, { e: 'хаха' })).status, 400);
    assert.equal((await a.post(`/api/battle/${id}/emote`, { e: 'lol' })).status, 200);
    assert.equal((await a.post(`/api/battle/${id}/emote`, { e: 'clap' })).status, 400);
    const vb = (await b.get(`/api/battle/${id}`)).json;
    assert.equal(vb.emotes.opp.e, 'lol');
    assert.equal((await c.post(`/api/battle/${id}/emote`, { e: 'lol' })).status, 404);
  });

  await step('быстрая партия: часы идут только в свой ход, флажок падает — победа сопернику', async () => {
    // доигрываем/закрываем прошлую, если есть
    for (const it of (await a.get('/api/battles')).json.items) if (it.status !== 'done') await a.post(`/api/battle/${it.id}/resign`);
    const fid = (await a.post('/api/battle', { to: b.id, mode: 'fast' })).json.id;
    await a.post(`/api/battle/${fid}/ready`); await b.post(`/api/battle/${fid}/ready`);
    let v = (await a.get(`/api/battle/${fid}`)).json;
    assert.equal(v.mode, 'fast'); assert.ok(v.clock.me > 85000 && v.clock.me <= 90000);
    // подкручиваем время старта хода в прошлое — как будто игрок думал 2 минуты
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'db.sqlite'));
    db.prepare('UPDATE battles SET turn_started = ? WHERE id = ?').run(Date.now() - 120000, fid);
    db.close();
    const whoseTurn = v.myTurn ? 'a' : 'b';
    v = (await a.get(`/api/battle/${fid}`)).json;
    assert.equal(v.status, 'done'); assert.ok(v.timeout);
    assert.equal(v.winner, whoseTurn === 'a' ? 'opp' : 'me');
  });

  await step('новая партия и сдача: победа сопернику', async () => {
    const nid = (await b.post('/api/battle', { to: a.id })).json.id;
    assert.notEqual(nid, id);
    await a.post(`/api/battle/${nid}/ready`); await b.post(`/api/battle/${nid}/ready`);
    const va = (await a.get(`/api/battle/${nid}`)).json;
    const [sh, ot] = va.myTurn ? [a, b] : [b, a];
    const occ = new Set((await ot.get(`/api/battle/${nid}`)).json.myShips.flat().map(([x, y]) => x * 10 + y));
    let cell = 0; while (occ.has(cell)) cell++;
    assert.equal((await sh.post(`/api/battle/${nid}/shoot`, { x: Math.floor(cell / 10), y: cell % 10 })).json.result, 'miss');
    assert.ok((await ot.get(`/api/battle/${nid}`)).json.myTurn);
    const v = (await a.post(`/api/battle/${nid}/resign`)).json;
    assert.equal(v.winner, 'opp'); assert.ok(v.resigned);
    assert.equal((await b.get(`/api/battle/${nid}`)).json.score.me + (await b.get(`/api/battle/${nid}`)).json.score.opp, 3);
    const list = (await a.get('/api/battles')).json.items;
    assert.ok(list.length >= 1);
  });

  await step('ставка: соперник платит на «В бой», победитель забирает банк, отказ — возврат', async () => {
    const beans = async (x) => (await x.get('/api/me')).json.user.beans;
    // отказ до начала — обе ставки возвращаются
    const a0 = await beans(a);
    const g1 = (await a.post('/api/battle', { to: b.id, stake: 5 })).json.id;
    assert.equal(await beans(a), a0 - 5, 'вызвавший платит сразу');
    const v = (await b.get(`/api/battle/${g1}`)).json;
    assert.equal(v.stake, 5); assert.equal(v.needPay, true);
    await b.post(`/api/battle/${g1}/resign`);
    assert.equal(await beans(a), a0, 'отказ — ставка вернулась');
    // партия со ставкой до победы
    const a1 = await beans(a), b1 = await beans(b);
    const g2 = (await a.post('/api/battle', { to: b.id, stake: 10 })).json.id;
    await a.post(`/api/battle/${g2}/ready`);
    await b.post(`/api/battle/${g2}/ready`);
    assert.equal(await beans(b), b1 - 10, 'соперник платит на «В бой»');
    let va = (await a.get(`/api/battle/${g2}`)).json;
    const loser = va.myTurn ? b : a, winner = va.myTurn ? a : b;
    await loser.post(`/api/battle/${g2}/resign`); // сдача в бою — банк победителю
    const wa = await beans(a), wb = await beans(b);
    if (winner === a) { assert.equal(wa, a1 + 10); assert.equal(wb, b1 - 10); }
    else { assert.equal(wb, b1 + 10); assert.equal(wa, a1 - 10); }
    await loser.post(`/api/battle/${g2}/resign`);
    assert.equal(await beans(winner), winner === a ? wa : wb, 'повторно не выплачивается');
  });

  await step('своя расстановка: сервер принимает только честный флот; оформление поля покупается и включается', async () => {
    const { validFleet, randomFleet } = require('../server/battle');
    assert.ok(validFleet(randomFleet()));
    const f = randomFleet();
    assert.ok(!validFleet(f.slice(1)), 'не хватает корабля');
    assert.ok(!validFleet(f.map((sh, i) => (i === 9 ? [[f[0][0][0], f[0][0][1]]] : sh))), 'корабль на корабле');
    assert.ok(!validFleet(f.map((sh, i) => (i === 0 ? [[0, 0], [1, 1], [2, 2], [3, 3]] : sh))), 'по диагонали нельзя');
    assert.ok(!validFleet(f.map((sh, i) => (i === 9 ? [[10, 0]] : sh))), 'за полем');
    const gid = (await a.post('/api/battle', { to: b.id })).json.id;
    const v0 = (await a.get(`/api/battle/${gid}`)).json;
    assert.equal(v0.status, 'setup');
    // переставим однопалубный в первую клетку, где он честно встаёт
    const i1 = v0.myShips.findIndex((sh) => sh.length === 1);
    let moved = null;
    for (let x = 0; x < 10 && !moved; x++) for (let y = 0; y < 10 && !moved; y++) { const t = v0.myShips.map((sh, i) => (i === i1 ? [[x, y]] : sh)); if ((x !== v0.myShips[i1][0][0] || y !== v0.myShips[i1][0][1]) && validFleet(t)) moved = t; }
    const ok = await a.post(`/api/battle/${gid}/place`, { ships: moved });
    assert.equal(ok.status, 200); assert.deepEqual(ok.json.myShips[i1], moved[i1]);
    const big = v0.myShips.find((sh) => sh.length === 4);
    assert.equal((await a.post(`/api/battle/${gid}/place`, { ships: moved.map((sh, i) => (i === i1 ? [big[0]] : sh)) })).status, 400, 'вплотную — отказ');
    assert.equal((await c.post(`/api/battle/${gid}/place`, { ships: moved })).status, 404, 'чужая партия');
    await a.post(`/api/battle/${gid}/ready`);
    assert.equal((await a.post(`/api/battle/${gid}/place`, { ships: moved })).status, 400, 'после «В бой» расстановку не меняют');
    await a.post(`/api/battle/${gid}/resign`);
    // оформление поля
    const shop = (await a.get('/api/shop')).json;
    const th = shop.items.find((x) => x.id === 'sea_night');
    assert.ok(th && th.price === 40 && !th.owned);
    if (shop.beans >= 40) {
      assert.equal((await a.post('/api/shop/buy', { item: 'sea_night' })).status, 200);
      assert.equal((await a.get('/api/me')).json.user.look.sea, 'night', 'купленное включается сразу');
      await a.post('/api/shop/equip', { item: 'sea_night', on: false });
      assert.equal((await a.get('/api/me')).json.user.look.sea, null);
    }
  });

  await step('задача дня: один флот на всех, считаем выстрелы, попытка одна, таблица — только свои', async () => {
    process.env.EMAIL_PEPPER = 'test-pepper-test-pepper-test-pepper-123';
    const { fleetOf } = require('../server/seaday');
    const v0 = (await c.get('/api/sea-daily')).json;
    assert.ok(v0.day && v0.n === 0 && !v0.done && v0.ships === null && v0.left === 10, 'расстановку до конца не отдаём');
    const fleet = fleetOf(v0.day), cells = fleet.flat();
    const water = (() => { for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) if (!cells.some(([a2, b2]) => a2 === x && b2 === y)) return [x, y]; })();
    assert.equal((await c.post('/api/sea-daily/shoot', { x: water[0], y: water[1] })).json.result, 'miss');
    assert.equal((await c.post('/api/sea-daily/shoot', { x: water[0], y: water[1] })).status, 400, 'дважды в одну клетку нельзя');
    assert.equal((await c.post('/api/sea-daily/shoot', { x: 10, y: 0 })).status, 400);
    const before = (await c.get('/api/me')).json.user.beans;
    let last;
    for (const [x, y] of cells) last = (await c.post('/api/sea-daily/shoot', { x, y })).json;
    assert.ok(last.view.done && last.view.n === 21 && last.beans === 3 && last.view.place === 1 && last.view.players === 1, JSON.stringify({ n: last.view.n, b: last.beans }));
    assert.equal((await c.get('/api/me')).json.user.beans, before + 3);
    assert.equal(last.view.ships.length, 10, 'после конца флот открыт');
    assert.ok(last.view.top.length === 1 && last.view.top[0].me);
    assert.equal((await c.post('/api/sea-daily/shoot', { x: 0, y: 0 })).status, 400, 'вторая попытка — завтра');
    const va = (await a.get('/api/sea-daily')).json;
    assert.ok(va.players === 1 && va.top.length === 0 && va.n === 0, 'чужих по именам не показываем, только число игроков');
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог ---\n' + log.slice(-2000)); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
