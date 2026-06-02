import type { APIRoute } from 'astro';
import config from '../lib/load-config';

// Minimal service worker — its job is single-purpose: register a `fetch`
// handler so Android Chrome treats the site as a real PWA (WebAPK build,
// standalone-mode launch from the home screen) instead of dropping a
// plain bookmark shortcut.
//
// Caching strategy is stale-while-revalidate for every same-origin GET:
// serve the cached copy immediately, fetch a fresh one in the background,
// and overwrite the cache entry. New builds get a new CACHE name so old
// entries are purged on activate.
//
// Skipped entirely when `config.meta.serviceWorker === false`. The
// registration script in BaseHead also bails in dev to avoid HMR conflicts.
export const GET: APIRoute = () => {
  if (config.meta.serviceWorker === false) {
    return new Response('// service worker disabled via config.meta.serviceWorker = false\n', {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }

  const base = config.deployment.base.endsWith('/')
    ? config.deployment.base
    : `${config.deployment.base}/`;
  // Build-time timestamp baked into the SW. On a new build, the CACHE
  // name changes → old caches are dropped on activate.
  const version = String(Date.now());

  const body = `// Generated at build time by src/pages/sw.js.ts.
const CACHE = 'rxdash-${version}';
const SCOPE = ${JSON.stringify(base)};

self.addEventListener('install', (event) => {
  // Activate immediately; no app-shell precaching — the SWR fetch handler
  // populates the cache on demand, which keeps the install hook fast and
  // avoids failing the install when a single shell URL is unreachable.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin requests within scope.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;
  // Don't cache the manifest — it's tiny and changes when colours / icons
  // do, so always go to network.
  if (url.pathname.endsWith('/manifest.webmanifest')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      // Browsers enforce that an SW can only control URLs at or below the
      // path of the script. Hosting the SW from the deployment base via
      // this endpoint matches Astro's routing, so no `Service-Worker-Allowed`
      // override is needed.
    },
  });
};
