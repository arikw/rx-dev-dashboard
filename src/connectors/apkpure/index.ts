import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Connector } from '../types';
import type { ConnectorResult } from '../../types/project';
import { defineConnector } from '../_define';
import { loadFixture } from '../../lib/fixtures';
import { readJsonCache, writeJsonCache } from '../../lib/json-cache';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);

const CACHE_PATH = 'generated/.cache/apkpure/data.json';

type ApkpureApp = {
  packageName: string;
  title: string;
  url: string;
  description?: string;
  /** Square app icon (og:image). */
  icon?: string;
  rating?: number;
  ratingCount?: number;
  year?: number;
  /** Phone screenshots APKPure hosts (ld+json `screenshot[]`). */
  screenshots?: string[];
  /** YouTube trailer URLs the listing embeds (`<iframe src="…/embed/<id>">`). */
  videos?: string[];
};

type ApkpureCache = { version: 1; _generated: string; apps: Record<string, ApkpureApp> };

const NOTE =
  'Auto-generated APKPure cache. Removed apps have frozen stats — fetched once, never refetched.';

const emptyCache = (): ApkpureCache => ({ version: 1, _generated: NOTE, apps: {} });

// Like AppBrain, APKPure is behind Cloudflare and blocks Node's fetch; curl
// gets through. Fetch-once cache, so curl is only needed the first time.
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const { stdout } = await run(
      'curl',
      [
        '-sL',
        '--max-time',
        '25',
        '-A',
        'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
        '-H',
        'Accept-Language: en-US,en;q=0.9',
        url,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout || null;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

/** Defense-in-depth: these pages embed a support email — never let one through. */
function scrubEmails(s: string): string {
  return s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '').trim();
}

function meta(doc: string, prop: string): string | undefined {
  const m = doc.match(new RegExp(`property="${prop}"[^>]+content="([^"]+)"`, 'i'));
  return m ? m[1] : undefined;
}

type LdApp = {
  '@type'?: string;
  aggregateRating?: { ratingValue?: string | number; ratingCount?: string | number };
  datePublished?: string;
  screenshot?: Array<{ url?: string } | string> | { url?: string } | string;
};

/** APKPure's ld+json `screenshot[]` URLs ship with `?h=200` baked in — that
 *  serves the 120×200 thumbnail variant. The same record at the same path
 *  with no height param returns the full-resolution 480×800 image. Strip
 *  any `h=NNN` parameter (preserving the rest of the query string) so the
 *  media cache fetches the natural-size image. */
function stripHeightParam(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('h');
    return u.toString();
  } catch {
    return url;
  }
}

function extractScreenshots(ld: LdApp | null): string[] {
  const ss = ld?.screenshot;
  if (!ss) return [];
  const list = Array.isArray(ss) ? ss : [ss];
  return list
    .map((s) => (typeof s === 'string' ? s : s?.url))
    .filter((u): u is string => !!u)
    .map(stripHeightParam);
}

/** Pull YouTube embed URLs from the listing's trailer placeholder. APKPure
 *  lazy-loads the iframe — the YouTube URL ships in `data-src="…"` (not
 *  `src=`); the real iframe gets created in the browser after a click /
 *  scroll. Match either attribute. Decode `&amp;` → `&` and deduplicate. */
function extractVideos(doc: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:data-)?src=["']([^"']*youtube(?:-nocookie)?\.com\/embed\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) out.add(m[1].replace(/&amp;/g, '&'));
  return [...out];
}

function findAppLd(doc: string): LdApp | null {
  const blocks = doc.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (!blocks) return null;
  for (const block of blocks) {
    const inner = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      const data = JSON.parse(inner);
      for (const node of Array.isArray(data) ? data : [data]) {
        const t = node?.['@type'];
        if (t === 'MobileApplication' || t === 'SoftwareApplication') return node as LdApp;
      }
    } catch {
      // skip non-JSON blocks
    }
  }
  return null;
}

