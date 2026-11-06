// Справочники: статусы, зовы, сигналы офиса, лавка. Меняются здесь, без миграций.

const MOODS = {
  coffee: 'Готов к кофе',
  lunch: 'Открыт к обеду',
  flow: 'В потоке',
  dnd: 'Не беспокоить'
};
// Те же статусы в женском роде
const MOODS_F = { coffee: 'Готова к кофе', lunch: 'Открыта к обеду' };

const DEFAULT_REPLIES = ['Иду', 'Через 10 мин', 'Не могу'];

const CALLS = {
  coffee: { label: 'На кофе', verb: 'зовёт на кофе', opts: ['Сейчас', 'Через 15 мин', 'В 16:00'], replies: DEFAULT_REPLIES },
  lunch: { label: 'На обед', verb: 'зовёт на обед', opts: ['Сейчас', '12:30', '13:00', '13:30'], replies: DEFAULT_REPLIES },
  room: { label: 'Совещание', verb: 'зовёт на совещание', opts: ['В переговорке', 'В Skype', 'В Линке'], textLabel: 'Где и когда (необязательно)', textHint: 'Например, «Марс», 5 этаж, через 10 минут', replies: DEFAULT_REPLIES },
  home: { label: 'Домой', verb: 'собирается домой — кто за компанию?', opts: ['Через 10 мин', 'В 18:00', 'В 19:00'], replies: ['Я с тобой', 'Чуть позже', 'Без меня'] },
  call: { label: 'Перезвони', verb: 'просит перезвонить', opts: ['Когда сможешь', 'Срочно'], replies: ['Перезвоню', 'Через 15 мин', 'Напиши лучше'] },
  where: { label: 'Ты где?', verb: 'спрашивает: ты где?', opts: [], replies: ['В офисе', 'Дома', 'На встрече', 'Скоро буду'] },
  online: { label: 'На связи?', verb: 'спрашивает: на связи?', opts: [], replies: ['На связи', 'Через 15 мин', 'Не сейчас'] },
  wait: { label: 'Жду', verb: 'ждёт', opts: ['У входа', 'У лифтов', 'В столовой', 'В переговорке'], replies: ['Бегу', '5 минут', 'Не успеваю'] }
};

// Сигналы офиса: только фиксированные типы (раздел 5.1 ТЗ)
const SIGNALS = {
  food: { label: 'Еда на кухне', hours: 2, toFacilities: false },
  coffee_out: { label: 'Кофе закончился / сломалась кофемашина', hours: 8, toFacilities: true },
  cold: { label: 'Холодно', hours: 3, toFacilities: true },
  hot: { label: 'Жарко / душно', hours: 3, toFacilities: true },
  noise: { label: 'Шумно / ремонт', hours: 3, toFacilities: false },
  broken: { label: 'Что-то сломалось (лифт, вода, принтер)', hours: 8, toFacilities: true },
  room_free: { label: 'Свободная переговорка', hours: 2, toFacilities: false }
};

