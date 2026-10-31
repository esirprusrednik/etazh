// Клиент «Этажа»: без фреймворков, рендер строками + делегирование событий (CSP запрещает inline-обработчики).
import { officeSvg } from './building.js';

const $ = (sel) => document.querySelector(sel);
const root = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem('etazh:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('etazh:' + k, JSON.stringify(v)); } catch {} }
};

const S = {
  me: null, cat: null, vapidKey: null, domains: ['mts.ru'],
  state: null, gang: null, events: null, shop: null,
  tab: 'office', activeGang: store.get('activeGang', null),
  sheet: null, compose: null, signal: null,
  onb: { step: 'email', email: '', error: '', devLink: null, devCode: null, nicks: [] },
  error: '', busy: false,
  seenChat: store.get('seenChat', 0), seenFeed: store.get('seenFeed', 0)
};

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch {}
  if (res.status === 401) { S.me = null; render(); }
  if (!res.ok) throw new Error(json.error || 'Сервер не ответил. Проверь интернет.');
  return json;
}
const get = (u) => api('GET', u);
const post = (u, b = {}) => api('POST', u, b);

let toastTimer;
function toast(text) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------- Аватар ----------
const HOODIE = { red: '#E5484D', blue: '#2563C9', green: '#1F7A3A', violet: '#8B5CF6', navy: '#34405F' };
const FRAMES = { fr_gold: '#FFC93C', fr_neon: '#22D3EE', fr_fire: '#F97316' };
function avatar(look = {}, size = 42) {
  const hair = look.hair || '#2B1D14';
  const skin = look.skin || '#E8B48A';
  const hs = look.hairStyle || 'short';
  const show = (b) => (b ? 'inline' : 'none');
  const ring = FRAMES[look.frame] || '#FFFFFF';
  return `<span class="ava" style="width:${size + 6}px;height:${size + 6}px;border:3px solid ${ring}">
  <svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <g style="display:${show(hs === 'long' || (look.preset === 'f' && hs !== 'short' && hs !== 'curly' && hs !== 'tail'))}"><path d="M28 48 Q26 20 50 19 Q74 20 72 48 L76 86 Q50 94 24 86 Z" fill="${hair}"/></g>
    <g style="display:${show(hs === 'tail')}"><ellipse cx="73" cy="50" rx="7" ry="16" fill="${hair}"/></g>
    <path d="M12 104 Q14 74 50 71 Q86 74 88 104 Z" fill="${HOODIE[look.hoodie] || HOODIE.blue}"/>
    <rect x="44" y="58" width="12" height="16" rx="3" fill="${skin}"/>
    <ellipse cx="50" cy="45" rx="19.5" ry="21" fill="${skin}"/>
    <circle cx="43" cy="48" r="3" fill="#22252D"/><circle cx="57" cy="48" r="3" fill="#22252D"/>
    <path d="M44.5 56 Q50 61 55.5 56" fill="none" stroke="#22252D" stroke-width="2.6" stroke-linecap="round"/>
    ${look.preset === 'f' ? '<path d="M38.5 41 L41 39.5 M61.5 41 L59 39.5" stroke="#22252D" stroke-width="2" stroke-linecap="round"/>' : ''}
    <g style="display:${show(hs === 'short' || hs === 'long' || hs === 'tail')}"><path d="M30 46 Q28 21 50 21 Q72 21 70 46 Q66 31 50 32 Q36 32 30 46 Z" fill="${hair}"/></g>
    <g style="display:${show(hs === 'curly')}"><circle cx="33" cy="38" r="8" fill="${hair}"/><circle cx="40" cy="29" r="8" fill="${hair}"/><circle cx="50" cy="25" r="8.5" fill="${hair}"/><circle cx="60" cy="29" r="8" fill="${hair}"/><circle cx="67" cy="38" r="8" fill="${hair}"/></g>
    <g style="display:${show(look.glasses)}"><rect x="36.5" y="43" width="13" height="10" rx="3.5" fill="none" stroke="#22252D" stroke-width="3"/><rect x="50.5" y="43" width="13" height="10" rx="3.5" fill="none" stroke="#22252D" stroke-width="3"/></g>
    <g style="display:${show(look.phones)}"><path d="M29 47 Q27 15 50 15 Q73 15 71 47" fill="none" stroke="#2B2B3A" stroke-width="6" stroke-linecap="round"/><rect x="23" y="42" width="10" height="16" rx="4" fill="#2B2B3A"/><rect x="67" y="42" width="10" height="16" rx="4" fill="#2B2B3A"/></g>
    <g style="display:${show(look.crown)}"><path d="M33 19 L37 5 L44 13 L50 3 L56 13 L63 5 L67 19 Z" fill="#FFC93C" stroke="#D99A0B" stroke-width="2" stroke-linejoin="round"/></g>
  </svg></span>`;
}

const BEAN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="6" ry="9" transform="rotate(30 12 12)"/><path d="M9 6c3 3 3 9 6 12"/></svg>';
const FLAME = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#FF8A3D" aria-hidden="true"><path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5.2.2 1.7 1 2.7 2 3.2C11 8.5 11 5.5 12 2z"/></svg>';
const ICONS = {
  coffee: 'M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3',
  lunch: 'M4 3v8a3 3 0 0 0 3 3v7M7 3v6M10 3v8a3 3 0 0 1-3 3M17 21V3c-2 1-3 4-3 8h3',
  where: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  food: 'M12 7c-4-2-8 1-7 6 1 4 3 8 7 7 4 1 6-3 7-7 1-5-3-8-7-6zM12 7c0-2 1-4 3-4',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'
};
const ico = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
const OFFICE_BG = { smol: '#E5484D', mark: '#3A86FF', vor: '#F4A72C' };
const CALL_STYLE = {
  coffee: '#8B5A2B', lunch: '#1F7A3A', room: '#2563C9', home: '#6D3FD6', call: '#F97316', where: '#0E7490', online: '#BE185D', wait: '#4B5563'
};
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };

// ---------- Платформа ----------
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; render(); });

// ---------- Загрузка ----------
async function loadMe() {
  const r = await get('/api/me');
  S.me = r.user; S.cat = r.catalog; S.vapidKey = r.vapidKey; S.domains = r.domains;
  if (S.me && S.me.gangs.length && !S.me.gangs.some((g) => g.id === S.activeGang)) S.activeGang = S.me.gangs[0].id;
}
async function loadState() {
  S.state = await get(`/api/state?seenChat=${S.seenChat}&seenFeed=${S.seenFeed}`);
  if (S.me) S.me.beans = S.state.beans;
}
async function loadGang() {
  if (!S.activeGang) { S.gang = null; return; }
  try { S.gang = await get(`/api/gangs/${S.activeGang}`); } catch { S.gang = null; S.activeGang = null; }
}
async function loadEvents() { S.events = await get('/api/events'); }

async function refresh({ all = false } = {}) {
  if (!S.me || !S.me.nick) return;
  const jobs = [loadState()];
  if (all || S.tab === 'gang') jobs.push(loadGang());
  if (all || S.tab === 'feed' || S.tab === 'office') jobs.push(loadEvents());
  await Promise.all(jobs);
  if (S.tab === 'gang') markSeen('chat');
  if (S.tab === 'feed') markSeen('feed');
}
function markSeen(kind) {
  const t = S.state ? S.state.now : Date.now();
  if (kind === 'chat') { S.seenChat = t; store.set('seenChat', t); if (S.state) S.state.badges.chat = 0; }
  else { S.seenFeed = t; store.set('seenFeed', t); if (S.state) S.state.badges.feed = 0; }
}

// ---------- Рендер ----------
function render() {
  const keepScroll = window.scrollY;
  if (!S.me) root.innerHTML = renderLogin();
  else if (!S.me.nick) root.innerHTML = renderNick();
  else root.innerHTML = renderApp();
  window.scrollTo(0, keepScroll);
}

