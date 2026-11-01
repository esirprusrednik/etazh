// Справочники: статусы, зовы, сигналы офиса, лавка. Меняются здесь, без миграций.

const MOODS = {
  coffee: 'Готов к кофе',
  lunch: 'Открыт к обеду',
  flow: 'В потоке',
  dnd: 'Не беспокоить'
};

const DEFAULT_REPLIES = ['Иду', 'Через 10 мин', 'Не могу'];

const CALLS = {
  coffee: { label: 'На кофе', verb: 'зовёт на кофе', opts: ['Сейчас', 'Через 15 мин', 'В 16:00'], replies: DEFAULT_REPLIES },
  lunch: { label: 'На обед', verb: 'зовёт на обед', opts: ['Сейчас', '12:30', '13:00', '13:30'], replies: DEFAULT_REPLIES },
  room: { label: 'Совещание', verb: 'зовёт на совещание', opts: ['В переговорке', 'В Skype', 'В Линке'], textLabel: 'Где и когда (необязательно)', textHint: 'Например, «Марс», 5 этаж, через 10 минут', replies: DEFAULT_REPLIES },
  home: { label: 'Домой', verb: 'собирается домой — кто с ним?', opts: ['Через 10 мин', 'В 18:00', 'В 19:00'], replies: ['Я с тобой', 'Чуть позже', 'Без меня'] },
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
  { id: 'crown', kind: 'crown', name: 'Корона «Сотрудник месяца»', price: 150 },
  // Детали для конструктора аватара: покупаешь один раз, надеваешь в конструкторе
  { id: 'p_sign', kind: 'part', slot: 'prop', value: 'sign', name: 'Табличка «Я на совещании»', price: 30 },
  { id: 'p_laptop', kind: 'part', slot: 'prop', value: 'laptop', name: 'Ноутбук в наклейках', price: 40 },
  { id: 'p_mug_best', kind: 'part', slot: 'prop', value: 'mug_best', name: 'Кружка «Лучший сотрудник»', price: 60 },
  { id: 'p_tie_gold', kind: 'part', slot: 'neck', value: 'tie_gold', name: 'Золотой галстук начальника', price: 50 },
  { id: 'g_gold', kind: 'gang', name: 'Позолоченное знамя', price: 100 },
  { id: 'g_motto', kind: 'gang', name: 'Девиз банды', price: 40 }
];

// Начисления зёрен и дневные лимиты (раздел 6 ТЗ)
const EARN = {
  welcome: { amount: Number(process.env.WELCOME_BEANS || 50), perDay: 1 },
  checkin: { amount: 5, perDay: 1 },
  canteen: { amount: 2, perDay: 2 },
  reply: { amount: 1, perDay: 10 },
  signal_confirmed: { amount: 2, perDay: 3 },
  deposit_back: { amount: 50, perDay: 100 },
  thanks: { amount: 1, perDay: 5 }, // получатель спасибо, не больше 5 зёрен в день
  sea_win: { amount: 5, perDay: 1 }, // победа в морском бое: зёрна только за первую победу в день
  guess: { amount: 1, perDay: 3 },   // «Угадай коллегу»: верный ответ
  quiz: { amount: 3, perDay: 3 },    // квиз недели: верный ответ
  food_rate: { amount: 1, perDay: 1 } // оценка обеда
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
  { id: 'thanks', caption: 'Спасибо, что ты есть в банде', bg: ['#FF6FA8', '#9D174D'] }
];
const MEME_EMOS = {
  joy: { label: 'Радость', mouth: 'grin', eyeShape: 'happy' },
  tired: { label: 'Устал', mouth: 'neutral', eyeShape: 'tired' },
  shock: { label: 'Шок', mouth: 'wow', eyeShape: 'wide' },
  sly: { label: 'Хитрость', mouth: 'smirk', eyeShape: 'sly' },
  calm: { label: 'Как есть', mouth: null, eyeShape: null }
};

module.exports = { MOODS, CALLS, SIGNALS, SHOP, EARN, GANG_DEPOSIT, GANG_COLORS, MEMES, MEME_EMOS };
