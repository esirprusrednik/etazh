// Лига банд: каждый участник приносит банде очки за то же, за что получает зёрна (отметки, задания, игры, спасибо),
// банды соревнуются по неделям и месяцам, призы раздаются сами в понедельник и 1-го числа.
//
// Чтобы банда на 30 человек не выигрывала просто числом, счёт — средний вклад на участника:
//   очки банды = сумма очков участников / max(3, сколько людей было в банде за период) + бонусы «Банда в сборе».
// В делитель попадают все, кто был в банде в этот период, — выгнать молчунов ради среднего не выйдет.
// Один человек в день приносит не больше DAY_CAP очков — одиночка-задрот банду не вытащит.

const DAY_CAP = 40;
const MIN_ROSTER = 3;
const TOGETHER_SHARE = 0.7;     // «Банда в сборе»: столько участников отметились за день (офис или дом)
const TOGETHER_BONUS = 10;
const LAUNCH = process.env.LEAGUE_LAUNCH || '2026-11-02';    // периоды раньше старта не разыгрываем
const COUNT_REASONS = new Set(['checkin', 'home', 'canteen', 'reply', 'signal_confirmed', 'thanks', 'wave', 'sea_win', 'guess', 'quiz', 'food_rate', 'blitz', 'quest', 'quest_all', 'ach', 'gangwar', 'gangwar_team', 'tour_win', 'tour_final']);

const PRIZES = {
  W: [{ beans: 30, items: ['p_trophy'] }, { beans: 20, items: [] }, { beans: 10, items: [] }],
  M: [{ beans: 100, items: ['p_laurel', 'fr_champ'] }, { beans: 70, items: ['p_laurel'] }, { beans: 50, items: ['p_laurel'] }]
};
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shortDate = (day) => `${Number(day.slice(8))} ${MONTHS_GEN[Number(day.slice(5, 7)) - 1]}`;

function period(type, day) {
  if (type === 'W') {
    const from = mondayOf(day);
    const to = addDays(from, 6);
    return { type, key: 'W:' + from, from, to, label: `неделя ${shortDate(from)} — ${shortDate(to)}` };
  }
  const ym = day.slice(0, 7);
  return { type, key: 'M:' + ym, from: ym + '-01', to: monthEnd(ym), label: MONTHS[Number(ym.slice(5)) - 1] + ' ' + ym.slice(0, 4) };
}

