// «Этаж» пишет сам: живая сводка того, что ждёт человека прямо сейчас.
// Это не лента сообщений: пункт исчезает, как только дело сделано, поэтому сводка не копится.
// Раз в рабочий день (кроме пятницы — там своя сводка недели) — один пуш, и только если:
//   человек сегодня ещё не заходил, включил «Утреннюю сводку» и в сводке есть что-то кроме заданий дня.
// То, что и так приходит пушем сразу (ход в бою, дуэль, кофе-ответ), в утренний пуш не попадает.

const PUSH_FROM = 11.5, PUSH_TO = 13; // окно отправки по Москве: 11:30–13:00

function register(ctx) {
  const { db, q, route, requireUser, U, notify, fireAndForget, myGangs, readProfile, weekdayName, features, blitz, advent, santa } = ctx;

  db.exec('CREATE TABLE IF NOT EXISTS inbox_push (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL)');

  const ddmm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  const nick = (id) => (q('SELECT nick FROM users WHERE id = ?').get(id) || {}).nick || 'соперник';

  // Пункты сводки. push: false — уже приходит отдельным пушем в момент события
  function items(u) {
    const out = [];
    const uid = u.id, day = U.msk().day;

    // Морской бой: твой ход или расстановка
    for (const b of q("SELECT * FROM battles WHERE status != 'done' AND (a = ? OR b = ?)").all(uid, uid)) {
      const s = b.a === uid ? 'a' : 'b', opp = s === 'a' ? b.b : b.a;
      const mine = (b.status === 'play' && b.turn === uid) || (b.status === 'setup' && !b[s + '_ready']);
      if (mine) out.push({ id: `battle-${b.id}`, kind: 'battle', icon: 'anchor', push: false, title: b.status === 'setup' ? `Расставь корабли против ${nick(opp)}` : `Твой ход в морском бое с ${nick(opp)}`, go: { act: 'battle-go', id: b.id, opp } });
    }
    // Дуэли, где ждут тебя
    const duelTurns = (ctx.duels && ctx.duels.myTurns) ? ctx.duels.myTurns(uid) : 0;
    if (duelTurns) out.push({ id: 'duels', kind: 'duel', icon: 'game', push: false, title: duelTurns === 1 ? 'Дуэль ждёт твоего хода' : `${duelTurns} дуэли ждут твоего хода`, go: { act: 'tab', v: 'games' } });

    // Погода на завтра, если завтра в офис и погода необычная (пуш — отдельно, вечером)
    if (ctx.weather) {
      const w = ctx.weather.adviceFor(uid, u.profile);
      if (w) out.push({ id: `weather-${w.day}`, kind: 'weather', icon: w.icon, push: false, title: w.text.replace(/\. [^.]*$/, ''), text: `Завтра в офис · ${w.temp}`, go: { act: 'tab', v: 'near' } });
    }
    // Непрочитанные секретные сообщения (текста сервер не знает — только от кого)
    try {
      for (const r of q('SELECT m.from_id, u.nick, COUNT(*) AS n FROM secret_msgs m JOIN users u ON u.id = m.from_id WHERE m.to_id = ? AND m.read_at IS NULL AND m.at > ? GROUP BY m.from_id').all(uid, U.now() - 7 * 864e5)) {
        out.push({ id: `secret-${r.from_id}-${r.n}`, kind: 'secret', icon: 'lock', push: false, title: `${r.nick}: ${r.n === 1 ? 'секретное сообщение' : `${r.n} секретных сообщения`}`, text: 'Откроется только на твоём устройстве', go: { act: 'secret-open', id: r.from_id } });
      }
    } catch {}
    // Блиц: не начат или не доигран
    const set = blitz && blitz.activeSet();
    if (set) {
      const run = q('SELECT finished_at FROM blitz_runs WHERE user_id = ? AND set_id = ?').get(uid, set.id);
      if (!run) out.push({ id: `blitz-${set.id}`, kind: 'blitz', icon: 'bolt', push: true, title: `Блиц «${set.title}» — до ${ddmm(set.to)}`, text: 'Одна попытка, несколько минут. Лидеры видны всем', go: { act: 'tab', v: 'games', to: '.blitz' } });
    }
    // Квиз недели без ответа
    const quiz = q('SELECT COUNT(*) AS n FROM quizzes z WHERE closes_at > ? AND NOT EXISTS (SELECT 1 FROM quiz_answers a WHERE a.quiz_id = z.id AND a.user_id = ?)').get(U.now(), uid).n;
    if (quiz) out.push({ id: 'quiz', kind: 'quiz', icon: 'bulb', push: true, title: quiz === 1 ? 'Квиз недели ждёт ответа' : `${quiz} квиза ждут ответа`, text: '+3 зерна за верный ответ', go: { act: 'tab', v: 'games', to: '.quiz' } });

    // Адвент-календарь
    if (advent) {
      const a = advent.view(uid);
      if (a.active && !a.today.opened) out.push({ id: `advent-${day}`, kind: 'advent', icon: 'tree', push: true, title: `Окошко адвента № ${a.today.n}`, text: a.today.kind === 'open' ? 'Сегодня без задания — просто открой' : a.today.title, go: { act: 'tab', v: 'games', to: '.adv' } });
    }
    // Тайный Санта: записаться или вручить подарок
    if (santa) {
      for (const g of myGangs(uid)) {
        const s = santa.view(u, g);
        if (!s.visible) continue;
        if (s.regOpen && !s.joined) out.push({ id: `santa-join-${g.id}-${s.year}`, kind: 'santa', icon: 'gift', push: true, title: `Тайный Санта в «${g.name}»`, text: `Запись до ${ddmm(s.drawDay)}, ${s.count ? `уже ${s.count}` : 'пока никто — будь первым'}`, go: { act: 'gang-open', id: g.id, to: '.santa' } });
        if (s.status === 'drawn' && s.joined && !s.myGifted && s.target) out.push({ id: `santa-gift-${g.id}-${s.year}`, kind: 'santa', icon: 'gift', push: true, title: `Подарок для ${s.target.nick}`, text: day >= santa.remindDay(s.year) && day.slice(5, 7) === '12' ? 'До Нового года пара дней — ещё успеваешь. Вручишь — отметь в карточке' : 'Когда вручишь — отметь в карточке Санты', go: { act: 'gang-open', id: g.id, to: '.santa' } });
      }
    }
    // События банды: что поменялось или отменилось (сутки), на что не ответил, что у тебя сегодня-завтра.
    // Пуши о них уходят в момент события, поэтому в утреннюю сводку не попадают
    if (ctx.gevents) {
      const ev = ctx.gevents.pending(uid);
      for (const n of ev.notes) out.push({ id: `gev-note-${n.event_id}-${n.at}`, kind: n.kind === 'cancel' ? 'gev-cancel' : 'gev-edit', icon: n.kind === 'cancel' ? 'x' : 'cal', push: false,
        title: `${n.kind === 'cancel' ? 'Отменено' : 'Изменилось'}: ${n.title}`, text: `${n.gname} · ${n.text}`, go: { act: 'gang-open', id: n.gang_id, to: '.gevents' } });
      for (const x of ev.events) {
        const e = x.event;
        if (x.type === 'ask') out.push({ id: `gev-ask-${e.id}`, kind: 'gev', icon: 'cal', push: false, title: `${e.title} — идёшь?`, text: `${x.gname} · ${x.tail}`, go: { act: 'gang-open', id: x.gang || e.gang_id, to: '.gevents' } });
        else out.push({ id: `gev-soon-${e.id}-${e.day}`, kind: 'gev', icon: 'cal', push: false, title: `${x.tail.startsWith('сегодня') ? 'Сегодня' : 'Завтра'}: ${e.title}`, text: `${x.gname}${e.time ? ' · ' + e.time : ''}${e.place ? ' · ' + e.place : ''}${x.maybe ? ' · ты пока «может быть»' : ''}`, go: { act: 'gang-open', id: x.gang || e.gang_id, to: '.gevents' } });
      }
    }
    // Опросы банды без твоего голоса
    if (ctx.polls) {
      for (const g of myGangs(uid)) {
        const n = ctx.polls.unvoted(uid, g.id);
        if (n) out.push({ id: `polls-${g.id}-${n}`, kind: 'poll', icon: 'chart', push: false, title: n === 1 ? `Опрос в «${g.name}» ждёт твоего голоса` : `${n} опроса в «${g.name}» ждут твоего голоса`, go: { act: 'gang-open', id: g.id, to: '.polls' } });
      }
    }
    // Случайный кофе: договориться или ответить
    const p = features && features.myPair(uid);
    if (p) {
      if (p.canReply) out.push({ id: `coffee-reply-${p.id}`, kind: 'coffee', icon: 'coffee', push: false, title: `${p.partner.nick} зовёт на кофе`, text: p.ping.opt, go: { act: 'open', v: 'coffee' } });
      else if (!p.ping) out.push({ id: `coffee-${p.id}`, kind: 'coffee', icon: 'coffee', push: true, title: `Кофе с ${p.partner.nick}`, text: 'Пара на этой неделе. Предложи время', go: { act: 'open', v: 'coffee' } });
    }
    // Задания дня — в конце: они есть каждый день и сами по себе пуш не заслуживают
    const qs = features && features.questSummary(uid);
    if (qs && qs.left) out.push({ id: `quests-${day}`, kind: 'quests', icon: 'target', push: false, title: qs.left === qs.total ? `Задания дня: ${qs.total}` : `Заданий дня осталось: ${qs.left} из ${qs.total}`, text: '+3 зерна за каждое', go: { act: 'tab', v: 'games', to: '.quests' } });
    return out;
  }

  route('GET', '/api/inbox', async (req) => {
    const u = requireUser(req);
    return { items: items(u) };
  });

  // Утренняя сводка пушем
  function tick() {
    const now = U.msk(), h = now.hour + now.minute / 60, day = now.day;
    if (h < PUSH_FROM || h >= PUSH_TO || !weekdayName(day)) return;
    if (new Date(day + 'T12:00:00Z').getUTCDay() === 5) return; // в пятницу приходит сводка недели
    for (const r of q('SELECT DISTINCT user_id AS id FROM push_subs').all()) {
      const u = q('SELECT * FROM users WHERE id = ? AND nick IS NOT NULL').get(r.id);
      if (!u) continue;
      const sent = q('SELECT day FROM inbox_push WHERE user_id = ?').get(u.id);
      if (sent && sent.day === day) continue;
      q('INSERT INTO inbox_push (user_id, day) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET day = excluded.day').run(u.id, day);
      if (readProfile(u.profile).digest === false) continue;
      if (features && features.activeToday(u.id)) continue;
      const list = items({ ...u, look: JSON.parse(u.look || '{}') }).filter((x) => x.push);
      if (!list.length) continue;
      const body = list.slice(0, 2).map((x) => x.title).join(' · ') + (list.length > 2 ? ` и ещё ${list.length - 2}` : '');
      fireAndForget(notify([u.id], { title: 'Этаж: что ждёт сегодня', body, url: '/#inbox', tag: 'inbox-digest' }));
    }
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('inbox', e); } }, 5 * 60e3).unref();

  return { items, tick };
}

module.exports = { register };
