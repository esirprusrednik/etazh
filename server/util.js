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

function emailDomainAllowed(email) {
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return false;
  const domain = e.split('@')[1];
  return config.allowedDomains.includes(domain);
}

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
const STOP_ROOTS = ['дурак', 'дура', 'идиот', 'тупо', 'тупиц', 'лох', 'урод', 'дебил', 'кретин', 'против', 'мраз', 'чмо', 'сук', 'бляд', 'хуй', 'хуё', 'пизд', 'ебан', 'ёбан', 'жоп', 'гнид'];

function normalizeForFilter(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split('')
    .map((ch) => LOOKALIKE[ch] || ch)
    .join('')
    .replace(/[^а-яa-z]/g, '');
}

function moderationProblem(text, { allowAt = false } = {}) {
  const raw = String(text || '');
  if (!allowAt && raw.includes('@')) return 'Нельзя упоминать коллег через @.';
  const n = normalizeForFilter(raw);
  if (STOP_ROOTS.some((r) => n.includes(r.replace(/ё/g, 'е')))) return 'Такой текст не пройдёт модерацию.';
  return null;
}

function cleanText(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = {
  now, msk, isAfterCheckinCutoff, isQuietHour,
  b64url, fromB64url, randomToken, sha256, hashEmail, normalizeEmail, emailDomainAllowed, shortCode,
  moderationProblem, cleanText
};
