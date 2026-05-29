export type ProjectSource = 'github' | 'npm' | 'docker' | 'chrome' | 'gnome' | 'manual';

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
  downloadsAllTime?: number;
  downloadsMonthly?: number;
  // docker
  pulls?: number;
  dockerStars?: number;
  // chrome
  users?: number;
  rating?: number;
  ratingCount?: number;
  // gnome (extensions.gnome.org)
  gnomeDownloads?: number;
};

export type Project = {
  /** Canonical slug. Stable across builds. */
  id: string;
  /** Canonical (primary) source. */
  source: ProjectSource;
  /** All sources merged into this card (primary first). Set only by the merge step. */
  sources?: ProjectSource[];
  title: string;
  description: string;
  /** Outbound link (repo, package, store listing, or arbitrary URL for manual entries). */
  url: string;
  tags: string[];
  stats: ProjectStats;
  language?: string;
  /** ISO date string of the most recent update. */
  updatedAt?: string;
  /** First-publication / creation year. Derived per source where available; manual entries set it directly. */
  year?: number;
  /** The project's own website/homepage, distinct from `url` (listing) and `sourceUrl` (repo). */
  homepage?: string;
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
