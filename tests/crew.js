// Проверка подельников (личных контактов): node tests/crew.js
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etazh-c-'));
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

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const a = await new Client().login('anna@mts.ru', 'бодрый_енот');
  const b = await new Client().login('boris@mts.ru', 'ночной_филин');
  const c = await new Client().login('boss@mts.ru', 'главный_бобр');
  const d = await new Client().login('dina@mts.ru', 'смелый_ёж');

  await step('заявка по нику: у получателя бейдж, до принятия переписки нет', async () => {
    assert.equal((await a.post('/api/crew/add', { nick: 'нет_такого' })).status, 400);
    assert.equal((await a.post('/api/crew/add', { nick: 'бодрый_енот' })).status, 400);
    const r = await a.post('/api/crew/add', { nick: 'НОЧНОЙ_ФИЛИН' });
    assert.equal(r.status, 200); assert.ok(r.json.pending);
    assert.equal((await b.get('/api/state')).json.badges.crew, 1);
    const cb = (await b.get('/api/crew')).json;
    assert.equal(cb.incoming[0].nick, 'бодрый_енот');
    // Писать можно и до принятия (по умолчанию личка открыта всем), но где он — не видно: не банда и не подельник
    const v0 = (await a.get(`/api/crew/${b.id}`)).json;
    assert.equal(v0.friend.where, null); assert.equal(v0.crewState, 'sent'); assert.equal(v0.cantWrite, null);
  });

  await step('принятие: оба видят друг друга в списке', async () => {
    assert.equal((await a.post(`/api/crew/${b.id}/accept`)).status, 400);
    assert.equal((await b.post(`/api/crew/${a.id}/accept`)).status, 200);
    assert.equal((await a.get('/api/crew')).json.list[0].nick, 'ночной_филин');
    assert.equal((await b.get('/api/crew')).json.list[0].nick, 'бодрый_енот');
  });

  await step('личная ссылка сразу делает подельниками, встречная заявка — тоже', async () => {
    const link = (await c.get('/api/crew')).json.link;
    const res = await fetch(BASE + '/p/' + link.slice(-6), { redirect: 'manual' });
    assert.equal(res.headers.get('location'), '/#crew=' + link.slice(-6));
    assert.ok((await a.post('/api/crew/add', { code: link })).json.accepted);
    assert.ok((await a.get('/api/crew')).json.list.some((x) => x.id === c.id));
    assert.ok((await d.post('/api/crew/add', { id: c.id })).json.pending);
    assert.ok((await c.post('/api/crew/add', { id: d.id })).json.accepted);
    await c.post(`/api/crew/${d.id}/remove`);
  });

  await step('переписка: текст и зов видны только двоим, прочтение снимает бейдж', async () => {
    await a.post(`/api/crew/${b.id}/messages`, { type: 'text', text: 'Идём на кофе после созвона?' });
    await a.post(`/api/crew/${b.id}/messages`, { type: 'call', kind: 'coffee', opt: 'Через 15 мин' });
    assert.equal((await a.post(`/api/crew/${b.id}/messages`, { type: 'call', kind: 'home' })).status, 400);
    assert.equal((await b.get('/api/state')).json.badges.crew, 2);
    const view = (await b.get(`/api/crew/${a.id}`)).json;
    assert.equal(view.messages.length, 2);
    assert.equal(view.messages[1].callText, 'зовёт на кофе');
    assert.ok(view.messages[1].canReply);
    assert.equal((await b.get('/api/state')).json.badges.crew, 0);
    // Третий подельник Анны не видит чужую переписку
    assert.equal((await c.get(`/api/crew/${b.id}`)).json.messages.length, 0);
    assert.equal((await c.get(`/api/crew/${a.id}`)).json.messages.length, 0);
    assert.equal((await a.get(`/api/crew/${b.id}`)).json.messages[0].read, true);
  });

  await step('ответ на личный зов: один раз и только получатель', async () => {
    const id = (await b.get(`/api/crew/${a.id}`)).json.messages[1].id;
    assert.equal((await a.post(`/api/dm/${id}/reply`, { label: 'Иду' })).status, 400);
    assert.equal((await c.post(`/api/dm/${id}/reply`, { label: 'Иду' })).status, 400);
    assert.equal((await b.post(`/api/dm/${id}/reply`, { label: 'Иду' })).status, 200);
    assert.equal((await b.post(`/api/dm/${id}/reply`, { label: 'Иду' })).status, 400);
    assert.equal((await a.get(`/api/crew/${b.id}`)).json.messages[1].reply, 'Иду');
  });

  await step('жалоба: только получатель, модератор видит лишь это сообщение', async () => {
    await a.post(`/api/crew/${b.id}/messages`, { type: 'text', text: 'Это сообщение уйдёт модератору' });
    const msgs = (await b.get(`/api/crew/${a.id}`)).json.messages;
    const bad = msgs[msgs.length - 1];
    assert.equal((await a.post('/api/report', { type: 'dm', id: bad.id })).status, 400);
    assert.equal((await d.post('/api/report', { type: 'dm', id: bad.id })).status, 400);
    assert.equal((await b.post('/api/report', { type: 'dm', id: bad.id })).status, 200);
    const ov = (await c.get('/api/admin/overview')).json;
    const dms = ov.reports.filter((r) => r.object_type === 'dm');
    assert.equal(dms.length, 1);
    assert.ok(dms[0].preview.text.includes('уйдёт модератору'));
    assert.ok(!JSON.stringify(ov).includes('Идём на кофе'));
  });

  await step('блок: дружба и переписка удаляются, повторная заявка молча не доходит', async () => {
    await b.post(`/api/crew/${a.id}/block`);
    assert.equal((await a.get(`/api/crew/${b.id}`)).json.messages.length, 0);
    assert.equal((await b.get(`/api/crew/${a.id}`)).status, 404, 'у заблокировавшего переписки нет');
    assert.equal((await a.get('/api/crew')).json.list.some((x) => x.id === b.id), false);
    const r = await a.post('/api/crew/add', { id: b.id });
    assert.equal(r.status, 200); assert.ok(r.json.pending);
    assert.equal((await b.get('/api/crew')).json.incoming.length, 0);
    assert.equal((await a.get('/api/crew')).json.outgoing.some((x) => x.id === b.id), true);
    assert.equal((await b.get('/api/state')).json.badges.crew, 0);
    assert.equal((await b.get('/api/crew')).json.blocked[0].nick, 'бодрый_енот');
    assert.equal((await b.post('/api/crew/add', { id: a.id })).status, 400);
    await b.post(`/api/crew/${a.id}/unblock`);
    assert.equal((await b.get('/api/crew')).json.blocked.length, 0);
  });

  await step('отпустить подельника: переписка пропадает у обоих', async () => {
    await a.post(`/api/crew/${c.id}/messages`, { type: 'text', text: 'до связи' });
    await c.post(`/api/crew/${a.id}/remove`);
    assert.equal((await a.get(`/api/crew/${c.id}`)).json.messages.length, 0);
    await c.post('/api/crew/add', { id: a.id });
    await a.post(`/api/crew/${c.id}/accept`);
    assert.equal((await a.get(`/api/crew/${c.id}`)).json.messages.length, 0);
  });

  await step('кто может писать: всем, банде, никому; подельникам — всегда', async () => {
    const e = await new Client().login('egor@mts.ru', 'тихий_омут');
    const f = await new Client().login('fedor@mts.ru', 'громкий_гусь');
    assert.equal((await e.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'привет, незнакомец' })).status, 200, 'по умолчанию — всем');
    await f.post('/api/me/profile', { profile: { dmFrom: 'none' } });
    assert.equal((await e.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'ещё раз' })).status, 200, 'начатую переписку не обрываем');
    const g = await new Client().login('gleb@mts.ru', 'новый_кот');
    const r = await g.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'привет' });
    assert.equal(r.status, 400); assert.ok(/только от подельников/.test(r.json.error));
    assert.ok((await g.get(`/api/crew/${f.id}`)).json.cantWrite);
    assert.equal((await g.get(`/api/users/${f.id}`)).json.canDm, false);
    await f.post('/api/me/profile', { profile: { dmFrom: 'gang' } });
    const gg = (await f.post('/api/gangs', { name: 'Гусятник', access: 'open', switch: true })).json;
    await g.post(`/api/gangs/${gg.id}/apply`, { switch: true });
    assert.equal((await g.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'я из банды' })).status, 200, 'банде — можно');
    const h = await new Client().login('hanna@mts.ru', 'добрая_лиса');
    assert.equal((await h.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'а мне?' })).status, 400);
    await h.post('/api/crew/add', { id: f.id }); await f.post(`/api/crew/${h.id}/accept`);
    assert.equal((await h.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'а теперь?' })).status, 200, 'подельнику — всегда');
    assert.ok((await f.get('/api/chats')).json.favorites.some((x) => x.id === h.id), 'подельник — в избранных');
  });

  await step('крестик: личка удаляется у обоих, у собеседника — «закрыл личку», писать нельзя, пока закрывший не напишет', async () => {
    const e = await new Client().login('ira@mts.ru', 'быстрый_ёрш');
    const f = await new Client().login('kira@mts.ru', 'сонная_выдра');
    await e.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'привет' });
    assert.equal((await f.post(`/api/dm/${e.id}/close`)).json.closed, true);
    assert.ok(!(await f.get('/api/chats')).json.items.some((x) => x.type === 'dm' && x.id === e.id), 'у закрывшего чата нет');
    const row = (await e.get('/api/chats')).json.items.find((x) => x.type === 'dm' && x.id === f.id);
    assert.ok(row && row.closed && /закрыл личку/.test(row.last.text));
    const v = (await e.get(`/api/crew/${f.id}`)).json;
    assert.equal(v.messages.length, 0); assert.ok(v.closedByOther);
    assert.equal((await e.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'эй' })).status, 400);
    await e.post(`/api/dm/${f.id}/close`);
    assert.ok(!(await e.get('/api/chats')).json.items.some((x) => x.type === 'dm' && x.id === f.id), 'уведомление убрано');
    assert.equal((await f.post(`/api/crew/${e.id}/messages`, { type: 'text', text: 'передумала' })).status, 200);
    assert.equal((await e.post(`/api/crew/${f.id}/messages`, { type: 'text', text: 'ура' })).status, 200, 'закрывший написал — личка снова открыта');
  });

  await step('удаление аккаунта стирает подельников и переписку', async () => {
    await d.post('/api/crew/add', { id: a.id });
    await a.post(`/api/crew/${d.id}/accept`);
    await d.post(`/api/crew/${a.id}/messages`, { type: 'text', text: 'пока' });
    await d.req('DELETE', '/api/me');
    assert.equal((await a.get('/api/crew')).json.list.some((x) => x.id === d.id), false);
    assert.equal((await a.get('/api/state')).json.badges.crew, 0);
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
  server.kill(); fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error(e); console.error(log.slice(-2000)); server.kill(); process.exit(1); });
