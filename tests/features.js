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
  post(u, b = {}) { return this.req('POST', u, b); }
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
    assert.ok(f.quests.items.find((x) => x.id === 'where').done, 'отметка закрывает «Отметься»');
    assert.equal(f.quests.items.length, 4, 'в рабочий день: «Отметься» и три из пула');
    assert.deepEqual((await a.get('/api/features')).json.quests.items.map((x) => x.id), f.quests.items.map((x) => x.id), 'набор на день не меняется');
  });

  await step('задания дня: «из дома» тоже засчитывает отметку, без банды — «вступи в банду»', async () => {
    const r = (await c.post('/api/me/profile', { profile: { today: { kind: 'home' } } })).json;
    assert.equal(r.beans, 5, '«из дома» — +5, как офис');
    assert.equal((await c.post('/api/me/profile', { profile: { today: { kind: 'home' } } })).json.beans, 0, 'второй раз за день — без зёрен');
    assert.equal((await c.post('/api/checkin', { office: 'smol' })).json.beans, 0, 'после «из дома» отметка в офисе зёрна не даёт');
    assert.ok((await c.get('/api/features')).json.quests.items.find((x) => x.id === 'where').done);
    const lone = await new Client().login('lone@mts.ru', 'одинокий_волк');
    const ids = (await lone.get('/api/features')).json.quests.items.map((x) => x.id);
    assert.deepEqual(ids, ['where', 'join']);
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
    const qt = fa.quests.items.find((x) => x.id === 'thanks');
    assert.ok(!qt || qt.done, 'если спасибо в заданиях — засчитано');
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
    assert.ok(cells.every((x) => ['office', 'home', 'vacation', 'sick', 'unknown', 'off'].includes(x)));
    // Праздничный будний день — выходной у всех, в «лучший день» не попадает
    ex.week.days.forEach((d, i) => { if (d.holiday) { assert.ok(ex.week.rows.every((r) => r.cells[i] === 'off')); assert.notEqual(ex.week.best.label, d.label); } });
  });

  await step('дни рождения: видно в банде, подарок только в день рождения', async () => {
    const dd = mskToday().slice(8, 10) + '.' + mskToday().slice(5, 7);
    await b.post('/api/me/profile', { profile: { bday: dd, showBday: true } });
    const ex = (await a.get(`/api/gangs/${g.id}/extra`)).json;
    assert.equal(ex.birthdays[0].inDays, 0);
    const before = (await b.get('/api/me')).json.user.beans;
    const qb = (await a.get('/api/features')).json.quests.extra.find((x) => x.id === 'bday');
    assert.ok(qb && !qb.done, 'бонус «Поздравь именинника» появился');
    assert.equal((await a.post('/api/gift', { to: b.id })).status, 200);
    assert.ok((await a.get('/api/features')).json.quests.extra.find((x) => x.id === 'bday').done, 'подарок закрыл бонус');
    assert.ok(!(await b.get('/api/features')).json.quests.extra.some((x) => x.id === 'bday'), 'себя не поздравляют');
    assert.equal((await a.post('/api/gift', { to: b.id })).status, 400);
    assert.equal((await b.get('/api/me')).json.user.beans - before, 10);
    assert.equal((await a.post('/api/gift', { to: c.id })).status, 400);
    const f = (await c.get('/api/features')).json;
    assert.equal(f.birthdaysToday[0].nick, 'ночной_филин');
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
    assert.notEqual(fd.partner.nick, 'главный_бобр');
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

  await step('ник за 50 зёрен, имя видно банде, но не чужим', async () => {
    const before = (await a.get('/api/me')).json.user.beans;
    assert.equal((await a.post('/api/me/nick', { nick: 'ночной_филин' })).status, 400);
    assert.equal((await a.post('/api/me/nick', { nick: 'новый_енот' })).status, 200);
    assert.equal((await a.get('/api/me')).json.user.beans, before - 50);
    await a.post('/api/me/profile', { profile: { firstName: 'Анна', lastName: 'Петрова' } });
    assert.equal((await a.post('/api/me/profile', { profile: { firstName: 'Ан<на>' } })).status, 400);
    const gm = (await b.get(`/api/gangs/${g.id}`)).json.members.find((m) => m.id === a.id);
    assert.equal(gm.name, 'Анна Петрова');
    await a.post('/api/me/profile', { profile: { nameVis: 'hidden' } });
    assert.equal((await b.get(`/api/gangs/${g.id}`)).json.members.find((m) => m.id === a.id).name, '');
    await a.post('/api/me/profile', { look: { face: 'heart', eyes: '#3A7BD5', hairStyle: 'afro' } });
    const look = (await a.get('/api/me')).json.user.look;
    assert.equal(look.face, 'heart'); assert.equal(look.hairStyle, 'afro');
  });

  await step('карточка коллеги: банде — полная, чужим — только ник и аватар', async () => {
    await b.post('/api/me/profile', { profile: { about: 'Люблю настолки', firstName: 'Борис' } });
    const full = (await a.get(`/api/users/${b.id}`)).json;
    assert.ok(full.full); assert.equal(full.about, 'Люблю настолки'); assert.equal(full.name, 'Борис'); assert.ok(full.gangs.length);
    const z = await new Client().login('zoe@mts.ru', 'чужой_кот');
    const part = (await z.get(`/api/users/${b.id}`)).json;
    assert.ok(!part.full); assert.equal(part.about, undefined); assert.equal(part.name, undefined);
    assert.equal((await z.get('/api/users/99999')).status, 404);
  });

  await step('оценка обеда: только после столовой, раз в день, коллеги видят сводку, комментарий — модератор', async () => {
    assert.equal((await a.post('/api/canteen/rate', { up: true })).status, 400, 'не был в столовой');
    await a.post('/api/canteen/in');
    const r = (await a.post('/api/canteen/rate', { up: true, tags: ['Вкусно', 'Остыло', 'Горячее'], comment: 'Борщ огонь' })).json;
    assert.equal(r.beans, 1); assert.deepEqual(r.food.mine.tags, ['Вкусно', 'Горячее']);
    assert.ok((await a.get('/api/features')).json.quests.extra.find((x) => x.id === 'food').done, 'бонус «Оцени обед» засчитан');
    const r2 = (await a.post('/api/canteen/rate', { up: false, tags: ['Остыло'] })).json;
    assert.equal(r2.beans, 0); assert.equal(r2.food.n, 1, 'повторная оценка заменяет первую');
    const fb = (await b.get('/api/features')).json.food;
    assert.equal(fb.n, 1); assert.equal(fb.upPct, 0); assert.ok(!('comment' in fb));
    assert.equal((await a.get('/api/admin/food')).status, 403);
    const adm = (await c.get('/api/admin/food')).json.offices[0];
    assert.equal(adm.n, 1);
  });

  await step('удаление аккаунта убирает его спасибо, ачивки и пары', async () => {
    assert.equal((await d.req('DELETE', '/api/me')).status, 200);
    const fp = (await a.get('/api/features')).json.coffee.pair;
    assert.ok(!fp || fp.partner.nick !== 'смелый_ёж');
  });

  await step('ачивки: первые шаги, ступени с прогрессом, секретные скрыты и не попадают в ленту', async () => {
    const x = await new Client().login('xena@mts.ru', 'тихая_рысь');
    const y = await new Client().login('yan@mts.ru', 'быстрый_ёрш');
    const gx = (await x.post('/api/gangs', { name: 'Тихий угол' })).json;
    await y.post('/api/gangs/join', { code: gx.code });
    await x.post(`/api/gangs/${gx.id}/messages`, { type: 'text', text: 'всем привет' });
    await x.post(`/api/crew/${y.id}/messages`, { type: 'text', text: 'привет лично' });
    await x.post('/api/me/profile', { shareOffice: false, profile: { findable: false } });
    const f = (await x.get('/api/features')).json;
    const by = Object.fromEntries(f.achievements.map((a) => [a.id, a]));
    assert.ok(by.first_msg.got && by.first_dm.got && by.gang.got, 'первые шаги');
    assert.ok(by.st_hide.got && by.st_unfindable.got, 'Агент 007 и Партизан');
    assert.equal(by.st_ghost.name, '???', 'неполученная секретная — без названия');
    assert.equal(by.st_ghost.goal, null);
    assert.equal(by.msgs10.n, 1); assert.equal(by.msgs10.goal, 10);
    assert.equal(by.dm3.n, 1);
    assert.ok(by.day3.n >= 1, 'день в приложении засчитан');
    assert.deepEqual(f.achCats.map((c) => c[0]), ['first', 'grow', 'daily', 'social', 'stealth']);
    const ev = (await y.get('/api/events')).json.events.map((e) => e.text).join('\n');
    assert.ok(/Голос подал/.test(ev), 'обычная ачивка — в ленте');
    assert.ok(!/Агент 007|Партизан/.test(ev), 'секретная — не в ленте');
    // Призрак офиса: пришёл и ушёл меньше чем через час
    await x.post('/api/checkin', { office: 'smol' });
    await x.post('/api/checkout');
    assert.ok((await x.get('/api/features')).json.achievements.find((a) => a.id === 'st_ghost').got);
  });

  await step('женский род: ачивка «получила», статус «Готова к кофе»', async () => {
    const w = await new Client().login('olga@mts.ru', 'ленивый_удав');
    await w.post('/api/me/profile', { look: { preset: 'f' }, shareOffice: true, profile: { mood: 'coffee' } });
    const gw = (await w.post('/api/gangs', { name: 'Девичник' })).json;
    const m = await new Client().login('misha@mts.ru', 'тихий_медведь');
    await m.post('/api/gangs/join', { code: gw.code });
    await w.post('/api/checkin', { office: 'smol' });
    const ev = (await m.get('/api/events')).json.events.map((e) => e.text).join('\n');
    assert.ok(/ленивый_удав получила ачивку/.test(ev), 'в ленте — «получила»');
    assert.ok(!/ленивый_удав получил ачивку/.test(ev));
    const me = (await m.get(`/api/gangs/${gw.id}`)).json.members.find((x) => x.nick === 'ленивый_удав');
    assert.equal(me.mood, 'Готова к кофе');
  });

  await step('банды: поиск, открытая/по заявке/закрытая, настройки, лимит, кто зовёт, исключение', async () => {
    const o = await new Client().login('owner@mts.ru', 'хитрый_лис');
    const x = await new Client().login('ksenia@mts.ru', 'быстрая_лань');
    const y = await new Client().login('yaroslav@mts.ru', 'седой_барсук');
    const gg = (await o.post('/api/gangs', { name: 'Аналитики пятого', area: 'Аналитика и данные', interests: ['Настолки', 'Кофе'], about: 'SQL и пицца', access: 'request', emoji: '📊' })).json;
    assert.ok(gg.id, 'банда создана с профилем');
    const hr = await y.post('/api/gangs', { name: 'Тайный клуб', access: 'invite' }); const hidden = hr.json; assert.ok(hidden.id, JSON.stringify(hr.json));
    let found = (await x.get('/api/gangs/search?q=' + encodeURIComponent('пицца'))).json.items;
    assert.equal(found.length, 1);
    assert.equal(found[0].area, 'Аналитика и данные');
    assert.deepEqual(found[0].interests, ['Настолки', 'Кофе']);
    assert.ok(!(await x.get('/api/gangs/search?q=' + encodeURIComponent('Тайный'))).json.items.length, 'закрытая не видна в поиске');
    assert.equal((await x.get(`/api/gangs/${hidden.id}/profile`)).status, 404);
    assert.equal((await x.post(`/api/gangs/${hidden.id}/apply`)).status, 400);
    assert.equal((await x.get('/api/gangs/search?area=' + encodeURIComponent('Аналитика и данные'))).json.items.length, 1);
    // По заявке
    assert.ok((await x.post(`/api/gangs/${gg.id}/apply`)).json.requested);
    assert.ok((await x.get(`/api/gangs/${gg.id}/profile`)).json.requested);
    assert.equal((await o.get('/api/state')).json.badges.gangRequests, 1, 'бейдж заявок у владельца');
    const view = (await o.get(`/api/gangs/${gg.id}`)).json;
    assert.equal(view.requests.length, 1);
    assert.equal((await x.get(`/api/gangs/${gg.id}`)).status, 404, 'до принятия банды не видно');
    await o.post(`/api/gangs/${gg.id}/requests/${x.id}/accept`);
    assert.equal((await x.get(`/api/gangs/${gg.id}`)).json.gang.count, 2);
    // Чужой не меняет настройки
    assert.equal((await x.post(`/api/gangs/${gg.id}/settings`, { access: 'open' })).status, 400);
    // Только владелец зовёт: у участника ссылки нет
    await o.post(`/api/gangs/${gg.id}/settings`, { whoInvites: 'owner', maxMembers: 3 });
    const xv = (await x.get(`/api/gangs/${gg.id}`)).json.gang;
    assert.equal(xv.link, null); assert.equal(xv.canInvite, false);
    assert.equal((await x.post(`/api/gangs/${gg.id}/settings`, { maxMembers: 1 })).status, 400);
    assert.equal((await o.post(`/api/gangs/${gg.id}/settings`, { maxMembers: 1 })).status, 400, 'лимит меньше состава нельзя');
    // Открытая: вступление сразу, лимит
    await o.post(`/api/gangs/${gg.id}/settings`, { access: 'open', maxMembers: 3 });
    assert.ok((await y.post(`/api/gangs/${gg.id}/apply`)).json.member);
    const z = await new Client().login('zoya@mts.ru', 'робкая_сова');
    const full = (await z.get(`/api/gangs/${gg.id}/profile`)).json;
    assert.ok(full.full);
    assert.equal((await z.post(`/api/gangs/${gg.id}/apply`)).status, 400, 'мест нет');
    // Исключение и передача
    await o.post(`/api/gangs/${gg.id}/kick/${y.id}`);
    assert.equal((await y.get(`/api/gangs/${gg.id}`)).status, 404);
    await o.post(`/api/gangs/${gg.id}/settings`, { access: 'request' });
    assert.equal((await y.post(`/api/gangs/${gg.id}/apply`)).status, 400, 'исключённый не возвращается заявкой');
    await o.post(`/api/gangs/${gg.id}/owner/${x.id}`);
    assert.ok((await x.get(`/api/gangs/${gg.id}`)).json.gang.isOwner);
    assert.equal((await o.post(`/api/gangs/${gg.id}/settings`, { about: 'x' })).status, 400);
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог ---\n' + log.slice(-2000)); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
