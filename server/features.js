// Функции второго этапа: метрики пилота, неделя банды, «Спасибо», ачивки и задания,
// случайный кофе, обед компанией, дни рождения, еженедельная сводка.
// Подключается из api.js через register(ctx) и получает оттуда общие помощники.
const crypto = require('node:crypto');

// Ачивки. cat — раздел в профиле; series — ступени одной ачивки (бронза → серебро → золото = common → rare → legendary);
// m/goal — счётчик и порог (по ним же считается прогресс); secret — описание скрыто, пока не получишь.
// id старых ачивок не меняем: они уже выданы людям.
const A = (cat, id, tier, name, desc, m, goal, extra = {}) => ({ cat, id, tier, name, desc, m, goal, ...extra });
// Женские варианты названий и описаний ачивок — по полу из профиля (аватар «Ж»)
const ACH_FEM = {
  first_msg: ['Голос подала'], quiz1: ['Угадала'], signals1: ['Зоркая'], canteen100: ['Своя на раздаче'], dm3: ['Своя в доску'],
  wave1: ['Своя'], wave10: ['Надёжная'], recruit5: ['Сколотила банду'], st_lone: ['Одинокая волчица', 'Выйти из банды и никуда не вступить'],
  duel_resign_lead: [null, 'Сдаться, когда сама ведёшь в счёте'], active30: ['Старожилка']
};
const achName = (a, fem) => (fem && ACH_FEM[a.id] && ACH_FEM[a.id][0]) || a.name;
const achDesc = (a, fem) => (fem && ACH_FEM[a.id] && ACH_FEM[a.id][1]) || a.desc;
const ACH = [
  // ---- Первые шаги ----
  A('first', 'first_checkin', 'common', 'Первый шаг', 'Отметиться в офисе', 'checkins', 1),
  A('first', 'gang', 'common', 'В банде', 'Вступить в банду или создать свою', 'gangs', 1),
  A('first', 'first_msg', 'common', 'Голос подал', 'Написать в чат банды', 'msgs', 1),
  A('first', 'first_call', 'common', 'Кто со мной?', 'Позвать банду или кого-то лично — на кофе, обед, совещание', 'calls', 1),
  A('first', 'reply', 'common', 'На связи', 'Ответить на зов', 'replies', 1),
  A('first', 'first_dm', 'common', 'Лично в руки', 'Написать кому-то в личку', 'dms', 1),
  A('first', 'thanks_give', 'common', 'Вежливость', 'Сказать спасибо кому-то из банды', 'thanks_given', 1),
  A('first', 'first_meme', 'common', 'Мемолог', 'Отправить мем-открытку', 'memes', 1),
  A('first', 'first_lunch', 'common', 'Обед по расписанию', 'Собрать обед компанией или присоединиться', 'lunches', 1),
  A('first', 'first_food', 'common', 'Ресторанный критик', 'Оценить обед в столовой', 'food', 1),
  A('first', 'first_signal', 'common', 'Сигнальщик', 'Отправить сигнал офиса', 'signals_sent', 1),
  A('first', 'first_look', 'common', 'Стилист', 'Собрать свой аватар в конструкторе', 'looks', 1),
  A('first', 'first_battle', 'common', 'Свистать всех наверх', 'Вызвать кого-то на морской бой', 'battles', 1),
  A('first', 'first_poll', 'common', 'Демократия', 'Запустить опрос в банде', 'polls', 1),
  A('first', 'first_blitz', 'common', 'Скорострел', 'Пройти блиц на время', 'blitz', 1),
  A('first', 'quiz_first', 'common', 'Первый квиз', 'Ответить на квиз недели', 'quiz_any', 1),
  A('first', 'profile_full', 'rare', 'Открытая книга', 'Заполнить профиль на 100%', 'profile', 100),

  // ---- Ступени: повторяющиеся действия ----
  A('grow', 'checkin_10', 'common', 'Офисный житель', '10 отметок в офисе', 'checkins', 10, { series: 'checkins' }),
  A('grow', 'checkin_50', 'rare', 'Офисный житель II', '50 отметок в офисе', 'checkins', 50, { series: 'checkins' }),
  A('grow', 'checkin_150', 'legendary', 'Офисный житель III', '150 отметок в офисе', 'checkins', 150, { series: 'checkins' }),
  A('grow', 'streak3', 'common', 'Разгон', '3 рабочих дня подряд в офисе', 'streak', 3, { series: 'streak' }),
  A('grow', 'streak5', 'rare', 'Пятидневка', '5 рабочих дней подряд в офисе', 'streak', 5, { series: 'streak' }),
  A('grow', 'streak20', 'legendary', 'Железная воля', '20 рабочих дней подряд в офисе', 'streak', 20, { series: 'streak' }),
  A('grow', 'canteen5', 'common', 'Завсегдатай', '5 раз отметиться в столовой', 'canteen', 5, { series: 'canteen' }),
  A('grow', 'canteen25', 'rare', 'Завсегдатай II', '25 раз в столовой', 'canteen', 25, { series: 'canteen' }),
  A('grow', 'canteen100', 'legendary', 'Свой на раздаче', '100 раз в столовой', 'canteen', 100, { series: 'canteen' }),
  A('grow', 'calls5', 'common', 'Заводила', '5 зовов', 'calls', 5, { series: 'calls' }),
  A('grow', 'calls25', 'rare', 'Заводила II', '25 зовов', 'calls', 25, { series: 'calls' }),
  A('grow', 'calls100', 'legendary', 'Главный по движу', '100 зовов', 'calls', 100, { series: 'calls' }),
  A('grow', 'replies10', 'common', 'Отзывчивый', 'Ответить на 10 зовов', 'replies', 10, { series: 'replies' }),
  A('grow', 'replies50', 'rare', 'Отзывчивый II', 'Ответить на 50 зовов', 'replies', 50, { series: 'replies' }),
  A('grow', 'replies200', 'legendary', 'Всегда на проводе', 'Ответить на 200 зовов', 'replies', 200, { series: 'replies' }),
  A('grow', 'sea_first', 'common', 'Юнга', 'Выиграть морской бой', 'sea_wins', 1, { series: 'sea' }),
  A('grow', 'sea_10', 'rare', 'Капитан', '10 побед в морском бою', 'sea_wins', 10, { series: 'sea' }),
  A('grow', 'sea_30', 'legendary', 'Адмирал', '30 побед в морском бою', 'sea_wins', 30, { series: 'sea' }),
  A('grow', 'guess3', 'common', 'Наблюдательный', '3 раза угадать, кто из наших', 'guess_ok', 3, { series: 'guess' }),
  A('grow', 'guess10', 'rare', 'Знаток банды', '10 раз угадать, кто из наших', 'guess_ok', 10, { series: 'guess' }),
  A('grow', 'guess50', 'legendary', 'Ходячее досье', '50 раз угадать, кто из наших', 'guess_ok', 50, { series: 'guess' }),
  A('grow', 'quiz1', 'common', 'Угадал', 'Верно ответить на квиз недели', 'quiz_ok', 1, { series: 'quiz' }),
  A('grow', 'quiz5', 'rare', 'Эрудит', '5 верных ответов в квизах недели', 'quiz_ok', 5, { series: 'quiz' }),
  A('grow', 'quiz15', 'legendary', 'Профессор', '15 верных ответов в квизах недели', 'quiz_ok', 15, { series: 'quiz' }),
  A('grow', 'signals1', 'common', 'Зоркий', '1 подтверждённый сигнал', 'signals', 1, { series: 'signals' }),
  A('grow', 'signals5', 'rare', 'Глаза офиса', '5 подтверждённых сигналов', 'signals', 5, { series: 'signals' }),
  A('grow', 'signals20', 'legendary', 'Всевидящее око', '20 подтверждённых сигналов', 'signals', 20, { series: 'signals' }),
  A('grow', 'two_offices', 'rare', 'Путешественник', 'Побывать в двух офисах', 'offices', 2, { series: 'offices' }),
  A('grow', 'all_offices', 'legendary', 'Все этажи', 'Побывать во всех трёх офисах', 'offices', 3, { series: 'offices' }),
  A('grow', 'votes5', 'common', 'Избиратель', 'Проголосовать в 5 опросах банды', 'poll_votes', 5, { series: 'votes' }),
  A('grow', 'votes25', 'rare', 'Избиратель II', 'Проголосовать 25 раз', 'poll_votes', 25, { series: 'votes' }),
  A('grow', 'votes100', 'legendary', 'Голос народа', 'Проголосовать 100 раз', 'poll_votes', 100, { series: 'votes' }),
  A('grow', 'blitz_10', 'rare', 'Быстрый ум', '10 верных ответов в одном блице', 'blitz_best', 10, { series: 'blitz' }),
  A('grow', 'blitz_15', 'legendary', 'Гуру', '15 верных ответов в одном блице', 'blitz_best', 15, { series: 'blitz' }),
  A('grow', 'sea_clean', 'rare', 'Ни царапины', 'Победить, не потеряв ни одного корабля', 'sea_clean', 1),

  // ---- Каждый день ----
  A('daily', 'day3', 'common', 'Заглядываю', 'Заходить 3 рабочих дня подряд', 'day_streak', 3, { series: 'days' }),
  A('daily', 'day10', 'rare', 'Привычка', 'Заходить 10 рабочих дней подряд', 'day_streak', 10, { series: 'days' }),
  A('daily', 'day30', 'legendary', 'Месяц с Этажом', 'Заходить 30 рабочих дней подряд', 'day_streak', 30, { series: 'days' }),
  A('daily', 'active30', 'rare', 'Старожил', '30 дней в приложении', 'active_days', 30, { series: 'active' }),
  A('daily', 'active100', 'legendary', 'Часть интерьера', '100 дней в приложении', 'active_days', 100, { series: 'active' }),
  A('daily', 'quests1', 'common', 'Отличник', 'Выполнить все задания дня', 'quest_all', 1, { series: 'quests' }),
  A('daily', 'quests10', 'rare', 'Отличник II', 'Все задания дня — 10 раз', 'quest_all', 10, { series: 'quests' }),
  A('daily', 'quests30', 'legendary', 'Круглый отличник', 'Все задания дня — 30 раз', 'quest_all', 30, { series: 'quests' }),
  A('daily', 'early5', 'rare', 'Ранняя пташка', '5 раз отметиться в офисе до 9:00', 'early', 5),

  // ---- Коммуникабельность ----
  A('social', 'dm3', 'common', 'Свой человек', 'Переписываться лично с тремя людьми', 'dm_people', 3, { series: 'dm_people' }),
  A('social', 'dm10', 'rare', 'Нетворкер', 'Переписываться лично с десятью людьми', 'dm_people', 10, { series: 'dm_people' }),
  A('social', 'dm50', 'rare', 'Почтмейстер', 'Отправить 50 голубей — личных сообщений', 'dms', 50),
  A('social', 'santa1', 'rare', 'Тайный Санта', 'Вручить подарок подопечному в Тайном Санте банды', 'santa', 1),
  A('social', 'advent10', 'common', 'В предвкушении', 'Открыть 10 окошек адвент-календаря', 'advent', 10),
  A('social', 'advent31', 'legendary', 'Ни дня без чуда', 'Открыть все 31 окошко адвент-календаря', 'advent', 31),
  A('social', 'msgs10', 'common', 'Разговорчивый', '10 сообщений в чатах банд', 'msgs', 10, { series: 'msgs' }),
  A('social', 'msgs50', 'rare', 'Душа чата', '50 сообщений в чатах банд', 'msgs', 50, { series: 'msgs' }),
  A('social', 'msgs200', 'legendary', 'Язык без костей', '200 сообщений в чатах банд', 'msgs', 200, { series: 'msgs' }),
  A('social', 'thanks3', 'common', 'Приятно', 'Получить 3 спасибо', 'thanks_got', 3, { series: 'thanks' }),
  A('social', 'thanks10', 'rare', 'Душа банды', 'Получить 10 спасибо', 'thanks_got', 10, { series: 'thanks' }),
  A('social', 'thanks50', 'legendary', 'Легенда банды', 'Получить 50 спасибо', 'thanks_got', 50, { series: 'thanks' }),
  A('daily', 'todo1', 'common', 'Чистый день', 'Закрыть все дела дня', 'todo_clean', 1, { series: 'todo' }),
  A('daily', 'todo10', 'rare', 'Без хвостов', '10 чистых дней', 'todo_clean', 10, { series: 'todo' }),
  A('daily', 'todo30', 'epic', 'Человек-план', '30 чистых дней', 'todo_clean', 30, { series: 'todo' }),
  A('social', 'wave1', 'common', 'Свой', 'Встать в волну банды', 'waves', 1, { series: 'waves' }),
  A('social', 'wave10', 'rare', 'Надёжный', 'Встать в 10 волн', 'waves', 10, { series: 'waves' }),
  A('social', 'wave_full', 'legendary', 'Капитан', 'Запустить волну, в которую встала вся банда', 'wave_full', 1),
  A('social', 'thanks_people5', 'rare', 'Щедрая душа', 'Сказать спасибо пятерым разным людям', 'thanks_people', 5),
  A('social', 'gangs3', 'rare', 'Многостаночник', 'Состоять в трёх бандах', 'gangs', 3),
  A('social', 'recruit1', 'common', 'Вербовщик', 'Позвать человека в банду — и он вступил', 'recruits', 1, { series: 'recruits' }),
  A('social', 'recruit5', 'rare', 'Сколотил банду', '5 человек вступили по твоему приглашению', 'recruits', 5, { series: 'recruits' }),
  A('social', 'coffee', 'rare', 'Новые лица', 'Договориться о случайном кофе', 'coffee', 1, { series: 'coffee' }),
  A('social', 'coffee5', 'legendary', 'Кофейный дипломат', '5 раз договориться о случайном кофе', 'coffee', 5, { series: 'coffee' }),
  A('social', 'sea_rivals', 'rare', 'Гроза морей', 'Обыграть 5 разных соперников', 'sea_rivals', 5),
  A('social', 'big_lunch', 'rare', 'Застольный', 'Собрать обед, к которому присоединились трое', 'big_lunch', 1),

  // ---- Скрытность: секретные и шуточные ----
  A('stealth', 'st_hide', 'common', 'Агент 007', 'Скрыть от банды, где ты работаешь', 'st_hide', 1, { secret: true }),
  A('stealth', 'st_unfindable', 'common', 'Партизан', 'Выключить поиск по себе', 'st_unfindable', 1, { secret: true }),
  A('stealth', 'st_incognito', 'common', 'Инкогнито', 'Закрыть личку от всех', 'st_incognito', 1, { secret: true }),
  A('stealth', 'st_night', 'common', 'Полуночник', 'Заглянуть в Этаж между полуночью и пятью утра', 'st_night', 1, { secret: true }),
  A('stealth', 'st_ghost', 'rare', 'Призрак офиса', 'Отметиться в офисе и уйти меньше чем через час', 'st_ghost', 1, { secret: true }),
  A('stealth', 'st_slack', 'rare', 'Чистосердечное', 'Трижды честно признаться, что отлыниваешь', 'st_slack', 3, { secret: true }),
  A('stealth', 'st_lurker', 'rare', 'Читаю молча', 'Заходить 10 дней — и не написать ни слова', 'lurker', 1, { secret: true }),
  A('stealth', 'st_lone', 'common', 'Одинокий волк', 'Выйти из банды и никуда не вступить', 'st_lone', 1, { secret: true }),
  A('stealth', 'st_master', 'legendary', 'Мастер маскировки', 'Собрать все остальные секретные ачивки', 'st_all', 6, { secret: true }),

  // ---- Дуэли ----
  A('duels', 'duel_start', 'common', 'Перчатка брошена', 'Вызвать кого-нибудь на дуэль', 'duels_started', 1),
  A('duels', 'duel_win1', 'common', 'Первая кровь', 'Выиграть дуэль', 'duel_wins', 1, { series: 'duel_wins' }),
  A('duels', 'duel_win10', 'rare', 'Дуэлянт', '10 побед в дуэлях', 'duel_wins', 10, { series: 'duel_wins' }),
  A('duels', 'duel_win50', 'legendary', 'Мушкетёр', '50 побед в дуэлях', 'duel_wins', 50, { series: 'duel_wins' }),
  A('duels', 'duel_rps5', 'rare', 'Камень-Ножницы-Мастер', '5 побед в камень-ножницы-бумагу', 'duel_wins_rps', 5),
  A('duels', 'duel_dice5', 'rare', 'Любимчик фортуны', '5 побед в кости', 'duel_wins_dice', 5),
  A('duels', 'duel_ttt5', 'rare', 'Гроссмейстер клеточек', '5 побед в крестики-нолики', 'duel_wins_ttt', 5),
  A('duels', 'duel_rivals5', 'rare', 'Гроза кабинетов', 'Обыграть пятерых разных людей', 'duel_rivals', 5),
  A('duels', 'duel_streak3', 'rare', 'На кураже', 'Выиграть 3 дуэли подряд', 'duel_streak_best', 3, { series: 'duel_streak' }),
  A('duels', 'duel_streak7', 'legendary', 'Неудержимый', 'Выиграть 7 дуэлей подряд', 'duel_streak_best', 7, { series: 'duel_streak' }),
  A('duels', 'duel_pot', 'common', 'Банк сорван', 'Выиграть дуэль на ставку', 'duel_pots', 1),
  A('duels', 'duel_comeback', 'rare', 'Камбэк', 'Проигрывать 0:1 и всё равно выиграть', 'duel_comeback', 1),
  A('duels', 'duel_sixes', 'common', 'Две шестёрки', 'Выбросить 6 и 6 в кости', 'duel_sixes', 1),
  A('duels', 'duel_ttt_draw', 'common', 'Боевая ничья', 'Сыграть вничью в крестики-нолики', 'duel_ttt_draw', 1),
  // смешные — за поражения и сдачу
  A('duels', 'duel_resign1', 'common', 'Белый флаг', 'Сдаться в дуэли. Бывает', 'duel_resign', 1, { secret: true, series: 'duel_resign' }),
  A('duels', 'duel_resign5', 'rare', 'Тактическое отступление', 'Сдаться 5 раз. Это не бегство, это манёвр', 'duel_resign', 5, { secret: true, series: 'duel_resign' }),
  A('duels', 'duel_resign15', 'legendary', 'Пацифист', 'Сдаться 15 раз. Ты за мир во всём мире', 'duel_resign', 15, { secret: true, series: 'duel_resign' }),
  A('duels', 'duel_resign_lead', 'rare', 'Странный выбор', 'Сдаться, когда сам ведёшь в счёте', 'duel_resign_lead', 1, { secret: true }),
  A('duels', 'duel_declined', 'common', 'Не сегодня', 'Отказаться от дуэли, не сделав ни хода', 'duel_declined', 1, { secret: true }),
  A('duels', 'duel_lost3', 'common', 'Не мой день', 'Проиграть 3 дуэли подряд', 'duel_lost3', 1, { secret: true }),
  A('duels', 'duel_snake', 'common', 'Змеиные глаза', 'Выбросить 1 и 1 в кости', 'duel_snake', 1, { secret: true })
];
const ACH_CATS = [['first', 'Первые шаги'], ['grow', 'Ступени'], ['daily', 'Каждый день'], ['social', 'Душа компании'], ['stealth', 'Скрытность'], ['duels', 'Дуэли']];
const ACH_REWARD = { common: 5, rare: 15, legendary: 40 };

