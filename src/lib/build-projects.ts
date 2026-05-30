import type {
  CanonicalStats,
  ConnectorResult,
  Project,
  ProjectKind,
  Representation,
} from '../types/project';
import type { UrlIdExtractor } from '../connectors/types';
import { urlExtractors as githubExt } from '../connectors/github';
import { urlExtractors as npmExt } from '../connectors/npm';
import { urlExtractors as dockerExt } from '../connectors/docker';
import { urlExtractors as chromeExt } from '../connectors/chrome';
import { urlExtractors as gnomeExt } from '../connectors/gnome';
import { urlExtractors as playstoreExt } from '../connectors/playstore';

const ALL_EXTRACTORS: UrlIdExtractor[] = [
  ...githubExt,
  ...npmExt,
  ...dockerExt,
  ...chromeExt,
  ...gnomeExt,
  ...playstoreExt,
];

const EXTRACTOR_BY_HOST = new Map<string, UrlIdExtractor>();
for (const ex of ALL_EXTRACTORS) for (const h of ex.hostnames) EXTRACTOR_BY_HOST.set(h, ex);

function tryExtractId(rawUrl?: string): { platform: string; id: string } | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    const ex = EXTRACTOR_BY_HOST.get(u.hostname);
    return ex ? ex.extract(u) : null;
  } catch {
    return null;
  }
}

/** Every (platform, id) the builder can derive from a result's URLs. */
function derivedOriginKeys(r: ConnectorResult): string[] {
  const out = new Set<string>();
  for (const rep of repsOf(r)) {
    for (const u of [rep.homepage, rep.sourceUrl, rep.url]) {
      const x = tryExtractId(u);
      if (x) out.add(`${x.platform}:${x.id}`);
    }
  }
  return [...out];
}

// Preference for choosing a project's canonical identity (lower = better home).
const PLATFORM_RANK: Record<string, number> = {
  github: 0,
  npm: 1,
  docker: 2,
  gnome: 3,
  'google-play': 4,
  chrome: 5,
  manual: 6,
};
const rankOf = (p: string): number => PLATFORM_RANK[p] ?? 99;

// Map a rep's platform key to its user-facing "source-group" — for chip
// labels and per-source URL resolution. Origins and their mirrors map to the
// same group, so a chrome card whose CWS listing is dead can still resolve
// CHROME → chrome-stats.com via the mirror.
const PLATFORM_TO_SOURCE_GROUP: Record<string, string> = {
  github: 'github',
  npm: 'npm',
  docker: 'docker',
  gnome: 'gnome',
  chrome: 'chrome',
  'chrome-stats': 'chrome',
  'google-play': 'android',
  apkpure: 'android',
  appbrain: 'android',
};

function canonUrl(u?: string): string | null {
  if (!u) return null;
  const c = u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '');
  return c || null;
}

const repsOf = (r: ConnectorResult): Representation[] =>
  [r.origin, r.mirror, r.native].filter((x): x is Representation => !!x);

const originKey = (r: ConnectorResult): string | null =>
  r.origin?.id ? `${r.origin.platform}:${r.origin.id}` : null;

/** Normalized last segment of the origin id, for cross-origin same-project matching. */
function nameKey(r: ConnectorResult): string | null {
  const o = r.origin;
  if (!o) return null;
  if (!o.id) return o.title ? o.title.toLowerCase().trim().replace(/\s+/g, '-') : null;
  const seg = o.id.includes('/') ? o.id.split('/').pop()! : o.id;
  const last = seg.includes('.') ? seg.split('.').pop()! : seg;
  return last.toLowerCase().trim();
}

function identityUrls(r: ConnectorResult): string[] {
  const out: string[] = [];
  for (const rep of repsOf(r)) {
    for (const u of [rep.url, rep.sourceUrl]) {
      const c = canonUrl(u);
      if (c) out.push(c);
    }
  }
  return out;
}

const homepagesOf = (r: ConnectorResult): string[] =>
  repsOf(r)
    .map((rep) => canonUrl(rep.homepage))
    .filter((c): c is string => !!c);

function sameProject(a: ConnectorResult, b: ConnectorResult): boolean {
  const ak = originKey(a);
  const bk = originKey(b);
  if (ak && bk && ak === bk) return true; // same origin resource
  const an = nameKey(a);
  const bn = nameKey(b);
  if (an && bn && an === bn) return true; // same normalized name

  // URL-extracted origin keys: connectors register extractors for the hostnames
  // they own (chrome.google.com, play.google.com, etc.). A GitHub repo whose
  // `homepage` points at a CWS listing therefore derives `chrome:<extId>`, and
  // merges with the chrome card that has that same origin id.
  const aDerived = derivedOriginKeys(a);
  const bDerived = derivedOriginKeys(b);
  if (bk && aDerived.includes(bk)) return true;
  if (ak && bDerived.includes(ak)) return true;
  if (aDerived.some((d) => bDerived.includes(d))) return true;

  const aIds = identityUrls(a);
  const bIds = identityUrls(b);
  if (homepagesOf(a).some((h) => bIds.includes(h))) return true;
  if (homepagesOf(b).some((h) => aIds.includes(h))) return true;
  return false;
}

