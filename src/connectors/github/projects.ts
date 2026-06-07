import type { ConnectorResult, ProjectKind } from '../../types/project';
import { loadFixture, isPlaceholderHandle } from '../../lib/fixtures';
import { pagesUrlFor, fetchPagesMeta, readPagesCache, writePagesCache } from './pages';
import { detectContentLanguage } from '../../lib/content-language';

const MOBILE_TOPICS = new Set([
  'android',
  'ios',
  'react-native',
  'flutter',
  'swift-ui',
  'mobile',
]);
const EXTENSION_TOPICS = new Set([
  'chrome-extension',
  'chrome-extensions',
  'firefox-extension',
  'web-extension',
  'webextension',
  'gnome-extension',
  'gnome-shell-extension',
]);
const CLI_TOPICS = new Set(['cli', 'command-line', 'cli-tool', 'terminal']);
const LIBRARY_TOPICS = new Set(['library', 'sdk', 'framework']);

function deriveKind(topics: string[]): ProjectKind {
  const t = new Set(topics.map((s) => s.toLowerCase()));
  if ([...EXTENSION_TOPICS].some((k) => t.has(k))) return 'extension';
  if ([...MOBILE_TOPICS].some((k) => t.has(k))) return 'mobile';
  if ([...CLI_TOPICS].some((k) => t.has(k))) return 'cli';
  if ([...LIBRARY_TOPICS].some((k) => t.has(k))) return 'library';
  return 'app';
}

type GithubRepo = {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  topics?: string[];
  language: string | null;
  created_at: string;
  updated_at: string;
  fork: boolean;
  archived: boolean;
  has_pages: boolean;
};

async function fetchPage(user: string, page: number, token?: string): Promise<GithubRepo[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'live-dev-portfolio',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated&type=owner&page=${page}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()) as GithubRepo[];
}

async function fetchAllRepos(user: string, token?: string): Promise<GithubRepo[]> {
  const all: GithubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await fetchPage(user, page, token);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export type GithubFetchInput = {
  handle: string;
  includeForks: boolean;
  excludeRepos: string[];
  fixtureMode?: boolean;
};

export async function fetchGithubRepoProjects(input: GithubFetchInput): Promise<ConnectorResult[]> {
  const { handle, includeForks, excludeRepos, fixtureMode } = input;
  if (isPlaceholderHandle(handle)) return [];
  if (fixtureMode) return loadFixture('github');

  const token = process.env.GITHUB_TOKEN;
  const repos = await fetchAllRepos(handle, token);

  const excludeSet = new Set(excludeRepos);
  const handleLower = handle.toLowerCase();

  // Filter first — only look up Pages favicons for the survivors.
  // A repo named exactly after the handle is GitHub's "profile README" repo —
  // it renders the README on the user's profile, not a real project.
  const keptRepos = repos
    .filter((r) => includeForks || !r.fork)
    .filter((r) => !excludeSet.has(r.name))
    .filter((r) => r.name.toLowerCase() !== handleLower);

  const pagesCache = readPagesCache();
  // Re-fetch entries that previously came back with a null title: the
  // page might have gained one since, or the title fetch might succeed
  // now that fetchPagesMeta follows <meta http-equiv="refresh"> chains
  // (which catch SPA/locale-redirect stubs that have no <title> at the
  // root). Entries with a stored title stay frozen.
  const toFetch = keptRepos.filter(
    (r) => r.has_pages && (!pagesCache.pages[r.name] || pagesCache.pages[r.name].title === null),
  );
  if (toFetch.length) {
    const results = await Promise.all(
      toFetch.map(async (r) => {
        const pagesUrl = pagesUrlFor(handle, r.name);
        // Try the repo's homepage first when set — Astro/Hugo/Jekyll sites
        // with a custom `base` (e.g. /projects/, /blog/) emit favicon hrefs
        // rooted at that base, so they resolve correctly only when fetched
        // from the actual deployed URL. Fall back to the conventional
        // <handle>.github.io/<repo>/ URL if the homepage doesn't yield one.
        const homepage = r.homepage?.trim();
        const targets = homepage && homepage !== pagesUrl ? [homepage, pagesUrl] : [pagesUrl];
        let favicon: string | null = null;
        let title: string | null = null;
        for (const t of targets) {
          const meta = await fetchPagesMeta(t);
          if (!favicon && meta.favicon) favicon = meta.favicon;
          if (!title && meta.title) title = meta.title;
          if (favicon && title) break;
        }
        return [r.name, { pagesUrl, favicon, title }] as const;
      }),
    );
    for (const [name, entry] of results) pagesCache.pages[name] = entry;
    writePagesCache(pagesCache);
  }

  return keptRepos.map<ConnectorResult>((r) => {
    const pagesEntry = r.has_pages ? pagesCache.pages[r.name] : undefined;
    const homepage = r.homepage?.trim() || pagesEntry?.pagesUrl || undefined;
    return {
      // GitHub is the origin — its data is first-party, no mirror/native.
      // Archived repos still emit so URL extractors can merge them with their
      // npm / docker / chrome counterparts; the builder then drops the whole
      // merged group, so a project shipped to npm with an archived repo
      // disappears from the dashboard entirely.
      origin: {
        platform: 'github',
        id: r.name,
        url: r.html_url,
        asOf: r.updated_at,
        // For repos with Pages, prefer the rendered site's <title> over the
        // raw repo slug — it's the name the author has chosen to present.
        title: pagesEntry?.title || r.name,
        description: r.description ?? '',
        firstReleased: r.created_at ? new Date(r.created_at).getUTCFullYear() : undefined,
        tags: r.topics ?? [],
        language: r.language ?? undefined,
        // Heuristic content-language tag from the Pages title (only
        // when we have one — the title is the strongest single signal
        // we get from GitHub). detectContentLanguage returns null when
        // it can't identify a non-default language; the builder treats
        // null as English.
        contentLanguage: detectContentLanguage(pagesEntry?.title) ?? undefined,
        kind: deriveKind(r.topics ?? []),
        openSource: true,
        archived: r.archived,
        sourceUrl: r.html_url,
        homepage,
        // The Pages favicon doubles as a per-project icon — much more
        // distinctive than the generic GitHub mark for repos that ship a site.
        // When the site has no detectable favicon, we deliberately leave icon
        // undefined so the card falls through to the brand-mark layout,
        // matching how no-Pages github repos render. The Pages URL still
        // surfaces via `homepage` so the "ships as a site" signal isn't lost.
        icon: pagesEntry?.favicon ?? undefined,
        stats: { stars: r.stargazers_count, forks: r.forks_count },
      },
    };
  });
}