// Задания дня. Будни: «Отметься» плюс три из пула — только те, что можно выполнить прямо сейчас за полминуты.
// Выходные: «задания отдыхают» — никого из коллег не дёргаем, только два необязательных одиночных задания «для удовольствия».
// Набор фиксируется на день при первом показе, чтобы задания не менялись под руками.
// go — куда ведёт плитка задания в приложении; to — к какому блоку прокрутить.
const QUESTS = [
  { id: 'where', name: 'Отметься: в офисе или «из дома»', go: 'near' },
  { id: 'join', name: 'Вступи в банду или сколоти свою', go: 'chats' },
  { id: 'call', name: 'Кинь зов банде: кофе, обед или созвон', go: 'gang', need: 'gang2' },
  { id: 'thanks', name: 'Скажи кому-нибудь спасибо — хоть коллеге не из банды', go: 'gang', need: 'gang2' },
  { id: 'dmnew', name: 'Напиши в личку тому, с кем ещё не общался', go: 'dmnew', need: 'fresh' },
  { id: 'todo', name: 'Закрой дело дня', go: 'near', to: '.todos', need: 'todo' },
  { id: 'friday', name: 'Ответь в пятиминутке банды', go: 'gang', to: '.friday', need: 'friday' },
  { id: 'wave', name: 'Встань в волну — банда ждёт', go: 'gang', to: '.wave', need: 'wave' },
  { id: 'vote', name: 'Проголосуй в опросе банды', go: 'gang', to: '.polls', need: 'poll' },
  { id: 'sea', name: 'Сделай ход в морском бою — твой ход', go: 'games', need: 'seaTurn' },
  { id: 'chat', name: 'Напиши в чат банды', go: 'gang', need: 'gang2' },
  { id: 'guess', name: 'Сыграй в «Кто из наших?»', go: 'games', need: 'gang4' },
  { id: 'quiz', name: 'Ответь на квиз недели', go: 'games', need: 'quiz' },
  // Выходные: одиночные и необязательные
  { id: 'blitz', name: 'Пройди блиц недели', go: 'games', to: '.blitz', need: 'blitz', weekend: true },
  { id: 'battery', name: 'Проверь батарейку недели', go: 'battery', need: 'battery', weekend: true },
  { id: 'wquiz', name: 'Ответь на квиз недели', go: 'games', to: '.quiz', need: 'quiz', weekend: true },
  { id: 'wguess', name: 'Сыграй в «Кто из наших?»', go: 'games', to: '.guess', need: 'gang4', weekend: true },
  { id: 'look', name: 'Обнови образ в конструкторе', go: 'look', weekend: true }
];
const QUESTS_ON = false;
const QUEST_POOL_PICK = 3;
const WEEKEND_PICK = 2;
// Самые полезные — первыми: если доступны, попадают в набор раньше случайных
const QUEST_PRIORITY = ['wave', 'friday', 'todo', 'dmnew', 'vote', 'sea'];
// Бонусные задания: появляются днём, когда становятся возможны, и не влияют на награду «за все»
const BONUS_QUESTS = [
  { id: 'food', name: 'Оцени обед в столовой', go: 'office' },
  { id: 'bday', name: 'Поздравь именинника: подарок, спасибо или личка', go: 'near' }
];
const QUEST_REWARD = 3;
const QUEST_ALL_BONUS = 5;
const THANKS_PER_DAY = 3;
const GIFT_BEANS = 10;
const COFFEE_OPTS = ['Сегодня в 11:00', 'Сегодня в 15:00', 'Завтра в 11:00', 'Завтра в 15:00'];
const COFFEE_REPLIES = ['Иду', 'Давай в другое время', 'Не смогу'];
const LUNCH_TIMES = ['11:30', '11:45', '12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30', '13:45', '14:00', '14:15', '14:30'];
const HOL = require('./holidays');
const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
// Оценка обеда: «понравилось / нет» и быстрые метки. Коллеги видят только сводку, комментарий — только модератор
const FOOD_TAGS_UP = ['Вкусно', 'Горячее', 'Большие порции', 'Хороший выбор', 'Быстро обслужили'];
const FOOD_TAGS_DOWN = ['Остыло', 'Пересолено', 'Мало выбора', 'Долго ждать', 'Дорого'];

