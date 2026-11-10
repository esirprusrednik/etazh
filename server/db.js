// SQLite из стандартной поставки Node 22 (node:sqlite) — без внешних зависимостей.
// На пилот до нескольких сотен человек этого достаточно; бэкап = копия одного файла.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  // Тип события для фильтра ленты (старые записи определяются по тексту)
  try { db.exec('ALTER TABLE events ADD COLUMN kind TEXT'); } catch {}
  // Профиль банды: описание, что объединяет (колонка area), интересы, доступ и настройки
  for (const col of ["about TEXT", "area TEXT", "interests TEXT", "emoji TEXT", "access TEXT NOT NULL DEFAULT 'invite'", "max_members INTEGER NOT NULL DEFAULT 0", "who_invites TEXT NOT NULL DEFAULT 'all'", "office_id TEXT", "legend_month TEXT", "crest TEXT"]) {
    try { db.exec(`ALTER TABLE gangs ADD COLUMN ${col}`); } catch {}
  }
  db.exec(`CREATE TABLE IF NOT EXISTS gang_requests (gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY (gang_id, user_id))`);
  // Лавка для банды: флаг над офисом, гудок; пицца на всю банду
  for (const col of ['flag INTEGER NOT NULL DEFAULT 0', 'horn INTEGER NOT NULL DEFAULT 0']) { try { db.exec(`ALTER TABLE gangs ADD COLUMN ${col}`); } catch {} }
  db.exec(`CREATE TABLE IF NOT EXISTS gang_pizza (id INTEGER PRIMARY KEY, gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE, by_id INTEGER NOT NULL, slices INTEGER NOT NULL, at INTEGER NOT NULL, until INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS gang_pizza_taken (pizza_id INTEGER NOT NULL REFERENCES gang_pizza(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (pizza_id, user_id));`);
  // Одна бесплатная смена ника для каждого — в том числе для тех, кто уже менял за зёрна
  try { db.exec('ALTER TABLE users ADD COLUMN nick_free_used INTEGER NOT NULL DEFAULT 0'); } catch {}
  // Компания: у всех, кто был до Роснефти, — МТС. Почту не храним, компанию определяем по домену при регистрации
  for (const t of ['users', 'gangs', 'offices', 'login_tokens']) { try { db.exec(`ALTER TABLE ${t} ADD COLUMN company TEXT NOT NULL DEFAULT 'mts'`); } catch {} }
  // Ники раньше хранились с «@» впереди — убираем знак (разово, повторный запуск ничего не меняет)
  db.exec("UPDATE users SET nick = substr(nick, 2) WHERE nick LIKE '@%'");
  // Банда — не оргструктура: старые «направления» по подразделениям снимаем («По интересам» → «Просто свои»)
  {
    const { OLD_GANG_AREAS } = require('./catalog');
    db.prepare("UPDATE gangs SET area = 'Просто свои' WHERE area = 'По интересам'").run();
    db.prepare(`UPDATE gangs SET area = NULL WHERE area IN (${OLD_GANG_AREAS.map(() => '?').join(',')})`).run(...OLD_GANG_AREAS);
  }
  seed(db);
  // Офис Роснефти
  db.prepare("INSERT OR IGNORE INTO offices (id, name, seats, share_p, lunch_w, color, sort, company) VALUES ('sof', 'Софийка', 250, 0.3, 25, '#F4C430', 10, 'rosneft')").run();
  return db;
}

function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

  -- Почта НЕ хранится: только HMAC-хеш для входа и проверки дублей
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email_hash TEXT NOT NULL UNIQUE,
    nick TEXT UNIQUE,
    nick_changed_at INTEGER,
    created_at INTEGER NOT NULL,
    consent_at INTEGER NOT NULL,
    beans INTEGER NOT NULL DEFAULT 0,
    welcomed INTEGER NOT NULL DEFAULT 0,
    look TEXT NOT NULL DEFAULT '{}',
    profile TEXT NOT NULL DEFAULT '{}',
    share_office INTEGER NOT NULL DEFAULT 0,
    quiet INTEGER NOT NULL DEFAULT 1,
    banned_until INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_tokens (
    token_hash TEXT PRIMARY KEY,
    email_hash TEXT NOT NULL,
    code_hash TEXT,                  -- 6-значный код из письма (для входа внутри установленного приложения)
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS offices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seats INTEGER NOT NULL,          -- мест в столовой
    share_p REAL NOT NULL,           -- доля сотрудников с приложением (калибруется)
    lunch_w REAL NOT NULL,           -- среднее время обеда, мин
    color TEXT NOT NULL,
    sort INTEGER NOT NULL
  );

  -- Отметка в офисе живёт один день; вчерашние удаляются
  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    office_id TEXT NOT NULL REFERENCES offices(id),
    day TEXT NOT NULL,
    at INTEGER NOT NULL,
    left_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS checkins_day ON checkins(day, office_id);

  -- Чекины столовой: через сутки user_id обнуляется, время хранится 30 дней для калибровки
  CREATE TABLE IF NOT EXISTS canteen (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    office_id TEXT NOT NULL REFERENCES offices(id),
    at INTEGER NOT NULL,
    done_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS canteen_office_at ON canteen(office_id, at);

  CREATE TABLE IF NOT EXISTS gangs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL,
    motto TEXT,
    motto_owned INTEGER NOT NULL DEFAULT 0,
    gold INTEGER NOT NULL DEFAULT 0,
    code TEXT NOT NULL UNIQUE,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deposit INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gang_members (
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (gang_id, user_id)
  );

  -- Сообщения и зовы живут 24 часа
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,              -- text | call
    kind TEXT,                       -- coffee | lunch | room | home | call | where | online | wait
    to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    opt TEXT,
    text TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_gang_at ON messages(gang_id, at);

  CREATE TABLE IF NOT EXISTS replies (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    day TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ledger_user_day ON ledger(user_id, day, reason);

  CREATE TABLE IF NOT EXISTS owned (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY,
    office_id TEXT NOT NULL REFERENCES offices(id),
    type TEXT NOT NULL,
    zone TEXT,
    comment TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS signal_votes (
    signal_id INTEGER NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote INTEGER NOT NULL,           -- 1 = подтверждаю, -1 = уже не актуально
    PRIMARY KEY (signal_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    office_id TEXT REFERENCES offices(id),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL
  );

  -- Приглашения в банду из поиска: человек сам решает, вступать ли
  CREATE TABLE IF NOT EXISTS gang_invites (
    id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
    from_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | declined
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS gang_invites_to ON gang_invites(to_id, status);

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    object_type TEXT NOT NULL,       -- gang | message | signal
    object_id INTEGER NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    at INTEGER NOT NULL,
    UNIQUE (reporter_id, object_type, object_id)
  );
  `);
}

function seed(db) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM offices').get().n;
  if (n > 0) return;
  // Места в столовых и доля пользователей — стартовые значения, калибруются в админке
  const ins = db.prepare('INSERT INTO offices (id, name, seats, share_p, lunch_w, color, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run('smol', 'Смоленка', 220, 0.3, 25, '#E5484D', 1);
  ins.run('mark', 'Марксистская', 120, 0.3, 25, '#3A86FF', 2);
  ins.run('vor', 'Воронцовка', 260, 0.3, 25, '#F4A72C', 3);
}

module.exports = { openDb };
