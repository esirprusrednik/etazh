// Заявки компаний, которых ещё нет в Этаже.
// Человек вводит рабочую почту незнакомого домена → мы просим подтвердить ящик письмом → только подтверждённая
// заявка попадает к модератору. Модератор видит домен и число людей (не адреса), открывает компанию или отказывает.
// Адреса хранятся зашифрованными только до решения (и не дольше 30 дней): нужны, чтобы прислать ссылку для входа.

const { sendAccessCheck, sendInvite } = require('./mailer');
const crypto = require('node:crypto');

// Личная почта не годится: так спамеры не завалят модератора заявками с бесплатных ящиков
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yandex.ru', 'yandex.com', 'ya.ru', 'yandex.by', 'yandex.kz', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'internet.ru', 'rambler.ru', 'lenta.ru',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'ymail.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'aol.com', 'zoho.com', 'tutanota.com', 'mail.com', 'qip.ru', 'ro.ru']);
const KEEP_MS = 30 * 864e5;

function register(ctx) {
  const { db, q, route, U, config, bad, HttpError, rateLimit, notify, fireAndForget, requireAdmin, adminIds } = ctx;
  db.exec(`
  CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domains TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS access_tokens (token_hash TEXT PRIMARY KEY, domain TEXT NOT NULL, email_sealed TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS access_requests (email_hash TEXT PRIMARY KEY, domain TEXT NOT NULL, email_sealed TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS access_domains (domain TEXT PRIMARY KEY, status TEXT NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, notified_at INTEGER);
  `);
  const loadCompanies = () => U.setExtraCompanies(Object.fromEntries(q('SELECT * FROM companies').all().map((c) => [c.id, { name: c.name, domains: c.domains.split(',') }])));
  loadCompanies();

  // Вызывается из /api/auth/request, когда домен незнаком
  async function request(email, req) {
    const domain = email.split('@')[1] || '';
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw bad('Проверь адрес почты.');
    if (FREE_MAIL.has(domain)) throw bad('Нужна рабочая почта компании — личная (Gmail, Яндекс, Mail.ru и т. п.) не подойдёт.');
    const d = q('SELECT * FROM access_domains WHERE domain = ?').get(domain);
    if (d && d.status === 'rejected') throw bad('Для этой компании Этаж пока не открыт.');
    rateLimit('access-ip:' + req.ip, 5, 3600e3);
    rateLimit('access-domain:' + domain, 30, 864e5);
    if (q('SELECT COUNT(*) AS n FROM access_requests WHERE domain = ?').get(domain).n >= 50) throw bad('От твоей компании уже много заявок — модератор скоро ответит.');
    const token = U.randomToken(32);
    q('INSERT INTO access_tokens (token_hash, domain, email_sealed, expires_at) VALUES (?, ?, ?, ?)').run(U.sha256(token), domain, U.seal(email), U.now() + 864e5);
    const link = `${config.baseUrl}/auth/access?t=${token}`;
    try { await sendAccessCheck(email, link); } catch (e) {
      console.error('[mail] заявка не отправлена:', String(e.message).replace(/[^\s<>@]+@[^\s<>@]+/g, '***'));
      throw new HttpError(502, 'Не удалось отправить письмо. Попробуй через пару минут.');
    }
    return { ok: true, access: true, devLink: config.mailMode === 'console' ? link : undefined };
  }

  // Переход по ссылке из письма: заявка подтверждена — модератору уходит уведомление (не чаще раза в сутки на домен)
  function confirm(token) {
    const t = token && q('SELECT * FROM access_tokens WHERE token_hash = ?').get(U.sha256(String(token)));
    if (!t || t.expires_at < U.now()) return false;
    q('DELETE FROM access_tokens WHERE token_hash = ?').run(t.token_hash);
    const email = U.unseal(t.email_sealed);
    if (U.companyByEmail(email)) return true; // компанию уже открыли
    q('INSERT INTO access_requests (email_hash, domain, email_sealed, at) VALUES (?, ?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET at = excluded.at')
      .run(U.hashEmail(email), t.domain, t.email_sealed, U.now());
    q(`INSERT INTO access_domains (domain, status, first_at, last_at) VALUES (?, 'pending', ?, ?) ON CONFLICT(domain) DO UPDATE SET last_at = excluded.last_at`).run(t.domain, U.now(), U.now());
    const d = q('SELECT * FROM access_domains WHERE domain = ?').get(t.domain);
    if (!d.notified_at || d.notified_at < U.now() - 864e5) {
      q('UPDATE access_domains SET notified_at = ? WHERE domain = ?').run(U.now(), t.domain);
      const n = q('SELECT COUNT(*) AS n FROM access_requests WHERE domain = ?').get(t.domain).n;
      fireAndForget(notify(adminIds(), { title: 'Заявка в Этаж', body: `Компания с почтой @${t.domain} просит открыть Этаж · человек: ${n}`, url: '/admin.html', tag: 'access-' + t.domain }));
    }
    return true;
  }

  route('GET', '/api/admin/access', async (req) => {
    requireAdmin(req);
    return {
      requests: q(`SELECT d.domain, d.status, d.first_at, d.last_at, (SELECT COUNT(*) FROM access_requests r WHERE r.domain = d.domain) AS people
                   FROM access_domains d WHERE d.status = 'pending' ORDER BY d.last_at DESC`).all(),
      companies: q('SELECT id, name, domains, created_at FROM companies ORDER BY created_at DESC').all()
    };
  });

  // Открыть компанию: название и первый офис. Всем, кто ждал, — письмо со ссылкой для входа, адреса удаляем
  route('POST', '/api/admin/access/open', async (req, body) => {
    requireAdmin(req);
    const domain = String(body.domain || '').toLowerCase();
    const name = String(body.name || '').trim().slice(0, 40), office = String(body.office || '').trim().slice(0, 40);
    if (!q("SELECT 1 FROM access_domains WHERE domain = ? AND status = 'pending'").get(domain)) throw bad('Заявки с этим доменом нет.');
    if (name.length < 2 || office.length < 2) throw bad('Нужны название компании и офиса.');
    const id = 'c' + crypto.createHash('sha256').update(domain).digest('hex').slice(0, 8);
    q('INSERT OR IGNORE INTO companies (id, name, domains, created_at) VALUES (?, ?, ?, ?)').run(id, name, domain, U.now());
    const oid = 'o' + id.slice(1, 7);
    q('INSERT OR IGNORE INTO offices (id, name, seats, share_p, lunch_w, color, sort, company) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(oid, office, 250, 0.3, 25, '#7C5CFF', 10, id);
    q("UPDATE access_domains SET status = 'open' WHERE domain = ?").run(domain);
    loadCompanies();
    const pending = q('SELECT * FROM access_requests WHERE domain = ?').all(domain);
    let sent = 0;
    for (const r of pending) {
      const email = U.unseal(r.email_sealed);
      const token = U.randomToken(32), code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      q('INSERT INTO login_tokens (token_hash, email_hash, code_hash, expires_at, company) VALUES (?, ?, ?, ?, ?)')
        .run(U.sha256(token), r.email_hash, U.sha256(r.email_hash + ':' + code), U.now() + 864e5, id);
      try { await sendInvite(email, `${config.baseUrl}/auth/verify?t=${token}`, code); sent++; } catch (e) { console.error('[mail] приглашение не отправлено'); }
    }
    q('DELETE FROM access_requests WHERE domain = ?').run(domain);
    return { ok: true, company: id, sent };
  });

  route('POST', '/api/admin/access/reject', async (req, body) => {
    requireAdmin(req);
    const domain = String(body.domain || '').toLowerCase();
    q("UPDATE access_domains SET status = 'rejected' WHERE domain = ?").run(domain);
    q('DELETE FROM access_requests WHERE domain = ?').run(domain);
    return { ok: true };
  });

  // Уборка: просроченные токены и заявки старше 30 дней (вместе с зашифрованными адресами)
  setInterval(() => {
    try {
      q('DELETE FROM access_tokens WHERE expires_at < ?').run(U.now());
      q('DELETE FROM access_requests WHERE at < ?').run(U.now() - KEEP_MS);
    } catch {}
  }, 3600e3).unref();

  return { request, confirm };
}

module.exports = { register, FREE_MAIL };