function migrate(db) {
  db.exec(`
  -- Оценки обеда. Связь с человеком нужна только чтобы оценить один раз в день; на следующий день она стирается
  CREATE TABLE IF NOT EXISTS canteen_rates (
    id INTEGER PRIMARY KEY, day TEXT NOT NULL, office_id TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    up INTEGER NOT NULL, tags TEXT NOT NULL DEFAULT '[]', comment TEXT, at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS canteen_rates_once ON canteen_rates(day, office_id, user_id);
  -- Метрики пилота: только обезличенные агрегаты
  CREATE TABLE IF NOT EXISTS activity (day TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (day, uid));
  CREATE TABLE IF NOT EXISTS stats (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key));

  CREATE TABLE IF NOT EXISTS thanks (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    from_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT, day TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS thanks_gang_at ON thanks(gang_id, at);

  CREATE TABLE IF NOT EXISTS achievements (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ach TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, ach));
  CREATE TABLE IF NOT EXISTS ach_pairs (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, other_id INTEGER NOT NULL, PRIMARY KEY (user_id, kind, other_id));
  CREATE TABLE IF NOT EXISTS counters (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, key));
  -- Только набор офисов, где человек бывал, без дат
  CREATE TABLE IF NOT EXISTS user_offices (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, office_id TEXT NOT NULL, PRIMARY KEY (user_id, office_id));
  CREATE TABLE IF NOT EXISTS quest_target (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, swaps INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
  CREATE TABLE IF NOT EXISTS quest_days (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, list TEXT NOT NULL, PRIMARY KEY (user_id, day));
  CREATE TABLE IF NOT EXISTS quests_done (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, quest TEXT NOT NULL, PRIMARY KEY (user_id, day, quest));

  CREATE TABLE IF NOT EXISTS coffee_pairs (
    id INTEGER PRIMARY KEY, week TEXT NOT NULL, office_id TEXT,
    a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ping_by INTEGER, ping_opt TEXT, ping_at INTEGER, reply TEXT, reply_at INTEGER, at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lunches (
    id INTEGER PRIMARY KEY, office_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    time TEXT NOT NULL, place TEXT, day TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lunch_joins (
    lunch_id INTEGER NOT NULL REFERENCES lunches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, PRIMARY KEY (lunch_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS gifts (from_id INTEGER NOT NULL, to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (from_id, to_id, day));
  `);
  // Спасибо теперь можно сказать любому коллеге, не только из своей банды: gang_id становится необязательным (разовая перестройка таблицы)
  if ((db.prepare('PRAGMA table_info(thanks)').all().find((c) => c.name === 'gang_id') || {}).notnull) {
    db.exec(`BEGIN;
      CREATE TABLE thanks_new (
        id INTEGER PRIMARY KEY,
        gang_id INTEGER REFERENCES gangs(id) ON DELETE CASCADE,
        from_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT, day TEXT NOT NULL, at INTEGER NOT NULL
      );
      INSERT INTO thanks_new SELECT id, gang_id, from_id, to_id, text, day, at FROM thanks;
      DROP TABLE thanks;
      ALTER TABLE thanks_new RENAME TO thanks;
      CREATE INDEX IF NOT EXISTS thanks_gang_at ON thanks(gang_id, at);
      COMMIT;`);
  }

}

