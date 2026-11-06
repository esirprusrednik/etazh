// «Мой стиль»: личная карточка поведения в Этаже — видит только сам человек.
// Считаем только действия (метаданные): когда ты активен, сколько зовёшь, пишешь, благодаришь, с кем чаще на связи.
// Тексты сообщений не читаются и не анализируются. Чужие карточки не отдаются никому, включая админа.

const HOURS_FROM = 7, HOURS_TO = 22;
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];

// Архетипы: по какому счётчику и как описать. Порядок — приоритет при равенстве
const TYPES = [
  { id: 'caller', title: 'Заводила', icon: 'megaphone', score: (c) => c.calls * 3 + c.lunches * 3, text: 'Ты чаще других зовёшь — на кофе, обед, созвон. Без тебя банда сидела бы по углам.' },
  { id: 'voice', title: 'Голос банды', icon: 'chat', score: (c) => c.msgs + c.dms, text: 'Пишешь много и по делу (и не очень). Чат живой во многом благодаря тебе.' },
  { id: 'responder', title: 'На подхвате', icon: 'check', score: (c) => c.replies * 2, text: 'На зовы откликаешься быстро. Таких людей ценят: с тобой всё складывается.' },
  { id: 'kind', title: 'Щедрая душа', icon: 'hand', score: (c) => c.thanks_given * 5, text: 'Не жалеешь «спасибо». Это редкое качество, и люди его запоминают.' },
  { id: 'player', title: 'Игрок', icon: 'game', score: (c) => (c.duels_started + c.battles) * 3 + c.blitz * 2 + c.quiz_any, text: 'Дуэли, морской бой, квизы — ты здесь ради азарта. Банде с тобой не скучно.' },
  { id: 'memer', title: 'Мемолог', icon: 'image', score: (c) => c.memes * 4, text: 'Мем-открытки — твой язык. Иногда одна картинка лучше трёх сообщений.' },
  { id: 'regular', title: 'Человек-офис', icon: 'office', score: (c) => c.checkins * 1.5, text: 'Отмечаешься исправно — по тебе можно сверять, кто сегодня в офисе.' }
];

// Бейджи: человек сам выбирает до трёх и показывает их в своей карточке. Только хорошее, по действиям
// m — метрики: c (счётчики), chrono, replyMin, replyN, tiesCount
const BADGES = [
  { id: 'lark', title: 'Жаворонок', icon: 'sun', desc: 'Самое живое время — до 11 утра', test: (m) => [m.chrono === 'lark' ? 1 : 0, 1] },
  { id: 'lunch', title: 'Обеденный пик', icon: 'lunch', desc: 'Самое живое время — с 12 до 15', test: (m) => [m.chrono === 'lunch' ? 1 : 0, 1] },
  { id: 'owl', title: 'Сова', icon: 'moon', desc: 'Самое живое время — после 17', test: (m) => [m.chrono === 'owl' ? 1 : 0, 1] },
  { id: 'fast', title: 'Отвечает быстро', icon: 'bolt', desc: 'В личке в среднем отвечает за 15 минут', test: (m) => [m.replyMin != null && m.replyMin <= 15 ? Math.min(m.replyN, 5) : 0, 5] },
  { id: 'caller', title: 'Заводила', icon: 'megaphone', desc: '15 зовов и обедов компанией', test: (m) => [m.c.calls + m.c.lunches, 15] },
  { id: 'voice', title: 'Голос банды', icon: 'chat', desc: '100 сообщений в чатах и личке', test: (m) => [m.c.msgs + m.c.dms, 100] },
  { id: 'responder', title: 'На подхвате', icon: 'check', desc: 'Отклик на 20 зовов', test: (m) => [m.c.replies, 20] },
  { id: 'kind', title: 'Щедрая душа', icon: 'hand', desc: '10 сказанных «спасибо»', test: (m) => [m.c.thanks_given, 10] },
  { id: 'thanked', title: 'Есть за что благодарить', icon: 'star', desc: '10 полученных «спасибо»', test: (m) => [m.c.thanks_got, 10] },
  { id: 'connector', title: 'Связной', icon: 'swap', desc: 'На связи один на один с 8 людьми за два месяца', test: (m) => [m.tiesCount, 8] },
  { id: 'player', title: 'Игрок', icon: 'game', desc: '15 игр: дуэли, морской бой, блиц', test: (m) => [m.c.duels_started + m.c.battles + m.c.blitz, 15] },
  { id: 'memer', title: 'Мемолог', icon: 'image', desc: '10 мем-открыток', test: (m) => [m.c.memes, 10] },
  { id: 'regular', title: 'Человек-офис', icon: 'office', desc: '20 отметок в офисе', test: (m) => [m.c.checkins, 20] },
  { id: 'streak', title: 'Без пропусков', icon: 'flame', desc: 'Серия 10 рабочих дней подряд', test: (m) => [m.c.day_streak, 10] },
  { id: 'wave', title: 'Свой', icon: 'flag', desc: '3 волны банды', test: (m) => [m.c.waves, 3] }
];
const SHOW_MAX = 3;

