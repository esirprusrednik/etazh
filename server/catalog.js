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
  room: { label: 'В переговорку', verb: 'зовёт в переговорку', opts: ['Сейчас', 'Через 5 мин'], needsText: true, replies: DEFAULT_REPLIES },
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
  { id: 'st_night', kind: 'status', name: 'Ночной дозор', price: 50 },
  { id: 'st_coffee', kind: 'status', name: 'Кофейный магнат', price: 60 },
  { id: 'st_room', kind: 'status', name: 'Повелитель переговорок', price: 80 },
  { id: 'st_canteen', kind: 'status', name: 'Легенда столовой', price: 120, limit: 20 },
  { id: 'fr_gold', kind: 'frame', name: 'Золотая рамка', price: 60, color: '#FFC93C' },
  { id: 'fr_neon', kind: 'frame', name: 'Неоновая рамка', price: 80, color: '#22D3EE' },
  { id: 'fr_fire', kind: 'frame', name: 'Огненная рамка', price: 120, color: '#F97316' },
  { id: 'crown', kind: 'crown', name: 'Корона', price: 150 },
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
  deposit_back: { amount: 50, perDay: 100 }
};

const GANG_DEPOSIT = 50;
const GANG_COLORS = ['#E5484D', '#2563C9', '#1F7A3A', '#8B5CF6', '#F97316'];

module.exports = { MOODS, CALLS, SIGNALS, SHOP, EARN, GANG_DEPOSIT, GANG_COLORS };