// IMPORTANT — anonymity: take only the whitelisted public fields below. The
// full description / developer block embeds a support email; we use og:* +
// ld+json and scrub emails defensively. Do not capture the long description.
async function scrapeApp(pkg: string): Promise<ApkpureApp | null> {
  const url = `https://apkpure.com/p/${encodeURIComponent(pkg)}`;
  const doc = await fetchHtml(url);
  if (!doc) return null;

  const ogTitle = meta(doc, 'og:title');
  if (!ogTitle) return null;
  const title = decodeEntities(ogTitle).replace(/\s+APK\s+for\s+Android.*$/i, '').trim();

  const ogDesc = meta(doc, 'og:description');
  const description = ogDesc
    ? scrubEmails(decodeEntities(ogDesc).replace(/^.*?APK download for Android\.\s*/i, ''))
    : undefined;

  const ld = findAppLd(doc);
  let rating: number | undefined;
  let ratingCount: number | undefined;
  if (ld?.aggregateRating) {
    const r = parseFloat(String(ld.aggregateRating.ratingValue));
    const c = parseInt(String(ld.aggregateRating.ratingCount), 10);
    if (Number.isFinite(r) && r > 0) rating = Math.round(r * 100) / 100;
    if (Number.isFinite(c) && c > 0) ratingCount = c;
  }
  const year = ld?.datePublished ? new Date(ld.datePublished).getUTCFullYear() : undefined;

  const screenshots = extractScreenshots(ld);
  const videos = extractVideos(doc);
  return {
    packageName: pkg,
    title,
    url: meta(doc, 'og:url') ?? url,
    description: description || undefined,
    // og:image is the square app icon, distinct from the phone screenshots.
    icon: meta(doc, 'og:image'),
    rating,
    ratingCount,
    year: Number.isFinite(year) ? year : undefined,
    screenshots: screenshots.length ? screenshots : undefined,
    videos: videos.length ? videos : undefined,
  };
}

export const fetchApkpureProjects: Connector = async (config, options) => {
  const packages = config.sources.gplay.packages;
  if (!packages.length) return [];

  if (options?.fixtureMode) return loadFixture('apkpure');

  const cache = readJsonCache<ApkpureCache>(CACHE_PATH, emptyCache());
  if (cache.version !== 1 || !cache.apps) Object.assign(cache, emptyCache());
  cache._generated = NOTE;

  // One-time migration: earlier scrapes stored the ld+json `?h=200`
  // thumbnail URLs verbatim. Strip the height param from every cached
  // entry so the next build's cacheMedia refetches full-res via new URLs.
  // Idempotent once cleaned — already-stripped URLs survive untouched.
  for (const app of Object.values(cache.apps)) {
    if (app.screenshots && app.screenshots.length > 0) {
      app.screenshots = app.screenshots.map(stripHeightParam);
    }
  }

  for (const pkg of packages) {
    if (cache.apps[pkg]) continue; // frozen — removed-app stats never change
    const app = await scrapeApp(pkg);
    if (app) cache.apps[pkg] = app;
    await sleep(300);
  }
  writeJsonCache(CACHE_PATH, cache);

  return packages
    .map((p) => cache.apps[p])
    .filter((a): a is ApkpureApp => !!a)
    .map<ConnectorResult>((a) => ({
      // Identity of the Play resource APKPure describes.
      origin: { platform: 'google-play', id: a.packageName },
      // Replicated origin data (the Play rating APKPure shows).
      mirror: {
        platform: 'apkpure',
        id: a.packageName,
        url: a.url,
        title: a.title,
        description: a.description ?? '',
        tags: ['android'],
        kind: 'mobile',
        stats: {
          ...(a.rating != null && a.ratingCount != null
            ? { rating: { average: a.rating, count: a.ratingCount } }
            : {}),
        },
      },
      // APKPure's own channel: the icon and screenshots it hosts. Its own
      // download counter measures a different population (APK pulls from a
      // third-party mirror, not Play installs) and is intentionally omitted so
      // it doesn't get summed alongside Google Play installs on the card.
      native: {
        platform: 'apkpure',
        id: a.packageName,
        url: a.url,
        firstReleased: a.year,
        icon: a.icon,
        screenshots: a.screenshots,
        videos: a.videos,
      },
    }));
};

/** Manifest — picked up by `_registry.ts` via auto-discovery.
 *  apkpure is a MIRROR of playstore (the Android origin). Inherits the
 *  "Android app" label + the "android" source-group via mirrorOf chain. */
export default defineConnector({
  key: 'apkpure',
  mirrorOf: 'playstore',
  defaultConfig: { enabled: true },
  fetch: async (config, opts) => {
    const projects = await fetchApkpureProjects(config, opts);
    return { projects };
  },
});
