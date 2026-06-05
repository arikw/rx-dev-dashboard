import type { ConnectorResult } from '../../types/project';
import type { ProjectsConfig } from '../../types/config';
import type { ConnectorFetchOpts, ConnectorOutput } from '../_define';
import { defineConnector } from '../_define';
import { loadFixture } from '../../lib/fixtures';
import { readJsonCache, writeJsonCache } from '../../lib/json-cache';
import { scrapeOne, type ExtposeApp } from './scrape';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CACHE_PATH = 'generated/.cache/extpose/data.json';

type ExtposeCache = { version: 1; _generated: string; apps: Record<string, ExtposeApp> };

const NOTE =
  'Auto-generated extpose.com cache. Fetched once per extension id; delete the file to refresh.';

const emptyCache = (): ExtposeCache => ({ version: 1, _generated: NOTE, apps: {} });

export const fetchExtposeProjects = async (
  config: ProjectsConfig,
  options?: ConnectorFetchOpts,
): Promise<ConnectorOutput> => {
  const extensionIds = config.sources.chrome.extensionIds;
  if (!extensionIds.length) return { projects: [] };

  if (options?.fixtureMode) return { projects: await loadFixture('extpose') };

  const cache = readJsonCache<ExtposeCache>(CACHE_PATH, emptyCache());
  if (cache.version !== 1 || !cache.apps) Object.assign(cache, emptyCache());
  cache._generated = NOTE;

  let attempted = 0;
  let failed = 0;
  for (const id of extensionIds) {
    if (cache.apps[id]) continue;
    attempted++;
    const app = await scrapeOne(id);
    if (app) cache.apps[id] = app;
    else failed++;
    await sleep(300);
  }
  writeJsonCache(CACHE_PATH, cache);

  const projects = extensionIds
    .map((id) => cache.apps[id])
    .filter((a): a is ExtposeApp => !!a)
    .map<ConnectorResult>((a) => ({
      origin: { platform: 'chrome', id: a.id },
      // Icon + banner are emitted as fallbacks: when chromestats and the
      // chrome connector also supply them, the reconciler keeps chromestats
      // first (same asOf, earlier scrape order), so the visible image is
      // unchanged. They only win when those two sources have nothing —
      // typically a delisted listing on a Cloudflare-blocked runner.
      mirror: {
        platform: 'extpose',
        id: a.id,
        url: a.url,
        asOf: a.lastUpdate,
        title: a.name,
        description: a.description,
        tags: ['chrome-extension'],
        kind: 'extension',
        icon: a.icon,
        banner: a.banner,
        stats: {
          // Match chromestats's behavior: drop the user count once the
          // listing is delisted — a stale snapshot isn't a current count.
          ...(!a.isDeleted && a.userCount != null ? { users: a.userCount } : {}),
          ...(a.rating
            ? { rating: { average: a.rating.value, count: a.rating.count } }
            : {}),
        },
      },
    }));

  const missing = extensionIds.filter((id) => !cache.apps[id]).length;
  if (projects.length === 0 && extensionIds.length > 0) {
    return {
      projects,
      ok: false,
      error: `no extension ids returned data (${failed}/${attempted} fresh scrapes failed)`,
    };
  }
  if (missing > 0) {
    return {
      projects,
      ok: 'partial',
      error: `${missing}/${extensionIds.length} extension ids missing (${failed}/${attempted} fresh scrapes failed)`,
    };
  }
  return { projects };
};

/** Manifest — picked up by `_registry.ts` via auto-discovery.
 *  extpose is a sibling MIRROR of chrome alongside chromestats. */
export default defineConnector({
  key: 'extpose',
  mirrorOf: 'chrome',
  emits: ['users', 'rating'],
  defaultConfig: { enabled: true },
  fetch: fetchExtposeProjects,
});
