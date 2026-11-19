// Телеграм: события банды уходят в её группу. Только в одну сторону и только события —
// Санта, войны банд, встречи, опросы, турнир. Переписка чата, зовы и личка в Телеграм не попадают,
// из Телеграма в «Этаж» не приходит ничего, кроме команды привязки.
// Храним одно: номер группы на банду. Кто из людей в Телеграме — не знаем и не спрашиваем.
// Включается переменной TG_BOT_TOKEN (бота заводит владелец сервера у @BotFather). Нет токена — раздела нет.

const crypto = require('node:crypto');

let announceImpl = () => {};
// Другие модули зовут require('./tg').announce(gangId, text) рядом со своей записью в чат банды
const announce = (gid, text) => { try { announceImpl(gid, text); } catch { /* Телеграм не должен ронять событие */ } };

function register(ctx) {
  const { db, q, route, U, config, bad, HttpError, rateLimit, requireUser, isMember, fireAndForget } = ctx;
  const token = process.env.TG_BOT_TOKEN || '';
  const api = (process.env.TG_API || 'https://api.telegram.org').replace(/\/$/, '');
  const on = !!token;
  const secret = on ? crypto.createHmac('sha256', token).update('etazh-webhook').digest('hex') : '';
  let bot = process.env.TG_BOT_NAME || '';

  db.exec(`
  CREATE TABLE IF NOT EXISTS gang_tg (gang_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, title TEXT, linked_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS gang_tg_codes (code_hash TEXT PRIMARY KEY, gang_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  `);

  async function call(method, payload) {
    const res = await fetch(`${api}/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
    });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, ok: !!j.ok, result: j.result };
  }
  const say = (chatId, text) => call('sendMessage', { chat_id: chatId, text: text.slice(0, 900), disable_web_page_preview: true });

  // Не чаще одного сообщения в 3 секунды на группу: пачка событий войны не превращается в спам
  const queue = new Map();
  function send(gid, text) {
    const row = q('SELECT chat_id FROM gang_tg WHERE gang_id = ?').get(gid);
    if (!row) return;
    const at = Math.max(Date.now(), (queue.get(gid) || 0) + 3000);
    queue.set(gid, at);
    setTimeout(() => {
      fireAndForget((async () => {
        const r = await say(row.chat_id, `${text}\n\n${config.baseUrl}/#gang`);
        // Бота выгнали из группы или группу удалили — отвязываем, чтобы не стучаться впустую
        if (r.status === 403 || (r.status === 400 && !r.ok)) q('DELETE FROM gang_tg WHERE gang_id = ? AND chat_id = ?').run(gid, row.chat_id);
      })());
    }, at - Date.now()).unref();
  }
  if (on) announceImpl = send;

  const gangOr404 = (id, uid) => {
    const g = q('SELECT id, name, owner_id FROM gangs WHERE id = ? AND hidden = 0').get(Number(id));
    if (!g || !isMember(g.id, uid)) throw new HttpError(404, 'Банда не найдена.');
    return g;
  };
  const view = (g, uid) => {
    const l = q('SELECT title, linked_at FROM gang_tg WHERE gang_id = ?').get(g.id);
    return { on, bot, owner: g.owner_id === uid, linked: l ? { title: l.title || 'группа', at: l.linked_at } : null };
  };

  route('GET', '/api/gangs/:id/tg', async (req, body, query, params) => { const u = requireUser(req); return view(gangOr404(params.id, u.id), u.id); });

  // Код привязки: владелец получает его в приложении и пишет в группе «/etazh КОД». Живёт 15 минут, одноразовый
  route('POST', '/api/gangs/:id/tg/code', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    if (!on) throw bad('Телеграм на этом Этаже не подключён.');
    if (g.owner_id !== u.id) throw bad('Подключить группу может только владелец банды.');
    rateLimit('tg-code:' + u.id, 6, 3600e3);
    const code = crypto.randomBytes(5).toString('hex').toUpperCase();
    q('DELETE FROM gang_tg_codes WHERE gang_id = ? OR expires_at < ?').run(g.id, U.now());
    q('INSERT INTO gang_tg_codes (code_hash, gang_id, expires_at) VALUES (?, ?, ?)').run(U.sha256(code), g.id, U.now() + 15 * 60e3);
    return { ...view(g, u.id), code };
  });

  route('POST', '/api/gangs/:id/tg/unlink', async (req, body, query, params) => {
    const u = requireUser(req);
    const g = gangOr404(params.id, u.id);
    if (g.owner_id !== u.id) throw bad('Отключить группу может только владелец банды.');
    const row = q('SELECT chat_id FROM gang_tg WHERE gang_id = ?').get(g.id);
    q('DELETE FROM gang_tg WHERE gang_id = ?').run(g.id);
    if (row && on) fireAndForget(say(row.chat_id, `Банда «${g.name}» отключила события «Этажа». Бота можно убрать из группы.`));
    return view(g, u.id);
  });

  // Сюда стучится Телеграм. Из входящего читаем одно: команду привязки в группе. Остальное выбрасываем не глядя
  route('POST', '/api/tg/hook', async (req, body) => {
    const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
    if (!on || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) throw new HttpError(404, 'Не найдено.');
    const m = body && body.message;
    const chat = m && m.chat;
    const text = m && typeof m.text === 'string' ? m.text : '';
    const cmd = /^\/etazh(?:@\w+)?(?:\s+([0-9A-Fa-f]{10}))?\s*$/.exec(text.trim());
    if (!chat || !cmd) return { ok: true };
    const id = String(chat.id);
    if (chat.type !== 'group' && chat.type !== 'supergroup') { fireAndForget(say(id, 'Добавь меня в группу банды и напиши там: /etazh КОД. Код — в настройках банды в «Этаже».')); return { ok: true }; }
    if (!cmd[1]) { fireAndForget(say(id, 'Нужен код: /etazh КОД. Владелец банды берёт его в «Этаже»: настройки банды → Телеграм.')); return { ok: true }; }
    try { rateLimit('tg-try:' + id, 8, 3600e3); } catch { return { ok: true }; }
    const row = q('SELECT gang_id FROM gang_tg_codes WHERE code_hash = ? AND expires_at > ?').get(U.sha256(cmd[1].toUpperCase()), U.now());
    if (!row) { fireAndForget(say(id, 'Код не подошёл или устарел — он живёт 15 минут. Возьми новый в настройках банды.')); return { ok: true }; }
    q('DELETE FROM gang_tg_codes WHERE gang_id = ?').run(row.gang_id);
    q('INSERT INTO gang_tg (gang_id, chat_id, title, linked_at) VALUES (?, ?, ?, ?) ON CONFLICT(gang_id) DO UPDATE SET chat_id = excluded.chat_id, title = excluded.title, linked_at = excluded.linked_at')
      .run(row.gang_id, id, U.cleanText(chat.title, 60) || null, U.now());
    const g = q('SELECT name FROM gangs WHERE id = ?').get(row.gang_id);
    fireAndForget(say(id, `Готово: банда «${g ? g.name : ''}» подключена. Сюда будут приходить события — Тайный Санта, войны банд, встречи, опросы, турнир. Переписку из «Этажа» я не пересылаю и сообщения этой группы не читаю.`));
    return { ok: true };
  });

  // При старте: узнаём имя бота и говорим Телеграму, куда слать команды. Не вышло — раздел просто покажет ошибку позже
  if (on && /^https:/.test(config.baseUrl)) {
    fireAndForget((async () => {
      const me = await call('getMe', {});
      if (me.ok && me.result && me.result.username) bot = me.result.username;
      const r = await call('setWebhook', { url: `${config.baseUrl}/api/tg/hook`, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
      console.log(r.ok ? `Телеграм: бот @${bot} подключён` : `Телеграм: не удалось поставить вебхук (HTTP ${r.status})`);
    })());
  } else if (on) {
    fireAndForget((async () => { const me = await call('getMe', {}); if (me.ok && me.result && me.result.username) bot = me.result.username; })());
  }

  return { on, send };
}

module.exports = { register, announce };
