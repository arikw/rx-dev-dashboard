import type { Connector, UrlIdExtractor } from './types';
import type { ConnectorResult, ProjectKind } from '../types/project';
import { loadFixture, isPlaceholderHandle } from '../lib/fixtures';
import { readJsonCache, writeJsonCache } from '../lib/json-cache';

export const urlExtractors: UrlIdExtractor[] = [
  {
    hostnames: ['github.com', 'www.github.com'],
    extract: (url) => {
      const m = url.pathname.match(/^\/[^/]+\/([^/#?]+)/);
      return m ? { platform: 'github', id: m[1].replace(/\.git$/, '') } : null;
    },
  },
];

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

// GitHub Pages cache. Once we've fetched a repo's pages site and pulled its
// favicon URL + <title>, it's frozen — both rarely change. Delete
// generated/github-pages.json to force a refresh.
const PAGES_CACHE_PATH = 'generated/github-pages.json';
type PagesEntry = { pagesUrl: string; favicon: string | null; title: string | null };
type PagesCache = { version: 1; _generated: string; pages: Record<string, PagesEntry> };
const PAGES_CACHE_NOTE =
  'Auto-generated GitHub Pages meta (favicon + <title>), fetched once per repo whose has_pages=true. Delete to refresh.';
const emptyPagesCache = (): PagesCache => ({ version: 1, _generated: PAGES_CACHE_NOTE, pages: {} });


/** Conventional Pages URL for a repo: user/org site if the repo name matches
 * `<handle>.github.io`, project site otherwise. Custom domains still serve
 * from this URL (or redirect to it); we leave cname detection to the user
 * setting the repo's homepage field explicitly. */
function pagesUrlFor(handle: string, repo: string): string {
  const handleLower = handle.toLowerCase();
  const repoLower = repo.toLowerCase();
  if (repoLower === `${handleLower}.github.io`) return `https://${handleLower}.github.io/`;
  return `https://${handleLower}.github.io/${repo}/`;
}

/** HEAD-check a URL to confirm it actually serves a resource. */
async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch { return false; }
}

/** Decode common HTML entities in title text. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Fetch the given URL's HTML once and extract:
 *   - favicon: <link rel="icon|shortcut icon|apple-touch-icon|mask-icon">,
 *     fallback to <pages-url>favicon.ico convention. Reachable URLs only.
 *   - title:   <title>…</title>, trimmed and entity-decoded. */
async function fetchPagesMeta(targetUrl: string): Promise<{ favicon: string | null; title: string | null }> {
  let html: string;
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) rx-dev-dashboard/0.1',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) return { favicon: null, title: null };
    html = await res.text();
  } catch {
    return { favicon: null, title: null };
  }

  // ---- title ----
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = titleMatch?.[1]?.replace(/\s+/g, ' ').trim();
  const title = rawTitle ? decodeHtmlEntities(rawTitle) : null;

  // ---- favicon ----
  // Match <link rel="<one of icon variants>" href="..."> in either attribute
  // order. Crucially: capture href content based on its OPENING quote char
  // (backreference) — so single quotes inside a double-quoted data: URI (and
  // vice versa) don't terminate the capture early.
  const REL_VALUES = '(?:shortcut\\s+)?icon|apple-touch-icon|mask-icon';
  const relHref = new RegExp(
    `<link[^>]*?\\brel=(["'])(?:${REL_VALUES})\\1[^>]*?\\bhref=(["'])(.*?)\\2`,
    'is',
  );
  const hrefRel = new RegExp(
    `<link[^>]*?\\bhref=(["'])(.*?)\\1[^>]*?\\brel=(["'])(?:${REL_VALUES})\\3`,
    'is',
  );
  const href = html.match(relHref)?.[3] ?? html.match(hrefRel)?.[2];
  let favicon: string | null = null;
  if (href) {
    try {
      const resolved = new URL(href, targetUrl).toString();
      if (resolved.startsWith('data:') || (await isReachable(resolved))) favicon = resolved;
    } catch { /* fallthrough */ }
  }
  if (!favicon) {
    try {
      const fallback = new URL('favicon.ico', targetUrl).toString();
      if (await isReachable(fallback)) favicon = fallback;
    } catch { /* fallthrough */ }
  }
  return { favicon, title };
}

async function fetchPage(user: string, page: number, token?: string): Promise<GithubRepo[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'rx-dev-dashboard',
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

export const fetchGithubProjects: Connector = async (config, options) => {
  const handle = config.user.github;
  if (isPlaceholderHandle(handle)) return [];

  if (options?.fixtureMode) return loadFixture('github');

  const token = process.env.GITHUB_TOKEN;
  const repos = await fetchAllRepos(handle, token);

  const cfg = config.sources.github;
  const excludeSet = new Set(cfg.excludeRepos);

  // A repo named exactly after the handle is GitHub's "profile README" repo —
  // it renders the README on the user's profile, not a real project.
  const handleLower = handle.toLowerCase();

  // Filter the repo list first; only THEN look up Pages favicons for the
  // survivors (no point fetching favicons for repos we'll drop).
  const keptRepos = repos
    .filter((r) => cfg.includeForks || !r.fork)
    .filter((r) => !excludeSet.has(r.name))
    .filter((r) => r.name.toLowerCase() !== handleLower);

  // Populate the favicon cache for any has_pages repos we haven't seen before.
  const pagesCache = readJsonCache<PagesCache>(PAGES_CACHE_PATH, emptyPagesCache());
  if (pagesCache.version !== 1 || !pagesCache.pages) Object.assign(pagesCache, emptyPagesCache());
  pagesCache._generated = PAGES_CACHE_NOTE;

  const toFetch = keptRepos.filter((r) => r.has_pages && !pagesCache.pages[r.name]);
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
    writeJsonCache(PAGES_CACHE_PATH, pagesCache);
  }

  return keptRepos.map<ConnectorResult>((r) => {
    const pagesEntry = r.has_pages ? pagesCache.pages[r.name] : undefined;
    // Pages URL stands in as homepage when the repo doesn't set one explicitly,
    // so the card's site badge surfaces it without changing UI.
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
};
