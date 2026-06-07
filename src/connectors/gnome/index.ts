import type { Connector } from '../types';
import type { ConnectorResult } from '../../types/project';
import { defineConnector, type UrlIdExtractor } from '../_define';
import { loadFixture } from '../../lib/fixtures';

export const urlExtractors: UrlIdExtractor[] = [
  {
    hostnames: ['extensions.gnome.org'],
    extract: (url) => {
      const m = url.pathname.match(/\/extension\/\d+\/([^/#?]+)/);
      return m ? { platform: 'gnome', id: m[1] } : null;
    },
  },
];

// extensions.gnome.org has no public per-creator listing, so (like Chrome) the
// extensions to show are configured explicitly by their numeric pk.
type EgoExtension = {
  pk: number;
  name: string;
  description: string;
  /** e.g. "/extension/5835/rx-input-layout-switcher/" */
  link: string;
  /** Cumulative all-time download count. */
  downloads: number;
  /** Author-supplied project URL — usually the source repo. */
  url?: string;
  /** Relative paths like "/static/images/plugin.png". */
  icon?: string | null;
  screenshot?: string | null;
  // NOTE: `uuid` (e.g. "name@author-domain") is intentionally never read or
  // stored — it can embed a private domain that must not reach committed data.
};

const EGO_BASE = 'https://extensions.gnome.org';
const abs = (path?: string | null): string | undefined =>
  path ? (path.startsWith('http') ? path : `${EGO_BASE}${path}`) : undefined;

async function fetchOne(pk: number): Promise<EgoExtension | null> {
  const url = `https://extensions.gnome.org/extension-info/?pk=${encodeURIComponent(String(pk))}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'live-dev-portfolio' } });
    if (!res.ok) return null;
    return (await res.json()) as EgoExtension;
  } catch {
    return null;
  }
}

/** "/extension/5835/rx-input-layout-switcher/" → "rx-input-layout-switcher" */
function slugFromLink(link: string, pk: number): string {
  const m = link.match(/\/extension\/\d+\/([^/]+)\/?$/);
  return m ? m[1] : `gnome-${pk}`;
}

export const fetchGnomeProjects: Connector = async (config, options) => {
  const ids = config.sources.gnome.extensionIds;
  if (!ids.length) return [];

  if (options?.fixtureMode) return loadFixture('gnome');

  const results = await Promise.all(ids.map((pk) => fetchOne(pk)));
  const valid = results.filter((e): e is EgoExtension => e !== null);

  return valid.map<ConnectorResult>((e) => {
    const slug = slugFromLink(e.link, e.pk);
    const repo = e.url?.trim() || undefined;
    return {
      // GNOME Extensions is the origin. EGO's project URL is the source repo;
      // exposing it as `sourceUrl` lets the builder merge this with the repo
      // (same name + homepage linkage). "downloads" is canonical.
      origin: {
        platform: 'gnome',
        id: slug,
        url: `https://extensions.gnome.org/extension/${e.pk}/${slug}/`,
        title: e.name,
        description: e.description ?? '',
        tags: ['gnome-extension'],
        kind: 'extension',
        openSource: true,
        sourceUrl: repo,
        icon: abs(e.icon),
        screenshots: abs(e.screenshot) ? [abs(e.screenshot)!] : undefined,
        stats: { downloads: e.downloads },
      },
    };
  });
};

/** Manifest — picked up by `_registry.ts` via auto-discovery. */
export default defineConnector({
  key: 'gnome',
  label: 'GNOME',
  urlExtractors,
  defaultConfig: {
    enabled: true,
    extensionIds: [] as number[],
  },
  fetch: async (config, opts) => {
    const projects = await fetchGnomeProjects(config, opts);
    return { projects };
  },
});