function renderLogin() {
  const o = S.onb;
  const params = new URLSearchParams(location.search);
  const expired = params.get('login') === 'expired';
  if (o.step === 'sent') {
    return `<div class="onb">
      <div class="logo">Этаж<span>.</span></div>
      <div class="card">
        <h2>Проверь почту</h2>
        <p class="sub">Мы отправили ссылку и код на <b>${esc(o.email)}</b>. Ссылка и код работают 15 минут.</p>
        <p class="sub">На iPhone в установленном приложении удобнее ввести код — ссылка откроется в Safari.</p>
        <label class="field">Код из письма<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></label>
        ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
        <button class="btn wide" data-act="code-submit">Войти</button>
        ${o.devLink ? `<div class="note warn">Режим разработки: письмо не отправлялось. <a href="${esc(o.devLink)}">Войти по ссылке</a> или код <b>${esc(o.devCode)}</b></div>` : ''}
        <button class="linkbtn" data-act="onb-back">Ввести другую почту</button>
      </div>
    </div>`;
  }
  return `<div class="onb">
    <div class="logo">Этаж<span>.</span></div>
    <p class="sub" style="color:#C9D1EA">Неофициальное приложение для коллег: кто из твоей банды в офисе, есть ли очередь в столовой, позвать на кофе одной кнопкой.</p>
    <div class="card">
      <h2>Вход по рабочей почте</h2>
      <p class="sub">Только ${S.domains.map((d) => '@' + esc(d)).join(', ')}. Почту мы не храним — только её зашифрованный отпечаток. Коллеги видят лишь твой никнейм.</p>
      ${expired ? '<div class="err">Ссылка устарела или уже использована. Запроси новую.</div>' : ''}
      <label class="field">Рабочая почта<input id="email" type="email" inputmode="email" autocomplete="email" placeholder="name@${esc(S.domains[0])}" value="${esc(o.email)}"></label>
      <label class="check"><input id="consent" type="checkbox"> <span>Согласен с <a href="/privacy.html" target="_blank" rel="noopener">политикой обработки данных</a> и <a href="/rules.html" target="_blank" rel="noopener">правилами</a></span></label>
      ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
      <button class="btn wide" data-act="login-submit" ${S.busy ? 'disabled' : ''}>Получить ссылку для входа</button>
    </div>
  </div>`;
}

function renderNick() {
  const o = S.onb;
  return `<div class="onb">
    <div class="logo">Этаж<span>.</span></div>
    <div class="card">
      <h2>Придумай никнейм</h2>
      <p class="sub">Его видят коллеги. Без ФИО и должностей — так веселее. Менять можно раз в 30 дней.</p>
      <div class="chips">${o.nicks.map((n) => `<button class="chip" data-act="nick-pick" data-v="${esc(n)}">${esc(n)}</button>`).join('')}
        <button class="chip" data-act="nick-more">Ещё варианты</button></div>
      <label class="field">Никнейм<input id="nick" maxlength="21" autocomplete="off" placeholder="@бодрый_енот" value="${esc(o.nick || '')}"></label>
      <div class="field">Аватар
        <div class="row">${['m', 'f'].map((p) => `<button class="chip ${(o.preset || 'm') === p ? 'on' : ''}" data-act="onb-preset" data-v="${p}">${avatar({ preset: p, hairStyle: p === 'f' ? 'long' : 'short' }, 28)} ${p === 'm' ? 'М' : 'Ж'}</button>`).join('')}</div>
      </div>
      ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
      <button class="btn wide" data-act="nick-submit">Готово</button>
    </div>
  </div>`;
}

function renderApp() {
  const me = S.me;
  const b = (S.state && S.state.badges) || { chat: 0, feed: 0 };
  const showBanner = !isStandalone() && store.get('installHiddenUntil', 0) < Date.now();
  return `
  <div class="app">
    <header class="top">
      <button class="who" data-act="open" data-v="profile" aria-label="Мой профиль, уровень ${me.level || 1}">
        <span class="me-ava">${avatar(me.look, 40)}<span class="lvl" aria-hidden="true">${me.level || 1}</span></span>
        <span style="min-width:0;display:flex;flex-direction:column;gap:3px">
          <span class="nick">${esc(me.nick)}</span>
          <span class="row" style="gap:6px">
            ${me.status ? `<span class="status-chip">${esc(me.status)}</span>` : ''}
            ${me.streak ? `<span class="streak" title="Дней подряд с отметкой в офисе">${FLAME}${me.streak} ${plural(me.streak, 'день', 'дня', 'дней')}</span>` : ''}
          </span>
        </span>
      </button>
      <button class="beans3d" data-act="open" data-v="shop" aria-label="Зёрна: ${me.beans}. Открыть лавку">${BEAN}<span>${me.beans}</span></button>
    </header>
    <main>
      ${showBanner ? `<div class="banner">
        <div class="grow"><div style="font-weight:900;font-size:15px">Установи на телефон</div><div style="font-size:12px;font-weight:600">Иконка на экране — и придут зовы банды</div></div>
        <button class="btn small blue" data-act="open" data-v="install">Как?</button>
        <button class="x" style="background:none" data-act="install-hide" aria-label="Скрыть на сутки">×</button>
      </div>` : ''}
      ${S.tab === 'office' ? renderOffice() : S.tab === 'gang' ? renderGang() : renderFeed()}
    </main>
    <nav class="tabs"><div class="in">
      ${tabBtn('office', 'Офис', 0)}${tabBtn('gang', 'Моя банда', b.chat)}${tabBtn('feed', 'События', b.feed)}
    </div></nav>
  </div>
  ${S.sheet ? renderSheet() : ''}`;
}

function tabBtn(id, label, n) {
  const icons = {
    office: '<path d="M4 21V5l8-3 8 3v16z"/><path d="M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2"/>',
    gang: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 5.5 2 5.5 5.5"/>',
    feed: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
  };
  return `<button class="tab ${S.tab === id ? 'on' : ''}" data-act="tab" data-v="${id}" aria-current="${S.tab === id}">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[id]}</svg>
    ${label}${n ? `<span class="badge" aria-label="новых: ${n}">${n > 9 ? '9+' : n}</span>` : ''}</button>`;
}

// ----- Офис -----
function renderOffice() {
  const st = S.state;
  if (!st) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  if (st.night) {
    return `${renderToday()}<div class="card"><h2>Офисы засыпают</h2><p class="sub">После 19:00 отметки сбрасываются. Утром отметься снова — увидишь, кто из банды рядом и есть ли очередь в столовой.</p></div>${renderGangNow()}`;
  }
  if (!st.checkin) {
    return `${renderToday()}<div class="card">
      <h2>${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? 'Всё-таки в офисе?' : 'Где ты сегодня?'}</h2>
      <p class="sub">Отметься — и увидишь свой офис: кто из банды рядом и есть ли очередь в столовой. +5 зёрен за первую отметку дня.</p>
      ${S.cat.offices.map((o) => `<button class="office-btn" style="background:${OFFICE_BG[o.id] || o.color}" data-act="checkin" data-v="${o.id}">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5l8-3 8 3v16z"/><path d="M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2"/></svg>
        <span class="grow">${esc(o.name)}</span></button>`).join('')}
      <p class="small">Отметка действует до 19:00 или пока не нажмёшь «Ушёл». Видно только офис, где ты отметился.</p>
      ${['home', 'vacation', 'sick', 'slack'].includes(st.presence.where) ? '' : `<div class="today-grid">
        <button class="btn ghost" data-act="today" data-v="home">🏠 Из дома</button>
        <button class="btn ghost" data-act="open" data-v="sick">🤒 Болею</button>
        <button class="btn ghost" data-act="open" data-v="vacation">🌴 В отпуске</button>
        <button class="btn ghost" data-act="today" data-v="slack">😏 Отлыниваю</button></div>
        <p class="small">Не отметишься и ничего не выберешь — после 11:00 банда увидит шуточный статус вроде «в астрале».</p>`}
    </div>${renderGangNow()}`;
  }
  const here = st.gangNow.rows.filter((r) => r.where === 'office' && r.office === st.checkin.office).length;
  const hour = Number(st.msk.slice(0, 2));
  const since = st.checkin.since || '';
  return `
  <section class="office-card">
    <div class="office-pic">${officeSvg({ office: st.checkin.office, crowd: here, hour, label: esc('Офис ' + st.checkin.name + (here ? ', из банды здесь: ' + here : '')) })}</div>
    <div class="office-info">
      <div class="row" style="align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="display:flex;flex-direction:column;gap:2px">
          <span class="eyebrow">Ты в офисе</span>
          <span class="office-name">${esc(st.checkin.name)}</span>
        </div>
        <button class="icon-btn" data-act="open" data-v="office" aria-label="Сменить офис">${ico('swap', 16)}</button>
      </div>
      <span class="small">с ${since} · из банды здесь <b style="color:#1F7A3A">${here}</b> · до 19:00</span>
      <button class="btn small ghost" style="align-self:flex-start" data-act="checkout">Ушёл домой</button>
    </div>
  </section>
  ${renderQuickCalls()}
  ${renderCanteen()}
  ${renderGangNow()}
  ${renderSignalsMini()}`;
}