/** Union-find grouping of connector results into projects. */
function groupResults(results: ConnectorResult[]): ConnectorResult[][] {
  const n = results.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sameProject(results[i], results[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, ConnectorResult[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(results[i]);
  }
  return [...groups.values()];
}

type Cand = { rep: Representation; isOrigin: boolean };

/** Pick one value across candidates: origin role wins; else freshest `asOf`;
 * else greatest magnitude (the credible-pool fallback). */
function pick<T>(
  cands: Cand[],
  get: (s: CanonicalStats) => T | undefined,
  mag: (v: T) => number,
): T | undefined {
  const withVal = cands
    .map((c) => ({ c, v: c.rep.stats ? get(c.rep.stats) : undefined }))
    .filter((x): x is { c: Cand; v: T } => x.v !== undefined);
  if (!withVal.length) return undefined;
  withVal.sort((a, b) => {
    if (a.c.isOrigin !== b.c.isOrigin) return a.c.isOrigin ? -1 : 1;
    const fa = a.c.rep.asOf ?? '';
    const fb = b.c.rep.asOf ?? '';
    if (fa !== fb) return fa > fb ? -1 : 1;
    return mag(b.v) - mag(a.v);
  });
  return withVal[0].v;
}

/** Reconcile all representations describing one origin resource → one stat set. */
function reconcileResource(cands: Cand[]): CanonicalStats {
  const s: CanonicalStats = {};
  const stars = pick(cands, (x) => x.stars, (v) => v);
  const forks = pick(cands, (x) => x.forks, (v) => v);
  const downloads = pick(cands, (x) => x.downloads, (v) => v);
  const downloadsMonthly = pick(cands, (x) => x.downloadsMonthly, (v) => v);
  const users = pick(cands, (x) => x.users, (v) => v);
  const installs = pick(cands, (x) => x.installs, (v) => v.value);
  const rating = pick(cands, (x) => x.rating, (v) => v.count);
  if (stars != null) s.stars = stars;
  if (forks != null) s.forks = forks;
  if (downloads != null) s.downloads = downloads;
  if (downloadsMonthly != null) s.downloadsMonthly = downloadsMonthly;
  if (users != null) s.users = users;
  if (installs != null) s.installs = installs;
  if (rating != null) s.rating = rating;
  return s;
}

/** First non-empty field across candidates already ordered by preference. */
function firstField<T>(ordered: Representation[], get: (r: Representation) => T | undefined): T | undefined {
  for (const r of ordered) {
    const v = get(r);
    if (v != null && v !== '') return v;
  }
  return undefined;
}

function buildProject(group: ConnectorResult[]): Project {
  // 1) Partition into origin resources (origin + its mirrors) and native reps.
  const resources = new Map<string, Cand[]>();
  const natives: Representation[] = [];
  const standaloneOrigins: Cand[] = []; // origin reps without an id (rare)

  for (const r of group) {
    const key = originKey(r);
    if (r.origin) {
      const cand: Cand = { rep: r.origin, isOrigin: true };
      if (key) (resources.get(key) ?? resources.set(key, []).get(key)!).push(cand);
      else standaloneOrigins.push(cand);
    }
    if (r.mirror && key) {
      (resources.get(key) ?? resources.set(key, []).get(key)!).push({ rep: r.mirror, isOrigin: false });
    } else if (r.mirror) {
      standaloneOrigins.push({ rep: r.mirror, isOrigin: false });
    }
    if (r.native) natives.push(r.native);
  }

  // 2) Reconcile each origin resource; collect contributions to sum.
  const contributions: CanonicalStats[] = [];
  for (const cands of resources.values()) contributions.push(reconcileResource(cands));
  if (standaloneOrigins.length) contributions.push(reconcileResource(standaloneOrigins));
  for (const nat of natives) if (nat.stats) contributions.push(nat.stats);

  // 3) Combine: sum additive metrics; rating not summed (pick max-count).
  const stats: CanonicalStats = {};
  const sum = (get: (s: CanonicalStats) => number | undefined): number =>
    contributions.reduce((acc, c) => acc + (get(c) ?? 0), 0);
  const has = (get: (s: CanonicalStats) => unknown): boolean => contributions.some((c) => get(c) != null);

  if (has((c) => c.stars)) stats.stars = sum((c) => c.stars);
  if (has((c) => c.forks)) stats.forks = sum((c) => c.forks);
  if (has((c) => c.downloads)) stats.downloads = sum((c) => c.downloads);
  if (has((c) => c.downloadsMonthly)) stats.downloadsMonthly = sum((c) => c.downloadsMonthly);
  if (has((c) => c.users)) stats.users = sum((c) => c.users);

  const installContribs = contributions.filter((c) => c.installs);
  if (installContribs.length) {
    stats.installs = {
      value: installContribs.reduce((a, c) => a + (c.installs?.value ?? 0), 0),
      exact: installContribs.every((c) => c.installs?.exact),
    };
  }
  const ratings = contributions.map((c) => c.rating).filter((r): r is NonNullable<typeof r> => !!r);
  if (ratings.length) stats.rating = ratings.sort((a, b) => b.count - a.count)[0];

  // 4) Identity from the best origin (lowest platform rank).
  const allReps = group.flatMap(repsOf);
  const origins = group
    .map((r) => r.origin)
    .filter((o): o is Representation => !!o)
    .sort((a, b) => rankOf(a.platform) - rankOf(b.platform));
  const primary = origins[0] ?? allReps[0];

  // Reps ordered by preference for picking metadata (origin platform rank, then freshness).
  const ordered = [...allReps].sort((a, b) => {
    const r = rankOf(a.platform) - rankOf(b.platform);
    if (r !== 0) return r;
    return (b.asOf ?? '') > (a.asOf ?? '') ? 1 : -1;
  });

  // For the *title* specifically, prefer the product/package name (chrome
  // extension's CWS title, npm package name, etc.) over the github repo
  // slug. A repo named `chrome-extensions-reloader` should display as
  // "Extensions Reloader" if it's merged with its CWS rep. Github moves to
  // last; everything else keeps its normal ordering.
  const titleRank = (p: string): number => (p === 'github' ? 99 : rankOf(p));
  const orderedForTitle = [...allReps].sort((a, b) => {
    const r = titleRank(a.platform) - titleRank(b.platform);
    if (r !== 0) return r;
    return (b.asOf ?? '') > (a.asOf ?? '') ? 1 : -1;
  });

  const slug = (() => {
    const id = primary.id ?? primary.title ?? 'project';
    const seg = id.includes('/') ? id.split('/').pop()! : id;
    return seg.includes('.') ? seg.split('.').pop()! : seg;
  })();

  // sources = platforms the project lives on: origin + native platforms (not mirror reporters).
  const livePlatforms = new Set<string>();
  for (const r of group) {
    if (r.origin) livePlatforms.add(r.origin.platform);
    if (r.native) livePlatforms.add(r.native.platform);
  }

  // Per source-group URL — first rep with a url wins, ordered by
  // platform rank (so origins beat mirrors but mirrors still provide a
  // usable URL when the origin is dead/removed).
  const repsByPlatformRank = [...allReps].sort(
    (a, b) => rankOf(a.platform) - rankOf(b.platform),
  );
  const sourceUrls: Record<string, string> = {};
  for (const rep of repsByPlatformRank) {
    if (!rep.url) continue;
    const groupKey = PLATFORM_TO_SOURCE_GROUP[rep.platform];
    if (!groupKey) continue;
    if (!sourceUrls[groupKey]) sourceUrls[groupKey] = rep.url;
  }

  const tags = [...new Set(allReps.flatMap((r) => r.tags ?? []))];
  const years = allReps.map((r) => r.firstReleased).filter((y): y is number => typeof y === 'number');
  const updatedAts = allReps.map((r) => r.asOf).filter((u): u is string => !!u);

  const ownUrls = new Set(group.flatMap(identityUrls));
  const homepage = allReps
    .map((r) => r.homepage)
    .find((h) => {
      const c = canonUrl(h);
      return c != null && !ownUrls.has(c);
    });

  return {
    id: slug,
    sources: [...livePlatforms],
    sourceUrls,
    title: firstField(orderedForTitle, (r) => r.title) ?? slug,
    description: firstField(ordered, (r) => r.description) ?? '',
    url: primary.url ?? firstField(ordered, (r) => r.url) ?? '',
    tags,
    stats,
    language: firstField(ordered, (r) => r.language),
    updatedAt: updatedAts.sort().at(-1),
    year: years.length ? Math.min(...years) : undefined,
    homepage: homepage ?? undefined,
    banner: firstField(ordered, (r) => r.banner),
    icon: firstField(ordered, (r) => r.icon),
    screenshots: [...new Set(allReps.flatMap((r) => r.screenshots ?? []))],
    videos: [...new Set(allReps.flatMap((r) => r.videos ?? []))],
    reviews: allReps.flatMap((r) => r.reviews ?? []),
    kind: firstField(ordered, (r) => r.kind) as ProjectKind | undefined,
    openSource: allReps.some((r) => r.openSource),
    sourceUrl: firstField(ordered, (r) => r.sourceUrl),
    featured: false,
    hasDetail: false,
  };
}

/**
 * Build rendered project cards from raw connector results.
 *  - L1: group results into projects, reconcile each origin resource
 *        (origin wins → freshest `asOf` → greatest value).
 *  - L2: sum additive metrics across a project's resources + native channels;
 *        rating is reconciled (max count), never summed.
 */
export function buildProjects(results: ConnectorResult[]): Project[] {
  return groupResults(results)
    .filter((group) => !group.some((r) => repsOf(r).some((rep) => rep.archived)))
    .map(buildProject);
}
