import type { ProjectStats } from './project';

/** A builder-level patch applied to a project's snapshot entry by id. It's a
 * subset of that project's stats, plus `installsExact` to mark an overridden
 * install count as exact (`true`, drops the "+") or an approximate floor
 * (`false`, keeps the "+"). */
export type ProjectOverride = Partial<ProjectStats> & { installsExact?: boolean };

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

export type ProjectsConfig = {
  deployment: DeploymentConfig;
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
  /** Builder-level overrides, keyed by a project's snapshot-entry id
   * (e.g. "appbrain:brokencalc"). The connectors write raw data to the
   * snapshot; these patches are applied at build time — e.g. an exact Play
   * Console install total the connectors can't reach. See {@link ProjectOverride}. */
  overrides?: Record<string, ProjectOverride>;
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
