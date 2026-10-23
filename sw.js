/* ============================================================
   sw.js — Service Worker MVP v5
   Identidad EMP + Sello ASARI.
   - Shell estático en whitelist explícita
   - NUNCA cachea estados SOS ni llamadas dinámicas
   - Fallback contingencia telefónica 107/911/100
   ============================================================ */

const CACHE_NAME = 'e360-mvp-v5';

const ASSETS = [
  './',
  './index.html',
  './central.html',
  './guardia.html',
  './b2b.html',
  './admin.html',
  './css/styles.css',
  './js/config.js',
  './js/state-machine.js',
  './js/store.js',
  './js/app-socio.js',
  './js/app-central.js',
  './js/app-guardia.js',
  './js/app-b2b.js',
  './js/app-admin.js',
  './manifest.json'
];

const BYPASS_ORIGINS = [
  // Agregar acá el host de Supabase cuando se conecte:
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  if (shouldBypass(url)) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then((res) => res || offlineFallback())
      )
    );
    return;
  }

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

  event.respondWith(fetch(req));
});

function offlineFallback() {
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#3D5CA4">
<title>Emergencias 360 — Sin conexión</title>
<style>
  html,body{margin:0;padding:0;box-sizing:border-box}
  body{background:#F8FAFC;color:#0F172A;
       font-family:'Poppins',system-ui,sans-serif;
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       min-height:100vh;padding:24px;text-align:center;gap:16px}
  h1{font-size:1.3rem;color:#3D5CA4;margin:0;font-family:'Montserrat',sans-serif}
  h1 span{color:#FB0100}
  a{display:block;width:100%;max-width:320px;padding:16px;border-radius:12px;
    text-decoration:none;font-weight:700;color:#fff;font-size:1rem}
  .c107{background:#FB0100}.c911{background:#0B3C78}.c100{background:#740821}
  p{font-size:.85rem;color:#4A5568;max-width:360px;margin:0}
  .brand{font-family:'Montserrat',sans-serif;font-weight:900;font-size:1.1rem;letter-spacing:.08em;color:#3D5CA4}
  .legal{font-size:.68rem;color:#64748B;margin-top:8px}
</style></head><body>
  <div class="brand">EMP <span style="color:#FB0100">—</span> EMERGENCIAS MÉDICAS PRIVADAS</div>
  <h1>Sin conexión</h1>
  <p>No pudimos cargar la app. Ante una urgencia real, llamá directamente:</p>
  <a class="c107" href="tel:107">📞 107 (SAME)</a>
  <a class="c911" href="tel:911">📞 911 (Policía)</a>
  <a class="c100" href="tel:100">📞 100 (Bomberos)</a>
  <p class="legal">Tecnología provista por ASARI S.A.S. — Proveedor Tecnológico. EMP - Emergencias Médicas Privadas es Prestador Operativo en Dolores y Partido de La Costa. Esta app NO sustituye al 107 / 911 / Bomberos.</p>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
