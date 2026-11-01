// Идеи и ошибки: человек пишет из профиля, модератор отвечает в админке.
// Зёрна — не за отправку (иначе будет спам), а когда идею взяли в работу или баг подтвердили.
// К сообщению прикладываются только версия приложения и тип устройства/браузера — чтобы воспроизвести ошибку.

const KINDS = ['idea', 'bug'];
const STATUSES = ['new', 'planned', 'done', 'declined'];
const STATUS_NAMES = { new: 'на рассмотрении', planned: 'взяли в работу', done: 'сделано', declined: 'не будем делать' };
const PER_DAY = 5;
const REWARD = 10;          // за принятую идею или подтверждённый баг, один раз на сообщение
const TTL_DAYS = 180;

// Грубо и без версий: этого хватает, чтобы понять, где ломается, и не собирать «отпечаток» браузера
function deviceOf(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'другое';
  const br = /YaBrowser/.test(ua) ? 'Яндекс' : /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'другой';
  return `${os} · ${br}`;
}

function register(ctx) {
  const { db, q, route, requireUser, requireAdmin, bad, U, addBeans, notify, fireAndForget, HttpError, BUILD } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, text TEXT NOT NULL, tab TEXT, device TEXT, build TEXT,
    status TEXT NOT NULL DEFAULT 'new', reply TEXT, rewarded INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL, reply_at INTEGER, seen INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS feedback_user ON feedback(user_id, at);
  `);

  const view = (r) => ({ id: r.id, kind: r.kind, text: r.text, status: r.status, statusName: STATUS_NAMES[r.status], reply: r.reply || '', at: r.at, replyAt: r.reply_at, unseen: !r.seen, rewarded: !!r.rewarded });

  route('POST', '/api/feedback', async (req, body) => {
    const u = requireUser(req);
    const kind = KINDS.includes(body.kind) ? body.kind : 'idea';
    const text = U.cleanText(body.text || '', 1000);
    if (text.length < 5) throw bad('Напиши хотя бы пару слов.');
    const since = U.now() - 864e5;
    if (q('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND at > ?').get(u.id, since).n >= PER_DAY) throw bad('На сегодня хватит — завтра можно ещё.');
    const tab = String(body.tab || '').slice(0, 20);
    q('INSERT INTO feedback (user_id, kind, text, tab, device, build, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(u.id, kind, text, tab, deviceOf(req.headers['user-agent']), BUILD, U.now());
    return { ok: true, items: mine(u.id) };
  });

  const mine = (uid) => q('SELECT * FROM feedback WHERE user_id = ? ORDER BY at DESC LIMIT 20').all(uid).map(view);

  route('GET', '/api/feedback', async (req) => {
    const u = requireUser(req);
    const items = mine(u.id);
    q('UPDATE feedback SET seen = 1 WHERE user_id = ? AND seen = 0').run(u.id);
    return { items };
  });

  route('GET', '/api/admin/feedback', async (req) => {
    requireAdmin(req);
    const rows = q(`SELECT f.*, u.nick FROM feedback f LEFT JOIN users u ON u.id = f.user_id
      ORDER BY CASE f.status WHEN 'new' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, f.at DESC LIMIT 100`).all();
    return { items: rows.map((r) => ({ ...view(r), nick: r.nick || 'удалённый аккаунт', device: r.device, build: r.build, tab: r.tab })), statuses: STATUS_NAMES, reward: REWARD };
  });

  route('POST', '/api/admin/feedback/:id', async (req, body, query, params) => {
    requireAdmin(req);
    const f = q('SELECT * FROM feedback WHERE id = ?').get(Number(params.id));
    if (!f) throw new HttpError(404, 'Сообщение не найдено.');
    const status = STATUSES.includes(body.status) ? body.status : f.status;
    const reply = body.reply == null ? f.reply : U.cleanText(body.reply, 500);
    const changed = status !== f.status || (reply || '') !== (f.reply || '');
    let rewarded = f.rewarded;
    let beans = 0;
    if (!rewarded && f.user_id && ['planned', 'done'].includes(status)) {
      beans = addBeans(f.user_id, 'feedback', REWARD) || 0;
      rewarded = 1;
    }
    q('UPDATE feedback SET status = ?, reply = ?, rewarded = ?, reply_at = ?, seen = ? WHERE id = ?')
      .run(status, reply || null, rewarded, changed ? U.now() : f.reply_at, changed ? 0 : f.seen, f.id);
    if (changed && f.user_id) {
      const what = f.kind === 'bug' ? 'твоё сообщение об ошибке' : 'твою идею';
      const body = `${STATUS_NAMES[status][0].toUpperCase() + STATUS_NAMES[status].slice(1)}${beans ? ` · +${beans} зёрен` : ''}${reply ? ' — ' + reply.slice(0, 80) : ''}`;
      fireAndForget(notify([f.user_id], { title: `Ответили на ${what}`, body, url: '/#feedback', tag: 'feedback-' + f.id }, { ignoreQuiet: false }));
    }
    return { ok: true, beans };
  });

  const unseen = (uid) => q('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND seen = 0').get(uid).n;

  function cleanup() {
    q('DELETE FROM feedback WHERE at < ?').run(U.now() - TTL_DAYS * 864e5);
  }

  return { cleanup, unseen };
}

module.exports = { register, deviceOf };
