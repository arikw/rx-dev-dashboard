import type { Project } from '../types/project';

/** A project is "renderable" if the dashboard has enough to show on a card.
 *
 *  The hidden case the dashboard cares about: a project whose only identity
 *  is the raw connector id (chrome extension ID, npm package name, …) and
 *  whose enrichment source — typically chromestats for a removed Chrome
 *  extension or apkpure/appbrain for a removed Play app — couldn't be
 *  reached on the build runner. The builder falls back to the id slug as
 *  the title, leaving a card that says `jdmiahadpnljimfcnfaebjggbfkjkgan`
 *  and nothing else.
 *
 *  Filter heuristic: if title equals id AND we have no other content, the
 *  card has nothing useful to render — hide it. Manual projects (where the
 *  user intentionally provides title + description) always have at least
 *  the description filled in, so they pass the filter.
 */
export function isRenderable(p: Project): boolean {
  if (p.title !== p.id) return true;
  if (p.description) return true;
  if (p.url) return true;
  if (p.icon || p.banner) return true;
  if (p.screenshots && p.screenshots.length > 0) return true;
  if (p.stats && Object.keys(p.stats).length > 0) return true;
  return false;
}
