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
  seed(db);
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
