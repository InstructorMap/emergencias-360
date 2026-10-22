/* ============================================================
   sw.js — Service Worker MVP (política estricta)
   - SOLO cachea el shell estático (whitelist ASSETS).
   - NUNCA cachea estados SOS ni llamadas dinámicas (Supabase futuro).
   - Navegación: network-first con fallback a index.html cacheado.
   - Fallback final: página de contingencia telefónica (107/911).
   ============================================================ */

const CACHE_NAME = 'e360-mvp-shell-v2';

// WHITELIST explícita: solo el shell estático. Nada más.
const ASSETS = [
  './',
  './index.html',
  './central.html',
  './b2b.html',
  './admin.html',
  './css/styles.css',
  './js/config.js',
  './js/state-machine.js',
  './js/store.js',
  './js/app-socio.js',
  './js/app-central.js',
  './js/app-b2b.js',
  './js/app-admin.js',
  './manifest.json'
];

// Orígenes externos que NUNCA deben pasar por cache (Supabase futuro, etc.)
const BYPASS_ORIGINS = [
  // Cuando se conecte Supabase, agregar acá el host:
  // 'https://<project>.supabase.co'
];

function isShellAsset(url) {
  return ASSETS.some(asset => {
    const clean = asset.replace('./', '/');
    return url.pathname === clean || url.pathname === clean.replace(/\/$/, '/index.html');
  });
}

function shouldBypass(url) {
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname.includes('/rest/v1/')) return true;
  if (url.pathname.includes('/realtime/v1/')) return true;
  if (url.pathname.includes('/auth/v1/')) return true;
  return BYPASS_ORIGINS.some(origin => url.href.startsWith(origin));
}

// ---------- INSTALL ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ---------- ACTIVATE ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- FETCH ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // 1) Bypass absoluto: nada dinámico se cachea
  if (shouldBypass(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // 2) Navegación: network-first con fallback a index.html cacheado
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then((res) => res || offlineFallback())
      )
    );
    return;
  }

  // 3) Shell estático: cache-first (solo si matchea whitelist)
  if (isShellAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (!res || res.status !== 200 || res.type !== 'basic') return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        }).catch(() => offlineFallback());
      })
    );
    return;
  }

  // 4) Cualquier otro GET: network-only (no se cachea)
  event.respondWith(fetch(req));
});

// ---------- OFFLINE FALLBACK ----------
function offlineFallback() {
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Emergencias 360 — Sin conexión</title>
<style>
  html,body{margin:0;padding:0;box-sizing:border-box}
  body{background:#0f172a;color:#f1f5f9;font-family:system-ui,sans-serif;
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       min-height:100vh;padding:24px;text-align:center;gap:16px}
  h1{font-size:1.3rem;color:#f59e0b;margin:0}
  a{display:block;width:100%;max-width:320px;padding:16px;border-radius:12px;
    text-decoration:none;font-weight:700;color:#fff;font-size:1rem}
  .c107{background:#dc2626}.c911{background:#1d4ed8}
  p{font-size:.85rem;color:#cbd5e1;max-width:360px;margin:0}
</style></head><body>
  <h1>Sin conexión</h1>
  <p>No pudimos cargar la app. Ante una urgencia real, llamá directamente:</p>
  <a class="c107" href="tel:107">📞 107 (SAME)</a>
  <a class="c911" href="tel:911">📞 911 (Policía)</a>
  <p>Bomberos: 100 — Esta app no sustituye a los servicios públicos de emergencia.</p>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