const SHOP = [
  { id: 'st_night', kind: 'status', name: 'Салага', price: 30 },
  { id: 'st_coffee', kind: 'status', name: 'Кофейный магнат', price: 60 },
  { id: 'st_owl', kind: 'status', name: 'Сова на смене', price: 70 },
  { id: 'st_room', kind: 'status', name: 'Повелитель переговорок', price: 80 },
  { id: 'st_canteen', kind: 'status', name: 'Легенда столовой', price: 120, limit: 20 },
  { id: 'fr_gold', kind: 'frame', name: 'Золотая рамка', price: 60, color: '#FFC93C' },
  { id: 'fr_neon', kind: 'frame', name: 'Неоновая рамка', price: 80, color: '#22D3EE' },
  { id: 'fr_fire', kind: 'frame', name: 'Огненная рамка', price: 120, color: '#F97316' },
  { id: 'fr_champ', kind: 'frame', name: 'Рамка чемпиона', price: 0, award: true, how: '1 место в Лиге месяца', color: '#FFD84D' },
  { id: 'crown', kind: 'crown', name: 'Корона «Сотрудник месяца»', price: 150 },
  // Детали для конструктора аватара: покупаешь один раз, надеваешь в конструкторе
  { id: 'p_sign', kind: 'part', slot: 'prop', value: 'sign', name: 'Табличка «Я на совещании»', price: 30 },
  { id: 'p_laptop', kind: 'part', slot: 'prop', value: 'laptop', name: 'Ноутбук в наклейках', price: 40 },
  { id: 'p_mug_best', kind: 'part', slot: 'prop', value: 'mug_best', name: 'Кружка «Лучший сотрудник»', price: 60 },
  { id: 'p_tie_gold', kind: 'part', slot: 'neck', value: 'tie_gold', name: 'Золотой галстук начальника', price: 50 },
  { id: 'p_snake', kind: 'part', slot: 'neck', value: 'snake', name: 'Змея на шее', price: 80 },
  { id: 'p_chain_gold', kind: 'part', slot: 'neck', value: 'chain_gold', name: 'Золотая цепь', price: 60 },
  { id: 'p_puffer', kind: 'part', slot: 'outfit', value: 'puffer', name: 'Пуховик', price: 40 },
  // Легендарные образы: детали продаются по отдельности, в конструкторе есть готовые наборы
  { id: 'p_biker', kind: 'part', slot: 'outfit', value: 'biker', name: 'Косуха с заклёпками', price: 120, legend: true },
  { id: 'p_cyber', kind: 'part', slot: 'outfit', value: 'cyber', name: 'Неоновая куртка', price: 150, legend: true },
  { id: 'p_visor', kind: 'part', slot: 'mask', value: 'visor', name: 'Кибервизор', price: 90, legend: true },
  { id: 'p_anime_hair', kind: 'part', slot: 'hairStyle', value: 'anime', name: 'Аниме-причёска', price: 100, legend: true },
  // Эксклюзив: легендарные образы
  { id: 'p_knight', kind: 'part', slot: 'hat', value: 'knight', name: 'Рыцарский шлем', price: 140, legend: true },
  { id: 'p_royal', kind: 'part', slot: 'hat', value: 'royal', name: 'Корона', price: 200, legend: true },
  { id: 'p_armor', kind: 'part', slot: 'outfit', value: 'armor', name: 'Доспехи', price: 160, legend: true },
  { id: 'p_fedora', kind: 'part', slot: 'hat', value: 'fedora', name: 'Шляпа', price: 70, legend: true },
  { id: 'p_scuba', kind: 'part', slot: 'mask', value: 'scuba', name: 'Маска аквалангиста', price: 90, legend: true },
  { id: 'p_tricorn', kind: 'part', slot: 'hat', value: 'tricorn', name: 'Треуголка капитана', price: 90, legend: true },
  { id: 'p_vampire', kind: 'part', slot: 'outfit', value: 'vampire', name: 'Плащ вампира', price: 130, legend: true },
  { id: 'p_parrot', kind: 'part', slot: 'pet', value: 'parrot', name: 'Попугай на плече', price: 100, legend: true },
  { id: 'p_torch', kind: 'part', slot: 'prop', value: 'torch', name: 'Факел', price: 60, legend: true },
  { id: 'p_dedmoroz', kind: 'part', slot: 'hat', value: 'dedmoroz', name: 'Шапка Деда Мороза', price: 60, legend: true },
  { id: 'p_kokoshnik', kind: 'part', slot: 'hat', value: 'kokoshnik', name: 'Кокошник Снегурочки', price: 60, legend: true },
  // Сезонные: продаются только в праздничное окно (см. seasons.js), купленное остаётся навсегда
  { id: 'p_nysweater', kind: 'part', slot: 'outfit', value: 'nysweater', name: 'Новогодний свитер', price: 60, legend: true, season: 'newyear' },
  { id: 'p_telnyashka', kind: 'part', slot: 'outfit', value: 'telnyashka', name: 'Тельняшка', price: 50, legend: true, season: 'feb23' },
  { id: 'p_mimosa', kind: 'part', slot: 'prop', value: 'mimosa', name: 'Букет мимозы', price: 40, legend: true, season: 'mar8' },
  { id: 'p_wreath', kind: 'part', slot: 'hat', value: 'wreath', name: 'Весенний венок', price: 60, legend: true, season: 'mar8' },
  { id: 'p_pancakes', kind: 'part', slot: 'prop', value: 'pancakes', name: 'Стопка блинов', price: 40, legend: true, season: 'maslenitsa' },
  { id: 'p_shawl', kind: 'part', slot: 'hat', value: 'shawl', name: 'Расписной платок', price: 50, legend: true, season: 'maslenitsa' },
  // Награда адвент-календаря: 20 окошек из 31
  { id: 'p_garland', kind: 'part', slot: 'neck', value: 'garland', name: 'Ёлочная гирлянда', price: 0, award: true, how: '20 окошек адвент-календаря' },
  // Трофеи Лиги банд: не продаются, только за призовое место
  { id: 'p_trophy', kind: 'part', slot: 'prop', value: 'trophy', name: 'Кубок Лиги', price: 0, award: true, how: '1 место в Лиге недели' },
  { id: 'p_laurel', kind: 'part', slot: 'hat', value: 'laurel', name: 'Лавровый венок', price: 0, award: true, how: 'топ-3 в Лиге месяца' },
  { id: 'p_anime_eyes', kind: 'part', slot: 'eyeShape', value: 'anime', name: 'Аниме-глаза', price: 80, legend: true },
  { id: 'g_gold', kind: 'gang', name: 'Позолоченное знамя', price: 100 },
  { id: 'g_motto', kind: 'gang', name: 'Девиз банды', price: 40 }
];

