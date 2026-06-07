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

type FaviconCandidate = {
  href: string;
  rel: string;
  /** Largest dimension from the `sizes` attribute, or an inferred value
   *  when `sizes` is missing. SVG sources resolve to Infinity (vector
   *  scales any size). */
  size: number;
};

/** Walk every `<link>` tag in the head, keep the ones with an icon-shaped
 *  `rel`, and return them as ranked candidates. */
function collectFaviconLinks(html: string): { href: string; rel: string; sizes: string | null }[] {
  const out: { href: string; rel: string; sizes: string | null }[] = [];
  const LINK_RE = /<link\b([^>]*?)\/?>/gis;
  const ATTR_RE = /\b([a-z-]+)=(["'])((?:(?!\2).)*)\2/gi;
  let lm: RegExpExecArray | null;
  while ((lm = LINK_RE.exec(html))) {
    const attrs: Record<string, string> = {};
    let am: RegExpExecArray | null;
    const blob = lm[1];
    ATTR_RE.lastIndex = 0;
    while ((am = ATTR_RE.exec(blob))) {
      attrs[am[1].toLowerCase()] = am[3];
    }
    const rel = (attrs.rel ?? '').toLowerCase().trim();
    if (!rel || !attrs.href) continue;
    // Accept anything with an icon-shaped rel — "icon", "shortcut icon",
    // "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon",
    // "fluid-icon", "fluid icon".
    if (!/(?:^|\s)(?:shortcut\s+)?icon(?:\s|$)|apple-touch-icon|mask-icon|fluid-icon/.test(rel)) continue;
    out.push({ href: attrs.href, rel, sizes: attrs.sizes ?? null });
  }
  return out;
}

/** Parse the `sizes` attribute (e.g. `"180x180"`, `"32x32 64x64"`, `"any"`)
 *  into the largest dimension expressed. `any` is treated as Infinity
 *  (vector / source picks the size). */
function parseSizes(sizes: string | null): number {
  if (!sizes) return 0;
  const lower = sizes.trim().toLowerCase();
  if (lower === 'any') return Infinity;
  let max = 0;
  for (const tok of lower.split(/\s+/)) {
    const m = tok.match(/^(\d+)x(\d+)$/);
    if (m) max = Math.max(max, Math.max(Number(m[1]), Number(m[2])));
  }
  return max;
}

/** Inferred size when `sizes` is absent. Based on rel type + URL hints. */
function inferSize(rel: string, href: string): number {
  // SVG / mask-icon: vector, any-size.
  if (rel.includes('mask-icon')) return Infinity;
  if (/\.svg(?:[?#]|$)/i.test(href)) return Infinity;
  // apple-touch-icon defaults to 180x180 per Apple's convention.
  if (rel.includes('apple-touch-icon')) return 180;
  // Some sites embed the size in the URL: favicon-32x32.png, icon-512.png.
  const urlSize = href.match(/[-_/](\d{2,4})(?:x\d{2,4})?\.(?:png|ico|webp|jpe?g)\b/i);
  if (urlSize) return Number(urlSize[1]);
  // Plain `icon` / `shortcut icon` with no other hint — assume small
  // tab-icon (16x16). Site explicitly serving a high-res icon will have
  // a `sizes` attribute.
  return 16;
}

async function extractFavicon(html: string, baseUrl: string): Promise<string | null> {
  const links = collectFaviconLinks(html);
  const candidates: FaviconCandidate[] = [];
  for (const l of links) {
    let resolved: string;
    try {
      resolved = new URL(l.href, baseUrl).toString();
    } catch {
      continue;
    }
    const declared = parseSizes(l.sizes);
    const size = declared > 0 ? declared : inferSize(l.rel, resolved);
    candidates.push({ href: resolved, rel: l.rel, size });
  }
  // Rank: largest size first; ties broken by rel preference (mask-icon /
  // SVG > apple-touch > generic icon — vector formats and Apple's 180px
  // touch icon are usually higher-quality than the 16x16 favicon.ico).
  const relRank = (rel: string): number => {
    if (rel.includes('mask-icon')) return 4;
    if (rel.includes('apple-touch-icon')) return 3;
    if (rel.includes('shortcut')) return 1;
    return 2;
  };
  candidates.sort((a, b) => b.size - a.size || relRank(b.rel) - relRank(a.rel));

  for (const c of candidates) {
    if (c.href.startsWith('data:') || (await isReachable(c.href))) return c.href;
  }
  // Fallback to /favicon.ico convention.
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
