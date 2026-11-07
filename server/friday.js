// Пятничная пятиминутка банды: три коротких вопроса о неделе, ответ — одна строка.
// Открывается в пятницу в 12:00, отвечать можно до вторника; ответы банды видны до следующей пятницы.
// Каждый вопрос недели одинаков для всей банды (выбирается по номеру недели). За первый ответ недели — +3 зерна.
// Пуш банде — один раз в пятницу около 15:00 и только тем, кто ещё не ответил и не выключил сводки.

const QUESTIONS = [
  { id: 'best', text: 'Лучшее за неделю', ph: 'Закрыли релиз без ночных созвонов' },
  { id: 'learned', text: 'Новое умение недели', ph: 'Сводные таблицы в Excel — наконец-то' },
  { id: 'annoy', text: 'Что бесило', ph: 'Лифт, который едет на 7-й через 12-й' },
  { id: 'next', text: 'Чего жду от следующей недели', ph: 'Отпуска. Шучу. Или нет' },
  { id: 'thanks', text: 'Кому скажу спасибо и за что', ph: 'Лене — за помощь с отчётом' },
  { id: 'lunch', text: 'Лучший обед недели', ph: 'Сырники в столовой на Смоленке' },
  { id: 'surprise', text: 'Что удивило', ph: 'Совещание закончилось раньше' },
  { id: 'proud', text: 'Чем горжусь', ph: 'Ни одного «давайте синканёмся»' }
];
const REACTIONS = ['👍', '😂', '🔥', '❤️'];
const TEXT_MAX = 120;