function renderQuickCalls() {
  if (!S.me.gangs.length) return '';
  const gang = S.activeGang || S.me.gangs[0].id;
  const items = [['coffee', 'На кофе', '#8B5A2B', '#5E3B1A'], ['lunch', 'На обед', '#1F7A3A', '#155C2B'], ['where', 'Ты где?', '#0E7490', '#0A5468']];
  return `<section class="qcalls" aria-label="Быстрые зовы банде">
    ${items.map(([k, label, bg, shade]) => `<button class="qcall" style="background:${bg};border-bottom-color:${shade}" data-act="call-open" data-kind="${k}" data-gang="${gang}">${ico(k, 22)}${label}</button>`).join('')}
    <button class="qcall" style="background:#4B5563;border-bottom-color:#2F3640" data-act="tab" data-v="gang">${ico('more', 22)}Ещё</button>
  </section>`;
}

function renderCanteen() {
  const st = S.state;
  const c = st.canteen;
  const tone = { good: '#1F7A3A', ok: '#1D5BBF', warn: '#B45309', bad: '#C81E1E' }[c.tone];
  const trend = c.trend === 'up' ? ['↑ набирается', 'up'] : c.trend === 'down' ? ['↓ пустеет', 'down'] : ['→ ровно', 'flat'];
  const f = c.forecast;
  const color = (v) => (v >= 0.85 ? '#E5484D' : v >= 0.7 ? '#F59E0B' : v >= 0.4 ? '#2563C9' : '#7BC79A');
  const bars = f && f.enough ? `
    <div class="fc" role="img" aria-label="Прогноз загрузки с 12:00 до 14:30, пик около ${f.peak}">
      ${f.slots.map((s, i) => `<span style="height:${Math.max(8, Math.min(100, Math.round(s.load * 100)))}%;background:${color(s.load)}${i === f.current ? ';outline:2px solid #1A2547;outline-offset:2px' : ''}"></span>`).join('')}
    </div>
    <div class="fc-axis"><span>12:00</span>${f.current >= 0 ? '<span>сейчас</span>' : ''}<span>${f.peak} пик</span><span>14:30</span></div>` : '';
  return `<section class="card">
    <div class="row" style="justify-content:space-between">
      <span class="card-title">${ico('lunch', 18)}Столовая</span>
      <span class="trend-chip ${trend[1]}">${trend[0]}</span>
    </div>
    <div class="row" style="align-items:flex-end;justify-content:space-between;gap:10px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <span class="big" style="color:${tone}">${esc(c.label)}</span>
        <span style="font-size:13px;font-weight:700;color:${c.wait ? '#B45309' : '#1F5F2E'}">${c.wait ? `Очередь ≈ ${c.wait} мин` : 'Очереди нет'}</span>
      </div>
      ${st.inCanteen
        ? '<button class="btn green" data-act="canteen-out">Поел</button>'
        : '<button class="btn" style="white-space:nowrap" data-act="canteen-in">Я тут · +2</button>'}
    </div>
    ${bars}
    <p class="note ${c.advice.tone}" style="margin:0">${esc(c.advice.text)}</p>
    ${c.lowData ? '<p class="small">Мало отметок за 15 минут, оценка примерная. Отмечайся в столовой, чтобы она стала точнее.</p>' : ''}
  </section>`;
}

