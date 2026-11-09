// Погода на завтра: вечером накануне офисного дня — короткий пуш, если погода того стоит
// («завтра дождь — возьми зонт», «снег — готовься к сугробам», «−20 — одевайся теплее»).
// Обычная погода пуша не даёт: тихо — значит, всё нормально.
//
// Источник — Open-Meteo (open-meteo.com): бесплатный, без ключа, прогноз по моделям ECMWF/ICON/GFS.
// У Яндекс.Погоды и Гисметео API только по договору и с ключом, а парсить их сайты запрещают условия.
// Все офисы в Москве в паре километров друг от друга — берём одну точку (центр).
// Персональных данных наружу не уходит: в запросе только координаты города.

const POINT = { lat: 55.7558, lon: 37.6176 };
const SEND_FROM = 17.5, SEND_TO = 18.75; // 17:30–18:45 по Москве — до тихих часов (с 19:00)
const URL = `https://api.open-meteo.com/v1/forecast?latitude=${POINT.lat}&longitude=${POINT.lon}`
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_min,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_gusts_10m_max'
  + '&timezone=Europe%2FMoscow&forecast_days=4';

// Что сказать про день. Возвращает null, если погода обычная. Чистая функция — для тестов
function phrase(d) {
  if (!d) return null;
  const min = Math.round(d.tmin), max = Math.round(d.tmax), feels = Math.round(d.feelsMin ?? d.tmin);
  const t = min === max ? `${max > 0 ? '+' : ''}${max}°` : `${min > 0 ? '+' : ''}${min}…${max > 0 ? '+' : ''}${max}°`;
  const snow = (d.snow || 0) >= 1, heavySnow = (d.snow || 0) >= 5;
  const rain = !snow && ((d.precip || 0) >= 2 || ((d.prob || 0) >= 70 && (d.precip || 0) >= 0.5));
  const heavyRain = rain && (d.precip || 0) >= 10;
  const thunder = [95, 96, 99].includes(d.code);
  const freezing = [56, 57, 66, 67].includes(d.code) || (min <= 0 && max >= 0 && (d.precip || 0) >= 1 && !snow);
  const wind = (d.gusts || 0) >= 54; // км/ч ≈ 15 м/с
  const cold = feels <= -18 || max <= -12;
  const hot = max >= 30;
  const parts = [];
  let icon = 'sun';
  if (heavySnow) { parts.push(`завтра сильный снег — готовься к сугробам и пробкам`); icon = 'snow'; }
  else if (snow) { parts.push('завтра снег — обувь посерьёзнее'); icon = 'snow'; }
  if (freezing) { parts.push('гололёд — осторожно на ступеньках'); icon = 'snow'; }
  if (thunder) { parts.push('гроза — зонт и не стой под деревьями'); icon = 'rain'; }
  else if (heavyRain) { parts.push('завтра ливень — зонт обязательно'); icon = 'rain'; }
  else if (rain) { parts.push('завтра дождь — не забудь зонт'); icon = 'rain'; }
  if (cold) { parts.push(`очень холодно, ощущается как ${feels}° — одевайся теплее`); icon = icon === 'sun' ? 'thermo' : icon; }
  if (hot) { parts.push('жара — возьми воду'); icon = 'sun'; }
  if (wind) { parts.push(`ветер до ${Math.round(d.gusts / 3.6)} м/с`); icon = icon === 'sun' ? 'wind' : icon; }
  if (!parts.length) return null;
  let text = parts.join('; ');
  text = text[0].toUpperCase() + text.slice(1);
  if (!/^Завтра/.test(text)) text = 'Завтра: ' + text[0].toLowerCase() + text.slice(1);
  return { text: `${text}. ${t}`, icon, temp: t };
}

function register(ctx) {
  const { db, q, U, notify, fireAndForget, readProfile, weekdayName, features } = ctx;
  db.exec('CREATE TABLE IF NOT EXISTS weather_push (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL)');

  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  let cache = { at: 0, days: {} };

  async function load() {
    if (U.now() - cache.at < 3 * 3600e3 && Object.keys(cache.days).length) return cache.days;
    try {
      let data;
      if (process.env.WEATHER_FAKE) data = JSON.parse(process.env.WEATHER_FAKE);
      else {
        const res = await fetch(URL, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'etazh-office-app' } });
        if (!res.ok) throw new Error('weather ' + res.status);
        data = await res.json();
      }
      const d = data.daily, days = {};
      d.time.forEach((day, i) => {
        days[day] = { code: d.weather_code[i], tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], feelsMin: (d.apparent_temperature_min || [])[i],
          precip: d.precipitation_sum[i], prob: (d.precipitation_probability_max || [])[i], snow: d.snowfall_sum[i], gusts: (d.wind_gusts_10m_max || [])[i] };
      });
      cache = { at: U.now(), days };
    } catch (e) { console.error('weather', e.message); }
    return cache.days;
  }

  // Совет на завтра для человека: только если завтра он по плану в офисе и погода необычная
  function adviceFor(uid, profile) {
    const today = U.msk().day, tomorrow = addDays(today, 1);
    const prof = typeof profile === 'string' ? readProfile(profile) : profile;
    if (prof.weather === false) return null;
    if (!weekdayName(tomorrow)) return null;
    if (!features || features.cellFor(prof, uid, tomorrow) !== 'office') return null;
    const p = phrase(cache.days[tomorrow]);
    return p ? { ...p, day: tomorrow } : null;
  }

  async function tick() {
    const now = U.msk(), h = now.hour + now.minute / 60, day = now.day;
    if (h < SEND_FROM || h >= SEND_TO) return;
    await load();
    for (const r of q('SELECT DISTINCT user_id AS id FROM push_subs').all()) {
      const u = q('SELECT id, profile FROM users WHERE id = ? AND nick IS NOT NULL').get(r.id);
      if (!u) continue;
      const sent = q('SELECT day FROM weather_push WHERE user_id = ?').get(u.id);
      if (sent && sent.day === day) continue;
      q('INSERT INTO weather_push (user_id, day) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET day = excluded.day').run(u.id, day);
      const a = adviceFor(u.id, u.profile);
      if (a) fireAndForget(notify([u.id], { title: 'Погода на завтра', body: a.text, url: '/#near', tag: 'weather' }));
    }
  }
  // Прогноз подтягиваем заранее, чтобы и сводка «Этажа» его знала
  load().catch(() => {});
  setInterval(() => { load().catch(() => {}); }, 3 * 3600e3).unref();
  setInterval(() => { tick().catch((e) => console.error('weather', e)); }, 5 * 60e3).unref();

  return { adviceFor, load, tick, cacheDays: () => cache.days };
}

module.exports = { register, phrase };
