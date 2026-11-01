// Квизы: «Угадай коллегу» и квиз недели: node tests/quiz.js
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etazh-q-'));
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
  const boss = await new Client().login('boss@mts.ru', 'главный_бобр');
  const a = await new Client().login('anna@mts.ru', 'бодрый_енот');
  const b = await new Client().login('boris@mts.ru', 'ночной_филин');
  const c = await new Client().login('cat@mts.ru', 'хитрый_кот');
  const d = await new Client().login('dina@mts.ru', 'смелый_ёж');
  const g = (await a.post('/api/gangs', { name: 'Знатоки' })).json;

  await step('угадай коллегу: в маленькой банде не работает', async () => {
    await b.post('/api/gangs/join', { code: g.code });
    const r = (await a.get(`/api/gangs/${g.id}/guess`)).json;
    assert.equal(r.question, null); assert.ok(r.small);
    assert.equal((await d.get(`/api/gangs/${g.id}/guess`)).status, 404);
  });

  await step('угадай коллегу: вопрос, ответ, зерно, лимит 3 в день', async () => {
    for (const x of [c, d]) await x.post('/api/gangs/join', { code: g.code });
    await b.post('/api/me/profile', { profile: { about: 'Пеку лучшие сырники' } });
    let correctCount = 0;
    for (let i = 0; i < 3; i++) {
      const q = (await a.get(`/api/gangs/${g.id}/guess`)).json.question;
      assert.ok(q && q.options.length === 3, 'три варианта: все, кроме меня');
      assert.ok(!q.options.some((o) => o.nick === 'бодрый_енот'));
      assert.equal(q.answer, undefined, 'ответ не раскрыт до выбора');
      const again = (await a.get(`/api/gangs/${g.id}/guess`)).json.question;
      assert.equal(again.id, q.id, 'тот же вопрос, пока не ответил');
      // узнаём правильный ответ через неверную попытку другого способа нельзя — выбираем первый вариант
      const r = (await a.post(`/api/guess/${q.id}`, { pick: q.options[0].id })).json;
      assert.ok(r.question.answered); assert.ok(r.question.answerNick);
      if (r.question.correct) { correctCount++; assert.equal(r.beans, 1); }
      assert.equal((await a.post(`/api/guess/${q.id}`, { pick: q.options[0].id })).status, 400);
    }
    const end = (await a.get(`/api/gangs/${g.id}/guess`)).json;
    assert.equal(end.question, null); assert.ok(end.done);
  });

  let qid;
  await step('квиз недели: создаёт только модератор, проверка полей', async () => {
    assert.equal((await a.post('/api/admin/quizzes', { text: 'Вопрос?', options: ['a', 'b'], correct: 0 })).status, 403);
    assert.equal((await boss.post('/api/admin/quizzes', { text: 'Вопрос?', options: ['a'], correct: 0 })).status, 400);
    qid = (await boss.post('/api/admin/quizzes', { text: 'Сколько этажей на Смоленке?', options: ['5', '9', '12'], correct: 1, explain: 'Девять, считая цоколь' })).json.id;
    assert.ok(qid);
  });

  await step('квиз недели: ответ, статистика после ответа, повтор запрещён', async () => {
    const before = (await a.get('/api/quiz')).json.items[0];
    assert.equal(before.stats, undefined, 'до ответа статистики и правильного ответа нет');
    assert.equal(before.correct, undefined);
    const r = (await a.post(`/api/quiz/${qid}/answer`, { pick: 1 })).json;
    assert.equal(r.beans, 3); assert.equal(r.quiz.correct, 1); assert.equal(r.quiz.total, 1);
    assert.equal((await a.post(`/api/quiz/${qid}/answer`, { pick: 0 })).status, 400);
    await b.post(`/api/quiz/${qid}/answer`, { pick: 0 });
    const s = (await a.get('/api/quiz')).json.items[0];
    assert.deepEqual(s.stats.map((x) => x.n), [1, 1, 0]);
    const f = (await a.get('/api/features')).json.achievements;
    assert.ok(f.find((x) => x.id === 'quiz_first').got);
  });

  await step('квиз недели: закрытие модератором', async () => {
    await boss.post(`/api/admin/quizzes/${qid}/close`);
    assert.equal((await c.post(`/api/quiz/${qid}/answer`, { pick: 1 })).status, 400);
    assert.equal((await c.get('/api/quiz')).json.items.length, 0);
  });

  await step('заполненность профиля: шаги и ачивка за 100%', async () => {
    let m = (await d.get('/api/me')).json.user.completion;
    assert.equal(m.steps[0].done, true); assert.ok(m.pct < 100);
    await d.post('/api/me/profile', { look: { hairStyle: 'bob' }, profile: { home: 'smol', plan: { Пн: 'office', Вт: 'office', Ср: 'home' }, tags: ['Кофе', 'Бег'], about: 'Люблю бегать' } });
    m = (await d.get('/api/me')).json.user.completion;
    assert.equal(m.pct, 86, 'не хватает только уведомлений');
    await d.post('/api/push/subscribe', { subscription: { endpoint: 'https://push.example/1', keys: { p256dh: 'x', auth: 'y' } } });
    m = (await d.get('/api/me')).json.user.completion;
    assert.equal(m.pct, 100);
    assert.ok((await d.get('/api/features')).json.achievements.find((x) => x.id === 'profile_full').got);
  });

  await step('конструктор: новые детали, платные только после покупки, образ для отпуска', async () => {
    assert.equal((await a.post('/api/me/profile', { look: { outfit: 'suit', neck: 'tie', hat: 'headset', eyeShape: 'tired', prop: 'mug' } })).status, 200);
    let look = (await a.get('/api/me')).json.user.look;
    assert.equal(look.outfit, 'suit'); assert.equal(look.prop, 'mug');
    assert.equal((await a.post('/api/me/profile', { look: { prop: 'laptop' } })).status, 400, 'ноутбук не куплен');
    await boss.post('/api/me/profile', {});
    const buy = await a.post('/api/shop/buy', { item: 'p_sign' });
    assert.equal(buy.status, 200);
    assert.equal((await a.post('/api/me/profile', { look: { prop: 'sign' } })).status, 200);
    assert.equal((await a.post('/api/me/profile', { profile: { vacationLook: { outfit: 'tee', hat: 'cap', prop: 'none' } } })).status, 200);
    const today = new Date(Date.now() + (12 - new Date().getUTCHours()) * 3600e3).toISOString().slice(0, 10);
    await a.post('/api/me/profile', { shareOffice: true, profile: { vacations: [{ from: today, to: today }] } });
    const m = (await b.get(`/api/gangs/${g.id}`)).json.members.find((x) => x.id === a.id);
    assert.equal(m.where, 'vacation'); assert.equal(m.look.hat, 'cap', 'в отпуске банда видит отпускной образ');
  });

  await step('мем-открытка подельнику: только из списка, в переписке виден аватар', async () => {
    await a.post('/api/crew/add', { nick: 'ночной_филин' });
    await b.post(`/api/crew/${a.id}/accept`);
    assert.equal((await a.post(`/api/crew/${b.id}/messages`, { type: 'meme', kind: 'нет', opt: 'joy' })).status, 400);
    assert.equal((await a.post(`/api/crew/${b.id}/messages`, { type: 'meme', kind: 'friday', opt: 'joy' })).status, 200);
    const v = (await b.get(`/api/crew/${a.id}`)).json;
    const mm = v.messages.find((x) => x.type === 'meme');
    assert.equal(mm.kind, 'friday'); assert.ok(mm.look && mm.look.outfit); assert.equal(mm.text, null);
    const list = (await b.get('/api/crew')).json.list[0];
    assert.ok(list.last.text.includes('Пятница'));
  });

  await step('новая структура: личка в банде без заявки, «мои люди», единый список чатов', async () => {
    assert.equal((await c.post(`/api/crew/${d.id}/messages`, { type: 'text', text: 'Привет из банды' })).status, 200, 'c и d в одной банде');
    const people = (await d.get('/api/people')).json.people;
    assert.ok(people.find((p) => p.id === c.id && p.gangs.length && !p.crew));
    const chats = (await d.get('/api/chats')).json;
    assert.ok(chats.items.find((x) => x.type === 'gang' && x.id === g.id));
    const dm = chats.items.find((x) => x.type === 'dm' && x.id === c.id);
    assert.equal(dm.unread, 1); assert.ok(dm.last.text.includes('Привет'));
    const z = await new Client().login('zed@mts.ru', 'чужак_зет');
    assert.equal((await z.post(`/api/crew/${d.id}/messages`, { type: 'text', text: 'эй' })).status, 404, 'чужим нельзя');
    assert.equal((await c.post('/api/battle', { to: d.id })).status, 200, 'бой с участником банды');
  });

  await step('поиск по базе: ник, почта точно, имя только если открыто; приглашение в банду с согласием', async () => {
    const z = await new Client().login('zoya@mts.ru', 'звонкая_сова');
    let r = (await z.get('/api/search?q=' + encodeURIComponent('бодрый'))).json.items;
    assert.ok(r.find((x) => x.nick === 'бодрый_енот'));
    r = (await z.get('/api/search?q=' + encodeURIComponent('boris@mts.ru'))).json.items;
    assert.equal(r.length, 1); assert.equal(r[0].nick, 'ночной_филин');
    assert.equal((await z.get('/api/search?q=' + encodeURIComponent('bori@mts.ru'))).json.items.length, 0, 'почта — только точно');
    await a.post('/api/me/profile', { profile: { firstName: 'Анна', lastName: 'Петрова', nameVis: 'gang' } });
    assert.equal((await z.get('/api/search?q=' + encodeURIComponent('Петрова'))).json.items.length, 0, 'имя скрыто — по имени не найти');
    await a.post('/api/me/profile', { profile: { nameVis: 'all' } });
    assert.equal((await z.get('/api/search?q=' + encodeURIComponent('Петрова'))).json.items.length, 1);
    await b.post('/api/me/profile', { profile: { findable: false } });
    assert.equal((await z.get('/api/search?q=' + encodeURIComponent('филин'))).json.items.length, 0, 'отключил поиск');
    // приглашение
    const found = (await a.get('/api/search?q=' + encodeURIComponent('звонкая'))).json.items[0];
    assert.ok(found.invitable.find((x) => x.id === g.id));
    assert.equal((await a.post(`/api/gangs/${g.id}/invite`, { to: z.id })).status, 200);
    assert.equal((await a.post(`/api/gangs/${g.id}/invite`, { to: z.id })).status, 400, 'повторно — нельзя');
    assert.equal((await z.get('/api/state')).json.badges.invites, 1);
    const inv = (await z.get('/api/invites')).json.items[0];
    assert.equal(inv.gang.id, g.id);
    assert.equal((await z.post(`/api/invites/${inv.id}/accept`)).status, 200);
    assert.ok((await z.get('/api/me')).json.user.gangs.find((x) => x.id === g.id));
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог ---\n' + log.slice(-2000)); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
