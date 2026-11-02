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
    EMAIL_PEPPER: 'test-pepper-test-pepper-test-pepper-123', MAIL_MODE: 'console', SECURE_COOKIES: 'false', ADMIN_EMAILS: 'a1@mts.ru',
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
  const A3 = await new Client().login('a3@mts.ru', 'альфа_три');
  const B1 = await new Client().login('b1@mts.ru', 'бета_один');
  const B2 = await new Client().login('b2@mts.ru', 'бета_два');
  const B3 = await new Client().login('b3@mts.ru', 'бета_три');
  const ga = (await A1.post('/api/gangs', { name: 'Альфа', access: 'open' })).json;
  const gb = (await B1.post('/api/gangs', { name: 'Бета', access: 'open' })).json;
  await A2.post(`/api/gangs/${ga.id}/apply`); await B2.post(`/api/gangs/${gb.id}/apply`);

  let war, topic;
  await step('регламент: банды от 3 человек, владелец, герой из своей банды', async () => {
    let meta = (await A1.get(`/api/gangwar/rivals?gang=${ga.id}&vs=${gb.id}`)).json;
    topic = meta.topics.find((t) => t.free).id;
    const r0 = await A1.post(`/api/gangs/${ga.id}/wars`, { to: gb.id, kind: 'blitz', topic, hero: A2.id });
    assert.equal(r0.status, 400); assert.ok(/меньше 3/.test(r0.json.error));
    await A3.post(`/api/gangs/${ga.id}/apply`); await B3.post(`/api/gangs/${gb.id}/apply`);
    meta = (await A1.get(`/api/gangwar/rivals?gang=${ga.id}&vs=${gb.id}`)).json;
    assert.equal(meta.rivals.find((r) => r.id === gb.id).block, null);
    assert.equal((await A2.post(`/api/gangs/${ga.id}/wars`, { to: gb.id, kind: 'blitz', topic, hero: A2.id })).status, 400, 'не владелец');
    assert.equal((await A1.post(`/api/gangs/${ga.id}/wars`, { to: gb.id, kind: 'blitz', topic, hero: B1.id })).status, 400, 'герой не из банды');
  });

  await step('добровольцы: «готов быть героем» видно владельцу первым', async () => {
    await A3.post(`/api/gangs/${ga.id}/volunteer`, { on: true });
    const meta = (await A1.get(`/api/gangwar/rivals?gang=${ga.id}`)).json;
    assert.equal(meta.members[0].id, A3.id); assert.equal(meta.members[0].volunteer, true);
  });

  await step('вызов, ставки за свою банду, клич, принятие', async () => {
    const r = await A1.post(`/api/gangs/${ga.id}/wars`, { to: gb.id, kind: 'blitz', topic, hero: A2.id });
    assert.equal(r.status, 200); war = r.json.id;
    // ставки: каждый член банды, только за свою
    assert.equal((await A3.post(`/api/wars/${war}/bet`, { amount: 11 })).status, 400);
    assert.equal((await A3.post(`/api/wars/${war}/bet`, { amount: 10 })).status, 200);
    assert.equal((await A3.post(`/api/wars/${war}/bet`, { amount: 5 })).status, 400, 'одна ставка');
    await B3.post(`/api/wars/${war}/bet`, { amount: 6 });
    await A1.post(`/api/wars/${war}/cheer`);
    assert.equal((await A2.post(`/api/wars/${war}/cheer`)).status, 400, 'себя не подбадривают');
    const acc = await B1.post(`/api/wars/${war}/accept`, { hero: B2.id });
    assert.equal(acc.json.status, 'active');
    assert.equal(acc.json.to.pool, 6); assert.equal(acc.json.from.pool, 10);
    const intro = (await A2.get(`/api/wars/${war}/play`)).json;
    assert.deepEqual(intro.cheers, ['альфа_один'], 'герой видит клич');
  });

  await step('герой может отказаться до старта, владелец ставит замену', async () => {
    let v = (await B2.post(`/api/wars/${war}/step-down`)).json;
    assert.equal(v.to.hero, null);
    v = (await B1.post(`/api/wars/${war}/hero`, { hero: B3.id })).json;
    assert.equal(v.to.hero.nick, 'бета_три');
  });

  async function playAll(c, id, pick) {
    let v = (await c.post(`/api/wars/${id}/start`)).json;
    while (v.state === 'play') v = (await c.post(`/api/wars/${id}/answer`, { n: v.question.n, pick })).json;
    return v;
  }
  await step('блиц: порядок, ставки закрываются, итог и выплата банка', async () => {
    assert.equal((await A2.post(`/api/wars/${war}/start`)).status, 400, 'вызвавший ждёт');
    await playAll(B3, war, 1);
    assert.equal((await A1.post(`/api/wars/${war}/bet`, { amount: 3 })).status, 400, 'ставки закрыты после старта героя');
    assert.equal((await A1.get(`/api/wars/${war}`)).json.to.run.score, null, 'счёт скрыт');
    const before = (await A3.get('/api/me')).json.user.beans;
    await playAll(A2, war, 0);
    const res = (await A3.get(`/api/wars/${war}`)).json;
    assert.equal(res.status, 'done');
    const after = (await A3.get('/api/me')).json.user.beans;
    if (res.winner === 'us') assert.equal(res.bets.mine.payout, 16, 'ставка 10 + весь банк соперника 6');
    else if (res.winner === 'them') assert.equal(res.bets.mine.payout, 0);
    else assert.equal(res.bets.mine.payout, 10);
    assert.ok(after >= before);
  });

  await step('ротация героев и пауза перед реваншем', async () => {
    const r = await B1.post(`/api/gangs/${gb.id}/wars`, { to: ga.id, kind: 'sea', hero: B1.id });
    assert.equal(r.status, 400); assert.ok(/Реванш/.test(r.json.error));
  });

  await step('морской бой банд: принятие создаёт быструю партию героев, ротация', async () => {
    const C1 = await new Client().login('c1@mts.ru', 'гамма_один');
    const C2 = await new Client().login('c2@mts.ru', 'гамма_два');
    const C3 = await new Client().login('c3@mts.ru', 'гамма_три');
    const gc = (await C1.post('/api/gangs', { name: 'Гамма', access: 'open' })).json;
    await C2.post(`/api/gangs/${gc.id}/apply`); await C3.post(`/api/gangs/${gc.id}/apply`);
    assert.equal((await A1.post(`/api/gangs/${ga.id}/wars`, { to: gc.id, kind: 'sea', hero: A2.id })).status, 400, 'A2 бился в прошлый раз');
    const r = await A1.post(`/api/gangs/${ga.id}/wars`, { to: gc.id, kind: 'sea', hero: A1.id });
    assert.equal(r.status, 200);
    const v = (await C1.post(`/api/wars/${r.json.id}/accept`, { hero: C2.id })).json;
    assert.ok(v.battleId);
    assert.equal((await C2.get(`/api/battle/${v.battleId}`)).status, 200);
  });

  await step('отказ от вызова виден в статистике', async () => {
    const D1 = await new Client().login('d1@mts.ru', 'дельта_один');
    const D2 = await new Client().login('d2@mts.ru', 'дельта_два');
    const D3 = await new Client().login('d3@mts.ru', 'дельта_три');
    const gd = (await D1.post('/api/gangs', { name: 'Дельта', access: 'open' })).json;
    await D2.post(`/api/gangs/${gd.id}/apply`); await D3.post(`/api/gangs/${gd.id}/apply`);
    const r = await B1.post(`/api/gangs/${gb.id}/wars`, { to: gd.id, kind: 'blitz', topic: (await B1.get(`/api/gangwar/rivals?gang=${gb.id}&vs=${gd.id}`)).json.topics.find((t) => t.free).id, hero: B2.id });
    await D1.post(`/api/wars/${r.json.id}/decline`);
    assert.equal((await D2.get(`/api/gangs/${gd.id}/wars`)).json.record.declined, 1);
  });

  await step('модератор добавляет тему блица строками «вопрос | верный | неверные»', async () => {
    const lines = Array.from({ length: 8 }, (_, i) => `Вопрос ${i + 1}? | Да | Нет | Может быть`).join('\n');
    assert.equal((await A2.post('/api/admin/topics', { title: 'Тест', questions: lines })).status, 403);
    assert.equal((await A1.post('/api/admin/topics', { title: 'Мало', questions: 'Один | Да | Нет' })).status, 400);
    const r = await A1.post('/api/admin/topics', { title: 'Своя тема', emoji: '🧪', questions: lines });
    assert.equal(r.status, 200); assert.equal(r.json.count, 8);
    assert.ok((await A1.get(`/api/gangwar/rivals?gang=${ga.id}`)).json.topics.some((t) => t.title === 'Своя тема'));
  });

  await step('турнир: запись, сетка, герои, матч, чемпион', async () => {
    let t = (await A1.get('/api/tourney')).json;
    assert.equal(t.status, 'reg'); assert.ok(t.title.startsWith('Кубок'));
    await A1.post('/api/admin/tourney/add', { gang: ga.id });
    await A1.post('/api/admin/tourney/add', { gang: gb.id });
    assert.equal((await A1.post('/api/admin/tourney/start')).json.status, 'running');
    t = (await B1.get('/api/tourney')).json;
    assert.equal(t.rounds.length, 1); assert.equal(t.rounds[0].name, 'финал');
    const wid = t.rounds[0].matches[0].war;
    const wv = (await A1.get(`/api/wars/${wid}`)).json;
    assert.ok(wv.tour && wv.canSetHero);
    await A1.post(`/api/wars/${wid}/hero`, { hero: A3.id });
    await B1.post(`/api/wars/${wid}/hero`, { hero: B2.id });
    const toHero = wv.to.id === ga.id ? A3 : B2, fromHero = wv.to.id === ga.id ? B2 : A3;
    await playAll(toHero, wid, 0);
    await playAll(fromHero, wid, 1);
    t = (await A1.get('/api/tourney')).json;
    assert.equal(t.status, 'done'); assert.ok(t.champion);
    assert.equal((await A1.get(`/api/gangs/${t.champion.id}/profile`)).json.cups, 1);
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
    for (const [c, cell] of [[A1, 0], [B1, 3], [A1, 1], [B1, 4]]) assert.equal((await c.post(`/api/duels/${t.id}/move`, { cell })).status, 200);
    assert.equal((await B1.post(`/api/duels/${t.id}/move`, { cell: 5 })).status, 400, 'не твой ход');
    const fin = (await A1.post(`/api/duels/${t.id}/move`, { cell: 2 })).json;
    assert.equal(fin.result, 'win'); assert.deepEqual(fin.line, [0, 1, 2]);
    await B2.post('/api/me/profile', { profile: { dmFrom: 'none' } });
    assert.equal((await A1.post('/api/duels', { to: B2.id, game: 'rps' })).status, 400, 'личка закрыта — и дуэль нельзя');
  });

  await step('ставка в дуэли: списывается у вызвавшего, у соперника — первым ходом; отказ без потерь', async () => {
    const a0 = (await A2.get('/api/me')).json.user.beans, b0 = (await A3.get('/api/me')).json.user.beans;
    const d = (await A2.post('/api/duels', { to: A3.id, game: 'ttt', stake: 5 })).json.duel;
    assert.equal((await A2.get('/api/me')).json.user.beans, a0 - 5);
    let v = (await A3.get(`/api/duels/${d.id}`)).json;
    assert.equal(v.needPay, true);
    await A3.post(`/api/duels/${d.id}/resign`);
    assert.equal((await A2.get('/api/me')).json.user.beans, a0, 'отказ — ставка вернулась');
    assert.equal((await A3.get('/api/me')).json.user.beans, b0, 'отказавшийся ничего не потерял');
    const d2 = (await A2.post('/api/duels', { to: A3.id, game: 'ttt', stake: 5 })).json.duel;
    await A2.post(`/api/duels/${d2.id}/move`, { cell: 0 });
    await A3.post(`/api/duels/${d2.id}/move`, { cell: 3 });
    assert.equal((await A3.get('/api/me')).json.user.beans, b0 - 5, 'первым ходом — ставка');
    await A2.post(`/api/duels/${d2.id}/move`, { cell: 1 }); await A3.post(`/api/duels/${d2.id}/move`, { cell: 4 });
    await A2.post(`/api/duels/${d2.id}/move`, { cell: 2 });
    const won = (await A2.get('/api/me')).json.user.beans;
    assert.ok(won >= a0 + 5, 'победитель забрал банк');
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог ---\n' + log.slice(-2000)); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
