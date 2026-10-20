// sw.js - NovelTrad Progressive Web App Service Worker (v10)
// Stratégie hybride Stale-While-Revalidate & Network-First avec support Hors-ligne complet

const CACHE_NAME = 'noveltrad-pwa-v26';
const RUNTIME_CACHE = 'noveltrad-runtime-v26';

// Fichiers vitaux de l'App Shell
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/series.html',
  '/404.html',
  '/manifest.json',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-512x512.png',
  '/css/style.css',
  '/js/api-client.js',
  '/js/library_db.js',
  '/js/sync_engine.js',
  '/js/library_logic.js',
  '/js/catalog_logic.js',
  '/js/editorial_logic.js',
  '/js/series_logic.js',
  '/js/home_showcase_logic.js',
  '/js/pwa_manager.js',
  '/js/app.js',
  '/js/reader_audio.js',
  '/js/inline_comments.js',
  '/js/pdf_reader.js',
  '/js/webnovel_reader.js',
  '/js/supabase_auth.js',
  '/js/epub.min.js',
  '/js/jszip.min.js'
];

// INSTALLATION : Mise en cache sécurisée de l'App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Utilisation d'un ajout résilient (ne bloque pas si un asset optionnel échoue)
      const cachePromises = APP_SHELL_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok) {
            await cache.put(url, res);
          }
        } catch (err) {
          console.warn('[SW] Pré-cache ignoré pour:', url, err.message);
        }
      });
      return Promise.allSettled(cachePromises);
    })
  );
  self.skipWaiting();
});

// ACTIVATION : Purge des anciens caches et prise de contrôle immédiate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// INTERCEPTION DES REQUÊTES (FETCH)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // 1. WebSocket et flux de téléchargement d'upload lourds
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/api/translate/stream')) {
    return;
  }

  // 2. Navigation (pages HTML) : Stratégie Network-First avec fallback cache
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            if (url.pathname.includes('series.html')) {
              return caches.match('/series.html');
            }
            return caches.match('/index.html');
          });
        })
    );
    return;
  }

  // 3. APIs en lecture (Catalogue, Séries, Calendrier) : Network-First avec cache fallback hors-ligne
  if (
    url.pathname.startsWith('/api/catalog') ||
    url.pathname.startsWith('/api/series') ||
    url.pathname.startsWith('/api/editorial')
  ) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const clone = networkRes.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => {
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            return new Response(JSON.stringify({ offline: true, message: 'Données non disponibles hors-ligne' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // Ignorer les autres requêtes API non-GET ou externes
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 4. Assets statiques (CSS, JS, SVG, Images, Polices) : Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200 && (networkRes.type === 'basic' || networkRes.type === 'cors')) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() => {
          // Erreur réseau silencieuse pour les assets secondaires
        });

      return cached || fetchPromise;
    })
  );
});

// Écoute des messages pour rafraîchir le cache ou forcer l'activation
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
