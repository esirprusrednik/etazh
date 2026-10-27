// Проверка шифрования пушей и SMTP-клиента без внешних сервисов: node tests/unit.js
process.env.EMAIL_PEPPER = 'x'.repeat(40);
process.env.BASE_URL = 'https://etazh.example.ru';
const crypto = require('node:crypto');
const net = require('node:net');
const assert = require('node:assert/strict');
const { generateVapidKeys, vapidHeader, encryptPayload, decryptPayload } = require('../server/webpush');
const { sendSmtp } = require('../server/mailer');
const { b64url, fromB64url, moderationProblem, emailDomainAllowed } = require('../server/util');

(async () => {
  // 1. Пуш: шифруем как сервер, расшифровываем как браузер
  const ua = crypto.createECDH('prime256v1');
  const uaPub = ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64url(uaPub), auth: b64url(auth) };
  const text = JSON.stringify({ title: 'Пятничный кофе', body: '@бодрый_енот зовёт на кофе' });
  const body = encryptPayload(sub, text);
  assert.equal(decryptPayload(body, ua.getPrivateKey(), uaPub, auth), text);
  console.log('  ✓ пуш: шифрование aes128gcm туда-обратно');

  // 2. VAPID: подпись проверяется публичным ключом
  const keys = generateVapidKeys();
  const hdr = vapidHeader(sub.endpoint, { ...keys, subject: 'mailto:a@b.ru' });
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(hdr);
  const raw = fromB64url(m[4]);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, fromB64url(m[3])));
  assert.equal(JSON.parse(fromB64url(m[2])).aud, 'https://fcm.googleapis.com');
  console.log('  ✓ пуш: подпись VAPID');

  // 3. SMTP против локального фейкового сервера
  const got = [];
  const srv = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let buf = '';
    let inData = false;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        got.push(line);
        if (inData) { if (line === '.') { inData = false; sock.write('250 queued\r\n'); } continue; }
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (got.length && got[got.length - 2] === 'AUTH LOGIN') sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (Buffer.from(line, 'base64').toString() === 'secret') sock.write('235 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => srv.listen(0, r));
  await sendSmtp({ to: 'anna@mts.ru', subject: 'Вход в Этаж', text: 'Ссылка: https://x/y\n.точка в начале' },
    { host: '127.0.0.1', port: srv.address().port, secure: 'none', user: 'bot', pass: 'secret', from: 'Этаж <no-reply@etazh.example.ru>' });
  srv.close();
  assert.ok(got.includes('RCPT TO:<anna@mts.ru>'));
  assert.ok(got.some((l) => l.startsWith('Subject: =?UTF-8?B?')));
  console.log('  ✓ SMTP: AUTH LOGIN, письмо в UTF-8');

  // 4. Фильтры
  assert.ok(moderationProblem('Банда прoтив отдела')); // латинская «o»
  assert.ok(moderationProblem('Ду.р.ак'));
  assert.equal(moderationProblem('Пятничный кофе'), null);
  assert.ok(moderationProblem('привет @коллега'));
  assert.ok(emailDomainAllowed('a@mts.ru'));
  assert.ok(!emailDomainAllowed('a@mts.ru.evil.com'));
  assert.ok(!emailDomainAllowed('a@sub.mts.ru'));
  console.log('  ✓ модерация и домены');
  console.log('\nВсё прошло');
})().catch((e) => { console.error('Провал:', e); process.exitCode = 1; });