// Начисления зёрен и дневные лимиты (раздел 6 ТЗ)
const EARN = {
  welcome: { amount: Number(process.env.WELCOME_BEANS || 50), perDay: 1 },
  checkin: { amount: 5, perDay: 1 },
  advent: { amount: 2, perDay: 1 },   // окошко адвент-календаря
  home: { amount: 5, perDay: 1 },     // «Сегодня из дома» — столько же, сколько отметка в офисе; вместе — не больше 5 в день
  canteen: { amount: 2, perDay: 2 },
  reply: { amount: 1, perDay: 10 },
  signal_confirmed: { amount: 2, perDay: 3 },
  deposit_back: { amount: 50, perDay: 100 },
  thanks: { amount: 1, perDay: 5 }, // получатель спасибо, не больше 5 зёрен в день
  sea_win: { amount: 5, perDay: 1 }, // победа в морском бое: зёрна только за первую победу в день
  guess: { amount: 1, perDay: 3 },   // «Угадай коллегу»: верный ответ
  quiz: { amount: 3, perDay: 3 },    // квиз недели: верный ответ
  food_rate: { amount: 1, perDay: 1 }, // оценка обеда
  friday: { amount: 3, perDay: 1 },
  wave: { amount: 2, perDay: 1 },
  todo_day: { amount: 2, perDay: 1 }, // закрыл все дела дня   // встал в волну банды // ответ на пятничную пятиминутку банды
  duel_win: { amount: 2, perDay: 3 }  // победа в личной дуэли
};

const GANG_DEPOSIT = 50;
const GANG_COLORS = ['#E5484D', '#2563C9', '#1F7A3A', '#8B5CF6', '#F97316'];

// Мем-открытки: ситуации с готовыми подписями. Свободного текста нет — значит, нет и модерации
const MEMES = [
  { id: 'call', caption: 'Этот созвон мог быть письмом', bg: ['#3A7BD5', '#1E3C72'] },
  { id: 'friday', caption: 'Пятница, 17:59', bg: ['#F97316', '#B8333A'] },
  { id: 'report', caption: 'Снова квартальный отчёт', bg: ['#6D3FD6', '#2E1A6B'] },
  { id: 'meeting', caption: 'Я на совещании. Опять', bg: ['#0E7490', '#073B4C'] },
  { id: 'coffee', caption: 'Кофе — мой главный KPI', bg: ['#8B5A2B', '#3E2410'] },
  { id: 'remote', caption: 'Работаю из дома. Почти', bg: ['#2FA84F', '#145228'] },
  { id: 'printer', caption: 'Принтер, мы же договаривались', bg: ['#4B5563', '#1F2937'] },
  { id: 'best', caption: 'Сотрудник месяца. Сам себя наградил', bg: ['#F4C430', '#C2410C'] },
  { id: 'deadline', caption: 'Дедлайн вчера, а я спокоен', bg: ['#E5484D', '#7F1D1D'] },
  { id: 'excel', caption: 'Сводная сошлась с первого раза', bg: ['#1F7A3A', '#0B3D1E'] },
  { id: 'thanks', caption: 'Спасибо, что ты есть в банде', bg: ['#FF6FA8', '#9D174D'] },
  // Праздничные — только в сезон
  { id: 'newyear', caption: 'С Новым годом, банда!', bg: ['#1F7A3A', '#7F1D1D'], season: 'newyear' },
  { id: 'feb23', caption: 'С 23 Февраля, защитник дедлайнов', bg: ['#2E5BD0', '#0E2C52'], season: 'feb23' },
  { id: 'mar8', caption: 'С 8 Марта! Весна и в офисе', bg: ['#FF8FB8', '#C2185B'], season: 'mar8' },
  { id: 'maslenitsa', caption: 'Масленица: блины важнее KPI', bg: ['#F4C430', '#C2410C'], season: 'maslenitsa' }
];
const MEME_EMOS = {
  joy: { label: 'Радость', mouth: 'grin', eyeShape: 'normal' },
  tired: { label: 'Усталость', mouth: 'neutral', eyeShape: 'tired' },
  shock: { label: 'Шок', mouth: 'wow', eyeShape: 'wide' },
  sly: { label: 'Хитрость', mouth: 'smirk', eyeShape: 'sly' },
  calm: { label: 'Как есть', mouth: null, eyeShape: null }
};

