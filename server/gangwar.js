// Битва банд: владелец бросает вызов другой банде и выдвигает героя. Владелец второй банды принимает вызов и выдвигает своего.
// Битва идёт одну рабочую неделю (5 рабочих дней по производственному календарю).
//  • Блиц: 3 минуты на тему. Первым проходит герой принявшей банды, потом — герой вызвавшей.
//    Счёт соперника не виден, пока оба не прошли. Победа — больше верных, при равенстве — быстрее.
//    Тема, по которой банда уже билась, для неё закрыта: дважды по одной теме не бьются.
//  • Морской бой: быстрая партия между героями (по 1,5 минуты на часах у каждого).
// Не успел за неделю — техническое поражение. Победителям — зёрна и очки в Лигу.

const { TOPICS } = require('./wartopics');
const { workdayName } = require('./holidays');

const SECS = 180;
const GRACE_MS = 3000;
const PENDING_DAYS = 3;
const MAX_ACTIVE = 2;           // одновременных битв у банды
const PRIZE_HERO = 20, PRIZE_TEAM = 5, PRIZE_DRAW = 5;

function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function register(ctx) {
  const { db, q, route, requireUser, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, battle, publicLook } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS gang_wars (
    id INTEGER PRIMARY KEY,
    from_gang INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    to_gang INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, topic TEXT,
    from_hero INTEGER REFERENCES users(id) ON DELETE SET NULL,
    to_hero INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | active | done | declined | cancelled | expired
    created_at INTEGER NOT NULL, accepted_at INTEGER, ends_at INTEGER,
    battle_id INTEGER, winner_gang INTEGER, result TEXT, decided_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS gang_wars_from ON gang_wars(from_gang, status);
  CREATE INDEX IF NOT EXISTS gang_wars_to ON gang_wars(to_gang, status);
  CREATE TABLE IF NOT EXISTS gang_war_runs (
    war_id INTEGER NOT NULL REFERENCES gang_wars(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL, finished_at INTEGER,
    plan TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (war_id, user_id)
  );
  `);

  const today = () => U.msk().day;
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  // Конец пятого рабочего дня, считая сегодняшний (если он рабочий), в 23:59 по Москве
  function weekEnd() {
    let d = today(), n = 0;
    for (let i = 0; i < 30; i++) { if (workdayName(d)) { n++; if (n === 5) break; } d = addDays(d, 1); }
    const z = U.msk(0); // сдвиг часового пояса: «время по Москве» для нулевой метки
    return Date.parse(d + 'T23:59:59Z') - Date.parse(z.day + 'T' + z.hhmm + ':00Z');
  }
  const gang = (id) => q('SELECT * FROM gangs WHERE id = ?').get(id);
  const nick = (id) => (id ? (q('SELECT nick FROM users WHERE id = ?').get(id) || {}).nick : null) || 'удалённый аккаунт';
  const topicById = (id) => TOPICS.find((t) => t.id === id) || null;
  // Темы, по которым банда уже билась (в любой не отменённой битве)
  const usedTopics = (gid) => new Set(q(`SELECT topic FROM gang_wars WHERE kind = 'blitz' AND status IN ('pending', 'active', 'done') AND (from_gang = ? OR to_gang = ?)`).all(gid, gid).map((r) => r.topic));
  function topicsFor(a, b) {
    const ua = usedTopics(a), ub = b ? usedTopics(b) : new Set();
    return TOPICS.filter((t) => t.from <= today()).map((t) => ({ id: t.id, title: t.title, emoji: t.emoji, desc: t.desc, count: t.questions.length, free: !ua.has(t.id) && !ub.has(t.id), usedByMe: ua.has(t.id), usedByThem: ub.has(t.id) }));
  }
  const gangPub = (g) => (g ? { id: g.id, name: g.name, color: g.color, ...U.crestPub(g) } : null);

  function chat(gid, uid, text) { q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(gid, uid, 'text', text, U.now()); }
  const runOf = (wid, uid) => q('SELECT * FROM gang_war_runs WHERE war_id = ? AND user_id = ?').get(wid, uid);

  // Закрыть просроченный забег (время вышло)
  function closeRun(r) {
    if (r && !r.finished_at && U.now() > r.started_at + SECS * 1000 + GRACE_MS) {
      q('UPDATE gang_war_runs SET finished_at = ? WHERE war_id = ? AND user_id = ?').run(r.started_at + SECS * 1000, r.war_id, r.user_id);
      return runOf(r.war_id, r.user_id);
    }
    return r;
  }

  function finishWar(w, winnerGang, result) {
    q("UPDATE gang_wars SET status = 'done', winner_gang = ?, result = ?, decided_at = ? WHERE id = ?").run(winnerGang, JSON.stringify(result), U.now(), w.id);
    const gf = gang(w.from_gang), gt = gang(w.to_gang);
    const what = w.kind === 'blitz' ? `блиц «${(topicById(w.topic) || {}).title || ''}»` : 'морской бой';
    const line = winnerGang ? `⚔️ Битва банд (${what}): победила «${winnerGang === w.from_gang ? gf.name : gt.name}»${result.note ? ' — ' + result.note : ''}` : `⚔️ Битва банд (${what}): ничья${result.note ? ' — ' + result.note : ''}`;
    for (const g of [gf, gt]) if (g) chat(g.id, g.id === w.from_gang ? w.from_hero : w.to_hero, line);
    if (winnerGang) {
      const hero = winnerGang === w.from_gang ? w.from_hero : w.to_hero;
      if (hero) addBeans(hero, 'gangwar', PRIZE_HERO);
      for (const m of gangMembers(winnerGang)) if (m.id !== hero) addBeans(m.id, 'gangwar_team', PRIZE_TEAM);
    } else for (const h of [w.from_hero, w.to_hero]) if (h) addBeans(h, 'gangwar', PRIZE_DRAW);
    const ids = [...gangMembers(w.from_gang), ...gangMembers(w.to_gang)].map((m) => m.id);
    fireAndForget(notify(ids, { title: '⚔️ Итог битвы банд', body: line.replace('⚔️ ', ''), url: `/#gang/${w.from_gang}`, tag: `war-${w.id}` }));
  }

  // Решить битву, если пора
  function resolve(w) {
    if (!w || w.status !== 'active') return w;
    const late = U.now() > w.ends_at;
    if (w.kind === 'blitz') {
      const rt = closeRun(runOf(w.id, w.to_hero)), rf = closeRun(runOf(w.id, w.from_hero));
      const done = (r) => r && r.finished_at;
      if (done(rt) && done(rf)) {
        const tt = rt.finished_at - rt.started_at, tf = rf.finished_at - rf.started_at;
        const win = rt.score !== rf.score ? (rt.score > rf.score ? w.to_gang : w.from_gang) : tt !== tf ? (tt < tf ? w.to_gang : w.from_gang) : null;
        finishWar(w, win, { to: { score: rt.score, ms: tt }, from: { score: rf.score, ms: tf }, note: `${rt.score}:${rf.score}` });
      } else if (late) {
        // Кто не успел — тот и проиграл. Не успели оба — ничья
        if (!done(rt) && !done(rf)) finishWar(w, null, { note: 'никто не успел' });
        else if (!done(rt)) finishWar(w, w.from_gang, { note: 'герой соперника не вышел на бой' });
        else finishWar(w, w.to_gang, { to: { score: rt.score }, note: 'вызвавший герой не успел' });
      }
    } else if (w.kind === 'sea' && battle) {
      const b = battle.stateOf(w.battle_id);
      if (b && b.status === 'done' && b.winner) finishWar(w, b.winner === w.to_hero ? w.to_gang : w.from_gang, { note: 'потоплен последний корабль' });
      else if (!b || late) finishWar(w, null, { note: 'партия не доиграна' });
    }
    return q('SELECT * FROM gang_wars WHERE id = ?').get(w.id);
  }

  function tick() {
    for (const w of q("SELECT * FROM gang_wars WHERE status = 'active'").all()) resolve(w);
    q("UPDATE gang_wars SET status = 'expired' WHERE status = 'pending' AND created_at < ?").run(U.now() - PENDING_DAYS * 864e5);
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('gangwar', e); } }, 5 * 60e3).unref();

  // Вид битвы для участника одной из банд
  function view(w, uid) {
    w = resolve(w);
    const gf = gang(w.from_gang), gt = gang(w.to_gang);
    const myGang = isMember(w.from_gang, uid) ? w.from_gang : isMember(w.to_gang, uid) ? w.to_gang : null;
    const t = topicById(w.topic);
    const rt = w.kind === 'blitz' ? runOf(w.id, w.to_hero) : null, rf = w.kind === 'blitz' ? runOf(w.id, w.from_hero) : null;
    const reveal = w.status === 'done';
    const runPub = (r) => (r ? { done: !!r.finished_at, playing: !r.finished_at, score: reveal ? r.score : null, secs: reveal && r.finished_at ? Math.round((r.finished_at - r.started_at) / 1000) : null } : { done: false, playing: false });
    const amHero = uid === w.from_hero || uid === w.to_hero;
    let canPlay = false, waitReason = null;
    if (w.status === 'active' && w.kind === 'blitz' && amHero) {
      const mine = runOf(w.id, uid);
      if (mine && mine.finished_at) waitReason = 'Ты своё прошёл — ждём итог';
      else if (uid === w.to_hero) canPlay = true;
      else if (rt && rt.finished_at) canPlay = true;
      else waitReason = 'Сначала проходит герой банды, принявшей вызов. Как пройдёт — придёт пуш';
    }
    const isOwner = (g) => g && g.owner_id === uid;
    return {
      id: w.id, kind: w.kind, status: w.status, endsAt: w.ends_at, createdAt: w.created_at,
      topic: t ? { id: t.id, title: t.title, emoji: t.emoji, desc: t.desc } : null,
      from: { ...gangPub(gf), hero: w.from_hero ? { id: w.from_hero, nick: nick(w.from_hero) } : null, run: runPub(rf), mine: myGang === w.from_gang },
      to: { ...gangPub(gt), hero: w.to_hero ? { id: w.to_hero, nick: nick(w.to_hero) } : null, run: runPub(rt), mine: myGang === w.to_gang },
      winner: w.status === 'done' ? (w.winner_gang ? (w.winner_gang === myGang ? 'us' : 'them') : 'draw') : null,
      result: w.result ? JSON.parse(w.result) : null,
      canAccept: w.status === 'pending' && isOwner(gt), canCancel: w.status === 'pending' && isOwner(gf),
      amHero, canPlay, waitReason, battleId: w.battle_id || null,
      opp: amHero ? (uid === w.from_hero ? w.to_hero : w.from_hero) : null
    };
  }

  const warOr404 = (id, uid) => {
    const w = q('SELECT * FROM gang_wars WHERE id = ?').get(Number(id));
    if (!w || !(isMember(w.from_gang, uid) || isMember(w.to_gang, uid))) throw new HttpError(404, 'Битва не найдена.');
    return w;
  };
  const ownGang = (u, gid) => {
    const g = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(gid));
    if (!g || !isMember(g.id, u.id)) throw new HttpError(404, 'Банда не найдена.');
    return g;
  };
  const activeCount = (gid) => q("SELECT COUNT(*) AS n FROM gang_wars WHERE status IN ('pending', 'active') AND (from_gang = ? OR to_gang = ?)").get(gid, gid).n;

  // Битвы банды: идущие, вызовы и недавние итоги
  route('GET', '/api/gangs/:id/wars', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    const rows = q(`SELECT * FROM gang_wars WHERE (from_gang = ? OR to_gang = ?) AND (status IN ('pending', 'active') OR (status = 'done' AND decided_at > ?)) ORDER BY id DESC LIMIT 20`)
      .all(g.id, g.id, U.now() - 14 * 864e5);
    const all = q("SELECT winner_gang FROM gang_wars WHERE status = 'done' AND (from_gang = ? OR to_gang = ?)").all(g.id, g.id);
    return {
      items: rows.map((w) => view(w, u.id)),
      record: { w: all.filter((r) => r.winner_gang === g.id).length, l: all.filter((r) => r.winner_gang && r.winner_gang !== g.id).length, d: all.filter((r) => !r.winner_gang).length },
      isOwner: g.owner_id === u.id, max: MAX_ACTIVE
    };
  });

  // С кем можно драться и по каким темам
  route('GET', '/api/gangwar/rivals', async (req, body, query) => {
    const u = requireUser(req);
    const g = ownGang(u, query.gang);
    const rivals = q('SELECT * FROM gangs WHERE hidden = 0 AND id != ?').all(g.id)
      .map((x) => ({ ...gangPub(x), count: q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(x.id).n, busy: activeCount(x.id) >= MAX_ACTIVE }))
      .filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 50);
    const vs = Number(query.vs) || null;
    return { rivals, topics: topicsFor(g.id, vs), members: gangMembers(g.id).map((m) => ({ id: m.id, nick: m.nick, look: publicLook(m) })) };
  });

  route('POST', '/api/gangs/:id/wars', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    if (g.owner_id !== u.id) throw bad('Вызов бросает владелец банды.');
    const to = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(body.to));
    if (!to || to.id === g.id) throw bad('Выбери банду-соперника.');
    const kind = body.kind === 'sea' ? 'sea' : 'blitz';
    const hero = Number(body.hero);
    if (!isMember(g.id, hero)) throw bad('Герой должен быть из твоей банды.');
    if (activeCount(g.id) >= MAX_ACTIVE) throw bad(`У банды уже ${MAX_ACTIVE} битвы — сначала довоюйте.`);
    if (activeCount(to.id) >= MAX_ACTIVE) throw bad('У этой банды и так две битвы. Позови позже.');
    if (q("SELECT 1 FROM gang_wars WHERE status IN ('pending', 'active') AND ((from_gang = ? AND to_gang = ?) OR (from_gang = ? AND to_gang = ?))").get(g.id, to.id, to.id, g.id)) throw bad('С этой бандой уже идёт битва или висит вызов.');
    let topic = null;
    if (kind === 'blitz') {
      const t = topicsFor(g.id, to.id).find((x) => x.id === body.topic);
      if (!t) throw bad('Выбери тему.');
      if (!t.free) throw bad(t.usedByMe ? 'По этой теме твоя банда уже билась.' : 'По этой теме соперник уже бился — выбери другую.');
      topic = t.id;
    }
    const id = Number(q('INSERT INTO gang_wars (from_gang, to_gang, kind, topic, from_hero, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(g.id, to.id, kind, topic, hero, U.now()).lastInsertRowid);
    const what = kind === 'blitz' ? `блиц «${topicById(topic).title}»` : 'морской бой';
    chat(g.id, u.id, `⚔️ Бросили вызов банде «${to.name}»: ${what}. Наш герой — ${nick(hero)}`);
    chat(to.id, u.id, `⚔️ Банда «${g.name}» вызывает нас на битву: ${what}. Владелец решает, принять ли вызов`);
    const ids = gangMembers(to.id).map((m) => m.id);
    fireAndForget(notify(ids, { title: `⚔️ Вызов от «${g.name}»`, body: `Битва банд: ${what}. Их герой — ${nick(hero)}`, url: `/#gang/${to.id}`, tag: `war-${id}` }));
    if (hero !== u.id) fireAndForget(notify([hero], { title: '⚔️ Ты — герой банды', body: `Банда выставила тебя на битву с «${to.name}»: ${what}`, url: `/#gang/${g.id}`, tag: `war-hero-${id}` }));
    return { id };
  });

  route('POST', '/api/wars/:id/accept', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = warOr404(params.id, u.id);
    const gt = gang(w.to_gang);
    if (w.status !== 'pending') throw bad('Вызов уже неактуален.');
    if (gt.owner_id !== u.id) throw bad('Принять вызов может владелец банды.');
    const hero = Number(body.hero);
    if (!isMember(gt.id, hero)) throw bad('Выбери героя из своей банды.');
    if (hero === w.from_hero) throw bad('Герой не может драться сам с собой.');
    const ends = weekEnd();
    let battleId = null;
    if (w.kind === 'sea' && battle) battleId = battle.createFor(hero, w.from_hero, `⚔️ Битва банд: быстрый морской бой за честь «${gt.name}»`);
    q("UPDATE gang_wars SET status = 'active', to_hero = ?, accepted_at = ?, ends_at = ?, battle_id = ? WHERE id = ?").run(hero, U.now(), ends, battleId, w.id);
    const gf = gang(w.from_gang);
    const what = w.kind === 'blitz' ? `блиц «${topicById(w.topic).title}»` : 'морской бой';
    chat(gt.id, u.id, `⚔️ Вызов «${gf.name}» принят: ${what}. Наш герой — ${nick(hero)}. Срок — до конца рабочей недели`);
    chat(gf.id, w.from_hero, `⚔️ «${gt.name}» приняли вызов: ${what}. Их герой — ${nick(hero)}`);
    const ids = [...gangMembers(gf.id), ...gangMembers(gt.id)].map((m) => m.id);
    fireAndForget(notify(ids, { title: '⚔️ Битва банд началась', body: `«${gf.name}» против «${gt.name}»: ${what}`, url: `/#gang/${gt.id}`, tag: `war-${w.id}` }));
    if (w.kind === 'blitz') fireAndForget(notify([hero], { title: '⚔️ Твой выход', body: `Ты первым проходишь блиц «${topicById(w.topic).title}» — 3 минуты, когда будет удобно на этой неделе`, url: `/#gang/${gt.id}`, tag: `war-hero-${w.id}` }));
    return view(q('SELECT * FROM gang_wars WHERE id = ?').get(w.id), u.id);
  });

  route('POST', '/api/wars/:id/decline', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = warOr404(params.id, u.id);
    const isTo = gang(w.to_gang).owner_id === u.id, isFrom = gang(w.from_gang).owner_id === u.id;
    if (w.status !== 'pending' || !(isTo || isFrom)) throw bad('Нельзя.');
    q("UPDATE gang_wars SET status = ? WHERE id = ?").run(isTo ? 'declined' : 'cancelled', w.id);
    chat(isTo ? w.from_gang : w.to_gang, u.id, isTo ? `⚔️ «${gang(w.to_gang).name}» отказались от битвы` : `⚔️ «${gang(w.from_gang).name}» отозвали вызов`);
    return { ok: true };
  });

  route('GET', '/api/wars/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    return view(warOr404(params.id, u.id), u.id);
  });

  // ---------- Блиц героя: тот же формат, что и общий блиц ----------
  function playView(w, uid) {
    const t = topicById(w.topic);
    const r = closeRun(runOf(w.id, uid));
    const set = { id: 'war' + w.id, title: t.title, emoji: t.emoji, desc: t.desc, secs: SECS, count: t.questions.length };
    if (!r) return { set, state: 'new', war: w.id };
    if (r.finished_at) {
      const fresh = resolve(q('SELECT * FROM gang_wars WHERE id = ?').get(w.id));
      return { set, state: 'done', score: r.score, answered: r.pos, secs: Math.round((r.finished_at - r.started_at) / 1000), war: w.id, warView: view(fresh, uid) };
    }
    const plan = JSON.parse(r.plan); const item = plan[r.pos];
    const [text, opts] = t.questions[item.q];
    return { set, state: 'play', score: r.score, leftMs: Math.max(0, r.started_at + SECS * 1000 - U.now()), war: w.id,
      question: { n: r.pos + 1, total: plan.length, text, options: item.perm.map((i) => opts[i]) } };
  }
  function heroWar(id, uid) {
    const w = resolve(warOr404(id, uid));
    if (w.kind !== 'blitz' || w.status !== 'active') throw bad('Эта битва сейчас не идёт.');
    if (uid !== w.from_hero && uid !== w.to_hero) throw bad('Блиц проходит только герой банды.');
    return w;
  }
  route('GET', '/api/wars/:id/play', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = q('SELECT * FROM gang_wars WHERE id = ?').get(Number(params.id));
    if (!w || (u.id !== w.from_hero && u.id !== w.to_hero)) throw new HttpError(404, 'Битва не найдена.');
    return playView(w, u.id);
  });
  route('POST', '/api/wars/:id/start', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = heroWar(params.id, u.id);
    if (u.id === w.from_hero) { const rt = runOf(w.id, w.to_hero); if (!rt || !rt.finished_at) throw bad('Сначала проходит герой банды, принявшей вызов.'); }
    if (!runOf(w.id, u.id)) {
      const t = topicById(w.topic);
      const plan = shuffle(t.questions.map((_, i) => i)).map((qi) => ({ q: qi, perm: shuffle(t.questions[qi][1].map((_, i) => i)) }));
      q('INSERT OR IGNORE INTO gang_war_runs (war_id, user_id, started_at, plan) VALUES (?, ?, ?, ?)').run(w.id, u.id, U.now(), JSON.stringify(plan));
    }
    return playView(w, u.id);
  });
  route('POST', '/api/wars/:id/answer', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = q('SELECT * FROM gang_wars WHERE id = ?').get(Number(params.id));
    if (!w || (u.id !== w.from_hero && u.id !== w.to_hero)) throw new HttpError(404, 'Битва не найдена.');
    let r = closeRun(runOf(w.id, u.id));
    if (!r) throw bad('Сначала нажми «Начать».');
    if (r.finished_at) return { ...playView(w, u.id), late: true };
    const t = topicById(w.topic);
    const plan = JSON.parse(r.plan); const item = plan[r.pos];
    if (Number(body.n) !== r.pos + 1) return playView(w, u.id);
    const pick = Number(body.pick);
    if (!Number.isInteger(pick) || pick < 0 || pick >= item.perm.length) throw bad('Выбери вариант.');
    const correct = item.perm[pick] === 0, right = item.perm.indexOf(0);
    q('UPDATE gang_war_runs SET pos = pos + 1, score = score + ? WHERE war_id = ? AND user_id = ?').run(correct ? 1 : 0, w.id, u.id);
    r = runOf(w.id, u.id);
    if (r.pos >= plan.length) {
      q('UPDATE gang_war_runs SET finished_at = ? WHERE war_id = ? AND user_id = ?').run(U.now(), w.id, u.id);
      // Герой принявшей банды прошёл — зовём героя вызвавшей
      if (u.id === w.to_hero && w.from_hero) fireAndForget(notify([w.from_hero], { title: '⚔️ Твой выход', body: `Соперник прошёл блиц «${t.title}». Теперь ты — 3 минуты, когда удобно до конца недели`, url: `/#gang/${w.from_gang}`, tag: `war-hero-${w.id}` }));
    }
    const out = playView(w, u.id);
    return { ...out, result: { correct, right } };
  });

  // Время вышло на клиенте — закрываем забег и, если это герой принявшей банды, зовём второго
  route('POST', '/api/wars/:id/timeout', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = q('SELECT * FROM gang_wars WHERE id = ?').get(Number(params.id));
    if (!w || (u.id !== w.from_hero && u.id !== w.to_hero)) throw new HttpError(404, 'Битва не найдена.');
    const before = runOf(w.id, u.id);
    const r = closeRun(before);
    if (before && !before.finished_at && r && r.finished_at && u.id === w.to_hero && w.from_hero) {
      fireAndForget(notify([w.from_hero], { title: '⚔️ Твой выход', body: `Соперник прошёл блиц «${topicById(w.topic).title}». Теперь ты`, url: `/#gang/${w.from_gang}`, tag: `war-hero-${w.id}` }));
    }
    return playView(w, u.id);
  });

  // Для карточки банды: сколько идёт битв и где я герой с ходом
  function summary(gid, uid) {
    const rows = q("SELECT * FROM gang_wars WHERE status IN ('pending', 'active') AND (from_gang = ? OR to_gang = ?)").all(gid, gid).map((w) => view(w, uid));
    return { active: rows.filter((w) => w.status === 'active').length, incoming: rows.filter((w) => w.canAccept).length, myTurn: rows.some((w) => w.canPlay) };
  }
  function record(gid) {
    const all = q("SELECT winner_gang FROM gang_wars WHERE status = 'done' AND (from_gang = ? OR to_gang = ?)").all(gid, gid);
    return { w: all.filter((r) => r.winner_gang === gid).length, l: all.filter((r) => r.winner_gang && r.winner_gang !== gid).length, d: all.filter((r) => !r.winner_gang).length };
  }

  return { tick, summary, record, topicsFor, weekEnd };
}

module.exports = { register, TOPICS };
