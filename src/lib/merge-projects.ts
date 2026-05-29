import type { Project, ProjectStats, ProjectSource } from '../types/project';

// Lower rank = preferred as the merged project's canonical identity
// (id/title/url/source). A repo is a better "home" than its package listing.
const SOURCE_RANK: Record<ProjectSource, number> = {
  manual: 0,
  github: 1,
  npm: 2,
  docker: 3,
  chrome: 4,
  gnome: 5,
  appbrain: 6,
  apkpure: 7,
};

/** Human-friendly name, stripped of source prefix and owner namespace. */
function nameKey(p: Project): string {
  const lower = (s: string) => s.toLowerCase().trim();
  if (p.source === 'npm') {
    const n = p.id.replace(/^npm:/, '');
    return lower(n.includes('/') ? n.split('/').pop()! : n);
  }
  if (p.source === 'docker') {
    const n = p.id.replace(/^docker:/, '');
    return lower(n.includes('/') ? n.split('/').pop()! : n);
  }
  if (p.source === 'chrome') return lower(p.title).replace(/\s+/g, '-');
  if (p.source === 'gnome') return lower(p.id.replace(/^gnome:/, ''));
  if (p.source === 'appbrain') return lower(p.id.replace(/^appbrain:/, ''));
  if (p.source === 'apkpure') return lower(p.id.replace(/^apkpure:/, ''));
  return lower(p.id); // github, manual
}

/** Canonical URL for comparison: no protocol, no www., no #fragment, no trailing slash. */
function canonUrl(u: string | undefined): string | null {
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

/** The URLs that identify a project (its listing + source repo). */
function identityUrls(p: Project): string[] {
  return [canonUrl(p.url), canonUrl(p.sourceUrl)].filter((u): u is string => u !== null);
}

/** True if one project's homepage points at the other's listing/repo (hash ignored). */
function linkedByHomepage(a: Project, b: Project): boolean {
  const ah = canonUrl(a.homepage);
  const bh = canonUrl(b.homepage);
  return (
    (ah !== null && identityUrls(b).includes(ah)) ||
    (bh !== null && identityUrls(a).includes(bh))
  );
}

function isSameProject(a: Project, b: Project): boolean {
  return nameKey(a) === nameKey(b) || linkedByHomepage(a, b);
}

function firstDefined<T>(items: T[], pick: (item: T) => unknown): T | undefined {
  return items.find((i) => pick(i) != null && pick(i) !== '');
}

function mergeGroup(group: Project[]): Project {
  const ordered = [...group].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  const primary = ordered[0];

  // Stats live in disjoint per-source fields; take the first defined for each.
  const stats: ProjectStats = {};
  for (const p of ordered) {
    for (const [k, v] of Object.entries(p.stats) as [keyof ProjectStats, number | undefined][]) {
      if (v != null && stats[k] == null) stats[k] = v;
    }
  }

  const tags = [...new Set(ordered.flatMap((p) => p.tags))];
  const years = ordered.map((p) => p.year).filter((y): y is number => typeof y === 'number');
  const updatedAts = ordered.map((p) => p.updatedAt).filter((u): u is string => !!u);
  const githubMember = ordered.find((p) => p.source === 'github');

  // A homepage worth showing points outside the group (not back at our own
  // listings/repos — e.g. an npm package whose "homepage" is its GitHub readme).
  const ownUrls = new Set(ordered.flatMap(identityUrls));
  const homepage = ordered
    .map((p) => p.homepage)
    .find((h) => {
      const c = canonUrl(h);
      return c !== null && !ownUrls.has(c);
    });

  return {
    id: primary.id,
    source: primary.source,
    sources: [...new Set(ordered.map((p) => p.source))],
    title: primary.title,
    description: primary.description || firstDefined(ordered, (p) => p.description)?.description || '',
    url: primary.url,
    tags,
    stats,
    language: primary.language ?? firstDefined(ordered, (p) => p.language)?.language,
    updatedAt: updatedAts.sort().at(-1),
    year: years.length ? Math.min(...years) : undefined,
    homepage: homepage ?? undefined,
    image: firstDefined(ordered, (p) => p.image)?.image,
    kind: primary.kind ?? firstDefined(ordered, (p) => p.kind)?.kind,
    // Keep installsExact aligned with whichever source supplied `stats.installs`
    // (same first-defined-by-rank order used for the stats above).
    installsExact: ordered.find((p) => p.stats.installs != null)?.installsExact,
    openSource: ordered.some((p) => p.openSource || p.source === 'github' || p.source === 'npm'),
    sourceUrl: githubMember?.url ?? firstDefined(ordered, (p) => p.sourceUrl)?.sourceUrl,
    featured: ordered.some((p) => p.featured),
    hasDetail: ordered.some((p) => p.hasDetail),
  };
}

/**
 * Collapse projects that are the same thing across sources into one card.
 * Two projects merge when they share a normalized name OR one's homepage points
 * at the other's listing/repo. Stats and links are combined; the highest-ranked
 * source (manual > github > npm > docker > chrome) supplies the identity.
 *
 * Expects featured/hasDetail already resolved on the inputs — they're OR-ed.
 */
export function mergeProjects(projects: Project[]): Project[] {
  const n = projects.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (isSameProject(projects[i], projects[j])) union(i, j);
    }
  }

  const groups = new Map<number, Project[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(projects[i]);
    else groups.set(root, [projects[i]]);
  }

  return [...groups.values()].map(mergeGroup);
}
