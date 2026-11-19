// Битва банд.
// РЕГЛАМЕНТ
//  1. Вызов бросает и принимает владелец банды. Обе банды — от 3 человек (иначе битва превращается в фарм зёрен).
//  2. У банды не больше 2 битв одновременно. С одной бандой — одна битва за раз и пауза 7 дней после итога (без «реваншей на поток»).
//  3. На ответ — 3 дня. Не ответили — вызов сгорает (засчитывается как отказ, в статистике видно).
//  4. Битва идёт 5 рабочих дней по производственному календарю с момента, как вызов приняли.
// ГЕРОЙ
//  • Любой участник может нажать «Готов быть героем» — владелец видит добровольцев первыми и статистику героев.
//  • Ротация: в банде от 3 человек один и тот же герой не выходит два раза подряд — пусть пробуют все.
//  • Герой может отказаться, пока не начал; владелец назначает замену.
// БЛИЦ
//  • Первым проходит герой принявшей банды, потом — вызвавшей. Счёт скрыт до итога, вопросы перемешаны у каждого.
//  • Победа — больше верных, при равенстве — быстрее. Не успел — техническое поражение.
//  • Тема, по которой банда уже билась, для неё закрыта (кроме турнира).
// МОРСКОЙ БОЙ — быстрая партия героев, по 1,5 минуты на часах.
// СТАВКИ (каждый член банды, только за свою банду — ставить против своих нельзя)
//  • 1–10 зёрен, пока ставки открыты: в блице — до старта первого героя, в морском бою — пока партия не началась.
//  • Победившая сторона забирает свои ставки и делит банк проигравших пропорционально ставкам. Ничья — всё возвращается.
// КЛИЧ — каждый член банды может один раз крикнуть герою «Держись!», герой видит поддержку перед стартом.

const { TOPICS } = require('./wartopics');
const { workdayName } = require('./holidays');

const SECS = 180;
const GRACE_MS = 3000;
const PENDING_DAYS = 3;
const MAX_ACTIVE = 2;
const MIN_MEMBERS = 3;
const REMATCH_DAYS = 7;
const BET_MAX = 10;
const PRIZE_HERO = 20, PRIZE_TEAM = 5, PRIZE_DRAW = 5;

