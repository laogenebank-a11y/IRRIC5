/* IRRIC5 service worker: ໃຫ້ແອັບເປີດໄດ້ແມ້ບໍ່ມີອິນເຕີເນັດ */
const VERSION = 'irric5-v1.0.0';
const SHELL = [
  './',
  'css/style.css',
  'js/config.js',
  'js/i18n.js',
  'js/api.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ເຄືອຂ່າຍກ່ອນ (ໄດ້ເວີຊັນໃໝ່ສະເໝີ) ແຕ່ຖ້າຊ້າເກີນ 3.5 ວິ ຫຼື ຫຼຸດ ໃຫ້ໃຊ້ສຳເນົາໃນເຄື່ອງ
function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(req, { ignoreSearch: true })
      .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined));
    const timer = setTimeout(() => {
      fallback().then((hit) => { if (hit && !settled) { settled = true; resolve(hit); } });
    }, 3500);
    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res && res.ok && !res.redirected) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      if (settled) return;
      fallback().then((hit) => { settled = true; resolve(hit || Response.error()); });
    });
  });
}

// ຟອນຈາກ Google Fonts: ເກັບໄວ້ໃຊ້ຕອນ offline
function staleWhileRevalidate(req) {
  return caches.open(VERSION).then((cache) =>
    cache.match(req).then((hit) => {
      const net = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req));
  }
  // ອື່ນໆ (ລວມ script.google.com) ປ່ອຍໃຫ້ເບຣົາເຊີຈັດການເອງ
});
