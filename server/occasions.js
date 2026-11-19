// Повод недели: общий инфоповод на день-два — релиз игры, чёрная пятница, первый день зимы.
// У повода одна карточка во вкладке «Рядом», один вопрос в один тап (ответ — он же шуточный статус: свои видят,
// кто что выбрал) и одна ачивка — тем, кто в этот день отметился в офисе. Ачивку видит только получивший:
// взять её задним числом нельзя, и дразнить остальных недостижимым незачем.
// Чужие названия, логотипы и персонажей не используем — только намёк словами.

const OCCASIONS = [
  { id: 'game6', from: '2026-11-19', to: '2026-11-20',
    title: 'Вышла та самая игра',
    text: 'Её ждали тринадцать лет, и сегодня полстраны внезапно «на созвоне». А ты?',
    options: [['work', 'Работаю, честно'], ['fake', '«Работаю»'], ['off', 'Взял отгул'], ['pc', 'Жду версию для ПК'], ['what', 'А что вышло?']],
    fem: { off: 'Взяла отгул' },
    ach: { tier: 'rare', name: 'Не заболел', fem: 'Не заболела', desc: 'Прийти в офис в дни выхода той самой игры' } },
  { id: 'blackfriday26', from: '2026-11-27', to: '2026-11-27',
    title: 'Чёрная пятница',
    text: 'Скидки до 90% на то, без чего ты прекрасно жил. Итог дня:',
    options: [['none', 'Ничего не купил'], ['need', 'Купил нужное'], ['junk', 'Купил ненужное'], ['cart', 'Корзина полна, жду зарплату'], ['sell', 'Сам продаю']],
    fem: { none: 'Ничего не купила', need: 'Купила нужное', junk: 'Купила ненужное', sell: 'Сама продаю' },
    ach: { tier: 'common', name: 'Устоял', fem: 'Устояла', desc: 'Прийти в офис в чёрную пятницу, а не в магазин' } },
  { id: 'winter26', from: '2026-12-01', to: '2026-12-01',
    title: 'Первый день зимы',
    text: 'По календарю — зима. По ощущениям?',
    options: [['love', 'Наконец-то'], ['dark', 'Темно в 16:00, я спать'], ['tires', 'Не переобулся'], ['mand', 'Мандарины уже купил'], ['may', 'Разбудите в мае']],
    fem: { tires: 'Не переобулась', mand: 'Мандарины уже купила' },
    ach: { tier: 'common', name: 'Зимовщик', fem: 'Зимовщица', desc: 'Прийти в офис в первый день зимы' } }
];
const achId = (o) => 'occ_' + o.id;
const active = (day) => OCCASIONS.find((o) => o.from <= day && day <= o.to) || null;

function register(ctx) {
  const { db, q, route, U, bad, requireUser, myGangs, gangMembers, canTalk } = ctx;
  db.exec('CREATE TABLE IF NOT EXISTS occasion_votes (occ TEXT NOT NULL, user_id INTEGER NOT NULL, opt TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (occ, user_id))');

  function view(u) {
    const o = active(U.msk().day);
    if (!o) return { occasion: null };
    const fem = U.fem(u.look);
    const label = (id) => (fem && o.fem && o.fem[id]) || (o.options.find((x) => x[0] === id) || [])[1] || '';
    const counts = Object.fromEntries(q('SELECT v.opt, COUNT(*) AS n FROM occasion_votes v JOIN users x ON x.id = v.user_id WHERE v.occ = ? AND x.company = ? GROUP BY v.opt').all(o.id, u.company || 'mts').map((r) => [r.opt, r.n]));
    const mine = (q('SELECT opt FROM occasion_votes WHERE occ = ? AND user_id = ?').get(o.id, u.id) || {}).opt || null;
    // Кто что выбрал — только свои: банда и подельники. Остальные — числом
    const seen = new Set([u.id]); const mates = [];
    for (const g of myGangs(u.id)) for (const m of gangMembers(g.id)) { if (!seen.has(m.id)) { seen.add(m.id); mates.push(m); } }
    const picks = mine ? q(`SELECT v.user_id AS id, v.opt, x.nick, x.look FROM occasion_votes v JOIN users x ON x.id = v.user_id WHERE v.occ = ? AND v.user_id != ?`).all(o.id, u.id)
      .filter((r) => seen.has(r.id) || (canTalk && canTalk(u.id, r.id)))
      .map((r) => ({ id: r.id, nick: r.nick, opt: r.opt, text: (U.fem(r.look) && o.fem && o.fem[r.opt]) || (o.options.find((x) => x[0] === r.opt) || [])[1] || '' })) : [];
    const got = !!q('SELECT 1 FROM achievements WHERE user_id = ? AND ach = ?').get(u.id, achId(o));
    return {
      occasion: {
        id: o.id, title: o.title, text: o.text, last: o.to === U.msk().day,
        options: o.options.map(([id]) => ({ id, label: label(id), n: mine ? counts[id] || 0 : null })),
        mine, total: mine ? Object.values(counts).reduce((s, n) => s + n, 0) : null, picks,
        ach: { name: (fem && o.ach.fem) || o.ach.name, desc: o.ach.desc, got }
      }
    };
  }

  route('GET', '/api/occasion', async (req) => view(requireUser(req)));
  route('POST', '/api/occasion/vote', async (req, body) => {
    const u = requireUser(req);
    const o = active(U.msk().day);
    if (!o || o.id !== String(body.id || '')) throw bad('Этот повод уже прошёл.');
    if (!o.options.some((x) => x[0] === body.opt)) throw bad('Выбери один из вариантов.');
    q('INSERT INTO occasion_votes (occ, user_id, opt, at) VALUES (?, ?, ?, ?) ON CONFLICT(occ, user_id) DO UPDATE SET opt = excluded.opt, at = excluded.at').run(o.id, u.id, body.opt, U.now());
    return view(u);
  });

  return { active };
}

module.exports = { register, OCCASIONS, achId, active };
