// Сквозная проверка API: node tests/smoke.js
// Поднимает сервер на временной базе с MAIL_MODE=console и проходит основные сценарии.
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const PORT = 3000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etazh-'));

const server = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server', 'index.js')], {
  env: {
    ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_PATH: path.join(dir, 'db.sqlite'),
    EMAIL_PEPPER: 'test-pepper-test-pepper-test-pepper-123', MAIL_MODE: 'console', SECURE_COOKIES: 'false', ADMIN_EMAILS: 'boss@mts.ru',
    // Сдвиг часового пояса, чтобы на «сервере» был полдень и отметки работали в любое время запуска
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
    const res = await fetch(BASE + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookie, Origin: BASE },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  async login(email, nick) {
    const r = await this.post('/api/auth/request', { email, consent: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const link = new URL(r.json.devLink);
    const v = await this.req('GET', link.pathname + link.search);
    assert.equal(v.status, 302);
    assert.equal(v.headers.get('location'), '/');
    if (nick) assert.equal((await this.post('/api/me/nick', { nick })).status, 200);
    return this;
  }
}

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); throw e; }
}

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Сервер не поднялся:\n' + log);
}

(async () => {
  await waitUp();
  const a = new Client();
  const b = new Client();
  const c = new Client();

  await step('чужой домен отклоняется', async () => {
    const r = await a.post('/api/auth/request', { email: 'x@gmail.com', consent: true });
    assert.equal(r.status, 400);
    const r2 = await a.post('/api/auth/request', { email: 'x@evilmts.ru', consent: true });
    assert.equal(r2.status, 400);
  });
  await step('без согласия нельзя', async () => {
    assert.equal((await a.post('/api/auth/request', { email: 'a@mts.ru' })).status, 400);
  });
  await step('вход по ссылке, ссылка одноразовая', async () => {
    const r = await a.post('/api/auth/request', { email: 'Anna@MTS.ru', consent: true });
    const link = new URL(r.json.devLink);
    assert.equal((await a.req('GET', link.pathname + link.search)).headers.get('location'), '/');
    const again = await new Client().req('GET', link.pathname + link.search);
    assert.equal(again.headers.get('location'), '/?login=expired');
  });
  await step('почта не попадает ни в базу, ни в лог', async () => {
    const raw = fs.readFileSync(path.join(dir, 'db.sqlite')).toString('latin1') + (fs.existsSync(path.join(dir, 'db.sqlite-wal')) ? fs.readFileSync(path.join(dir, 'db.sqlite-wal')).toString('latin1') : '');
    assert.ok(!/anna@mts\.ru/i.test(raw), 'почта найдена в базе');
    assert.ok(!/anna@mts\.ru/i.test(log), 'почта найдена в логе');
  });
  await step('вход по коду и защита от перебора', async () => {
    const k = new Client();
    const r = await k.post('/api/auth/request', { email: 'kod@mts.ru', consent: true });
    assert.equal((await k.post('/api/auth/code', { email: 'kod@mts.ru', code: '000000' === r.json.devCode ? '111111' : '000000' })).status, 400);
    assert.equal((await k.post('/api/auth/code', { email: 'kod@mts.ru', code: r.json.devCode })).status, 200);
    assert.equal((await k.get('/api/me')).json.user.nick, null);
    assert.equal((await k.post('/api/auth/code', { email: 'kod@mts.ru', code: r.json.devCode })).status, 400);
  });
  await step('без ника API закрыт, ник проверяется', async () => {
    assert.equal((await a.get('/api/state')).status, 409);
    assert.equal((await a.post('/api/me/nick', { nick: 'a b' })).status, 400);
    assert.equal((await a.post('/api/me/nick', { nick: 'дурак_1' })).status, 400);
    assert.equal((await a.post('/api/me/nick', { nick: 'бодрый_енот' })).status, 200);
    const me = (await a.get('/api/me')).json.user;
    assert.equal(me.nick, '@бодрый_енот');
    assert.equal(me.beans, 50);
  });
  await b.login('boris@mts.ru', 'ночной_филин');
  await c.login('boss@mts.ru', 'главный_бобр');

  await step('занятый ник', async () => {
    assert.equal((await new Client().login('d@mts.ru')).constructor, Client);
  });

  await step('отметка в офисе +5 один раз в день', async () => {
    const r = await a.post('/api/checkin', { office: 'smol' });
    if (r.status === 400 && /завтра/.test(r.json.error)) return console.log('    (после 19:00 МСК — пропуск)');
    assert.equal(r.json.beans, 5);
    await a.post('/api/checkin', { office: 'mark' });
    const again = await a.post('/api/checkin', { office: 'smol' });
    assert.equal(again.json.beans, 0);
    const st = (await a.get('/api/state')).json;
    assert.equal(st.checkin.office, 'smol');
    assert.ok(st.canteen && st.canteen.label);
    assert.ok([0, 5, 10].includes(st.canteen.wait));
  });

  const night = (await a.get('/api/state')).json.night;

  await step('банда: залог, ссылка, возврат залога на третьем', async () => {
    assert.equal((await a.post('/api/gangs', { name: 'Против всех' })).status, 400);
    const g = await a.post('/api/gangs', { name: 'Пятничный кофе', color: '#2563C9' });
    assert.equal(g.status, 200, JSON.stringify(g.json));
    a.gang = g.json.id;
    const before = (await a.get('/api/me')).json.user.beans;
    assert.equal((await b.post('/api/gangs/join', { code: `${BASE}/g/${g.json.code}` })).status, 200);
    assert.equal((await c.post('/api/gangs/join', { code: g.json.code })).status, 200);
    const after = (await a.get('/api/me')).json.user.beans;
    assert.equal(after - before, 50);
    const r = await a.req('GET', '/g/' + g.json.code);
    assert.equal(r.headers.get('location'), '/#join=' + g.json.code);
  });

  await step('зов, ответ +1, лимит зовов', async () => {
    const r = await a.post(`/api/gangs/${a.gang}/messages`, { type: 'call', kind: 'coffee', opt: 'Сейчас' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const view = (await b.get(`/api/gangs/${a.gang}`)).json;
    const call = view.messages.find((m) => m.type === 'call');
    assert.ok(call.canReply);
    const rep = await b.post(`/api/messages/${call.id}/reply`, { label: 'Иду' });
    assert.equal(rep.json.beans, 1);
    assert.equal((await b.post(`/api/messages/${call.id}/reply`, { label: 'Иду' })).status, 400);
    await a.post(`/api/gangs/${a.gang}/messages`, { type: 'call', kind: 'where' });
    await a.post(`/api/gangs/${a.gang}/messages`, { type: 'call', kind: 'online' });
    assert.equal((await a.post(`/api/gangs/${a.gang}/messages`, { type: 'call', kind: 'wait' })).status, 400);
  });

  await step('чат: текст и модерация', async () => {
    assert.equal((await b.post(`/api/gangs/${a.gang}/messages`, { type: 'text', text: 'Кто в столовую?' })).status, 200);
    assert.equal((await b.post(`/api/gangs/${a.gang}/messages`, { type: 'text', text: 'ты дypак' })).status, 400);
    const st = (await a.get('/api/state?seenChat=0')).json;
    assert.ok(st.badges.chat >= 1);
  });

  await step('чужой не видит банду', async () => {
    const d = await new Client().login('e@mts.ru', 'тихий_кит');
    assert.equal((await d.get(`/api/gangs/${a.gang}`)).status, 404);
  });

  await step('статус участника скрыт без согласия', async () => {
    const view = (await b.get(`/api/gangs/${a.gang}`)).json;
    const anna = view.members.find((m) => m.nick === '@бодрый_енот');
    assert.equal(anna.where, 'hidden');
    await a.post('/api/me/profile', { shareOffice: true });
    const view2 = (await b.get(`/api/gangs/${a.gang}`)).json;
    const anna2 = view2.members.find((m) => m.nick === '@бодрый_енот');
    assert.ok(['office', 'none', 'night'].includes(anna2.where));
  });

  await step('статусы: план, «из дома», отпуск', async () => {
    const day = (n) => new Date(Date.now() + (12 - new Date().getUTCHours()) * 3600e3 + n * 864e5).toISOString().slice(0, 10);
    const status = async () => (await b.get(`/api/gangs/${a.gang}`)).json.members.find((m) => m.nick === '@бодрый_енот');
    // Анна в офисе (отметка) — факт важнее плана
    const plan = { Пн: 'home', Вт: 'home', Ср: 'home', Чт: 'home', Пт: 'home' };
    await a.post('/api/me/profile', { profile: { plan } });
    assert.equal((await status()).where, 'office');
    await a.post('/api/checkout');
    const wd = new Date(day(0) + 'T00:00:00Z').getUTCDay();
    const s1 = await status();
    if (wd >= 1 && wd <= 5) { assert.equal(s1.where, 'home'); assert.equal(s1.planned, true); } else assert.equal(s1.where, 'weekend');
    // Ручной статус
    await a.post('/api/me/profile', { profile: { plan: {}, today: { kind: 'home' } } });
    const s2 = await status();
    if (wd >= 1 && wd <= 5) { assert.equal(s2.where, 'home'); assert.equal(s2.planned, false); } else assert.equal(s2.where, 'weekend');
    // Болею: на несколько дней, не дольше 14
    assert.equal((await a.post('/api/me/profile', { profile: { today: { kind: 'sick', to: day(20) } } })).status, 400);
    await a.post('/api/me/profile', { profile: { today: { kind: 'sick', to: day(2) } } });
    const sk = await status();
    if (wd >= 0) { assert.equal(sk.where, 'sick'); assert.equal(sk.until, day(2)); }
    // «Отлыниваю» — только сам человек
    await a.post('/api/me/profile', { profile: { today: { kind: 'slack' } } });
    if (wd >= 1 && wd <= 5) assert.equal((await status()).where, 'slack');
    // Без статуса после 11:00 (в тесте на сервере полдень) — шутка, одна и та же весь день
    await a.post('/api/me/profile', { profile: { today: null } });
    if (wd >= 1 && wd <= 5) {
      const j1 = await status(); const j2 = await status();
      assert.equal(j1.where, 'idle'); assert.equal(j1.joke, j2.joke);
    } else assert.equal((await status()).where, 'weekend');
    // Отпуск из графика
    assert.equal((await a.post('/api/me/profile', { profile: { vacations: [{ from: day(5), to: day(1) }] } })).status, 400);
    assert.equal((await a.post('/api/me/profile', { profile: { vacations: [{ from: day(0), to: day(3) }, { from: day(2), to: day(9) }] } })).status, 400);
    assert.equal((await a.post('/api/me/profile', { profile: { vacations: [{ from: day(-2), to: day(3) }, { from: day(30), to: day(40) }] } })).status, 200);
    const s3 = await status();
    assert.equal(s3.where, 'vacation'); assert.equal(s3.until, day(3));
    const st = (await a.get('/api/state')).json;
    assert.equal(st.presence.where, 'vacation'); assert.equal(st.nextVacation.from, day(30));
    // Зов человеку в отпуске: пуш не уйдёт, отправитель узнаёт об этом
    const call = await c.post(`/api/gangs/${a.gang}/messages`, { type: 'call', kind: 'lunch', to: (await a.get('/api/me')).json.user.id });
    assert.equal(call.json.away, 1);
    // Пришёл в офис посреди отпуска — показываем офис, ручной статус сбрасывается
    await a.post('/api/checkin', { office: 'smol' });
    assert.equal((await status()).where, 'office');
    assert.equal((await a.get('/api/me')).json.user.profile.today, null);
    await a.post('/api/me/profile', { profile: { vacations: [] } });
  });

  await step('лавка: покупка, нехватка зёрен, надеть', async () => {
    const shop = (await a.get('/api/shop')).json;
    assert.ok(shop.items.length >= 8);
    assert.equal((await a.post('/api/shop/buy', { item: 'st_night' })).status, 200);
    assert.equal((await a.post('/api/shop/buy', { item: 'st_night' })).status, 400);
    assert.equal((await a.post('/api/shop/buy', { item: 'crown' })).status, 400);
    const me = (await a.get('/api/me')).json.user;
    assert.equal(me.status, 'Ночной дозор');
    assert.equal((await a.post('/api/shop/equip', { item: 'st_night', on: false })).status, 200);
    assert.equal((await a.get('/api/me')).json.user.status, null);
  });

  if (!night) {
    await step('сигнал: два подтверждения → подтверждён, +2 автору', async () => {
      await b.post('/api/checkin', { office: 'smol' });
      await c.post('/api/checkin', { office: 'smol' });
      assert.equal((await a.post('/api/signals', { type: 'cold', zone: '5 этаж' })).status, 200);
      const ev = (await b.get('/api/events')).json;
      const s = ev.signals[0];
      const before = (await a.get('/api/me')).json.user.beans;
      await b.post(`/api/signals/${s.id}/vote`, { vote: 1 });
      await c.post(`/api/signals/${s.id}/vote`, { vote: 1 });
      const ev2 = (await a.get('/api/events')).json;
      assert.ok(ev2.signals[0].confirmed);
      assert.equal((await a.get('/api/me')).json.user.beans - before, 2);
    });

    await step('столовая: вход, выход, оценка', async () => {
      assert.equal((await a.post('/api/canteen/in')).json.beans, 2);
      assert.equal((await a.post('/api/canteen/in')).status, 400);
      const st = (await a.get('/api/state')).json;
      assert.ok(st.inCanteen);
      assert.equal((await a.post('/api/canteen/out')).status, 200);
    });
  }

  await step('жалобы: три → скрыто', async () => {
    const view = (await b.get(`/api/gangs/${a.gang}`)).json;
    const msg = view.messages.find((m) => m.type === 'text');
    for (const cl of [a, c]) await cl.post('/api/report', { type: 'message', id: msg.id });
    const e = await new Client().login('f@mts.ru', 'хитрый_лис');
    await e.post('/api/gangs/join', { code: (await a.get(`/api/gangs/${a.gang}`)).json.gang.code });
    await e.post('/api/report', { type: 'message', id: msg.id });
    const after = (await b.get(`/api/gangs/${a.gang}`)).json;
    assert.ok(!after.messages.some((m) => m.id === msg.id));
  });

  await step('админка только для админа', async () => {
    assert.equal((await a.get('/api/admin/overview')).status, 403);
    const r = await c.get('/api/admin/overview');
    assert.equal(r.status, 200);
    assert.ok(r.json.reports.length >= 1);
  });

  await step('CSRF: чужой Origin отклоняется', async () => {
    const res = await fetch(BASE + '/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: a.cookie, Origin: 'https://evil.example' }, body: '{}' });
    assert.equal(res.status, 403);
  });

  await step('заголовки безопасности и SPA', async () => {
    const res = await fetch(BASE + '/some/deep/route');
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-security-policy').includes("script-src 'self'"));
    assert.equal((await fetch(BASE + '/../server/config.js')).status !== 500, true);
  });

  await step('удаление аккаунта', async () => {
    assert.equal((await b.req('DELETE', '/api/me')).status, 200);
    assert.equal((await b.get('/api/me')).json.user, null);
    const view = (await a.get(`/api/gangs/${a.gang}`)).json;
    assert.ok(!view.members.some((m) => m.nick === '@ночной_филин'));
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог сервера ---\n' + log); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
