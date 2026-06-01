import type { CanonicalStats, Review } from './project';

/** A manual, authoritative origin fact injected by the builder, keyed by origin
 * resource id (e.g. "google-play:net.wzmn.games.brokencalc"). It enters the
 * reconcile as an `origin` representation, so it wins over scraped mirrors —
 * e.g. an exact Play Console install total or a real first-release year the
 * connectors can't reach. */
export type ManualOrigin = {
  url?: string;
  asOf?: string;
  firstReleased?: number;
  stats?: CanonicalStats;
};

export type ManualProject = {
  slug: string;
  title: string;
  description: string;
  url?: string;
  tags?: string[];
  year?: number;
  featured?: boolean;
  language?: string;
  /** Project type. Free-form but `app | library | package | cli | extension | mobile | image | other` are recognized. */
  kind?: string;
  /** True/false explicitly. When omitted, `sourceUrl` presence implies `true`. */
  openSource?: boolean;
  /** Canonical source-repo URL. */
  sourceUrl?: string;
  /** The project's own website (separate from `url`, which is the outbound
   *  listing link). Drives the homepage chip in the same way connector-
   *  emitted reps do. */
  homepage?: string;
  /** Square app/extension icon URL — drives the icon-frame card layout when
   *  no banner/screenshots accompany it. Same constraints as connector-
   *  emitted icons; URLs flow through the media cache when enabled (see
   *  README "Build-time media cache"). */
  icon?: string;
  /** Wide promotional banner URL (e.g. screenshot/marketing tile). When
   *  present, drives the banner card layout. */
  banner?: string;
  /** Phone/screen capture URLs surfaced alongside the project (renders the
   *  screenshot+icon stack layout when paired with `icon`). */
  screenshots?: string[];
  /** Trailer / demo video URLs. Direct `.mp4` URLs get cached locally;
   *  YouTube embed URLs (`https://www.youtube.com/embed/<id>?…`) pass
   *  through to the dashboard as upstream embeds. */
  videos?: string[];
  /** Where this project lived. Drives the card's source-chip label.
   *  Omit (default) → chip reads "Portfolio".
   *  Set to a known connector key (`'github'` / `'chrome'` / `'npm'` /
   *  `'docker'` / `'gnome'` / `'stackoverflow'`, etc.) → chip reads that
   *  connector's brand label.
   *  Set to any other short lowercase key (e.g. `'firefox'`, `'edge'`,
   *  `'wordpress'`) → chip reads the auto-capitalised form ("Firefox",
   *  "Edge", "Wordpress"). */
  source?: string;
  /** Stars / downloads / users / rating numbers scraped from a listing.
   *  Same shape connector-emitted reps use; surfaced on the card next to
   *  every other project's stats. See `CanonicalStats` in
   *  `src/types/project.ts` for the per-field semantics. */
  stats?: CanonicalStats;
  /** User reviews (no author PII). Same shape connector-emitted reps use;
   *  fed into the homepage review carousel if they pass the positive /
   *  language filter. */
  reviews?: Review[];
  /** ISO date marking when the data in this entry was last verified —
   *  drives the reconcile (freshest wins) and shows up as the "as of"
   *  date on the card when present. Use the page's snapshot/archive date
   *  if you scraped one (e.g. Wayback Machine snapshot timestamp). */
  asOf?: string;
  /** Mark this project as archived. Archived projects are DROPPED from the
   *  grid entirely (same as `archived: true` on a connector rep). Use this
   *  to hide a project without deleting the entry. */
  archived?: boolean;
  /** Mark this project as retired but still worth showing. Card stays in
   *  the grid; the hero's "Active users" total excludes its `stats.users`
   *  so a stale snapshot count doesn't inflate the headline. Use for
   *  removed Chrome / Firefox / Edge extensions, taken-down listings,
   *  apps whose store page is dead but whose history matters. */
  retired?: boolean;
};

export type GithubSourceConfig = {
  enabled: boolean;
  includeForks: boolean;
  /** Repo names to omit from the dashboard. */
  excludeRepos: string[];
};

export type NpmSourceConfig = {
  enabled: boolean;
  /** Explicit package list. Empty = fetch everything by maintainer. */
  packages: string[];
};

export type DockerSourceConfig = {
  enabled: boolean;
  /** Explicit repo list. Empty = fetch everything owned by the user. */
  repositories: string[];
};

export type ChromeSourceConfig = {
  enabled: boolean;
  /** Chrome Web Store extension IDs (32-char strings from the listing URL). */
  extensionIds: string[];
};

export type GnomeSourceConfig = {
  enabled: boolean;
  /** Numeric extension IDs (the `pk` in extensions.gnome.org/extension/<pk>/...). */
  extensionIds: number[];
};

export type GplaySourceConfig = {
  /** Android package names (e.g. "com.example.app"), shared by the AppBrain
   * and APKPure connectors. This is just the input list — not a connector. */
  packages: string[];
};

