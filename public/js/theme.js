// Тема оформления: «авто» (как в телефоне), светлая или тёмная. Грузится до отрисовки, чтобы не мигало.
(function () {
  var COLORS = { light: '#F2F4F8', dark: '#0E1020' };
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function pref() { try { return JSON.parse(localStorage.getItem('etazh:theme')) || 'auto'; } catch (e) { return 'auto'; } }
  function apply() {
    var p = pref();
    var t = p === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : p;
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', COLORS[t]);
    var a = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (a) a.setAttribute('content', t === 'dark' ? 'black-translucent' : 'default');
  }
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  window.etazhTheme = { apply: apply, pref: pref };
})();
