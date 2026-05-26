import type { Connector } from './types';
import type { Project } from '../types/project';
import { loadFixture, isPlaceholderHandle } from '../lib/fixtures';

type NpmSearchResult = {
  objects: Array<{
    package: {
      name: string;
      description?: string;
      keywords?: string[];
      date: string;
      links: { npm: string };
    };
  }>;
};

type NpmDownloadsPoint = {
  downloads: number;
  start: string;
  end: string;
  package: string;
};

async function fetchPackagesByMaintainer(user: string): Promise<NpmSearchResult['objects']> {
  const all: NpmSearchResult['objects'] = [];
  // npm search caps at 250 per request; paginate via from.
  for (let from = 0; from < 1000; from += 250) {
    const url = `https://registry.npmjs.org/-/v1/search?text=maintainer:${encodeURIComponent(user)}&size=250&from=${from}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'rx-dev-dashboard' } });
    if (!res.ok) throw new Error(`npm search ${res.status}`);
    const data = (await res.json()) as NpmSearchResult;
    if (!data.objects?.length) break;
    all.push(...data.objects);
    if (data.objects.length < 250) break;
  }
  return all;
}

async function fetchDownloads(pkg: string, period: string): Promise<number> {
  try {
    const url = `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(pkg)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'rx-dev-dashboard' } });
    if (!res.ok) return 0;
    const data = (await res.json()) as Partial<NpmDownloadsPoint>;
    return data.downloads ?? 0;
  } catch {
    return 0;
  }
}

export const fetchNpmProjects: Connector = async (config, options) => {
  const handle = config.user.npm;
  if (isPlaceholderHandle(handle)) return [];

  if (options?.fixtureMode) return loadFixture('npm');

  const cfg = config.sources.npm;
  const explicit = new Set(cfg.packages);
  const matches = await fetchPackagesByMaintainer(handle);

  const picked = explicit.size > 0
    ? matches.filter((m) => explicit.has(m.package.name))
    : matches;

  // Fetch downloads in parallel.
  const enriched = await Promise.all(
    picked.map(async (m) => {
      const [monthly, weekly, lastYear] = await Promise.all([
        fetchDownloads(m.package.name, 'last-month'),
        fetchDownloads(m.package.name, 'last-week'),
        fetchDownloads(m.package.name, 'last-year'),
      ]);
      return { entry: m, monthly, weekly, lastYear };
    }),
  );

  return enriched.map<Project>(({ entry, monthly, weekly, lastYear }) => ({
    id: `npm:${entry.package.name}`,
    source: 'npm',
    title: entry.package.name,
    description: entry.package.description ?? '',
    url: entry.package.links.npm,
    tags: entry.package.keywords ?? [],
    stats: {
      downloadsMonthly: monthly,
      downloadsWeekly: weekly,
      downloadsLastYear: lastYear,
    },
    updatedAt: entry.package.date,
    kind: 'package',
    openSource: true, // public npm packages are effectively always open-source distributions
    featured: false,
    hasDetail: false,
  }));
};
