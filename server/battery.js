// «Батарейка недели»: короткий самотест на усталость (по мотивам шкал выгорания, но не медицинский тест).
// Пять вопросов по пятницам — заряд от 0 до 100%. Результат видит только сам человек.
// Если заряд низкий, человек САМ может попросить «подзарядку» — тогда свои (банда и подельники)
// видят значок и могут подкинуть заряд: позвать на кофе, прислать шоколадку, дать пять.
// Храним только итоговый процент за неделю (не ответы) и 4 недели истории; просьба о подзарядке живёт до конца недели.

const QUESTIONS = [
  { id: 'monday', text: 'Как ты в понедельник утром?', opts: ['Понедельник — это насилие', 'Кофе внутривенно', 'Нормально, раскачаюсь', 'Бодро, есть планы'] },
  { id: 'evening', text: 'Рабочие чаты по вечерам', opts: ['Снятся по ночам', 'Отвечаю, куда деваться', 'Гляну одним глазом', 'Не открываю'] },
  { id: 'meaning', text: 'Задачи этой недели', opts: ['Зачем это всё?', 'Делаю на автомате', 'Работа как работа', 'Интересно, есть смысл'] },
  { id: 'wins', text: 'Было что-то, что получилось?', opts: ['Всё мимо', 'Сложно вспомнить', 'Пара мелочей', 'Да, и не одно'] },
  { id: 'weekend', text: 'Сколько сил на выходные?', opts: ['Нет сил даже лежать', 'Только лежать', 'Хватит на сериал', 'Полно, планов куча'] }
];
// Уровни шкалы: от «Нужна розетка» до «Полный заряд»
const LEVELS = [
  { min: 80, id: 'full', name: 'Полный заряд', color: '#2FA84F', text: 'Энергии хватает. Поделись с бандой — кому-то сейчас может быть тяжелее.' },
  { min: 60, id: 'good', name: 'Бодрячком', color: '#7BC043', text: 'Всё в порядке. Выходные — для себя, не для почты.' },
  { min: 40, id: 'eco', name: 'Режим экономии', color: '#F2B705', text: 'Заряд проседает. На выходных — без рабочих чатов, а в понедельник начни с того, что нравится.' },
  { min: 20, id: 'red', name: 'Красная зона', color: '#F07A1A', text: 'Сил мало. Подумай, что можно отложить или отдать на следующей неделе. И не стесняйся попросить подзарядку.' },
  { min: 0, id: 'empty', name: 'Нужна розетка', color: '#E5484D', text: 'Похоже, ты на пределе. Если так уже не первую неделю — поговори с кем-то, кому доверяешь: руководителем, близкими или специалистом. Это нормально.' }
];
const BOOSTS = {
  coffee: { name: 'Позвать на кофе', icon: 'coffee', push: 'зовёт тебя на кофе' },
  choco: { name: 'Виртуальная шоколадка', icon: 'gift', push: 'прислал тебе шоколадку', pushF: 'прислала тебе шоколадку' },
  five: { name: 'Дать пять', icon: 'hand', push: 'даёт тебе пять' }
};
const ASK_BELOW = 60;
const KEEP_WEEKS = 4;

const levelOf = (pct) => LEVELS.find((l) => pct >= l.min);

