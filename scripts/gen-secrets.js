process.env.EMAIL_PEPPER = process.env.EMAIL_PEPPER || 'x'.repeat(32);
// Генерирует секреты для .env: node scripts/gen-secrets.js >> .env
const crypto = require('node:crypto');
const { generateVapidKeys } = require('../server/webpush');
const v = generateVapidKeys();
console.log(`EMAIL_PEPPER=${crypto.randomBytes(32).toString('base64url')}`);
console.log(`VAPID_PUBLIC_KEY=${v.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${v.privateKey}`);
console.error('\nСохраните EMAIL_PEPPER отдельно (например, в менеджере паролей). Если он потеряется, все пользователи станут «новыми».');