// Банды: что объединяет (не оргструктура — банда собирается вокруг общего, а не по штатному расписанию) и интересы
const GANG_AREAS = ['Кофейный клуб', 'Обеденный отряд', 'Соседи по этажу', 'Проектная тусовка', 'Спорт и движ', 'Настолки и игры',
  'Учимся вместе', 'Мемы и болтовня', 'После работы', 'Добрые дела', 'Просто свои'];
// Старые «направления» по оргструктуре — снимаются разово при запуске (server/db.js)
const OLD_GANG_AREAS = ['Аналитика и данные', 'Бизнес-анализ', 'ИТ и разработка', 'Сеть и техника', 'Продукт и диджитал', 'Маркетинг и бренд', 'Продажи B2C', 'Продажи B2B',
  'Клиентский сервис и КЦ', 'Розница и салоны', 'Финансы', 'Юристы', 'HR и обучение', 'Закупки', 'Безопасность', 'PR и коммуникации', 'Стратегия', 'Администрация и АХО', 'По интересам'];
const GANG_INTERESTS = ['Кофе', 'Обеды', 'Настолки', 'Спорт', 'Бег', 'Йога', 'Футбол', 'Кино', 'Музыка', 'Книги', 'Путешествия', 'Кулинария', 'Викторины',
  'Excel', 'SQL', 'Python', 'Data Science', 'Agile', 'Продукты', 'Английский', 'Волонтёрство', 'Мемы'];
const GANG_EMOJI = ['☕', '🍕', '🚀', '📊', '💻', '🎯', '🎲', '🏃', '🎸', '📚', '🧠', '🔥', '🐉', '🦉', '⚡', '🌿', '📡', '💼'];

// Части герба банды — ключи совпадают с public/js/crest.js
const CREST = {
  shape: ['heater', 'french', 'round', 'kite', 'badge', 'swiss'],
  div: ['plain', 'pale', 'fess', 'bend', 'perbend', 'quarterly', 'chevron', 'chief', 'cross', 'saltire', 'bars', 'paly', 'checky', 'bordure'],
  tincture: ['gold', 'silver', 'red', 'blue', 'green', 'purple', 'black', 'orange', 'sky', 'pink'],
  charge: ['chart', 'search', 'gear', 'code', 'coin', 'megaphone', 'scales', 'tower', 'briefcase', 'bag', 'headset', 'people', 'lock', 'crown', 'star', 'bolt', 'cup', 'book', 'note', 'plane', 'ball', 'rocket', 'flame', 'tree', 'heart', 'dice', 'film', 'pizza', 'medal', 'globe', 'snake', 'wolf', 'owl', 'anchor', 'sword'],
  top: ['none', 'crown', 'laurel', 'wings', 'stars', 'helm']
};

module.exports = { CREST, GANG_AREAS, OLD_GANG_AREAS, GANG_INTERESTS, GANG_EMOJI, MOODS_F, MOODS, CALLS, SIGNALS, SHOP, EARN, GANG_DEPOSIT, GANG_COLORS, MEMES, MEME_EMOS };
