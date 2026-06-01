import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Connector } from '../types';
import type { ConnectorResult, Review } from '../../types/project';
import { defineConnector } from '../_define';
import { loadFixture } from '../../lib/fixtures';
import { readJsonCache, writeJsonCache } from '../../lib/json-cache';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);

const CACHE_PATH = 'generated/.cache/appbrain/data.json';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0';

type AppbrainApp = {
  packageName: string;
  title: string;
  url: string;
  description?: string;
  rating?: number;
  ratingCount?: number;
  /** Raw per-star counts [1★,2★,3★,4★,5★]. */
  ratingHistogram?: number[];
  /** Google Play install-tier floor (e.g. "10,000+" → 10000). */
  installs?: number;
  /** First year on Google Play (from firstSeenS). */
  year?: number;
  /** App icon URL (Google-hosted). */
  iconUrl?: string;
  /** Positive review snippets surfaced by AppBrain's `commentInsights`. */
  positiveQuotes?: string[];
};

type AppbrainCache = { version: 1; _generated: string; apps: Record<string, AppbrainApp> };

const NOTE =
  'Auto-generated AppBrain cache (GetIntelligenceDataRequest + Play tier). Frozen removed apps — fetched once.';

const emptyCache = (): AppbrainCache => ({ version: 1, _generated: NOTE, apps: {} });

// AppBrain is behind Cloudflare, which blocks Node's fetch (undici) regardless
// of headers; curl's TLS handshake passes, so we shell out. Fetch-once cache,
// so curl is only needed the first time per package.
async function curlRun(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('curl', args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout || null;
  } catch {
    return null;
  }
}

/** Defense-in-depth: never let a stray email through into stored data. */
function scrubEmails(s: string): string {
  return s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '').trim();
}

