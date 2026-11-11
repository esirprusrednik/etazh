// Праздничные сезоны: в какие дни открыты сезонные детали аватара, открытки и блиц.
// Купленное в сезон остаётся навсегда; купить вне сезона нельзя.
// Масленица — подвижная: неделя перед Прощёным воскресеньем, за 7 недель до православной Пасхи.

const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// Православная Пасха (алгоритм Мееуса для юлианского календаря + 13 дней разницы в XX–XXI веках)
function orthodoxEaster(y) {
  const a = y % 4, b = y % 7, c = y % 19;
  const d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  return addDays(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, 13);
}

const SEASONS = {
  newyear: { name: 'Новый год', range: (y) => [`${y}-12-15`, `${y + 1}-01-10`] },
  feb23: { name: '23 Февраля', range: (y) => [`${y}-02-16`, `${y}-02-25`] },
  mar8: { name: '8 Марта', range: (y) => [`${y}-03-02`, `${y}-03-10`] },
  summer: { name: 'Сезон отпусков', range: (y) => [`${y}-05-15`, `${y}-08-31`] },
  maslenitsa: { name: 'Масленица', range: (y) => { const e = orthodoxEaster(y); return [addDays(e, -55), addDays(e, -49)]; } }
};

// Какие сезоны идут в этот день (окно Нового года переходит через год — проверяем и прошлый)
function activeSeasons(day) {
  const y = Number(day.slice(0, 4));
  return Object.keys(SEASONS).filter((id) => [y - 1, y].some((yy) => { const [a, b] = SEASONS[id].range(yy); return a <= day && day <= b; }));
}
const seasonOn = (id, day) => !id || activeSeasons(day).includes(id);
// Ближайшее окно сезона, которое ещё не закончилось
function nextWindow(id, day) {
  const y = Number(day.slice(0, 4));
  for (const yy of [y - 1, y, y + 1]) { const [a, b] = SEASONS[id].range(yy); if (b >= day) return { from: a, to: b }; }
  return null;
}

module.exports = { SEASONS, orthodoxEaster, activeSeasons, seasonOn, nextWindow };
