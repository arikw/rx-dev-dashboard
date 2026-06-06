import type { Project } from '../types/project';

/** Resolve the URL a project's title (or any "primary clickable identity"
 *  surface — e.g. the review-carousel project link) should point at.
 *  Priority:
 *    1. The project's own homepage (most useful destination)
 *    2. The first non-github source-group URL (npm, docker, CWS, …)
 *    3. The github URL
 *    4. The primary origin URL fallback
 *
 *  "github" usually duplicates what's already advertised by the GH source
 *  chip, so a non-github landing page (npm package page, CWS listing, etc.)
 *  is more interesting to click on the title. */
export function resolveTitleHref(p: Project): string {
  if (p.homepage) return p.homepage;
  const urls = p.sourceUrls ?? {};
  const nonGithub = Object.entries(urls).find(([k, v]) => k !== 'github' && v);
  if (nonGithub) return nonGithub[1];
  if (urls.github) return urls.github;
  return p.url || '';
}
