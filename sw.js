/***********************************************************
 *  Service Worker — ตารางนัด รพ.สวี
 *  Shell: network-first (ได้เวอร์ชันใหม่เสมอ, offline ใช้ cache)
 *  API  : ไม่ cache เด็ดขาด — ต้องเป็นข้อมูลสดเท่านั้น
 ***********************************************************/
const CACHE = 'sawee-appt-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ❌ ห้าม cache ข้อมูลจาก Apps Script
  if (url.hostname.indexOf('script.google') !== -1 ||
      url.hostname.indexOf('googleusercontent') !== -1) return;

  // ✅ ไฟล์ของแอป → network-first
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // ✅ ฟอนต์ภายนอก → cache-first
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => r))
  );
});
