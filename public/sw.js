// Service worker: cache aplikasi & halaman mushaf (bisa dibaca offline) + pengingat harian
const VERSI = 'tadarus-v5';
const SHELL = ['/', '/index.html', '/style.css?v=4', '/tajwid.js?v=4', '/app.js?v=4', '/manifest.json', '/icons/icon-192.png', '/quran/meta.json', '/fonts/scheherazade-new.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSI).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSI && k !== 'tadarus-auth' && k !== 'tadarus-quran-k4').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // API selalu online
  if (url.pathname.startsWith('/quran/')) {
    // halaman mushaf: cache-first
    e.respondWith(caches.open('tadarus-quran-k4').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // aplikasi: network-first, jatuh ke cache bila offline
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) caches.open(VERSI).then((c) => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});

// ---------- pengingat ----------
async function cekDanIngatkan() {
  const c = await caches.open('tadarus-auth');
  const r = await c.match('/__token');
  if (!r) return;
  const { token, terakhir } = await r.json();
  const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  if (terakhir === hariIni) return;
  try {
    const res = await fetch('/api/saya/status?riwayat=1', { headers: { authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const s = await res.json();
    if (!s.selesai_hari_ini) {
      await self.registration.showNotification('Waktunya Tadarus 📖', {
        body: s.notif?.teks || `Hari ini wajib membaca ${s.sisa_hari_ini} halaman.`,
        icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'tadarus-harian', data: { url: '/#/baca' },
      });
      await c.put('/__token', new Response(JSON.stringify({ token, terakhir: hariIni })));
    }
  } catch (e) {}
}
self.addEventListener('periodicsync', (e) => { if (e.tag === 'tadarus-pengingat') e.waitUntil(cekDanIngatkan()); });
self.addEventListener('message', (e) => { if (e.data === 'cek-pengingat') e.waitUntil(cekDanIngatkan()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
