import { getCollection } from 'astro:content';
import config from './load-config';
import type { ConnectorResult, Project, ProfileFact } from '../types/project';
import { manualToResults } from '../connectors/manual';
import { buildProjects } from './build-projects';
import { getAll } from '../connectors/_registry';
import type { ConnectorManifest } from '../connectors/_define';
import { readSnapshot, writeSnapshot, type ConnectorKey, type SnapshotFile } from './snapshot-store';
import { resolveIconColors } from './icon-color';
import { cacheMediaBatch, getFallbackEvents, makeUrlRewriter } from './media-cache';
import { isRenderable } from './project-renderable';

const FIXTURE_MODE = process.env.CONNECTORS_FIXTURE === '1';
// config.media.cache opts out of the local image/mp4 cache (default ON).
// Off → skip downloads + skip the build-time URL rewrite; the dashboard
// renders upstream URLs verbatim. See projects.config.ts for the doc.
const MEDIA_CACHE_ENABLED = config.media?.cache !== false;

type ConnectorRunResult =
  | { status: 'fresh' | 'cached'; results: ConnectorResult[]; profile?: ProfileFact }
  | { status: 'empty' };

let memo: Promise<Project[]> | null = null;
let lastSnapshot: SnapshotFile | null = null;
let lastProfiles: ProfileFact[] = [];
/** Projects dropped by `isRenderable` (typically a removed Chrome extension /
 *  Play app whose enrichment connector — chromestats / apkpure / appbrain —
 *  couldn't be reached on the build runner). Surfaced via /status.json so the
 *  developer knows they should run a local build to populate the cache. */
let lastHidden: Array<{ id: string; reason: string }> = [];

/** Collect every image / video URL a connector's results + profile reference. */
function collectMediaUrls(results: ConnectorResult[], profile?: ProfileFact): string[] {
  const out: string[] = [];
  for (const r of results) {
    for (const rep of [r.origin, r.mirror, r.native]) {
      if (!rep) continue;
      if (rep.banner) out.push(rep.banner);
      if (rep.icon) out.push(rep.icon);
      if (rep.screenshots) out.push(...rep.screenshots);
      if (rep.videos) out.push(...rep.videos);
    }
  }
  if (profile?.avatar) out.push(profile.avatar);
  return out;
}

/** Download + persist a connector's media URLs if media caching is on.
 *  No-ops in fixture mode or when config.media.cache is false. */
async function maybeCache(key: ConnectorKey, urls: string[]): Promise<void> {
  if (FIXTURE_MODE || !MEDIA_CACHE_ENABLED) return;
  await cacheMediaBatch(key, urls);
}