function register(ctx) {
  const { db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, readProfile, myGangs, gangMembers, areCrew, publicLook, onEvent } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS battery (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week TEXT NOT NULL, level INTEGER NOT NULL, at INTEGER NOT NULL, ask INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week)
  );
  CREATE TABLE IF NOT EXISTS battery_boosts (
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (to_id, from_id, week, kind)
  );
  CREATE TABLE IF NOT EXISTS battery_push (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, week TEXT NOT NULL);
  `);

  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const dow = (day) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7; // пн=0
  const week = () => { const d = U.msk().day; return addDays(d, -dow(d)); };
  const row = (uid, w = week()) => q('SELECT * FROM battery WHERE user_id = ? AND week = ?').get(uid, w);
  // Свои: общая банда или подельники
  const isOwn = (a, b) => a !== b && (!!q('SELECT 1 FROM gang_members x JOIN gang_members y ON y.gang_id = x.gang_id WHERE x.user_id = ? AND y.user_id = ? LIMIT 1').get(a, b) || (areCrew ? areCrew(a, b) : false));

  function view(uid) {
    const r = row(uid);
    const history = q('SELECT week, level FROM battery WHERE user_id = ? ORDER BY week DESC LIMIT ?').all(uid, KEEP_WEEKS).reverse();
    const boosts = r ? q('SELECT b.kind, b.at, u.id, u.nick, u.look FROM battery_boosts b JOIN users u ON u.id = b.from_id WHERE b.to_id = ? AND b.week = ? ORDER BY b.at').all(uid, r.week)
      .map((x) => ({ kind: x.kind, name: BOOSTS[x.kind].name, icon: BOOSTS[x.kind].icon, from: { id: x.id, nick: x.nick, look: publicLook(x) } })) : [];
    const lv = r ? levelOf(r.level) : null;
    return {
      questions: QUESTIONS.map((x) => ({ id: x.id, text: x.text, opts: x.opts })),
      levels: LEVELS.map(({ min, id, name, color }) => ({ min, id, name, color })),
      mine: r ? { level: r.level, at: r.at, ask: !!r.ask, canAsk: r.level < ASK_BELOW, lv: { id: lv.id, name: lv.name, color: lv.color, text: lv.text } } : null,
      history, boosts, isFriday: dow(U.msk().day) >= 4
    };
  }

  route('GET', '/api/battery', async (req) => view(requireUser(req).id));

  route('POST', '/api/battery', async (req, body) => {
    const u = requireUser(req);
    const a = Array.isArray(body.answers) ? body.answers.map(Number) : [];
    if (a.length !== QUESTIONS.length || a.some((x) => !Number.isInteger(x) || x < 0 || x > 3)) throw bad('Ответь на все пять вопросов.');
    const level = Math.round((a.reduce((s, x) => s + x, 0) / (QUESTIONS.length * 3)) * 100);
    const was = row(u.id);
    // Пересдать на той же неделе можно; просьба о подзарядке сохраняется, только если заряд всё ещё низкий
    q(`INSERT INTO battery (user_id, week, level, at, ask) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, week) DO UPDATE SET level = excluded.level, at = excluded.at, ask = excluded.ask`).run(u.id, week(), level, U.now(), was && was.ask && level < ASK_BELOW ? 1 : 0);
    if (onEvent) onEvent('battery', u.id, {});
    return view(u.id);
  });

  // Попросить подзарядку у своих (или снять просьбу). Только при низком заряде и только на эту неделю
  route('POST', '/api/battery/ask', async (req, body) => {
    const u = requireUser(req);
    const r = row(u.id);
    if (!r) throw bad('Сначала проверь батарейку.');
    if (body.on && r.level >= ASK_BELOW) throw bad('Заряда пока хватает — просить подзарядку не нужно.');
    q('UPDATE battery SET ask = ? WHERE user_id = ? AND week = ?').run(body.on ? 1 : 0, u.id, r.week);
    return view(u.id);
  });

  route('POST', '/api/battery/boost', async (req, body) => {
    const u = requireUser(req);
    const t = q('SELECT id, nick, look FROM users WHERE id = ? AND nick IS NOT NULL').get(Number(body.to));
    if (!t || !isOwn(u.id, t.id)) throw new HttpError(404, 'Человек не найден.');
    const kind = BOOSTS[body.kind] ? body.kind : null;
    if (!kind) throw bad('Такой подзарядки нет.');
    const r = row(t.id);
    if (!r || !r.ask) throw bad('Подзарядку сейчас не просили.');
    const ins = q('INSERT OR IGNORE INTO battery_boosts (to_id, from_id, week, kind, at) VALUES (?, ?, ?, ?, ?)').run(t.id, u.id, r.week, kind, U.now());
    if (!ins.changes) throw bad(U.g(u.look, 'Это ты уже подкидывал на этой неделе. Попробуй другое.', 'Это ты уже подкидывала на этой неделе. Попробуй другое.'));
    const what = U.fem(u.look) && BOOSTS[kind].pushF ? BOOSTS[kind].pushF : BOOSTS[kind].push;
    fireAndForget(notify([t.id], { title: 'Тебе подкинули заряд', body: `${u.nick} ${what}`, url: kind === 'coffee' ? `/#crew/${u.id}` : '/#battery', tag: `boost-${u.id}` }));
    return { ok: true, sent: q('SELECT kind FROM battery_boosts WHERE to_id = ? AND from_id = ? AND week = ?').all(t.id, u.id, r.week).map((x) => x.kind) };
  });

  // Для строки участника банды: просит ли человек подзарядку (только если сам включил)
  const asking = (uid) => { const r = row(uid); return !!(r && r.ask); };
  // Кому из своих нужна подзарядка — для сводки «Этажа»
  function needs(uid) {
    const w = week();
    const ids = new Set();
    for (const g of myGangs(uid)) for (const m of gangMembers(g.id)) if (m.id !== uid) ids.add(m.id);
    const out = [];
    for (const id of ids) {
      const r = row(id, w);
      if (!r || !r.ask) continue;
      const p = q('SELECT id, nick, look FROM users WHERE id = ?').get(id);
      const sent = q('SELECT kind FROM battery_boosts WHERE to_id = ? AND from_id = ? AND week = ?').all(id, uid, w).map((x) => x.kind);
      if (p && sent.length < Object.keys(BOOSTS).length) out.push({ id: p.id, nick: p.nick, look: publicLook(p), sent });
    }
    return out;
  }
  // Не проверял батарейку на этой неделе — с пятницы
  const pending = (uid) => dow(U.msk().day) >= 4 && !row(uid);

  // Пятница, 17:30–18:30 — один мягкий пуш тем, кто не выключил сводки и батарейку
  function tick() {
    const m = U.msk(), h = m.hour + m.minute / 60;
    if (dow(m.day) !== 4 || h < 17.5 || h >= 18.5) return;
    const w = week();
    for (const r of q('SELECT DISTINCT user_id AS id FROM push_subs').all()) {
      const u = q('SELECT id, profile FROM users WHERE id = ? AND nick IS NOT NULL').get(r.id);
      if (!u) continue;
      const prof = readProfile(u.profile);
      if (prof.digest === false || prof.battery === false || row(u.id, w)) continue;
      const sent = q('SELECT week FROM battery_push WHERE user_id = ?').get(u.id);
      if (sent && sent.week === w) continue;
      q('INSERT INTO battery_push (user_id, week) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET week = excluded.week').run(u.id, w);
      fireAndForget(notify([u.id], { title: 'Пятница! Сколько заряда осталось?', body: 'Батарейка недели: пять вопросов, 30 секунд. Результат видишь только ты', url: '/#battery', tag: 'battery' }));
    }
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('battery', e); } }, 5 * 60e3).unref();

  function cleanup() {
    const old = addDays(week(), -7 * KEEP_WEEKS);
    q('DELETE FROM battery WHERE week < ?').run(old);
    q('DELETE FROM battery_boosts WHERE week < ?').run(addDays(week(), -7));
  }

  return { asking, needs, pending, cleanup };
}

module.exports = { register, QUESTIONS, LEVELS, BOOSTS, levelOf };
