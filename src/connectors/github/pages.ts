import { readJsonCache, writeJsonCache } from '../../lib/json-cache';

// GitHub Pages cache. Once we've fetched a repo's pages site and pulled its
// favicon URL + <title>, it's frozen — both rarely change. Delete
// generated/.cache/github/pages.json to force a refresh.
const PAGES_CACHE_PATH = 'generated/.cache/github/pages.json';
export type PagesEntry = { pagesUrl: string; favicon: string | null; title: string | null };
type PagesCache = { version: 1; _generated: string; pages: Record<string, PagesEntry> };
const PAGES_CACHE_NOTE =
  'Auto-generated GitHub Pages meta (favicon + <title>), fetched once per repo whose has_pages=true. Delete to refresh.';
const emptyPagesCache = (): PagesCache => ({ version: 1, _generated: PAGES_CACHE_NOTE, pages: {} });

export function readPagesCache(): PagesCache {
  const cache = readJsonCache<PagesCache>(PAGES_CACHE_PATH, emptyPagesCache());
  if (cache.version !== 1 || !cache.pages) Object.assign(cache, emptyPagesCache());
  cache._generated = PAGES_CACHE_NOTE;
  return cache;
}
export function writePagesCache(cache: PagesCache): void {
  writeJsonCache(PAGES_CACHE_PATH, cache);
}

/** Conventional Pages URL for a repo: user/org site if the repo name matches
 *  `<handle>.github.io`, project site otherwise. Custom domains still serve
 *  from this URL (or redirect to it); we leave cname detection to the user
 *  setting the repo's homepage field explicitly. */
export function pagesUrlFor(handle: string, repo: string): string {
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
  } catch {
    return false;
  }
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
export async function fetchPagesMeta(
  targetUrl: string,
): Promise<{ favicon: string | null; title: string | null }> {
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
    } catch {
      /* fallthrough */
    }
  }
  if (!favicon) {
    try {
      const fallback = new URL('favicon.ico', targetUrl).toString();
      if (await isReachable(fallback)) favicon = fallback;
    } catch {
      /* fallthrough */
    }
  }
  return { favicon, title };
}
