const crypto = require('node:crypto');
const { config } = require('./config');

const now = () => Date.now();

// Московское время: UTC+3 без летнего времени
function msk(ts = now()) {
  const d = new Date(ts + config.tzOffsetHours * 3600e3);
  return {
    day: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    hhmm: d.toISOString().slice(11, 16)
  };
}

// Начало «отметочного» окна: отметки в офисе действуют до 19:00 МСК
function isAfterCheckinCutoff(ts = now()) {
  return msk(ts).hour >= 19;
}

function isQuietHour(ts = now()) {
  const h = msk(ts).hour;
  return h >= 19 || h < 9;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const randomToken = (bytes = 32) => b64url(crypto.randomBytes(bytes));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashEmail(email) {
  return crypto.createHmac('sha256', config.emailPepper).update(normalizeEmail(email)).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Компания по домену почты. Домены из ALLOWED_DOMAINS, которых нет в списке компаний, считаем МТС
function companyByEmail(email) {
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return null;
  const domain = e.split('@')[1];
  const { COMPANIES } = require('./catalog');
  for (const [id, c] of Object.entries(COMPANIES)) if (c.domains.includes(domain)) return id;
  for (const [id, c] of Object.entries(EXTRA_COMPANIES)) if (c.domains.includes(domain)) return id;
  return config.allowedDomains.includes(domain) ? 'mts' : null;
}
// Компании, открытые модератором по заявкам (лежат в базе, подгружаются при старте и после решения)
let EXTRA_COMPANIES = {};
function setExtraCompanies(map) { EXTRA_COMPANIES = map || {}; }
function companyInfo(id) { const { COMPANIES } = require('./catalog'); return COMPANIES[id] || EXTRA_COMPANIES[id] || null; }
function emailDomainAllowed(email) { return !!companyByEmail(email); }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function shortCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

// --- Модерация текста ---
// Латиница, похожая на кириллицу, и цифры-подмены приводятся к кириллице до проверки
const LOOKALIKE = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', '0': 'о', '3': 'з', '6': 'б' };
// Мягкие корни ловим только в начале слова: иначе «барсук», «плохо» и «процедура» не проходят модерацию.
// Жёсткий мат ловим где угодно, даже если его разбили пробелами или точками.
const STOP_ROOTS = ['дурак', 'дура', 'идиот', 'тупо', 'тупиц', 'лох', 'урод', 'дебил', 'кретин', 'против', 'мраз', 'чмо', 'сук', 'гнид'];
const HARD_ROOTS = ['бляд', 'хуй', 'хуе', 'пизд', 'ебан', 'жоп'];

function normalizeForFilter(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split('')
    .map((ch) => LOOKALIKE[ch] || ch)
    .join('');
}

function moderationProblem(text, { allowAt = false } = {}) {
  const raw = String(text || '');
  if (!allowAt && raw.includes('@')) return 'Через @ никого упоминать нельзя.';
  const n = normalizeForFilter(raw);
  // Слова: точки, дефисы и звёздочки внутри слова не разделяют его («Ду.р.ак»)
  const words = n.split(/[\s,;:!?()«»"'\/\\]+/).map((w) => w.replace(/[^а-яa-z]/g, '')).filter(Boolean);
  if (words.some((w) => STOP_ROOTS.some((r) => w.startsWith(r)))) return 'Такой текст не пройдёт модерацию.';
  if (words.some((w) => HARD_ROOTS.some((r) => w.includes(r)))) return 'Такой текст не пройдёт модерацию.';
  // «х у й»: слово разбили по буквам — склеиваем подряд идущие однобуквенные куски
  const runs = [];
  let run = '';
  for (const w of n.split(/\s+/).map((x) => x.replace(/[^а-яa-z]/g, ''))) { if (w.length === 1) run += w; else { if (run) runs.push(run); run = ''; } }
  if (run) runs.push(run);
  const spaced = runs;
  if (spaced.some((w) => w.length >= 3 && [...HARD_ROOTS, ...STOP_ROOTS].some((r) => w.includes(r)))) return 'Такой текст не пройдёт модерацию.';
  return null;
}

function cleanText(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Женский род в текстах: пол берём из аватара (preset 'f'). look — объект или JSON-строка
function fem(look) {
  if (!look) return false;
  if (typeof look === 'string') { try { look = JSON.parse(look); } catch { return false; } }
  return look.preset === 'f';
}
// g(look, 'вступил', 'вступила')
const g = (look, m, f) => (fem(look) ? f : m);

// Герб банды для клиента: собранный (или null — клиент соберёт сам из того, что объединяет, интересов и id)
function crestPub(row) {
  let crest = null, interests = [];
  try { crest = row.crest ? JSON.parse(row.crest) : null; } catch {}
  try { interests = JSON.parse(row.interests || '[]'); } catch {}
  let style = {};
  try { style = row.style ? JSON.parse(row.style) : {}; } catch {}
  return { crest, area: row.area || null, interests, style };
}

// ---------- Шифрование текста переписки в базе (AES-256-GCM) ----------
// Ключ — MSG_KEY из .env или выводится из EMAIL_PEPPER (HKDF). В базе и бэкапах его нет:
// утёк файл базы — переписку не прочитать. Сервер при этом видит текст (модерация, пуши работают).
// Формат: «e1:» + base64url(iv[12] | tag[16] | шифротекст). Без префикса — старый открытый текст.
let msgKey = null;
function key() {
  if (msgKey) return msgKey;
  const raw = process.env.MSG_KEY;
  msgKey = raw && raw.length >= 32
    ? crypto.createHash('sha256').update(raw).digest()
    : Buffer.from(crypto.hkdfSync('sha256', config.emailPepper || 'dev-pepper', 'etazh', 'etazh-msg-v1', 32));
  return msgKey;
}
function seal(text) {
  if (text === null || text === undefined || text === '') return text;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'e1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
function unseal(v) {
  if (typeof v !== 'string' || !v.startsWith('e1:')) return v;
  try {
    const b = Buffer.from(v.slice(3), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return '[не удалось расшифровать]'; }
}

module.exports = { companyByEmail, setExtraCompanies, companyInfo, seal, unseal,
  fem, g, crestPub,
  now, msk, isAfterCheckinCutoff, isQuietHour,
  b64url, fromB64url, randomToken, sha256, hashEmail, normalizeEmail, emailDomainAllowed, shortCode,
  moderationProblem, cleanText
};
