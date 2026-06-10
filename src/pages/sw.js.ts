import type { APIRoute } from 'astro';
import config from '../lib/load-config';

// Minimal service worker — its job is single-purpose: register a `fetch`
// handler so Android Chrome treats the site as a real PWA (WebAPK build,
// standalone-mode launch from the home screen) instead of dropping a
// plain bookmark shortcut.
//
// Caching strategy is split by request kind:
//
//   - Navigation requests (the HTML document) → NETWORK-FIRST. Launching
//     the PWA always tries the network and only falls back to the cached
//     HTML when offline. Without this, a stale-while-revalidate fetch
//     for HTML serves yesterday's dashboard on launch and requires a
//     manual refresh to pick up today's build — surprising for users
//     who associate "fresh page" with "open the app."
//   - Live data files (data.json, status.json) → NETWORK-FIRST too. The
//     diff-stats client reads these to render "what changed since last
//     visit." A stale copy turns the diff into a lie.
//   - Every other same-origin GET (CSS / JS bundles / images / SVG icons
//     / favicons / fonts) → STALE-WHILE-REVALIDATE. These are
//     content-hashed by Astro's build, so new HTML always references
//     filenames that aren't yet in the cache, and the SWR fetch then
//     populates them. Cached old hashed files become orphans, but
//     they're harmless — the CACHE name changes per build, so
//     `activate` purges the previous generation entirely.
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

  // Network-first paths: the HTML document and live data files.
  // \`req.mode === 'navigate'\` catches the top-level document fetch when
  // the PWA launches; the .json checks catch the diff-stats data files
  // that the client polls.
  const isNavigation = req.mode === 'navigate' || req.destination === 'document';
  const isLiveData = url.pathname.endsWith('/data.json') || url.pathname.endsWith('/status.json');

  if (isNavigation || isLiveData) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok && res.status === 200 && res.type === 'basic') {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response('Offline and no cached copy available.', { status: 503 });
      }
    })());
    return;
  }

  // Stale-while-revalidate for everything else (CSS / JS / images /
  // fonts) — these are content-hashed by Astro's build pipeline, so
  // serving a cached copy then refreshing in the background is the
  // right speed/freshness tradeoff for them.
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