/** Google Play install tier, e.g. "10,000+" → 10000 (the honest floor). */
function parseInstalls(bucket: unknown): number | undefined {
  if (typeof bucket !== 'string') return undefined;
  const n = parseInt(bucket.replace(/[,+\s]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

// Primary source: the JSON-RPC intelligence endpoint. Whitelist only the safe
// public fields below — the response also carries officialWebsite and comment
// quotes we deliberately ignore (and notably it has NO developer email).
type Intel = {
  title: string;
  rating?: number;
  ratingCount?: number;
  histogram?: number[];
  description?: string;
  year?: number;
  iconUrl?: string;
  positiveQuotes?: string[];
};

async function fetchIntel(pkg: string): Promise<Intel | null> {
  const out = await curlRun([
    '-s',
    '--max-time',
    '25',
    '-X',
    'POST',
    '-H',
    'content-type: application/json',
    '-H',
    'origin: https://www.appbrain.com',
    '-H',
    `referer: https://www.appbrain.com/app/${pkg}`,
    '-A',
    UA,
    '--data-raw',
    JSON.stringify({ packageName: pkg }),
    'https://www.appbrain.com/jsonrpc/GetIntelligenceDataRequest',
  ]);
  if (!out) return null;
  try {
    const d = JSON.parse(out) as Record<string, unknown>;
    if (!d.packageName) return null;
    const histogram = [1, 2, 3, 4, 5].map((i) => Number(d[`ratings${i}`]) || 0);
    const fsRaw = Number(d.firstSeenS);
    const year = Number.isFinite(fsRaw) && fsRaw > 0 ? new Date(fsRaw * 1000).getUTCFullYear() : undefined;
    const ci = d.commentInsights as { positiveQuotes?: unknown } | undefined;
    const rawQuotes = Array.isArray(ci?.positiveQuotes) ? (ci!.positiveQuotes as unknown[]) : [];
    const positiveQuotes = rawQuotes
      .map((q) => (typeof q === 'string' ? scrubEmails(q) : ''))
      .filter((q) => q.length > 0);
    return {
      title: typeof d.name === 'string' && d.name ? d.name : pkg,
      rating: typeof d.rating === 'number' ? Math.round(d.rating * 100) / 100 : undefined,
      ratingCount: typeof d.ratingCount === 'number' ? d.ratingCount : undefined,
      histogram: histogram.some((n) => n > 0) ? histogram : undefined,
      description:
        typeof d.shortDescription === 'string' ? scrubEmails(d.shortDescription) || undefined : undefined,
      year,
      iconUrl: typeof d.iconUrl === 'string' ? d.iconUrl : undefined,
      positiveQuotes: positiveQuotes.length ? positiveQuotes : undefined,
    };
  } catch {
    return null;
  }
}

/** The official Google Play install tier lives only on the HTML page. Read just
 * the `downloads` field — never the rest of appData (it embeds an email). */
async function fetchPlayInstalls(pkg: string): Promise<number | undefined> {
  const doc = await curlRun([
    '-sL',
    '--max-time',
    '25',
    '-A',
    UA,
    '-H',
    'Accept-Language: en-US,en;q=0.9',
    `https://www.appbrain.com/app/${encodeURIComponent(pkg)}`,
  ]);
  if (!doc) return undefined;
  const blob = doc.match(/"APP_PAGE_DATA"\s*:\s*(\{.*?\})\};window\.pageDataProto/s);
  if (!blob) return undefined;
  try {
    const appData = (JSON.parse(blob[1]) as { appData?: { downloads?: unknown } }).appData;
    return parseInstalls(appData?.downloads);
  } catch {
    return undefined;
  }
}

async function scrapeApp(pkg: string): Promise<AppbrainApp | null> {
  const intel = await fetchIntel(pkg);
  if (!intel) return null; // the endpoint is the source of truth
  const installs = await fetchPlayInstalls(pkg);
  return {
    packageName: pkg,
    title: intel.title,
    url: `https://www.appbrain.com/app/${encodeURIComponent(pkg)}`,
    description: intel.description,
    rating: intel.rating,
    ratingCount: intel.ratingCount,
    ratingHistogram: intel.histogram,
    installs,
    year: intel.year,
    iconUrl: intel.iconUrl,
    positiveQuotes: intel.positiveQuotes,
  };
}

export const fetchAppbrainProjects: Connector = async (config, options) => {
  const packages = config.sources.gplay.packages;
  if (!packages.length) return [];

  if (options?.fixtureMode) return loadFixture('appbrain');

  const cache = readJsonCache<AppbrainCache>(CACHE_PATH, emptyCache());
  if (cache.version !== 1 || !cache.apps) Object.assign(cache, emptyCache());
  cache._generated = NOTE;

  for (const pkg of packages) {
    if (cache.apps[pkg]) continue; // frozen — removed-app stats never change
    const app = await scrapeApp(pkg);
    if (app) cache.apps[pkg] = app;
    await sleep(300);
  }
  writeJsonCache(CACHE_PATH, cache);

  return packages
    .map((p) => cache.apps[p])
    .filter((a): a is AppbrainApp => !!a)
    .map<ConnectorResult>((a) => ({
      // AppBrain isn't the origin — it points at the Google Play resource
      // (identity only; the Play listing is dead for removed apps, so the live
      // link lives on the mirror).
      origin: { platform: 'google-play', id: a.packageName },
      // AppBrain's replicated copy of the Play data. installs is the "10,000+"
      // tier (a floor); a manual origin (Play Console) outranks it in reconcile.
      mirror: {
        platform: 'appbrain',
        id: a.packageName,
        url: a.url,
        title: a.title,
        description: a.description ?? '',
        firstReleased: a.year,
        tags: ['android'],
        kind: 'mobile',
        // AppBrain's iconUrl is the Google-hosted square app icon.
        icon: a.iconUrl,
        reviews: a.positiveQuotes?.map<Review>((q) => ({ body: q, source: 'appbrain' })),
        stats: {
          ...(a.installs != null ? { installs: { value: a.installs, exact: false } } : {}),
          ...(a.rating != null && a.ratingCount != null
            ? { rating: { average: a.rating, count: a.ratingCount, histogram: a.ratingHistogram } }
            : {}),
        },
      },
    }));
};

/** Manifest — picked up by `_registry.ts` via auto-discovery.
 *  appbrain is a MIRROR of playstore (the Android origin). Inherits the
 *  "Android app" label + the "android" source-group via mirrorOf chain. */
export default defineConnector({
  key: 'appbrain',
  mirrorOf: 'playstore',
  defaultConfig: { enabled: true },
  fetch: async (config, opts) => {
    const projects = await fetchAppbrainProjects(config, opts);
    return { projects };
  },
});