function register(ctx) {
  const { db, q, route, requireUser, U, publicLook, myGangs, gangMembers } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS style_hours (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, hour INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, hour));
  CREATE TABLE IF NOT EXISTS style_wd (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, wd INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, wd));
  CREATE TABLE IF NOT EXISTS style_ties (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, other_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    n INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL, PRIMARY KEY (user_id, other_id));
  CREATE TABLE IF NOT EXISTS style_meta (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, key));
  `);

  const bumpHour = (uid, at) => {
    const m = U.msk(at), wd = (new Date(m.day + 'T12:00:00Z').getUTCDay() + 6) % 7;
    q('INSERT INTO style_hours (user_id, hour, n) VALUES (?, ?, 1) ON CONFLICT(user_id, hour) DO UPDATE SET n = n + 1').run(uid, m.hour);
    if (wd < 5) q('INSERT INTO style_wd (user_id, wd, n) VALUES (?, ?, 1) ON CONFLICT(user_id, wd) DO UPDATE SET n = n + 1').run(uid, wd);
  };
  const tie = (a, b, at) => {
    if (!a || !b || a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) q('INSERT INTO style_ties (user_id, other_id, n, last_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, other_id) DO UPDATE SET n = n + 1, last_at = excluded.last_at').run(x, y, at);
  };
  const meta = (uid, key, d) => q('INSERT INTO style_meta (user_id, key, n) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET n = n + excluded.n').run(uid, key, d);

  // Разово: ритм по истории начислений зёрен (отметки, ответы, игры) — чтобы карточка не была пустой с первого дня
  if (!q('SELECT 1 FROM style_hours LIMIT 1').get()) {
    const rows = q("SELECT user_id, at FROM ledger WHERE reason NOT IN ('welcome', 'deposit_back', 'refund', 'ach', 'league', 'admin')").all();
    if (rows.length) { db.exec('BEGIN'); for (const r of rows) bumpHour(r.user_id, r.at); db.exec('COMMIT'); }
  }

  // Действия, которые формируют стиль. Только факт и время — без содержания
  const TRACK = new Set(['text', 'call', 'reply', 'dm', 'meme', 'checkin', 'home', 'poll', 'poll_vote', 'duel', 'battle_start', 'quiz_any', 'guess_any', 'blitz', 'wave_join', 'wave_launch', 'signal_sent']);
  function track(type, uid, data = {}) {
    try {
      if (!uid || !TRACK.has(type)) return;
      const now = U.now();
      bumpHour(uid, now);
      if ((type === 'dm' || type === 'meme') && data.to) {
        tie(uid, data.to, now);
        // Скорость ответа в личке: предыдущее сообщение пары было от собеседника — считаем паузу (не дольше 8 часов)
        if (type === 'dm') {
          const [lo, hi] = uid < data.to ? [uid, data.to] : [data.to, uid];
          const prev = q('SELECT from_id, at FROM dms WHERE lo = ? AND hi = ? ORDER BY at DESC LIMIT 1 OFFSET 1').get(lo, hi);
          if (prev && prev.from_id === data.to && now - prev.at < 8 * 3600e3) { meta(uid, 'reply_min_sum', Math.max(1, Math.round((now - prev.at) / 60e3))); meta(uid, 'reply_n', 1); }
        }
      }
    } catch (e) { console.error('style', e.message); }
  }

  const counters = (uid) => {
    const c = Object.fromEntries(q('SELECT key, n FROM counters WHERE user_id = ?').all(uid).map((r) => [r.key, r.n]));
    for (const k of ['calls', 'lunches', 'msgs', 'dms', 'replies', 'thanks_given', 'thanks_got', 'duels_started', 'battles', 'blitz', 'quiz_any', 'memes', 'checkins', 'active_days', 'day_streak', 'waves']) c[k] = c[k] || 0;
    return c;
  };

  // Общие метрики для карточки и бейджей
  function metrics(uid) {
    const c = counters(uid);
    const hoursRaw = Object.fromEntries(q('SELECT hour, n FROM style_hours WHERE user_id = ?').all(uid).map((r) => [r.hour, r.n]));
    const total = Object.values(hoursRaw).reduce((a, b) => a + b, 0);
    const band = (a, b) => Object.entries(hoursRaw).filter(([h]) => h >= a && h < b).reduce((s2, [, n]) => s2 + n, 0);
    let chrono = 'even';
    if (total >= 12) { const best = [['lark', band(5, 11)], ['lunch', band(12, 15)], ['owl', band(17, 24)]].sort((a, b) => b[1] - a[1])[0]; if (best[1] / total >= 0.4) chrono = best[0]; }
    const m = Object.fromEntries(q('SELECT key, n FROM style_meta WHERE user_id = ?').all(uid).map((r) => [r.key, r.n]));
    const replyMin = m.reply_n >= 3 ? Math.round(m.reply_min_sum / m.reply_n) : null;
    const tiesCount = q('SELECT COUNT(*) AS n FROM style_ties WHERE user_id = ? AND last_at > ?').get(uid, U.now() - 60 * 864e5).n;
    return { c, hoursRaw, total, chrono, replyMin, replyN: m.reply_n || 0, tiesCount };
  }
  const badgeList = (mt, shown = []) => BADGES.map((b) => { const [n, of] = b.test(mt); return { id: b.id, title: b.title, icon: b.icon, desc: b.desc, got: n >= of, n: Math.min(n, of), of, shown: shown.includes(b.id) }; });
  // Бейджи напоказ в карточке человека: только выбранные им и всё ещё заслуженные
  function shownBadges(uid, prof) {
    const want = Array.isArray(prof && prof.badges) ? prof.badges.slice(0, SHOW_MAX) : [];
    if (!want.length) return [];
    return badgeList(metrics(uid), want).filter((b) => b.got && b.shown).map(({ id, title, icon, desc }) => ({ id, title, icon, desc }));
  }

  route('POST', '/api/me/badges', async (req, body) => {
    const u = requireUser(req);
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))];
    if (ids.length > SHOW_MAX) throw ctx.bad(`Показать можно не больше ${SHOW_MAX} бейджей.`);
    const got = new Set(badgeList(metrics(u.id)).filter((b) => b.got).map((b) => b.id));
    if (ids.some((id) => !got.has(id))) throw ctx.bad('Этот бейдж ещё не заработан.');
    q('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify({ ...u.profile, badges: ids }), u.id);
    return { ok: true, badges: ids };
  });

  route('GET', '/api/me/style', async (req) => {
    const u = requireUser(req);
    const mt = metrics(u.id);
    const c = mt.c;
    const hoursRaw = Object.fromEntries(q('SELECT hour, n FROM style_hours WHERE user_id = ?').all(u.id).map((r) => [r.hour, r.n]));
    const hours = []; for (let h = HOURS_FROM; h <= HOURS_TO; h++) hours.push({ h, n: hoursRaw[h] || 0 });
    const wdRaw = Object.fromEntries(q('SELECT wd, n FROM style_wd WHERE user_id = ?').all(u.id).map((r) => [r.wd, r.n]));
    const week = WD.map((d, i) => ({ d, n: wdRaw[i] || 0 }));
    const total = Object.values(hoursRaw).reduce((a, b) => a + b, 0);

    // Хронотип: где больше всего действий
    const band = (a, b) => Object.entries(hoursRaw).filter(([h]) => h >= a && h < b).reduce((s, [, n]) => s + n, 0);
    const bands = [['lark', 'Жаворонок', 'Самое активное время — до 11 утра. Пока остальные раскачиваются, ты уже всех позвал.', band(5, 11)],
      ['lunch', 'Обеденный пик', 'Расцветаешь к обеду: с 12 до 15 тебя больше всего.', band(12, 15)],
      ['owl', 'Сова', 'Самое живое время — после 17. Вечерний Этаж держится на тебе.', band(17, 24)],
      ['even', 'Ровный ритм', 'Активен весь день примерно одинаково. Стабильность — тоже стиль.', 0]];
    let chrono = bands[3];
    if (total >= 12) { const best = bands.slice(0, 3).sort((a, b) => b[3] - a[3])[0]; if (best[3] / total >= 0.4) chrono = best; }
    const busiest = week.reduce((a, b) => (b.n > a.n ? b : a), week[0]);

    // Архетип и черты
    const scored = TYPES.map((t) => ({ ...t, s: t.score(c) })).sort((a, b) => b.s - a.s);
    const enough = scored[0].s >= 15;
    const quiet = c.active_days >= 10 && c.msgs + c.dms + c.calls < c.active_days;
    const main = quiet ? { id: 'watcher', title: 'Тихий наблюдатель', icon: 'help', text: 'Читаешь больше, чем пишешь. Банда тебя видит — напиши разок, удивишь.' }
      : enough ? scored[0] : { id: 'new', title: 'Только начинаешь', icon: 'star', text: 'Стиль ещё складывается. Позови кого-нибудь на кофе, скажи спасибо, сыграй дуэль — через пару недель тут будет портрет.' };
    const traits = (enough ? scored.slice(1).filter((t) => t.s >= 10).slice(0, 2).map((t) => t.title) : []);
    if (c.day_streak >= 5) traits.push(`Серия ${c.day_streak} дн.`);
    if (c.thanks_got >= 5) traits.push('Тебя благодарят');

    // Скорость ответа в личке
    const m = Object.fromEntries(q('SELECT key, n FROM style_meta WHERE user_id = ?').all(u.id).map((r) => [r.key, r.n]));
    const replyMin = m.reply_n >= 3 ? Math.round(m.reply_min_sum / m.reply_n) : null;

    // С кем чаще на связи: личка и мемы + спасибо и дуэли за 60 дней
    const since = U.now() - 60 * 864e5;
    const score = new Map();
    const add = (id, n) => { if (id && id !== u.id) score.set(id, (score.get(id) || 0) + n); };
    for (const r of q('SELECT other_id, n FROM style_ties WHERE user_id = ? AND last_at > ?').all(u.id, since)) add(r.other_id, r.n);
    for (const r of q('SELECT from_id, to_id FROM thanks WHERE (from_id = ? OR to_id = ?) AND at > ?').all(u.id, u.id, since)) add(r.from_id === u.id ? r.to_id : r.from_id, 3);
    for (const r of q('SELECT a, b FROM duels WHERE (a = ? OR b = ?) AND created_at > ?').all(u.id, u.id, since)) add(r.a === u.id ? r.b : r.a, 2);
    const person = (id) => { const r = q('SELECT id, nick, look FROM users WHERE id = ? AND nick IS NOT NULL').get(id); return r ? { id: r.id, nick: r.nick, look: publicLook(r) } : null; };
    const ties = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => { const p = person(id); return p ? { ...p, n } : null; }).filter(Boolean);

    // Свои из банды, с кем ещё ни разу не пересекался один на один
    const known = new Set([...score.keys(), ...q('SELECT other_id FROM style_ties WHERE user_id = ?').all(u.id).map((r) => r.other_id)]);
    const fresh = [];
    for (const g of myGangs(u.id)) for (const mm of gangMembers(g.id)) if (mm.id !== u.id && !known.has(mm.id) && !fresh.some((x) => x.id === mm.id)) fresh.push({ id: mm.id, nick: mm.nick, look: publicLook(mm) });

    return {
      main: { id: main.id, title: main.title, icon: main.icon, text: main.text }, traits,
      chrono: { id: chrono[0], title: chrono[1], text: chrono[2] }, busiest: busiest.n ? busiest.d : null,
      hours, week, total, replyMin, ties, fresh: fresh.slice(0, 3),
      badges: badgeList(mt, Array.isArray(u.profile.badges) ? u.profile.badges : []), showMax: SHOW_MAX,
      stats: { msgs: c.msgs, dms: c.dms, calls: c.calls, replies: c.replies, thanksGiven: c.thanks_given, thanksGot: c.thanks_got, games: c.duels_started + c.battles + c.blitz, checkins: c.checkins, days: c.active_days }
    };
  });

  return { track, shownBadges };
}

module.exports = { register, TYPES, BADGES };
