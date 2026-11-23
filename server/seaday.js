'use strict';
// Задача дня в морском бою. Один флот на весь Этаж, новый каждый день в полночь по Москве.
// Человек играет один: топит флот и считает выстрелы — чем меньше, тем выше в таблице. Попытка одна.
// Расстановку знает только сервер: она считается из даты и секрета сервера, клиенту приходят лишь результаты выстрелов.
const crypto = require('crypto');
const { randomFleet, fire, sunkShips, FLEET, N } = require('./battle');

// Генератор случайных чисел с зерном (mulberry32): один и тот же день — один и тот же флот у всех
function seeded(seedStr) {
  let a = crypto.createHash('sha256').update(seedStr).digest().readUInt32LE(0);
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SECRET = process.env.EMAIL_PEPPER || process.env.MSG_KEY || 'etazh-seaday';
const fleetOf = (day) => randomFleet(seeded(`seaday:${day}:${SECRET}`));

function register(ctx) {
  const { db, q, route, requireUser, bad, U, publicLook, addBeans } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS sea_daily (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL,
    shots TEXT NOT NULL DEFAULT '[]', n INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, done_at INTEGER,
    PRIMARY KEY (user_id, day)); CREATE INDEX IF NOT EXISTS sea_daily_day ON sea_daily(day, done, n)`);
  const cache = new Map();
  const ships = (day) => { if (!cache.has(day)) { cache.clear(); cache.set(day, fleetOf(day)); } return cache.get(day); };
  const row = (uid, day) => q('SELECT * FROM sea_daily WHERE user_id = ? AND day = ?').get(uid, day);

  function view(u) {
    const day = U.msk().day, r = row(u.id, day), fleet = ships(day);
    const shots = r ? JSON.parse(r.shots) : [];
    const done = !!(r && r.done), n = r ? r.n : 0;
    // Таблица — только свои: те, с кем человек в одной банде. По всему Этажу — лишь место и число игроков, без имён
    const mates = q(`SELECT u.id, u.nick, u.look, u.profile, d.n FROM sea_daily d JOIN users u ON u.id = d.user_id
      WHERE d.day = ? AND d.done = 1 AND (u.id = ? OR u.id IN (SELECT m2.user_id FROM gang_members m1 JOIN gang_members m2 ON m2.gang_id = m1.gang_id WHERE m1.user_id = ?))
      ORDER BY d.n, d.done_at LIMIT 10`).all(day, u.id, u.id);
    const players = q('SELECT COUNT(*) AS c FROM sea_daily WHERE day = ? AND done = 1').get(day).c;
    const place = done ? q('SELECT COUNT(*) AS c FROM sea_daily WHERE day = ? AND done = 1 AND (n < ? OR (n = ? AND done_at < ?))').get(day, n, n, r.done_at).c + 1 : null;
    const best = q('SELECT MIN(n) AS b FROM sea_daily WHERE user_id = ? AND done = 1').get(u.id).b;
    return {
      day, shots, n, done, fleet: FLEET, sunk: sunkShips(fleet, shots), ships: done ? fleet : null,
      left: fleet.length - sunkShips(fleet, shots).length, players, place, best: best || null,
      top: mates.map((m) => ({ id: m.id, nick: m.nick, look: publicLook(m), n: m.n, me: m.id === u.id }))
    };
  }

  route('GET', '/api/sea-daily', async (req) => view(requireUser(req)));

  route('POST', '/api/sea-daily/shoot', async (req, body) => {
    const u = requireUser(req);
    const day = U.msk().day, x = Number(body.x), y = Number(body.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= N || y >= N) throw bad('Мимо поля.');
    const r = row(u.id, day);
    if (r && r.done) throw bad('Сегодняшний флот уже на дне. Завтра будет новый.');
    const shots = r ? JSON.parse(r.shots) : [];
    let res;
    try { res = fire(ships(day), shots, x, y); } catch { throw bad('Сюда уже стреляли.'); }
    shots.push(...res.add);
    const n = (r ? r.n : 0) + 1, done = res.allSunk ? 1 : 0;
    q(`INSERT INTO sea_daily (user_id, day, shots, n, done, done_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET shots = excluded.shots, n = excluded.n, done = excluded.done, done_at = excluded.done_at`)
      .run(u.id, day, JSON.stringify(shots), n, done, done ? U.now() : null);
    const beans = done ? addBeans(u.id, 'seaday') : 0;
    return { result: res.result, beans, view: view(u) };
  });

  // Старые дни не нужны: таблица показывает только сегодня, личный рекорд — за месяц
  function cleanup() { q('DELETE FROM sea_daily WHERE day < ?').run(new Date(U.now() - 35 * 864e5).toISOString().slice(0, 10)); }
  return { cleanup, view };
}

module.exports = { register, fleetOf };
