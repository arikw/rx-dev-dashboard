// Persistent snapshot of the most recent successful scrape per connector.
// When a connector fails (network blip, API outage, scrape regression), the
// loader falls back to this file so a single broken source doesn't blank out
// the dashboard.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Project, ProjectSource } from '../types/project';

export type ConnectorKey = Exclude<ProjectSource, 'manual'>;

export type ConnectorSnapshot = {
  /** ISO timestamp of the most recent successful fetch. */
  lastScrapedAt: string;
  projects: Project[];
};

export type SnapshotFile = {
  /** Snapshot schema version — bump on breaking changes. */
  version: 1;
  connectors: Partial<Record<ConnectorKey, ConnectorSnapshot>>;
};

// Resolved relative to cwd (project root when invoked via `npm run`),
// not the module URL — which moves into dist/ after Astro bundles.
const SNAPSHOT_PATH = resolve(process.cwd(), 'data/snapshot.json');

const EMPTY: SnapshotFile = { version: 1, connectors: {} };

export function readSnapshot(): SnapshotFile {
  if (!existsSync(SNAPSHOT_PATH)) return structuredClone(EMPTY);
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SnapshotFile;
    if (parsed.version !== 1 || !parsed.connectors) return structuredClone(EMPTY);
    return parsed;
  } catch (err) {
    console.warn('[snapshot] read failed, starting empty:', err);
    return structuredClone(EMPTY);
  }
}

export function writeSnapshot(snapshot: SnapshotFile): void {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}
