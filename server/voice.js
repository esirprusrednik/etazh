// Голосовые сообщения: до 30 секунд, хранятся 1 час, потом звук стирается навсегда.
// Звук лежит отдельно от сообщения: в чате остаётся плашка «голосовое 0:12 — сгорело».
// Послушать может только тот, кто видит переписку: член банды или один из двоих в личке.
// Ссылка на звук — случайный токен, но и с токеном чужой не послушает: доступ проверяется по сессии.
// Расшифровку и модерацию звука не делаем: сервер его не анализирует, только хранит час и отдаёт.

const MAX_SEC = 30;
const TTL_MS = 3600e3;
const MAX_BYTES = 400 * 1024;   // 30 секунд Opus ~ 120 КБ, AAC на iPhone ~ 250 КБ — с запасом
const MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/mpeg'];
const PER_HOUR = 30;

function register(ctx) {
  const { db, q, route, requireUser, bad, U, HttpError, isMember, rateLimit } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS voice (
    token TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    gang_id INTEGER, lo INTEGER, hi INTEGER,
    mime TEXT NOT NULL, dur INTEGER NOT NULL, data BLOB NOT NULL,
    at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS voice_exp ON voice(expires_at);
  `);

  // Проверка и сохранение. Вызывается из маршрутов сообщений банды и лички.
  function store(userId, where, body) {
    rateLimit('voice:' + userId, PER_HOUR, 3600e3);
    const mime = String(body.mime || '').split(';')[0].trim().toLowerCase();
    if (!MIMES.includes(mime)) throw bad('Этот формат звука не поддерживается.');
    const dur = Math.round(Number(body.dur));
    if (!(dur >= 1 && dur <= MAX_SEC + 1)) throw bad(`Голосовое — от 1 до ${MAX_SEC} секунд.`);
    if (typeof body.audio !== 'string' || body.audio.length > MAX_BYTES * 1.4) throw bad('Голосовое слишком большое.');
    const data = Buffer.from(body.audio, 'base64');
    if (data.length < 200 || data.length > MAX_BYTES) throw bad('Голосовое пустое или слишком большое.');
    const token = U.randomToken(18);
    const t = U.now();
    q('INSERT INTO voice (token, user_id, gang_id, lo, hi, mime, dur, data, at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(token, userId, where.gangId || null, where.lo || null, where.hi || null, mime, Math.min(dur, MAX_SEC), data, t, t + TTL_MS);
    return { token, dur: Math.min(dur, MAX_SEC) };
  }

  // Для ленты: живо ли ещё и сколько осталось
  function info(token) {
    const v = token ? q('SELECT expires_at, mime FROM voice WHERE token = ?').get(token) : null;
    return v && v.expires_at > U.now() ? { token, mime: v.mime, left: v.expires_at - U.now() } : null;
  }

  route('GET', '/api/voice/:token', async (req, body, query, params) => {
    const u = requireUser(req);
    const v = q('SELECT * FROM voice WHERE token = ?').get(String(params.token));
    if (!v || v.expires_at <= U.now()) throw new HttpError(410, 'Голосовое сгорело: они живут час.');
    const ok = v.gang_id ? isMember(v.gang_id, u.id) : (u.id === v.lo || u.id === v.hi);
    if (!ok) throw new HttpError(404, 'Не найдено.');
    return { _raw: { body: Buffer.from(v.data), headers: { 'Content-Type': v.mime, 'Cache-Control': 'private, no-store' } } };
  });

  function cleanup() {
    q('DELETE FROM voice WHERE expires_at <= ?').run(U.now());
  }
  setInterval(() => { try { cleanup(); } catch (e) { console.error('voice', e); } }, 60e3).unref();

  return { store, info, cleanup, MAX_SEC, TTL_MS };
}

module.exports = { register };
