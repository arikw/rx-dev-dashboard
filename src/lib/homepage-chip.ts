import type { Project } from '../types/project';

/** Hostnames that belong to a known source-platform listing. A homepage
 *  pointing at one of these isn't an external project website — it's
 *  just a link back to a platform the project already lives on (e.g.
 *  an npm package's `homepage` field set to the GitHub repo's README
 *  URL). Treated as "not a real homepage" for both rendering and
 *  scoring purposes. */
const PLATFORM_HOSTS = new Set([
  'github.com',
  'npmjs.com',
  'hub.docker.com',
  'chrome.google.com',
  'chromewebstore.google.com',
  'addons.mozilla.org',
  'extensions.gnome.org',
  'play.google.com',
  'apps.apple.com',
  'apkpure.com',
  'm.apkpure.com',
  'appbrain.com',
  'stackoverflow.com',
]);

function isPlatformHostname(u?: string): boolean {
  if (!u) return false;
  try {
    return PLATFORM_HOSTS.has(new URL(u).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

/** Canonicalise a URL for equality comparison: strip protocol, www.,
 *  fragment, trailing slashes, and lowercase. */
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

/** Resolve whether a project has a genuine external website that should
 *  render as its own card chip — i.e. NOT a duplicate of the title link,
 *  NOT a duplicate of any source-platform listing URL, and NOT pointing
 *  at a known platform host (an npm package whose homepage redirects
 *  back at the GitHub README, etc.).
 *
 *  Returns `{ href }` when the homepage chip would render, or `null`.
 *  Single source of truth for both:
 *    - ProjectCard (decides whether to render the chip)
 *    - featured-score (decides whether to count "has homepage" in the
 *      sort score)
 *  so the two never disagree. */
export function resolveHomepageChip(p: Project): { href: string } | null {
  if (!p.homepage) return null;
  if (isPlatformHostname(p.homepage)) return null;
  const homepageCanon = canonUrl(p.homepage);
  if (!homepageCanon) return null;
  const existing = new Set<string>();
  const titleCanon = canonUrl(p.url);
  if (titleCanon) existing.add(titleCanon);
  for (const h of Object.values(p.sourceUrls ?? {})) {
    const c = canonUrl(h);
    if (c) existing.add(c);
  }
  if (existing.has(homepageCanon)) return null;
  return { href: p.homepage };
}