function register(ctx) {
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, readProfile } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS friday_answers (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    week TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    qid TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL,
    UNIQUE (gang_id, week, user_id, qid)
  );
  CREATE TABLE IF NOT EXISTS friday_reacts (
    answer_id INTEGER NOT NULL REFERENCES friday_answers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL, PRIMARY KEY (answer_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS friday_push (gang_id INTEGER PRIMARY KEY, week TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS friday_poke (gang_id INTEGER PRIMARY KEY, week TEXT NOT NULL, by_id INTEGER);
  `);

  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const dow = (day) => new Date(day + 'T12:00:00Z').getUTCDay();
  // Неделя пятиминутки начинается в пятницу: ключ — дата этой пятницы
  function current() {
    const m = U.msk(), day = m.day, d = dow(day);
    const back = (d + 2) % 7; // сколько дней назад была пятница (пт=0, сб=1, вс=2, пн=3…)
    const friday = addDays(day, -back);
    const opensAt = friday === day && m.hour < 12 ? null : friday;
    // До пятницы 12:00 текущей недели показываем прошлую (её ответы ещё видны), но отвечать уже нельзя
    const week = opensAt || addDays(friday, -7);
    const canAnswer = !!opensAt && back <= 4; // пт, сб, вс, пн, вт
    return { week, canAnswer, isFriday: d === 5 };
  }
  function questionsFor(week) {
    const n = Math.floor(Date.parse(week + 'T00:00:00Z') / (7 * 864e5));
    const out = [];
    for (let i = 0; out.length < 3; i++) { const qd = QUESTIONS[(n * 3 + i * 5) % QUESTIONS.length]; if (!out.includes(qd)) out.push(qd); }
    return out;
  }
  const gangOr404 = (req, id) => {
    const u = requireUser(req);
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(id));
    if (!g || !isMember(g.id, u.id)) throw new HttpError(404, 'Банда не найдена.');
    return { u, g };
  };

  function view(g, uid) {
    const c = current();
    const qs = questionsFor(c.week);
    const rows = q(`SELECT a.*, u.nick, u.look FROM friday_answers a JOIN users u ON u.id = a.user_id WHERE a.gang_id = ? AND a.week = ? ORDER BY a.at`).all(g.id, c.week);
    const reacts = rows.length ? q(`SELECT answer_id, user_id, emoji FROM friday_reacts WHERE answer_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map((r) => r.id)) : [];
    const answered = new Set(rows.filter((r) => r.user_id === uid).map((r) => r.qid));
    return {
      week: c.week, canAnswer: c.canAnswer, reactions: REACTIONS, max: TEXT_MAX,
      people: new Set(rows.map((r) => r.user_id)).size, members: gangMembers(g.id).length,
      // Кто уже ответил — для свёрнутой полоски; «пнуть банду» — раз в неделю на банду
      answered: [...new Map(rows.map((r) => [r.user_id, { id: r.user_id, nick: r.nick, look: (() => { try { return JSON.parse(r.look || '{}'); } catch { return {}; } })() }])).values()],
      othersCount: rows.filter((r) => r.user_id !== uid).length,
      poked: (q('SELECT week FROM friday_poke WHERE gang_id = ?').get(g.id) || {}).week === c.week,
      questions: qs.map((qd) => ({
        id: qd.id, text: qd.text, ph: qd.ph, mine: U.unseal(rows.find((r) => r.user_id === uid && r.qid === qd.id)?.text) || null,
        answers: rows.filter((r) => r.qid === qd.id).map((r) => {
          const rs = reacts.filter((x) => x.answer_id === r.id);
          return { id: r.id, nick: r.nick, look: (() => { try { return JSON.parse(r.look || '{}'); } catch { return {}; } })(), text: U.unseal(r.text), me: r.user_id === uid,
            counts: Object.fromEntries(REACTIONS.map((e) => [e, rs.filter((x) => x.emoji === e).length])), my: (rs.find((x) => x.user_id === uid) || {}).emoji || null };
        })
      })),
      done: qs.every((qd) => answered.has(qd.id))
    };
  }

  route('GET', '/api/gangs/:id/friday', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params.id);
    return view(g, u.id);
  });

  route('POST', '/api/gangs/:id/friday', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params.id);
    const c = current();
    if (!c.canAnswer) throw bad('Пятиминутка откроется в пятницу в 12:00.');
    const qd = questionsFor(c.week).find((x) => x.id === body.q);
    if (!qd) throw bad('Такого вопроса на этой неделе нет.');
    const text = U.cleanText(body.text, TEXT_MAX);
    if (!text) throw bad('Хотя бы пару слов.');
    const prob = U.moderationProblem(text);
    if (prob) throw bad(prob);
    const first = !q('SELECT 1 FROM friday_answers WHERE gang_id = ? AND week = ? AND user_id = ?').get(g.id, c.week, u.id);
    q(`INSERT INTO friday_answers (gang_id, week, user_id, qid, text, at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(gang_id, week, user_id, qid) DO UPDATE SET text = excluded.text, at = excluded.at`).run(g.id, c.week, u.id, qd.id, U.seal(text), U.now());
    const beans = first && addBeans ? addBeans(u.id, 'friday') : 0;
    return { ...view(g, u.id), beans };
  });

  // «Пнуть банду»: один пуш тем, кто ещё не ответил. Раз в неделю на банду, только ответившему
  route('POST', '/api/gangs/:id/friday/poke', async (req, body, query, params) => {
    const { u, g } = gangOr404(req, params.id);
    const c = current();
    if (!c.canAnswer) throw bad('Пятиминутка сейчас закрыта.');
    if (!q('SELECT 1 FROM friday_answers WHERE gang_id = ? AND week = ? AND user_id = ?').get(g.id, c.week, u.id)) throw bad('Сначала ответь сам — потом пинай других.');
    const was = q('SELECT week FROM friday_poke WHERE gang_id = ?').get(g.id);
    if (was && was.week === c.week) throw bad('Банду на этой неделе уже пинали. Хватит с них.');
    q('INSERT INTO friday_poke (gang_id, week, by_id) VALUES (?, ?, ?) ON CONFLICT(gang_id) DO UPDATE SET week = excluded.week, by_id = excluded.by_id').run(g.id, c.week, u.id);
    const ids = gangMembers(g.id).filter((mm) => mm.id !== u.id && readProfile(mm.profile).digest !== false
      && !q('SELECT 1 FROM friday_answers WHERE gang_id = ? AND week = ? AND user_id = ?').get(g.id, c.week, mm.id)).map((mm) => mm.id);
    if (ids.length) fireAndForget(notify(ids, { title: `${u.nick} ждёт твою пятиминутку`, body: `Три строчки о неделе в «${g.name}». ${U.g(u.look, 'Он', 'Она')} уже ${U.g(u.look, 'ответил', 'ответила')} — твоя очередь`, url: `/#gang/${g.id}`, tag: `friday-${g.id}` }));
    return { ...view(g, u.id), poked: true, sent: ids.length };
  });

  route('POST', '/api/friday/:id/react', async (req, body, query, params) => {
    const u = requireUser(req);
    const a = q('SELECT * FROM friday_answers WHERE id = ?').get(Number(params.id));
    if (!a || !isMember(a.gang_id, u.id)) throw new HttpError(404, 'Ответ не найден.');
    if (!REACTIONS.includes(body.e)) throw bad('Такой реакции нет.');
    const was = q('SELECT emoji FROM friday_reacts WHERE answer_id = ? AND user_id = ?').get(a.id, u.id);
    if (was && was.emoji === body.e) q('DELETE FROM friday_reacts WHERE answer_id = ? AND user_id = ?').run(a.id, u.id);
    else q('INSERT OR REPLACE INTO friday_reacts (answer_id, user_id, emoji) VALUES (?, ?, ?)').run(a.id, u.id, body.e);
    const g = q('SELECT * FROM gangs WHERE id = ?').get(a.gang_id);
    return view(g, u.id);
  });

  // Не ответил на этой неделе — для сводки «Этажа»
  function pending(uid, gangs) {
    const c = current();
    if (!c.canAnswer) return [];
    return gangs.filter((g) => !q('SELECT 1 FROM friday_answers WHERE gang_id = ? AND week = ? AND user_id = ?').get(g.id, c.week, uid)).map((g) => ({ gang: g, week: c.week }));
  }

  // Пятница, 15:00–17:00: один пуш банде — тем, кто ещё не ответил
  function tick() {
    const m = U.msk(), c = current();
    if (!c.isFriday || !c.canAnswer || m.hour < 15 || m.hour >= 17) return;
    for (const g of q('SELECT id, name FROM gangs WHERE hidden = 0').all()) {
      const sent = q('SELECT week FROM friday_push WHERE gang_id = ?').get(g.id);
      if (sent && sent.week === c.week) continue;
      q('INSERT INTO friday_push (gang_id, week) VALUES (?, ?) ON CONFLICT(gang_id) DO UPDATE SET week = excluded.week').run(g.id, c.week);
      const ids = gangMembers(g.id).filter((mm) => readProfile(mm.profile).digest !== false
        && !q('SELECT 1 FROM friday_answers WHERE gang_id = ? AND week = ? AND user_id = ?').get(g.id, c.week, mm.id)).map((mm) => mm.id);
      if (ids.length) fireAndForget(notify(ids, { title: `Пятиминутка «${g.name}»`, body: 'Три вопроса о неделе, ответ — одна строка. Банда уже ждёт', url: `/#gang/${g.id}`, tag: `friday-${g.id}` }));
    }
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('friday', e); } }, 10 * 60e3).unref();

  function cleanup() { q('DELETE FROM friday_answers WHERE week < ?').run(addDays(U.msk().day, -21)); }

  return { pending, cleanup, current, questionsFor };
}

module.exports = { register, QUESTIONS };
