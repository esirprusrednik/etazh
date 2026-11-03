// Адвент-календарь: 1–31 декабря, каждый день — одно окошко с маленьким заданием.
// Открыть можно только сегодняшнее окошко; задание проверяется по тому, что человек уже сделал в приложении сегодня.
// В рабочие дни задания про офис и банду, в выходные и праздники — только лёгкие, без офиса.
// За окошко +2 зерна; за 20 окошек — ёлочная гирлянда для аватара.

const GOAL = 20;
const NY_LOOK = { hat: ['dedmoroz', 'kokoshnik', 'ushanka'], outfit: ['nysweater'], neck: ['garland'] };

// Факты для «окошек с сюрпризом» — проверенные, без спорных дат
const FACTS = [
  'По указу Петра I Новый год в России с 1700 года встречают 1 января, а дома велено было украшать еловыми и сосновыми ветвями.',
  'Старый Новый год — это 1 января по юлианскому календарю. Поэтому его встречают в ночь на 14 января.',
  'Салат «Оливье» назван по имени повара Люсьена Оливье, который держал ресторан «Эрмитаж» в Москве в XIX веке.',
  'Родиной Деда Мороза с конца 1990-х считается Великий Устюг, а терем Снегурочки находится в Костроме.',
  'Куранты на Спасской башне Кремля в полночь отбивают 12 ударов — под них принято загадывать желание.',
  '«Ирония судьбы, или С лёгким паром!» Эльдара Рязанова впервые показали по телевидению 1 января 1976 года.',
  'Мандарины родом из Восточной Азии. В советские годы к Новому году их везли в основном из Абхазии и Марокко.',
  'Главную новогоднюю ёлку страны ставят в Кремле, на Соборной площади.'
];

// Задания. check — как проверить по базе, что человек сделал это сегодня
const WORK = [
  { kind: 'checkin', title: 'Отметься', text: 'Отметься в офисе или поставь «из дома».' },
  { kind: 'call', title: 'Позови на кофе', text: 'Позови кого-нибудь на кофе — в банде или лично.' },
  { kind: 'gang_msg', title: 'Пару тёплых слов', text: 'Напиши банде что-нибудь хорошее.' },
  { kind: 'thanks', title: 'Спасибо', text: 'Скажи кому-нибудь спасибо — кнопкой «Спасибо» в банде.' },
  { kind: 'dm', title: 'Давно не виделись', text: 'Напиши лично коллеге, с которым давно не общался.' },
  { kind: 'duel', title: 'Дуэль', text: 'Сыграй дуэль — камень-ножницы-бумагу, кости или крестики-нолики.' },
  { kind: 'ny_look', title: 'Новогодний образ', text: 'Надень новогоднее: шапку Деда Мороза, кокошник, ушанку, новогодний свитер или гирлянду.' },
  { kind: 'meme', title: 'Открытка', text: 'Отправь кому-нибудь мем-открытку.' }
];
const REST = [
  { kind: 'open', title: 'Окошко с сюрпризом', text: '' },
  { kind: 'ny_look', title: 'Новогодний образ', text: 'Надень новогоднее: шапку Деда Мороза, кокошник, ушанку, новогодний свитер или гирлянду.' },
  { kind: 'meme', title: 'Открытка', text: 'Отправь кому-нибудь мем-открытку — можно праздничную.' },
  { kind: 'open', title: 'Окошко с сюрпризом', text: '' },
  { kind: 'duel', title: 'Дуэль', text: 'Сыграй дуэль с кем-нибудь — хоть из дома.' }
];

