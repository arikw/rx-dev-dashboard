import type { Connector } from './types';
import type { Project } from '../types/project';
import { loadFixture, isPlaceholderHandle } from '../lib/fixtures';
import {
  readNpmCache,
  writeNpmCache,
  sumAllTime,
  REFETCH,
  type NpmDownloadsCache,
  type PackageDownloads,
} from '../lib/npm-downloads-cache';

type NpmLinks = { npm: string; homepage?: string; repository?: string };

type NpmSearchResult = {
  objects: Array<{
    package: {
      name: string;
      description?: string;
      keywords?: string[];
      date: string;
      links: NpmLinks;
    };
  }>;
};

const UA = { 'User-Agent': 'rx-dev-dashboard' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class NotFoundError extends Error {}

// A couple of quick retries only — this runs in a cron, so we never stall long
// on a rate limit. If it keeps failing, we give up and let the next run retry
// (the cache is eventually-correct).
async function fetchJson<T>(url: string, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404) throw new NotFoundError(`404 ${url}`);
      // Rate limited / server error — short capped back-off, then retry.
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      const wait = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 300 * 2 ** i, 2000);
      lastErr = new Error(`${res.status} ${url}`);
      await sleep(wait);
      continue;
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      lastErr = err;
      await sleep(Math.min(300 * 2 ** i, 2000));
    }
  }
  throw lastErr;
}

/** Run `fn` over items with bounded concurrency, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchPackagesByMaintainer(user: string): Promise<NpmSearchResult['objects']> {
  const all: NpmSearchResult['objects'] = [];
  for (let from = 0; from < 1000; from += 250) {
    const url = `https://registry.npmjs.org/-/v1/search?text=maintainer:${encodeURIComponent(user)}&size=250&from=${from}`;
    const data = await fetchJson<NpmSearchResult>(url);
    if (!data.objects?.length) break;
    all.push(...data.objects);
    if (data.objects.length < 250) break;
  }
  return all;
}

// Returns null on fetch failure (e.g. rate-limit) so a transient error is never
// recorded as a genuine 0 — the caller omits the stat instead of showing a lie.
async function fetchPointDownloads(pkg: string, period: string): Promise<number | null> {
  try {
    const data = await fetchJson<{ downloads?: number }>(
      `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(pkg)}`,
    );
    return data.downloads ?? null;
  } catch {
    return null;
  }
}

/**
 * Sum one calendar year's daily downloads via the range endpoint.
 * Throws on request failure — callers must NOT cache a failure as 0, or a
 * transient rate-limit would silently corrupt the all-time total.
 */
async function fetchYearDownloads(pkg: string, year: number, created: Date, now: Date): Promise<number> {
  const start = new Date(Date.UTC(year, 0, 1));
  const from = start < created ? created : start;
  const end = new Date(Date.UTC(year, 11, 31));
  const to = end > now ? now : end;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const data = await fetchJson<{ downloads?: Array<{ downloads: number }> }>(
    `https://api.npmjs.org/downloads/range/${fmt(from)}:${fmt(to)}/${encodeURIComponent(pkg)}`,
  );
  return (data.downloads ?? []).reduce((sum, d) => sum + d.downloads, 0);
}

/** Fetch first-publish date from registry metadata. */
async function fetchCreated(pkg: string): Promise<string | null> {
  try {
    const data = await fetchJson<{ time?: { created?: string } }>(
      `https://registry.npmjs.org/${encodeURIComponent(pkg)}`,
    );
    return data.time?.created ?? null;
  } catch {
    return null;
  }
}

/** Ensure the cache has accurate per-year data for a package; returns it. */
async function refreshPackage(
  cache: NpmDownloadsCache,
  pkg: string,
  fallbackDate: string,
  now: Date,
): Promise<PackageDownloads> {
  let entry = cache.packages[pkg];
  if (!entry) {
    const created = (await fetchCreated(pkg)) ?? fallbackDate;
    entry = { created, years: {} };
    cache.packages[pkg] = entry;
  }

  const firstYear = new Date(entry.created).getUTCFullYear();
  const created = new Date(entry.created);
  const thisYear = now.getUTCFullYear();

  for (let y = firstYear; y <= thisYear; y++) {
    const cached = entry.years[String(y)];
    const mustRefresh = y >= thisYear - 1; // current + just-ended year are never frozen
    if (!mustRefresh && cached !== undefined && cached >= 0) continue; // frozen, complete
    try {
      entry.years[String(y)] = await fetchYearDownloads(pkg, y, created, now);
    } catch (err) {
      // Don't clobber a value we already have (e.g. a just-ended year we've
      // mostly captured) — only flag -1 when we have nothing for this year.
      if (!(cached !== undefined && cached >= 0)) entry.years[String(y)] = REFETCH;
      console.warn(
        `[npm] ${pkg} ${y} downloads fetch failed, will retry next run:`,
        err instanceof Error ? err.message : err,
      );
    }
    await sleep(100); // gentle gap between calls; cheap, keeps the cron quick
  }
  return entry;
}

export const fetchNpmProjects: Connector = async (config, options) => {
  const handle = config.user.npm;
  if (isPlaceholderHandle(handle)) return [];

  if (options?.fixtureMode) return loadFixture('npm');

  const cfg = config.sources.npm;
  const explicit = new Set(cfg.packages);
  const matches = await fetchPackagesByMaintainer(handle);
  const picked = explicit.size > 0 ? matches.filter((m) => explicit.has(m.package.name)) : matches;

  const cache = readNpmCache();
  const now = new Date();

  // Single gentle stream (with a small gap between calls) trips npm's rate
  // limiter far less than a parallel burst — and without backoff stalls it's
  // actually faster. Anything that still fails just refetches next cron run.
  const enriched = await mapLimit(picked, 1, async (m) => {
    const name = m.package.name;
    const fetched = await fetchPointDownloads(name, 'last-month');
    const dl = await refreshPackage(cache, name, m.package.date, now);
    if (fetched != null) dl.lastMonth = fetched; // persist last-good monthly
    const monthly = fetched ?? dl.lastMonth ?? null; // reuse cached when fetch failed
    return { entry: m, monthly, allTime: sumAllTime(dl), firstYear: new Date(dl.created).getUTCFullYear() };
  });

  writeNpmCache(cache);

  return enriched.map<Project>(({ entry, monthly, allTime, firstYear }) => ({
    id: `npm:${entry.package.name}`,
    source: 'npm',
    title: entry.package.name,
    description: entry.package.description ?? '',
    url: entry.package.links.npm,
    homepage: entry.package.links.homepage,
    tags: entry.package.keywords ?? [],
    stats: {
      ...(monthly != null ? { downloadsMonthly: monthly } : {}),
      downloadsAllTime: allTime,
    },
    updatedAt: entry.package.date,
    year: firstYear,
    kind: 'package',
    openSource: true,
    featured: false,
    hasDetail: false,
  }));
};
