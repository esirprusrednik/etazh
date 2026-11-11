// Объёмные аватары: сервер собирает картинку из запечённых слоёв (server/ava/*.png + index.json).
// Зависимостей нет: PNG читаем и пишем сами через zlib. Слои готовит tools/art/pack.py — там же описан формат.
// Слой детали — это «цвет» (raw, готовые RGBA) и/или «тень» (tint: яркость + альфа), которую красим цветом из образа:
// кожа, волосы, радужка, одежда. Если есть оба, тень перекрашивает только свою часть цвета (радужку в глазу, ткань в одежде).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIR = path.join(__dirname, 'ava');
const SIZES = [96, 192, 400];
const CACHE_BYTES = 24 * 1024 * 1024;

// ---------- PNG ----------
function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('png: не PNG');
  let p = 8; let w = 0; let h = 0; let ct = 0;
  const idat = [];
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9];
      if (d[8] !== 8 || d[12] !== 0) throw new Error('png: нужен 8 бит без чересстрочности');
    } else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += len + 12;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error('png: неподдерживаемый тип цвета');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const ro = y * (stride + 1) + 1;
    const oo = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[oo + x - ch] : 0;
      const b = y ? out[oo + x - stride] : 0;
      let v = raw[ro + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const c = x >= ch && y ? out[oo + x - stride - ch] : 0;
        const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[oo + x] = v;
    }
  }
  return { w, h, ch, data: out };
}

function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'latin1');
  data.copy(b, 8);
  b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return b;
}

// RGBA → PNG. Фильтр Paeth на каждой строке: на плавных пластилиновых переливах сжимает заметно лучше «без фильтра»
function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const ro = y * (stride + 1);
    const so = y * stride;
    raw[ro] = 4;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[so + x - 4] : 0;
      const b = y ? rgba[so + x - stride] : 0;
      const c = x >= 4 && y ? rgba[so + x - stride - 4] : 0;
      const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c);
      raw[ro + 1 + x] = (rgba[so + x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 7 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- слои ----------
let PACK = null;
const atlases = new Map();
function pack() {
  if (!PACK) PACK = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  return PACK;
}
function atlas(fn) {
  let a = atlases.get(fn);
  if (!a) { a = decodePng(fs.readFileSync(path.join(DIR, path.basename(fn)))); atlases.set(fn, a); }
  return a;
}
const available = () => fs.existsSync(path.join(DIR, 'index.json'));

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h, def) => { const s = HEX.test(h || '') ? h : def; return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; };
const mul = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

// Окраска по «тени»: 170 в слое — это ровный тон, темнее — в тень, светлее — блик (примесь белого силой hi)
function lut(col, hi) {
  const t = new Uint8Array(768);
  for (let v = 0; v < 256; v++) {
    const s = v / 170;
    const lo = Math.pow(Math.min(1, s), 0.9);
    const up = Math.max(0, Math.min(1, s - 1)) * hi;
    for (let c = 0; c < 3; c++) { const o = (col[c] / 255) * lo; t[v * 3 + c] = Math.round(255 * Math.min(1, o + (1 - o) * up)); }
  }
  return t;
}

// Размытие прямоугольником в три прохода — близко к гауссу, считается бегущей суммой
function blur(A, w, h, sigma) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  const T = new Float32Array(A.length);
  const k = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0; const o = y * w;
      for (let x = -r; x < w; x++) {
        if (x + r < w) s += A[o + x + r];
        if (x - r - 1 >= 0) s -= A[o + x - r - 1];
        if (x >= 0) T[o + x] = s * k;
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y < h; y++) {
        if (y + r < h) s += T[(y + r) * w + x];
        if (y - r - 1 >= 0) s -= T[(y - r - 1) * w + x];
        if (y >= 0) A[y * w + x] = s * k;
      }
    }
  }
  return A;
}

