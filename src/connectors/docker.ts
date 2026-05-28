import type { Connector } from './types';
import type { Project } from '../types/project';
import { loadFixture, isPlaceholderHandle } from '../lib/fixtures';

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

  return picked.map<Project>((r) => ({
    id: `docker:${r.namespace}/${r.name}`,
    source: 'docker',
    title: `${r.namespace}/${r.name}`,
    description: r.description ?? '',
    url: `https://hub.docker.com/r/${r.namespace}/${r.name}`,
    tags: ['docker'],
    stats: {
      pulls: r.pull_count,
      dockerStars: r.star_count,
    },
    updatedAt: r.last_updated,
    year: r.date_registered ? new Date(r.date_registered).getUTCFullYear() : undefined,
    kind: 'image',
    // openSource is set by the cross-source pass in load-projects when a
    // matching github repo of the same name exists.
    featured: false,
    hasDetail: false,
  }));
};
