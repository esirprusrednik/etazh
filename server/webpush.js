// Web Push без зависимостей: подпись VAPID (RFC 8292) и шифрование aes128gcm (RFC 8291).
// Содержимое пуша шифруется ключом браузера — сервисы Apple/Google видят только зашифрованный блок.
const crypto = require('node:crypto');
const { config } = require('./config');
const { b64url, fromB64url } = require('./util');

function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwkPub = publicKey.export({ format: 'jwk' });
  const jwkPriv = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), fromB64url(jwkPub.x), fromB64url(jwkPub.y)]);
  return { publicKey: b64url(raw), privateKey: jwkPriv.d };
}

function vapidPrivateKeyObject(publicKeyB64, privateKeyB64) {
  const raw = fromB64url(publicKeyB64);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)), d: privateKeyB64 },
    format: 'jwk'
  });
}

function vapidHeader(endpoint, vapid = config.vapid) {
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKeyObject(vapid.publicKey, vapid.privateKey),
    dsaEncoding: 'ieee-p1363'
  });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${vapid.publicKey}`;
}

function encryptPayload(subscription, payloadText) {
  const uaPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plaintext = Buffer.concat([Buffer.from(payloadText, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, encrypted]);
}

// Расшифровка — только для тестов (так браузер читает пуш)
function decryptPayload(body, uaPrivateKey, uaPublic, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivateKey);
  const sharedSecret = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  return out.subarray(0, out.lastIndexOf(2)).toString('utf8');
}

// Возвращает { ok, gone } — gone=true значит подписка умерла и её нужно удалить
async function sendPush(subscription, payload, { ttl = 3600, urgency = 'normal' } = {}) {
  if (!config.vapid.publicKey || !config.vapid.privateKey) return { ok: false, gone: false, skipped: true };
  const body = encryptPayload(subscription, JSON.stringify(payload));
  try {
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidHeader(subscription.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency
      },
      body
    });
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch (e) {
    return { ok: false, gone: false, error: e.message };
  }
}

module.exports = { generateVapidKeys, vapidHeader, encryptPayload, decryptPayload, sendPush };
