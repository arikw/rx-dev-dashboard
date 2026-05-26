import type { Project, ProjectKind } from '../types/project';
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

export function manualToProjects(config: ProjectsConfig): Project[] {
  return config.manual.map((m) => ({
    id: m.slug,
    source: 'manual' as const,
    title: m.title,
    description: m.description,
    url: m.url ?? '',
    tags: m.tags ?? [],
    stats: {},
    language: m.language,
    year: m.year,
    kind: normalizeKind(m.kind),
    openSource: m.openSource ?? !!m.sourceUrl,
    sourceUrl: m.sourceUrl,
    featured: m.featured ?? false,
    hasDetail: false, // set by loader after content collection lookup
  }));
}
