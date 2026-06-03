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

async function fetchHtml(
  url: string,
): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) rx-dev-dashboard/0.1',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    // Cloudflare bot-challenge response — `cf-mitigated: challenge` is
    // set when Cloudflare is actively challenging the request. Treat as
    // "no usable HTML" so the challenge page's body (e.g. <title>Just a
    // moment...</title>) doesn't leak into our caches.
    if (res.headers.get('cf-mitigated') === 'challenge') return null;
    return { html: await res.text(), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Known interstitial / placeholder <title> values that don't describe
 *  the actual page. Cloudflare bot-challenge titles in particular would
 *  otherwise get cached as the project's "real" title forever. */
function isInterstitialTitle(t: string): boolean {
  const s = t.toLowerCase().trim();
  return (
    s.startsWith('just a moment') ||
    s.startsWith('attention required') ||
    s.startsWith('please wait') ||
    s.startsWith('checking your browser') ||
    s.startsWith('access denied') ||
    s === 'loading...' ||
    s === 'loading' ||
    s === 'untitled' ||
    s === 'document'
  );
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = m?.[1]?.replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  if (isInterstitialTitle(raw)) return null;
  return decodeHtmlEntities(raw);
}

async function extractFavicon(html: string, baseUrl: string): Promise<string | null> {
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
  if (href) {
    try {
      const resolved = new URL(href, baseUrl).toString();
      if (resolved.startsWith('data:') || (await isReachable(resolved))) return resolved;
    } catch {
      /* fallthrough */
    }
  }
  try {
    const fallback = new URL('favicon.ico', baseUrl).toString();
    if (await isReachable(fallback)) return fallback;
  } catch {
    /* fallthrough */
  }
  return null;
}

/** Resolve a `<meta http-equiv="refresh" content="0;url=…">` redirect
 *  if present in the HTML. Returns the absolute target URL or null. */
function followMetaRefresh(html: string, baseUrl: string): string | null {
  // Tolerant of single/double quotes, optional delay-then-URL spacing, and
  // either `url=` or `URL=` casing.
  const m = html.match(
    /<meta[^>]+http-equiv=(["'])refresh\1[^>]+content=(["'])[^;]*;\s*url=([^"']+)\2/i,
  );
  if (!m) return null;
  try {
    return new URL(m[3], baseUrl).toString();
  } catch {
    return null;
  }
}

/** Fetch the given URL's HTML and extract:
 *   - favicon: <link rel="icon|shortcut icon|apple-touch-icon|mask-icon">,
 *     fallback to <pages-url>favicon.ico convention. Reachable URLs only.
 *   - title:   <title>…</title>, trimmed and entity-decoded.
 *
 *  When the initial page has no <title> but DOES have a
 *  <meta http-equiv="refresh"> (common for SPAs that locale-redirect or
 *  static stubs that bounce to a sub-path), follow the refresh chain up
 *  to `maxRefreshHops` times and try again. The first non-null title /
 *  favicon found anywhere in the chain wins. */
export async function fetchPagesMeta(
  targetUrl: string,
  maxRefreshHops = 3,
): Promise<{ favicon: string | null; title: string | null }> {
  let currentUrl = targetUrl;
  let title: string | null = null;
  let favicon: string | null = null;
  const seen = new Set<string>();
  for (let hop = 0; hop <= maxRefreshHops; hop++) {
    if (seen.has(currentUrl)) break;
    seen.add(currentUrl);
    const result = await fetchHtml(currentUrl);
    if (!result) break;
    // Resolve favicon / meta-refresh relative to the FINAL URL (after
    // HTTP redirects) — that's where the HTML actually came from.
    // Using the originally-requested URL here would resolve /en/ on the
    // wrong host when an HTTP 301 took us cross-origin.
    const { html, finalUrl } = result;
    if (!title) title = extractTitle(html);
    if (!favicon) favicon = await extractFavicon(html, finalUrl);
    if (title && favicon) break;
    const next = followMetaRefresh(html, finalUrl);
    if (!next) break;
    currentUrl = next;
  }
  return { favicon, title };
}
