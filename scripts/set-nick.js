// Админская смена ника без списания зёрен.
// Запуск на сервере:
//   docker compose -f /opt/etazh/docker-compose.yml exec app node --no-warnings scripts/set-nick.js почта@mts.ru НовыйНик
// Почта нужна только чтобы найти аккаунт по её отпечатку — в базу она не пишется.
const { config } = require('../server/config');
const U = require('../server/util');
const { openDb } = require('../server/db');

const [email, rawNick] = process.argv.slice(2);
if (!email || !rawNick) { console.error('Использование: set-nick.js почта@mts.ru НовыйНик'); process.exit(1); }
if (!config.emailPepper) { console.error('Нет EMAIL_PEPPER — запускай внутри контейнера app.'); process.exit(1); }
const nick = rawNick.trim().replace(/^@+/, '');
if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]{3,20}$/.test(nick)) { console.error('Ник: от 3 до 20 символов, буквы, цифры и «_».'); process.exit(1); }

const db = openDb(config.dbPath);
const user = db.prepare('SELECT id, nick FROM users WHERE email_hash = ?').get(U.hashEmail(email));
if (!user) { console.error('Аккаунт с этой почтой не найден.'); process.exit(1); }
const low = nick.toLocaleLowerCase('ru');
const taken = db.prepare('SELECT nick FROM users WHERE nick IS NOT NULL AND id != ?').all(user.id).some((r) => r.nick.toLocaleLowerCase('ru') === low);
if (taken) { console.error(`Ник «${nick}» уже занят.`); process.exit(1); }
db.prepare('UPDATE users SET nick = ? WHERE id = ?').run(nick, user.id);
console.log(`Готово: ${user.nick || '(без ника)'} → ${nick}`);