function renderSignalsMini() {
  const ev = S.events;
  if (!ev || !ev.office) return '';
  const list = ev.signals.slice(0, 2);
  return `<section class="card">
    <div class="row" style="justify-content:space-between">
      <span class="card-title">Сигналы офиса</span>
      <button class="btn small green" data-act="open" data-v="signal">+ Сообщить</button>
    </div>
    ${list.length ? list.map((s) => `<div class="sig">
      <span class="sig-ico ${s.type === 'food' ? 'food' : 'other'}">${ico(s.type === 'food' ? 'food' : 'alert', 20)}</span>
      <div class="grow"><div style="font-weight:700">${esc(s.label)}${s.confirmed ? ' ✓' : ''}</div>
        <div class="small">${[s.zone, s.time, s.up ? 'подтвердили ' + s.up : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
      ${s.mine || s.myVote === 1 ? '' : `<button class="btn small ghost" data-act="vote" data-id="${s.id}" data-v="1">Есть</button>`}
    </div>`).join('') : '<p class="small" style="margin:0">Пока тихо. Холодно, на кухне еда или кофе закончился — сообщи коллегам.</p>'}
    ${ev.signals.length > 2 ? `<button class="linkbtn" style="align-self:flex-start" data-act="tab" data-v="feed">Все сигналы (${ev.signals.length})</button>` : ''}
  </section>`;
}

const ddmm = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');
function whereText(r) {
  if (r.where === 'office') return [r.officeName || officeName(r.office), '#1F7A3A'];
  if (r.where === 'home') return [r.planned ? 'из дома (по плану)' : 'работает из дома', '#2563C9'];
  if (r.where === 'plan_office') return ['собирается в офис (по плану)', '#7BC79A'];
  if (r.where === 'vacation') return [r.until === (S.state && S.state.today) ? 'в отпуске сегодня' : `в отпуске до ${ddmm(r.until)}`, '#F97316'];
  if (r.where === 'sick') return [r.until && r.until !== (S.state && S.state.today) ? `болеет до ${ddmm(r.until)} — выздоравливай!` : 'болеет — выздоравливай!', '#DC2626'];
  if (r.where === 'slack') return ['отлынивает 😏 (сам признался)', '#A855F7'];
  if (r.where === 'idle') return [(S.cat.idleJokes || [])[r.joke] || 'в астрале', '#9AA3B5'];
  if (r.where === 'weekend') return ['выходной', '#9AA3B5'];
  if (r.where === 'none') return ['ещё в пути', '#9AA3B5'];
  if (r.where === 'night') return ['офисы спят', '#9AA3B5'];
  return ['скрывает, где он', '#9AA3B5'];
}

// Плашка «мой статус сегодня» над выбором офиса
function renderToday() {
  const st = S.state;
  const p = st.presence;
  const next = st.nextVacation ? `<p class="small">Следующий отпуск: ${ddmm(st.nextVacation.from)}–${ddmm(st.nextVacation.to)}</p>` : '';
  if (p.where === 'vacation') {
    return `<section class="card" style="background:#FFF4E0">
      <h2>🌴 Ты в отпуске${p.until === st.today ? ' сегодня' : ` до ${ddmm(p.until)}`}</h2>
      <p class="sub">Банда видит статус «в отпуске», зовы не присылают пуши — прочитаешь в чате, когда вернёшься.</p>
      <div class="row" style="gap:8px"><button class="btn ghost grow" data-act="vac-end">Вышел из отпуска</button><button class="btn ghost grow" data-act="open" data-v="profile">График</button></div>
    </section>`;
  }
  if (p.where === 'sick') {
    return `<section class="card" style="background:#FDECEA">
      <h2>🤒 Болеешь${p.until !== st.today ? ` до ${ddmm(p.until)}` : ' сегодня'}</h2>
      <p class="sub">Выздоравливай! Банда видит «болеет», зовы не присылают пуши. Причину и подробности никто не видит.</p>
      <button class="btn ghost" data-act="today" data-v="">Выздоровел</button>
    </section>`;
  }
  if (p.where === 'slack') {
    return `<section class="card" style="background:#F3E8FF">
      <h2>😏 Сегодня отлыниваешь</h2>
      <p class="sub">Честность — лучшая политика. Банда видит «отлынивает (сам признался)».</p>
      <button class="btn ghost" data-act="today" data-v="">Ладно, работаю</button>
    </section>`;
  }
  if (p.where === 'idle') {
    return `<section class="card">
      <p class="sub">Ты не отметился, и банда видит про тебя шутку: <b>«${esc((S.cat.idleJokes || [])[p.joke] || 'в астрале')}»</b>. Выбери статус или отметься в офисе.</p>${next}
    </section>`;
  }
  if (p.where === 'home') {
    return `<section class="card">
      <h2>🏠 Сегодня из дома</h2>
      <p class="sub">${p.planned ? 'Так в твоём плане на этот день недели.' : 'Ты отметил это вручную.'} Банда видит статус «из дома». Приедешь — просто отметься в офисе.</p>
      ${p.planned ? '' : '<button class="btn ghost" data-act="today" data-v="">Отменить</button>'}${next}
    </section>`;
  }
  return next ? `<section class="card">${next}</section>` : '';
}
const officeName = (id) => (S.cat.offices.find((o) => o.id === id) || {}).name || '';

function renderGangNow() {
  const g = S.state.gangNow;
  if (!g.hasGang) {
    return `<section class="card"><h3>Моя банда сейчас</h3><p class="sub">Ты пока ни в одной банде. Создай свою или вступи по ссылке от коллеги.</p>
      <button class="btn blue" data-act="tab" data-v="gang">К бандам</button></section>`;
  }
  const dnd = S.cat.moods.dnd;
  const rows = g.rows.map((r) => {
    const [w, color] = whereText(r);
    const sameOffice = S.state.checkin && r.where === 'office' && r.office === S.state.checkin.office;
    const away = r.where === 'vacation' || r.where === 'sick';
    const quiet = r.mood === dnd;
    const action = r.where === 'vacation' ? '<span class="small">отдыхает</span>'
      : r.where === 'sick' ? '<span class="small">не беспокоим</span>'
      : quiet ? '<span class="small">тихо</span>'
      : `<button class="btn small ${sameOffice ? '' : 'ghost'}" data-act="call-open" data-kind="${sameOffice ? 'coffee' : r.where === 'home' ? 'call' : 'where'}" data-to="${r.id}" data-gang="${r.gangId}">${sameOffice ? 'На кофе' : r.where === 'home' ? 'Созвонимся?' : 'Ты где?'}</button>`;
    return `<div class="person2">
      <span class="ava-wrap" style="opacity:${away ? 0.6 : 1}"><span class="ava-ring" style="border-color:${color}">${avatar(r.look, 32)}</span><span class="ava-dot" style="background:${color}"></span></span>
      <div class="grow"><div style="font-weight:700;font-size:15px">${esc(r.nick)}</div>
      <div class="where ellipsis">${esc(w)}${r.mood && r.where === 'office' ? ' · ' + esc(r.mood) : ''}</div></div>
      ${action}</div>`;
  }).join('');
  const gangName = (S.me.gangs.find((x) => x.id === (S.activeGang || S.me.gangs[0].id)) || {}).name || '';
  return `<section class="card"><div class="row" style="justify-content:space-between"><span class="card-title">Моя банда сейчас</span><button class="linkbtn" data-act="tab" data-v="gang">${esc(gangName)} ›</button></div>
    ${rows || '<p class="sub">В банде пока только ты. Позови коллег ссылкой из вкладки «Моя банда».</p>'}
    ${g.more ? `<p class="small">и ещё ${g.more} — все во вкладке «Моя банда»</p>` : ''}
    ${!S.me.shareOffice ? '<div class="note warn">Банда не видит, где ты: офис, дома или в отпуске. <button class="linkbtn" data-act="share-on">Показывать банде</button></div>' : ''}
  </section>`;
}

// ----- Банда -----
function renderGang() {
  const gangs = S.me.gangs;
  const chips = gangs.length ? `<div class="chips dark">${gangs.map((g) => `<button class="chip ${g.id === S.activeGang ? 'on' : ''}" data-act="gang-select" data-v="${g.id}">${esc(g.name)}</button>`).join('')}</div>` : '';
  const create = `<section class="card">${gangs.length ? '<details><summary style="font-weight:900;cursor:pointer;min-height:32px">Создать ещё банду или вступить по ссылке</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">' : '<h3>Банды</h3>'}
    <p class="sub">Банда — твои люди: команда, соседи по этажу, кофейный клуб. Создание стоит ${50} зёрен залога — они вернутся, когда в банде будет 3 человека.</p>
    <label class="field">Название новой банды<input id="gang-name" maxlength="30" placeholder="Например, Пятничный кофе"></label>
    <button class="btn violet" data-act="gang-create">Создать банду · залог 50</button>
    <label class="field">Или вставь ссылку-приглашение<input id="gang-code" placeholder="https://…/g/ABC123"></label>
    <button class="btn ghost" data-act="gang-join">Вступить</button>
  ${gangs.length ? '</div></details>' : ''}</section>`;
  if (!gangs.length) return create;
  const v = S.gang;
  if (!v) return chips + '<div class="card"><p class="sub">Загружаем банду…</p></div>' + create;
  const g = v.gang;
  const members = v.members.map((m) => {
    const [w, color] = whereText(m);
    return `<div class="person">${avatar(m.look, 34)}<div class="grow"><div style="font-weight:900">${esc(m.nick)}${m.me ? ' (ты)' : ''}</div>
      <div class="where"><span class="dot" style="background:${color}"></span>${esc(w)}${m.mood ? ' · ' + esc(m.mood) : ''}${m.status ? ' · ' + esc(m.status) : ''}</div></div>
      ${m.me ? '' : `<button class="btn small ghost" data-act="call-open" data-kind="where" data-to="${m.id}" data-gang="${g.id}">Позвать</button>`}</div>`;
  }).join('');
  const msgs = v.messages.map(renderMsg).join('') || '<p class="sub">Сообщения и зовы живут 24 часа. Начни первым.</p>';
  return `${chips}
  <section class="card" style="${g.gold ? 'border:3px solid #FFC93C' : ''}">
    <div class="row"><span class="dot" style="width:14px;height:14px;background:${esc(g.color)}"></span><h2 class="grow">${esc(g.name)}</h2><span class="small">${v.gang.count} ${plural(v.gang.count, 'участник', 'участника', 'участников')}</span></div>
    ${g.motto ? `<p class="sub" style="font-style:italic">«${esc(g.motto)}»</p>` : ''}
    ${g.depositPending ? '<div class="note warn">Залог 50 зёрен вернётся, когда в банде будет 3 человека.</div>' : ''}
    <div class="calls">${Object.entries(S.cat.calls).map(([k, c]) => `<button class="call" style="background:${CALL_STYLE[k]}" data-act="call-open" data-kind="${k}" data-gang="${g.id}">${esc(c.label)}</button>`).join('')}</div>
  </section>
  <section class="card">
    <h3>Чат</h3>
    <div class="chat" id="chat">${msgs}</div>
    <div class="row"><label class="field grow" style="gap:0"><span class="hidden">Сообщение</span><input id="chat-text" maxlength="300" placeholder="Написать банде" aria-label="Сообщение банде"></label>
      <button class="btn" data-act="chat-send" aria-label="Отправить">→</button></div>
  </section>
  <section class="card"><h3>Участники</h3>${members}
    <button class="btn blue" data-act="invite-share">Позвать в банду по ссылке</button>
    <p class="small">Ссылка: ${esc(g.link)}. Отправь её в рабочий мессенджер — вступить смогут только коллеги с рабочей почтой.</p>
    <div class="row" style="justify-content:space-between">
      <button class="linkbtn" data-act="report" data-type="gang" data-id="${g.id}">Пожаловаться на банду</button>
      <button class="linkbtn" data-act="gang-leave">Выйти из банды</button>
    </div>
  </section>
  ${create}`;
}

function renderMsg(m) {
  const reps = m.replies.length ? `<div class="reps">${m.replies.map((r) => `<span class="rep">${esc(r.nick)}: ${esc(r.label)}</span>`).join('')}</div>` : '';
  if (m.type === 'call') {
    const to = m.toNick ? ` → ${esc(m.toNick)}` : '';
    const body = `<b>${esc(m.author)}</b> ${esc(m.callText)}${m.opt ? ` · ${esc(m.opt.toLowerCase())}` : ''}${m.text ? ` · ${esc(m.text)}` : ''}`;
    return `<div class="msg call-msg ${m.mine ? 'mine' : ''}">
      <div class="meta"><span>${m.time}${to}</span></div>
      <div class="text">${body}</div>${reps}
      ${m.canReply ? `<div class="chips">${m.replyOptions.map((l) => `<button class="chip" data-act="reply" data-id="${m.id}" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div><span class="small">Ответ: +1 зерно</span>` : ''}
    </div>`;
  }
  return `<div class="msg ${m.mine ? 'mine' : ''}">
    <div class="meta"><b>${esc(m.author)}</b><span>${m.time}</span>${m.mine ? '' : `<button class="linkbtn" data-act="report" data-type="message" data-id="${m.id}" aria-label="Пожаловаться">⚑</button>`}</div>
    <div class="text">${esc(m.text)}</div></div>`;
}

// ----- События -----
function renderFeed() {
  const ev = S.events;
  if (!ev) return '<div class="card"><p class="sub">Загружаем…</p></div>';
  const sig = ev.office
    ? `<section class="card">
        <div class="row"><h3 class="grow">Сигналы офиса</h3><button class="btn small" data-act="open" data-v="signal">Сообщить</button></div>
        ${ev.signals.length ? ev.signals.map((s) => `<div class="item"><div class="grow">
          <div style="font-weight:900">${esc(s.label)}${s.confirmed ? ' ✓' : ''}</div>
          <div class="where">${s.time}${s.zone ? ' · ' + esc(s.zone) : ''}${s.comment ? ' · ' + esc(s.comment) : ''}</div>
          <div class="small">подтвердили: ${s.up}${s.down ? ` · неактуально: ${s.down}` : ''}</div></div>
          ${s.mine ? '<span class="small">твой</span>' : `<div class="row" style="gap:4px">
            <button class="chip ${s.myVote === 1 ? 'on' : ''}" data-act="vote" data-id="${s.id}" data-v="1" aria-label="Подтверждаю">Да</button>
            <button class="chip ${s.myVote === -1 ? 'on' : ''}" data-act="vote" data-id="${s.id}" data-v="-1" aria-label="Уже неактуально">Уже нет</button></div>`}
        </div>`).join('') : '<p class="sub">Пока тихо. Заметил, что холодно, на кухне яблоки или кофе закончился — сообщи коллегам.</p>'}
        <p class="small">Пожарная тревога и эвакуация — только по официальным каналам АХО и охраны, не здесь.</p>
      </section>`
    : '<section class="card"><h3>Сигналы офиса</h3><p class="sub">Отметься в офисе, чтобы видеть и отправлять сигналы: холодно, еда на кухне, кофе закончился.</p></section>';
  const list = ev.events.length ? ev.events.map((e) => `<div class="item"><div class="grow"><div style="font-weight:700">${esc(e.text)}</div><div class="where">${e.time}${e.office ? ' · ' + esc(e.office) : ''}</div></div></div>`).join('') : '<p class="sub">Событий пока нет.</p>';
  return `${sig}<section class="card"><h3>Лента</h3>${list}</section>`;
}

// ----- Шторки -----
function sheetWrap(title, body) {
  return `<div class="sheet-bg" data-act="close-bg"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
    ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}${body}</div></div>`;
}

function renderSheet() {
  switch (S.sheet) {
    case 'profile': return sheetWrap('Профиль', renderProfile());
    case 'shop': return sheetWrap('Лавка', renderShop());
    case 'install': return sheetWrap('Установи на телефон', renderInstall());
    case 'compose': return sheetWrap(S.cat.calls[S.compose.kind].label, renderCompose());
    case 'signal': return sheetWrap('Сигнал офиса', renderSignal());
    case 'office': return sheetWrap('Сменить офис', `<p class="sub">Отметка перенесётся в выбранный офис. Зёрна за отметку начисляются один раз в день.</p>
      ${S.cat.offices.map((o) => `<button class="office-btn" style="background:${OFFICE_BG[o.id] || o.color}" data-act="checkin" data-v="${o.id}">${esc(o.name)}${S.state.checkin && S.state.checkin.office === o.id ? ' · сейчас здесь' : ''}</button>`).join('')}`);
    case 'sick': return sheetWrap('Болею', `
      <p class="sub">Банда увидит «болеет — выздоравливай!», зовы не будут присылать пуши. Диагноз и подробности не нужны и нигде не сохраняются. Статус снимется сам после последнего дня.</p>
      <label class="field">По какое число (включительно, до 14 дней)<input id="sick-until" type="date" min="${S.state.today}" value="${S.state.today}"></label>
      <button class="btn wide" data-act="sick-now">Болею</button>`);
    case 'vacation': return sheetWrap('Я в отпуске', `
      <p class="sub">С сегодняшнего дня. Банда увидит «в отпуске до …», зовы не будут присылать пуши. Отпуск попадёт в график — его можно поправить в профиле.</p>
      <label class="field">По какое число (включительно)<input id="vac-until" type="date" min="${S.state.today}" value="${S.state.today}"></label>
      <button class="btn wide" data-act="vac-now">Ушёл в отпуск</button>`);
    default: return '';
  }
}

function renderCompose() {
  const c = S.compose;
  const def = S.cat.calls[c.kind];
  const gang = S.me.gangs.find((g) => g.id === c.gang);
  const members = (S.gang && S.gang.gang.id === c.gang ? S.gang.members : []).filter((m) => !m.me);
  return `
    <p class="sub">Банда: <b>${esc(gang ? gang.name : '')}</b>. Придёт пуш — тихие часы 19:00–09:00 уважаем.</p>
    <div class="field">Кому<div class="chips">
      <button class="chip ${!c.to ? 'on' : ''}" data-act="c-to" data-v="">Всей банде</button>
      ${members.map((m) => `<button class="chip ${c.to === m.id ? 'on' : ''}" data-act="c-to" data-v="${m.id}">${esc(m.nick)}</button>`).join('')}
    </div></div>
    ${def.opts.length ? `<div class="field">Когда / где<div class="chips">${def.opts.map((o) => `<button class="chip ${c.opt === o ? 'on' : ''}" data-act="c-opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>` : ''}
    ${def.needsText ? `<label class="field">Какая переговорка<input id="c-text" maxlength="40" placeholder="Например, «Марс», 5 этаж" value="${esc(c.text || '')}"></label>` : ''}
    <button class="btn wide" data-act="call-send">Позвать</button>
    <p class="small">Не больше 3 зовов в час.</p>`;
}

function renderSignal() {
  const s = S.signal || {};
  return `
    <div class="field">Что случилось<div class="chips">${Object.entries(S.cat.signals).map(([k, l]) => `<button class="chip ${s.type === k ? 'on' : ''}" data-act="s-type" data-v="${k}">${esc(l)}</button>`).join('')}</div></div>
    <label class="field">Где (этаж, зона)<input id="s-zone" maxlength="30" placeholder="3 этаж, кухня" value="${esc(s.zone || '')}"></label>
    <label class="field">Комментарий<input id="s-comment" maxlength="60" placeholder="Принесли яблоки" value="${esc(s.comment || '')}"></label>
    <button class="btn wide" data-act="signal-send" ${s.type ? '' : 'disabled'}>Отправить сигнал</button>
    <p class="small">Когда двое коллег подтвердят — сигнал получат все отмеченные в офисе, а ты +2 зерна. Ложные сигналы скрываются после трёх «Уже нет».</p>`;
}

function renderInstall() {
  const ios = isIOS();
  return `
    ${isStandalone() ? '<div class="note good">Приложение уже установлено.</div>' : ''}
    ${deferredInstall ? '<button class="btn wide" data-act="install-native">Установить</button>' : ''}
    <h3>${ios ? 'iPhone (Safari)' : 'Android (Chrome)'}</h3>
    ${ios ? `<ol class="ol"><li>Открой этот сайт в Safari.</li><li>Нажми «Поделиться» внизу экрана.</li><li>Выбери «На экран “Домой”».</li><li>Открой Этаж с иконки и включи уведомления в профиле.</li></ol>
      <p class="small">Уведомления на iPhone работают с iOS 16.4 и только из установленного приложения.</p>`
      : `<ol class="ol"><li>Открой меню браузера ⋮.</li><li>Выбери «Установить приложение» или «Добавить на главный экран».</li><li>Открой Этаж с иконки и включи уведомления в профиле.</li></ol>`}
    <h3>${ios ? 'Android' : 'iPhone'}</h3>
    <p class="sub">${ios ? 'Chrome → меню ⋮ → «Установить приложение».' : 'Safari → «Поделиться» → «На экран “Домой”».'}</p>`;
}

function renderProfile() {
  const me = S.me;
  const L = S.cat.look;
  const look = me.look;
  const p = me.profile;
  const sw = (key, vals) => `<div class="row" style="flex-wrap:wrap;gap:8px">${vals.map((v) => `<button class="swatch ${look[key] === v ? 'on' : ''}" style="background:${HOODIE[v] || v}" data-act="look" data-k="${key}" data-v="${v}" aria-label="${key} ${v}"></button>`).join('')}</div>`;
  const hairNames = { short: 'Короткие', long: 'Длинные', tail: 'Хвост', curly: 'Кудри' };
  const pushState = !('Notification' in window) ? 'unsupported' : Notification.permission;
  return `
    <div class="row">${avatar(look, 72)}<div class="grow"><div class="nick" style="color:var(--ink)">${esc(me.nick)}</div>${me.status ? `<div class="status" style="color:#B7791F">${esc(me.status)}</div>` : ''}<div class="small">${me.beans} зёрен</div></div></div>
    <h3>Аватар</h3>
    <div class="chips">${['m', 'f'].map((v) => `<button class="chip ${look.preset === v ? 'on' : ''}" data-act="look" data-k="preset" data-v="${v}">${v === 'm' ? 'М' : 'Ж'}</button>`).join('')}</div>
    <div class="field">Причёска<div class="chips">${L.hairStyle.map((v) => `<button class="chip ${look.hairStyle === v ? 'on' : ''}" data-act="look" data-k="hairStyle" data-v="${v}">${hairNames[v] || v}</button>`).join('')}</div></div>
    <div class="field">Цвет волос${sw('hair', L.hair)}</div>
    <div class="field">Кожа${sw('skin', L.skin)}</div>
    <div class="field">Худи${sw('hoodie', L.hoodie)}</div>
    <div class="chips"><button class="chip ${look.glasses ? 'on' : ''}" data-act="look-toggle" data-k="glasses">Очки</button><button class="chip ${look.phones ? 'on' : ''}" data-act="look-toggle" data-k="phones">Наушники</button></div>

    <h3>Обо мне</h3>
    <div class="field">Статус<div class="chips">${Object.entries(S.cat.moods).map(([k, l]) => `<button class="chip ${p.mood === k ? 'on' : ''}" data-act="prof" data-k="mood" data-v="${k}">${esc(l)}</button>`).join('')}</div></div>
    <div class="field">Мой офис<div class="chips">${S.cat.offices.map((o) => `<button class="chip ${p.home === o.id ? 'on' : ''}" data-act="prof" data-k="home" data-v="${o.id}">${esc(o.name)}</button>`).join('')}</div></div>
    <div class="field">План недели — нажимай, чтобы переключить: офис → дом → не знаю
      <div class="plan">${S.cat.days.map((d) => { const v = p.plan[d]; return `<button class="plan-day ${v || 'none'}" data-act="plan-day" data-v="${d}" aria-label="${d}: ${v === 'office' ? 'офис' : v === 'home' ? 'дом' : 'не задано'}"><b>${d}</b><span>${v === 'office' ? 'Офис' : v === 'home' ? 'Дом' : '—'}</span></button>`; }).join('')}</div>
      <span class="small" style="font-weight:600">Банда видит «по плану из дома» или «собирается в офис». Отметка в офисе всегда важнее плана.</span></div>
    <div class="field">График отпусков
      ${p.vacations.length ? p.vacations.map((v, i) => `<div class="item"><span class="grow" style="color:var(--ink);font-weight:800">🌴 ${ddmm(v.from)} — ${ddmm(v.to)}</span><button class="btn small danger" data-act="vac-del" data-v="${i}">Удалить</button></div>`).join('') : '<span class="small" style="font-weight:600">Пока пусто. В эти дни банда увидит «в отпуске до …», а зовы не будут присылать пуши.</span>'}
      <div class="row" style="gap:6px;align-items:flex-end">
        <label class="field grow">С<input id="vac-from" type="date"></label>
        <label class="field grow">По<input id="vac-to" type="date"></label>
        <button class="btn small" data-act="vac-add" style="min-height:48px">Добавить</button>
      </div></div>
    <div class="field">Интересы (до 5)<div class="chips">${S.cat.tags.map((t) => `<button class="chip ${p.tags.includes(t) ? 'on' : ''}" data-act="prof-tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
    <label class="field">О себе (до 60 символов)<input id="p-about" maxlength="60" value="${esc(p.about)}" placeholder="Люблю кофе и настолки"></label>
    <label class="field">День рождения (ДД.ММ, без года)<input id="p-bday" maxlength="5" inputmode="numeric" value="${esc(p.bday)}" placeholder="14.03"></label>
    <button class="btn ghost" data-act="prof-save">Сохранить</button>

    <h3>Приватность и уведомления</h3>
    <label class="check"><input type="checkbox" data-act="toggle" data-k="shareOffice" ${me.shareOffice ? 'checked' : ''}> <span>Показывать банде, где я: офис, дома или в отпуске</span></label>
    <label class="check"><input type="checkbox" data-act="toggle" data-k="quiet" ${me.quiet ? 'checked' : ''}> <span>Тихие часы 19:00–09:00 — не присылать зовы</span></label>
    ${pushState === 'granted' ? '<div class="row"><span class="note good grow">Уведомления включены</span><button class="btn small ghost" data-act="push-test">Проверить</button></div>'
      : pushState === 'unsupported' ? `<div class="note warn">${isIOS() && !isStandalone() ? 'На iPhone уведомления работают только из установленного приложения.' : 'Этот браузер не поддерживает уведомления.'}</div>`
      : pushState === 'denied' ? '<div class="note warn">Уведомления запрещены в настройках браузера.</div>'
      : `<button class="btn blue" data-act="push-enable" ${S.vapidKey ? '' : 'disabled'}>Включить уведомления</button>`}
    <button class="btn ghost" data-act="open" data-v="install">Как установить на телефон</button>
    ${me.isAdmin ? '<a class="btn violet" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="/admin.html">Модерация</a>' : ''}
    <div class="row" style="justify-content:space-between">
      <button class="linkbtn" data-act="logout">Выйти</button>
      <a class="linkbtn" href="/privacy.html" target="_blank" rel="noopener">Политика</a>
      <button class="linkbtn" style="color:#B42318" data-act="delete-account">Удалить аккаунт</button>
    </div>`;
}

function renderShop() {
  if (!S.shop) return '<p class="sub">Загружаем…</p>';
  const groups = [['status', 'Статусы'], ['frame', 'Рамки аватара'], ['crown', 'Особое'], ['gang', 'Для банды']];
  const item = (it) => {
    let action;
    if (it.kind === 'gang') {
      action = S.me.gangs.length ? `<button class="btn small" data-act="buy" data-v="${it.id}" ${S.shop.beans < it.price ? 'disabled' : ''}>${it.price} ${BEAN}</button>` : '<span class="small">нужна банда</span>';
    } else if (it.owned) {
      action = `<button class="btn small ${it.equipped ? 'green' : 'ghost'}" data-act="equip" data-v="${it.id}" data-on="${it.equipped ? '0' : '1'}">${it.equipped ? 'Надето' : 'Надеть'}</button>`;
    } else if (it.left === 0) {
      action = '<span class="small">тираж закончился</span>';
    } else {
      action = `<button class="btn small" data-act="buy" data-v="${it.id}" ${S.shop.beans < it.price ? 'disabled' : ''}>${it.price} ${BEAN}</button>`;
    }
    return `<div class="item"><div class="grow"><div style="font-weight:900">${it.color ? `<span class="dot" style="background:${it.color}"></span>` : ''}${esc(it.name)}</div>
      ${it.left !== undefined ? `<div class="small">осталось ${it.left}</div>` : ''}</div>${action}</div>`;
  };
  const gangSel = S.me.gangs.length > 1 ? `<div class="field">Покупка для банды<div class="chips">${S.me.gangs.map((g) => `<button class="chip ${g.id === (S.shopGang || S.activeGang) ? 'on' : ''}" data-act="shop-gang" data-v="${g.id}">${esc(g.name)}</button>`).join('')}</div></div>` : '';
  return `<div class="note warn">У тебя ${S.shop.beans} зёрен</div>
    ${groups.map(([k, title]) => `<h3>${title}</h3>${k === 'gang' ? gangSel : ''}${S.shop.items.filter((i) => i.kind === k).map(item).join('')}`).join('')}
    ${S.gang && S.gang.gang.mottoOwned ? `<label class="field">Девиз банды «${esc(S.gang.gang.name)}»<input id="motto" maxlength="40" value="${esc(S.gang.gang.motto || '')}"></label><button class="btn ghost" data-act="motto-save">Сохранить девиз</button>` : ''}
    <h3>Как заработать</h3>
    <ol class="ol"><li>Отметка в офисе — +5 (раз в день)</li><li>Отметка в столовой — +2 (до 2 раз в день)</li><li>Ответ на зов банды — +1 (до 10 в день)</li><li>Подтверждённый сигнал офиса — +2 (до 3 в день)</li><li>Банда набрала 3 человек — залог 50 вернётся</li></ol>`;
}

// ---------- Действия ----------
async function run(fn, { rerender = true } = {}) {
  S.error = '';
  try { await fn(); } catch (e) {
    if (S.sheet) S.error = e.message; else toast(e.message);
  }
  if (rerender) render();
}

const actions = {
  async 'login-submit'() {
    const email = $('#email').value.trim();
    S.onb.email = email;
    if (!$('#consent').checked) { S.onb.error = 'Отметь согласие с политикой и правилами.'; return render(); }
    S.busy = true; S.onb.error = ''; render();
    try {
      const r = await post('/api/auth/request', { email, consent: true });
      S.onb = { ...S.onb, step: 'sent', error: '', devLink: r.devLink || null, devCode: r.devCode || null };
    } catch (e) { S.onb.error = e.message; }
    S.busy = false; render();
  },
  async 'code-submit'() {
    try {
      await post('/api/auth/code', { email: S.onb.email, code: $('#code').value });
      await boot();
    } catch (e) { S.onb.error = e.message; render(); }
  },
  'onb-back'() { S.onb.step = 'email'; S.onb.error = ''; render(); },
  async 'nick-more'() { S.onb.nicks = (await get('/api/nick-suggestions')).nicks; render(); },
  'nick-pick'(el) { S.onb.nick = el.dataset.v; render(); },
  'onb-preset'(el) { S.onb.nick = $('#nick').value; S.onb.preset = el.dataset.v; render(); },
  async 'nick-submit'() {
    const nick = $('#nick').value.trim();
    S.onb.nick = nick;
    try {
      await post('/api/me/nick', { nick });
      const f = S.onb.preset === 'f';
      await post('/api/me/profile', { look: { preset: f ? 'f' : 'm', hairStyle: f ? 'long' : 'short' } });
      await boot();
      toast('+50 зёрен на старт');
      if (!isStandalone()) { S.sheet = 'install'; render(); }
    } catch (e) { S.onb.error = e.message; render(); }
  },

  async tab(el) {
    S.tab = el.dataset.v; S.sheet = null; render();
    await run(() => refresh());
  },
  checkin: (el) => run(async () => {
    S.sheet = null;
    const r = await post('/api/checkin', { office: el.dataset.v });
    if (r.beans) toast(`+${r.beans} зёрен за отметку`);
    await refresh({ all: true });
  }),
  checkout: () => run(async () => { await post('/api/checkout'); toast('Хорошего вечера!'); await refresh(); }),
  'canteen-in': () => run(async () => { const r = await post('/api/canteen/in'); toast(r.beans ? `Приятного аппетита! +${r.beans}` : 'Приятного аппетита!'); await loadState(); }),
  'canteen-out': () => run(async () => { await post('/api/canteen/out'); await loadState(); }),
  'share-on': () => run(async () => { await post('/api/me/profile', { shareOffice: true }); S.me.shareOffice = true; await loadState(); }),

  'gang-select': (el) => run(async () => { S.activeGang = Number(el.dataset.v); store.set('activeGang', S.activeGang); await loadGang(); }),
  'gang-create': () => run(async () => {
    const r = await post('/api/gangs', { name: $('#gang-name').value });
    S.activeGang = r.id; store.set('activeGang', r.id);
    await loadMe(); await loadGang();
    toast('Банда создана. Позови коллег по ссылке');
  }),
  'gang-join': () => run(async () => joinByCode($('#gang-code').value)),
  'gang-leave': () => run(async () => {
    if (!confirmInline('gang-leave')) return;
    await post(`/api/gangs/${S.activeGang}/leave`);
    S.activeGang = null; await loadMe(); await loadGang();
  }),
  'invite-share': async () => {
    const link = S.gang.gang.link;
    const text = `Вступай в банду «${S.gang.gang.name}» в Этаже: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Этаж', text, url: link });
      else { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); }
    } catch {}
  },
  'call-open': async (el) => {
    const gang = Number(el.dataset.gang || S.activeGang);
    if (gang !== S.activeGang || !S.gang) { S.activeGang = gang; await loadGang().catch(() => {}); }
    const def = S.cat.calls[el.dataset.kind];
    S.compose = { kind: el.dataset.kind, gang, to: el.dataset.to ? Number(el.dataset.to) : null, opt: def.opts[0] || null, text: '' };
    S.sheet = 'compose'; S.error = ''; render();
  },
  'c-to'(el) { saveComposeText(); S.compose.to = el.dataset.v ? Number(el.dataset.v) : null; render(); },
  'c-opt'(el) { saveComposeText(); S.compose.opt = el.dataset.v; render(); },
  'call-send': () => run(async () => {
    saveComposeText();
    const c = S.compose;
    const r = await post(`/api/gangs/${c.gang}/messages`, { type: 'call', kind: c.kind, to: c.to, opt: c.opt, text: c.text });
    S.sheet = null; S.tab = 'gang';
    toast(r.away ? `Зов отправлен. ${r.away === 1 && c.to ? 'Человек в отпуске' : 'Кто-то в отпуске'} — пуш не придёт, увидит в чате` : r.quiet ? 'Отправлено. Сейчас тихие часы — у кого они включены, пуш не придёт' : 'Зов отправлен');
    await loadGang(); markSeen('chat');
  }),
  reply: (el) => run(async () => { const r = await post(`/api/messages/${el.dataset.id}/reply`, { label: el.dataset.v }); if (r.beans) toast(`+${r.beans} зерно`); await loadGang(); }),
  'chat-send': () => run(async () => {
    const text = $('#chat-text').value;
    if (!text.trim()) return;
    await post(`/api/gangs/${S.activeGang}/messages`, { type: 'text', text });
    await loadGang(); markSeen('chat');
  }),
  report: (el) => run(async () => {
    if (!confirmInline('report-' + el.dataset.type + el.dataset.id, 'Нажми ещё раз, чтобы пожаловаться')) return;
    await post('/api/report', { type: el.dataset.type, id: Number(el.dataset.id) });
    toast('Жалоба отправлена модераторам');
  }, { rerender: false }),

  's-type'(el) { saveSignalText(); S.signal = { ...(S.signal || {}), type: el.dataset.v }; render(); },
  'signal-send': () => run(async () => {
    saveSignalText();
    await post('/api/signals', S.signal);
    S.sheet = null; S.signal = null; toast('Сигнал отправлен. Ждём подтверждений'); await loadEvents();
  }),
  vote: (el) => run(async () => { await post(`/api/signals/${el.dataset.id}/vote`, { vote: Number(el.dataset.v) }); await loadEvents(); }),

  async open(el) {
    S.sheet = el.dataset.v; S.error = '';
    if (S.sheet === 'signal') S.signal = {};
    render();
    if (S.sheet === 'shop') await run(async () => { S.shop = await get('/api/shop'); if (S.activeGang && !S.gang) await loadGang(); });
  },
  close() { S.sheet = null; S.error = ''; render(); },
  'close-bg'(el, e) { if (e.target === el) actions.close(); },
  'shop-gang'(el) { S.shopGang = Number(el.dataset.v); render(); },
  buy: (el) => run(async () => {
    await post('/api/shop/buy', { item: el.dataset.v, gangId: S.shopGang || S.activeGang });
    toast('Куплено!');
    await loadMe(); S.shop = await get('/api/shop'); await loadGang();
  }),
  equip: (el) => run(async () => { await post('/api/shop/equip', { item: el.dataset.v, on: el.dataset.on === '1' }); await loadMe(); S.shop = await get('/api/shop'); }),
  'motto-save': () => run(async () => { await post(`/api/gangs/${S.gang.gang.id}/motto`, { motto: $('#motto').value }); await loadGang(); toast('Девиз сохранён'); }),

  look: (el) => run(async () => { await post('/api/me/profile', { look: { [el.dataset.k]: el.dataset.v } }); await loadMe(); }),
  'look-toggle': (el) => run(async () => { await post('/api/me/profile', { look: { [el.dataset.k]: !S.me.look[el.dataset.k] } }); await loadMe(); }),
  prof: (el) => run(async () => {
    const v = el.dataset.k === 'home' && S.me.profile.home === el.dataset.v ? null : el.dataset.v;
    await post('/api/me/profile', { profile: { [el.dataset.k]: v } }); await loadMe();
  }),
  today: (el) => run(async () => {
    await post('/api/me/profile', { profile: { today: el.dataset.v ? { kind: el.dataset.v } : null } });
    await loadMe(); await loadState();
    if (el.dataset.v === 'slack') toast('Признание засчитано 😏');
  }),
  'plan-day': (el) => run(async () => {
    const plan = { ...S.me.profile.plan };
    const cur = plan[el.dataset.v];
    if (!cur) plan[el.dataset.v] = 'office'; else if (cur === 'office') plan[el.dataset.v] = 'home'; else delete plan[el.dataset.v];
    await post('/api/me/profile', { profile: { plan } }); await loadMe();
  }),
  'sick-now': () => run(async () => {
    await post('/api/me/profile', { profile: { today: { kind: 'sick', to: $('#sick-until').value || S.state.today } } });
    S.sheet = null; await loadMe(); await loadState(); toast('Выздоравливай! Зовы не будут беспокоить');
  }),
  'vac-now': () => run(async () => {
    const today = S.state.today;
    const to = $('#vac-until').value || today;
    const rest = S.me.profile.vacations.filter((v) => v.to < today || v.from > to);
    await post('/api/me/profile', { profile: { vacations: [...rest, { from: today, to }] } });
    S.sheet = null; await loadMe(); await loadState(); toast('Хорошего отдыха! Зовы не будут беспокоить');
  }),
  'vac-end': () => run(async () => {
    const today = S.state.today;
    const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
    const list = S.me.profile.vacations
      .map((v) => (v.from <= today && today <= v.to ? (v.from < today ? { from: v.from, to: yesterday } : null) : v))
      .filter(Boolean);
    await post('/api/me/profile', { profile: { vacations: list, today: null } });
    await loadMe(); await loadState(); toast('С возвращением!');
  }),
  'vac-add': () => run(async () => {
    const from = $('#vac-from').value; const to = $('#vac-to').value || from;
    if (!from) throw new Error('Выбери дату начала отпуска');
    await post('/api/me/profile', { profile: { vacations: [...S.me.profile.vacations, { from, to }] } });
    await loadMe(); await loadState(); toast('Отпуск добавлен');
  }),
  'vac-del': (el) => run(async () => {
    const list = S.me.profile.vacations.filter((_, i) => i !== Number(el.dataset.v));
    await post('/api/me/profile', { profile: { vacations: list } }); await loadMe(); await loadState();
  }),
  'prof-day': (el) => run(async () => {
    const d = new Set(S.me.profile.days); d.has(el.dataset.v) ? d.delete(el.dataset.v) : d.add(el.dataset.v);
    await post('/api/me/profile', { profile: { days: [...d] } }); await loadMe();
  }),
  'prof-tag': (el) => run(async () => {
    const t = new Set(S.me.profile.tags);
    if (t.has(el.dataset.v)) t.delete(el.dataset.v); else if (t.size >= 5) throw new Error('Не больше 5 интересов'); else t.add(el.dataset.v);
    await post('/api/me/profile', { profile: { tags: [...t] } }); await loadMe();
  }),
  'prof-save': () => run(async () => { await post('/api/me/profile', { profile: { about: $('#p-about').value, bday: $('#p-bday').value } }); await loadMe(); toast('Сохранено'); }),
  toggle: (el) => run(async () => { await post('/api/me/profile', { [el.dataset.k]: el.checked }); await loadMe(); await loadState(); }),
  'push-enable': () => run(enablePush),
  'push-test': () => run(async () => { await post('/api/push/test'); toast('Отправили тестовое уведомление'); }, { rerender: false }),
  'install-hide'() { store.set('installHiddenUntil', Date.now() + 864e5); render(); },
  async 'install-native'() { if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); } },
  logout: () => run(async () => { await post('/api/auth/logout'); S.me = null; S.sheet = null; S.onb = { step: 'email', email: '', error: '', nicks: [] }; }),
  'delete-account': () => run(async () => {
    if (!confirmInline('delete', 'Нажми ещё раз: аккаунт, банды без участников и зёрна удалятся навсегда')) return;
    await api('DELETE', '/api/me'); S.me = null; S.sheet = null;
  })
};

// Подтверждение вторым нажатием — без системных диалогов
let pendingConfirm = null;
function confirmInline(key, text = 'Нажми ещё раз для подтверждения') {
  if (pendingConfirm && pendingConfirm.key === key && Date.now() - pendingConfirm.at < 4000) { pendingConfirm = null; return true; }
  pendingConfirm = { key, at: Date.now() };
  toast(text);
  return false;
}
function saveComposeText() { const el = $('#c-text'); if (el && S.compose) S.compose.text = el.value; }
function saveSignalText() { if (!S.signal) S.signal = {}; const z = $('#s-zone'); const c = $('#s-comment'); if (z) S.signal.zone = z.value; if (c) S.signal.comment = c.value; }

async function joinByCode(code) {
  const r = await post('/api/gangs/join', { code });
  S.activeGang = r.id; store.set('activeGang', r.id); S.tab = 'gang';
  await loadMe(); await loadGang();
  toast(r.already ? 'Ты уже в этой банде' : 'Ты в банде!');
}

// ---------- Пуши ----------
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(isIOS() ? 'Сначала установи Этаж на экран «Домой» — на iPhone уведомления работают только так.' : 'Браузер не поддерживает уведомления.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Уведомления не разрешены.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(S.vapidKey) }));
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
  toast('Уведомления включены');
}

// ---------- События DOM ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  if (el.dataset.act === 'close-bg' && e.target !== el) return; // клик внутри шторки — не закрываем и не мешаем ссылкам
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.tagName === 'INPUT' && el.type === 'checkbox' && el.dataset.act && actions[el.dataset.act]) actions[el.dataset.act](el, e);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id) {
    const map = { email: 'login-submit', code: 'code-submit', nick: 'nick-submit', 'chat-text': 'chat-send' };
    if (map[e.target.id]) { e.preventDefault(); actions[map[e.target.id]](); }
  }
  if (e.key === 'Escape' && S.sheet) actions.close();
});

// ---------- Обновление в фоне ----------
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
setInterval(async () => {
  if (document.hidden || !S.me || !S.me.nick || typing() || S.sheet) return;
  try { await refresh(); render(); } catch {}
}, 20000);
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && S.me && S.me.nick && !typing()) { try { await refresh(); render(); } catch {} }
});

// ---------- Старт ----------
async function boot() {
  await loadMe();
  const hash = location.hash;
  if (hash.startsWith('#gang/')) { S.tab = 'gang'; S.activeGang = Number(hash.slice(6)) || S.activeGang; }
  if (hash === '#feed') S.tab = 'feed';
  const join = /^#join=([A-Z0-9]{6})$/i.exec(hash);
  if (join) store.set('pendingJoin', join[1]);
  if (S.me && !S.me.nick && !S.onb.nicks.length) S.onb.nicks = (await get('/api/nick-suggestions')).nicks;
  if (S.me && S.me.nick) {
    const pending = store.get('pendingJoin', null);
    if (pending) { store.set('pendingJoin', null); try { await joinByCode(pending); } catch (e) { toast(e.message); } }
    await refresh({ all: true });
  }
  if (hash) history.replaceState(null, '', location.pathname + (location.search.includes('login=') ? '' : location.search));
  render();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot().catch((e) => { root.innerHTML = `<div class="onb"><div class="card"><h2>Не получилось загрузиться</h2><p class="sub">${esc(e.message)}</p></div></div>`; });