function drawPart(cv, lay, S, name, colors, clip) {
  const P = pack();
  const p = P.parts[name];
  if (!p) return;
  // «Лепка» кожи под деталью (веки, складки): затемняем или высветляем уже нарисованное лицо
  if (p.mod) {
    const [fn, ax, ay, w, h, ox, oy] = p.mod;
    const A = atlas(fn);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = (A.data[((ay + y) * A.w + ax + x) * A.ch] - 128) / 250;
      if (r > -0.004 && r < 0.004) continue;
      const j = ((oy + y) * S + ox + x) * 4;
      for (let c = 0; c < 3; c++) cv[j + c] = r < 0 ? cv[j + c] * (1 + r) : cv[j + c] + (255 - cv[j + c]) * r * 0.5;
    }
  }
  let x0 = S; let y0 = S; let x1 = 0; let y1 = 0;
  const grow = (ox, oy, w, h) => { x0 = Math.min(x0, ox); y0 = Math.min(y0, oy); x1 = Math.max(x1, ox + w); y1 = Math.max(y1, oy + h); };
  if (p.raw) {
    const [fn, ax, ay, w, h, ox, oy] = p.raw;
    const A = atlas(fn);
    for (let y = 0; y < h; y++) {
      const src = ((ay + y) * A.w + ax) * 4;
      lay.set(A.data.subarray(src, src + w * 4), ((oy + y) * S + ox) * 4);
    }
    grow(ox, oy, w, h);
  }
  if (p.tint) {
    const [fn, ax, ay, w, h, ox, oy] = p.tint;
    const A = atlas(fn);
    const T = lut(colors[p.src] || colors.skin, p.hi == null ? 0.5 : p.hi);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((ay + y) * A.w + ax + x) * 2;
      const ta = A.data[i + 1];
      if (!ta) continue;
      const v = A.data[i] * 3;
      const j = ((oy + y) * S + ox + x) * 4;
      if (p.raw) {
        const ra = lay[j + 3];
        if (!ra) continue;
        const m = Math.min(1, ta / ra);
        lay[j] += (T[v] - lay[j]) * m; lay[j + 1] += (T[v + 1] - lay[j + 1]) * m; lay[j + 2] += (T[v + 2] - lay[j + 2]) * m;
      } else { lay[j] = T[v]; lay[j + 1] = T[v + 1]; lay[j + 2] = T[v + 2]; lay[j + 3] = ta; }
    }
    grow(ox, oy, w, h);
  }
  if (x1 <= x0) return;
  // Волосы под шапкой: в каждой колонке видно только то, что ниже края шапки
  if (clip && p.src === 'hair') {
    for (let x = x0; x < x1; x++) {
      const e = clip[x] - 1.8;
      for (let y = y0; y < y1; y++) {
        const f = (y - e + 1) / 2;
        if (f < 1) { const j = (y * S + x) * 4 + 3; lay[j] = f <= 0 ? 0 : lay[j] * f; }
      }
    }
  }
  // Мягкая тень детали на том, что под ней
  if (p.sh) {
    const [sigma, dy, dx, k] = p.sh;
    const m = Math.ceil(sigma * 3 + Math.max(Math.abs(dy), Math.abs(dx))) + 1;
    const bx0 = Math.max(0, x0 - m); const by0 = Math.max(0, y0 - m); const bx1 = Math.min(S, x1 + m); const by1 = Math.min(S, y1 + m);
    const bw = bx1 - bx0; const bh = by1 - by0;
    const A = new Float32Array(bw * bh);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) A[(y - by0) * bw + x - bx0] = lay[(y * S + x) * 4 + 3] / 255;
    blur(A, bw, bh, sigma);
    const sy = Math.round(dy); const sx = Math.round(dx);
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
      const j = (y * S + x) * 4;
      if (cv[j + 3] <= 127) continue;
      const yy = y - sy - by0; const xx = x - sx - bx0;
      if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue;
      const sh = A[yy * bw + xx] * k * (1 - lay[j + 3] / 255);
      if (sh < 0.003) continue;
      cv[j] *= 1 - sh; cv[j + 1] *= 1 - sh; cv[j + 2] *= 1 - sh;
    }
  }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const j = (y * S + x) * 4;
    const la = lay[j + 3];
    if (!la) continue;
    const a = la / 255;
    cv[j] = lay[j] * a + cv[j] * (1 - a); cv[j + 1] = lay[j + 1] * a + cv[j + 1] * (1 - a); cv[j + 2] = lay[j + 2] * a + cv[j + 2] * (1 - a);
    cv[j + 3] = la + cv[j + 3] * (1 - a);
    lay[j] = lay[j + 1] = lay[j + 2] = lay[j + 3] = 0;
  }
}

// Кадр аватара из холста: квадрат вокруг головы, уменьшенный до size усреднением (с учётом прозрачности)
function frame(cv, S, size) {
  const [cx, cy, cs] = pack().crop;
  const out = new Uint8ClampedArray(size * size * 4);
  const f = cs / size;
  for (let y = 0; y < size; y++) {
    const sy0 = y * f; const sy1 = sy0 + f;
    for (let x = 0; x < size; x++) {
      const sx0 = x * f; const sx1 = sx0 + f;
      let r = 0; let g = 0; let b = 0; let a = 0; let wsum = 0;
      for (let yy = Math.floor(sy0); yy < sy1; yy++) {
        const wy = Math.min(yy + 1, sy1) - Math.max(yy, sy0);
        const Y = yy + cy;
        for (let xx = Math.floor(sx0); xx < sx1; xx++) {
          const w = wy * (Math.min(xx + 1, sx1) - Math.max(xx, sx0));
          wsum += w;
          const X = xx + cx;
          if (Y < 0 || X < 0 || Y >= S || X >= S) continue;
          const j = (Y * S + X) * 4; const pa = cv[j + 3] * w;
          r += cv[j] * pa; g += cv[j + 1] * pa; b += cv[j + 2] * pa; a += pa;
        }
      }
      const o = (y * size + x) * 4;
      // почти непрозрачное считаем непрозрачным: после уменьшения слоёв альфа тела местами 252–254, и фон просвечивал бы
      if (a > 0) { const al = a / wsum; out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = al > 249 ? 255 : al; }
    }
  }
  return out;
}

