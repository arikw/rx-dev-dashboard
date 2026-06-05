export type ProjectSource =
  | 'github'
  | 'npm'
  | 'docker'
  | 'chrome'
  | 'gnome'
  | 'appbrain'
  | 'apkpure'
  | 'chromestats'
  | 'extpose'
  | 'playstore'
  | 'stackoverflow'
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
 *  - `rating` — reconciled within a single origin (mirrors all describe the
 *    same audience, so the best signal wins); summed across DIFFERENT origin
 *    resources (e.g. a Firefox port + a Chrome port merged via
 *    `relatesToProjectId` — those are distinct audiences). Histograms combine
 *    element-wise, averages become count-weighted means.
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
  /** Store rating. Reconciled within an origin bucket (mirrors of the same
   *  audience — the highest-count signal wins); summed across separate
   *  origin resources (distinct audiences — see `CanonicalStats` doc above).
   *  `histogram` yields "likes".
   *
   *  - `average` — the rating value on the source's own scale (e.g. 4.2 on
   *    a 5-star site, 8.5 on a 10-point one).
   *  - `count` — optional; some sources publish only an average.
   *  - `histogram` — optional per-step breakdown. Length is the scale top:
   *    a 5-star source emits 5 entries (1★..5★), a 10-point source emits
   *    10 entries. The "positive" tail is the top 20% of the scale.
   *  - `max` — scale top (default 5). Set explicitly when the source uses
   *    a non-5 scale so the "likes" estimator interprets `average` /
   *    `histogram` correctly. */
  rating?: { average: number; count?: number; histogram?: number[]; max?: number };
};

/** Aggregate "I exist over there" metric from a profile source (Stack Overflow,
 *  GitHub-as-a-person, dev.to, …). Emitted by data-only connectors and
 *  rendered in the ProfilePresence strip below the hero — *not* as a card.
 *
 *  Distinct from a Project: there's no thing being shipped, just a person's
 *  presence + a number or two summarising it. */
export type ProfileFact = {
  /** Source key — matches the emitting connector's manifest key. */
  source: string;
  /** Outbound link to the profile. */
  url: string;
  /** Friendly label. Mirror-of-origin style isn't used here — profile sources
   *  are always standalone. */
  label: string;
  /** Headline metric — surfaced prominently (reputation, follower count, …). */
  headline: { value: number | string; label: string };
  /** Secondary details — small chips beside the headline (badges, repo count).
   *  Set `iconBefore` when the label is an icon glyph (e.g. `★`) that should
   *  precede the value instead of following it, matching the card-stats
   *  style `★ 339`. */
  details?: Array<{ label: string; value: number | string; iconBefore?: boolean }>;
  /** Profile avatar / photo URL. Used by AuthorBio to render the dashboard
   *  owner's portrait. Connectors that surface a public profile image
   *  (GitHub's avatar_url, Stack Overflow's profile_image) populate this when
   *  available; the config field `user.profileImage` chooses which to use. */
  avatar?: string;
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
  /** How the card's thumb image should fit its frame. `'cover'` (default)
   *  fills the frame and crops what overflows; `'contain'` scales the
   *  whole image to fit, leaving margins filled by `thumbBg`. Useful for
   *  J2ME phone screenshots and other already-letterboxed art that would
   *  look weird cropped. */
  thumbFit?: 'cover' | 'contain';
  /** Background colour rendered behind the thumb when `thumbFit: 'contain'`
   *  leaves empty space. Any CSS colour string. */
  thumbBg?: string;
  reviews?: Review[];
  tags?: string[];
  kind?: ProjectKind;
  language?: string;
  /** Content language code (e.g. 'he'). Connectors only set this
   *  when their heuristic explicitly identifies a non-default language;
   *  leaving it undefined means "treat as English" at the UI layer. */
  contentLanguage?: string;
  /** Whether this representation's project is open source. */
  openSource?: boolean;
  /** Source flagged as archived (e.g. GitHub repo archived). Any archived
   * rep in a merged group causes the whole project to be dropped. */
  archived?: boolean;
  /** Explicit "this rep is the same project as <other rep's id>" pointer(s).
   * The builder uses these to merge cross-platform ports that don't share
   * a URL / homepage / slug — e.g. a manual Firefox-addon entry pointing
   * at the Chrome extension id so the two cards collapse into one. Plain
   * ids (just the right-hand side of `origin.id`) or `platform:id` forms
   * are both accepted; the builder matches against any other rep's
   * `origin.id` OR `platform:id`. */
  relatesToProjectId?: string | string[];
  /** Project lives on as a manual / historical entry but is no longer in
   * active service. Card stays in the grid (unlike `archived`), but
   * `stats.users` is treated as historical: aggregateStats won't add it
   * to the hero's "Active users" total. Set on a manual entry for a
   * retired addon / removed listing whose user count belongs to a past
   * snapshot. */
  retired?: boolean;
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
  /** Per source-group URL for clickable source chips. For chrome the live
   * CWS listing wins; falls back to the chrome-stats mirror page when the
   * extension's been removed. Keyed by source-group (e.g. 'chrome',
   * 'android', 'github', 'npm'), not the raw rep platform. */
  sourceUrls: Record<string, string>;
  title: string;
  description: string;
  /** Outbound link (origin/primary). */
  url: string;
  tags: string[];
  /** Combined canonical metrics (reconciled + summed). */
  stats: CanonicalStats;
  language?: string;
  /** Content language code (e.g. 'he'). Undefined when no
   *  representation tagged one — the UI treats this as English. */
  contentLanguage?: string;
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
  /** Thumb-image fit (`'cover'` or `'contain'`). See `Representation.thumbFit`. */
  thumbFit?: 'cover' | 'contain';
  /** Backplate colour for `thumbFit: 'contain'`. See `Representation.thumbBg`. */
  thumbBg?: string;
  /** All collected reviews — for future "positive reviews" rotators etc. */
  reviews?: Review[];
  kind?: ProjectKind;
  openSource?: boolean;
  /** Canonical source-repo URL when known. */
  sourceUrl?: string;
  /** Project's no longer in active service (manual entry of a retired
   * addon, removed listing, etc.). aggregateStats excludes `stats.users`
   * from the active-user total for retired projects so historical
   * snapshots don't inflate the headline. */
  retired?: boolean;
  featured: boolean;
  hasDetail: boolean;
};
