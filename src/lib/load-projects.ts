import { getCollection } from 'astro:content';
import config from './load-config';
import type { Project } from '../types/project';
import { fetchGithubProjects } from '../connectors/github';
import { fetchNpmProjects } from '../connectors/npm';
import { fetchDockerProjects } from '../connectors/docker';
import { fetchChromeProjects } from '../connectors/chrome';
import { fetchGnomeProjects } from '../connectors/gnome';
import { manualToProjects } from '../connectors/manual';
import { mergeProjects } from './merge-projects';
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
  { key: 'gnome', enabled: false, fn: fetchGnomeProjects },
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

  const featuredSlugs = new Set(config.featured);

  // Resolve featured/hasDetail per source-project first (by its own id), then
  // merge same-project-across-sources into one card (those flags get OR-ed).
  const resolved = [...sourced, ...manual].map((p) => ({
    ...p,
    featured: p.featured || featuredSlugs.has(p.id),
    hasDetail: detailSlugs.has(p.id),
  }));

  return mergeProjects(resolved);
}

export function loadProjects(): Promise<Project[]> {
  if (!memo) memo = loadOnce();
  return memo;
}

export function getSnapshot(): SnapshotFile | null {
  return lastSnapshot;
}
