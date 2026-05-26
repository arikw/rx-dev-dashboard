export type ProjectSource = 'github' | 'npm' | 'docker' | 'chrome' | 'manual';

export type ProjectKind =
  | 'app'
  | 'library'
  | 'package'
  | 'cli'
  | 'extension'
  | 'mobile'
  | 'image'
  | 'other';

export type ProjectStats = {
  // github
  stars?: number;
  forks?: number;
  // npm
  downloadsLastYear?: number;
  downloadsMonthly?: number;
  downloadsWeekly?: number;
  // docker
  pulls?: number;
  dockerStars?: number;
  // chrome
  users?: number;
  rating?: number;
  ratingCount?: number;
};

export type Project = {
  /** Canonical slug. Stable across builds. */
  id: string;
  source: ProjectSource;
  title: string;
  description: string;
  /** Outbound link (repo, package, store listing, or arbitrary URL for manual entries). */
  url: string;
  tags: string[];
  stats: ProjectStats;
  language?: string;
  /** ISO date string. */
  updatedAt?: string;
  /** Year for manual entries that don't have a source-side updated date. */
  year?: number;
  /** Optional thumbnail/image URL. When absent, the card renders a generated SVG fallback. */
  image?: string;
  /** Coarse project type. Derived per source + topics; manual entries can override. */
  kind?: ProjectKind;
  /** True when the project has a publicly accessible source repository. */
  openSource?: boolean;
  /** Canonical source-repo URL when known (set by github directly or cross-source match). */
  sourceUrl?: string;
  featured: boolean;
  /** Whether a matching MDX file in src/content/projects/ produces a detail page. */
  hasDetail: boolean;
};
