// Минимальный SMTP-клиент без зависимостей: SSL (465), STARTTLS (587), AUTH LOGIN.
// Нужен только для одного письма — ссылки входа. Адрес получателя нигде не сохраняется.
const net = require('node:net');
const tls = require('node:tls');
const { config } = require('./config');

function encodeHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function encodeFrom(from) {
  const m = /^(.*)<(.+)>$/.exec(from.trim());
  if (!m) return { header: from, address: from };
  const name = m[1].trim().replace(/^"|"$/g, '');
  return { header: `${encodeHeader(name)} <${m[2]}>`, address: m[2] };
}

function buildMessage({ from, to, subject, text }) {
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const date = new Date().toUTCString().replace('GMT', '+0000');
  const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${from.address.split('@')[1] || 'localhost'}>`;
  return [
    `From: ${from.header}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date}`,
    `Message-ID: ${msgId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body
  ].join('\r\n');
}

class SmtpSession {
  constructor(socket) {
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    this.buffer = '';
    this.waiters = [];
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
  }

  flush() {
    // Ответ SMTP завершается строкой вида «250 текст» (без дефиса после кода)
    while (this.waiters.length) {
      const lines = this.buffer.split('\r\n');
      const idx = lines.findIndex((l) => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
      if (idx === -1) return;
      const reply = lines.slice(0, idx + 1);
      this.buffer = lines.slice(idx + 1).join('\r\n');
      const code = Number(reply[idx].slice(0, 3));
      this.waiters.shift()({ code, text: reply.join('\n') });
    }
  }

  read() {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.flush();
    });
  }

  async cmd(line, expect) {
    if (line !== null) this.socket.write(line + '\r\n');
    const r = await this.read();
    if (!expect.includes(r.code)) throw new Error(`SMTP: на «${line ? line.split(' ')[0] : 'приветствие'}» сервер ответил ${r.text}`);
    return r;
  }
}

function connect({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure === 'ssl'
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.setTimeout(20000, () => socket.destroy(new Error('SMTP: таймаут')));
    socket.once('error', reject);
  });
}

async function sendSmtp({ to, subject, text }, smtp = config.smtp) {
  const from = encodeFrom(smtp.from);
  const socket = await connect(smtp);
  const s = new SmtpSession(socket);
  try {
    await s.cmd(null, [220]);
    const ehloName = (config.baseUrl.replace(/^https?:\/\//, '').split('/')[0] || 'localhost').split(':')[0];
    await s.cmd(`EHLO ${ehloName}`, [250]);
    if (smtp.secure === 'starttls') {
      await s.cmd('STARTTLS', [220]);
      const secured = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: smtp.host }, () => resolve(t));
        t.once('error', reject);
      });
      s.attach(secured);
      await s.cmd(`EHLO ${ehloName}`, [250]);
    }
    if (smtp.user) {
      await s.cmd('AUTH LOGIN', [334]);
      await s.cmd(Buffer.from(smtp.user).toString('base64'), [334]);
      await s.cmd(Buffer.from(smtp.pass).toString('base64'), [235]);
    }
    await s.cmd(`MAIL FROM:<${from.address}>`, [250]);
    await s.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await s.cmd('DATA', [354]);
    const data = buildMessage({ from, to, subject, text }).replace(/^\./gm, '..');
    await s.cmd(`${data}\r\n.`, [250]);
    s.socket.write('QUIT\r\n');
  } finally {
    setTimeout(() => s.socket.destroy(), 200);
  }
}

async function sendLoginLink(email, link, code) {
  const subject = 'Вход в Этаж';
  const text = [
    'Привет!',
    '',
    'Чтобы войти в Этаж, открой ссылку на телефоне:',
    link,
    '',
    `Или введи код в приложении: ${code}`,
    '',
    'Ссылка и код работают 15 минут и только один раз.',
    'Если ты не запрашивал вход — просто удали это письмо.',
    '',
    'Этаж — неофициальное приложение для коллег. Мы не храним твою почту: после входа остаётся только её зашифрованный отпечаток.'
  ].join('\n');
  if (config.mailMode === 'console') {
    console.log(`[mail:console] Ссылка входа: ${link} · код ${code}`);
    return;
  }
  await sendSmtp({ to: email, subject, text });
}

module.exports = { sendLoginLink, sendSmtp, buildMessage };
