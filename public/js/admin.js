// Модерация: жалобы, сигналы для АХО, параметры столовых
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = document.getElementById('admin');
const TYPES = { gang: 'Банда', message: 'Сообщение', signal: 'Сигнал' };

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Ошибка');
  return j;
}

function metricsCard(m) {
  const pct = (x) => (x == null ? '—' : x + '%');
  const delta = m.prevWau ? Math.round(((m.wau - m.prevWau) / m.prevWau) * 100) : null;
  const cols = [['active', 'Акт.'], ['checkins', 'Отм.'], ['calls', 'Зовы'], ['replies', 'Отв.'], ['thanks', 'Спас.'], ['lunches', 'Обеды'], ['messages', 'Сообщ.']];
  return `<div class="card"><h2>Метрики пилота</h2>
    <p class="sub">Активных за 7 дней: <b>${m.wau}</b>${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta}% к прошлой неделе)`} · вернулись на второй неделе: <b>${pct(m.retention)}</b> · кофе-пар на неделе: <b>${m.coffeeWeek}</b></p>
    <p class="small">Считаем только количества. Кто именно был активен, не хранится: в журнале псевдонимы, они удаляются через 35 дней.</p>
    <div class="adm-scroll"><table class="adm-table"><thead><tr><th>День</th>${cols.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead>
    <tbody>${m.rows.slice().reverse().map((r) => `<tr><td>${esc(r.day)}</td>${cols.map(([k]) => `<td>${r[k] || 0}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn small ghost" data-a="coffee-now">Составить кофе-пары сейчас</button><span class="small">Обычно это происходит само по понедельникам в 10:00</span></div>
  </div>`;
}

async function load() {
  try {
    const [d, m] = await Promise.all([call('GET', '/api/admin/overview'), call('GET', '/api/admin/metrics').catch(() => null)]);
    root.innerHTML = `
    <div class="card"><h2>Сводка</h2><p class="sub">Пользователей: <b>${d.users}</b> · отмечались сегодня: <b>${d.activeToday}</b> · банд: <b>${d.gangs}</b></p></div>
    ${m ? metricsCard(m) : ''}
    <div class="card"><h2>Жалобы</h2>${d.reports.length ? d.reports.map((r) => `
      <div class="item"><div class="grow"><div style="font-weight:900">${TYPES[r.object_type]} #${r.object_id} · жалоб: ${r.n}${r.preview && r.preview.hidden ? ' · скрыто' : ''}</div>
      <div class="where">${esc(r.preview ? r.preview.text : 'уже удалено')}</div>${r.reasons ? `<div class="small">${esc(r.reasons)}</div>` : ''}</div>
      <div class="row" style="gap:4px"><button class="btn small danger" data-a="hide" data-t="${r.object_type}" data-id="${r.object_id}">Скрыть</button>
      <button class="btn small ghost" data-a="restore" data-t="${r.object_type}" data-id="${r.object_id}">Оставить</button></div></div>`).join('') : '<p class="sub">Открытых жалоб нет.</p>'}</div>
    <div class="card"><h2>Подтверждённые сигналы для АХО</h2>${d.facilities.length ? d.facilities.map((s) => `<div class="item"><div class="grow"><b>${esc(s.office)}</b> · ${esc(s.type)} ${esc(s.zone || '')} ${esc(s.comment || '')}</div></div>`).join('') : '<p class="sub">Сейчас нет.</p>'}</div>
    <div class="card"><h2>Столовые</h2><p class="small">Места в зале и доля сотрудников с приложением (0.02–1). Время обеда считается само.</p>${d.offices.map((o) => `
      <div class="item" style="flex-wrap:wrap"><b class="grow">${esc(o.name)}</b><span class="small">обед ≈ ${o.lunch_w} мин</span>
      <label class="field" style="width:100px">Мест<input id="s-${o.id}" type="number" value="${o.seats}"></label>
      <label class="field" style="width:100px">Доля<input id="p-${o.id}" type="number" step="0.01" value="${o.share_p}"></label>
      <button class="btn small" data-a="office" data-id="${o.id}">Сохранить</button></div>`).join('')}</div>`;
  } catch (e) {
    root.innerHTML = `<div class="card"><h2>Нет доступа</h2><p class="sub">${esc(e.message)}</p></div>`;
  }
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  try {
    if (b.dataset.a === 'coffee-now') {
      const r = await call('POST', '/api/admin/coffee-now');
      alert(`Составлено пар: ${r.pairs}`);
    } else if (b.dataset.a === 'office') {
      const id = b.dataset.id;
      await call('POST', '/api/admin/office', { id, seats: Number(document.getElementById('s-' + id).value), share_p: Number(document.getElementById('p-' + id).value) });
    } else {
      await call('POST', '/api/admin/report', { type: b.dataset.t, id: Number(b.dataset.id), action: b.dataset.a });
    }
    load();
  } catch (err) { alert(err.message); }
});
load();
