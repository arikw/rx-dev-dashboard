import { getCollection } from 'astro:content';
import config from './load-config';
import type { Project } from '../types/project';
import { fetchGithubProjects } from '../connectors/github';
import { fetchNpmProjects } from '../connectors/npm';
import { fetchDockerProjects } from '../connectors/docker';
import { fetchChromeProjects } from '../connectors/chrome';
import { manualToProjects } from '../connectors/manual';
import type { Connector } from '../connectors/types';
import {
  readSnapshot,
  writeSnapshot,
  toSnapshotProject,
  fromSnapshotProject,
  type ConnectorKey,
  type SnapshotFile,
} from './snapshot-store';

const FIXTURE_MODE = process.env.CONNECTORS_FIXTURE === '1';

type ConnectorRun = {
  key: ConnectorKey;
  enabled: boolean;
  fn: Connector;
};

const CONNECTORS: ConnectorRun[] = [
  { key: 'github', enabled: false, fn: fetchGithubProjects },
  { key: 'npm', enabled: false, fn: fetchNpmProjects },
  { key: 'docker', enabled: false, fn: fetchDockerProjects },
  { key: 'chrome', enabled: false, fn: fetchChromeProjects },
];

type ConnectorResult =
  | { status: 'fresh'; projects: Project[] }
  | { status: 'cached'; projects: Project[]; cachedAt: string }
  | { status: 'empty' };

let memo: Promise<Project[]> | null = null;
let lastSnapshot: SnapshotFile | null = null;

async function runConnector(
  run: ConnectorRun,
  snapshot: SnapshotFile,
  now: string,
): Promise<ConnectorResult> {
  if (!run.enabled) {
    const cached = snapshot.connectors[run.key];
    return cached
      ? {
          status: 'cached',
          projects: cached.projects.map(fromSnapshotProject),
          cachedAt: cached.lastScrapedAt,
        }
      : { status: 'empty' };
  }
  try {
    const projects = await run.fn(config, { fixtureMode: FIXTURE_MODE });
    snapshot.connectors[run.key] = {
      lastScrapedAt: now,
      projects: projects.map(toSnapshotProject),
    };
    return { status: 'fresh', projects };
  } catch (err) {
    console.warn(`[loader] connector "${run.key}" failed:`, err);
    const cached = snapshot.connectors[run.key];
    if (cached) {
      console.warn(
        `[loader] falling back to cached "${run.key}" data from ${cached.lastScrapedAt}`,
      );
      return {
        status: 'cached',
        projects: cached.projects.map(fromSnapshotProject),
        cachedAt: cached.lastScrapedAt,
      };
    }
    return { status: 'empty' };
  }
}

/**
 * Strip source prefix and owner namespace so projects from different sources
 * sharing the same human-friendly name collapse to a single match key.
 *
 * - github "foo-bar"        → "foo-bar"
 * - npm    "npm:foo-bar"    → "foo-bar"
 * - npm    "npm:@scope/foo" → "foo"
 * - docker "docker:user/foo"→ "foo"
 * - chrome titles are used directly (extension slugs aren't human-readable)
 */
function matchKey(p: Project): string {
  const lower = (s: string) => s.toLowerCase().trim();
  if (p.source === 'github') return lower(p.id);
  if (p.source === 'npm') {
    const name = p.id.replace(/^npm:/, '');
    return lower(name.includes('/') ? name.split('/').pop()! : name);
  }
  if (p.source === 'docker') {
    const name = p.id.replace(/^docker:/, '');
    return lower(name.includes('/') ? name.split('/').pop()! : name);
  }
  if (p.source === 'chrome') {
    return lower(p.title).replace(/\s+/g, '-');
  }
  return lower(p.id);
}

function applyCrossSourceOpenSource(projects: Project[]): Project[] {
  const githubByKey = new Map<string, Project>();
  for (const p of projects) {
    if (p.source === 'github') githubByKey.set(matchKey(p), p);
  }
  return projects.map((p) => {
    if (p.source === 'github' || p.openSource) return p;
    const match = githubByKey.get(matchKey(p));
    if (!match) return p;
    return { ...p, openSource: true, sourceUrl: p.sourceUrl ?? match.url };
  });
}

async function loadOnce(): Promise<Project[]> {
  const enabled: ConnectorRun[] = CONNECTORS.map((c) => ({
    ...c,
    enabled: config.sources[c.key].enabled,
  }));

  const snapshot = readSnapshot();
  const now = new Date().toISOString();

  const results = await Promise.all(
    enabled.map((run) => runConnector(run, snapshot, now)),
  );

  writeSnapshot(snapshot);
  lastSnapshot = snapshot;

  const sourced = results.flatMap((r) => (r.status === 'empty' ? [] : r.projects));
  const manual = manualToProjects(config);

  // Which slugs have a matching MDX detail page?
  const detailEntries = await getCollection('projects').catch(() => []);
  const detailSlugs = new Set(detailEntries.map((e) => e.id.replace(/\.mdx?$/, '')));

  // Dedupe by id. Priority when a slug appears in multiple sources:
  // manual > github > npm > docker > chrome (last write wins; iterate in
  // reverse priority so manual overwrites others).
  const byId = new Map<string, Project>();
  for (const project of [...sourced.reverse(), ...manual]) {
    byId.set(project.id, project);
  }

  const featuredSlugs = new Set(config.featured);

  const merged = Array.from(byId.values()).map((p) => ({
    ...p,
    featured: p.featured || featuredSlugs.has(p.id),
    hasDetail: detailSlugs.has(p.id),
  }));

  return applyCrossSourceOpenSource(merged);
}

export function loadProjects(): Promise<Project[]> {
  if (!memo) memo = loadOnce();
  return memo;
}

export function getSnapshot(): SnapshotFile | null {
  return lastSnapshot;
}
