// Блиц: вопросы на время. 3 минуты — ответь на сколько успеешь.
// Вопросы приходят по одному, правильный ответ сервер открывает только после ответа — подсмотреть нельзя.
// Каждый проходит набор один раз; таблица лидеров — по числу верных, при равенстве — кто быстрее.
// Новый набор — добавь в SETS с датами (from включительно, to включительно). Активен самый свежий из идущих.

const SETS = [
  {
    id: 'excel1', title: 'Excel за 3 минуты', emoji: '📊', secs: 180, from: '2026-11-02', to: '2026-11-15',
    desc: 'Формулы, горячие клавиши и ошибки. Отвечай быстро: вопросов больше, чем успеешь.',
    questions: [
      ['Какая функция ищет значение в первом столбце таблицы и возвращает значение из указанного столбца той же строки?', ['ВПР', 'ГПР', 'ПОИСКПОЗ', 'ИНДЕКС']],
      ['Что означают знаки $ в ссылке $A$1?', ['Ссылка абсолютная — не сдвигается при копировании', 'Формат ячейки — валюта', 'Ячейка защищена от изменений', 'Ссылка на другой лист']],
      ['Какое сочетание клавиш вставляет в ячейку сегодняшнюю дату?', ['Ctrl + ;', 'Ctrl + Shift + ;', 'Ctrl + D', 'Alt + =']],
      ['Что делает Alt + = ?', ['Вставляет автосумму', 'Ставит знак равенства в формулу', 'Объединяет ячейки', 'Пересчитывает лист']],
      ['Что значит ошибка #ДЕЛ/0! ?', ['В формуле деление на ноль', 'Ссылка на удалённую ячейку', 'Значение не найдено', 'Число не помещается в ячейку']],
      ['ВПР вернула #Н/Д. Самая частая причина?', ['Искомое значение не найдено', 'В таблице больше 1000 строк', 'Ячейка защищена', 'Формула введена без $']],
      ['Какая функция считает все непустые ячейки — и с числами, и с текстом?', ['СЧЁТЗ', 'СЧЁТ', 'СУММ', 'СЧИТАТЬПУСТОТЫ']],
      ['Что вернёт =ЕСЛИОШИБКА(A1/B1; 0), если в B1 стоит 0?', ['0', '#ДЕЛ/0!', 'Пустую строку', 'Значение A1']],
      ['Как сделать, чтобы шапка таблицы не уезжала при прокрутке?', ['Вид → Закрепить области', 'Данные → Фильтр', 'Главная → Объединить ячейки', 'Рецензирование → Защитить лист']],
      ['Что делает Ctrl + Shift + L ?', ['Включает или выключает фильтр', 'Выделяет весь лист', 'Вставляет новую строку', 'Открывает «Найти и заменить»']],
      ['Какая функция в новых версиях Excel заменяет ВПР и умеет искать в любую сторону?', ['ПРОСМОТРX', 'ГПР', 'ВЫБОР', 'ДВССЫЛ']],
      ['Для чего нужна сводная таблица?', ['Сгруппировать и посчитать итоги по большим данным', 'Объединить несколько файлов в один', 'Защитить лист паролем', 'Нарисовать диаграмму Ганта']],
      ['Что считает =СУММЕСЛИ(A:A; "Москва"; B:B) ?', ['Сумму по столбцу B там, где в A написано «Москва»', 'Сколько раз в A встречается «Москва»', 'Сумму столбцов A и B', 'Среднее по B для «Москвы»']],
      ['Сколько строк на одном листе в современных версиях Excel?', ['1 048 576', '65 536', '1 000 000', '16 384']],
      ['Что делает F4, когда курсор стоит на ссылке в формуле?', ['Переключает тип ссылки: A1 → $A$1 → A$1 → $A1', 'Удаляет ссылку', 'Открывает справку', 'Пересчитывает формулу']],
      ['Как склеить A1 и B1 через пробел?', ['=A1&" "&B1', '=A1+" "+B1', '=СУММ(A1;B1)', '=A1;" ";B1']],
      ['Куда переводит Ctrl + стрелка вниз?', ['К последней заполненной ячейке подряд в столбце', 'На следующий лист', 'В конец файла', 'На одну строку вниз']],
      ['Как поменять местами строки и столбцы при вставке?', ['Специальная вставка → Транспонировать', 'Ctrl + T', 'Данные → Сортировка', 'Формат → Повернуть текст']],
      ['Что вернёт =ОКРУГЛ(2,567; 1) ?', ['2,6', '2,5', '3', '2,57']],
      ['Какой функцией убрать лишние пробелы в тексте?', ['СЖПРОБЕЛЫ', 'ПЕЧСИМВ', 'ЗАМЕНИТЬ', 'ПСТР']]
    ]
  }
];

const GRACE_MS = 3000;       // сеть и анимация — не повод проиграть
const MAX_BEANS = 10;        // по зерну за верный ответ, не больше 10 за набор
const LEADERS = 10;

