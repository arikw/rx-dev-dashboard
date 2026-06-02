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

/** Manual entries become `manual`-platform origins. Every optional field on
 *  ManualProject is passed through to the rep, so a manual project carries
 *  the same shape (stats, reviews, asOf, archived, media, …) as anything a
 *  connector emits. */
export function manualToResults(config: ProjectsConfig): ConnectorResult[] {
  return config.manual.map((m) => ({
    origin: {
      // Default platform 'manual' (chip reads "Portfolio"). When the entry
      // declares `source`, use that string instead — same value drives the
      // chip label via sourceLabel(), with an auto-capitalised fallback
      // for keys that aren't registered as connectors.
      platform: m.source ?? 'manual',
      id: m.slug,
      url: m.url,
      asOf: m.asOf,
      title: m.title,
      description: m.description,
      firstReleased: m.year,
      tags: m.tags ?? [],
      language: m.language,
      kind: normalizeKind(m.kind),
      openSource: m.openSource ?? !!m.sourceUrl,
      archived: m.archived,
      retired: m.retired,
      relatesToProjectId: m.relatesToProjectId,
      sourceUrl: m.sourceUrl,
      homepage: m.homepage,
      icon: m.icon,
      banner: m.banner,
      screenshots: m.screenshots,
      videos: m.videos,
      thumbFit: m.thumbFit,
      thumbBg: m.thumbBg,
      reviews: m.reviews,
      stats: m.stats ?? {},
    },
  }));
}
