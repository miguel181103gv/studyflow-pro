import { NextResponse } from 'next/server';

const SW_CODE = `
const CACHE_NAME = 'studyflow-pwa-v1';
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon-studyflow.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca intercepta chamadas externas (Supabase, APIs) nem rotas /api/ ou /auth/
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Assets estáticos do Next.js e imagens: Cache-First com atualização em segundo plano
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Navegação de páginas e RSC: Network-First com fallback para cache offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && (req.mode === 'navigate' || url.pathname.startsWith('/p/') || url.pathname === '/')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const fallback = (await caches.match(url.pathname)) || (await caches.match('/'));
          if (fallback) return fallback;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
`;

export function GET() {
  return new NextResponse(SW_CODE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
