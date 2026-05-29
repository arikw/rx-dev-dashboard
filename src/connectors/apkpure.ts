import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Connector } from './types';
import type { ConnectorResult } from '../types/project';
import { loadFixture } from '../lib/fixtures';
import { readJsonCache, writeJsonCache } from '../lib/json-cache';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);

const CACHE_PATH = 'generated/apkpure.json';

type ApkpureApp = {
  packageName: string;
  title: string;
  url: string;
  description?: string;
  image?: string;
  rating?: number;
  ratingCount?: number;
  /** APKPure's own mirror download count. */
  downloads?: number;
  year?: number;
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
  interactionStatistic?:
    | { userInteractionCount?: number }
    | Array<{ userInteractionCount?: number }>;
  datePublished?: string;
};

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
  let downloads: number | undefined;
  const stat = ld?.interactionStatistic;
  const count = Array.isArray(stat) ? stat[0]?.userInteractionCount : stat?.userInteractionCount;
  if (typeof count === 'number' && count > 0) downloads = count;
  const year = ld?.datePublished ? new Date(ld.datePublished).getUTCFullYear() : undefined;

  return {
    packageName: pkg,
    title,
    url: meta(doc, 'og:url') ?? url,
    description: description || undefined,
    image: meta(doc, 'og:image'),
    rating,
    ratingCount,
    downloads,
    year: Number.isFinite(year) ? year : undefined,
  };
}

export const fetchApkpureProjects: Connector = async (config, options) => {
  const packages = config.sources.gplay.packages;
  if (!packages.length) return [];

  if (options?.fixtureMode) return loadFixture('apkpure');

  const cache = readJsonCache<ApkpureCache>(CACHE_PATH, emptyCache());
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
    .filter((a): a is ApkpureApp => !!a)
    .map<ConnectorResult>((a) => ({
      // Identity of the Play resource APKPure describes.
      origin: { platform: 'google-play', id: a.packageName },
      // Replicated origin data (the Play rating APKPure shows).
      mirror: {
        platform: 'apkpure',
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
      // APKPure's own channel: its mirror download count + the image it hosts.
      // `downloads` here are APKPure's own (summed, not reconciled with Play).
      native: {
        platform: 'apkpure',
        url: a.url,
        firstReleased: a.year,
        image: a.image,
        stats: {
          ...(a.downloads != null ? { downloads: a.downloads } : {}),
        },
      },
    }));
};
