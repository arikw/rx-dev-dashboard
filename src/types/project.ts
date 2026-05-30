export type ProjectSource =
  | 'github'
  | 'npm'
  | 'docker'
  | 'chrome'
  | 'gnome'
  | 'appbrain'
  | 'apkpure'
  | 'chromestats'
  | 'playstore'
  | 'manual';

export type ProjectKind =
  | 'app'
  | 'library'
  | 'package'
  | 'cli'
  | 'extension'
  | 'mobile'
  | 'image'
  | 'other';

/**
 * Source-agnostic metrics. Every connector maps its own vocabulary into this
 * set (Docker "pulls" → `downloads`, GNOME extension downloads → `downloads`,
 * etc.) so the builder never has to know per-connector field names.
 *
 * Additivity (how the builder combines a metric across a project's sources):
 *  - `stars`, `forks`, `downloads`, `installs`, `users` — additive (summed).
 *  - `rating` — NOT additive (reconciled to one for display); its histogram
 *    yields the summable "likes" (4–5★ count).
 */
export type CanonicalStats = {
  /** Favorites / endorsements (GitHub stars, Docker Hub stars). */
  stars?: number;
  /** GitHub forks (card-only). */
  forks?: number;
  /** Cumulative fetch/download events (npm, Docker pulls, GNOME, mirror channels). */
  downloads?: number;
  /** Recent download rate, last 30 days (npm) — point-in-time, card-only. */
  downloadsMonthly?: number;
  /** Unique app installs (Google Play). `exact:false` = a tier floor like "10,000+". */
  installs?: { value: number; exact: boolean };
  /** Current active installs / users (Chrome Web Store). */
  users?: number;
  /** Store rating. Reconciled, never summed; `histogram` (1★..5★) yields "likes". */
  rating?: { average: number; count: number; histogram?: number[] };
};

/** A user review on a third-party source (no author PII captured). */
export type Review = {
  rating?: number;
  body: string;
  /** ISO date / timestamp string. */
  ts?: string;
  /** Platform that supplied this review (e.g. 'chrome-stats', 'appbrain'). */
  source?: string;
};

/**
 * One source's view of a project. The same project can be described by several
 * representations across connectors, each tagged by role:
 *  - origin: the authoritative upstream source (GitHub repo, the Play listing).
 *  - mirror: a replicated/rehosted copy of an origin (AppBrain/APKPure of Play).
 *  - native: data the reporting platform created itself (a mirror's own downloads).
 */
export type Representation = {
  /** Platform identifier: 'github' | 'npm' | 'google-play' | 'appbrain' | … */
  platform: string;
  /** Stable id of the project on this platform (repo name, package, package-name…). */
  id?: string;
  /** Outbound link to this representation. */
  url?: string;
  /** ISO date of this representation's data — drives the reconcile (freshest wins). */
  asOf?: string;
  title?: string;
  description?: string;
  /** First-publication year. */
  firstReleased?: number;
  /** Wide promotional art (e.g. Chrome Web Store marquee). One per rep. */
  banner?: string;
  /** Square app/extension icon. */
  icon?: string;
  /** Phone/screen captures of the running product. */
  screenshots?: string[];
  videos?: string[];
  reviews?: Review[];
  tags?: string[];
  kind?: ProjectKind;
  language?: string;
  /** Whether this representation's project is open source. */
  openSource?: boolean;
  /** Source flagged as archived (e.g. GitHub repo archived). Any archived
   * rep in a merged group causes the whole project to be dropped. */
  archived?: boolean;
  /** Canonical source-repo URL, when known. */
  sourceUrl?: string;
  /** The project's own website, distinct from `url`. */
  homepage?: string;
  stats?: CanonicalStats;
};

/** What a connector returns to the builder for each project it found. */
export type ConnectorResult = {
  origin?: Representation;
  mirror?: Representation;
  native?: Representation;
};

/** The merged, rendered project card the UI consumes. */
export type Project = {
  /** Canonical slug, stable across builds. */
  id: string;
  /** Distinct platforms the project lives on (for source chips) — origin +
   * native platforms, e.g. ['github'] or ['google-play','apkpure']. */
  sources: string[];
  title: string;
  description: string;
  /** Outbound link (origin/primary). */
  url: string;
  tags: string[];
  /** Combined canonical metrics (reconciled + summed). */
  stats: CanonicalStats;
  language?: string;
  /** ISO date of the most recent update. */
  updatedAt?: string;
  /** First-publication / creation year (min across sources). */
  year?: number;
  /** The project's own website, distinct from `url`. */
  homepage?: string;
  /** Wide hero artwork, when any rep supplies one. */
  banner?: string;
  /** Square app/extension icon, when any rep supplies one. */
  icon?: string;
  /** Dominant colour extracted from the icon — used as the icon-only thumb's
   * backplate tint so each card's backdrop reflects its own art. */
  iconColor?: string;
  /** All screenshots collected across origins/mirrors/natives. */
  screenshots?: string[];
  videos?: string[];
  /** All collected reviews — for future "positive reviews" rotators etc. */
  reviews?: Review[];
  kind?: ProjectKind;
  openSource?: boolean;
  /** Canonical source-repo URL when known. */
  sourceUrl?: string;
  featured: boolean;
  hasDetail: boolean;
};