async function runConnector(
  manifest: ConnectorManifest,
  enabled: boolean,
  snapshot: SnapshotFile,
  now: string,
): Promise<ConnectorRunResult> {
  const key = manifest.key as ConnectorKey;
  const cached = snapshot.connectors[key];
  if (!enabled) {
    if (cached) await maybeCache(key, collectMediaUrls(cached.results));
    return cached ? { status: 'cached', results: cached.results } : { status: 'empty' };
  }
  // Two failure paths converge: the connector throws OR it explicitly
  // signals { ok: false }. In both cases we preserve the previous successful
  // `results` and `lastScrapedAt` so a transient block doesn't blank out
  // the source — only `lastAttempt` gets refreshed.
  const recordFailure = (error: string): ConnectorRunResult => {
    snapshot.connectors[key] = {
      lastScrapedAt: cached?.lastScrapedAt ?? now,
      results: cached?.results ?? [],
      lastAttempt: { at: now, ok: false, error },
    };
    if (cached) return { status: 'cached', results: cached.results };
    return { status: 'empty' };
  };
  let out;
  try {
    out = await manifest.fetch(config, { fixtureMode: FIXTURE_MODE });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[loader] connector "${key}" threw:`, err);
    const result = recordFailure(msg);
    if (result.status === 'cached') {
      console.warn(`[loader] falling back to cached "${key}" data from ${cached!.lastScrapedAt}`);
      await maybeCache(key, collectMediaUrls(cached!.results));
    }
    return result;
  }
  if (out.ok === false) {
    const msg = out.error ?? 'connector reported ok:false';
    console.warn(`[loader] connector "${key}" reported failure: ${msg}`);
    const result = recordFailure(msg);
    if (result.status === 'cached') {
      console.warn(`[loader] falling back to cached "${key}" data from ${cached!.lastScrapedAt}`);
      await maybeCache(key, collectMediaUrls(cached!.results));
    }
    return result;
  }
  // ok === true OR ok === 'partial': both write fresh results to the
  // snapshot. The granular state ('partial' = incomplete but usable)
  // rides along in `lastAttempt.ok` for surface in /status.json.
  const results = out.projects ?? [];
  const partial = out.ok === 'partial';
  if (partial) {
    console.warn(`[loader] connector "${key}" partial coverage: ${out.error ?? 'some configured ids returned no data'}`);
  }
  snapshot.connectors[key] = {
    lastScrapedAt: now,
    results,
    lastAttempt: {
      at: now,
      ok: partial ? 'partial' : true,
      ...(partial && out.error ? { error: out.error } : {}),
    },
  };
  await maybeCache(key, collectMediaUrls(results, out.profile));
  return { status: 'fresh', results, profile: out.profile };
}

/** Manual authoritative origin facts from config.origins (e.g. Play Console totals). */
function manualOrigins(): ConnectorResult[] {
  const out: ConnectorResult[] = [];
  for (const [resourceId, fact] of Object.entries(config.origins ?? {})) {
    const idx = resourceId.indexOf(':');
    if (idx < 0) continue;
    out.push({
      origin: {
        platform: resourceId.slice(0, idx),
        id: resourceId.slice(idx + 1),
        url: fact.url,
        asOf: fact.asOf,
        firstReleased: fact.firstReleased,
        stats: fact.stats,
        retired: fact.retired,
      },
    });
  }
  return out;
}

async function loadOnce(): Promise<Project[]> {
  const snapshot = readSnapshot();
  const now = new Date().toISOString();

  const manifests = getAll();
  const sourcesCfg = config.sources as unknown as Record<string, { enabled?: boolean }>;
  const results = await Promise.all(
    manifests.map((m) => runConnector(m, sourcesCfg[m.key]?.enabled ?? true, snapshot, now)),
  );
  writeSnapshot(snapshot);
  lastSnapshot = snapshot;
  lastProfiles = results
    .map((r) => (r.status === 'empty' ? undefined : r.profile))
    .filter((p): p is ProfileFact => !!p);

  const connectorResults = results.flatMap((r) => (r.status === 'empty' ? [] : r.results));
  const manualResults = manualToResults(config);
  const all = [...connectorResults, ...manualResults, ...manualOrigins()];

  // Manual entries don't go through runConnector, so cache their media here.
  // Stored under the `manual` connector key like any other source.
  await maybeCache('manual' as ConnectorKey, collectMediaUrls(manualResults));

  const built = buildProjects(all);

  // Extract a dominant colour for each card that has an icon — the backplate
  // (icon-only frame, screenshot+icon stack) pulls a pastel version of this
  // colour. Banner-only cards skip extraction since the foreground art owns
  // the whole tile and there's no backplate visible.
  const iconUrlsForColor = built
    .filter((p) => p.icon && !p.banner)
    .map((p) => p.icon!);
  if (iconUrlsForColor.length) {
    const colorByUrl = await resolveIconColors(iconUrlsForColor);
    for (const p of built) {
      if (p.icon) {
        const c = colorByUrl.get(p.icon);
        if (c) p.iconColor = c;
      }
    }
  }

  // Surface any /tmp/_cache fallback recoveries — they mean a live fetch
  // failed and we patched the build from a previously-stashed copy.
  const fbEvents = getFallbackEvents();
  if (fbEvents.length) {
    console.warn(
      `[media-cache] ${fbEvents.length} URL(s) recovered from /tmp/_cache fallback:`,
    );
    for (const e of fbEvents) {
      console.warn(`  - [${e.connectorKey}] ${e.url}`);
    }
  }

  // Swap original upstream URLs for local served paths when the media cache
  // has a mapping. Connectors always emit ORIGINAL URLs (so the raw scrape
  // stays diagnosable); the dashboard publishes the local copy only when
  // caching is enabled — otherwise upstream URLs pass through verbatim.
  if (MEDIA_CACHE_ENABLED) {
    const rewrite = makeUrlRewriter(config.deployment.base);
    for (const p of built) {
      if (p.banner) p.banner = rewrite(p.banner);
      if (p.icon) p.icon = rewrite(p.icon);
      if (p.screenshots) p.screenshots = p.screenshots.map((u) => rewrite(u) ?? u);
      if (p.videos) p.videos = p.videos.map((u) => rewrite(u) ?? u);
    }
    for (const pf of lastProfiles) {
      if (pf.avatar) pf.avatar = rewrite(pf.avatar);
    }
  }

  // Which slugs have a matching MDX detail page?
  const detailEntries = await getCollection('projects').catch(() => []);
  const detailSlugs = new Set(detailEntries.map((e) => e.id.replace(/\.mdx?$/, '')));
  const featuredSlugs = new Set([
    ...config.featured,
    ...config.manual.filter((m) => m.featured).map((m) => m.slug),
  ]);

  // Drop unrenderable stubs (e.g. removed Chrome extensions where chromestats
  // wasn't reachable on the build runner, so the only data we have is the
  // raw extension id). Track them for the /status endpoint so the dev sees
  // a clear signal that a local build is needed to populate the caches.
  const visible: Project[] = [];
  const hidden: Array<{ id: string; reason: string }> = [];
  for (const p of built) {
    if (isRenderable(p)) {
      visible.push(p);
    } else {
      hidden.push({
        id: p.id,
        reason: 'no friendly title — connector enrichment data missing (likely Cloudflare-gated source unreachable on the build runner)',
      });
    }
  }
  lastHidden = hidden;

  return visible.map((p) => ({
    ...p,
    featured: featuredSlugs.has(p.id),
    hasDetail: detailSlugs.has(p.id),
  }));
}

export function loadProjects(): Promise<Project[]> {
  if (!memo) memo = loadOnce();
  return memo;
}

export function getSnapshot(): SnapshotFile | null {
  return lastSnapshot;
}

/** Profile facts emitted by data-only / dual-output connectors during the
 *  current build. Available after loadProjects() resolves. */
export function getProfiles(): ProfileFact[] {
  return lastProfiles;
}

/** Projects dropped by `isRenderable` during the current build. Each entry
 *  has the project id and a short reason. Surfaced via /status.json. */
export function getHidden(): Array<{ id: string; reason: string }> {
  return lastHidden;
}
