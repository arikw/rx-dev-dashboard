import type { Connector, UrlIdExtractor } from './types';
import type { ConnectorResult } from '../types/project';
import { loadFixture, isPlaceholderHandle } from '../lib/fixtures';

export const urlExtractors: UrlIdExtractor[] = [
  {
    hostnames: ['hub.docker.com'],
    extract: (url) => {
      const m = url.pathname.match(/^\/r\/([^/]+)\/([^/#?]+)/);
      return m ? { platform: 'docker', id: `${m[1]}/${m[2]}` } : null;
    },
  },
];

type DockerRepo = {
  name: string;
  namespace: string;
  description: string | null;
  pull_count: number;
  star_count: number;
  last_updated: string;
  date_registered?: string;
  is_private: boolean;
};

type DockerListResponse = {
  count: number;
  next: string | null;
  results: DockerRepo[];
};

async function fetchAllDockerRepos(user: string): Promise<DockerRepo[]> {
  const all: DockerRepo[] = [];
  let url: string | null = `https://hub.docker.com/v2/repositories/${encodeURIComponent(user)}/?page_size=100`;
  while (url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'rx-dev-dashboard' } });
    if (!res.ok) throw new Error(`Docker Hub ${res.status}`);
    const data = (await res.json()) as DockerListResponse;
    all.push(...(data.results ?? []).filter((r) => !r.is_private));
    url = data.next;
  }
  return all;
}

export const fetchDockerProjects: Connector = async (config, options) => {
  const handle = config.user.docker;
  if (isPlaceholderHandle(handle)) return [];

  if (options?.fixtureMode) return loadFixture('docker');

  const cfg = config.sources.docker;
  const explicit = new Set(cfg.repositories);
  const all = await fetchAllDockerRepos(handle);
  const picked = explicit.size > 0 ? all.filter((r) => explicit.has(r.name)) : all;

  return picked.map<ConnectorResult>((r) => ({
    // Docker Hub is the origin. "pulls" → canonical `downloads`; Docker stars
    // → canonical `stars` (summed with GitHub stars if merged).
    origin: {
      platform: 'docker',
      id: `${r.namespace}/${r.name}`,
      url: `https://hub.docker.com/r/${r.namespace}/${r.name}`,
      asOf: r.last_updated,
      title: `${r.namespace}/${r.name}`,
      description: r.description ?? '',
      firstReleased: r.date_registered ? new Date(r.date_registered).getUTCFullYear() : undefined,
      tags: ['docker'],
      kind: 'image',
      stats: { downloads: r.pull_count, stars: r.star_count },
    },
  }));
};
