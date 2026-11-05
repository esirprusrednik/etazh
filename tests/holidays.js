// Праздники: сезоны, адвент-календарь, Тайный Санта, сезонные вещи и открытки: node tests/holidays.js
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const SEASON = require('../server/seasons');

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.stack); throw e; }
}

// Сервер с подменённой датой: «сейчас» = day 12:00 по Москве
function startServer(day) {
  const PORT = 4000 + Math.floor(Math.random() * 1000);
  const BASE = `http://localhost:${PORT}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etazh-h-'));
  const offset = Math.round((Date.parse(day + 'T12:00:00Z') - Date.now()) / 3600e3);
  const proc = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server', 'index.js')], {
    env: {
      ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_PATH: path.join(dir, 'db.sqlite'),
      EMAIL_PEPPER: 'test-pepper-test-pepper-test-pepper-123', MAIL_MODE: 'console', SECURE_COOKIES: 'false',
      TZ_OFFSET_HOURS: String(offset)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  let ipN = 0;
  class Client {
    constructor() { this.cookie = ''; this.ip = '10.1.0.' + (++ipN); }
    async req(method, url, body) {
      const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: this.cookie, Origin: BASE, 'X-Forwarded-For': this.ip }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.get('set-cookie');
      if (sc) this.cookie = sc.split(';')[0];
      let json = null;
      try { json = JSON.parse(await res.text()); } catch {}
      return { status: res.status, json };
    }
    get(u) { return this.req('GET', u); }
    post(u, b = {}) { return this.req('POST', u, /^\/api\/gangs(\/\d+\/apply)?$/.test(u) ? { switch: true, ...b } : b); }
    async login(email, nick) {
      const r = await this.post('/api/auth/request', { email, consent: true });
      await this.post('/api/auth/code', { email, code: r.json.devCode });
      const nr = await this.post('/api/me/nick', { nick }); if (nr.status !== 200) throw new Error(nick + ': ' + JSON.stringify(nr.json));
      this.id = (await this.get('/api/me')).json.user.id;
      return this;
    }
  }
  const ready = (async () => { for (let i = 0; i < 150; i++) { try { if ((await fetch(BASE + "/healthz")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server did not start\n' + log); })();
  return { Client, ready, stop: () => proc.kill(), log: () => log };
}

(async () => {
  await step('сезоны: Пасха, Масленица, окна праздников', async () => {
    assert.equal(SEASON.orthodoxEaster(2026), '2026-04-12');
    assert.equal(SEASON.orthodoxEaster(2027), '2027-05-02');
    assert.equal(SEASON.orthodoxEaster(2028), '2028-04-16');
    assert.deepEqual(SEASON.SEASONS.maslenitsa.range(2027), ['2027-03-08', '2027-03-14']);
    assert.deepEqual(SEASON.activeSeasons('2027-03-10'), ['mar8', 'maslenitsa']);
    assert.deepEqual(SEASON.activeSeasons('2027-01-05'), ['newyear']);
    assert.deepEqual(SEASON.activeSeasons('2026-12-01'), []);
    assert.equal(SEASON.nextWindow('newyear', '2026-12-20').to, '2027-01-10');
  });

  // 1 декабря 2026, вторник: задание адвента — отметиться; Новый год ещё не начался
  const s1 = startServer('2026-12-01');
  try {
    await s1.ready;
    const { Client } = s1;
    const A = await new Client().login('h1@mts.ru', 'санта_один');
    const B = await new Client().login('h2@mts.ru', 'санта_два');
    const C = await new Client().login('h3@mts.ru', 'санта_три');
    const D = await new Client().login('h4@mts.ru', 'санта_четыре');
    const g = (await A.post('/api/gangs', { name: 'Ёлка', access: 'open' })).json;
    for (const x of [B, C, D]) await x.post(`/api/gangs/${g.id}/apply`);

    await step('сводка «Этажа»: адвент, Санта и задания дня', async () => {
      const it = (await A.get('/api/inbox')).json.items;
      const kinds = it.map((x) => x.kind);
      assert.ok(kinds.includes('advent') && kinds.includes('santa') && kinds.includes('quests'), kinds.join(','));
      assert.ok(it.find((x) => x.kind === 'santa').go.act === 'gang-open');
      assert.equal(it.find((x) => x.kind === 'quests').push, false, 'задания дня сами по себе пуш не заслуживают');
    });

    await step('адвент: окошко открывается только после задания, +2 зерна', async () => {
      const v = (await A.get('/api/advent')).json;
      assert.equal(v.active, true);
      assert.equal(v.days.length, 31);
      assert.equal(v.today.n, 1);
      assert.equal(v.today.kind, 'checkin');
      assert.equal(v.today.ready, false);
      assert.equal((await A.post('/api/advent/open')).status, 400);
      await A.post('/api/checkin', { office: 'smol' });
      const before = (await A.get('/api/me')).json.user.beans;
      const r = await A.post('/api/advent/open');
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.count, 1);
      assert.equal(r.json.days[0].state, 'done');
      assert.equal((await A.get('/api/me')).json.user.beans, before + 2);
      const again = await A.post('/api/advent/open');
      assert.equal(again.json.already, true);
      assert.equal((await A.get('/api/me')).json.user.beans, before + 2, 'второй раз зёрен нет');
    });

    await step('сводка: открытое окошко исчезает', async () => {
      assert.ok(!(await A.get('/api/inbox')).json.items.some((x) => x.kind === 'advent'));
    });

    await step('сезонные вещи: до Нового года свитер не виден и не продаётся', async () => {
      const shop = (await A.get('/api/shop')).json;
      assert.ok(!shop.items.some((x) => x.id === 'p_nysweater'));
      assert.equal((await A.post('/api/shop/buy', { item: 'p_nysweater' })).status, 400);
      assert.equal((await A.post('/api/shop/buy', { item: 'p_garland' })).status, 400, 'гирлянда только за адвент');
      const cat = (await A.get('/api/me')).json.catalog;
      const ny = cat.memes.find((m) => m.id === 'newyear');
      assert.ok(ny && ny.on === false);
      assert.equal((await A.post(`/api/gangs/${g.id}/messages`, { type: 'meme', kind: 'newyear', opt: 'calm' })).status, 400);
    });

    await step('Тайный Санта: запись, жеребьёвка без самого себя, каждый видит только своего', async () => {
      let v = (await A.get(`/api/gangs/${g.id}/santa`)).json;
      assert.equal(v.visible, true); assert.equal(v.regOpen, true); assert.equal(v.joined, false);
      await A.post(`/api/gangs/${g.id}/santa/join`, { wish: 'Люблю чай' });
      await B.post(`/api/gangs/${g.id}/santa/join`, { wish: 'Книги' });
      v = (await A.get(`/api/gangs/${g.id}/santa`)).json;
      assert.equal(v.canDraw, false, 'двоих мало');
      assert.equal((await A.post(`/api/gangs/${g.id}/santa/draw`)).status, 400);
      await C.post(`/api/gangs/${g.id}/santa/join`, { wish: '' });
      await D.post(`/api/gangs/${g.id}/santa/join`, { wish: 'Носки' });
      await D.post(`/api/gangs/${g.id}/santa/leave`);
      assert.equal((await B.post(`/api/gangs/${g.id}/santa/draw`)).status, 400, 'раньше срока — только владелец');
      const r = await A.post(`/api/gangs/${g.id}/santa/draw`);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const wishes = { [A.id]: 'Люблю чай', [B.id]: 'Книги', [C.id]: '' };
      const targets = [];
      for (const x of [A, B, C]) {
        const w = (await x.get(`/api/gangs/${g.id}/santa`)).json;
        assert.equal(w.status, 'drawn');
        assert.ok(w.target && w.target.id !== x.id, 'никто не дарит себе');
        assert.equal(w.target.wish, wishes[w.target.id]);
        targets.push(w.target.id);
      }
      assert.equal(new Set(targets).size, 3, 'у каждого ровно один Санта');
      assert.equal((await A.get(`/api/gangs/${g.id}/santa`)).json.budget, 500);
      const ib = (await B.get('/api/inbox')).json.items;
      assert.ok(ib.some((x) => x.kind === 'santa' && /Подарок для/.test(x.title)), 'после жеребьёвки — напоминание о подарке');
      const d = (await D.get(`/api/gangs/${g.id}/santa`)).json;
      assert.equal(d.target, null); assert.equal(d.joined, false);
      assert.equal((await D.post(`/api/gangs/${g.id}/santa/join`, { wish: 'х' })).status, 400, 'после жеребьёвки не записаться');
      assert.equal((await A.post(`/api/gangs/${g.id}/santa/leave`)).status, 400);
      await B.post(`/api/gangs/${g.id}/santa/gifted`);
      assert.equal((await A.get(`/api/gangs/${g.id}/santa`)).json.gifted, 1);
      const chat = (await A.get(`/api/gangs/${g.id}`)).json;
      assert.ok(chat.messages.some((m) => /жеребьёвка прошла/.test(m.text || '')));
    });
  } finally { s1.stop(); }

  // 19 декабря 2026, суббота: Новый год идёт, задание выходного — просто открыть окошко
  const s2 = startServer('2026-12-19');
  try {
    await s2.ready;
    const { Client } = s2;
    const A = await new Client().login('h5@mts.ru', 'ёлка_один');
    const B = await new Client().login('h6@mts.ru', 'ёлка_два');
    const g = (await A.post('/api/gangs', { name: 'Снежки', access: 'open' })).json;
    await B.post(`/api/gangs/${g.id}/apply`);

    await step('адвент в выходной: без задания, внутри факт', async () => {
      const v = (await A.get('/api/advent')).json;
      assert.equal(v.today.kind, 'open'); assert.equal(v.today.ready, true);
      assert.ok(v.today.text.length > 20);
      assert.equal(v.days[0].state, 'missed');
      assert.equal((await A.post('/api/advent/open')).status, 200);
    });

    await step('Новый год: свитер продаётся до 10 января, открытка уходит в чат банды', async () => {
      const shop = (await A.get('/api/shop')).json;
      const it = shop.items.find((x) => x.id === 'p_nysweater');
      assert.ok(it); assert.equal(it.until, '2027-01-10');
      const r = await A.post(`/api/gangs/${g.id}/messages`, { type: 'meme', kind: 'newyear', opt: 'calm' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const v = (await B.get(`/api/gangs/${g.id}`)).json;
      const m = v.messages.find((x) => x.type === 'meme');
      assert.ok(m && m.kind === 'newyear' && m.look && typeof m.look === 'object');
      assert.equal(m.text, null);
      assert.equal((await A.post(`/api/gangs/${g.id}/messages`, { type: 'meme', kind: 'monday', opt: 'calm' })).status, 400, 'в чат банды — только праздничные');
    });

    await step('события банды в сводке: ответь, завтра, изменилось, отменено; опрос без голоса', async () => {
      const ib = async (c) => (await c.get('/api/inbox')).json.items;
      const e1 = (await A.post(`/api/gangs/${g.id}/gevents`, { kind: 'party', title: 'Ёлка банды', day: '2026-12-25', time: '19:00', place: 'Кафе' })).json.event;
      assert.ok((await ib(B)).some((x) => x.id === `gev-ask-${e1.id}`), 'не ответил — спрашиваем');
      assert.ok(!(await ib(A)).some((x) => x.id === `gev-ask-${e1.id}`), 'автору не надо');
      await B.post(`/api/gevents/${e1.id}/rsvp`, { answer: 'yes' });
      assert.ok(!(await ib(B)).some((x) => x.id === `gev-ask-${e1.id}`), 'ответил — пункт ушёл');
      assert.equal((await B.post(`/api/gevents/${e1.id}/edit`, { time: '20:00' })).status, 400, 'менять может автор или владелец');
      const r = await A.post(`/api/gevents/${e1.id}/edit`, { time: '20:00', place: 'Бар' });
      assert.equal(r.status, 200); assert.equal(r.json.notified, true); assert.equal(r.json.event.time, '20:00');
      const ch = (await ib(B)).find((x) => x.kind === 'gev-edit');
      assert.ok(ch && /20:00/.test(ch.text) && /Бар/.test(ch.text), JSON.stringify(ch));
      assert.ok(!(await ib(A)).some((x) => x.kind === 'gev-edit'), 'кто менял — тому не пишем');
      const r2 = await A.post(`/api/gevents/${e1.id}/edit`, { note: 'Берём гирлянды' });
      assert.equal(r2.json.notified, false, 'подробности — без пуша');
      const e2 = (await A.post(`/api/gangs/${g.id}/gevents`, { kind: 'meet', title: 'Каток', day: '2026-12-20', time: '12:00' })).json.event;
      await B.post(`/api/gevents/${e2.id}/rsvp`, { answer: 'maybe' });
      assert.ok((await ib(B)).some((x) => x.id === `gev-soon-${e2.id}-2026-12-20` && /Завтра/.test(x.title)));
      await A.post(`/api/gevents/${e2.id}/cancel`);
      assert.ok((await ib(B)).some((x) => x.kind === 'gev-cancel' && /Каток/.test(x.title)));
      await A.post(`/api/gangs/${g.id}/polls`, { question: 'Что дарим банде?', options: ['Торт', 'Пицца'], days: 3 });
      assert.ok((await ib(B)).some((x) => x.kind === 'poll'));
    });

    await step('Санта после 4 декабря: запись закрыта', async () => {
      const v = (await A.get(`/api/gangs/${g.id}/santa`)).json;
      assert.equal(v.regOpen, false);
      assert.equal((await A.post(`/api/gangs/${g.id}/santa/join`, { wish: '' })).status, 400);
    });
  } finally { s2.stop(); }

  console.log(`holidays: ${passed} ok`);
})().catch((e) => { console.error(e); process.exit(1); });
