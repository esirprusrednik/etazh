// Service worker: кэш оболочки приложения и показ пушей.
const CACHE = 'etazh-v152';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/building.js', '/js/crest.js', '/js/guide.js', '/js/ships.js', '/js/seafx.js', '/js/duelart.js', '/js/practice.js', '/sounds/battle.mp3', '/sounds/lose.mp3', '/sounds/win.mp3', '/sounds/rally.mp3', '/sounds/horn.mp3', '/sounds/miss1.mp3', '/sounds/miss2.mp3', '/sounds/hit1.mp3', '/sounds/hit2.mp3', '/sounds/sunk1.mp3', '/sounds/resign.mp3', '/sounds/emo_lol.mp3', '/sounds/emo_angry.mp3', '/sounds/emo_bored.mp3', '/sounds/emo_smart.mp3', '/sounds/emo_oops.mp3', '/sounds/emo_clap.mp3', '/sounds/emo_mercy.mp3', '/sounds/emo_easy.mp3', '/sounds/climb_loop.mp3', '/sounds/emo_sink.mp3', '/sounds/emo_miss.mp3', '/sounds/emo_gull.mp3', '/sounds/emo_boom.mp3', '/sounds/emo_hmm.mp3', '/sounds/emo_bye.mp3', '/sounds/emo_rage.mp3', '/sounds/emo_wait.mp3', '/js/theme.js', '/art/rps.webp', '/art/dice.webp', '/art/ttt.webp', '/art/ship.webp', '/art/bolt.webp', '/art/trophy.webp', '/art/coffee.webp', '/art/lunch.webp', '/art/pin.webp', '/art/ships/s1h.webp', '/art/ships/s1hw.webp', '/art/ships/s1v.webp', '/art/ships/s1vw.webp', '/art/ships/s2h.webp', '/art/ships/s2hw.webp', '/art/ships/s2v.webp', '/art/ships/s2vw.webp', '/art/ships/s3h.webp', '/art/ships/s3hw.webp', '/art/ships/s3v.webp', '/art/ships/s3vw.webp', '/art/ships/s4h.webp', '/art/ships/s4hw.webp', '/art/ships/s4v.webp', '/art/ships/s4vw.webp', '/art/shield.webp', '/art/crest/em.webp', '/art/crest/tops.webp', '/art/gift.webp', '/art/popper.webp', '/art/stopwatch.webp', '/art/podium.webp', '/art/win.webp', '/art/lose.webp', '/art/draw.webp', '/art/clink.webp', '/art/tasks.webp', '/art/cup.webp', '/art/medal_common.webp', '/art/medal_rare.webp', '/art/medal_legendary.webp', '/art/medal_locked.webp', '/art/medal_secret.webp', '/art/buoy.webp', '/art/sea_buoy.webp', '/art/gull.webp', '/art/climb/boy.jpg', '/art/climb/girl.jpg', '/art/emo.webp', '/art/hourglass.webp', '/art/beans.webp', '/art/dove.webp', '/art/flag.webp', '/art/friends.webp', '/art/megaphone.webp', '/art/quiz.webp', '/art/shake.webp', '/art/bg_office.webp', '/art/bg_meeting.webp', '/art/bg_home.webp', '/art/bg_street.webp', '/art/bg_cafe.webp', '/fonts/onest.woff', '/fonts/unbounded.woff', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// API — всегда из сети; оболочка — сеть, при обрыве — кэш
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.endsWith('.mp4')) return; // видео браузер качает сам, кусками
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Этаж', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Этаж', {
    body: data.body || '', tag: data.tag, renotify: !!data.tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