function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function register(ctx) {
  const { db, q, route, requireUser, requireAdmin, bad, U, isMember, gangMembers, notify, fireAndForget, HttpError, addBeans, spendBeans, battle, publicLook } = ctx;
  const hooks = { onDone: null };

  db.exec(`
  CREATE TABLE IF NOT EXISTS gang_wars (
    id INTEGER PRIMARY KEY,
    from_gang INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    to_gang INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, topic TEXT,
    from_hero INTEGER REFERENCES users(id) ON DELETE SET NULL,
    to_hero INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
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
  CREATE TABLE IF NOT EXISTS gang_volunteers (
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, PRIMARY KEY (gang_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS war_bets (
    war_id INTEGER NOT NULL REFERENCES gang_wars(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gang_id INTEGER NOT NULL, amount INTEGER NOT NULL, payout INTEGER,
    at INTEGER NOT NULL, PRIMARY KEY (war_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS war_cheers (
    war_id INTEGER NOT NULL REFERENCES gang_wars(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gang_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (war_id, user_id)
  );
  -- Темы блица, которые модератор добавил сам (вдобавок к встроенным)
  CREATE TABLE IF NOT EXISTS war_topics_custom (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, emoji TEXT NOT NULL, descr TEXT, from_day TEXT NOT NULL,
    questions TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL
  );
  `);
  for (const col of ['tour_id INTEGER', 'tour_round INTEGER', 'declined_by INTEGER']) { try { db.exec(`ALTER TABLE gang_wars ADD COLUMN ${col}`); } catch {} }

  const today = () => U.msk().day;
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  // Конец N-го рабочего дня, считая сегодняшний (если рабочий), в 23:59 по Москве
  function workEnd(n = 5) {
    let d = today(), k = 0;
    for (let i = 0; i < 40; i++) { if (workdayName(d)) { k++; if (k === n) break; } d = addDays(d, 1); }
    const z = U.msk(0);
    return Date.parse(d + 'T23:59:59Z') - Date.parse(z.day + 'T' + z.hhmm + ':00Z');
  }
  const gang = (id) => q('SELECT * FROM gangs WHERE id = ?').get(id);
  const memberCount = (gid) => q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(gid).n;
  const nick = (id) => (id ? (q('SELECT nick FROM users WHERE id = ?').get(id) || {}).nick : null) || 'удалённый аккаунт';

  // ---------- Темы: встроенные + от модератора ----------
  function allTopics() {
    const custom = q('SELECT * FROM war_topics_custom WHERE active = 1').all().map((r) => ({ id: r.id, title: r.title, emoji: r.emoji, desc: r.descr || '', from: r.from_day, questions: JSON.parse(r.questions), custom: true }));
    return [...TOPICS, ...custom];
  }
  const topicById = (id) => allTopics().find((t) => t.id === id) || null;
  const usedTopics = (gid) => new Set(q(`SELECT topic FROM gang_wars WHERE kind = 'blitz' AND tour_id IS NULL AND status IN ('pending', 'active', 'done') AND (from_gang = ? OR to_gang = ?)`).all(gid, gid).map((r) => r.topic));
  function topicsFor(a, b) {
    const ua = usedTopics(a), ub = b ? usedTopics(b) : new Set();
    return allTopics().filter((t) => t.from <= today()).map((t) => ({ id: t.id, title: t.title, emoji: t.emoji, desc: t.desc, count: t.questions.length, free: !ua.has(t.id) && !ub.has(t.id), usedByMe: ua.has(t.id), usedByThem: ub.has(t.id) }));
  }
  const gangPub = (g) => (g ? { id: g.id, name: g.name, color: g.color, ...U.crestPub(g) } : null);
  function chat(gid, uid, text) { q('INSERT INTO messages (gang_id, user_id, type, text, at) VALUES (?, ?, ?, ?, ?)').run(gid, uid, 'text', text, U.now()); }
  const runOf = (wid, uid) => (uid ? q('SELECT * FROM gang_war_runs WHERE war_id = ? AND user_id = ?').get(wid, uid) : null);

  // ---------- Герои ----------
  // Кто был героем банды в её последней битве (кроме отменённых)
  function lastHero(gid, exceptWar = 0) {
    const w = q(`SELECT * FROM gang_wars WHERE (from_gang = ? OR to_gang = ?) AND id != ? AND status IN ('active', 'done') ORDER BY COALESCE(accepted_at, created_at) DESC LIMIT 1`).get(gid, gid, exceptWar);
    if (!w) return null;
    return w.from_gang === gid ? w.from_hero : w.to_hero;
  }
  function heroCheck(gid, hero, warId = 0) {
    if (!isMember(gid, hero)) throw bad('Герой должен быть из твоей банды.');
    if (memberCount(gid) >= MIN_MEMBERS && lastHero(gid, warId) === hero) throw bad('Ротация героев: этот человек бился за банду в прошлый раз. Дай шанс другим.');
  }
  function heroStats(gid) {
    const rows = q(`SELECT * FROM gang_wars WHERE status = 'done' AND (from_gang = ? OR to_gang = ?)`).all(gid, gid);
    const st = {};
    for (const w of rows) {
      const h = w.from_gang === gid ? w.from_hero : w.to_hero;
      if (!h) continue;
      st[h] = st[h] || { wars: 0, wins: 0 };
      st[h].wars++;
      if (w.winner_gang === gid) st[h].wins++;
    }
    return st;
  }
  function membersFor(gid) {
    const st = heroStats(gid);
    const vol = new Set(q('SELECT user_id FROM gang_volunteers WHERE gang_id = ?').all(gid).map((r) => r.user_id));
    const last = memberCount(gid) >= MIN_MEMBERS ? lastHero(gid) : null;
    return gangMembers(gid).map((m) => ({ id: m.id, nick: m.nick, look: publicLook(m), volunteer: vol.has(m.id), wars: (st[m.id] || {}).wars || 0, wins: (st[m.id] || {}).wins || 0, rotation: m.id === last }))
      .sort((a, b) => Number(b.volunteer) - Number(a.volunteer) || Number(a.rotation) - Number(b.rotation) || b.wins - a.wins);
  }

  // ---------- Ставки ----------
  function betsOpen(w) {
    if (!['pending', 'active'].includes(w.status)) return false;
    if (w.kind === 'blitz') return !runOf(w.id, w.to_hero) && !runOf(w.id, w.from_hero);
    if (w.kind === 'sea') { const b = w.battle_id && battle ? battle.stateOf(w.battle_id) : null; return !b || b.status === 'setup'; }
    return false;
  }
  function settleBets(w, winnerGang) {
    const bets = q('SELECT * FROM war_bets WHERE war_id = ?').all(w.id);
    if (!bets.length) return;
    if (!winnerGang) { for (const b of bets) { addBeans(b.user_id, 'war_bet_back', b.amount); q('UPDATE war_bets SET payout = ? WHERE war_id = ? AND user_id = ?').run(b.amount, w.id, b.user_id); } return; }
    const win = bets.filter((b) => b.gang_id === winnerGang), lose = bets.filter((b) => b.gang_id !== winnerGang);
    const pot = lose.reduce((a, b) => a + b.amount, 0), stake = win.reduce((a, b) => a + b.amount, 0);
    let left = pot;
    win.forEach((b, i) => {
      const share = i === win.length - 1 ? left : Math.floor((pot * b.amount) / Math.max(1, stake));
      left -= share;
      const pay = b.amount + share;
      addBeans(b.user_id, 'war_bet_win', pay);
      q('UPDATE war_bets SET payout = ? WHERE war_id = ? AND user_id = ?').run(pay, w.id, b.user_id);
    });
    for (const b of lose) q('UPDATE war_bets SET payout = 0 WHERE war_id = ? AND user_id = ?').run(w.id, b.user_id);
    // Если за победителей никто не ставил — проигравшим возвращаем: банк некому делить
    if (!win.length) for (const b of lose) { addBeans(b.user_id, 'war_bet_back', b.amount); q('UPDATE war_bets SET payout = ? WHERE war_id = ? AND user_id = ?').run(b.amount, w.id, b.user_id); }
  }

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
    const t = topicById(w.topic);
    const what = w.kind === 'blitz' ? `блиц «${t ? t.title : ''}»` : 'морской бой';
    const pre = w.tour_id ? 'Турнир' : 'Битва банд';
    const line = winnerGang ? `${pre} (${what}): победила «${winnerGang === w.from_gang ? gf.name : gt.name}»${result.note ? ' — ' + result.note : ''}` : `${pre} (${what}): ничья${result.note ? ' — ' + result.note : ''}`;
    for (const g of [gf, gt]) if (g) chat(g.id, g.id === w.from_gang ? w.from_hero : w.to_hero, line);
    if (!w.tour_id) {
      if (winnerGang) {
        const hero = winnerGang === w.from_gang ? w.from_hero : w.to_hero;
        if (hero) addBeans(hero, 'gangwar', PRIZE_HERO);
        for (const m of gangMembers(winnerGang)) if (m.id !== hero) addBeans(m.id, 'gangwar_team', PRIZE_TEAM);
      } else for (const h of [w.from_hero, w.to_hero]) if (h) addBeans(h, 'gangwar', PRIZE_DRAW);
    }
    settleBets(w, winnerGang);
    const ids = [...gangMembers(w.from_gang), ...gangMembers(w.to_gang)].map((m) => m.id);
    fireAndForget(notify(ids, { title: `${pre}: итог`, body: line.replace(pre + ' ', ''), url: `/#gang/${w.from_gang}`, tag: `war-${w.id}` }));
    if (hooks.onDone) hooks.onDone(q('SELECT * FROM gang_wars WHERE id = ?').get(w.id));
  }

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
        if (!done(rt) && !done(rf)) finishWar(w, null, { note: 'никто не успел' });
        else if (!done(rt)) finishWar(w, w.from_gang, { note: 'герой соперника не вышел на бой' });
        else finishWar(w, w.to_gang, { to: { score: rt.score }, note: 'герой соперника не успел' });
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
    for (const w of q("SELECT * FROM gang_wars WHERE status = 'pending' AND tour_id IS NULL AND created_at < ?").all(U.now() - PENDING_DAYS * 864e5)) {
      q("UPDATE gang_wars SET status = 'expired', declined_by = ? WHERE id = ?").run(w.to_gang, w.id);
      for (const b of q('SELECT * FROM war_bets WHERE war_id = ?').all(w.id)) addBeans(b.user_id, 'war_bet_back', b.amount);
    }
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('gangwar', e); } }, 5 * 60e3).unref();

  function view(w, uid) {
    w = resolve(w);
    const gf = gang(w.from_gang), gt = gang(w.to_gang);
    const myGang = isMember(w.from_gang, uid) ? w.from_gang : isMember(w.to_gang, uid) ? w.to_gang : null;
    const t = topicById(w.topic);
    const rt = w.kind === 'blitz' ? runOf(w.id, w.to_hero) : null, rf = w.kind === 'blitz' ? runOf(w.id, w.from_hero) : null;
    const reveal = w.status === 'done';
    const runPub = (r) => (r ? { done: !!r.finished_at, playing: !r.finished_at, score: reveal ? r.score : null, secs: reveal && r.finished_at ? Math.round((r.finished_at - r.started_at) / 1000) : null } : { done: false, playing: false });
    const amHero = !!uid && (uid === w.from_hero || uid === w.to_hero);
    let canPlay = false, waitReason = null;
    if (w.status === 'active' && w.kind === 'blitz' && amHero) {
      const mine = runOf(w.id, uid);
      if (mine && mine.finished_at) waitReason = 'Твой заход готов — ждём итог';
      else if (uid === w.to_hero) canPlay = true;
      else if (rt && rt.finished_at) canPlay = true;
      else waitReason = 'Сначала проходит герой банды, принявшей вызов. Как пройдёт — придёт пуш';
    }
    const isOwner = (g) => g && g.owner_id === uid;
    const bets = q('SELECT b.*, u.nick FROM war_bets b JOIN users u ON u.id = b.user_id WHERE b.war_id = ?').all(w.id);
    const myBet = bets.find((b) => b.user_id === uid);
    const cheers = q('SELECT c.gang_id, u.nick FROM war_cheers c JOIN users u ON u.id = c.user_id WHERE c.war_id = ?').all(w.id);
    const pool = (gid) => bets.filter((b) => b.gang_id === gid).reduce((a, b) => a + b.amount, 0);
    const side = (g, heroId, run) => ({
      ...gangPub(g), hero: heroId ? { id: heroId, nick: nick(heroId) } : null, run: runPub(run), mine: myGang === g.id,
      pool: pool(g.id), cheers: cheers.filter((c) => c.gang_id === g.id).length
    });
    const mySideHero = myGang === w.from_gang ? w.from_hero : myGang === w.to_gang ? w.to_hero : null;
    const mySideRun = mySideHero ? runOf(w.id, mySideHero) : null;
    const ownerOfMySide = myGang && isOwner(gang(myGang));
    return {
      id: w.id, kind: w.kind, status: w.status, endsAt: w.ends_at, createdAt: w.created_at, tour: w.tour_id ? { id: w.tour_id, round: w.tour_round } : null,
      topic: t ? { id: t.id, title: t.title, emoji: t.emoji, desc: t.desc } : null,
      from: side(gf, w.from_hero, rf), to: side(gt, w.to_hero, rt),
      winner: w.status === 'done' ? (w.winner_gang ? (w.winner_gang === myGang ? 'us' : 'them') : 'draw') : null,
      result: w.result ? JSON.parse(w.result) : null,
      canAccept: w.status === 'pending' && !w.tour_id && isOwner(gt), canCancel: w.status === 'pending' && !w.tour_id && isOwner(gf),
      // Сменить героя: владелец своей стороны, пока его герой не начал (или героя нет)
      canSetHero: !!ownerOfMySide && ['pending', 'active'].includes(w.status) && !(mySideRun) && !(w.kind === 'sea' && w.status === 'active') && !(w.status === 'pending' && myGang === w.to_gang),
      amHero, canPlay, waitReason, battleId: w.battle_id || null, canStepDown: amHero && w.kind === 'blitz' && w.status === 'active' && !runOf(w.id, uid),
      opp: amHero ? (uid === w.from_hero ? w.to_hero : w.from_hero) : null,
      bets: { open: betsOpen(w) && !!myGang, mine: myBet ? { amount: myBet.amount, payout: myBet.payout } : null, max: BET_MAX },
      cheered: !!q('SELECT 1 FROM war_cheers WHERE war_id = ? AND user_id = ?').get(w.id, uid),
      cheersForMe: amHero ? cheers.filter((c) => c.gang_id === myGang).map((c) => c.nick) : null
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
  const activeCount = (gid) => q("SELECT COUNT(*) AS n FROM gang_wars WHERE status IN ('pending', 'active') AND tour_id IS NULL AND (from_gang = ? OR to_gang = ?)").get(gid, gid).n;
  function record(gid) {
    const all = q("SELECT winner_gang FROM gang_wars WHERE status = 'done' AND (from_gang = ? OR to_gang = ?)").all(gid, gid);
    const declined = q("SELECT COUNT(*) AS n FROM gang_wars WHERE status IN ('declined', 'expired') AND to_gang = ? AND created_at > ?").get(gid, U.now() - 30 * 864e5).n;
    return { w: all.filter((r) => r.winner_gang === gid).length, l: all.filter((r) => r.winner_gang && r.winner_gang !== gid).length, d: all.filter((r) => !r.winner_gang).length, declined };
  }
  // Почему нельзя вызвать эту банду (или null)
  function blockReason(g, to) {
    if (memberCount(g.id) < MIN_MEMBERS) return `В твоей банде меньше ${MIN_MEMBERS} человек — сначала позови своих.`;
    if (memberCount(to.id) < MIN_MEMBERS) return `В этой банде меньше ${MIN_MEMBERS} человек.`;
    if (activeCount(g.id) >= MAX_ACTIVE) return `У твоей банды уже ${MAX_ACTIVE} битвы — сначала довоюйте.`;
    if (activeCount(to.id) >= MAX_ACTIVE) return 'У этой банды и так две битвы.';
    if (q("SELECT 1 FROM gang_wars WHERE status IN ('pending', 'active') AND tour_id IS NULL AND ((from_gang = ? AND to_gang = ?) OR (from_gang = ? AND to_gang = ?))").get(g.id, to.id, to.id, g.id)) return 'С этой бандой уже идёт битва или висит вызов.';
    const last = q("SELECT decided_at FROM gang_wars WHERE status = 'done' AND tour_id IS NULL AND ((from_gang = ? AND to_gang = ?) OR (from_gang = ? AND to_gang = ?)) ORDER BY decided_at DESC LIMIT 1").get(g.id, to.id, to.id, g.id);
    if (last && U.now() - last.decided_at < REMATCH_DAYS * 864e5) return `Реванш — не раньше чем через ${REMATCH_DAYS} дней после прошлой битвы.`;
    return null;
  }

  route('GET', '/api/gangs/:id/wars', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    const rows = q(`SELECT * FROM gang_wars WHERE (from_gang = ? OR to_gang = ?) AND (status IN ('pending', 'active') OR (status = 'done' AND decided_at > ?)) ORDER BY id DESC LIMIT 20`)
      .all(g.id, g.id, U.now() - 14 * 864e5);
    return {
      items: rows.map((w) => view(w, u.id)), record: record(g.id),
      isOwner: g.owner_id === u.id, max: MAX_ACTIVE, minMembers: MIN_MEMBERS, members: memberCount(g.id),
      volunteer: !!q('SELECT 1 FROM gang_volunteers WHERE gang_id = ? AND user_id = ?').get(g.id, u.id),
      volunteers: q('SELECT COUNT(*) AS n FROM gang_volunteers WHERE gang_id = ?').get(g.id).n,
      rules: { pendingDays: PENDING_DAYS, rematchDays: REMATCH_DAYS, betMax: BET_MAX, prizeHero: PRIZE_HERO, prizeTeam: PRIZE_TEAM }
    };
  });

  route('POST', '/api/gangs/:id/volunteer', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    if (body.on) q('INSERT OR IGNORE INTO gang_volunteers (gang_id, user_id, at) VALUES (?, ?, ?)').run(g.id, u.id, U.now());
    else q('DELETE FROM gang_volunteers WHERE gang_id = ? AND user_id = ?').run(g.id, u.id);
    return { ok: true, volunteer: !!body.on };
  });

  route('GET', '/api/gangwar/rivals', async (req, body, query) => {
    const u = requireUser(req);
    const g = ownGang(u, query.gang);
    const rivals = q("SELECT * FROM gangs WHERE hidden = 0 AND id != ? AND company = ?").all(g.id, g.company || 'mts')
      .map((x) => ({ ...gangPub(x), count: memberCount(x.id), block: blockReason(g, x) }))
      .filter((x) => x.count > 0).sort((a, b) => Number(!!a.block) - Number(!!b.block) || b.count - a.count).slice(0, 50);
    const vs = Number(query.vs) || null;
    return { rivals, topics: topicsFor(g.id, vs), members: membersFor(g.id), self: memberCount(g.id) < MIN_MEMBERS ? `В банде меньше ${MIN_MEMBERS} человек — сначала позови своих.` : null };
  });

  route('POST', '/api/gangs/:id/wars', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = ownGang(u, params.id);
    if (g.owner_id !== u.id) throw bad('Вызов бросает владелец банды.');
    const to = q('SELECT * FROM gangs WHERE id = ? AND hidden = 0').get(Number(body.to));
    if (!to || to.id === g.id || (to.company || 'mts') !== (g.company || 'mts')) throw bad('Выбери банду-соперника.');
    const why = blockReason(g, to);
    if (why) throw bad(why);
    const kind = body.kind === 'sea' ? 'sea' : 'blitz';
    const hero = Number(body.hero);
    heroCheck(g.id, hero);
    let topic = null;
    if (kind === 'blitz') {
      const t = topicsFor(g.id, to.id).find((x) => x.id === body.topic);
      if (!t) throw bad('Выбери тему.');
      if (!t.free) throw bad(t.usedByMe ? 'По этой теме твоя банда уже билась.' : 'По этой теме соперник уже бился — выбери другую.');
      topic = t.id;
    }
    const id = Number(q('INSERT INTO gang_wars (from_gang, to_gang, kind, topic, from_hero, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(g.id, to.id, kind, topic, hero, U.now()).lastInsertRowid);
    const what = kind === 'blitz' ? `блиц «${topicById(topic).title}»` : 'морской бой';
    chat(g.id, u.id, `Бросили вызов банде «${to.name}»: ${what}. Наш герой — ${nick(hero)}. Делайте ставки и кричите «Держись!»`);
    chat(to.id, u.id, `Банда «${g.name}» вызывает нас на битву: ${what}. У владельца ${PENDING_DAYS} дня, чтобы ответить. Кто готов быть героем — жмите `);
    fireAndForget(notify(gangMembers(to.id).map((m) => m.id), { title: `Вызов от «${g.name}»`, body: `Битва банд: ${what}. Их герой — ${nick(hero)}`, url: `/#gang/${to.id}`, tag: `war-${id}` }));
    if (hero !== u.id) fireAndForget(notify([hero], { title: 'Ты — герой банды', body: `Банда выставила тебя на битву с «${to.name}»: ${what}`, url: `/#gang/${g.id}`, tag: `war-hero-${id}` }));
    return { id };
  });

  // Создать битву для турнира: сразу активна, героев назначают владельцы
  function createTourWar(tourId, round, ga, gb, topic, endsAt) {
    const id = Number(q("INSERT INTO gang_wars (from_gang, to_gang, kind, topic, status, created_at, accepted_at, ends_at, tour_id, tour_round) VALUES (?, ?, 'blitz', ?, 'active', ?, ?, ?, ?, ?)")
      .run(ga, gb, topic, U.now(), U.now(), endsAt, tourId, round).lastInsertRowid);
    return id;
  }

  route('POST', '/api/wars/:id/accept', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = warOr404(params.id, u.id);
    const gt = gang(w.to_gang);
    if (w.status !== 'pending' || w.tour_id) throw bad('Вызов уже неактуален.');
    if (gt.owner_id !== u.id) throw bad('Принять вызов может владелец банды.');
    const hero = Number(body.hero);
    heroCheck(gt.id, hero);
    if (hero === w.from_hero) throw bad('Герой не может драться сам с собой.');
    const ends = workEnd(5);
    let battleId = null;
    if (w.kind === 'sea' && battle) battleId = battle.createFor(hero, w.from_hero, `Битва банд: быстрый морской бой за честь «${gt.name}»`);
    q("UPDATE gang_wars SET status = 'active', to_hero = ?, accepted_at = ?, ends_at = ?, battle_id = ? WHERE id = ?").run(hero, U.now(), ends, battleId, w.id);
    const gf = gang(w.from_gang);
    const what = w.kind === 'blitz' ? `блиц «${topicById(w.topic).title}»` : 'морской бой';
    chat(gt.id, u.id, `Вызов «${gf.name}» принят: ${what}. Наш герой — ${nick(hero)}. Срок — 5 рабочих дней. Ставки открыты, пока герои не начали`);
    chat(gf.id, w.from_hero, `«${gt.name}» приняли вызов: ${what}. Их герой — ${nick(hero)}`);
    fireAndForget(notify([...gangMembers(gf.id), ...gangMembers(gt.id)].map((m) => m.id), { title: 'Битва банд началась', body: `«${gf.name}» против «${gt.name}»: ${what}`, url: `/#gang/${gt.id}`, tag: `war-${w.id}` }));
    if (w.kind === 'blitz') fireAndForget(notify([hero], { title: 'Твой выход', body: `Ты ${U.g((q('SELECT look FROM users WHERE id = ?').get(hero) || {}).look, 'первым', 'первой')} проходишь блиц «${topicById(w.topic).title}» — 3 минуты, когда удобно на этой неделе`, url: `/#gang/${gt.id}`, tag: `war-hero-${w.id}` }));
    return view(q('SELECT * FROM gang_wars WHERE id = ?').get(w.id), u.id);
  });

  route('POST', '/api/wars/:id/decline', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = warOr404(params.id, u.id);
    const isTo = gang(w.to_gang).owner_id === u.id, isFrom = gang(w.from_gang).owner_id === u.id;
    if (w.status !== 'pending' || w.tour_id || !(isTo || isFrom)) throw bad('Нельзя.');
    q('UPDATE gang_wars SET status = ?, declined_by = ? WHERE id = ?').run(isTo ? 'declined' : 'cancelled', isTo ? w.to_gang : null, w.id);
    for (const b of q('SELECT * FROM war_bets WHERE war_id = ?').all(w.id)) addBeans(b.user_id, 'war_bet_back', b.amount);
    chat(isTo ? w.from_gang : w.to_gang, u.id, isTo ? `«${gang(w.to_gang).name}» отказались от битвы` : `«${gang(w.from_gang).name}» отозвали вызов`);
    return { ok: true };
  });

  // Назначить или сменить героя своей стороны
  route('POST', '/api/wars/:id/hero', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = warOr404(params.id, u.id);
    const v = view(w, u.id);
    if (!v.canSetHero) throw bad('Сейчас героя поменять нельзя.');
    const mySide = isMember(w.from_gang, u.id) ? 'from' : 'to';
    const gid = mySide === 'from' ? w.from_gang : w.to_gang;
    const hero = Number(body.hero);
    heroCheck(gid, hero, w.id);
    if (hero === (mySide === 'from' ? w.to_hero : w.from_hero)) throw bad('Это герой соперника.');
    q(`UPDATE gang_wars SET ${mySide}_hero = ? WHERE id = ?`).run(hero, w.id);
    chat(gid, u.id, `Наш герой в битве с «${gang(mySide === 'from' ? w.to_gang : w.from_gang).name}» — ${nick(hero)}`);
    fireAndForget(notify([hero], { title: 'Ты — герой банды', body: 'Тебя выставили в битву банд — загляни в банду', url: `/#gang/${gid}`, tag: `war-hero-${w.id}` }));
    return view(q('SELECT * FROM gang_wars WHERE id = ?').get(w.id), u.id);
  });

  route('POST', '/api/wars/:id/step-down', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = warOr404(params.id, u.id);
    const v = view(w, u.id);
    if (!v.canStepDown) throw bad('Отказаться уже нельзя — блиц начат.');
    const mySide = u.id === w.from_hero ? 'from' : 'to';
    const gid = mySide === 'from' ? w.from_gang : w.to_gang;
    q(`UPDATE gang_wars SET ${mySide}_hero = NULL WHERE id = ?`).run(w.id);
    const g = gang(gid);
    chat(gid, u.id, `${nick(u.id)} не сможет биться. Владелец, назначь нового героя — иначе техническое поражение`);
    if (g.owner_id) fireAndForget(notify([g.owner_id], { title: 'Нужен новый герой', body: `${nick(u.id)} не сможет — назначь замену`, url: `/#gang/${gid}`, tag: `war-hero-${w.id}` }));
    return view(q('SELECT * FROM gang_wars WHERE id = ?').get(w.id), u.id);
  });

  route('POST', '/api/wars/:id/bet', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = resolve(warOr404(params.id, u.id));
    if (!betsOpen(w)) throw bad('Ставки закрыты — герои уже в бою.');
    const gid = isMember(w.from_gang, u.id) ? w.from_gang : w.to_gang;
    const amount = Math.floor(Number(body.amount));
    if (!(amount >= 1 && amount <= BET_MAX)) throw bad(`Ставка — от 1 до ${BET_MAX} зёрен.`);
    if (q('SELECT 1 FROM war_bets WHERE war_id = ? AND user_id = ?').get(w.id, u.id)) throw bad('Ставка уже сделана.');
    if (!spendBeans(u.id, amount, 'war_bet')) throw bad('Не хватает зёрен.');
    q('INSERT INTO war_bets (war_id, user_id, gang_id, amount, at) VALUES (?, ?, ?, ?, ?)').run(w.id, u.id, gid, amount, U.now());
    return view(w, u.id);
  });

  route('POST', '/api/wars/:id/cheer', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = warOr404(params.id, u.id);
    if (!['pending', 'active'].includes(w.status)) throw bad('Битва уже закончилась.');
    const gid = isMember(w.from_gang, u.id) ? w.from_gang : w.to_gang;
    const hero = gid === w.from_gang ? w.from_hero : w.to_hero;
    if (hero === u.id) throw bad('Себя не подбадривают — это делает банда.');
    if (!q('SELECT 1 FROM war_cheers WHERE war_id = ? AND user_id = ?').get(w.id, u.id)) {
      q('INSERT INTO war_cheers (war_id, user_id, gang_id, at) VALUES (?, ?, ?, ?)').run(w.id, u.id, gid, U.now());
      if (hero) fireAndForget(notify([hero], { title: 'Держись!', body: `${nick(u.id)} болеет за тебя в битве банд`, url: `/#gang/${gid}`, tag: `war-cheer-${w.id}` }));
    }
    return view(w, u.id);
  });

  route('GET', '/api/wars/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    return view(warOr404(params.id, u.id), u.id);
  });

  // ---------- Блиц героя ----------
  function playView(w, uid) {
    const t = topicById(w.topic);
    const r = closeRun(runOf(w.id, uid));
    const set = { id: 'war' + w.id, title: t.title, emoji: t.emoji, desc: t.desc, secs: SECS, count: t.questions.length };
    if (!r) {
      const gid = isMember(w.from_gang, uid) ? w.from_gang : w.to_gang;
      return { set, state: 'new', war: w.id, cheers: q('SELECT u.nick FROM war_cheers c JOIN users u ON u.id = c.user_id WHERE c.war_id = ? AND c.gang_id = ?').all(w.id, gid).map((x) => x.nick) };
    }
    if (r.finished_at) {
      const fresh = resolve(q('SELECT * FROM gang_wars WHERE id = ?').get(w.id));
      return { set, state: 'done', score: r.score, answered: r.pos, secs: Math.round((r.finished_at - r.started_at) / 1000), war: w.id, warView: view(fresh, uid) };
    }
    const plan = JSON.parse(r.plan); const item = plan[r.pos];
    const [text, opts] = t.questions[item.q];
    return { set, state: 'play', score: r.score, leftMs: Math.max(0, r.started_at + SECS * 1000 - U.now()), war: w.id,
      question: { n: r.pos + 1, total: plan.length, text, options: item.perm.map((i) => opts[i]) } };
  }
  const heroOnly = (id, uid) => {
    const w = q('SELECT * FROM gang_wars WHERE id = ?').get(Number(id));
    if (!w || (uid !== w.from_hero && uid !== w.to_hero)) throw new HttpError(404, 'Битва не найдена.');
    return w;
  };
  const nextUp = (w) => {
    if (w.from_hero) fireAndForget(notify([w.from_hero], { title: 'Твой выход', body: `Соперник прошёл блиц «${topicById(w.topic).title}». Теперь ты — 3 минуты, когда удобно до конца срока`, url: `/#gang/${w.from_gang}`, tag: `war-hero-${w.id}` }));
  };
  route('GET', '/api/wars/:id/play', async (req, body, query, params) => {
    const u = requireUser(req);
    return playView(heroOnly(params.id, u.id), u.id);
  });
  route('POST', '/api/wars/:id/start', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = resolve(heroOnly(params.id, u.id));
    if (w.kind !== 'blitz' || w.status !== 'active') throw bad('Эта битва сейчас не идёт.');
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
    const w = heroOnly(params.id, u.id);
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
      if (u.id === w.to_hero) nextUp(w);
    }
    return { ...playView(w, u.id), result: { correct, right } };
  });
  route('POST', '/api/wars/:id/timeout', async (req, body, query, params) => {
    const u = requireUser(req);
    const w = heroOnly(params.id, u.id);
    const before = runOf(w.id, u.id);
    const r = closeRun(before);
    if (before && !before.finished_at && r && r.finished_at && u.id === w.to_hero) nextUp(w);
    return playView(w, u.id);
  });

  // ---------- Темы блица: панель модератора ----------
  route('GET', '/api/admin/topics', async (req) => {
    requireAdmin(req);
    return { items: allTopics().map((t) => ({ id: t.id, title: t.title, emoji: t.emoji, desc: t.desc, from: t.from, count: t.questions.length, custom: !!t.custom, sample: t.questions.slice(0, 2) })),
      inactive: q('SELECT id, title FROM war_topics_custom WHERE active = 0').all() };
  });
  // Вопросы — строками: «Вопрос | Правильный | Неверный | Неверный | Неверный»
  route('POST', '/api/admin/topics', async (req, body) => {
    requireAdmin(req);
    const title = U.cleanText(body.title, 40);
    if (title.length < 3) throw bad('Название темы — от 3 символов.');
    const emoji = U.cleanText(body.emoji || '', 4) || '';
    const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : today();
    const questions = String(body.questions || '').split('\n').map((l) => l.split('|').map((x) => x.trim()).filter(Boolean)).filter((p) => p.length).map((p, i) => {
      if (p.length < 3 || p.length > 5) throw bad(`Строка ${i + 1}: нужен вопрос, правильный ответ и 1–3 неверных через «|».`);
      return [p[0].slice(0, 200), p.slice(1).map((x) => x.slice(0, 120))];
    });
    if (questions.length < 8) throw bad('Нужно хотя бы 8 вопросов — блиц на 3 минуты.');
    const id = 'c' + U.shortCode(6).toLowerCase();
    q('INSERT INTO war_topics_custom (id, title, emoji, descr, from_day, questions, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, title, emoji, U.cleanText(body.desc || '', 120), from, JSON.stringify(questions), U.now());
    return { ok: true, id, count: questions.length };
  });
  route('POST', '/api/admin/topics/:id/toggle', async (req, body, query, params) => {
    requireAdmin(req);
    q('UPDATE war_topics_custom SET active = 1 - active WHERE id = ?').run(params.id);
    return { ok: true };
  });

  function summary(gid, uid) {
    const rows = q("SELECT * FROM gang_wars WHERE status IN ('pending', 'active') AND (from_gang = ? OR to_gang = ?)").all(gid, gid).map((w) => view(w, uid));
    return { active: rows.filter((w) => w.status === 'active').length, incoming: rows.filter((w) => w.canAccept).length, myTurn: rows.some((w) => w.canPlay), needHero: rows.some((w) => w.canSetHero && w.status === 'active' && !(w.from.mine ? w.from.hero : w.to.hero)) };
  }

  return { tick, summary, record, topicsFor, allTopics, workEnd, createTourWar, resolve, hooks, membersFor, heroCheck, view };
}

module.exports = { register, TOPICS };
