// Настройки берутся из переменных окружения (.env в docker-compose).
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const config = {
  port: Number(env('PORT', 3000)),
  // Публичный адрес приложения, например https://etazh.example.ru — нужен для ссылок входа и пушей
  baseUrl: env('BASE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  dbPath: env('DB_PATH', './data/etazh.sqlite'),
  // Секрет для хеширования почты. Сменить его = потерять связь со всеми аккаунтами.
  emailPepper: env('EMAIL_PEPPER', ''),
  allowedDomains: env('ALLOWED_DOMAINS', 'mts.ru').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Администраторы — по почте; в базе хранится только хеш
  adminEmails: env('ADMIN_EMAILS', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Почта: console — ссылка пишется в лог (для разработки); smtp — реальная отправка
  mailMode: env('MAIL_MODE', 'console'),
  smtp: {
    host: env('SMTP_HOST', ''),
    port: Number(env('SMTP_PORT', 465)),
    secure: env('SMTP_SECURE', 'ssl'), // ssl (465) | starttls (587) | none (только для тестов)
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('SMTP_FROM', 'Этаж <no-reply@example.ru>')
  },
  vapid: {
    publicKey: env('VAPID_PUBLIC_KEY', ''),
    privateKey: env('VAPID_PRIVATE_KEY', ''),
    subject: env('VAPID_SUBJECT', 'mailto:admin@example.ru')
  },
  secureCookies: env('SECURE_COOKIES', 'true') === 'true',
  sessionDays: Number(env('SESSION_DAYS', 90)),
  loginTokenMinutes: 15,
  // Москва, без перехода на летнее время. Менять только для тестов.
  tzOffsetHours: Number(env('TZ_OFFSET_HOURS', 3)),
  // Приветственные зёрна. 50 = сразу хватает на залог банды в первый день пилота
  welcomeBeans: Number(env('WELCOME_BEANS', 50))
};

function assertConfig() {
  const problems = [];
  if (!config.emailPepper || config.emailPepper.length < 32) problems.push('EMAIL_PEPPER: нужна случайная строка от 32 символов (scripts/gen-secrets.js)');
  if (config.mailMode === 'smtp' && !config.smtp.host) problems.push('SMTP_HOST не задан при MAIL_MODE=smtp');
  return problems;
}

module.exports = { config, assertConfig };
