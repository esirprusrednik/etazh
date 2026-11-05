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

  route('GET', '/api/me/style', async (req) => {
    const u = requireUser(req);
    const c = counters(u.id);
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
      stats: { msgs: c.msgs, dms: c.dms, calls: c.calls, replies: c.replies, thanksGiven: c.thanks_given, thanksGot: c.thanks_got, games: c.duels_started + c.battles + c.blitz, checkins: c.checkins, days: c.active_days }
    };
  });

  return { track };
}

module.exports = { register, TYPES };
