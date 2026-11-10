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

function foodCard(offices) {
  return `<div class="card"><h2>Отзывы о столовых · 14 дней</h2>
    <p class="small">Без имён: связь с человеком стирается на следующий день. Можно пересылать АХО и подрядчику как есть.</p>
    ${offices.length ? offices.map((o) => `<div class="item" style="flex-direction:column;align-items:stretch;gap:4px">
      <div><b>${esc(o.office)}</b> · 👍 ${o.upPct}% · оценок: ${o.n}</div>
      ${o.tags.length ? `<div class="small">${o.tags.map(([t, n]) => `${esc(t)} — ${n}`).join(' · ')}</div>` : ''}
      ${o.comments.map((c) => `<div class="small">${c.up ? '👍' : '👎'} ${esc(c.day)}: ${esc(c.text)}</div>`).join('')}
    </div>`).join('') : '<p class="sub">Оценок пока нет.</p>'}
  </div>`;
}

function feedbackCard(fb) {
  const items = fb.items || [];
  const st = fb.statuses || {};
  const fresh = items.filter((x) => x.status === 'new').length;
  return `<div class="card"><h2>Идеи и ошибки${fresh ? ` · новых: ${fresh}` : ''}</h2>
    <p class="small">Ответ и статус человек увидит в приложении и получит пуш. «Взяли в работу» или «Сделано» — автоматически +${fb.reward || 10} зёрен автору, один раз.</p>
    ${items.length ? items.map((x) => `<div class="item" style="flex-direction:column;align-items:stretch;gap:6px">
      <div><b>${x.kind === 'bug' ? '🐞 Ошибка' : '💡 Идея'}</b> · ${esc(x.nick)} · ${new Date(x.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${x.rewarded ? ' · зёрна выданы' : ''}</div>
      <div style="white-space:pre-wrap">${esc(x.text)}</div>
      <div class="small">${esc(x.device || '')} · вкладка «${esc(({ near: 'Рядом', chats: 'Чаты', office: 'Офис', games: 'Игры' })[x.tab] || x.tab || '—')}» · сборка ${esc(x.build || '—')}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="width:170px">Статус<select id="fb-st-${x.id}">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field" style="flex:1;min-width:200px">Ответ<input id="fb-re-${x.id}" maxlength="500" value="${esc(x.reply)}" placeholder="Спасибо! Сделаем к пятнице"></label>
        <button class="btn small" data-a="fb-save" data-id="${x.id}">Сохранить</button>
      </div></div>`).join('') : '<p class="sub">Пока ничего не прислали.</p>'}
  </div>`;
}

function quizCard(items) {
  const now = Date.now();
  return `<div class="card"><h2>Квиз недели</h2>
    <p class="small">Вопрос увидят все на главном экране. За верный ответ +3 зерна (не больше трёх квизов в день). После ответа человек видит, как ответили остальные.</p>
    <label class="field">Вопрос<input id="qz-text" maxlength="200" placeholder="В каком году открылся офис на Смоленке?"></label>
    ${[0, 1, 2, 3].map((i) => `<div class="row" style="gap:8px;align-items:center"><input type="radio" name="qz-ok" value="${i}" ${i === 0 ? 'checked' : ''} aria-label="Правильный вариант ${i + 1}"><input id="qz-o${i}" class="grow" maxlength="80" placeholder="Вариант ${i + 1}${i > 1 ? ' (необязательно)' : ''}" style="flex:1;min-width:0"></div>`).join('')}
    <p class="small" style="margin:0">Кружком отметь правильный вариант.</p>
    <label class="field">Пояснение после ответа (необязательно)<input id="qz-explain" maxlength="200"></label>
    <div class="row" style="gap:8px;align-items:flex-end"><label class="field" style="width:120px">Дней<input id="qz-days" type="number" min="1" max="14" value="7"></label><button class="btn" data-a="quiz-create">Опубликовать</button></div>
    ${items.length ? items.map((z) => `<div class="item" style="flex-direction:column;align-items:stretch">
      <div><b>${esc(z.text)}</b> <span class="small">${z.closesAt > now ? 'идёт' : 'закрыт'} · ответили ${z.total}</span></div>
      ${z.options.map((o, i) => `<div class="small">${i === z.correct ? '✓' : '·'} ${esc(o)} — ${z.stats[i].pct}%</div>`).join('')}
      ${z.closesAt > now ? `<button class="btn small ghost" data-a="quiz-close" data-id="${z.id}">Закрыть</button>` : ''}</div>`).join('') : ''}
  </div>`;
}

function topicsCard(t) {
  return `<div class="card"><h2>Темы блица для битв банд</h2>
    <p class="small">Встроенные темы — в коде, свои добавляются здесь. Банда бьётся по каждой теме один раз, поэтому новые темы продлевают игру. Нужно минимум 8 вопросов, лучше 15–16.</p>
    ${t.items.map((x) => `<div class="item"><div class="grow"><b>${esc(x.emoji)} ${esc(x.title)}</b> · ${x.count} вопр. · с ${esc(x.from)}${x.custom ? ' · своя' : ''}
      <div class="small">${x.sample.map((q) => esc(q[0])).join(' / ')}</div></div>${x.custom ? `<button class="btn small ghost" data-a="topic-toggle" data-id="${x.id}">Выключить</button>` : ''}</div>`).join('')}
    ${t.inactive.length ? `<p class="small">Выключены: ${t.inactive.map((x) => `${esc(x.title)} <button class="btn small ghost" data-a="topic-toggle" data-id="${x.id}">Включить</button>`).join(' ')}</p>` : ''}
    <h3>Новая тема</h3>
    <div class="row" style="flex-wrap:wrap;gap:8px"><label class="field" style="width:70px">Значок<input id="tp-emoji" value="❓" maxlength="4"></label>
      <label class="field grow">Название<input id="tp-title" maxlength="40" placeholder="Тарифы без паники"></label>
      <label class="field" style="width:150px">Открыть с<input id="tp-from" type="date"></label></div>
    <label class="field">Описание<input id="tp-desc" maxlength="120" placeholder="Коротко, о чём тема"></label>
    <label class="field">Вопросы — по одному на строку: <code>Вопрос | Правильный | Неверный | Неверный | Неверный</code>
      <textarea id="tp-q" rows="10" placeholder="Что такое ARPU? | Средняя выручка на абонента | Аварийный резерв | Автоответчик | Код тарифа"></textarea></label>
    <p class="small">Правильный ответ — всегда второй в строке, игрокам варианты перемешиваются. Неверных — от 1 до 3, лучше смешные, но правдоподобные.</p>
    <button class="btn" data-a="topic-create">Добавить тему</button>
    <h3>Турнир</h3><p class="small">Обычно стартует сам за 6 рабочих дней до конца месяца. Кнопка — запустить сейчас с записавшимися бандами.</p>
    <button class="btn small ghost" data-a="tour-start">Запустить турнир сейчас</button></div>`;
}

// Заявки компаний, которых ещё нет в Этаже: домен и сколько людей подтвердили почту (адресов модератор не видит)
function accessCard(a) {
  if (!a) return '';
  const day = (t) => new Date(t).toLocaleDateString('ru-RU');
  return `<div class="card"><h2>Заявки новых компаний</h2>
    <p class="small">Каждый подтвердил рабочую почту письмом. Открыть — заведём компанию с первым офисом и всем пришлём ссылку для входа. Отказать — адреса удалятся, новые заявки с этого домена не принимаются.</p>
    ${a.requests.length ? a.requests.map((r) => `<div class="item" style="flex-wrap:wrap;gap:8px"><div class="grow"><b>@${esc(r.domain)}</b><div class="small">человек: ${r.people} · первая заявка ${day(r.first_at)}, последняя ${day(r.last_at)}</div></div>
      <label class="field" style="width:150px">Компания<input id="ac-n-${esc(r.domain)}" maxlength="40" placeholder="Название"></label>
      <label class="field" style="width:150px">Первый офис<input id="ac-o-${esc(r.domain)}" maxlength="40" placeholder="Например, Главный"></label>
      <div class="row" style="gap:4px"><button class="btn small" data-a="access-open" data-d="${esc(r.domain)}">Открыть</button><button class="btn small ghost" data-a="access-reject" data-d="${esc(r.domain)}">Отказать</button></div></div>`).join('') : '<p class="sub">Новых заявок нет.</p>'}
    ${a.companies.length ? `<p class="small">Открыты по заявкам: ${a.companies.map((c) => `${esc(c.name)} (@${esc(c.domains)})`).join(', ')}</p>` : ''}</div>`;
}

async function load() {
  try {
    const [d, m, qz, food, fb] = await Promise.all([call('GET', '/api/admin/overview'), call('GET', '/api/admin/metrics').catch(() => null), call('GET', '/api/admin/quizzes').catch(() => ({ items: [] })), call('GET', '/api/admin/food').catch(() => ({ offices: [] })), call('GET', '/api/admin/feedback').catch(() => ({ items: [] }))]);
    const tp = await call('GET', '/api/admin/topics').catch(() => ({ items: [], inactive: [] }));
    const ac = await call('GET', '/api/admin/access').catch(() => null);
    root.innerHTML = `
    <div class="card"><h2>Сводка</h2><p class="sub">Пользователей: <b>${d.users}</b> · отмечались сегодня: <b>${d.activeToday}</b> · банд: <b>${d.gangs}</b></p></div>
    ${accessCard(ac)}
    ${feedbackCard(fb)}
    ${m ? metricsCard(m) : ''}
    ${quizCard(qz.items)}
    ${topicsCard(tp)}
    ${foodCard(food.offices)}
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
    if (b.dataset.a === 'quiz-create') {
      const options = [0, 1, 2, 3].map((i) => document.getElementById('qz-o' + i).value.trim());
      const okIdx = Number((document.querySelector('input[name=qz-ok]:checked') || {}).value || 0);
      if (!options[okIdx]) throw new Error('Правильный вариант пустой');
      const filled = options.map((o, i) => ({ o, i })).filter((x) => x.o);
      await call('POST', '/api/admin/quizzes', { text: document.getElementById('qz-text').value, options: filled.map((x) => x.o), correct: filled.findIndex((x) => x.i === okIdx), explain: document.getElementById('qz-explain').value, days: Number(document.getElementById('qz-days').value) });
    } else if (b.dataset.a === 'fb-save') {
      const id = b.dataset.id;
      const r = await call('POST', `/api/admin/feedback/${id}`, { status: document.getElementById('fb-st-' + id).value, reply: document.getElementById('fb-re-' + id).value });
      if (r.beans) alert(`Автору начислено ${r.beans} зёрен`);
    } else if (b.dataset.a === 'topic-create') {
      const r = await call('POST', '/api/admin/topics', { title: document.getElementById('tp-title').value, emoji: document.getElementById('tp-emoji').value, from: document.getElementById('tp-from').value, desc: document.getElementById('tp-desc').value, questions: document.getElementById('tp-q').value });
      alert(`Тема добавлена: ${r.count} вопросов`);
    } else if (b.dataset.a === 'topic-toggle') {
      await call('POST', `/api/admin/topics/${b.dataset.id}/toggle`);
    } else if (b.dataset.a === 'tour-start') {
      const r = await call('POST', '/api/admin/tourney/start');
      alert(r.status === 'running' ? 'Турнир запущен' : 'Банд меньше двух — турнир перенесён');
    } else if (b.dataset.a === 'quiz-close') {
      await call('POST', `/api/admin/quizzes/${b.dataset.id}/close`);
    } else if (b.dataset.a === 'coffee-now') {
      const r = await call('POST', '/api/admin/coffee-now');
      alert(`Составлено пар: ${r.pairs}`);
    } else if (b.dataset.a === 'access-open') {
      const d = b.dataset.d;
      const r = await call('POST', '/api/admin/access/open', { domain: d, name: document.getElementById('ac-n-' + d).value, office: document.getElementById('ac-o-' + d).value });
      alert(`Компания открыта. Писем со ссылкой отправлено: ${r.sent}`);
    } else if (b.dataset.a === 'access-reject') {
      if (!confirm(`Отказать @${b.dataset.d}? Адреса удалятся.`)) return;
      await call('POST', '/api/admin/access/reject', { domain: b.dataset.d });
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