function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function register(ctx) {
  const { db, q, route, requireUser, bad, U, addBeans, onEvent } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS blitz_runs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    set_id TEXT NOT NULL,
    started_at INTEGER NOT NULL, finished_at INTEGER,
    plan TEXT NOT NULL,          -- [{q, perm:[индексы вариантов в показанном порядке]}]
    pos INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0, beans INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, set_id)
  );
  `);

  const activeSet = () => {
    const d = U.msk().day;
    return SETS.filter((s) => s.from <= d && d <= s.to).sort((a, b) => (a.from < b.from ? 1 : -1))[0] || null;
  };
  const runOf = (uid, set) => q('SELECT * FROM blitz_runs WHERE user_id = ? AND set_id = ?').get(uid, set.id);
  const deadline = (run, set) => run.started_at + set.secs * 1000;

  function finish(run, set) {
    if (run.finished_at) return run;
    const at = Math.min(U.now(), deadline(run, set));
    const beans = addBeans(run.user_id, 'blitz', Math.min(run.score, MAX_BEANS) || 0) || 0;
    q('UPDATE blitz_runs SET finished_at = ?, beans = ? WHERE user_id = ? AND set_id = ?').run(at, beans, run.user_id, set.id);
    if (onEvent) onEvent('blitz', run.user_id, { score: run.score });
    return runOf(run.user_id, set);
  }

  function questionView(run, set) {
    const plan = JSON.parse(run.plan);
    const item = plan[run.pos];
    if (!item) return null;
    const [text, opts] = set.questions[item.q];
    return { n: run.pos + 1, total: plan.length, text, options: item.perm.map((i) => opts[i]) };
  }

  function leaderboard(set, uid) {
    const rows = q(`SELECT r.user_id, r.score, r.finished_at - r.started_at AS ms, u.nick FROM blitz_runs r JOIN users u ON u.id = r.user_id
      WHERE r.set_id = ? AND r.finished_at IS NOT NULL AND u.nick IS NOT NULL ORDER BY r.score DESC, ms ASC`).all(set.id);
    const place = rows.findIndex((r) => r.user_id === uid);
    return { top: rows.slice(0, LEADERS).map((r, i) => ({ place: i + 1, nick: r.nick, score: r.score, secs: Math.round(r.ms / 1000), me: r.user_id === uid })), place: place >= 0 ? place + 1 : null, players: rows.length };
  }

  function view(uid) {
    const set = activeSet();
    if (!set) return { set: null };
    let run = runOf(uid, set);
    if (run && !run.finished_at && U.now() > deadline(run, set) + GRACE_MS) run = finish(run, set);
    const base = { set: { id: set.id, title: set.title, emoji: set.emoji, desc: set.desc, secs: set.secs, count: set.questions.length, to: set.to, maxBeans: MAX_BEANS } };
    if (!run) return { ...base, state: 'new', board: leaderboard(set, uid) };
    if (!run.finished_at) return { ...base, state: 'play', leftMs: Math.max(0, deadline(run, set) - U.now()), score: run.score, question: questionView(run, set) };
    return { ...base, state: 'done', score: run.score, answered: run.pos, beans: run.beans, secs: Math.round((run.finished_at - run.started_at) / 1000), board: leaderboard(set, uid) };
  }

  route('GET', '/api/blitz', async (req) => view(requireUser(req).id));

  route('POST', '/api/blitz/start', async (req) => {
    const u = requireUser(req);
    const set = activeSet();
    if (!set) throw bad('Сейчас блица нет — загляни позже.');
    if (!runOf(u.id, set)) {
      const plan = shuffle(set.questions.map((_, i) => i)).map((qi) => ({ q: qi, perm: shuffle(set.questions[qi][1].map((_, i) => i)) }));
      q('INSERT OR IGNORE INTO blitz_runs (user_id, set_id, started_at, plan) VALUES (?, ?, ?, ?)').run(u.id, set.id, U.now(), JSON.stringify(plan));
    }
    return view(u.id);
  });

  route('POST', '/api/blitz/answer', async (req, body) => {
    const u = requireUser(req);
    const set = activeSet();
    if (!set) throw bad('Блиц уже закончился.');
    let run = runOf(u.id, set);
    if (!run) throw bad('Сначала нажми «Начать».');
    if (run.finished_at) return { ...view(u.id), late: true };
    if (U.now() > deadline(run, set) + GRACE_MS) { finish(run, set); return { ...view(u.id), late: true }; }
    const plan = JSON.parse(run.plan);
    const item = plan[run.pos];
    // Ответ на уже пройденный вопрос (двойное нажатие) — просто текущее состояние
    if (Number(body.n) !== run.pos + 1) return view(u.id);
    const pick = Number(body.pick);
    if (!Number.isInteger(pick) || pick < 0 || pick >= item.perm.length) throw bad('Выбери вариант.');
    const correct = item.perm[pick] === 0; // правильный ответ в наборе всегда записан первым
    const right = item.perm.indexOf(0);
    q('UPDATE blitz_runs SET pos = pos + 1, score = score + ? WHERE user_id = ? AND set_id = ?').run(correct ? 1 : 0, u.id, set.id);
    run = runOf(u.id, set);
    if (run.pos >= plan.length) finish(run, set);
    return { ...view(u.id), result: { correct, right } };
  });

  return { activeSet };
}

module.exports = { register, SETS };
