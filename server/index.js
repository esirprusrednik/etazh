// Точка входа: HTTP-сервер без фреймворков. Перед ним стоит Caddy (HTTPS).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { config, assertConfig } = require('./config');
const { openDb } = require('./db');
const { createApi, HttpError } = require('./api');

const problems = assertConfig();
if (problems.length) {
  console.error('Конфигурация неполная:\n- ' + problems.join('\n- '));
  process.exit(1);
}

const db = openDb(config.dbPath);
const api = createApi(db);
const PUBLIC = path.join(__dirname, '..', 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, obj, extra = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
}

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(PUBLIC, 'index.html'); // SPA: всё неизвестное → index.html
    const ext = path.extname(target);
    const cache = ext === '.html' || path.basename(target) === 'sw.js' ? 'no-cache' : 'public, max-age=3600';
    fs.readFile(target, (e, buf) => {
      if (e) return send(res, 404, 'Not found');
      send(res, 200, buf, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
    });
  });
}

const server = http.createServer(async (req, res) => {
  // IP нужен только для ограничения частоты запросов, в базу не пишется
  req.ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  const query = Object.fromEntries(url.searchParams);

  try {
    if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });

    if (pathname === '/auth/verify' && req.method === 'GET') {
      const cookie = api.verifyLogin(query.t);
      if (!cookie) return send(res, 302, '', { Location: '/?login=expired' });
      return send(res, 302, '', { Location: '/', 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
    }

    // Ссылка-приглашение в банду: etazh.example.ru/g/ABC123
    const g = /^\/g\/([A-Za-z0-9]{6})$/.exec(pathname);
    if (g) return send(res, 302, '', { Location: `/#join=${g[1].toUpperCase()}` });

    if (pathname.startsWith('/api/')) {
      const result = await api.handle(req, res, pathname, query);
      const extra = {};
      if (result && result._setCookie) { extra['Set-Cookie'] = result._setCookie; delete result._setCookie; }
      return sendJson(res, 200, result, extra);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(res, pathname);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    return sendJson(res, 500, { error: 'Что-то сломалось. Попробуй ещё раз.' });
  }
});

api.cleanup();
setInterval(() => {
  try { api.cleanup(); } catch (e) { console.error('[cleanup]', e); }
}, 10 * 60e3).unref();

server.listen(config.port, () => {
  console.log(`Этаж слушает :${config.port} (${config.baseUrl}), почта: ${config.mailMode}, пуши: ${config.vapid.publicKey ? 'вкл' : 'выкл'}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { server };
