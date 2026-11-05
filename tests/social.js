// Связи сквозь банды: «Совпадаем», доска объявлений, совместные события: node tests/social.js
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.stack); throw e; }
}

// Сервер с подменённой датой: «сейчас» = day 12:00 по Москве
function startServer(day, extra = {}) {
  const PORT = 4000 + Math.floor(Math.random() * 1000);
  const BASE = `http://localhost:${PORT}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etazh-h-'));
  const offset = Math.round((Date.parse(day + 'T12:00:00Z') - Date.now()) / 3600e3);
  const proc = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server', 'index.js')], {
    env: {
      ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_PATH: path.join(dir, 'db.sqlite'),
      EMAIL_PEPPER: 'test-pepper-test-pepper-test-pepper-123', MAIL_MODE: 'console', SECURE_COOKIES: 'false',
      TZ_OFFSET_HOURS: String(offset), ...extra
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
  // 10 ноября 2026, вторник
  const fake = { daily: { time: ['2026-11-10', '2026-11-11', '2026-11-12'], weather_code: [3, 63, 3], temperature_2m_max: [5, 4, 3], temperature_2m_min: [1, 2, 0],
    apparent_temperature_min: [-2, -1, -3], precipitation_sum: [0, 8, 0], precipitation_probability_max: [10, 90, 10], snowfall_sum: [0, 0, 0], wind_gusts_10m_max: [20, 30, 20] } };
  const sv = startServer('2026-11-10', { WEATHER_FAKE: JSON.stringify(fake) });
  try {
    await sv.ready;
    const { Client } = sv;
    const A = await new Client().login('s1@mts.ru', 'совпадун');
    const B = await new Client().login('s2@mts.ru', 'другой_отдел');
    const C = await new Client().login('s3@mts.ru', 'скрытный');
    const D = await new Client().login('s4@mts.ru', 'гость');
    const ga = (await A.post('/api/gangs', { name: 'Альфа', access: 'open' })).json;
    const gb = (await B.post('/api/gangs', { name: 'Бета', access: 'open' })).json;
    await D.post(`/api/gangs/${gb.id}/apply`);

    await step('«Совпадаем»: видят только открывшие, банда не важна, общие интересы', async () => {
      await A.post('/api/me/profile', { profile: { home: 'smol', plan: { 'Вт': 'office', 'Ср': 'home' }, tags: ['Настолки', 'Бег'] } });
      await B.post('/api/me/profile', { profile: { home: 'smol', plan: { 'Вт': 'office', 'Ср': 'office' }, tags: ['Настолки'] } });
      await C.post('/api/me/profile', { profile: { home: 'smol', plan: { 'Вт': 'office' } } });
      let m = (await A.get('/api/match')).json;
      assert.equal(m.on, false); assert.ok(!m.days[0].offices, 'закрыто — чужих не видно');
      await B.post('/api/me/profile', { profile: { matchShow: true } });
      await A.post('/api/me/profile', { profile: { matchShow: true } });
      m = (await A.get('/api/match')).json;
      assert.equal(m.on, true);
      const tue = m.days.find((d) => d.day === '2026-11-10');
      const smol = tue.offices.find((o) => o.id === 'smol');
      assert.ok(smol && smol.people.some((p) => p.nick === 'другой_отдел'), JSON.stringify(tue));
      assert.ok(!smol.people.some((p) => p.nick === 'скрытный'), 'не открыл — не видно');
      assert.deepEqual(smol.people.find((p) => p.nick === 'другой_отдел').common, ['Настолки']);
    });

    await step('погода: завтра дождь — пункт в сводке только у того, кто завтра в офисе', async () => {
      const W = require('../server/weather');
      assert.equal(W.phrase({ code: 3, tmax: 5, tmin: 1, precip: 0, prob: 10, snow: 0, gusts: 20 }), null, 'обычная погода — молчим');
      assert.ok(/зонт/.test(W.phrase({ code: 63, tmax: 4, tmin: 2, precip: 8, prob: 90, snow: 0, gusts: 30 }).text));
      assert.ok(/сугроб/.test(W.phrase({ code: 75, tmax: -3, tmin: -6, precip: 9, prob: 90, snow: 7, gusts: 20 }).text));
      assert.ok(/теплее/.test(W.phrase({ code: 0, tmax: -15, tmin: -24, feelsMin: -30, precip: 0, snow: 0, gusts: 10 }).text));
      const ib = async (c) => (await c.get('/api/inbox')).json.items;
      // B завтра (среда) в офисе, A — дома
      const wB = (await ib(B)).find((x) => x.kind === 'weather');
      assert.ok(wB && /зонт/.test(wB.title), JSON.stringify(wB));
      assert.ok(!(await ib(A)).some((x) => x.kind === 'weather'), 'дома — без напоминания');
      await B.post('/api/me/profile', { profile: { weather: false } });
      assert.ok(!(await ib(B)).some((x) => x.kind === 'weather'), 'выключил — не показываем');
    });

    await step('взаимность графика: без своего плана банда скрыта, показываем, сколько уже заполнили', async () => {
      // D в банде «Бета» без плана, B (владелец) план заполнил
      let w = (await D.get(`/api/gangs/${gb.id}/extra`)).json;
      const wk = w.week;
      assert.ok(wk.locked, JSON.stringify(wk).slice(0, 200));
      assert.equal(wk.locked.filled, 1); assert.equal(wk.locked.total, 1);
      assert.equal(wk.rows.length, 1); assert.ok(wk.rows[0].me);
      assert.ok(wk.days.every((d) => d.office === null), 'счётчики по дням тоже скрыты');
      assert.ok((await D.get('/api/features')).json.weekLock);
      await D.post('/api/me/profile', { profile: { plan: { 'Пн': 'home' } } });
      const w2 = ((await D.get(`/api/gangs/${gb.id}/extra`)).json || {}).week;
      assert.ok(w2 && !w2.locked && w2.rows.length >= 1);
    });

    await step('доска: объявление, «я тоже» с отметкой автору, снять может только автор, срок', async () => {
      const r = await A.post('/api/board', { kind: 'company', text: 'Ищу компанию на обед в 13:00', until: '2026-11-12', office: 'smol' });
      assert.equal(r.status, 200);
      const id = r.json.item.id;
      assert.equal((await A.post('/api/board', { kind: 'company', text: 'хм' })).status, 400, 'слишком коротко');
      const far = await A.post('/api/board', { kind: 'other', text: 'Объявление надолго', until: '2027-01-30' });
      assert.equal(far.json.item.until, '2026-11-24', 'не дольше двух недель');
      const mt = await B.post(`/api/board/${id}/metoo`);
      assert.equal(mt.json.item.metoo, 1); assert.equal(mt.json.item.iMetoo, true);
      assert.equal((await A.post(`/api/board/${id}/metoo`)).status, 400, 'на своё — нельзя');
      const mine = (await A.get('/api/board')).json.items.find((x) => x.id === id);
      assert.equal(mine.fans[0].nick, 'другой_отдел', 'автор видит, кто откликнулся');
      assert.equal((await B.get('/api/board')).json.items.find((x) => x.id === id).fans, null, 'остальные — нет');
      assert.equal((await B.post(`/api/board/${id}/remove`)).status, 400);
      assert.equal((await A.post(`/api/board/${id}/remove`)).status, 200);
      assert.ok(!(await B.get('/api/board')).json.items.some((x) => x.id === id));
    });

    await step('совместное событие двух банд: видят обе, отвечают, сводка гостям', async () => {
      const guests = (await A.get(`/api/gangs/${ga.id}/gevent-guests`)).json.items;
      assert.ok(guests.some((g) => g.id === gb.id) && !guests.some((g) => g.id === ga.id));
      const e = (await A.post(`/api/gangs/${ga.id}/gevents`, { kind: 'party', title: 'Общий боулинг', day: '2026-11-13', time: '19:00', guest: gb.id })).json.event;
      assert.equal(e.guest.id, gb.id);
      const inB = (await D.get(`/api/gangs/${gb.id}/gevents`)).json.upcoming.find((x) => x.id === e.id);
      assert.ok(inB, 'гостевая банда видит событие');
      assert.equal(inB.canEdit, false);
      const ib = (await D.get('/api/inbox')).json.items.find((x) => x.id === `gev-ask-${e.id}`);
      assert.ok(ib && ib.go.id === gb.id, 'ссылка ведёт в свою банду');
      assert.equal((await D.post(`/api/gevents/${e.id}/rsvp`, { answer: 'yes' })).status, 200);
      assert.equal((await C.post(`/api/gevents/${e.id}/rsvp`, { answer: 'yes' })).status, 404, 'чужим нельзя');
      const chatB = (await D.get(`/api/gangs/${gb.id}`)).json.messages;
      assert.ok(chatB.some((m) => /зовёт вас/.test(m.text || '')));
      await A.post(`/api/gevents/${e.id}/edit`, { time: '20:00' });
      assert.ok((await D.get('/api/inbox')).json.items.some((x) => x.kind === 'gev-edit' && x.go.id === gb.id));
    });
  } finally { sv.stop(); }
  console.log(`social: ${passed} ok`);
})().catch((e) => { console.error(e); process.exit(1); });
