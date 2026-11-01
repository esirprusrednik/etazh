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
  await step('вызов: только подельнику, одна партия на пару', async () => {
    assert.equal((await a.post('/api/battle', { to: b.id })).status, 400);
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
    assert.equal((await b.get(`/api/battle/${nid}`)).json.score.me + (await b.get(`/api/battle/${nid}`)).json.score.opp, 2);
    const list = (await a.get('/api/battles')).json.items;
    assert.ok(list.length >= 1);
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог ---\n' + log.slice(-2000)); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
