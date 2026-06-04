import type { ConnectorResult } from '../../types/project';
import type { ProjectsConfig } from '../../types/config';
import type { ConnectorFetchOpts, ConnectorOutput } from '../_define';
import { defineConnector } from '../_define';
import { loadFixture } from '../../lib/fixtures';
import { readJsonCache, writeJsonCache } from '../../lib/json-cache';
import { scrapeOne, scrapeReviewsPage, type ChromeStatsApp } from './scrape';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CACHE_PATH = 'generated/.cache/chromestats/data.json';

type ChromeStatsCache = { version: 1; _generated: string; apps: Record<string, ChromeStatsApp> };

const NOTE =
  'Auto-generated chrome-stats.com cache. Fetched once per extension id; delete the file to refresh. PII (email, authorId) is intentionally omitted.';

const emptyCache = (): ChromeStatsCache => ({ version: 1, _generated: NOTE, apps: {} });

export const fetchChromestatsProjects = async (
  config: ProjectsConfig,
  options?: ConnectorFetchOpts,
): Promise<ConnectorOutput> => {
  // Shared list with the chrome connector — like AppBrain/APKPure share
  // sources.gplay.packages.
  const extensionIds = config.sources.chrome.extensionIds;
  if (!extensionIds.length) return { projects: [] };

  if (options?.fixtureMode) return { projects: await loadFixture('chromestats') };

  const cache = readJsonCache<ChromeStatsCache>(CACHE_PATH, emptyCache());
  if (cache.version !== 1 || !cache.apps) Object.assign(cache, emptyCache());
  cache._generated = NOTE;

  // Track fresh-fetch attempts vs failures so we can signal ok:false when
  // Cloudflare blocks every request — same pattern as the apkpure/appbrain
  // connectors. We only count scrapeOne failures here (not scrapeReviewsPage,
  // since an empty reviews page is ambiguous between "no reviews exist" and
  // "fetch failed", and we don't want false positives).
  let attempted = 0;
  let failed = 0;
  for (const id of extensionIds) {
    // Re-scrape if entry is absent OR is missing fields that were added later
    // (e.g. `logo`, which earlier scrapes didn't capture). The scraper is the
    // only place these come from — backfilling them from /reviews won't work.
    if (!cache.apps[id] || !cache.apps[id].logo) {
      attempted++;
      const app = await scrapeOne(id);
      if (app) cache.apps[id] = app;
      else failed++;
      await sleep(300);
    }
    // Backfill the rating histogram + reviews from the /reviews subpage when
    // missing (we always re-fetch when either is absent).
    const entry = cache.apps[id];
    if (entry && (!entry.ratingHistogram || !entry.reviews)) {
      const { histogram, reviews } = await scrapeReviewsPage(id);
      if (histogram) entry.ratingHistogram = histogram;
      if (reviews.length) entry.reviews = reviews;
      await sleep(300);
    }
  }
  writeJsonCache(CACHE_PATH, cache);

  const projects = extensionIds
    .map((id) => cache.apps[id])
    .filter((a): a is ChromeStatsApp => !!a)
    .map<ConnectorResult>((a) => ({
      // The origin is the Chrome Web Store extension — same `platform: 'chrome'`
      // as the chrome.ts connector, so when an extension exists on BOTH the
      // builder reconciles them per origin id. We deliberately omit `url`: for
      // taken-down extensions the CWS listing is dead, so the builder falls
      // through to the (alive) chrome-stats mirror url below. When chrome.ts
      // also contributes, it supplies the real CWS url and that wins.
      origin: { platform: 'chrome', id: a.id },
      mirror: {
        platform: 'chrome-stats',
        id: a.id,
        url: a.url,
        asOf: a.lastUpdate,
        title: a.name,
        description: a.description,
        firstReleased: a.creationDate ? new Date(a.creationDate).getUTCFullYear() : undefined,
        tags: [
          'chrome-extension',
          // chrome-stats categories look like "productivity/workflow" or
          // "14_fun"; strip the numeric prefix and take the leaf word.
          ...(a.category ? [a.category.replace(/^\d+_/, '').split('/').pop()!] : []),
        ],
        kind: 'extension',
        // chrome-stats supplies the real promo banners CWS displays at the top
        // of a listing — prefer the marquee (1400×560), fall back to small.
        banner: a.marqueeBanner ?? a.smallBanner,
        // Square 128×128 extension icon, captured even when CWS itself has
        // removed the listing — chrome.ts returns null for those, so this
        // mirror is the only icon source for deleted extensions.
        icon: a.logo,
        videos: a.videos,
        reviews: a.reviews,
        stats: {
          // Once an extension is removed from CWS, the cached userCount is a
          // stale snapshot, not a current count — and presenting it as
          // "weekly users" would be misleading. Rating stays (it's historical).
          ...(!a.isDeleted && a.userCount != null ? { users: a.userCount } : {}),
          ...(a.rating
            ? {
                rating: {
                  average: a.rating.value,
                  count: a.rating.count,
                  ...(a.ratingHistogram ? { histogram: a.ratingHistogram } : {}),
                },
              }
            : {}),
        },
      },
    }));

  // Coverage-based ok — see apkpure/index.ts for the rationale.
  const missing = extensionIds.filter((id) => !cache.apps[id]).length;
  if (projects.length === 0 && extensionIds.length > 0) {
    return {
      projects,
      ok: false,
      error: `chromestats: no extension ids returned data (${failed}/${attempted} fresh scrapes failed — likely Cloudflare block)`,
    };
  }
  if (missing > 0) {
    return {
      projects,
      ok: 'partial',
      error: `chromestats: ${missing}/${extensionIds.length} extension ids missing (${failed}/${attempted} fresh scrapes failed — likely Cloudflare block)`,
    };
  }
  return { projects };
};

/** Manifest — picked up by `_registry.ts` via auto-discovery.
 *  chromestats is a MIRROR of chrome — inherits label / brand from the origin. */
export default defineConnector({
  key: 'chromestats',
  mirrorOf: 'chrome',
  emits: ['users', 'rating'],
  // The mirror rep uses platform: 'chrome-stats' (the legacy hyphenated form).
  platformAliases: ['chrome-stats'],
  defaultConfig: { enabled: true },
  fetch: fetchChromestatsProjects,
});
