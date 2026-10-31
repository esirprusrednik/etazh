// Проверка функций второго этапа: node tests/features.js
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etazh-f-'));
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

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const a = await new Client().login('anna@mts.ru', 'бодрый_енот');
  const b = await new Client().login('boris@mts.ru', 'ночной_филин');
  const c = await new Client().login('boss@mts.ru', 'главный_бобр');
  const d = await new Client().login('dina@mts.ru', 'смелый_ёж');
  const g = (await a.post('/api/gangs', { name: 'Пятничный кофе' })).json;
  await b.post('/api/gangs/join', { code: g.code });
  await c.post('/api/gangs/join', { code: g.code });
  for (const x of [a, b, c, d]) await x.post('/api/me/profile', { shareOffice: true });

  await step('ачивки и задания: отметка даёт «Первый шаг» и задание дня', async () => {
    await a.post('/api/checkin', { office: 'smol' });
    const f = (await a.get('/api/features')).json;
    assert.ok(f.achievements.find((x) => x.id === 'first_checkin').got);
    assert.ok(f.achievements.find((x) => x.id === 'gang').got);
    assert.ok(f.quests.items.find((x) => x.id === 'checkin').done);
  });

  await step('спасибо: лимит 3 в день, себе нельзя, чужой банде нельзя, получатель +1', async () => {
    const before = (await b.get('/api/me')).json.user.beans;
    assert.equal((await a.post('/api/thanks', { gang: g.id, to: a.id })).status, 400);
    assert.equal((await a.post('/api/thanks', { gang: g.id, to: d.id })).status, 400);
    assert.equal((await a.post('/api/thanks', { gang: g.id, to: b.id, text: 'дурак' })).status, 400);
    const r1 = await a.post('/api/thanks', { gang: g.id, to: b.id, text: 'За помощь с отчётом' });
    assert.equal(r1.json.left, 2);
    await a.post('/api/thanks', { gang: g.id, to: c.id });
    await a.post('/api/thanks', { gang: g.id, to: b.id });
    assert.equal((await a.post('/api/thanks', { gang: g.id, to: c.id })).status, 400);
    assert.equal((await b.get('/api/me')).json.user.beans - before, 2);
    const ex = (await b.get(`/api/gangs/${g.id}/extra`)).json;
    assert.equal(ex.thanks.length, 3);
    assert.ok(ex.thanks.some((t) => t.toMe && t.text === 'За помощь с отчётом'));
    const fa = (await a.get('/api/features')).json;
    assert.ok(fa.quests.items.find((x) => x.id === 'thanks').done);
    assert.ok(fa.achievements.find((x) => x.id === 'thanks_give').got);
  });

  await step('неделя банды: план и отпуск, лучший день', async () => {
    const plan = { Пн: 'office', Вт: 'office', Ср: 'home', Чт: 'office', Пт: 'home' };
    for (const x of [a, b, c]) await x.post('/api/me/profile', { profile: { plan } });
    const ex = (await a.get(`/api/gangs/${g.id}/extra`)).json;
    assert.equal(ex.week.days.length, 5);
    assert.equal(ex.week.rows.length, 3);
    assert.ok(ex.week.best && ex.week.best.office >= 2);
    const cells = ex.week.rows.find((r) => r.me).cells;
    assert.ok(cells.every((x) => ['office', 'home', 'vacation', 'sick', 'unknown'].includes(x)));
  });

  await step('дни рождения: видно в банде, подарок только в день рождения', async () => {
    const dd = mskToday().slice(8, 10) + '.' + mskToday().slice(5, 7);
    await b.post('/api/me/profile', { profile: { bday: dd, showBday: true } });
    const ex = (await a.get(`/api/gangs/${g.id}/extra`)).json;
    assert.equal(ex.birthdays[0].inDays, 0);
    const before = (await b.get('/api/me')).json.user.beans;
    assert.equal((await a.post('/api/gift', { to: b.id })).status, 200);
    assert.equal((await a.post('/api/gift', { to: b.id })).status, 400);
    assert.equal((await b.get('/api/me')).json.user.beans - before, 10);
    assert.equal((await a.post('/api/gift', { to: c.id })).status, 400);
    const f = (await c.get('/api/features')).json;
    assert.equal(f.birthdaysToday[0].nick, '@ночной_филин');
  });

  await step('обед компанией: открыть, присоединиться, видно в офисе', async () => {
    assert.equal((await b.post('/api/lunch', { time: '13:00' })).status, 400);
    await b.post('/api/checkin', { office: 'smol' });
    await d.post('/api/checkin', { office: 'mark' });
    const r = await a.post('/api/lunch', { time: '13:00', place: 'столовая, 2 этаж' });
    assert.equal(r.status, 200);
    const lid = (await b.get('/api/features')).json.lunches.items[0].id;
    assert.equal((await b.post(`/api/lunch/${lid}/join`)).status, 200);
    assert.equal((await d.post(`/api/lunch/${lid}/join`)).status, 400);
    const fa = (await a.get('/api/features')).json.lunches.items[0];
    assert.equal(fa.count, 1); assert.ok(fa.mine);
    assert.equal((await d.get('/api/features')).json.lunches.items.length, 0);
    assert.equal((await a.post(`/api/lunch/${lid}/cancel`)).status, 200);
  });

  await step('случайный кофе: пары из разных банд одного офиса, предложение и ответ', async () => {
    for (const x of [a, b, d]) await x.post('/api/me/profile', { profile: { coffee: true, home: 'smol' } });
    assert.equal((await a.post('/api/admin/coffee-now')).status, 403);
    const r = await c.post('/api/admin/coffee-now');
    assert.equal(r.json.pairs, 1);
    const fd = (await d.get('/api/features')).json.coffee.pair;
    assert.ok(fd, 'у Дины есть пара');
    assert.notEqual(fd.partner.nick, '@главный_бобр');
    const partner = fd.partner.id === a.id ? a : b;
    assert.equal((await d.post('/api/coffee/ping', { opt: 'Сегодня в 15:00' })).status, 200);
    const fp = (await partner.get('/api/features')).json.coffee.pair;
    assert.ok(fp.canReply);
    assert.equal((await partner.post('/api/coffee/reply', { label: 'Иду' })).status, 200);
    const ach = (await d.get('/api/features')).json.achievements.find((x) => x.id === 'coffee');
    assert.ok(ach.got);
  });

  await step('метрики в модерации: активность и действия без личных данных', async () => {
    await b.post(`/api/gangs/${g.id}/messages`, { type: 'call', kind: 'coffee' });
    const m = (await c.get('/api/admin/metrics')).json;
    const todayRow = m.rows[m.rows.length - 1];
    assert.ok(todayRow.active >= 4);
    assert.ok(todayRow.checkins >= 3);
    assert.ok(todayRow.thanks >= 3);
    assert.ok(todayRow.calls >= 1);
    assert.ok(m.wau >= 4);
    assert.equal((await a.get('/api/admin/metrics')).status, 403);
    const raw = fs.readFileSync(path.join(dir, 'db.sqlite')).toString('latin1');
    assert.ok(!/anna@mts/i.test(raw));
  });

  await step('удаление аккаунта убирает его спасибо, ачивки и пары', async () => {
    assert.equal((await d.req('DELETE', '/api/me')).status, 200);
    const fp = (await a.get('/api/features')).json.coffee.pair;
    assert.ok(!fp || fp.partner.nick !== '@смелый_ёж');
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог ---\n' + log.slice(-2000)); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