// ---------- образ → список слоёв ----------
const HOODIE = { red: '#E5484D', blue: '#2563C9', green: '#1F7A3A', violet: '#8B5CF6', navy: '#34405F', black: '#23252B', white: '#EEF1F6', beige: '#D8C3A5', yellow: '#F4C430', pink: '#F08BB4', orange: '#F28C28', khaki: '#7D7A4F', burgundy: '#7A1F34', grey: '#8A919E' };
const GLASS = { black: '#262A36', tortoise: '#7A4A22', gold: '#C9A03A', silver: '#AEB4C0', red: '#C8323C', navy: '#2E4F93', pink: '#E77BA6' };
const HAIR = ['short', 'long', 'tail', 'curly', 'bob', 'bun', 'side', 'mohawk', 'afro', 'undercut', 'quiff', 'crop', 'slick', 'buzz', 'manbun', 'waves', 'bangs', 'lob', 'pixie', 'ponytail', 'braid', 'buns', 'anime'];
const EYES = { normal: 'round', almond: 'almond', narrow: 'narrow', hooded: 'hooded', down: 'down', up: 'up', tired: 'tired', sly: 'sly', wide: 'wide', anime: 'anime' };
const MOUTH = ['smile', 'grin', 'smirk', 'neutral', 'sad', 'wow', 'laugh', 'angry', 'tongue'];
const BEARD = { stubble: 'stubble', beard: 'full', mustache: 'mustache', goatee: 'goatee' };
const BROWS = ['straight', 'arch', 'peak', 'thin', 'thick', 'uni'];
const NOSE = ['button', 'straight', 'wide', 'long', 'snub', 'roman'];
const GLASSES = ['classic', 'round', 'square', 'aviator', 'cat'];
const OUTFIT = ['hoodie', 'tee', 'dev', 'shirt', 'suit', 'jacket', 'puffer', 'dress', 'cami', 'biker', 'cyber', 'armor', 'vampire', 'nysweater', 'telnyashka'];
const NECK = { tie: 'tie', tie_crooked: 'tie', tie_gold: 'tie', bow: 'bow', badge: 'badge', beads: 'beads', chain: 'chain', chain_gold: 'chain', snake: 'snake', garland: 'garland' };
const HAT = { beanie: 'beanie', cap: 'cap', headset: 'headset', laurel: 'laurel', knight: 'knight', royal: 'crown', fedora: 'fedora', ushanka: 'ushanka', tricorn: 'tricorn', dedmoroz: 'dedmoroz', kokoshnik: 'kokoshnik', wreath: 'wreath', shawl: 'shawl' };
const MASK = ['medical', 'gauze', 'visor', 'scuba'];
const PROP = ['mug', 'papers', 'sign', 'laptop', 'mug_best', 'trophy', 'phone', 'torch', 'mimosa', 'pancakes', 'sign_dnd', 'sign_ask'];
const PET = ['corgi', 'pug', 'frenchie', 'parrot', 'cat', 'aquarium', 'cactus'];
const EARRINGS = ['studs', 'pearls', 'hoops', 'drops', 'cross'];
const pick = (list, v) => (list.includes(v) ? v : null);
// Значение из таблицы только по своему ключу: '__proto__' и 'constructor' из чужого образа не должны ничего находить
const at = (map, k) => (typeof k === 'string' && Object.hasOwn(map, k) ? map[k] : undefined);

