// Турнир банд — «Кубок месяца».
// РЕГЛАМЕНТ
//  • Запись — с 15-го числа до старта. Записывает банду владелец; в банде — от 3 человек.
//  • Старт — за 6 рабочих дней до конца месяца: три раунда по 2 рабочих дня (на 8 банд).
//  • Сетка — по очкам Лиги месяца: сильные получают слабых соперников, при нечётном числе — проход без боя.
//  • Каждый матч — блиц героев на 3 минуты по теме раунда (одна тема на весь раунд, темы турнира не «сгорают»).
//    Героя на каждый матч назначает владелец, ротация действует. Ничья — проходит банда выше в Лиге.
//  • Чемпиону — Кубок в профиль банды и по 15 зёрен каждому, финалисту — по 5.
//  • Меньше 2 банд к старту — турнир переносится на следующий месяц.

const MAX_TEAMS = 8;
const ROUND_DAYS = 2;
const PRIZE_CHAMP = 15, PRIZE_FINAL = 5;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function register(ctx) {
  const { db, q, route, requireUser, requireAdmin, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, gangwar, league } = ctx;
  const { workdayName } = require('./holidays');

  db.exec(`
  CREATE TABLE IF NOT EXISTS tourneys (
    id INTEGER PRIMARY KEY, month TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'reg',   -- reg | running | done | cancelled
    start_day TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 0,
    bracket TEXT, champion INTEGER, runner_up INTEGER, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tourney_teams (
    tourney_id INTEGER NOT NULL REFERENCES tourneys(id) ON DELETE CASCADE,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, PRIMARY KEY (tourney_id, gang_id)
  );
  `);

  const today = () => U.msk().day;
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  // Старт: шестой рабочий день с конца месяца
  function startDayOf(ym) {
    let d = monthEnd(ym), n = 0;
    for (let i = 0; i < 31; i++) { if (workdayName(d)) { n++; if (n === 6) return d; } d = addDays(d, -1); }
    return ym + '-20';
  }
  const title = (ym) => `Кубок ${MONTHS_GEN[Number(ym.slice(5, 7)) - 1]}`;
  const gang = (id) => q('SELECT * FROM gangs WHERE id = ?').get(id);
  const memberCount = (gid) => q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(gid).n;

  function current() {
    const ym = today().slice(0, 7);
    let t = q('SELECT * FROM tourneys WHERE month = ?').get(ym);
    if (!t) { q('INSERT OR IGNORE INTO tourneys (month, start_day, at) VALUES (?, ?, ?)').run(ym, startDayOf(ym), U.now()); t = q('SELECT * FROM tourneys WHERE month = ?').get(ym); }
    return t;
  }
  const regOpen = (t) => t.status === 'reg' && today() >= t.month + '-15' && today() < t.start_day;

  function seedScore(gid, ym) {
    if (!league) return 0;
    const p = league.period('M', ym + '-01');
    const s = league.standings(p, { live: false }).all.find((r) => r.id === gid);
    return s ? s.score : 0;
  }

  function pickTopic() {
    const list = gangwar.allTopics().filter((t) => t.from <= today());
    return list[Math.floor(Math.random() * list.length)].id;
  }

  function startRound(t, br, round, teams) {
    const topic = pickTopic();
    const ends = gangwar.workEnd(ROUND_DAYS);
    const matches = [];
    for (let i = 0; i < teams.length; i += 2) {
      const a = teams[i], b = teams[i + 1];
      if (!b) { matches.push({ a, b: null, war: null, winner: a }); continue; }
      const war = gangwar.createTourWar(t.id, round, a, b, topic, ends);
      matches.push({ a, b, war, winner: null });
      for (const g of [a, b]) {
        const other = gang(g === a ? b : a);
        q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(g, gang(g).owner_id, 'text', `${title(t.month)}, ${roundName(round, br.size)}: против «${other.name}». Владелец, назначь героя — блиц на 3 минуты, 2 рабочих дня`, U.now());
        const o = gang(g).owner_id;
        if (o) fireAndForget(notify([o], { title: `${title(t.month)}`, body: `${roundName(round, br.size)}: против «${other.name}». Назначь героя`, url: `/#gang/${g}`, tag: `tour-${t.id}-${round}` }));
      }
    }
    br.rounds[round] = { topic, matches };
    q('UPDATE tourneys SET round = ?, bracket = ? WHERE id = ?').run(round, JSON.stringify(br), t.id);
  }
  const roundName = (r, size) => { const left = size / Math.pow(2, r); return left <= 2 ? 'финал' : left <= 4 ? 'полуфинал' : 'четвертьфинал'; };

  function start(t) {
    const teams = q('SELECT gang_id FROM tourney_teams WHERE tourney_id = ?').all(t.id).map((r) => r.gang_id).filter((g) => gang(g) && !gang(g).hidden && memberCount(g) >= 3);
    if (teams.length < 2) { q("UPDATE tourneys SET status = 'cancelled' WHERE id = ?").run(t.id); return; }
    const seeded = teams.map((g) => ({ g, s: seedScore(g, t.month) })).sort((a, b) => b.s - a.s).slice(0, MAX_TEAMS).map((x) => x.g);
    const size = seeded.length <= 2 ? 2 : seeded.length <= 4 ? 4 : 8;
    // 1 против последнего, 2 против предпоследнего…; лишним сильным — проход без боя
    const order = [];
    for (let i = 0; i < size / 2; i++) { order.push(seeded[i]); order.push(seeded[size - 1 - i] || null); }
    const br = { seeds: seeded, size, rounds: [] };
    q("UPDATE tourneys SET status = 'running' WHERE id = ?").run(t.id);
    startRound(t, br, 0, order);
    advance(q('SELECT * FROM tourneys WHERE id = ?').get(t.id));
  }

  // Проверить раунд: все матчи сыграны — следующий раунд или итог
  function advance(t) {
    if (!t || t.status !== 'running') return;
    const br = JSON.parse(t.bracket);
    const cur = br.rounds[t.round];
    for (const m of cur.matches) {
      if (m.winner || !m.war) continue;
      const w = gangwar.resolve(q('SELECT * FROM gang_wars WHERE id = ?').get(m.war));
      if (w.status !== 'done') continue;
      m.winner = w.winner_gang || (br.seeds.indexOf(m.a) < br.seeds.indexOf(m.b) ? m.a : m.b);
    }
    q('UPDATE tourneys SET bracket = ? WHERE id = ?').run(JSON.stringify(br), t.id);
    if (cur.matches.some((m) => !m.winner)) return;
    const winners = cur.matches.map((m) => m.winner);
    if (winners.length === 1) {
      const final = cur.matches[0];
      const champ = final.winner, runner = final.a === champ ? final.b : final.a;
      q("UPDATE tourneys SET status = 'done', champion = ?, runner_up = ? WHERE id = ?").run(champ, runner, t.id);
      for (const m of gangMembers(champ)) addBeans(m.id, 'tour_win', PRIZE_CHAMP);
      if (runner) for (const m of gangMembers(runner)) addBeans(m.id, 'tour_final', PRIZE_FINAL);
      const all = q('SELECT gang_id FROM tourney_teams WHERE tourney_id = ?').all(t.id).flatMap((r) => gangMembers(r.gang_id).map((m) => m.id));
      fireAndForget(notify(all, { title: `${title(t.month)}: чемпион — «${gang(champ).name}»`, body: `Финалист — «${runner ? gang(runner).name : '—'}». Кубок уходит в профиль банды`, url: `/#gang/${champ}`, tag: `tour-${t.id}` }));
      return;
    }
    startRound(t, br, t.round + 1, winners);
  }

  function tick() {
    const t = current();
    if (t.status === 'reg' && today() >= t.start_day) start(t);
    for (const r of q("SELECT * FROM tourneys WHERE status = 'running'").all()) advance(r);
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('tourney', e); } }, 10 * 60e3).unref();
  gangwar.hooks.onDone = (w) => { if (w.tour_id) { try { advance(q('SELECT * FROM tourneys WHERE id = ?').get(w.tour_id)); } catch (e) { console.error('tourney', e); } } };

  function view(t, uid) {
    const mine = q('SELECT g.* FROM gangs g JOIN gang_members m ON m.gang_id = g.id WHERE m.user_id = ? AND g.hidden = 0 ORDER BY m.joined_at LIMIT 1').get(uid);
    const teams = q('SELECT gang_id FROM tourney_teams WHERE tourney_id = ? ORDER BY at').all(t.id).map((r) => gang(r.gang_id)).filter(Boolean);
    const pub = (id) => { const g = id ? gang(id) : null; return g ? { id: g.id, name: g.name, color: g.color, ...U.crestPub(g), mine: !!mine && mine.id === g.id } : null; };
    const br = t.bracket ? JSON.parse(t.bracket) : null;
    return {
      id: t.id, title: title(t.month), month: MONTHS[Number(t.month.slice(5, 7)) - 1], status: t.status, regFrom: t.month + '-15', startDay: t.start_day, regOpen: regOpen(t),
      teams: teams.map((g) => pub(g.id)), registered: !!mine && teams.some((g) => g.id === mine.id),
      canRegister: !!mine && mine.owner_id === uid && regOpen(t), myGangSmall: !!mine && memberCount(mine.id) < 3,
      rounds: br ? br.rounds.map((r, i) => ({ name: roundName(i, br.size), topic: (gangwar.allTopics().find((x) => x.id === r.topic) || {}).title || '', matches: r.matches.map((m) => ({ a: pub(m.a), b: pub(m.b), war: m.war, winner: m.winner })) })) : [],
      champion: pub(t.champion), runnerUp: pub(t.runner_up),
      rules: { maxTeams: MAX_TEAMS, roundDays: ROUND_DAYS, prizeChamp: PRIZE_CHAMP, prizeFinal: PRIZE_FINAL }
    };
  }

  route('GET', '/api/tourney', async (req) => {
    const u = requireUser(req);
    tick();
    const t = current();
    const last = q("SELECT * FROM tourneys WHERE status = 'done' AND id != ? ORDER BY id DESC LIMIT 1").get(t.id);
    return { ...view(t, u.id), last: last ? { title: title(last.month), champion: view(last, u.id).champion } : null };
  });
  route('POST', '/api/tourney/register', async (req, body) => {
    const u = requireUser(req);
    const t = current();
    const g = q('SELECT g.* FROM gangs g JOIN gang_members m ON m.gang_id = g.id WHERE m.user_id = ? AND g.hidden = 0 ORDER BY m.joined_at LIMIT 1').get(u.id);
    if (!g || g.owner_id !== u.id) throw bad('Записывает банду владелец.');
    if (!regOpen(t)) throw bad(t.status !== 'reg' ? 'Турнир уже идёт.' : `Запись открывается ${t.month.slice(8) || '15'}-го: с 15-го числа до старта.`);
    if (memberCount(g.id) < 3) throw bad('В турнире — банды от 3 человек.');
    if (body.off) q('DELETE FROM tourney_teams WHERE tourney_id = ? AND gang_id = ?').run(t.id, g.id);
    else {
      q('INSERT OR IGNORE INTO tourney_teams (tourney_id, gang_id, at) VALUES (?, ?, ?)').run(t.id, g.id, U.now());
      q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(g.id, u.id, 'text', `Банда записана на «${title(t.month)}». Старт — ${t.start_day.slice(8)}.${t.start_day.slice(5, 7)}. Готовим героев!`, U.now());
    }
    return view(current(), u.id);
  });
  // Модератор: запустить турнир сейчас (для проверки или если надо раньше)
  route('POST', '/api/admin/tourney/start', async (req) => {
    requireAdmin(req);
    const t = current();
    if (t.status !== 'reg') throw bad('Турнир уже запущен.');
    start(t);
    return { ok: true, status: q('SELECT status FROM tourneys WHERE id = ?').get(t.id).status };
  });
  // Для теста и модератора: записать банды без окна записи
  route('POST', '/api/admin/tourney/add', async (req, body) => {
    requireAdmin(req);
    const t = current();
    q('INSERT OR IGNORE INTO tourney_teams (tourney_id, gang_id, at) VALUES (?, ?, ?)').run(t.id, Number(body.gang), U.now());
    return { ok: true };
  });

  function cups(gid) { return q("SELECT COUNT(*) AS n FROM tourneys WHERE status = 'done' AND champion = ?").get(gid).n; }
  return { tick, cups };
}

module.exports = { register };