function register(ctx) {
  const { db, q, route, requireUser, requireAdmin, bad, U, config, addBeans, spendBeans, notify, fireAndForget,
    isMember, gangMembers, myGangs, activeCheckin, readProfile, presenceOf, fullName, weekdayName, addDays, pushEvent, officeById, profilePct, publicLook } = ctx;
  migrate(db);

  const meta = {
    get: (k) => (q('SELECT value FROM meta WHERE key = ?').get(k) || {}).value,
    set: (k, v) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
  };
  const today = () => U.msk().day;

  // Разовая компенсация: «Салага» подешевел с 50 до 30 — купившим возвращаем разницу
  if (!meta.get('refund_st_night_30')) {
    const buyers = q("SELECT user_id FROM owned WHERE item_id = 'st_night'").all();
    for (const b of buyers) addBeans(b.user_id, 'refund:st_night', 20);
    meta.set('refund_st_night_30', String(buyers.length));
    if (buyers.length) console.log(`[refund] «Салага»: вернули по 20 зёрен ${buyers.length} покупателям`);
  }
  const mondayOf = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const dayStartTs = (day) => Date.parse(day + 'T00:00:00Z') - config.tzOffsetHours * 3600e3;
  const ddmm = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
  const userRow = (id) => q('SELECT id, nick, look, profile, share_office FROM users WHERE id = ?').get(id);
  const lookOf = (row) => (publicLook ? publicLook(row) : JSON.parse(row.look || '{}'));

  // ---------- Метрики ----------
  const seenToday = new Set();
  function markActive(uid) {
    const key = today() + ':' + uid;
    if (seenToday.has(key)) return false;
    if (seenToday.size > 20000) seenToday.clear();
    seenToday.add(key);
    // Псевдоним вместо id: связь с аккаунтом не восстановить без секрета сервера
    const alias = crypto.createHmac('sha256', config.emailPepper).update('activity:' + uid).digest('hex').slice(0, 16);
    q('INSERT OR IGNORE INTO activity (day, uid) VALUES (?, ?)').run(today(), alias);
  }
  const stat = (key, n = 1) => q('INSERT INTO stats (day, key, n) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n').run(today(), key, n);
  const bump = (uid, key, n = 1) => q('INSERT INTO counters (user_id, key, n) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET n = n + excluded.n').run(uid, key, n);
  const counter = (uid, key) => (q('SELECT n FROM counters WHERE user_id = ? AND key = ?').get(uid, key) || { n: 0 }).n;

  // ---------- Серия и ачивки ----------
  function streakOf(uid) {
    const days = new Set(q("SELECT DISTINCT day FROM ledger WHERE user_id = ? AND reason = 'checkin' ORDER BY day DESC LIMIT 90").all(uid).map((r) => r.day));
    let streak = 0;
    let d = today();
    if (!days.has(d)) d = addDays(d, -1);
    for (let guard = 0; guard < 120; guard++, d = addDays(d, -1)) {
      if (!weekdayName(d)) continue;
      if (days.has(d)) streak++; else break;
    }
    return streak;
  }

  // Флаги «сделал хоть раз»: счётчик сразу 1, повторы не копятся
  const flag = (uid, key) => q('INSERT OR IGNORE INTO counters (user_id, key, n) VALUES (?, ?, 1)').run(uid, key).changes > 0;
  const setCounter = (uid, key, n) => q('INSERT INTO counters (user_id, key, n) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET n = excluded.n').run(uid, key, n);
  // Уникальные собеседники: храним только пары «кто — с кем — по какому поводу», без содержания
  const seenPair = (uid, kind, other) => q('INSERT OR IGNORE INTO ach_pairs (user_id, kind, other_id) VALUES (?, ?, ?)').run(uid, kind, other).changes > 0;

  const COUNTER_KEYS = ['checkins', 'replies', 'thanks_given', 'thanks_got', 'canteen', 'signals', 'coffee', 'guess_ok', 'quiz_ok', 'quiz_any',
    'sea_wins', 'sea_clean', 'sea_rivals', 'msgs', 'calls', 'dms', 'memes', 'santa', 'advent', 'lunches', 'food', 'looks', 'battles', 'signals_sent',
    'day_streak', 'active_days', 'quest_all', 'polls', 'poll_votes', 'blitz', 'blitz_best', 'early', 'dm_people', 'thanks_people', 'recruits', 'big_lunch',
    'st_hide', 'st_unfindable', 'st_incognito', 'st_night', 'st_ghost', 'st_slack', 'st_lone',
    'duels_started', 'duel_wins', 'duel_wins_rps', 'duel_wins_dice', 'duel_wins_ttt', 'duel_rivals', 'duel_streak_best', 'duel_pots', 'duel_comeback', 'duel_sixes', 'duel_snake',
    'duel_resign', 'duel_resign_lead', 'duel_declined', 'duel_lost3', 'duel_ttt_draw', 'waves', 'wave_full', 'todo_clean'];
  function countersOf(uid, u) {
    const c = Object.fromEntries(COUNTER_KEYS.map((k) => [k, 0]));
    for (const r of q('SELECT key, n FROM counters WHERE user_id = ?').all(uid)) if (r.key in c) c[r.key] = r.n;
    c.gangs = q('SELECT COUNT(*) AS n FROM gang_members WHERE user_id = ?').get(uid).n;
    c.offices = q('SELECT COUNT(*) AS n FROM user_offices WHERE user_id = ?').get(uid).n;
    c.streak = streakOf(uid);
    c.profile = profilePct ? profilePct(u) : 0;
    c.lurker = c.active_days >= 10 && !(c.msgs + c.dms + c.calls + c.memes + c.replies + c.thanks_given) ? 1 : 0;
    c.st_all = ['st_hide', 'st_unfindable', 'st_incognito', 'st_night', 'st_ghost'].filter((k) => c[k] >= 1).length + (c.st_slack >= 3 ? 1 : 0);
    return c;
  }

  function checkAchievements(uid) {
    const u = userRow(uid);
    if (!u || !u.nick) return [];
    const have = new Set(q('SELECT ach FROM achievements WHERE user_id = ?').all(uid).map((r) => r.ach));
    if (have.size >= ACH.length) return [];
    const c = countersOf(uid, u);
    const got = [];
    // «Читаю молча» — только пока человек молчит; «Мастер маскировки» считается после остальных секретных
    for (const a of ACH) {
      if (have.has(a.id) || (c[a.m] || 0) < a.goal) continue;
      q('INSERT OR IGNORE INTO achievements (user_id, ach, at) VALUES (?, ?, ?)').run(uid, a.id, U.now());
      addBeans(uid, 'ach', ACH_REWARD[a.tier]);
      // Секретные в общую ленту не попадают — на то они и секретные
      if (!a.secret) pushEvent(null, uid, `${u.nick} ${U.g(u.look, 'получил', 'получила')} ачивку «${achName(a, U.fem(u.look))}»`, 'ach');
      got.push(a.id);
    }
    return got;
  }

  // Дни в приложении: всего и подряд (по рабочим дням; выходные и праздники серию не рвут)
  function noteActiveDay(uid) {
    const t = today();
    const tn = Number(t.replace(/-/g, ''));
    const last = counter(uid, 'last_active');
    if (last >= tn) return false;
    setCounter(uid, 'last_active', tn);
    bump(uid, 'active_days');
    if (weekdayName(t)) {
      let prev = addDays(t, -1);
      for (let i = 0; i < 20 && !weekdayName(prev); i++) prev = addDays(prev, -1);
      const prevN = Number(prev.replace(/-/g, ''));
      setCounter(uid, 'day_streak', last >= prevN ? counter(uid, 'day_streak') + 1 : 1);
    }
    return true;
  }

  // Что сейчас доступно человеку — от этого зависит набор заданий
  const prov = {};
  function availability(uid) {
    const gangs = myGangs(uid);
    const sizes = gangs.map((g) => q('SELECT COUNT(*) AS n FROM gang_members WHERE gang_id = ?').get(g.id).n);
    const safe = (f) => { try { return !!f(); } catch { return false; } };
    return {
      gang: gangs.length > 0, gang2: sizes.some((n) => n >= 2), gang4: sizes.some((n) => n >= 4),
      quiz: safe(() => q('SELECT 1 FROM quizzes z WHERE z.closes_at > ? AND NOT EXISTS (SELECT 1 FROM quiz_answers a WHERE a.quiz_id = z.id AND a.user_id = ?)').get(U.now(), uid)),
      fresh: safe(() => freshPerson(uid)),
      todo: safe(() => prov.todos && prov.todos(uid) > 0),
      friday: safe(() => prov.friday && prov.friday(uid)),
      wave: safe(() => prov.wave && prov.wave(uid)),
      poll: safe(() => q(`SELECT 1 FROM polls p JOIN gang_members m ON m.gang_id = p.gang_id AND m.user_id = ? WHERE p.open = 1 AND p.closes_at > ? AND (p.user_id IS NULL OR p.user_id != ?)
        AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = p.id AND v.user_id = ?) LIMIT 1`).get(uid, U.now(), uid, uid)),
      seaTurn: safe(() => q("SELECT 1 FROM battles WHERE status = 'play' AND turn = ? LIMIT 1").get(uid)),
      blitz: safe(() => prov.blitz && prov.blitz(uid)),
      battery: safe(() => prov.battery && prov.battery(uid))
    };
  }
  // Свой человек из банды, с кем ещё не было ни лички, ни спасибо — для задания «Напиши в личку»
  function freshPerson(uid, skip = 0) {
    const known = new Set();
    try { for (const r of q('SELECT other_id FROM style_ties WHERE user_id = ?').all(uid)) known.add(r.other_id); } catch {}
    for (const r of q('SELECT from_id, to_id FROM thanks WHERE from_id = ? OR to_id = ?').all(uid, uid)) known.add(r.from_id === uid ? r.to_id : r.from_id);
    const out = [];
    for (const g of myGangs(uid)) for (const m of q('SELECT u.id, u.nick FROM gang_members gm JOIN users u ON u.id = gm.user_id WHERE gm.gang_id = ? ORDER BY gm.joined_at').all(g.id)) {
      if (m.id !== uid && !known.has(m.id) && !out.some((x) => x.id === m.id)) out.push(m);
    }
    return out.length ? out[skip % out.length] : null;
  }
  const isWeekend = (d) => !weekdayName(d);
  // Набор заданий на сегодня: создаётся один раз, дальше берётся из базы. Для «Напиши в личку» запоминаем человека
  function questsFor(uid) {
    if (!QUESTS_ON) return []; // задания дня выключены: вместо них — серия дней с растущей наградой за отметку
    const d = today();
    const row = q('SELECT list FROM quest_days WHERE user_id = ? AND day = ?').get(uid, d);
    const target = QUEST_POOL_PICK + 1;
    // Набор уже есть. Если в будни он неполный (утром ещё не было банды или дел) — добираем новыми, но ничего не убираем
    if (row) {
      const cur = JSON.parse(row.list);
      if (isWeekend(d) || cur.length >= target) return cur;
      const hasNow = availability(uid);
      const add = QUESTS.filter((x) => !x.weekend && x.need && hasNow[x.need] && !cur.includes(x.id)).map((x) => x.id);
      const prio = QUEST_PRIORITY.filter((id) => add.includes(id));
      for (const id of [...prio, ...add.filter((id) => !prio.includes(id))]) { if (cur.length >= target) break; cur.push(id); }
      q('UPDATE quest_days SET list = ? WHERE user_id = ? AND day = ?').run(JSON.stringify(cur), uid, d);
      if (cur.includes('dmnew') && !q('SELECT 1 FROM quest_target WHERE user_id = ? AND day = ?').get(uid, d)) { const p = freshPerson(uid); if (p) q('INSERT OR REPLACE INTO quest_target (user_id, day, target_id, swaps) VALUES (?, ?, ?, 0)').run(uid, d, p.id); }
      return cur;
    }
    const has = availability(uid);
    let seed = [...(uid + ':' + d)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 17);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const list = [];
    if (isWeekend(d)) {
      const pool = QUESTS.filter((x) => x.weekend && (!x.need || has[x.need])).map((x) => [rnd(), x.id]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      list.push(...pool.slice(0, WEEKEND_PICK));
    } else {
      list.push('where');
      if (!has.gang) list.push('join');
      const ok = QUESTS.filter((x) => !x.weekend && x.need && has[x.need]).map((x) => x.id);
      const first = QUEST_PRIORITY.filter((id) => ok.includes(id));
      const rest = ok.filter((id) => !first.includes(id)).map((id) => [rnd(), id]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      // Приоритетные не забивают весь набор: максимум два, остальное — случайное из пула
      for (const id of [...first.slice(0, 2), ...rest, ...first.slice(2)]) { if (list.length >= QUEST_POOL_PICK + 1) break; if (!list.includes(id)) list.push(id); }
    }
    q('INSERT OR IGNORE INTO quest_days (user_id, day, list) VALUES (?, ?, ?)').run(uid, d, JSON.stringify(list));
    if (list.includes('dmnew')) { const p = freshPerson(uid); if (p) q('INSERT OR REPLACE INTO quest_target (user_id, day, target_id, swaps) VALUES (?, ?, ?, 0)').run(uid, d, p.id); }
    return list;
  }
  const questTarget = (uid) => {
    const r = q('SELECT t.target_id, t.swaps, u.nick, u.look FROM quest_target t JOIN users u ON u.id = t.target_id WHERE t.user_id = ? AND t.day = ?').get(uid, today());
    return r ? { id: r.target_id, nick: r.nick, look: (() => { try { return JSON.parse(r.look || '{}'); } catch { return {}; } })(), canSwap: r.swaps < 1 } : null;
  };

  route('POST', '/api/quests/dmnew/swap', async (req) => {
    const u = requireUser(req);
    const t = questTarget(u.id);
    if (!t) throw bad('Такого задания сегодня нет.');
    if (!t.canSwap) throw bad('Поменять можно один раз в день.');
    const next = freshPerson(u.id, 1);
    if (!next || next.id === t.id) throw bad('Больше некого — в банде ты уже со всеми на связи, кроме этого человека.');
    q('UPDATE quest_target SET target_id = ?, swaps = swaps + 1 WHERE user_id = ? AND day = ?').run(next.id, u.id, today());
    return { ok: true };
  });

  // Именинники сегодня среди своих (кроме меня)
  function bdayIdsToday(uid) {
    const ids = new Set();
    for (const g of myGangs(uid)) for (const b of gangBirthdays(g.id, uid)) if (b.inDays === 0 && b.id !== uid) ids.add(b.id);
    return ids;
  }
  function bonusFor(uid) {
    const out = [];
    if (q('SELECT 1 FROM canteen WHERE user_id = ? AND at > ?').get(uid, dayStartTs(today()))) out.push('food');
    if (bdayIdsToday(uid).size) out.push('bday');
    return out;
  }

  function completeQuest(uid, quest) {
    if (BONUS_QUESTS.some((x) => x.id === quest)) {
      if (!bonusFor(uid).includes(quest)) return;
      if (q('INSERT OR IGNORE INTO quests_done (user_id, day, quest) VALUES (?, ?, ?)').run(uid, today(), quest).changes) addBeans(uid, 'quest', QUEST_REWARD);
      return;
    }
    const list = questsFor(uid);
    if (!list.includes(quest)) return;
    const r = q('INSERT OR IGNORE INTO quests_done (user_id, day, quest) VALUES (?, ?, ?)').run(uid, today(), quest);
    if (!r.changes) return;
    addBeans(uid, 'quest', QUEST_REWARD);
    const done = new Set(q('SELECT quest FROM quests_done WHERE user_id = ? AND day = ?').all(uid, today()).map((x) => x.quest));
    // Бонус «за все» — только в будни и один раз за день (набор может пополниться позже)
    if (!isWeekend(today()) && list.every((id) => done.has(id)) && q('INSERT OR IGNORE INTO quests_done (user_id, day, quest) VALUES (?, ?, ?)').run(uid, today(), '__all').changes) { addBeans(uid, 'quest_all', QUEST_ALL_BONUS); bump(uid, 'quest_all'); }
  }

  function onEvent(type, uid, data = {}) {
    try {
      if (type === 'active') {
        // Полуночник: первый же запрос ночью
        if (U.msk().hour < 5 && flag(uid, 'st_night')) checkAchievements(uid);
        if (markActive(uid) === false) return;
        if (noteActiveDay(uid)) checkAchievements(uid);
        return;
      }
      if (type === 'checkin') {
        if (U.msk().hour < 9) bump(uid, 'early');
        bump(uid, 'checkins'); stat('checkins'); completeQuest(uid, 'where');
        q('INSERT OR IGNORE INTO user_offices (user_id, office_id) VALUES (?, ?)').run(uid, data.office);
      }
      if (type === 'canteen') { bump(uid, 'canteen'); stat('canteen'); }
      if (type === 'reply') { bump(uid, 'replies'); stat('replies'); completeQuest(uid, 'reply'); }
      if (type === 'call') { stat('calls'); bump(uid, 'calls'); completeQuest(uid, 'call'); }
      if (type === 'text') { stat('messages'); bump(uid, 'msgs'); completeQuest(uid, 'chat'); }
      if ((type === 'dm' || type === 'meme') && data.to && bdayIdsToday(uid).has(data.to)) completeQuest(uid, 'bday');
      if (type === 'dm') { bump(uid, data.call ? 'calls' : 'dms'); if (seenPair(uid, 'dm', data.to)) bump(uid, 'dm_people'); completeQuest(uid, data.call ? 'call' : 'dm'); }
      if ((type === 'dm' || type === 'meme') && data.to) { const t = questTarget(uid); if (t && t.id === Number(data.to)) completeQuest(uid, 'dmnew'); }
      if (type === 'santa') bump(uid, 'santa');
      if (type === 'advent') bump(uid, 'advent');
      if (type === 'meme') { bump(uid, 'memes'); if (seenPair(uid, 'dm', data.to)) bump(uid, 'dm_people'); completeQuest(uid, 'meme'); }
      if (type === 'dm_reply') { bump(uid, 'replies'); completeQuest(uid, 'reply'); }
      if (type === 'home') completeQuest(uid, 'where');
      if (type === 'gang_join') completeQuest(uid, 'join');
      // Одинокий волк: вышел сам и остался без банды (переход в другую банду не считается)
      if (type === 'gang_leave' && !q('SELECT 1 FROM gang_members WHERE user_id = ?').get(uid)) flag(uid, 'st_lone');
      if (type === 'guess_any') { completeQuest(uid, 'guess'); completeQuest(uid, 'wguess'); }
      if (type === 'sea_shot') completeQuest(uid, 'sea');
      if (type === 'signal_sent') bump(uid, 'signals_sent');
      if (type === 'blitz') { bump(uid, 'blitz'); if ((data.score || 0) > counter(uid, 'blitz_best')) setCounter(uid, 'blitz_best', data.score); }
      if (type === 'poll') bump(uid, 'polls');
      if (type === 'poll_vote') { bump(uid, 'poll_votes'); completeQuest(uid, 'vote'); }
      if (type === 'battle_start') bump(uid, 'battles');
      if (type === 'recruit') bump(uid, 'recruits');
      if (type === 'wave_join') { bump(uid, 'waves'); completeQuest(uid, 'wave'); }
      if (type === 'todo_done') completeQuest(uid, 'todo');
      if (type === 'friday_answer') completeQuest(uid, 'friday');
      if (type === 'blitz') completeQuest(uid, 'blitz');
      if (type === 'battery') completeQuest(uid, 'battery');
      if (type === 'profile' && data.look) completeQuest(uid, 'look');
      if (type === 'wave_full') bump(uid, 'wave_full');
      if (type === 'todo_clean') bump(uid, 'todo_clean');
      if (type === 'checkout' && data.since && U.now() - data.since < 3600e3) flag(uid, 'st_ghost');
      if (type === 'profile') {
        const u = q('SELECT share_office, profile FROM users WHERE id = ?').get(uid);
        const p = readProfile(u.profile);
        if (!u.share_office) flag(uid, 'st_hide');
        if (p.findable === false) flag(uid, 'st_unfindable');
        if (p.dmFrom === 'none') flag(uid, 'st_incognito');
        if (data.look) flag(uid, 'looks');
        if (data.slack) bump(uid, 'st_slack');
      }
      if (type === 'signal_confirmed') { bump(uid, 'signals'); stat('signals_confirmed'); }
      if (type === 'signal') stat('signals');
      if (type === 'guess_ok') { bump(uid, 'guess_ok'); stat('guess_ok'); }
      if (type === 'quiz_ok') bump(uid, 'quiz_ok');
      if (type === 'quiz_any') { bump(uid, 'quiz_any'); stat('quiz_answers'); completeQuest(uid, 'quiz'); completeQuest(uid, 'wquiz'); }
      // Морской бой: в зачёт идут только победы потоплением всего флота — сдача соперника не считается
      if (type === 'duel') bump(uid, 'duels_started');
      if (type === 'duel_roll' && Array.isArray(data.dice)) {
        if (data.dice[0] === 6 && data.dice[1] === 6) flag(uid, 'duel_sixes');
        if (data.dice[0] === 1 && data.dice[1] === 1) flag(uid, 'duel_snake');
      }
      if (type === 'duel_end') {
        if (data.result === 'win') {
          bump(uid, 'duel_wins'); bump(uid, 'duel_wins_' + data.game);
          if (data.opp && seenPair(uid, 'duel', data.opp)) bump(uid, 'duel_rivals');
          const streak = counter(uid, 'duel_streak') + 1;
          setCounter(uid, 'duel_streak', streak); setCounter(uid, 'duel_lose_streak', 0);
          if (streak > counter(uid, 'duel_streak_best')) setCounter(uid, 'duel_streak_best', streak);
          if (data.stake) bump(uid, 'duel_pots');
          if (data.comeback) flag(uid, 'duel_comeback');
        } else if (data.result === 'lose') {
          setCounter(uid, 'duel_streak', 0);
          const ls = counter(uid, 'duel_lose_streak') + 1;
          setCounter(uid, 'duel_lose_streak', ls);
          if (ls >= 3) flag(uid, 'duel_lost3');
        } else if (data.game === 'ttt' && !data.aborted) flag(uid, 'duel_ttt_draw');
        if (data.resigned) bump(uid, 'duel_resign');
        if (data.lead) flag(uid, 'duel_resign_lead');
        if (data.declined) flag(uid, 'duel_declined');
      }
      if (type === 'sea_win') {
        bump(uid, 'sea_wins'); stat('sea_wins');
        if (data.clean) bump(uid, 'sea_clean');
        if (data.newRival) bump(uid, 'sea_rivals');
        addBeans(uid, 'sea_win');
      }
      checkAchievements(uid);
    } catch (e) {
      console.error('[features]', type, e.message);
    }
  }

  // ---------- Неделя банды ----------
  // Пять ближайших будней (праздничные тоже — их видно в календаре как выходные) плюс рабочие субботы
  function weekDays() {
    const out = [];
    let d = today();
    while (out.length < 5) {
      if (HOL.isWeekday(d) || HOL.isWorkSaturday(d)) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  function cellFor(prof, uid, day) {
    if (HOL.holidayName(day)) return 'off';
    const vac = prof.vacations.find((v) => v.from <= day && day <= v.to);
    if (vac) return 'vacation';
    if (day === today()) {
      const p = presenceOf(prof, activeCheckin(uid), uid).where;
      if (p === 'office') return 'office';
      if (p === 'home' || p === 'sick' || p === 'vacation') return p;
      if (p === 'plan_office') return 'office';
    }
    if (prof.today && prof.today.kind === 'sick' && prof.today.day <= day && day <= (prof.today.to || prof.today.day)) return 'sick';
    const plan = prof.plan[weekdayName(day)];
    return plan === 'office' ? 'office' : plan === 'home' ? 'home' : 'unknown';
  }

  // План недели заполнен: хотя бы один день отмечен «офис» или «дома»
  const planFilled = (prof) => Object.values(prof.plan || {}).some((v) => v === 'office' || v === 'home');
  // Взаимность: график банды видит только тот, кто сам заполнил свой план. Остальным — только своя строка
  // и подсказка, сколько бандитов уже заполнили и видят друг друга
  function gangWeek(gangId, meId) {
    const days = weekDays();
    const meRow = gangMembers(gangId).find((m) => m.id === meId);
    if (meRow && !planFilled(readProfile(meRow.profile))) {
      const all = gangMembers(gangId).filter((m) => m.id !== meId);
      const filled = all.filter((m) => planFilled(readProfile(m.profile))).length;
      return {
        locked: { filled, total: all.length },
        days: days.map((d) => ({ day: d, today: d === today(), label: `${DAY_NAMES[new Date(d + 'T00:00:00Z').getUTCDay()]} ${ddmm(d)}`, office: null, holiday: HOL.holidayName(d), short: HOL.isShort(d), workSat: HOL.isWorkSaturday(d) })),
        rows: [{ id: meId, nick: meRow.nick, me: true, look: lookOf(meRow), cells: days.map((d) => cellFor(readProfile(meRow.profile), meId, d)) }],
        best: null, hidden: 0
      };
    }
    const members = gangMembers(gangId).filter((m) => m.share_office || m.id === meId);
    const rows = members.map((m) => {
      const prof = readProfile(m.profile);
      return { id: m.id, nick: m.nick, me: m.id === meId, look: lookOf(m), cells: days.map((d) => cellFor(prof, m.id, d)) };
    });
    const cols = days.map((d, i) => ({
      day: d, today: d === today(),
      label: `${DAY_NAMES[new Date(d + 'T00:00:00Z').getUTCDay()]} ${ddmm(d)}`,
      office: rows.filter((r) => r.cells[i] === 'office').length,
      holiday: HOL.holidayName(d), short: HOL.isShort(d), workSat: HOL.isWorkSaturday(d)
    }));
    let best = null;
    // «Сегодня в офисе будут» имеет смысл, пока день не кончился: после 17:00 (в сокращённый день — после 16:00) сегодня не предлагаем
    const late = U.msk().hour >= (HOL.isShort(today()) ? 16 : 17);
    cols.forEach((c) => { if (!c.holiday && !(late && c.day === today()) && c.office >= 2 && (!best || c.office > best.office)) best = c; });
    return { days: cols, rows, best: best ? { label: best.label, office: best.office, total: rows.length, today: best.day === today() } : null, hidden: gangMembers(gangId).length - members.length };
  }

  // ---------- Дни рождения ----------
  function bdayInDays(bday) {
    if (!/^\d{2}\.\d{2}$/.test(bday || '')) return null;
    const t = today();
    const year = Number(t.slice(0, 4));
    for (const y of [year, year + 1]) {
      const d = `${y}-${bday.slice(3, 5)}-${bday.slice(0, 2)}`;
      if (isNaN(Date.parse(d))) return null;
      const diff = Math.round((Date.parse(d) - Date.parse(t)) / 864e5);
      if (diff >= 0) return diff;
    }
    return null;
  }

  function gangBirthdays(gangId, meId) {
    return gangMembers(gangId)
      .map((m) => ({ m, prof: readProfile(m.profile) }))
      .filter(({ prof }) => prof.showBday && prof.bday)
      .map(({ m, prof }) => ({ id: m.id, nick: m.nick, me: m.id === meId, look: lookOf(m), bday: prof.bday, inDays: bdayInDays(prof.bday) }))
      .filter((b) => b.inDays !== null && b.inDays <= 14)
      .map((b) => ({ ...b, gifted: b.inDays === 0 && !!q('SELECT 1 FROM gifts WHERE from_id = ? AND to_id = ? AND day = ?').get(meId, b.id, today()) }))
      .sort((a, b) => a.inDays - b.inDays);
  }

  // ---------- Спасибо ----------
  const thanksLeft = (uid) => THANKS_PER_DAY - q('SELECT COUNT(*) AS n FROM thanks WHERE from_id = ? AND day = ?').get(uid, today()).n;

  route('GET', '/api/thanks/left', async (req) => ({ left: thanksLeft(requireUser(req).id) }));

  // Спасибо — в банде или любому коллеге из его карточки и лички. Общая банда подставляется сама, если есть
  route('POST', '/api/thanks', async (req, body) => {
    const u = requireUser(req);
    const toId = Number(body.to);
    const to = q('SELECT id FROM users WHERE id = ? AND nick IS NOT NULL').get(toId);
    if (!to) throw bad('Коллега не найден.');
    let gangId = body.gang ? Number(body.gang) : null;
    if (gangId && !(isMember(gangId, u.id) && isMember(gangId, toId))) throw bad('Спасибо в банде можно сказать только тем, кто в ней.');
    if (!gangId) gangId = (q('SELECT a.gang_id FROM gang_members a JOIN gang_members b ON b.gang_id = a.gang_id WHERE a.user_id = ? AND b.user_id = ? LIMIT 1').get(u.id, toId) || {}).gang_id || null;
    if (q('SELECT 1 FROM crew_blocks WHERE user_id = ? AND blocked_id = ?').get(toId, u.id)) throw bad('Этому человеку сейчас нельзя сказать спасибо.');
    if (toId === u.id) throw bad('Себе спасибо не говорят — только другим.');
    if (thanksLeft(u.id) <= 0) throw bad(`Не больше ${THANKS_PER_DAY} спасибо в день — так они ценнее.`);
    const text = U.cleanText(body.text, 80) || null;
    if (text) { const prob = U.moderationProblem(text); if (prob) throw bad(prob); }
    q('INSERT INTO thanks (gang_id, from_id, to_id, text, day, at) VALUES (?, ?, ?, ?, ?, ?)').run(gangId, u.id, toId, text, today(), U.now());
    const got = addBeans(toId, 'thanks');
    bump(u.id, 'thanks_given'); bump(toId, 'thanks_got'); stat('thanks');
    if (seenPair(u.id, 'thanks', toId)) bump(u.id, 'thanks_people');
    completeQuest(u.id, 'thanks');
    if (bdayIdsToday(u.id).has(toId)) completeQuest(u.id, 'bday');
    checkAchievements(u.id); checkAchievements(toId);
    fireAndForget(notify([toId], { title: 'Тебе спасибо!', body: `${u.nick}: ${text || 'спасибо за помощь'}${got ? ' · +1 зерно' : ''}`, url: gangId ? `/#gang/${gangId}` : `/#crew/${u.id}`, tag: `thanks-${u.id}` }));
    return { ok: true, left: thanksLeft(u.id) };
  });

  // Всё дополнительное по банде одним запросом: неделя, спасибо, дни рождения
  route('GET', '/api/gangs/:id/extra', async (req, body, query, params) => {
    const u = requireUser(req);
    const gangId = Number(params.id);
    if (!isMember(gangId, u.id)) throw bad('Ты не в этой банде.');
    const thanks = q(`SELECT t.*, f.nick AS from_nick, r.nick AS to_nick FROM thanks t
                      LEFT JOIN users f ON f.id = t.from_id JOIN users r ON r.id = t.to_id
                      WHERE t.gang_id = ? AND t.at > ? ORDER BY t.at DESC LIMIT 30`).all(gangId, U.now() - 7 * 864e5)
      .map((t) => ({ id: t.id, from: t.from_nick || 'удалённый аккаунт', to: t.to_nick, text: t.text, toMe: t.to_id === u.id, mine: t.from_id === u.id, when: t.day === today() ? 'сегодня' : ddmm(t.day) }));
    return { week: gangWeek(gangId, u.id), thanks, thanksLeft: thanksLeft(u.id), birthdays: gangBirthdays(gangId, u.id) };
  });

  // ---------- Подарок на день рождения ----------
  route('POST', '/api/gift', async (req, body) => {
    const u = requireUser(req);
    const toId = Number(body.to);
    const to = userRow(toId);
    if (!to || toId === u.id) throw bad('Некому дарить.');
    const shared = myGangs(u.id).some((g) => isMember(g.id, toId));
    if (!shared) throw bad('Подарить можно только своим — тем, кто с тобой в банде.');
    const prof = readProfile(to.profile);
    if (!prof.showBday || bdayInDays(prof.bday) !== 0) throw bad('Подарок можно отправить только в день рождения.');
    if (q('SELECT 1 FROM gifts WHERE from_id = ? AND to_id = ? AND day = ?').get(u.id, toId, today())) throw bad(U.g(u.look, 'Ты уже поздравил.', 'Ты уже поздравила.'));
    if (!spendBeans(u.id, GIFT_BEANS, 'gift')) throw bad(`Нужно ${GIFT_BEANS} зёрен.`);
    q('INSERT INTO gifts (from_id, to_id, day, at) VALUES (?, ?, ?, ?)').run(u.id, toId, today(), U.now());
    addBeans(toId, 'gift_got', GIFT_BEANS);
    stat('gifts'); completeQuest(u.id, 'bday');
    fireAndForget(notify([toId], { title: 'С днём рождения!', body: `${u.nick} дарит тебе ${GIFT_BEANS} зёрен`, url: '/', tag: `gift-${u.id}` }, { ignoreQuiet: true }));
    return { ok: true };
  });

  // ---------- Случайный кофе ----------
  function pairNow(force = false) {
    const week = mondayOf(today());
    if (!force && meta.get('coffee_week') === week) return 0;
    meta.set('coffee_week', week);
    q('DELETE FROM coffee_pairs WHERE week = ?').run(week);
    const users = q('SELECT id, nick, profile FROM users WHERE nick IS NOT NULL').all()
      .map((r) => ({ id: r.id, nick: r.nick, prof: readProfile(r.profile) }))
      .filter((r) => r.prof.coffee && r.prof.home);
    const lastWeek = addDays(week, -7);
    const lastPairs = new Set(q('SELECT a, b FROM coffee_pairs WHERE week = ?').all(lastWeek).map((p) => [p.a, p.b].sort().join(':')));
    const gangSets = new Map(users.map((x) => [x.id, new Set(myGangs(x.id).map((g) => g.id))]));
    const sharesGang = (a, b) => [...gangSets.get(a)].some((g) => gangSets.get(b).has(g));
    let made = 0;
    const byOffice = {};
    users.forEach((x) => { (byOffice[x.prof.home] = byOffice[x.prof.home] || []).push(x); });
    for (const [officeId, list] of Object.entries(byOffice)) {
      const pool = list.sort(() => Math.random() - 0.5);
      while (pool.length >= 2) {
        const a = pool.shift();
        let idx = pool.findIndex((b) => !sharesGang(a.id, b.id) && !lastPairs.has([a.id, b.id].sort().join(':')));
        if (idx === -1) idx = pool.findIndex((b) => !lastPairs.has([a.id, b.id].sort().join(':')));
        if (idx === -1) idx = 0;
        const b = pool.splice(idx, 1)[0];
        q('INSERT INTO coffee_pairs (week, office_id, a, b, at) VALUES (?, ?, ?, ?, ?)').run(week, officeId, a.id, b.id, U.now());
        made++;
        const office = officeById(officeId);
        fireAndForget(notify([a.id], { title: 'Случайный кофе', body: `На этой неделе: ты и ${b.nick}${office ? ' · ' + office.name : ''}. Договоритесь о времени в приложении.`, url: '/', tag: 'coffee' }));
        fireAndForget(notify([b.id], { title: 'Случайный кофе', body: `На этой неделе: ты и ${a.nick}${office ? ' · ' + office.name : ''}. Договоритесь о времени в приложении.`, url: '/', tag: 'coffee' }));
      }
    }
    stat('coffee_pairs', made);
    return made;
  }

  function myPair(uid) {
    const p = q('SELECT * FROM coffee_pairs WHERE week = ? AND (a = ? OR b = ?)').get(mondayOf(today()), uid, uid);
    if (!p) return null;
    const partnerId = p.a === uid ? p.b : p.a;
    const partner = userRow(partnerId);
    if (!partner) return null;
    const office = p.office_id ? officeById(p.office_id) : null;
    return {
      id: p.id, partner: { id: partner.id, nick: partner.nick, name: fullName(readProfile(partner.profile), 'all'), look: lookOf(partner) }, office: office ? office.name : null,
      ping: p.ping_by ? { mine: p.ping_by === uid, opt: p.ping_opt, reply: p.reply } : null,
      canReply: !!p.ping_by && p.ping_by !== uid && !p.reply,
      options: COFFEE_OPTS, replies: COFFEE_REPLIES
    };
  }

  route('POST', '/api/coffee/ping', async (req, body) => {
    const u = requireUser(req);
    const p = q('SELECT * FROM coffee_pairs WHERE week = ? AND (a = ? OR b = ?)').get(mondayOf(today()), u.id, u.id);
    if (!p) throw bad('На этой неделе у тебя нет пары для кофе.');
    if (!COFFEE_OPTS.includes(body.opt)) throw bad('Выбери время.');
    if (p.ping_by === u.id && p.ping_at > U.now() - 30 * 60e3 && !p.reply) throw bad(U.g(u.look, 'Ты уже предложил время — дождись ответа.', 'Ты уже предложила время — дождись ответа.'));
    q('UPDATE coffee_pairs SET ping_by = ?, ping_opt = ?, ping_at = ?, reply = NULL, reply_at = NULL WHERE id = ?').run(u.id, body.opt, U.now(), p.id);
    const partnerId = p.a === u.id ? p.b : p.a;
    fireAndForget(notify([partnerId], { title: 'Случайный кофе', body: `${u.nick} предлагает: ${body.opt.toLowerCase()}`, url: '/', tag: 'coffee' }));
    return { ok: true };
  });

  route('POST', '/api/coffee/reply', async (req, body) => {
    const u = requireUser(req);
    const p = q('SELECT * FROM coffee_pairs WHERE week = ? AND (a = ? OR b = ?)').get(mondayOf(today()), u.id, u.id);
    if (!p || !p.ping_by || p.ping_by === u.id) throw bad('Пока нечего отвечать.');
    if (!COFFEE_REPLIES.includes(body.label)) throw bad('Неизвестный ответ.');
    if (p.reply) throw bad(U.g(u.look, 'Ты уже ответил.', 'Ты уже ответила.'));
    q('UPDATE coffee_pairs SET reply = ?, reply_at = ? WHERE id = ?').run(body.label, U.now(), p.id);
    if (body.label === 'Иду') {
      [p.a, p.b].forEach((id) => { bump(id, 'coffee'); checkAchievements(id); });
      stat('coffee_agreed');
    }
    fireAndForget(notify([p.ping_by], { title: 'Случайный кофе', body: `${u.nick}: ${body.label}`, url: '/', tag: 'coffee' }));
    return { ok: true };
  });

  // ---------- Обед компанией ----------
  function lunchesFor(uid) {
    const ci = activeCheckin(uid);
    if (!ci) return { office: null, items: [], times: LUNCH_TIMES };
    const rows = q(`SELECT l.*, u.nick FROM lunches l JOIN users u ON u.id = l.user_id WHERE l.office_id = ? AND l.day = ? ORDER BY l.time`).all(ci.office_id, today());
    const items = rows.map((l) => {
      const joins = q('SELECT j.user_id, u.nick FROM lunch_joins j JOIN users u ON u.id = j.user_id WHERE j.lunch_id = ? ORDER BY j.at').all(l.id);
      return {
        id: l.id, time: l.time, place: l.place, nick: l.nick, mine: l.user_id === uid,
        joined: joins.some((j) => j.user_id === uid), count: joins.length, who: joins.slice(0, 4).map((j) => j.nick)
      };
    });
    return { office: ci.office_id, items, times: LUNCH_TIMES };
  }

  route('POST', '/api/lunch', async (req, body) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    if (!ci) throw bad('Сбор на обед можно открыть, когда ты отмечен в офисе.');
    if (!LUNCH_TIMES.includes(body.time)) throw bad('Выбери время.');
    const place = U.cleanText(body.place, 30) || null;
    if (place) { const prob = U.moderationProblem(place); if (prob) throw bad(prob); }
    q('DELETE FROM lunches WHERE user_id = ? AND day = ?').run(u.id, today());
    q('INSERT INTO lunches (office_id, user_id, time, place, day, at) VALUES (?, ?, ?, ?, ?, ?)').run(ci.office_id, u.id, body.time, place, today(), U.now());
    stat('lunches'); bump(u.id, 'lunches'); checkAchievements(u.id);
    return { ok: true };
  });

  route('POST', '/api/lunch/:id/join', async (req, body, query, params) => {
    const u = requireUser(req);
    const l = q('SELECT * FROM lunches WHERE id = ? AND day = ?').get(Number(params.id), today());
    const ci = activeCheckin(u.id);
    if (!l || !ci || ci.office_id !== l.office_id) throw bad('Сбор не найден или он в другом офисе.');
    if (l.user_id === u.id) throw bad('Это твой сбор.');
    const r = q('INSERT OR IGNORE INTO lunch_joins (lunch_id, user_id, at) VALUES (?, ?, ?)').run(l.id, u.id, U.now());
    if (r.changes) {
      bump(u.id, 'lunches'); checkAchievements(u.id);
      if (q('SELECT COUNT(*) AS n FROM lunch_joins WHERE lunch_id = ?').get(l.id).n >= 3 && flag(l.user_id, 'big_lunch')) checkAchievements(l.user_id);
    }
    if (r.changes) fireAndForget(notify([l.user_id], { title: 'Обед компанией', body: `${u.nick} идёт с тобой в ${l.time}`, url: '/', tag: `lunch-${l.id}` }));
    return { ok: true };
  });

  route('POST', '/api/lunch/:id/leave', async (req, body, query, params) => {
    const u = requireUser(req);
    q('DELETE FROM lunch_joins WHERE lunch_id = ? AND user_id = ?').run(Number(params.id), u.id);
    return { ok: true };
  });

  route('POST', '/api/lunch/:id/cancel', async (req, body, query, params) => {
    const u = requireUser(req);
    const l = q('SELECT * FROM lunches WHERE id = ?').get(Number(params.id));
    if (!l || l.user_id !== u.id) throw bad('Можно отменить только свой сбор.');
    const joiners = q('SELECT user_id FROM lunch_joins WHERE lunch_id = ?').all(l.id).map((r) => r.user_id);
    q('DELETE FROM lunches WHERE id = ?').run(l.id);
    fireAndForget(notify(joiners, { title: 'Обед компанией', body: `Сбор на ${l.time} отменён`, url: '/', tag: `lunch-${l.id}` }));
    return { ok: true };
  });

  // ---------- Сводка для главного экрана и профиля ----------
  route('GET', '/api/features', async (req, body, query) => {
    const u = requireUser(req);
    const done = new Set(q('SELECT quest FROM quests_done WHERE user_id = ? AND day = ?').all(u.id, today()).map((r) => r.quest));
    const owned = Object.fromEntries(q('SELECT ach, at FROM achievements WHERE user_id = ?').all(u.id).map((r) => [r.ach, r.at]));
    const gangs = myGangs(u.id);
    const gangId = Number(query.gang) && gangs.some((g) => g.id === Number(query.gang)) ? Number(query.gang) : (gangs[0] || {}).id;
    const prof = readProfile(u.profile ? (typeof u.profile === 'string' ? u.profile : JSON.stringify(u.profile)) : '{}');
    const bdaysToday = [];
    const seen = new Set();
    for (const g of gangs) {
      for (const b of gangBirthdays(g.id, u.id)) {
        if (b.inDays === 0 && !seen.has(b.id)) { seen.add(b.id); bdaysToday.push(b); }
      }
    }
    return {
      quests: { weekend: isWeekend(today()), items: questsFor(u.id).map((id) => QUESTS.find((x) => x.id === id)).filter(Boolean).map((x) => {
          const t = x.id === 'dmnew' ? questTarget(u.id) : null;
          return { id: x.id, name: t ? `Напиши в личку ${t.nick} — вы ещё не общались один на один` : x.name, go: x.go, to: x.to || null, done: done.has(x.id), target: t };
        }), reward: QUEST_REWARD, bonus: QUEST_ALL_BONUS,
        extra: bonusFor(u.id).map((id) => BONUS_QUESTS.find((x) => x.id === id)).map((x) => ({ id: x.id, name: x.name, go: x.go, done: done.has(x.id) })) },
      achievements: (() => {
        const c = countersOf(u.id, userRow(u.id));
        return ACH.map((a) => {
          const got = !!owned[a.id];
          const hide = a.secret && !got;
          return { id: a.id, cat: a.cat, series: a.series || null, tier: a.tier, secret: !!a.secret, reward: ACH_REWARD[a.tier], got, at: owned[a.id] || null,
            name: hide ? '???' : achName(a, U.fem(u.look)), desc: hide ? 'Секретная ачивка' : achDesc(a, U.fem(u.look)),
            n: hide ? null : Math.min(c[a.m] || 0, a.goal), goal: hide ? null : a.goal };
        });
      })(),
      achCats: ACH_CATS,
      ...(() => { const w = gangId ? gangWeek(gangId, u.id) : null; return { weekHint: w ? w.best : null, weekLock: w ? w.locked || null : null }; })(),
      coffee: { optIn: !!prof.coffee, hasHome: !!prof.home, pair: myPair(u.id) },
      lunches: lunchesFor(u.id),
      birthdaysToday: bdaysToday,
      giftBeans: GIFT_BEANS,
      food: (() => { const ci = activeCheckin(u.id); return ci ? foodSummary(ci.office_id, u.id) : null; })()
    };
  });

  // ---------- Админка: метрики ----------
  // ---------- Оценка обеда ----------
  function foodSummary(officeId, uid) {
    const rows = q('SELECT up, tags, user_id FROM canteen_rates WHERE day = ? AND office_id = ?').all(today(), officeId);
    const n = rows.length;
    const ups = rows.filter((r) => r.up).length;
    const cnt = {};
    for (const r of rows) for (const t of JSON.parse(r.tags)) cnt[t] = (cnt[t] || 0) + 1;
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
    const ate = !!q('SELECT 1 FROM canteen WHERE user_id = ? AND office_id = ? AND at > ?').get(uid, officeId, dayStartTs(today()));
    const mine = rows.find((r) => r.user_id === uid);
    return { n, upPct: n ? Math.round((ups / n) * 100) : null, top, canRate: ate, mine: mine ? { up: !!mine.up, tags: JSON.parse(mine.tags) } : null, tagsUp: FOOD_TAGS_UP, tagsDown: FOOD_TAGS_DOWN };
  }

  route('POST', '/api/canteen/rate', async (req, body) => {
    const u = requireUser(req);
    const ci = activeCheckin(u.id);
    const officeId = ci && ci.office_id;
    if (!officeId || !q('SELECT 1 FROM canteen WHERE user_id = ? AND office_id = ? AND at > ?').get(u.id, officeId, dayStartTs(today()))) {
      throw bad('Оценить обед можно после отметки «Я тут» в столовой.');
    }
    const up = !!body.up;
    const allowed = up ? FOOD_TAGS_UP : FOOD_TAGS_DOWN;
    const tags = (Array.isArray(body.tags) ? body.tags : []).filter((t) => allowed.includes(t)).slice(0, 3);
    const comment = U.cleanText(body.comment || '', 140);
    if (comment) { const prob = U.moderationProblem(comment); if (prob) throw bad(prob); }
    const first = !q('SELECT 1 FROM canteen_rates WHERE day = ? AND office_id = ? AND user_id = ?').get(today(), officeId, u.id);
    q(`INSERT INTO canteen_rates (day, office_id, user_id, up, tags, comment, at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, office_id, user_id) DO UPDATE SET up = excluded.up, tags = excluded.tags, comment = excluded.comment, at = excluded.at`)
      .run(today(), officeId, u.id, up ? 1 : 0, JSON.stringify(tags), comment || null, U.now());
    const beans = first ? addBeans(u.id, 'food_rate') || 0 : 0;
    if (first) { stat('food_rates'); bump(u.id, 'food'); completeQuest(u.id, 'food'); checkAchievements(u.id); }
    return { ok: true, beans, food: foodSummary(officeId, u.id) };
  });

  // Модерация: сводка по столовым за две недели и комментарии без имён — можно передать АХО и подрядчику
  route('GET', '/api/admin/food', async (req) => {
    requireAdmin(req);
    const from = addDays(today(), -13);
    const rows = q('SELECT r.day, r.office_id, r.up, r.tags, r.comment, o.name AS office FROM canteen_rates r JOIN offices o ON o.id = r.office_id WHERE r.day >= ? ORDER BY r.at DESC').all(from);
    const by = {};
    for (const r of rows) {
      const k = r.office;
      by[k] = by[k] || { office: k, n: 0, up: 0, tags: {}, comments: [] };
      by[k].n++; if (r.up) by[k].up++;
      for (const t of JSON.parse(r.tags)) by[k].tags[t] = (by[k].tags[t] || 0) + 1;
      if (r.comment && by[k].comments.length < 30) by[k].comments.push({ day: ddmm(r.day), up: !!r.up, text: r.comment });
    }
    return { offices: Object.values(by).map((o) => ({ ...o, upPct: Math.round((o.up / o.n) * 100), tags: Object.entries(o.tags).sort((a, b) => b[1] - a[1]) })) };
  });

  route('GET', '/api/admin/metrics', async (req) => {
    requireAdmin(req);
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(addDays(today(), -i));
    const rows = days.map((d) => {
      const s = Object.fromEntries(q('SELECT key, n FROM stats WHERE day = ?').all(d).map((r) => [r.key, r.n]));
      return { day: ddmm(d), active: q('SELECT COUNT(*) AS n FROM activity WHERE day = ?').get(d).n, checkins: s.checkins || 0, calls: s.calls || 0, replies: s.replies || 0, thanks: s.thanks || 0, lunches: s.lunches || 0, messages: s.messages || 0 };
    });
    const w0 = addDays(today(), -6);
    const w1 = addDays(today(), -13);
    const wau = q('SELECT COUNT(DISTINCT uid) AS n FROM activity WHERE day >= ?').get(w0).n;
    const prev = q('SELECT COUNT(DISTINCT uid) AS n FROM activity WHERE day >= ? AND day < ?').get(w1, w0).n;
    const kept = q(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT uid FROM activity WHERE day >= ? AND day < ?) p
                    WHERE p.uid IN (SELECT uid FROM activity WHERE day >= ?)`).get(w1, w0, w0).n;
    return { rows, wau, prevWau: prev, retention: prev ? Math.round((kept / prev) * 100) : null, coffeeWeek: q('SELECT COUNT(*) AS n FROM coffee_pairs WHERE week = ?').get(mondayOf(today())).n };
  });

  route('POST', '/api/admin/coffee-now', async (req) => {
    requireAdmin(req);
    return { ok: true, pairs: pairNow(true) };
  });

  // ---------- Фоновые задачи (раз в 10 минут) ----------
  function tick() {
    const now = U.msk();
    const day = now.day;
    const dow = new Date(day + 'T00:00:00Z').getUTCDay();
    try {
      // Случайный кофе: понедельник с 10:00
      if (dow === 1 && now.hour >= 10) pairNow(false);
      // Дни рождения: пуш банде в 10:00
      if (now.hour >= 10 && now.hour < 19 && meta.get('bday_day') !== day) {
        meta.set('bday_day', day);
        for (const r of q('SELECT id, nick, profile FROM users WHERE nick IS NOT NULL').all()) {
          const prof = readProfile(r.profile);
          if (!prof.showBday || bdayInDays(prof.bday) !== 0) continue;
          const mates = new Set();
          myGangs(r.id).forEach((g) => gangMembers(g.id).forEach((m) => { if (m.id !== r.id) mates.add(m.id); }));
          fireAndForget(notify([...mates], { title: 'День рождения в банде', body: `Сегодня день рождения у ${r.nick}! Поздравь и подари ${GIFT_BEANS} зёрен.`, url: '/', tag: `bday-${r.id}` }));
        }
      }
      // Сводка недели: пятница с 16:00
      if (dow === 5 && now.hour >= 16 && now.hour < 19 && meta.get('digest_week') !== mondayOf(day)) {
        meta.set('digest_week', mondayOf(day));
        const since = dayStartTs(mondayOf(day));
        for (const r of q('SELECT DISTINCT user_id AS id FROM push_subs').all()) {
          const u = userRow(r.id);
          if (!u || !u.nick) continue;
          const t = q('SELECT COUNT(*) AS n FROM thanks WHERE to_id = ? AND at >= ?').get(u.id, since).n;
          const rep = q("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND reason = 'reply' AND at >= ?").get(u.id, since).n;
          const ach = q('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND at >= ?').get(u.id, since).n;
          const st = streakOf(u.id);
          const parts = [`спасибо: ${t}`, `ответов на зовы: ${rep}`, `серия: ${st} дн.`];
          if (ach) parts.push(`новых ачивок: ${ach}`);
          fireAndForget(notify([u.id], { title: 'Неделя в Этаже', body: parts.join(' · '), url: '/', tag: 'digest' }));
        }
      }
    } catch (e) {
      console.error('[tick]', e.message);
    }
  }

  function cleanup() {
    const t = U.now();
    const d = today();
    q('UPDATE canteen_rates SET user_id = NULL WHERE day < ? AND user_id IS NOT NULL').run(d);
    q('DELETE FROM canteen_rates WHERE day < ?').run(addDays(d, -60));
    q('DELETE FROM activity WHERE day < ?').run(addDays(d, -35));
    q('DELETE FROM stats WHERE day < ?').run(addDays(d, -120));
    q('DELETE FROM thanks WHERE at < ?').run(t - 30 * 864e5);
    q('DELETE FROM lunches WHERE day < ?').run(d);
    q('DELETE FROM coffee_pairs WHERE week < ?').run(addDays(d, -56));
    q('DELETE FROM quests_done WHERE day < ?').run(addDays(d, -7));
    q('DELETE FROM quest_days WHERE day < ?').run(addDays(d, -7));
    q('DELETE FROM gifts WHERE day < ?').run(addDays(d, -400));
    tick();
  }

  // ---------- «Совпадаем»: кто из коллег (не только банды) в какие дни в каком офисе и дома ----------
  // Видят только те, кто сам открыл свои дни (взаимность): profile.matchShow. Показываем ник, аватар,
  // имя, офис на этот день и общие интересы — без точного времени.
  const MATCH_PER_GROUP = 40;
  route('GET', '/api/match', async (req) => {
    const u = requireUser(req);
    const me = readProfile(typeof u.profile === 'string' ? u.profile : JSON.stringify(u.profile || {}));
    const days = weekDays();
    const out = { on: !!me.matchShow, home: me.home || null, days: days.map((d) => ({ day: d, label: `${DAY_NAMES[new Date(d + 'T00:00:00Z').getUTCDay()]} ${ddmm(d)}`, holiday: HOL.holidayName(d) || null, today: d === today() })) };
    if (!out.on) {
      out.count = q('SELECT COUNT(*) AS n FROM users WHERE nick IS NOT NULL AND id != ? AND json_extract(profile, \'$.matchShow\') = 1').get(u.id).n;
      return out;
    }
    if (!planFilled(me)) {
      out.locked = true;
      out.count = q("SELECT COUNT(*) AS n FROM users WHERE nick IS NOT NULL AND id != ? AND json_extract(profile, '$.matchShow') = 1").get(u.id).n;
      return out;
    }
    const myTags = new Set((me.tags || []).map((t) => String(t).toLowerCase()));
    const mates = new Set();
    myGangs(u.id).forEach((g) => gangMembers(g.id).forEach((m) => mates.add(m.id)));
    const rows = q("SELECT id, nick, look, profile FROM users WHERE nick IS NOT NULL AND id != ? AND json_extract(profile, '$.matchShow') = 1").all(u.id);
    const people = rows.map((r) => ({ r, prof: readProfile(r.profile) }));
    out.days = out.days.map((d) => {
      const offices = {}; const home = [];
      let mine = cellFor(me, u.id, d.day);
      for (const { r, prof } of people) {
        const cell = cellFor(prof, r.id, d.day);
        if (cell !== 'office' && cell !== 'home') continue;
        const common = (prof.tags || []).filter((t) => myTags.has(String(t).toLowerCase()));
        const p = { id: r.id, nick: r.nick, name: fullName(prof, 'all'), look: lookOf(r), common, mate: mates.has(r.id) };
        if (cell === 'home') { home.push(p); continue; }
        const ci = d.today ? activeCheckin(r.id) : null;
        const oid = (ci && ci.office_id) || prof.home || 'unknown';
        (offices[oid] = offices[oid] || []).push(p);
      }
      const rank = (a, b) => (b.common.length - a.common.length) || (Number(a.mate) - Number(b.mate)) || a.nick.localeCompare(b.nick, 'ru');
      const list = Object.entries(offices).map(([id, ps]) => {
        const o = officeById(id);
        return { id, name: o ? o.name : 'офис не указан', mine: id === me.home, n: ps.length, people: ps.sort(rank).slice(0, MATCH_PER_GROUP) };
      }).sort((a, b) => Number(b.mine) - Number(a.mine) || b.n - a.n);
      return { ...d, me: mine, offices: list, home: { n: home.length, people: home.sort(rank).slice(0, MATCH_PER_GROUP) } };
    });
    return out;
  });

  // Для сводки «Этажа»: сколько заданий дня осталось, пара на кофе, заходил ли сегодня
  function questSummary(uid) {
    const done = new Set(q('SELECT quest FROM quests_done WHERE user_id = ? AND day = ?').all(uid, today()).map((r) => r.quest));
    const list = questsFor(uid);
    return { total: list.length, left: list.filter((id) => !done.has(id)).length };
  }
  const activeToday = (uid) => counter(uid, 'last_active') >= Number(today().replace(/-/g, ''));
  return { streak: (uid) => counter(uid, 'day_streak'), setQuestProviders: (p) => Object.assign(prov, p), onEvent, cleanup, tick, pairNow, questSummary, myPair, activeToday, cellFor };
}

module.exports = { register, ACH, QUESTS };
