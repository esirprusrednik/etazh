// Проверка функций второго этапа: node tests/features.js
const { spawn } = require('node:child_process');
// Тесты живут в рабочий день: в субботу и воскресенье сдвигаем часы сервера на ближайший понедельник, 12:00 по Москве
const SHIFT_H = 12 - new Date().getUTCHours() + ({ 6: 48, 0: 24 }[new Date().getUTCDay()] || 0);
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
    TZ_OFFSET_HOURS: String(SHIFT_H), LEAGUE_LAUNCH: '2020-01-01'
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
const mskToday = () => new Date(Date.now() + SHIFT_H * 3600e3).toISOString().slice(0, 10);

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

  await step('ачивки: отметка даёт «Первый шаг»; заданий дня больше нет', async () => {
    await a.post('/api/checkin', { office: 'smol' });
    const f = (await a.get('/api/features')).json;
    assert.ok(f.achievements.find((x) => x.id === 'first_checkin').got);
    assert.ok(f.achievements.find((x) => x.id === 'gang').got);
    assert.equal(f.quests.items.length, 0, 'задания дня выключены — вместо них серия дней');
  });

  await step('«из дома» — зёрна по серии, один раз в день; план недели — +5 раз в неделю', async () => {
    const r = (await c.post('/api/me/profile', { profile: { today: { kind: 'home' } } })).json;
    assert.equal(r.beans, 3, '«из дома» — по серии, как офис: первый день +3');
    assert.equal(r.streak, 1);
    assert.equal((await c.post('/api/me/profile', { profile: { today: { kind: 'home' } } })).json.beans, 0, 'второй раз за день — без зёрен');
    assert.equal((await c.post('/api/checkin', { office: 'smol' })).json.beans, 0, 'после «из дома» отметка в офисе зёрна не даёт');
    // План недели: от трёх дней — +5 раз в неделю
    let pr = (await c.post('/api/me/profile', { profile: { plan: { Пн: 'office', Вт: 'home', Ср: 'office' } } })).json;
    assert.equal(pr.planBeans, 5);
    pr = (await c.post('/api/me/profile', { profile: { plan: { Пн: 'office', Вт: 'office', Ср: 'office' } } })).json;
    assert.equal(pr.planBeans, 0, 'второй раз за неделю — без зёрен');
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

  await step('одна смена ника бесплатно, дальше 50 зёрен; имя видно банде, но не чужим', async () => {
    const before = (await a.get('/api/me')).json.user.beans;
    assert.equal((await a.get('/api/me')).json.user.nickFree, true);
    assert.equal((await a.post('/api/me/nick', { nick: 'ночной_филин' })).status, 400);
    const r1 = await a.post('/api/me/nick', { nick: 'новый_енот' });
    assert.equal(r1.status, 200); assert.equal(r1.json.free, true);
    assert.equal((await a.get('/api/me')).json.user.beans, before, 'первая смена бесплатная');
    assert.equal((await a.get('/api/me')).json.user.nickFree, false);
    assert.equal((await a.post('/api/me/nick', { nick: 'новый_енот_2' })).status, 200);
    assert.equal((await a.get('/api/me')).json.user.beans, before - 50, 'вторая — за зёрна');
    await a.post('/api/me/profile', { profile: { firstName: 'Анна', lastName: 'Петрова' } });
    assert.equal((await a.post('/api/me/profile', { profile: { firstName: 'Ан<на>' } })).status, 400);
    assert.equal((await b.get(`/api/gangs/${g.id}`)).json.members.find((m) => m.id === a.id).name, '', 'сам без имени — чужих имён не видит');
    await b.post('/api/me/profile', { profile: { firstName: 'Борис' } });
    const gm = (await b.get(`/api/gangs/${g.id}`)).json.members.find((m) => m.id === a.id);
    assert.equal(gm.name, 'Анна Петрова');
    await a.post('/api/me/profile', { look: { face: 'heart', eyes: '#3A7BD5', hairStyle: 'afro' } });
    const look = (await a.get('/api/me')).json.user.look;
    assert.equal(look.face, 'heart'); assert.equal(look.hairStyle, 'afro');
    // Новые черты внешности сохраняются, недопустимые значения отбрасываются
    await a.post('/api/me/profile', { look: { browShape: 'uni', browColor: '#6E6A66', eyeShape: 'hooded', eyeGap: 'wide', age: '2', hairline: 'm', part: 'right', lips: 'full', mole: 'chin', lashes: true, dimples: true, hair: '#CFAE74', skin: '#D7A774', eyes: '#8A6A2E' } });
    const l2 = (await a.get('/api/me')).json.user.look;
    for (const [k, v] of Object.entries({ browShape: 'uni', browColor: '#6E6A66', eyeShape: 'hooded', eyeGap: 'wide', age: '2', hairline: 'm', part: 'right', lips: 'full', mole: 'chin', lashes: true, dimples: true, hair: '#CFAE74', skin: '#D7A774', eyes: '#8A6A2E' })) assert.equal(l2[k], v, k);
    await a.post('/api/me/profile', { look: { browShape: 'zigzag', age: '7', hairline: 'x', lips: 'huge' } });
    const l3 = (await a.get('/api/me')).json.user.look;
    assert.equal(l3.browShape, 'uni'); assert.equal(l3.age, '2'); assert.equal(l3.hairline, 'm'); assert.equal(l3.lips, 'full');
  });

  await step('карточка коллеги: банде — полная, чужим — только ник и аватар', async () => {
    await b.post('/api/me/profile', { profile: { about: 'Люблю настолки', firstName: 'Борис' } });
    const full = (await a.get(`/api/users/${b.id}`)).json;
    assert.ok(full.full); assert.equal(full.about, 'Люблю настолки'); assert.equal(full.name, 'Борис'); assert.ok(full.gangs.length);
    const z = await new Client().login('zoe@mts.ru', 'чужой_кот');
    const part = (await z.get(`/api/users/${b.id}`)).json;
    assert.ok(!part.full); assert.equal(part.about, undefined);
    assert.equal(part.name, '', 'у самого смотрящего нет имени — чужие имена скрыты');
    await z.post('/api/me/profile', { profile: { firstName: 'Зоя', lastName: 'Котова' } });
    assert.equal((await z.get(`/api/users/${b.id}`)).json.name, 'Борис', 'имя видно и вне банды — чтобы можно было общаться');
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
    assert.deepEqual(f.achCats.map((c) => c[0]), ['first', 'grow', 'daily', 'social', 'stealth', 'duels']);
    const ev = (await y.get('/api/events')).json.events.map((e) => e.text).join('\n');
    assert.ok(/Голос подал/.test(ev), 'обычная ачивка — в ленте');
    assert.ok(!/Агент 007|Партизан/.test(ev), 'секретная — не в ленте');
    // Призрак офиса: пришёл и ушёл меньше чем через час
    await x.post('/api/checkin', { office: 'smol' });
    await x.post('/api/checkout');
    assert.ok((await x.get('/api/features')).json.achievements.find((a) => a.id === 'st_ghost').got);
    // Одинокий волк: вышел из банды и остался один
    await y.post(`/api/gangs/${gx.id}/leave`);
    const yl = (await y.get('/api/features')).json.achievements.find((a) => a.id === 'st_lone');
    assert.ok(yl.got && yl.name === 'Одинокий волк');
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
    await w.post(`/api/gangs/${gw.id}/messages`, { type: 'text', text: 'привет' });
    const achW = (await w.get('/api/features')).json.achievements;
    assert.equal(achW.find((a) => a.id === 'first_msg').name, 'Голос подала', 'ачивки в женском роде');
    assert.equal((await m.get('/api/features')).json.achievements.find((a) => a.id === 'first_msg').name, 'Голос подал');
    // Клиентские тексты: токены рода есть и разворачиваются, «(а)» нигде не осталось
    const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
    assert.ok(!/[а-яё]\((а|ла|лась)\)/.test(app), 'никаких «сделал(а)» в интерфейсе');
    for (const f of require('node:fs').readdirSync(require('node:path').join(__dirname, '..', 'server')).filter((x) => x.endsWith('.js'))) {
      assert.ok(!/[а-яё]\((а|ла|лась)\)/.test(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server', f), 'utf8')), `«(а)» в server/${f}`);
    }
  });

  await step('банды: поиск, открытая/по заявке/закрытая, настройки, лимит, кто зовёт, исключение', async () => {
    const o = await new Client().login('owner@mts.ru', 'хитрый_лис');
    const x = await new Client().login('ksenia@mts.ru', 'быстрая_лань');
    const y = await new Client().login('yaroslav@mts.ru', 'седой_барсук');
    const gg = (await o.post('/api/gangs', { name: 'Аналитики пятого', area: 'Кофейный клуб', interests: ['Настолки', 'Кофе'], about: 'SQL и пицца', access: 'request', emoji: '📊' })).json;
    assert.ok(gg.id, 'банда создана с профилем');
    const hr = await y.post('/api/gangs', { name: 'Тайный клуб', access: 'invite' }); const hidden = hr.json; assert.ok(hidden.id, JSON.stringify(hr.json));
    let found = (await x.get('/api/gangs/search?q=' + encodeURIComponent('пицца'))).json.items;
    assert.equal(found.length, 1);
    assert.equal(found[0].area, 'Кофейный клуб');
    assert.deepEqual(found[0].interests, ['Настолки', 'Кофе']);
    assert.ok(!(await x.get('/api/gangs/search?q=' + encodeURIComponent('Тайный'))).json.items.length, 'закрытая не видна в поиске');
    assert.equal((await x.get(`/api/gangs/${hidden.id}/profile`)).status, 404);
    assert.equal((await x.post(`/api/gangs/${hidden.id}/apply`)).status, 400);
    assert.equal((await x.get('/api/gangs/search?area=' + encodeURIComponent('Кофейный клуб'))).json.items.length, 1);
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

  await step('одна банда на человека: без подтверждения нельзя, с ним — переход; предел 30', async () => {
    const p1 = await new Client().login('pavel@mts.ru', 'один_в_поле');
    const p2 = await new Client().login('polina@mts.ru', 'тихая_гавань');
    p1.strict = p2.strict = true;
    const g1 = (await p1.post('/api/gangs', { name: 'Первая', access: 'open' })).json;
    const g2 = (await p2.post('/api/gangs', { name: 'Вторая', access: 'open' })).json;
    const r = await p1.post(`/api/gangs/${g2.id}/apply`);
    assert.equal(r.status, 400); assert.ok(/уже в банде «Первая»/.test(r.json.error));
    assert.equal((await p1.post('/api/gangs/join', { code: g2.code })).status, 400);
    assert.equal((await p1.post('/api/gangs', { name: 'Третья' })).status, 400, 'и новую не сколотить');
    assert.ok((await p1.post(`/api/gangs/${g2.id}/apply`, { switch: true })).json.member);
    const mine = (await p1.get('/api/me')).json.user.gangs;
    assert.deepEqual(mine.map((x) => x.id), [g2.id], 'остался только в новой');
    assert.equal((await p1.get(`/api/gangs/${g1.id}`)).status, 404, 'пустая старая банда удалена');
    // Предел: в настройках больше 30 не поставить
    await p2.post(`/api/gangs/${g2.id}/settings`, { maxMembers: 500 });
    assert.equal((await p2.get(`/api/gangs/${g2.id}`)).json.gang.max, 30);
  });

  await step('лига банд: очки за отметку, средний вклад, «в сборе», призы за прошлую неделю', async () => {
    const L = [];
    for (const [e, n] of [['l1@mts.ru', 'лига_один'], ['l2@mts.ru', 'лига_два'], ['l3@mts.ru', 'лига_три']]) L.push(await new Client().login(e, n));
    const lg = (await L[0].post('/api/gangs', { name: 'Лигачи', access: 'open' })).json;
    await L[1].post(`/api/gangs/${lg.id}/apply`); await L[2].post(`/api/gangs/${lg.id}/apply`);
    // Прошлая неделя: подкладываем очки и проверяем, что призы раздались один раз
    const { DatabaseSync } = require('node:sqlite');
    const sdb = new DatabaseSync(path.join(dir, 'db.sqlite'));
    const { period } = require('../server/league');
    const prev = period('W', new Date(Date.parse(mskToday() + 'T00:00:00Z') - 7 * 864e5).toISOString().slice(0, 10));
    for (const x of L) {
      sdb.prepare('INSERT INTO league_points (day, gang_id, user_id, points) VALUES (?, ?, ?, ?)').run(prev.from, lg.id, x.id, 30);
      sdb.prepare('INSERT OR IGNORE INTO league_roster (period, gang_id, user_id) VALUES (?, ?, ?)').run(prev.key, lg.id, x.id);
    }
    sdb.close();
    for (const x of L) await x.post('/api/checkin', { office: 'smol' });
    const before = (await L[1].get('/api/me')).json.user.beans;
    const w = (await L[0].get('/api/league')).json;
    assert.ok(w.mine && w.mine.id === lg.id, 'моя банда в лиге');
    assert.ok(w.mine.myPoints >= 5, 'отметка принесла очки');
    assert.ok(w.mine.together >= 1, 'все трое отметились — банда в сборе');
    assert.equal(w.mine.score, Math.round(w.mine.total / Math.max(3, w.mine.roster)) + w.mine.together * 10);
    assert.ok(w.top.some((r) => r.id === lg.id && r.place));
    const w2 = (await L[1].get('/api/league')).json;
    assert.equal(w2.last.winners[0].name, 'Лигачи');
    const after = (await L[1].get('/api/me')).json.user.beans;
    assert.equal(after - before, 30, '+30 за первое место недели');
    assert.ok((await L[1].get('/api/me')).json.user.owned.includes('p_trophy'), 'кубок в руке');
    await L[1].get('/api/league');
    assert.equal((await L[1].get('/api/me')).json.user.beans, after, 'второй раз не платим');
    const prof = (await L[2].get(`/api/gangs/${lg.id}/profile`)).json;
    assert.equal(prof.trophies.w[0], 1);
    assert.equal((await L[1].post('/api/shop/buy', { item: 'p_laurel' })).status, 400, 'венок не купить');
  });

  await step('статистика: только счётчики, без ников и названий', async () => {
    const st = (await a.get('/api/state')).json.stats;
    assert.ok(st.users >= 4 && st.gangs >= 1 && st.inGangs >= 1 && st.today >= 1);
    assert.ok(Object.values(st).every((v) => typeof v === 'number'), 'одни числа');
  });

  await step('события банды: любой создаёт, «иду/может/не смогу», чужим не видно, отменяет автор или владелец', async () => {
    const day = new Date(Date.parse(mskToday() + 'T00:00:00Z') + 3 * 864e5).toISOString().slice(0, 10);
    assert.equal((await b.post(`/api/gangs/${g.id}/gevents`, { kind: 'party', title: 'Сабантуй', day: '2020-01-01' })).status, 400, 'прошлое нельзя');
    const r = await b.post(`/api/gangs/${g.id}/gevents`, { kind: 'party', title: 'Сабантуй перед праздником', day, time: '18:30', place: 'Кафе внизу', note: 'По 500' });
    assert.equal(r.status, 200);
    const id = r.json.id;
    let v = (await a.get(`/api/gangs/${g.id}/gevents`)).json;
    const e = v.upcoming.find((x) => x.id === id);
    assert.equal(e.yes.length, 1, 'автор сразу идёт'); assert.equal(e.inDays, 3); assert.equal(e.canCancel, true, 'владелец банды может отменить');
    assert.ok(Array.isArray(v.kinds) && v.kinds.length >= 5);
    await a.post(`/api/gevents/${id}/rsvp`, { answer: 'yes' });
    await c.post(`/api/gevents/${id}/rsvp`, { answer: 'maybe' });
    v = (await c.get(`/api/gangs/${g.id}/gevents`)).json;
    const e2 = v.upcoming.find((x) => x.id === id);
    assert.equal(e2.yes.length, 2); assert.equal(e2.maybe.length, 1); assert.equal(e2.my, 'maybe'); assert.equal(e2.canCancel, false);
    await c.post(`/api/gevents/${id}/rsvp`, { answer: 'maybe' });
    assert.equal((await c.get(`/api/gangs/${g.id}/gevents`)).json.upcoming.find((x) => x.id === id).my, null, 'повторное нажатие снимает ответ');
    const outsider = await new Client().login('chuzhoy@mts.ru', 'посторонний_ёж');
    assert.equal((await outsider.get(`/api/gangs/${g.id}/gevents`)).status, 404, 'чужим не видно');
    assert.equal((await outsider.post(`/api/gevents/${id}/rsvp`, { answer: 'yes' })).status, 404);
    assert.equal((await c.post(`/api/gevents/${id}/cancel`)).status, 400, 'не автор и не владелец');
    const chat = (await a.get(`/api/gangs/${g.id}`)).json.messages.map((m) => m.text).join('\n');
    assert.ok(/Событие: «Сабантуй перед праздником»/.test(chat), 'в чате — отметка');
    assert.equal((await a.post(`/api/gevents/${id}/cancel`)).status, 200);
    assert.ok(!(await b.get(`/api/gangs/${g.id}/gevents`)).json.upcoming.some((x) => x.id === id));
  });

  await step('герб: только голосованием банды, голос тайный, досрочно — большинство, у владельца нет особых прав', async () => {
    // настройки владельца герб больше не меняют
    await a.post(`/api/gangs/${g.id}/settings`, { crest: { shape: 'kite', charge: 'snake' } });
    assert.equal((await a.get(`/api/gangs/${g.id}`)).json.gang.crest, null);
    const n = (await a.get(`/api/gangs/${g.id}`)).json.gang.count;
    assert.ok(n >= 3, 'в банде минимум трое');
    const r = await b.post(`/api/gangs/${g.id}/crest-vote`, { crest: { shape: 'kite', div: 'chief', c1: 'red', c2: 'gold', charge: 'snake', cc: 'silver', top: 'crown', hack: '<script>' } });
    assert.equal(r.status, 200); assert.equal(r.json.status, 'open');
    assert.deepEqual(r.json.active.crest, { shape: 'kite', div: 'chief', c1: 'red', c2: 'gold', charge: 'snake', cc: 'silver', top: 'crown', motto: true });
    assert.equal((await c.post(`/api/gangs/${g.id}/crest-vote`, { crest: { shape: 'round' } })).status, 400, 'одно голосование за раз');
    const pid = r.json.active.id;
    const v = (await a.post(`/api/crest-vote/${pid}/vote`, { vote: -1 })).json;
    assert.ok(!JSON.stringify(v).includes('бодрый_енот'), 'голос тайный — ников нет');
    assert.equal(v.active.za, 1); assert.equal(v.active.protiv, 1);
    const outsider = await new Client().login('chuzhoy2@mts.ru', 'чужой_лис');
    assert.equal((await outsider.post(`/api/crest-vote/${pid}/vote`, { vote: 1 })).status, 404);
    // c — за: при банде из трёх это уже больше половины
    const after = (await c.post(`/api/crest-vote/${pid}/vote`, { vote: 1 })).json;
    if (n === 3) {
      assert.equal(after.status, 'accepted');
      assert.equal((await a.get(`/api/gangs/${g.id}`)).json.gang.crest.charge, 'snake');
      assert.ok((await a.get(`/api/gangs/${g.id}`)).json.messages.some((m) => /Новый герб принят/.test(m.text)));
    }
  });

  console.log(`\nВсё прошло: ${passed} проверок`);
})()
  .catch((e) => { console.error('\nПровал:', e.message, '\n--- лог ---\n' + log.slice(-2000)); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
