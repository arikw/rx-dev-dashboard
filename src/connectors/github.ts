import type { Connector } from './types';
import type { Project, ProjectKind } from '../types/project';
import { loadFixture, isPlaceholderHandle } from '../lib/fixtures';

const MOBILE_TOPICS = new Set([
  'android',
  'ios',
  'react-native',
  'flutter',
  'swift-ui',
  'mobile',
]);
const EXTENSION_TOPICS = new Set([
  'chrome-extension',
  'chrome-extensions',
  'firefox-extension',
  'web-extension',
  'webextension',
  'gnome-extension',
  'gnome-shell-extension',
]);
const CLI_TOPICS = new Set(['cli', 'command-line', 'cli-tool', 'terminal']);
const LIBRARY_TOPICS = new Set(['library', 'sdk', 'framework']);

function deriveKind(topics: string[]): ProjectKind {
  const t = new Set(topics.map((s) => s.toLowerCase()));
  if ([...EXTENSION_TOPICS].some((k) => t.has(k))) return 'extension';
  if ([...MOBILE_TOPICS].some((k) => t.has(k))) return 'mobile';
  if ([...CLI_TOPICS].some((k) => t.has(k))) return 'cli';
  if ([...LIBRARY_TOPICS].some((k) => t.has(k))) return 'library';
  return 'app';
}

type GithubRepo = {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  topics?: string[];
  language: string | null;
  created_at: string;
  updated_at: string;
  fork: boolean;
  archived: boolean;
};

async function fetchPage(user: string, page: number, token?: string): Promise<GithubRepo[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'rx-dev-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated&type=owner&page=${page}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()) as GithubRepo[];
}

async function fetchAllRepos(user: string, token?: string): Promise<GithubRepo[]> {
  const all: GithubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await fetchPage(user, page, token);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export const fetchGithubProjects: Connector = async (config, options) => {
  const handle = config.user.github;
  if (isPlaceholderHandle(handle)) return [];

  if (options?.fixtureMode) return loadFixture('github');

  const token = process.env.GITHUB_TOKEN;
  const repos = await fetchAllRepos(handle, token);

  const cfg = config.sources.github;
  const excludeSet = new Set(cfg.excludeRepos);

  return repos
    .filter((r) => !r.archived)
    .filter((r) => cfg.includeForks || !r.fork)
    .filter((r) => !excludeSet.has(r.name))
    .map<Project>((r) => ({
      id: r.name,
      source: 'github',
      title: r.name,
      description: r.description ?? '',
      url: r.html_url,
      tags: r.topics ?? [],
      stats: {
        stars: r.stargazers_count,
        forks: r.forks_count,
      },
      language: r.language ?? undefined,
      updatedAt: r.updated_at,
      year: r.created_at ? new Date(r.created_at).getUTCFullYear() : undefined,
      homepage: r.homepage?.trim() ? r.homepage.trim() : undefined,
      kind: deriveKind(r.topics ?? []),
      openSource: true,
      sourceUrl: r.html_url,
      featured: false,
      hasDetail: false,
    }));
};
