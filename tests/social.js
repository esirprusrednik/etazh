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
  return { Client, ready, stop: () => proc.kill(), log: () => log, dir };
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

    await step('взаимность имён: без своего имени чужих не видно', async () => {
      await B.post('/api/me/profile', { profile: { firstName: 'Борис', lastName: 'Петров' } });
      const cardD = (await D.get(`/api/users/${B.id}`)).json;
      assert.equal(cardD.name || '', '', 'D без имени — имя B скрыто');
      assert.ok((await D.get('/api/state')).json.nameLock.named >= 1);
      assert.equal(((await D.get('/api/search?q=' + encodeURIComponent('Борис'))).json.items || []).length, 0, 'по имени не ищет');
      await D.post('/api/me/profile', { profile: { firstName: 'дИНА', lastName: 'римская-КОРСАКОВА' } });
      const me = (await D.get('/api/me')).json.user.profile;
      assert.equal(me.firstName, 'Дина'); assert.equal(me.lastName, 'Римская-Корсакова', 'регистр правим сами');
      assert.equal((await D.post('/api/me/profile', { profile: { lastName: '' } })).status, 400, 'стереть фамилию нельзя');
      assert.equal((await D.get(`/api/users/${B.id}`)).json.name, 'Борис Петров');
      assert.equal((await D.get('/api/state')).json.nameLock, null);
    });

    await step('переписка в базе зашифрована, а в приложении читается', async () => {
      await B.post(`/api/gangs/${gb.id}/messages`, { type: 'text', text: 'СекретнаяФраза42 в чате' });
      await B.post(`/api/crew/${D.id}/messages`, { type: 'text', text: 'ЛичнаяФраза77 в личке' });
      const chat = (await D.get(`/api/gangs/${gb.id}`)).json.messages;
      assert.ok(chat.some((m) => m.text === 'СекретнаяФраза42 в чате'));
      const dm = (await D.get(`/api/crew/${B.id}`)).json;
      assert.ok(JSON.stringify(dm).includes('ЛичнаяФраза77'), 'получатель читает');
      await new Promise((r) => setTimeout(r, 300));
      const raw = fs.readdirSync(sv.dir).map((f) => fs.readFileSync(path.join(sv.dir, f)).toString('utf8')).join('');
      assert.ok(!raw.includes('СекретнаяФраза42') && !raw.includes('ЛичнаяФраза77'), 'в файлах базы текста нет');
    });

    await step('секретный чат: сервер хранит только ключи и шифр', async () => {
      const pub = (x) => ({ kty: 'EC', crv: 'P-256', x: x.padEnd(43, 'A'), y: 'B'.repeat(43) });
      assert.equal((await A.post('/api/e2e/key', { pub: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b', d: 'secret' } })).status, 400, 'закрытый ключ не принимаем');
      assert.equal((await A.post('/api/e2e/key', { pub: pub('Xa') })).status, 200);
      const msg = { iv: 'AAAAAAAAAAAAAAAA', ct: 'Q2lwaGVydGV4dA', kfp: '0123456789abcdef' };
      assert.equal((await A.post(`/api/secret/${B.id}`, msg)).status, 400, 'у собеседника нет ключа');
      await B.post('/api/e2e/key', { pub: pub('Xb') });
      assert.equal((await A.post(`/api/secret/${B.id}`, msg)).status, 200);
      assert.equal((await A.post(`/api/secret/${B.id}`, { ...msg, ct: 'не base64!' })).status, 400);
      const v = (await B.get(`/api/secret/${A.id}`)).json;
      assert.equal(v.items.length, 1); assert.equal(v.items[0].ct, msg.ct); assert.ok(v.theirs && v.mine);
      assert.ok((await B.get('/api/inbox')).json.items.length >= 0);
      const ib = (await A.get(`/api/secret/${B.id}`)).json.items[0];
      assert.equal(ib.read, true, 'получатель открыл — прочитано');
    });

    await step('«Кто знает?»: темы в профиле, поиск, вопрос с доски приходит знатоку', async () => {
      assert.equal((await B.post('/api/me/profile', { profile: { askMe: 'a,b,c,d,e,f'.split(',').map((x) => x + x) } })).status, 400, 'не больше пяти');
      await B.post('/api/me/profile', { profile: { role: 'Аналитика тарифов B2B', askMe: 'парковка, jira, Парковка' } });
      const card = (await A.get(`/api/users/${B.id}`)).json;
      assert.deepEqual(card.askMe, ['Парковка', 'Jira'], 'с большой буквы и без повторов');
      assert.equal(card.role, 'Аналитика тарифов B2B');
      const r = (await A.get('/api/experts?q=' + encodeURIComponent('парк'))).json;
      assert.equal(r.items[0].nick, 'другой_отдел'); assert.deepEqual(r.items[0].tags, ['Парковка']);
      assert.ok((await A.get('/api/experts?q=' + encodeURIComponent('тариф'))).json.items.length === 1, 'и по «Чем занимаюсь»');
      assert.ok((await A.get('/api/experts')).json.popular.includes('Парковка'));
      assert.deepEqual((await B.get('/api/experts')).json.mine.askMe, ['Парковка', 'Jira'], 'свои темы видны — плашка «Заполнить» пропадает');
      await A.post('/api/board', { kind: 'ask', text: 'Где взять гостевой пропуск на парковку?', until: '2026-11-12' });
      const ib = (await B.get('/api/inbox')).json.items;
      assert.ok(ib.some((x) => x.kind === 'ask' && /Парковка|парковка/.test(x.title)), JSON.stringify(ib.map((x) => x.title)));
    });

    await step('спасибо любому коллеге: без общей банды, лимит, блок', async () => {
      const left0 = (await A.get('/api/thanks/left')).json.left;
      const before = (await B.get('/api/me')).json.user.beans;
      const r = await A.post('/api/thanks', { to: B.id, text: 'За ответ про парковку' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.left, left0 - 1);
      assert.equal((await B.get('/api/me')).json.user.beans, before + 1, '+1 зерно получателю');
      assert.equal((await A.post('/api/thanks', { to: 999999 })).status, 400);
      assert.equal((await A.post('/api/thanks', { to: A.id })).status, 400, 'себе нельзя');
    });

    await step('волна: от трёх человек, раз в неделю, встал — зёрна, итог', async () => {
      assert.equal((await B.post(`/api/gangs/${gb.id}/wave`)).status, 400, 'двоих мало для волны');
      const E = await new Client().login('s5@mts.ru', 'болельщик');
      await E.post(`/api/gangs/${gb.id}/apply`);
      let w = (await B.post(`/api/gangs/${gb.id}/wave`)).json;
      assert.ok(w.active, JSON.stringify(w));
      assert.equal(w.active.joined, 1, 'запустивший уже стоит');
      assert.equal((await D.post(`/api/gangs/${gb.id}/wave`)).status, 400, 'вторая волна, пока идёт первая, — нельзя');
      assert.ok((await D.get('/api/inbox')).json.items.some((x) => x.kind === 'wave'), 'в сводке — «вставай»');
      const before = (await D.get('/api/me')).json.user.beans;
      w = (await D.post(`/api/waves/${w.active.id}/join`)).json;
      assert.equal(w.beans, 2); assert.ok((await D.get('/api/me')).json.user.beans >= before + 2, '+2 за волну (и ачивка «Свой» сверху)');
      assert.ok((await D.get('/api/features')).json.achievements.find((x) => x.id === 'wave1').got, 'ачивка «Свой»');
      assert.equal((await D.post(`/api/waves/${w.active.id}/join`)).json.beans, 0, 'встать дважды — без зёрен');
      assert.equal((await A.post(`/api/waves/${w.active.id}/join`)).status, 404, 'чужая банда');
      w = (await E.post(`/api/waves/${w.active.id}/join`)).json;
      assert.equal(w.active.joined, 3);
      assert.ok((await B.get('/api/features')).json.achievements.find((x) => x.id === 'wave_full').got, 'встала вся банда — запустившему «Капитан»');
      assert.ok(!((await D.get('/api/inbox')).json.items.some((x) => x.kind === 'wave')));
      assert.match((await B.get(`/api/gangs/${gb.id}/wave`)).json.why || '', /^$|неделе/);
      assert.equal((await B.get(`/api/gangs/${gb.id}/wave`)).json.canLaunch, false, 'волна ещё идёт');
    });

    await step('«Мой стиль»: по действиям, без текстов, только себе', async () => {
      await D.post(`/api/crew/${B.id}/messages`, { type: 'text', text: 'привет' });
      await B.post(`/api/crew/${D.id}/messages`, { type: 'text', text: 'и тебе' });
      await D.post(`/api/crew/${B.id}/messages`, { type: 'text', text: 'как дела' });
      const st = (await D.get('/api/me/style')).json;
      assert.ok(st.main && st.main.title, JSON.stringify(st).slice(0, 300));
      assert.ok(st.total > 0, 'ритм по часам считается');
      assert.ok(st.ties.some((p) => p.id === B.id), 'B — среди тех, с кем на связи');
      assert.ok(!JSON.stringify(st).includes('как дела'), 'тексты сообщений в карточку не попадают');
      assert.equal(st.hours.length, 16); assert.equal(st.week.length, 5);
      assert.equal((await D.get(`/api/users/${B.id}/style`)).status, 404, 'чужой стиль не отдаётся');
      // Бейджи: показать можно только заработанные и не больше трёх
      assert.equal(st.badges.length, 15);
      const fast = st.badges.find((b) => b.id === 'fast');
      assert.ok(fast.got || /в личке|в среднем/.test(fast.hint), 'у «Отвечает быстро» — понятная подсказка: ' + fast.hint);
      assert.ok(st.badges.filter((b) => ['lark', 'lunch', 'owl'].includes(b.id) && !b.got).every((b) => /ритм/i.test(b.hint)), 'у бейджей ритма — какой ритм сейчас');
      assert.equal((await D.post('/api/me/badges', { ids: ['voice'] })).status, 400, 'незаработанный — нельзя');
      assert.equal((await D.post('/api/me/badges', { ids: ['a', 'b', 'c', 'd'] })).status, 400, 'больше трёх — нельзя');
      const got = st.badges.filter((b) => b.got).map((b) => b.id);
      if (got.length) {
        assert.equal((await D.post('/api/me/badges', { ids: [got[0]] })).status, 200);
        assert.deepEqual((await B.get(`/api/users/${D.id}`)).json.badges.map((b) => b.id), [got[0]], 'бейдж виден в карточке');
      }
      assert.equal((await D.post('/api/me/badges', { ids: [] })).status, 200);
      assert.deepEqual((await B.get(`/api/users/${D.id}`)).json.badges, [], 'снятый бейдж из карточки пропал');
    });

    await step('батарейка: заряд только себе, подзарядка — по своей просьбе и только от своих', async () => {
      let b = (await D.post('/api/battery', { answers: [3, 3, 3, 3, 3] })).json;
      assert.equal(b.mine.level, 100); assert.equal(b.mine.lv.id, 'full');
      assert.equal((await D.post('/api/battery/ask', { on: true })).status, 400, 'при полном заряде просить не нужно');
      assert.equal((await D.post('/api/battery', { answers: [3, 3, 9, 3, 3] })).status, 400, 'ответы только 0–3');
      b = (await D.post('/api/battery', { answers: [0, 0, 1, 0, 0] })).json;
      assert.equal(b.mine.level, 7); assert.equal(b.mine.lv.id, 'empty');
      let mates = (await B.get(`/api/gangs/${gb.id}`)).json.members;
      assert.equal(mates.find((m) => m.id === D.id).charge, false, 'без просьбы банда ничего не видит');
      assert.equal((await B.post('/api/battery/boost', { to: D.id, kind: 'choco' })).status, 400, 'подзарядку не просили');
      await D.post('/api/battery/ask', { on: true });
      mates = (await B.get(`/api/gangs/${gb.id}`)).json;
      assert.equal(mates.members.find((m) => m.id === D.id).charge, true, 'попросил — значок у своих');
      assert.ok(!JSON.stringify(mates).includes('"level"'), 'процент заряда никому не уходит');
      assert.ok((await B.get('/api/inbox')).json.items.some((x) => x.kind === 'boost'), 'в сводке у своих — «просит подзарядку»');
      assert.equal((await B.post('/api/battery/boost', { to: D.id, kind: 'choco' })).status, 200);
      assert.equal((await B.post('/api/battery/boost', { to: D.id, kind: 'choco' })).status, 400, 'одну и ту же — один раз в неделю');
      assert.equal((await A.post('/api/battery/boost', { to: D.id, kind: 'five' })).status, 404, 'чужие не подзаряжают');
      b = (await D.get('/api/battery')).json;
      assert.equal(b.boosts.length, 1); assert.equal(b.boosts[0].from.id, B.id);
      await D.post('/api/battery', { answers: [3, 3, 3, 2, 3] });
      assert.equal((await B.get(`/api/gangs/${gb.id}`)).json.members.find((m) => m.id === D.id).charge, false, 'зарядился — просьба снялась сама');
    });

    const E2 = await new Client().login('todo@mts.ru', 'деловой_ёж');
    await step('дела дня: до трёх, похвала и зёрна за чистый день, текст зашифрован, чужое не трогать', async () => {
      let t = (await E2.get('/api/todos')).json;
      assert.equal(t.left, 3);
      t = (await E2.post('/api/todos', { text: 'Вернуть зонт секретный-зонт-42', when: 'today', time: '23:59' })).json;
      t = (await E2.post('/api/todos', { text: 'Позвать на кофе', when: 'today', person: B.id })).json;
      t = (await E2.post('/api/todos', { text: 'Поздравить', when: 'today' })).json;
      assert.equal(t.today.length, 3); assert.equal(t.left, 0);
      assert.equal(t.today.find((x) => x.person).person.id, B.id);
      assert.equal((await E2.post('/api/todos', { text: 'Четвёртое', when: 'today' })).status, 400, 'больше трёх — нельзя');
      assert.equal((await E2.post('/api/todos', { text: 'В офисе', when: 'office' })).status, 400, 'без плана недели офисного дня нет');
      assert.equal((await E2.post('/api/todos', { text: 'Завтрашнее', when: 'tomorrow' })).status, 200);
      assert.ok((await E2.get('/api/inbox')).json.items.some((x) => x.kind === 'todo'), 'в сводке — дела дня');
      const raw = fs.readdirSync(sv.dir).map((f) => fs.readFileSync(path.join(sv.dir, f)).toString('utf8')).join('');
      assert.ok(!raw.includes('секретный-зонт-42'), 'текст дела в базе зашифрован');
      assert.equal((await B.post(`/api/todos/${t.today[0].id}/done`, {})).status, 404, 'чужое дело не отметить');
      const before = (await E2.get('/api/me')).json.user.beans;
      let r = (await E2.post(`/api/todos/${t.today[0].id}/done`, {})).json;
      assert.equal(r.praise, null, 'пока не все — без похвалы');
      await E2.post(`/api/todos/${t.today[1].id}/done`, {});
      r = (await E2.post(`/api/todos/${t.today[2].id}/done`, {})).json;
      assert.ok(r.praise, 'все закрыты — похвала'); assert.equal(r.beans, 2); assert.equal(r.streak, 1); assert.equal(r.cleanToday, true);
      assert.ok((await E2.get('/api/me')).json.user.beans >= before + 2);
      assert.ok(!(await E2.get('/api/inbox')).json.items.some((x) => x.kind === 'todo'));
      assert.equal(r.later.length, 1);
      r = (await E2.post(`/api/todos/${r.later[0].id}/remove`, {})).json;
      assert.equal(r.later.length, 0);
      assert.ok((await E2.get('/api/features')).json.achievements.find((a) => a.id === 'todo1').got, 'ачивка «Чистый день»');
    });

    await step('пятиминутка: ответ, зёрна раз в неделю, чужие ответы — после своего, реакции', async () => {
      let f = (await B.get(`/api/gangs/${gb.id}/friday`)).json;
      assert.equal(f.canAnswer, true); assert.equal(f.questions.length, 3);
      const q0 = f.questions[0].id;
      const before = (await D.get('/api/me')).json.user.beans;
      f = (await D.post(`/api/gangs/${gb.id}/friday`, { q: q0, text: 'Закрыли релиз' })).json;
      assert.equal(f.beans, 3);
      f = (await D.post(`/api/gangs/${gb.id}/friday`, { q: f.questions[1].id, text: 'Научился SQL' })).json;
      assert.equal(f.beans, 0, 'зёрна — за первый ответ недели');
      assert.equal((await D.get('/api/me')).json.user.beans, before + 3);
      let fb = (await B.get(`/api/gangs/${gb.id}/friday`)).json;
      assert.equal(fb.questions[0].answers.length, 1);
      fb = (await B.post(`/api/gangs/${gb.id}/friday`, { q: q0, text: 'Всё было норм' })).json;
      const aid = fb.questions[0].answers.find((x) => !x.me).id;
      fb = (await B.post(`/api/friday/${aid}/react`, { e: '🔥' })).json;
      assert.equal(fb.questions[0].answers.find((x) => x.id === aid).counts['🔥'], 1);
      assert.equal((await A.get(`/api/gangs/${gb.id}/friday`)).status, 404, 'чужая банда');
      assert.equal((await D.post(`/api/gangs/${gb.id}/friday`, { q: 'нет-такого', text: 'x' })).status, 400);
      // Свёрнутая полоска: кто ответил, сколько чужих ответов; «пнуть банду» — раз в неделю и только ответившему
      fb = (await B.get(`/api/gangs/${gb.id}/friday`)).json;
      assert.ok(fb.answered.some((p) => p.id === D.id) && fb.answered.some((p) => p.id === B.id));
      assert.ok(fb.othersCount >= 2);
      assert.equal(fb.poked, false);
      const pk = (await B.post(`/api/gangs/${gb.id}/friday/poke`)).json;
      assert.equal(pk.poked, true);
      assert.equal((await D.post(`/api/gangs/${gb.id}/friday/poke`)).status, 400, 'второй раз за неделю — нельзя');
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

  // Среда, 11 ноября, ~12:30 по Москве: Этаж сам запускает волну в бандах, где за полнедели её никто не начал
  const offset = Math.round((Date.parse('2026-11-11T12:30:00Z') - Date.now()) / 3600e3);
  const sw = startServer('2026-11-11', { TZ_OFFSET_HOURS: String(offset), WAVE_TICK_MS: '700' });
  try {
    await sw.ready;
    await step('волна: одна на банду в неделю, в среду в 12 — автозапуск от Этажа', async () => {
      const P = await new sw.Client().login('w1@mts.ru', 'первый');
      const Q = await new sw.Client().login('w2@mts.ru', 'второй');
      const R = await new sw.Client().login('w3@mts.ru', 'третий');
      const g = (await P.post('/api/gangs', { name: 'Волнорезы', access: 'open' })).json;
      await Q.post(`/api/gangs/${g.id}/apply`); await R.post(`/api/gangs/${g.id}/apply`);
      const small = (await new sw.Client().login('w4@mts.ru', 'одиночка').then((x) => x.post('/api/gangs', { name: 'Двое', access: 'open' }))).json;
      let w = null;
      for (let i = 0; i < 30 && !(w && w.active); i++) { await new Promise((r) => setTimeout(r, 300)); w = (await Q.get(`/api/gangs/${g.id}/wave`)).json; }
      assert.ok(w.active, 'Этаж запустил волну сам: ' + JSON.stringify(w));
      assert.equal(w.active.by.auto, true);
      assert.equal(w.active.joined, 0, 'никто не встал автоматически');
      assert.equal((await P.post(`/api/gangs/${g.id}/wave`)).status, 400, 'вторую волну на этой неделе — нельзя');
      w = (await R.post(`/api/waves/${w.active.id}/join`)).json;
      assert.equal(w.active.joined, 1);
      assert.equal((await P.get(`/api/gangs/${small.id}/wave`)).status, 404, 'в чужую банду не заглянуть');
      assert.ok(small && small.id);
    });
  } finally { sw.stop(); }
  console.log(`social: ${passed} ok`);
})().catch((e) => { console.error(e); process.exit(1); });
