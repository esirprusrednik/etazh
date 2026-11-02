// Битвы банд и личные дуэли: node tests/games.js
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etazh-g-'));
const server = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server', 'index.js')], {
  env: {
    ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_PATH: path.join(dir, 'db.sqlite'),
    EMAIL_PEPPER: 'test-pepper-test-pepper-test-pepper-123', MAIL_MODE: 'console', SECURE_COOKIES: 'false', ADMIN_EMAILS: 'boss@mts.ru',
    TZ_OFFSET_HOURS: String(12 - new Date().getUTCHours()), LEAGUE_LAUNCH: '2020-01-01'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

let ipN = 0;
class Client {
  constructor() { this.cookie = ''; this.ip = '10.0.0.' + (++ipN); }
  async req(method, url, body) {
    const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: this.cookie, Origin: BASE, 'X-Forwarded-For': this.ip }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    let json = null;
    try { json = JSON.parse(await res.text()); } catch {}
    return { status: res.status, json };
  }
  get(u) { return this.req('GET', u); }
  // Старые сценарии писались, когда банд могло быть несколько: переход подтверждаем сразу (правило «одна банда» проверяется отдельно)
  post(u, b = {}) { return this.req('POST', u, this.strict || !/^\/api\/(gangs(\/join|\/\d+\/apply)?|invites\/\d+\/accept)$/.test(u) ? b : { switch: true, ...b }); }
  async login(email, nick) {
    const r = await this.post('/api/auth/request', { email, consent: true });
    await this.post('/api/auth/code', { email, code: r.json.devCode });
    const nr = await this.post('/api/me/nick', { nick }); if (nr.status !== 200) throw new Error(nick + ': ' + JSON.stringify(nr.json));
    this.id = (await this.get('/api/me')).json.user.id;
    return this;
  }
}
let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.stack); throw e; }
}

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const A1 = await new Client().login('a1@mts.ru', 'альфа_один');
  const A2 = await new Client().login('a2@mts.ru', 'альфа_два');
  const B1 = await new Client().login('b1@mts.ru', 'бета_один');
  const B2 = await new Client().login('b2@mts.ru', 'бета_два');
  const ga = (await A1.post('/api/gangs', { name: 'Альфа', access: 'open' })).json;
  const gb = (await B1.post('/api/gangs', { name: 'Бета', access: 'open' })).json;
  await A2.post(`/api/gangs/${ga.id}/apply`); await B2.post(`/api/gangs/${gb.id}/apply`);

  let war;
  await step('вызов на блиц: владелец, герой из своей банды, тема свободна', async () => {
    const meta = (await A1.get(`/api/gangwar/rivals?gang=${ga.id}&vs=${gb.id}`)).json;
    assert.ok(meta.rivals.some((r) => r.id === gb.id));
    const topic = meta.topics.find((t) => t.free);
    assert.ok(topic, 'есть открытая тема');
    assert.equal((await A2.post(`/api/gangs/${ga.id}/wars`, { to: gb.id, kind: 'blitz', topic: topic.id, hero: A2.id })).status, 400, 'не владелец');
    assert.equal((await A1.post(`/api/gangs/${ga.id}/wars`, { to: gb.id, kind: 'blitz', topic: topic.id, hero: B1.id })).status, 400, 'герой не из банды');
    const r = await A1.post(`/api/gangs/${ga.id}/wars`, { to: gb.id, kind: 'blitz', topic: topic.id, hero: A2.id });
    assert.equal(r.status, 200);
    war = r.json.id;
    assert.equal((await A1.post(`/api/gangs/${ga.id}/wars`, { to: gb.id, kind: 'sea', hero: A2.id })).status, 400, 'вторая битва с той же бандой — нельзя');
    const list = (await B2.get(`/api/gangs/${gb.id}/wars`)).json.items;
    assert.equal(list[0].status, 'pending'); assert.equal(list[0].canAccept, false, 'принимает только владелец');
    const meta2 = (await A1.get(`/api/gangwar/rivals?gang=${ga.id}&vs=${gb.id}`)).json;
    assert.equal(meta2.topics.find((t) => t.id === topic.id).free, false, 'тема занята');
  });

  async function playAll(c, id, right) {
    let v = (await c.post(`/api/wars/${id}/start`)).json;
    while (v.state === 'play') {
      const n = v.question.n;
      // первый проход — отвечаем на всё «0», второй — сначала узнаём правильный и отвечаем им же
      v = (await c.post(`/api/wars/${id}/answer`, { n, pick: right ? 0 : 1 })).json;
    }
    return v;
  }

  await step('принятие и порядок: сначала герой принявшей банды, счёт скрыт до конца', async () => {
    const acc = await B1.post(`/api/wars/${war}/accept`, { hero: B2.id });
    assert.equal(acc.status, 200); assert.equal(acc.json.status, 'active');
    assert.ok(acc.json.endsAt > Date.now());
    assert.equal((await A2.post(`/api/wars/${war}/start`)).status, 400, 'вызвавший герой ждёт');
    assert.equal((await A1.post(`/api/wars/${war}/start`)).status, 400, 'не герой');
    const done = await playAll(B2, war, true);
    assert.equal(done.state, 'done');
    const seen = (await A1.get(`/api/wars/${war}`)).json;
    assert.equal(seen.to.run.done, true); assert.equal(seen.to.run.score, null, 'счёт скрыт');
  });

  await step('второй герой проходит — итог, победителям зёрна и очки в Лигу', async () => {
    const before = (await B1.get('/api/me')).json.user.beans;
    const v = await playAll(A2, war, false);
    assert.equal(v.state, 'done');
    const res = (await B1.get(`/api/wars/${war}`)).json;
    assert.equal(res.status, 'done');
    assert.ok(['us', 'them', 'draw'].includes(res.winner));
    assert.ok(res.to.run.score !== null && res.from.run.score !== null, 'после итога счёт открыт');
    if (res.winner === 'us') assert.ok((await B1.get('/api/me')).json.user.beans > before, 'команда получила зёрна');
    const rec = (await B1.get(`/api/gangs/${gb.id}/profile`)).json.wars;
    assert.equal(rec.w + rec.l + rec.d, 1);
  });

  await step('морской бой банд: вызов, принятие создаёт быструю партию героев', async () => {
    const r = await B1.post(`/api/gangs/${gb.id}/wars`, { to: ga.id, kind: 'sea', hero: B1.id });
    assert.equal(r.status, 200);
    const v = (await A1.post(`/api/wars/${r.json.id}/accept`, { hero: A1.id })).json;
    assert.ok(v.battleId);
    const bt = (await A1.get(`/api/battle/${v.battleId}`));
    assert.equal(bt.status, 200);
  });

  await step('дуэли: КНБ вслепую, кости честно, крестики-нолики с победной линией', async () => {
    let d = (await A1.post('/api/duels', { to: B1.id, game: 'rps' })).json.duel;
    d = (await A1.post(`/api/duels/${d.id}/move`, { move: 'rock' })).json;
    assert.equal(d.myTurn, false);
    let vb = (await B1.get(`/api/duels/${d.id}`)).json;
    assert.equal(vb.rounds[0].opp, 'hidden', 'ход соперника скрыт');
    vb = (await B1.post(`/api/duels/${d.id}/move`, { move: 'scissors' })).json;
    assert.equal(vb.rounds[0].win, 'opp'); assert.equal(vb.score.opp, 1);
    await A1.post(`/api/duels/${d.id}/move`, { move: 'paper' });
    vb = (await B1.post(`/api/duels/${d.id}/move`, { move: 'rock' })).json;
    assert.equal(vb.status, 'done'); assert.equal(vb.result, 'lose');
    const dc = (await A1.post('/api/duels', { to: B1.id, game: 'dice' })).json.duel;
    const r1 = (await A1.post(`/api/duels/${dc.id}/move`, {})).json;
    assert.ok(Array.isArray(r1.rolled) && r1.rolled.every((x) => x >= 1 && x <= 6));
    const t = (await A1.post('/api/duels', { to: B1.id, game: 'ttt' })).json.duel;
    assert.equal(t.myTurn, true);
    for (const [c, cell] of [[A1, 0], [B1, 3], [A1, 1], [B1, 4]]) assert.equal((await c.post(`/api/duels/${t.id}/move`, { cell })).status, 200);
    assert.equal((await B1.post(`/api/duels/${t.id}/move`, { cell: 5 })).status, 400, 'не твой ход');
    const fin = (await A1.post(`/api/duels/${t.id}/move`, { cell: 2 })).json;
    assert.equal(fin.result, 'win'); assert.deepEqual(fin.line, [0, 1, 2]);
    await B2.post('/api/me/profile', { profile: { dmFrom: 'none' } });
    assert.equal((await A1.post('/api/duels', { to: B2.id, game: 'rps' })).status, 400, 'личка закрыта — и дуэль нельзя');
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог ---\n' + log.slice(-2000)); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