// Порядок слоёв снизу вверх. Правила те же, что были у плоского аватара: шлем прячет волосы, бороду, маску и серьги;
// маска аквалангиста и визор закрывают глаза — очки под ними не рисуем; ушанка и платок закрывают уши
function lookToSpec(look = {}) {
  const f = look.preset === 'f';
  const skin = rgb(look.skin, '#E8B48A');
  const hair = rgb(look.hair, '#2B1D14');
  const shirt = rgb(at(HOODIE, look.hoodie), HOODIE.blue);
  const own = (v) => (HEX.test(v || '') ? rgb(v) : null);
  const colors = {
    skin, nose: mul(skin, 0.97), hair, shirt,
    brow: own(look.browColor) || mul(hair, 0.9),
    beard: own(look.beard === 'mustache' ? look.mustacheColor : look.beardColor) || hair,
    iris: rgb(look.eyes, '#22252D'),
    hat: look.hatColor && look.hatColor !== 'same' ? rgb(at(HOODIE, look.hatColor), HOODIE.blue) : shirt,
    glasses: rgb(at(GLASS, look.glassesColor), GLASS.black)
  };
  const hat = at(HAT, look.hat) || (look.crown ? 'crown' : null);
  const helmet = hat === 'knight';
  const eyesCovered = helmet || look.mask === 'scuba' || look.mask === 'visor';
  const earsCovered = helmet || hat === 'ushanka' || hat === 'shawl';
  const L = ['body', 'o_' + (pick(OUTFIT, look.outfit) || 'hoodie')];
  if (look.freckles) L.push('f_freckles');
  if (look.age === '2') L.push('f_wrinkles');
  if (look.mole && look.mole !== 'none') L.push('f_moles');
  if (look.makeup && look.makeup !== 'none') L.push('f_blush');
  if (at(NECK, look.neck)) L.push('nk_' + at(NECK, look.neck));
  L.push('m_' + (pick(MOUTH, look.mouth) || 'smile'));
  if (at(BEARD, look.beard) && !helmet) L.push('bd_' + at(BEARD, look.beard));
  L.push('n_' + (pick(NOSE, look.nose) || 'button'));
  L.push('e_' + (at(EYES, look.eyeShape) || 'round'));
  L.push('b_' + (pick(BROWS, look.browShape) || (f ? 'arch' : 'straight')));
  if (pick(MASK, look.mask) && !helmet) L.push('mk_' + look.mask);
  const hs = look.hairStyle === 'bald' ? null : pick(HAIR, look.hairStyle) || 'short';
  if (hs && !helmet) L.push('h_' + hs);
  if (pick(EARRINGS, look.earrings) && !earsCovered) L.push('er_' + look.earrings);
  if (look.glasses && !eyesCovered) L.push('g_' + (pick(GLASSES, look.glassesStyle) || 'classic'));
  if (hat) L.push('hat_' + hat);
  else if (look.phones) L.push('hat_headset');
  const prop = look.prop === 'sign_lunch' ? 'sign_lunch_' + (f ? 'f' : 'm') : pick(PROP, look.prop);
  if (prop) L.push('p_' + prop + '_hand', 'p_' + prop);
  if (pick(PET, look.pet)) L.push('pet_' + look.pet);
  return { colors, layers: L, clip: hat ? 'hat_' + hat : null };
}

function compose(look) {
  const P = pack();
  const S = P.size;
  const spec = lookToSpec(look);
  const cv = new Uint8ClampedArray(S * S * 4);
  const lay = new Uint8ClampedArray(S * S * 4);
  const hatPart = spec.clip && P.parts[spec.clip];
  const clip = hatPart && hatPart.clip ? hatPart.clip : null;
  for (const name of spec.layers) drawPart(cv, lay, S, name, spec.colors, clip);
  return { cv, S };
}

// Готовый PNG нужного размера. Одинаковые образы берём из памяти: в списках один и тот же аватар запрашивают много раз
const cache = new Map();
let cacheBytes = 0;
function render(look, size = 192) {
  const s = SIZES.find((v) => v >= size) || SIZES[SIZES.length - 1];
  const key = s + ':' + JSON.stringify(lookToSpec(look));
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const { cv, S } = compose(look);
  const png = encodePng(s, s, frame(cv, S, s));
  cache.set(key, png); cacheBytes += png.length;
  for (const [k, v] of cache) { if (cacheBytes <= CACHE_BYTES) break; cache.delete(k); cacheBytes -= v.length; }
  return png;
}

function register(ctx) {
  const { route, requireUser, bad, U } = ctx;
  // Адрес — сам образ (base64url от JSON): картинка не меняется, пока не изменился образ, и браузер держит её в кэше
  route('GET', '/api/ava/:code', async (req, body, query, params) => {
    requireUser(req, { nick: false });
    if (!available()) throw bad('Объёмные аватары ещё не установлены.');
    const code = String(params.code).replace(/\.png$/, '');
    if (code.length > 1400) throw bad('Слишком длинный образ.');
    let look;
    try { look = JSON.parse(U.fromB64url(code).toString('utf8')); } catch { throw bad('Образ не читается.'); }
    if (!look || typeof look !== 'object' || Array.isArray(look)) throw bad('Образ не читается.');
    const png = render(look, Number(query.s) || 192);
    return { _raw: { body: png, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=2592000, immutable' } } };
  });
  return { render };
}

module.exports = { register, render, compose, lookToSpec, decodePng, encodePng, available, SIZES };
