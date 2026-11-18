// Заявки на новый офис. У каждого офиса два поля: город и название.
// Человек из офиса, которого нет в списке (Москва или регион), пишет город и название — модератор добавляет.
// Одинаковые заявки от разных людей склеиваются: модератор видит одну строку и число просивших.

const crypto = require('node:crypto');

const COLORS = ['#2F7FD1', '#1F9E8A', '#E0892B', '#C8553D', '#7C5CFF', '#3E8E41', '#D14F8C', '#4A6FA5'];

function register(ctx) {
  const { db, q, route, U, bad, rateLimit, notify, fireAndForget, requireUser, requireAdmin, adminIds, companyOf } = ctx;
  db.exec(`
  CREATE TABLE IF NOT EXISTS office_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, company TEXT NOT NULL,
    city TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', office_id TEXT, created_at INTEGER NOT NULL, decided_at INTEGER,
    UNIQUE (user_id, key)
  );
  CREATE INDEX IF NOT EXISTS office_requests_st ON office_requests (status, company);
  `);
  const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const norm = (s) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[«»"'.,]/g, '').replace(/\s+/g, ' ').trim();
  const keyOf = (company, city, name) => company + '|' + norm(city) + '|' + norm(name);
  const exists = (company, city, name) => q('SELECT id, name, city FROM offices WHERE company = ?').all(company)
    .find((o) => norm(o.name) === norm(name) && norm(o.city || '') === norm(city));
  const mine = (uid) => q("SELECT id, city, name, status, created_at AS at FROM office_requests WHERE user_id = ? AND (status = 'pending' OR decided_at > ?) ORDER BY id DESC LIMIT 5")
    .all(uid, U.now() - 14 * 864e5);

  route('GET', '/api/office-requests', async (req) => ({ items: mine(requireUser(req).id) }));

  route('POST', '/api/office-requests', async (req, body) => {
    const u = requireUser(req);
    const city = clean(body.city, 40), name = clean(body.name, 40);
    if (city.length < 2 || name.length < 2) throw bad('Напиши город и название офиса — хотя бы по два символа.');
    const company = companyOf(u);
    if (exists(company, city, name)) throw bad('Такой офис уже есть в списке — поищи его по названию.');
    const key = keyOf(company, city, name);
    const old = q('SELECT id, status FROM office_requests WHERE user_id = ? AND key = ?').get(u.id, key);
    if (old && old.status === 'pending') return { ok: true, dup: true, items: mine(u.id) };
    rateLimit('office-req:' + u.id, 3, 864e5);
    if (old) q("UPDATE office_requests SET status = 'pending', city = ?, name = ?, created_at = ?, decided_at = NULL, office_id = NULL WHERE id = ?").run(city, name, U.now(), old.id);
    else q('INSERT INTO office_requests (user_id, company, city, name, key, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, company, city, name, key, U.now());
    // Модератору — один пуш на новую заявку; на «я тоже отсюда» не шумим
    if (q("SELECT COUNT(*) AS n FROM office_requests WHERE key = ? AND status = 'pending'").get(key).n === 1) {
      fireAndForget(notify(adminIds(), { title: 'Заявка на офис', body: `${city}, «${name}» — просят добавить в список`, url: '/admin.html' }));
    }
    return { ok: true, items: mine(u.id) };
  });

  route('GET', '/api/admin/office-requests', async (req) => {
    requireAdmin(req);
    return {
      items: q(`SELECT key, company, MIN(city) AS city, MIN(name) AS name, COUNT(*) AS people, MIN(created_at) AS at
                FROM office_requests WHERE status = 'pending' GROUP BY key ORDER BY at`).all()
    };
  });

  const askers = (key) => q("SELECT id, user_id FROM office_requests WHERE key = ? AND status = 'pending'").all(key);

  // Добавить офис: модератор может поправить город и название (опечатки, «мск» → «Москва»)
  route('POST', '/api/admin/office-requests/approve', async (req, body) => {
    requireAdmin(req);
    const rows = askers(String(body.key || ''));
    if (!rows.length) throw bad('Такой заявки нет.');
    const first = q('SELECT * FROM office_requests WHERE id = ?').get(rows[0].id);
    const city = clean(body.city, 40) || first.city, name = clean(body.name, 40) || first.name;
    if (city.length < 2 || name.length < 2) throw bad('Нужны город и название.');
    let o = exists(first.company, city, name);
    if (!o) {
      const id = 'o' + crypto.randomBytes(4).toString('hex');
      const n = q('SELECT COUNT(*) AS n, COALESCE(MAX(sort), 0) AS s FROM offices WHERE company = ?').get(first.company);
      q('INSERT INTO offices (id, name, city, seats, share_p, lunch_w, color, sort, company) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, name, city, 250, 0.3, 25, COLORS[n.n % COLORS.length], n.s + 10, first.company);
      o = { id, name, city };
    }
    q("UPDATE office_requests SET status = 'done', office_id = ?, decided_at = ? WHERE key = ? AND status = 'pending'").run(o.id, U.now(), body.key);
    fireAndForget(notify(rows.map((r) => r.user_id), { title: 'Офис добавлен', body: `${o.city}, «${o.name}» теперь в списке — можно отмечаться`, url: '/' }));
    return { ok: true, office: o, people: rows.length };
  });

  route('POST', '/api/admin/office-requests/reject', async (req, body) => {
    requireAdmin(req);
    const rows = askers(String(body.key || ''));
    if (!rows.length) throw bad('Такой заявки нет.');
    q("UPDATE office_requests SET status = 'rejected', decided_at = ? WHERE key = ? AND status = 'pending'").run(U.now(), body.key);
    return { ok: true };
  });

  return {};
}

module.exports = { register };
