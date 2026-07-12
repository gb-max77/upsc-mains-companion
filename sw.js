const CACHE = 'upsc-companion-v7';
const ASSETS = [
  './', 'index.html', 'css/style.css',
  'js/app.js', 'js/db.js', 'js/parser.js', 'js/extract.js', 'js/tts.js',
  'js/player.js', 'js/cards.js', 'js/quiz.js', 'js/practice.js', 'js/library.js',
  'js/ai.js', 'js/ui.js', 'js/diagrams.js',
  'libs/mammoth.browser.min.js', 'libs/pdf.min.mjs', 'libs/pdf.worker.min.mjs',
  'data/seed.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }))
  );
});