function register(ctx) {
  const { db, q, route, requireUser, U, addBeans, notify, fireAndForget, myEvent } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS league_points (
    day TEXT NOT NULL, gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, gang_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS league_roster (
    period TEXT NOT NULL, gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (period, gang_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS league_results (
    period TEXT NOT NULL, gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    place INTEGER NOT NULL, score INTEGER NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (period, gang_id)
  );
  CREATE TABLE IF NOT EXISTS league_settled (period TEXT PRIMARY KEY, at INTEGER NOT NULL);
  `);

  const today = () => U.msk().day;
  // Основная банда: если человек остался в нескольких (до правила «одна банда»), очки идут в самую раннюю
  const mainGang = (uid) => (q('SELECT m.gang_id FROM gang_members m JOIN gangs g ON g.id = m.gang_id WHERE m.user_id = ? AND g.hidden = 0 ORDER BY m.joined_at LIMIT 1').get(uid) || {}).gang_id || null;
  const memberIds = (gid) => q('SELECT user_id FROM gang_members WHERE gang_id = ?').all(gid).map((r) => r.user_id);

  function touch(gid, uids = memberIds(gid), day = today()) {
    const ins = q('INSERT OR IGNORE INTO league_roster (period, gang_id, user_id) VALUES (?, ?, ?)');
    for (const t of ['W', 'M']) { const p = period(t, day); for (const uid of uids) ins.run(p.key, gid, uid); }
  }

  // Вызывается из addBeans: зёрна за активность — очки основной банде
  function award(uid, amount, reason) {
    if (!(amount > 0) || !COUNT_REASONS.has(reason)) return 0;
    const gid = mainGang(uid);
    if (!gid) return 0;
    const day = today();
    const got = q('SELECT COALESCE(SUM(points), 0) AS n FROM league_points WHERE day = ? AND user_id = ?').get(day, uid).n;
    const add = Math.min(amount, DAY_CAP - got);
    if (add <= 0) return 0;
    q(`INSERT INTO league_points (day, gang_id, user_id, points) VALUES (?, ?, ?, ?)
       ON CONFLICT(day, gang_id, user_id) DO UPDATE SET points = points + excluded.points`).run(day, gid, uid, add);
    touch(gid, [uid], day);
    return add;
  }

  // Сколько дней банда была «в сборе»: отметились (офис или дом) не меньше 70% и не меньше трёх человек
  function togetherDays(gid, p) {
    const ids = memberIds(gid);
    if (ids.length < MIN_ROSTER) return 0;
    const need = Math.max(MIN_ROSTER, Math.ceil(ids.length * TOGETHER_SHARE));
    const last = p.to < today() ? p.to : today();
    return q(`SELECT day, COUNT(DISTINCT l.user_id) AS n FROM ledger l JOIN gang_members m ON m.user_id = l.user_id AND m.gang_id = ?
      WHERE l.reason IN ('checkin', 'home') AND l.day BETWEEN ? AND ? GROUP BY l.day`).all(gid, p.from, last).filter((r) => r.n >= need).length;
  }

  function standings(p, { live = true, company = null } = {}) {
    if (live && p.from <= today() && today() <= p.to) {
      for (const g of q('SELECT id FROM gangs WHERE hidden = 0').all()) touch(g.id);
    }
    const sums = new Map(q('SELECT gang_id, SUM(points) AS s FROM league_points WHERE day BETWEEN ? AND ? GROUP BY gang_id').all(p.from, p.to).map((r) => [r.gang_id, r.s]));
    const rosters = new Map(q('SELECT gang_id, COUNT(*) AS n FROM league_roster WHERE period = ? GROUP BY gang_id').all(p.key).map((r) => [r.gang_id, r.n]));
    // Лига — внутри компании: банды МТС и Роснефти соревнуются каждая со своими
    const gangs = q('SELECT id, name, color, emoji, access, crest, area, interests, style, company FROM gangs WHERE hidden = 0').all().filter((g) => (!company || (g.company || 'mts') === company) && (rosters.has(g.id) || sums.has(g.id)));
    const rows = gangs.map((g) => {
      const total = sums.get(g.id) || 0;
      const roster = rosters.get(g.id) || 0;
      const together = togetherDays(g.id, p);
      const score = Math.round(total / Math.max(MIN_ROSTER, roster)) + together * TOGETHER_BONUS;
      return { id: g.id, name: g.name, color: g.color, emoji: g.emoji || null, ...U.crestPub(g), open: g.access !== 'invite', total, roster, together, score, eligible: roster >= MIN_ROSTER, members: memberIds(g.id).length };
    });
    const ranked = rows.filter((r) => r.eligible && r.score > 0).sort((a, b) => b.score - a.score || b.total - a.total || a.id - b.id);
    ranked.forEach((r, i) => (r.place = i + 1));
    return { ranked, all: rows };
  }

  function settle(p) {
    if (p.to < LAUNCH || p.to >= today()) return false;
    if (q('SELECT 1 FROM league_settled WHERE period = ?').get(p.key)) return false;
    q('INSERT INTO league_settled (period, at) VALUES (?, ?)').run(p.key, U.now());
    const prizes = PRIZES[p.type];
    const companies = q('SELECT DISTINCT company FROM gangs').all().map((r) => r.company || 'mts');
    for (const r of companies.flatMap((c) => standings(p, { live: false, company: c }).ranked.slice(0, prizes.length))) {
      q('INSERT OR IGNORE INTO league_results (period, gang_id, place, score, name, at) VALUES (?, ?, ?, ?, ?, ?)').run(p.key, r.id, r.place, r.score, r.name, U.now());
      const prize = prizes[r.place - 1];
      // Приз — тем, кто принёс банде хоть одно очко за период
      const winners = q('SELECT user_id FROM league_points WHERE gang_id = ? AND day BETWEEN ? AND ? GROUP BY user_id HAVING SUM(points) > 0').all(r.id, p.from, p.to).map((x) => x.user_id)
        .filter((uid) => q('SELECT 1 FROM users WHERE id = ?').get(uid));
      for (const uid of winners) {
        addBeans(uid, 'league:' + p.key, prize.beans);
        for (const it of prize.items) q('INSERT OR IGNORE INTO owned (user_id, item_id, at) VALUES (?, ?, ?)').run(uid, it, U.now());
      }
      if (p.type === 'M' && r.place === 1) q('UPDATE gangs SET legend_month = ? WHERE id = ?').run(p.key.slice(2), r.id);
      const medal = ['', '', ''][r.place - 1] || `${r.place} место`;
      const what = p.type === 'W' ? 'Лиге недели' : `Лиге месяца (${p.label})`;
      if (myEvent) for (const uid of winners) myEvent(uid, null, `Твоя банда «${r.name}» — ${r.place} место в ${what}: +${prize.beans} зёрен`, 'league');
      fireAndForget(notify(winners, { title: `${medal} ${r.name} — ${r.place} место в ${what}`, body: `+${prize.beans} зёрен каждому, кто принёс очки${prize.items.length ? ' и трофей для профиля' : ''}`, url: '/#league', tag: 'league-' + p.key }));
    }
    return true;
  }

  function tick() {
    const d = today();
    settle(period('W', addDays(d, -7)));
    settle(period('M', addDays(d.slice(0, 7) + '-01', -1)));
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('league', e); } }, 10 * 60e3).unref();

  function lastWinners(p, company = 'mts') {
    return q("SELECT r.place, r.score, r.name, g.color, g.emoji, g.id, g.crest, g.area, g.interests, g.style FROM league_results r LEFT JOIN gangs g ON g.id = r.gang_id WHERE r.period = ? AND COALESCE(g.company, 'mts') = ? ORDER BY r.place").all(p.key, company)
      .map((r) => ({ place: r.place, score: r.score, name: r.name, color: r.color || '#9AA3B5', emoji: r.emoji || null, id: r.id || null, ...U.crestPub(r) }));
  }

  function view(uid, type) {
    tick();
    const p = period(type, today());
    const company = (q('SELECT company FROM users WHERE id = ?').get(uid) || {}).company || 'mts';
    const { ranked, all } = standings(p, { company });
    const gid = mainGang(uid);
    const mine = gid ? all.find((r) => r.id === gid) || null : null;
    const myPoints = gid ? q('SELECT COALESCE(SUM(points), 0) AS n FROM league_points WHERE gang_id = ? AND user_id = ? AND day BETWEEN ? AND ?').get(gid, uid, p.from, p.to).n : 0;
    const todayPts = q('SELECT COALESCE(SUM(points), 0) AS n FROM league_points WHERE user_id = ? AND day = ?').get(uid, today()).n;
    const prevDay = type === 'W' ? addDays(p.from, -7) : addDays(p.from, -1);
    const prev = period(type, prevDay);
    const daysLeft = Math.round((Date.parse(p.to + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 864e5) + 1;
    const pub = (r) => ({ id: r.id, name: r.name, color: r.color, emoji: r.emoji, crest: r.crest, area: r.area, interests: r.interests, style: r.style, open: r.open, score: r.score, total: r.total, members: r.members, together: r.together, place: r.place || null, me: r.id === gid });
    return {
      period: { type, key: p.key, label: p.label, from: p.from, to: p.to, daysLeft },
      top: ranked.slice(0, 10).map(pub),
      count: ranked.length,
      mine: mine ? { ...pub(mine), eligible: mine.eligible, roster: mine.roster, myPoints, todayPts, dayCap: DAY_CAP } : null,
      prizes: PRIZES[type].map((x, i) => ({ place: i + 1, beans: x.beans, items: x.items })),
      last: { label: prev.label, winners: lastWinners(prev, company) },
      rules: { dayCap: DAY_CAP, minRoster: MIN_ROSTER, togetherShare: TOGETHER_SHARE, togetherBonus: TOGETHER_BONUS }
    };
  }

  route('GET', '/api/league', async (req, body, query) => {
    const u = requireUser(req);
    return view(u.id, query.period === 'month' ? 'M' : 'W');
  });

  // Трофеи банды для профиля и карточки
  function trophies(gid) {
    const rows = q('SELECT period, place FROM league_results WHERE gang_id = ?').all(gid);
    const t = { w: [0, 0, 0], m: [0, 0, 0] };
    for (const r of rows) { const a = r.period.startsWith('W:') ? t.w : t.m; if (r.place <= a.length) a[r.place - 1]++; }
    return t;
  }
  // Место банды в текущей неделе — для шапки банды
  function weekPlace(gid) {
    const p = period('W', today());
    const gc = (q('SELECT company FROM gangs WHERE id = ?').get(gid) || {}).company || 'mts';
    const { ranked, all } = standings(p, { live: false, company: gc });
    const r = all.find((x) => x.id === gid);
    return r ? { place: (ranked.find((x) => x.id === gid) || {}).place || null, score: r.score, of: ranked.length, eligible: r.eligible } : null;
  }

  return { award, touch, mainGang, trophies, weekPlace, tick, settle, period, standings, MONTHS_GEN };
}

module.exports = { register, period, mondayOf, PRIZES, DAY_CAP };
