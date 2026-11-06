// Секретный чат один на один: сквозное шифрование (end-to-end).
// Ключи создаются в браузере (ECDH P-256), закрытый ключ не покидает устройство и не извлекается даже скриптом.
// Сервер хранит только открытые ключи и шифротекст — прочитать переписку он не может.
// Цена: нет модерации текста и текста в пушах; новое устройство — новый ключ, старые секретные сообщения на нём не прочитать.
// Сообщения живут 7 дней.

const TTL_DAYS = 7;
const CT_MAX = 6000;      // base64url шифротекста (≈ 4 КБ текста)
const KEY_MAX = 400;

function register(ctx) {
  const { db, q, route, requireUser, bad, U, notify, fireAndForget, HttpError, rateLimit, canDm } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS e2e_keys (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pub TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS secret_msgs (
    id INTEGER PRIMARY KEY,
    lo INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hi INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    iv TEXT NOT NULL, ct TEXT NOT NULL, kfp TEXT NOT NULL,
    at INTEGER NOT NULL, read_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS secret_pair ON secret_msgs(lo, hi, at);
  `);

  const pair = (a, b) => (a < b ? [a, b] : [b, a]);
  const b64 = /^[A-Za-z0-9_-]+$/;
  // Открытый ключ — JWK EC P-256: только x и y, без закрытой части
  function cleanPub(p) {
    let k;
    try { k = typeof p === 'string' ? JSON.parse(p) : p; } catch { return null; }
    if (!k || k.kty !== 'EC' || k.crv !== 'P-256' || !b64.test(k.x || '') || !b64.test(k.y || '') || k.d) return null;
    const out = JSON.stringify({ kty: 'EC', crv: 'P-256', x: k.x, y: k.y });
    return out.length <= KEY_MAX ? out : null;
  }
  const keyOf = (uid) => q('SELECT pub, at FROM e2e_keys WHERE user_id = ?').get(uid) || null;
  const userOr404 = (id) => {
    const t = q('SELECT * FROM users WHERE id = ? AND nick IS NOT NULL').get(Number(id));
    if (!t) throw new HttpError(404, 'Собеседник не найден.');
    return t;
  };

  route('POST', '/api/e2e/key', async (req, body) => {
    const u = requireUser(req);
    const pub = cleanPub(body.pub);
    if (!pub) throw bad('Неверный ключ.');
    const was = keyOf(u.id);
    q('INSERT INTO e2e_keys (user_id, pub, at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET pub = excluded.pub, at = excluded.at').run(u.id, pub, U.now());
    return { ok: true, replaced: !!(was && was.pub !== pub) };
  });

  route('GET', '/api/secret/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    const t = userOr404(params.id);
    const [lo, hi] = pair(u.id, t.id);
    const rows = q('SELECT * FROM secret_msgs WHERE lo = ? AND hi = ? AND at > ? ORDER BY at ASC LIMIT 300').all(lo, hi, U.now() - TTL_DAYS * 864e5);
    q('UPDATE secret_msgs SET read_at = ? WHERE lo = ? AND hi = ? AND to_id = ? AND read_at IS NULL').run(U.now(), lo, hi, u.id);
    return {
      mine: keyOf(u.id), theirs: keyOf(t.id), canWrite: canDm ? canDm(u, t) : true, ttlDays: TTL_DAYS,
      items: rows.map((m) => ({ id: m.id, mine: m.from_id === u.id, iv: m.iv, ct: m.ct, kfp: m.kfp, at: m.at, time: U.msk(m.at).hhmm, read: !!m.read_at }))
    };
  });

  route('POST', '/api/secret/:id', async (req, body, query, params) => {
    const u = requireUser(req);
    const t = userOr404(params.id);
    if (t.id === u.id) throw bad('Себе писать не нужно.');
    if (canDm && !canDm(u, t)) throw bad('Этому человеку сейчас нельзя написать.');
    rateLimit('secret:' + u.id, 30, 60e3);
    const iv = String(body.iv || ''), ct = String(body.ct || ''), kfp = String(body.kfp || '');
    if (!b64.test(iv) || iv.length > 24 || !b64.test(ct) || ct.length > CT_MAX || !/^[0-9a-f]{16}$/.test(kfp)) throw bad('Сообщение повреждено.');
    if (!keyOf(t.id)) throw bad(U.g(t.look, 'Собеседник ещё не открывал секретный чат.', 'Собеседница ещё не открывала секретный чат.'));
    const [lo, hi] = pair(u.id, t.id);
    q('INSERT INTO secret_msgs (lo, hi, from_id, to_id, iv, ct, kfp, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(lo, hi, u.id, t.id, iv, ct, kfp, U.now());
    // В пуше — ничего из текста: сервер его и не знает
    fireAndForget(notify([t.id], { title: u.nick, body: 'Секретное сообщение', url: `/#secret/${u.id}`, tag: `secret-${u.id}` }));
    return { ok: true };
  });

  // Непрочитанные секретные — для счётчика
  const unread = (uid) => q('SELECT COUNT(*) AS n FROM secret_msgs WHERE to_id = ? AND read_at IS NULL AND at > ?').get(uid, U.now() - TTL_DAYS * 864e5).n;
  function cleanup() { q('DELETE FROM secret_msgs WHERE at < ?').run(U.now() - TTL_DAYS * 864e5); }

  return { cleanup, unread };
}

module.exports = { register };
