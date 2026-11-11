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
  for (const ok of ['хитрый барсук', 'Плохо слышно', 'процедура', 'ступор', 'Голосуем: кто за, кто нет', 'мах уехал', 'хлебать суп']) assert.equal(moderationProblem(ok), null, ok);
  for (const no of ['ты сука', 'х у й', 'Тупой дурачок', 'кретины']) assert.ok(moderationProblem(no), no);
  assert.ok(moderationProblem('привет @коллега'));
  assert.ok(emailDomainAllowed('a@mts.ru'));
  assert.ok(!emailDomainAllowed('a@mts.ru.evil.com'));
  assert.ok(!emailDomainAllowed('a@sub.mts.ru'));
  console.log('  ✓ модерация и домены');
  {
    const H = require('../server/holidays');
    const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
    for (const d of Object.keys(H.OFF)) assert.ok(dow(d) >= 1 && dow(d) <= 5, 'в OFF только будни: ' + d);
    // 2026: 14 праздничных будней (с переносами), 2027: 15 — сверено с постановлениями № 1466 и № 1187
    assert.equal(Object.keys(H.OFF).filter((d) => d.startsWith('2026')).length, 14);
    assert.equal(Object.keys(H.OFF).filter((d) => d.startsWith('2027')).length, 15);
    assert.equal(H.workdayName('2026-11-04'), null);
    assert.equal(H.workdayName('2026-11-03'), 'Вт');
    assert.equal(H.workdayName('2027-02-20'), 'Пн', 'рабочая суббота');
    assert.ok(H.isShort('2026-11-03'));
    console.log('  ✓ производственный календарь 2026–2027');
  }
  // go.sh качает только файлы из files.txt — забытый файл роняет сервер после обновления (502)
  {
    const fsx = require('node:fs'); const px = require('node:path');
    const root = px.join(__dirname, '..');
    const listed = new Set(fsx.readFileSync(px.join(root, 'files.txt'), 'utf8').split('\n').filter(Boolean));
    const walk = (d) => fsx.readdirSync(px.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
    const missing = ['server', 'public', 'scripts'].flatMap(walk).filter((f) => !listed.has(f));
    assert.deepEqual(missing, [], 'нет в files.txt: ' + missing.join(', '));
    console.log('  ✓ files.txt содержит все файлы сервера и клиента');
  }
  // Журнал изменений: валидный JSON, один день — одна запись, свежие сверху
  {
    const log = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'changelog.json'), 'utf8'));
    const days = log.map((d) => d.day);
    assert.ok(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
    assert.deepEqual(days, [...new Set(days)].sort().reverse(), 'дни без повторов, свежие сверху');
    assert.ok(log.every((d) => ['new', 'better', 'fix'].every((k) => Array.isArray(d[k])) && d.new.length + d.better.length + d.fix.length > 0));
    console.log('  ✓ журнал изменений');
  }
  // Объёмные аватары: свой PNG туда-обратно, сборка из слоёв, окраска кожи, размеры, мусор во входе
  {
    const ava = require('../server/ava');
    const px = new Uint8ClampedArray(7 * 5 * 4).map((_, i) => (i * 37 + (i >> 3) * 11) & 255);
    const back = ava.decodePng(ava.encodePng(7, 5, px));
    assert.equal(back.w, 7); assert.equal(back.ch, 4);
    assert.deepEqual([...back.data], [...px]);
    assert.ok(ava.available(), 'слои аватаров на месте');
    const look = { skin: '#8D5A3B', hair: '#F4C430', hairStyle: 'bald', hoodie: 'red', outfit: 'tee', eyes: '#3A7BD5' };
    const img = ava.decodePng(ava.render(look, 192));
    assert.equal(img.w, 192); assert.equal(img.h, 192);
    const at = (x, y) => [...img.data.subarray((y * 192 + x) * 4, (y * 192 + x) * 4 + 4)];
    const forehead = at(96, 48);
    assert.equal(forehead[3], 255);
    assert.ok(Math.abs(forehead[0] - 0x8D) < 40 && Math.abs(forehead[2] - 0x3B) < 40 && forehead[0] > forehead[2] + 40, 'лоб в тоне кожи: ' + forehead);
    const chest = at(96, 180);
    assert.ok(chest[0] > chest[1] + 60 && chest[0] > chest[2] + 60, 'футболка красная: ' + chest);
    assert.equal(at(2, 2)[3], 0, 'угол прозрачный');
    assert.equal(ava.decodePng(ava.render(look, 40)).w, 96);
    assert.equal(ava.decodePng(ava.render(look, 9999)).w, 400);
    assert.equal(ava.render(look, 192), ava.render({ ...look }, 192), 'одинаковый образ — из памяти');
    // чужие значения не роняют сборку и не попадают в имена слоёв
    const spec = ava.lookToSpec({ hairStyle: '../../etc', outfit: { a: 1 }, skin: 'red', hat: '__proto__', prop: 'constructor', eyes: '#12' });
    assert.ok(spec.names.every((n) => /^[a-z]+_?[a-z0-9_]*$/.test(n)), spec.names.join());
    assert.ok(ava.render({ hairStyle: '../../etc', hat: '__proto__', prop: 'constructor', pet: 'toString' }, 96).length > 500);
    // рыцарский шлем прячет волосы, бороду, маску и серьги; маска аквалангиста — очки
    const kn = ava.lookToSpec({ hat: 'knight', hairStyle: 'long', beard: 'beard', mask: 'medical', earrings: 'hoops', glasses: true }).names;
    assert.ok(!kn.some((n) => /^(h|bd|mk|er|g)_/.test(n)), kn.join());
    assert.ok(!ava.lookToSpec({ mask: 'scuba', glasses: true }).names.some((n) => n.startsWith('g_')));
    assert.ok(ava.lookToSpec({ preset: 'f', prop: 'sign_lunch' }).names.includes('p_sign_lunch_f'));
    // каждый слой, который может назвать сборщик, есть в наборе
    const parts = ava.parts();
    const L = require('../server/api').LOOK;
    const miss = new Set();
    for (const [k, vals] of Object.entries({ hairStyle: L.hairStyle, eyeShape: L.eyeShape, mouth: L.mouth, beard: L.beard, browShape: L.browShape, nose: L.nose, outfit: L.outfit, neck: L.neck, hat: L.hat, mask: L.mask, prop: L.prop, pet: L.pet, earrings: L.earrings, glassesStyle: L.glassesStyle })) {
      for (const v of vals) for (const preset of ['m', 'f']) for (const n of ava.lookToSpec({ preset, glasses: true, [k]: v }).names) if (!parts[n] && !n.endsWith('_hand')) miss.add(n);
    }
    assert.deepEqual([...miss], [], 'нет слоёв: ' + [...miss].join(', '));
    // тонкая настройка меняет картинку: посадка и размер глаз, губы, пробор, макияж, родинка, возраст, золото
    const base = { hairStyle: 'side', neck: 'tie', preset: 'f' };
    const b0 = ava.render(base, 96);
    for (const ch of [{ eyeGap: 'wide' }, { eyeSize: 'l' }, { lips: 'full' }, { part: 'right' }, { makeup: 'evening' }, { makeup: 'lips' }, { mole: 'chin' }, { age: '1' }, { neck: 'tie_gold' }, { neck: 'tie_crooked' }]) {
      assert.ok(!ava.render({ ...base, ...ch }, 96).equals(b0), 'не влияет на картинку: ' + JSON.stringify(ch));
    }
    console.log('  ✓ объёмные аватары: PNG, сборка, окраска, размеры, защита от мусора, полнота набора');
  }
  console.log('\nВсё прошло');
})().catch((e) => { console.error('Провал:', e); process.exitCode = 1; });
