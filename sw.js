/**
 * sw.js : service worker. Rend le jeu utilisable hors ligne (campagne, ordinateur, éditeur) et installable.
 *  - installation : toute l'application (liste dans sw-assets.js, produite par tools/build-pwa.js) est mise en cache ;
 *  - le nom du cache contient l'empreinte des fichiers : modifier un fichier change le nom, donc renouvelle tout ;
 *  - fetch : cache d'abord pour l'application ; le réseau seul pour /ws, /api et /healthz (jamais mis en cache) ;
 *  - une navigation hors ligne retombe sur index.html.
 */
importScripts('sw-assets.js');
const CACHE = 'bidules-' + self.VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(self.ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('bidules-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/^\/(ws|api|healthz)/.test(url.pathname)) return;                    // réseau seul
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });          // ?salon=ABCD, ?debloquer : même page
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
        return Response.error();
      }
    })
  );
});