function register(ctx) {
  const { db, q, route, requireUser, bad, U, config, addBeans, workdayName, onEvent } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS advent (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  `);

  const isDecember = (day) => day.slice(5, 7) === '12';
  const dayStart = (day) => Date.parse(day + 'T00:00:00Z') - config.tzOffsetHours * 3600e3;
  function taskFor(day) {
    const n = Number(day.slice(8, 10));
    if (workdayName(day)) return { n, ...WORK[(n - 1) % WORK.length] };
    const t = REST[(n - 1) % REST.length];
    return { n, ...t, text: t.kind === 'open' ? FACTS[(n - 1) % FACTS.length] : t.text };
  }
  function doneToday(uid, kind, day) {
    const ds = dayStart(day);
    const one = (sql, ...a) => !!q(sql).get(...a);
    switch (kind) {
      case 'open': return true;
      case 'checkin': return one("SELECT 1 FROM ledger WHERE user_id = ? AND day = ? AND reason IN ('checkin', 'home')", uid, day)
        || one('SELECT 1 FROM checkins WHERE user_id = ? AND day = ?', uid, day);
      case 'gang_msg': return one("SELECT 1 FROM messages WHERE user_id = ? AND type = 'text' AND at >= ?", uid, ds);
      case 'call': return one("SELECT 1 FROM messages WHERE user_id = ? AND type = 'call' AND at >= ?", uid, ds) || one("SELECT 1 FROM dms WHERE from_id = ? AND type = 'call' AND at >= ?", uid, ds);
      case 'thanks': return one('SELECT 1 FROM thanks WHERE from_id = ? AND day = ?', uid, day);
      case 'dm': return one("SELECT 1 FROM dms WHERE from_id = ? AND type IN ('text', 'voice') AND at >= ?", uid, ds);
      case 'meme': return one("SELECT 1 FROM dms WHERE from_id = ? AND type = 'meme' AND at >= ?", uid, ds) || one("SELECT 1 FROM messages WHERE user_id = ? AND type = 'meme' AND at >= ?", uid, ds);
      case 'duel': return one('SELECT 1 FROM duels WHERE (a = ? OR b = ?) AND updated_at >= ?', uid, uid, ds);
      case 'ny_look': {
        const r = q('SELECT look FROM users WHERE id = ?').get(uid);
        const look = JSON.parse((r && r.look) || '{}');
        return Object.entries(NY_LOOK).some(([k, vals]) => vals.includes(look[k]));
      }
      default: return false;
    }
  }

  function view(uid) {
    const day = U.msk().day;
    if (!isDecember(day)) return { active: false };
    const y = day.slice(0, 4);
    const opened = new Set(q('SELECT day FROM advent WHERE user_id = ? AND day LIKE ?').all(uid, `${y}-12-%`).map((r) => r.day));
    const days = Array.from({ length: 31 }, (_, i) => {
      const d = `${y}-12-${String(i + 1).padStart(2, '0')}`;
      return { n: i + 1, day: d, state: opened.has(d) ? 'done' : d === day ? 'today' : d < day ? 'missed' : 'future', rest: !workdayName(d) };
    });
    const t = taskFor(day);
    const garland = !!q("SELECT 1 FROM owned WHERE user_id = ? AND item_id = 'p_garland'").get(uid);
    return { active: true, today: { ...t, day, opened: opened.has(day), ready: doneToday(uid, t.kind, day) }, days, count: opened.size, goal: GOAL, garland };
  }

  route('GET', '/api/advent', async (req) => view(requireUser(req).id));

  route('POST', '/api/advent/open', async (req) => {
    const u = requireUser(req);
    const day = U.msk().day;
    if (!isDecember(day)) throw bad('Адвент-календарь открыт только в декабре.');
    const t = taskFor(day);
    if (q('SELECT 1 FROM advent WHERE user_id = ? AND day = ?').get(u.id, day)) return { ...view(u.id), already: true };
    if (!doneToday(u.id, t.kind, day)) throw bad(`Сначала задание: ${t.text}`);
    q('INSERT INTO advent (user_id, day, at) VALUES (?, ?, ?)').run(u.id, day, U.now());
    const beans = addBeans(u.id, 'advent') || 0;
    const n = q('SELECT COUNT(*) AS n FROM advent WHERE user_id = ? AND day LIKE ?').get(u.id, `${day.slice(0, 4)}-12-%`).n;
    let prize = false;
    if (n >= GOAL && !q("SELECT 1 FROM owned WHERE user_id = ? AND item_id = 'p_garland'").get(u.id)) {
      q('INSERT OR IGNORE INTO owned (user_id, item_id, at) VALUES (?, ?, ?)').run(u.id, 'p_garland', U.now());
      prize = true;
    }
    if (onEvent) onEvent('advent', u.id);
    return { ...view(u.id), beans, prize };
  });

  // Отметки окошек нужны только до конца декабря: в новом году стираем прошлогодние (гирлянда остаётся)
  const sweep = () => { try { q('DELETE FROM advent WHERE day < ?').run(U.msk().day.slice(0, 4) + '-01-01'); } catch (e) { console.error('advent', e); } };
  sweep();
  setInterval(sweep, 6 * 3600e3).unref();

  return { view, taskFor };
}

module.exports = { register, GOAL };
