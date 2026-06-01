import type { ConnectorResult, ProjectKind } from '../types/project';
import type { ProjectsConfig } from '../types/config';

const VALID_KINDS = new Set<ProjectKind>([
  'app',
  'library',
  'package',
  'cli',
  'extension',
  'mobile',
  'image',
  'other',
]);

function normalizeKind(raw?: string): ProjectKind | undefined {
  if (!raw) return undefined;
  const k = raw.toLowerCase();
  return VALID_KINDS.has(k as ProjectKind) ? (k as ProjectKind) : 'other';
}

/** Manual entries become `manual`-platform origins. Media fields (icon,
 *  banner, screenshots, videos) flow through the same path connector-emitted
 *  media does — including the build-time URL cache when enabled. */
export function manualToResults(config: ProjectsConfig): ConnectorResult[] {
  return config.manual.map((m) => ({
    origin: {
      platform: 'manual',
      id: m.slug,
      url: m.url,
      title: m.title,
      description: m.description,
      firstReleased: m.year,
      tags: m.tags ?? [],
      language: m.language,
      kind: normalizeKind(m.kind),
      openSource: m.openSource ?? !!m.sourceUrl,
      sourceUrl: m.sourceUrl,
      icon: m.icon,
      banner: m.banner,
      screenshots: m.screenshots,
      videos: m.videos,
      stats: {},
    },
  }));
}
