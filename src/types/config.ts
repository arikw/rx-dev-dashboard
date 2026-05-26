export type ManualProject = {
  slug: string;
  title: string;
  description: string;
  url?: string;
  tags?: string[];
  year?: number;
  featured?: boolean;
  language?: string;
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
  };
  /** Project slugs to pin at the top of the page. */
  featured: string[];
  /** Projects without an online source (closed-source, retired, etc.). */
  manual: ManualProject[];
  ui: {
    /** Cards shown before "Show more" reveals the next batch. */
    pageSize: number;
    hero: {
      showAllTimeInstalls: boolean;
      showMonthlyReach: boolean;
    };
  };
};