/** AppBrain connector — rich Google Play stats (rating, installs). */
export type AppbrainSourceConfig = { enabled: boolean };

/** APKPure connector — Google Play listing presence + mirror link. */
export type ApkpureSourceConfig = { enabled: boolean };

/** chrome-stats.com — third-party Chrome Web Store mirror; carries extensions
 * that have been taken down from CWS and richer per-extension intel. Reads
 * `sources.chrome.extensionIds` — one shared list, like AppBrain + APKPure
 * sharing `sources.gplay.packages`. */
export type ChromeStatsSourceConfig = { enabled: boolean };

/** Google Play Store live listing — origin for apps that are still available. */
export type PlaystoreSourceConfig = {
  enabled: boolean;
  /** Android package names (e.g. "com.example.app"). */
  packages: string[];
};

/** Stack Overflow — surfaces a single card representing the user's profile
 * (reputation, answer count, badges). One `userId` per profile. */
export type StackoverflowSourceConfig = {
  enabled: boolean;
  /** Numeric SO user id (the `<id>` in stackoverflow.com/users/<id>/...). */
  userId: string;
};

export type DeploymentConfig = {
  /** Absolute origin where the site is served (no trailing slash). */
  site: string;
  /** Path prefix the site is mounted at. Use `'/'` for root deployments. */
  base: string;
  /** Astro `trailingSlash` setting. */
  trailingSlash?: 'always' | 'never' | 'ignore';
  /** Astro `build.format` setting. */
  format?: 'file' | 'directory' | 'preserve';
};

/** Build-time media handling — local cache of images and MP4 videos that
 * connectors reference. See `projects.config.ts` for the operator-facing
 * documentation. */
export type MediaConfig = {
  /** When true (default), connector-emitted image / mp4 URLs are downloaded
   *  into `public/_cache/<connector>/` and the dashboard rewrites Project /
   *  ProfileFact URLs to the local copies. When false, the build skips the
   *  download + rewrite step entirely and the dashboard serves upstream
   *  URLs directly — faster builds, no local cache committed by CI, but
   *  every page render hits the upstream CDNs and the site breaks if
   *  upstream link-rots. */
  cache?: boolean;
};

export type ProjectsConfig = {
  deployment: DeploymentConfig;
  /** Build-time media handling. Optional — sensible defaults apply when omitted. */
  media?: MediaConfig;
  meta: {
    siteTitle: string;
    siteDescription: string;
    /** Short kicker shown above the hero. */
    siteTagline?: string;
    /** Longer site introduction rendered between hero and featured row. Markdown. */
    siteAbout?: string;
  };
  user: {
    name: string;
    github: string;
    /** Defaults to user.github when empty. */
    npm: string;
    /** Defaults to user.github when empty. */
    docker: string;
    /** Optional short author bio rendered at the bottom of the page. Markdown. */
    bio?: string;
    /** Profile image (avatar) source.
     *   - `undefined` (default): auto — use the first available avatar from a
     *     profile connector in manifest order (typically github first, then
     *     stackoverflow, etc.).
     *   - `false`: don't render an avatar at all.
     *   - a connector key like `'github'` or `'stackoverflow'`: use that
     *     source's avatar.
     *   - any `http(s)://…` URL: use it directly (host your own portrait). */
    profileImage?: false | string;
  };
  sources: {
    github: GithubSourceConfig;
    npm: NpmSourceConfig;
    docker: DockerSourceConfig;
    chrome: ChromeSourceConfig;
    gnome: GnomeSourceConfig;
    gplay: GplaySourceConfig;
    appbrain: AppbrainSourceConfig;
    apkpure: ApkpureSourceConfig;
    chromestats: ChromeStatsSourceConfig;
    playstore: PlaystoreSourceConfig;
    stackoverflow: StackoverflowSourceConfig;
  };
  /** Tag filter behaviour. */
  tags?: {
    /** Max chips shown before the "More tags" toggle (default 8). */
    topN?: number;
    /** Hide tags used by fewer than this many projects (default 1). */
    minCount?: number;
    /** Tag names to exclude entirely (case-insensitive). */
    exclude?: string[];
  };
  /** Manual authoritative facts, keyed by origin resource id
   * (e.g. "google-play:net.wzmn.games.brokencalc"). Injected as an `origin`
   * representation that wins reconciliation over scraped mirrors — e.g. an
   * exact Play Console install total. See {@link ManualOrigin}. */
  origins?: Record<string, ManualOrigin>;
  /** Project slugs to pin at the top of the page. */
  featured: string[];
  /** Projects without an online source (closed-source, retired, etc.). */
  manual: ManualProject[];
  ui: {
    /** Cards shown before "Show more" reveals the next batch. */
    pageSize: number;
    hero: {
      /** Show the "Downloads & pulls" stat (npm all-time + Docker pulls). */
      showDownloads: boolean;
      /** Show the "Active users" stat (Chrome current users). */
      showUsers: boolean;
    };
  };
};
