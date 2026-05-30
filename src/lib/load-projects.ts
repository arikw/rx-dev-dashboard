import { getCollection } from 'astro:content';
import config from './load-config';
import type { ConnectorResult, Project } from '../types/project';
import { fetchGithubProjects } from '../connectors/github';
import { fetchNpmProjects } from '../connectors/npm';
import { fetchDockerProjects } from '../connectors/docker';
import { fetchChromeProjects } from '../connectors/chrome';
import { fetchGnomeProjects } from '../connectors/gnome';
import { fetchAppbrainProjects } from '../connectors/appbrain';
import { fetchApkpureProjects } from '../connectors/apkpure';
import { fetchChromestatsProjects } from '../connectors/chromestats';
import { fetchPlaystoreProjects } from '../connectors/playstore';
import { manualToResults } from '../connectors/manual';
import { buildProjects } from './build-projects';
import type { Connector } from '../connectors/types';
import { readSnapshot, writeSnapshot, type ConnectorKey, type SnapshotFile } from './snapshot-store';

const FIXTURE_MODE = process.env.CONNECTORS_FIXTURE === '1';

type ConnectorRun = { key: ConnectorKey; fn: Connector };

const CONNECTORS: ConnectorRun[] = [
  { key: 'github', fn: fetchGithubProjects },
  { key: 'npm', fn: fetchNpmProjects },
  { key: 'docker', fn: fetchDockerProjects },
  { key: 'chrome', fn: fetchChromeProjects },
  { key: 'gnome', fn: fetchGnomeProjects },
  { key: 'appbrain', fn: fetchAppbrainProjects },
  { key: 'apkpure', fn: fetchApkpureProjects },
  { key: 'chromestats', fn: fetchChromestatsProjects },
  { key: 'playstore', fn: fetchPlaystoreProjects },
];

type ConnectorRunResult =
  | { status: 'fresh' | 'cached'; results: ConnectorResult[] }
  | { status: 'empty' };

let memo: Promise<Project[]> | null = null;
let lastSnapshot: SnapshotFile | null = null;

async function runConnector(
  run: ConnectorRun,
  enabled: boolean,
  snapshot: SnapshotFile,
  now: string,
): Promise<ConnectorRunResult> {
  if (!enabled) {
    const cached = snapshot.connectors[run.key];
    return cached ? { status: 'cached', results: cached.results } : { status: 'empty' };
  }
  try {
    const results = await run.fn(config, { fixtureMode: FIXTURE_MODE });
    snapshot.connectors[run.key] = { lastScrapedAt: now, results };
    return { status: 'fresh', results };
  } catch (err) {
    console.warn(`[loader] connector "${run.key}" failed:`, err);
    const cached = snapshot.connectors[run.key];
    if (cached) {
      console.warn(`[loader] falling back to cached "${run.key}" data from ${cached.lastScrapedAt}`);
      return { status: 'cached', results: cached.results };
    }
    return { status: 'empty' };
  }
}

/** Manual authoritative origin facts from config.origins (e.g. Play Console totals). */
function manualOrigins(): ConnectorResult[] {
  const out: ConnectorResult[] = [];
  for (const [resourceId, fact] of Object.entries(config.origins ?? {})) {
    const idx = resourceId.indexOf(':');
    if (idx < 0) continue;
    out.push({
      origin: {
        platform: resourceId.slice(0, idx),
        id: resourceId.slice(idx + 1),
        url: fact.url,
        asOf: fact.asOf,
        stats: fact.stats,
      },
    });
  }
  return out;
}

async function loadOnce(): Promise<Project[]> {
  const snapshot = readSnapshot();
  const now = new Date().toISOString();

  const results = await Promise.all(
    CONNECTORS.map((run) => runConnector(run, config.sources[run.key].enabled, snapshot, now)),
  );
  writeSnapshot(snapshot);
  lastSnapshot = snapshot;

  const connectorResults = results.flatMap((r) => (r.status === 'empty' ? [] : r.results));
  const all = [...connectorResults, ...manualToResults(config), ...manualOrigins()];

  const built = buildProjects(all);

  // Which slugs have a matching MDX detail page?
  const detailEntries = await getCollection('projects').catch(() => []);
  const detailSlugs = new Set(detailEntries.map((e) => e.id.replace(/\.mdx?$/, '')));
  const featuredSlugs = new Set([
    ...config.featured,
    ...config.manual.filter((m) => m.featured).map((m) => m.slug),
  ]);

  return built.map((p) => ({
    ...p,
    featured: featuredSlugs.has(p.id),
    hasDetail: detailSlugs.has(p.id),
  }));
}

export function loadProjects(): Promise<Project[]> {
  if (!memo) memo = loadOnce();
  return memo;
}

export function getSnapshot(): SnapshotFile | null {
  return lastSnapshot;
}
