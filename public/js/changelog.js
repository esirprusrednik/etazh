// Страница «Что нового»: читает /changelog.json и рисует по дням
(function () {
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const date = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
  const block = (title, list) => list && list.length ? `<h3>${title}</h3><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  fetch('/changelog.json', { cache: 'no-cache' }).then((r) => r.json()).then((days) => {
    document.getElementById('log').innerHTML = days.map((d) => `<h2>${date(d.day)}</h2>${block('Новое', d.new)}${block('Стало удобнее', d.better)}${block('Починили', d.fix)}`).join('');
  }).catch(() => { document.getElementById('log').textContent = 'Не получилось загрузить список. Обнови страницу.'; });
})();
