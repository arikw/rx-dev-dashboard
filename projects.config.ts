// projects.config.ts — single source of truth for the dashboard.
//
// Edit this file to customize your dev dashboard. All sources are optional —
// empty handles or extension IDs cause the corresponding source to contribute
// nothing, so a fresh clone builds cleanly and the dashboard grows as you
// fill in handles.
//
// For local testing with real values you don't want to commit, create
// projects.config.local.ts (gitignored) — the loader shallow-merges it over
// this file at build time when present.

import type { ProjectsConfig } from './src/types/config';

const config: ProjectsConfig = {
  deployment: {
    // Public origin (no trailing slash) — where the site is actually served.
    site: 'https://example.com',
    // Path prefix the site is mounted at. Use '/' for root deployments
    // (e.g. projects.example.com) or '/projects' for sub-path deployments.
    base: '/',
    trailingSlash: 'always',
    format: 'directory',
  },

  // Build-time media cache. See README "Build-time media cache" for the
  // full explanation. Default `true` — set `cache: false` to skip the
  // local image / MP4 download and serve upstream URLs verbatim instead.
  media: {
    cache: true,
  },

  meta: {
    siteTitle: 'Dev Projects',
    siteDescription: 'A dev project showcase + impact dashboard.',
    siteTagline: 'A field notebook for tools shipped',
    // Longer site intro, rendered between hero and featured row. Markdown supported.
    // siteAbout: 'A running log of things I\'ve built, packaged, or shipped...',

    // Favicon source. Omit to auto-pick the first available profile avatar
    // (github → stackoverflow → …); set to `false` for no favicon; to a
    // connector key ('github' / 'stackoverflow' / …) to force that source;
    // or to an absolute URL / `/`-prefixed path under `public/`.
    // favicon: 'github',
    // favicon: '/my-avatar.png',

    // PWA manifest fields. The dashboard generates an installable
    // manifest at <base>/manifest.webmanifest from these values plus the
    // resolved favicon (192/512 PNGs via sharp). All optional:
    //   themeColor: browser-chrome / status-bar colour when installed.
    //   backgroundColor: splash screen background on first paint.
    //   shortName: label under the home-screen icon (≤12 chars works best).
    // themeColor: '#1f1f23',
    // backgroundColor: '#ffffff',
    // shortName: 'Dev Projects',
    // Service worker (default true) — required for Android Chrome to build
    // a WebAPK and launch the installed app in standalone mode. iOS Safari
    // honours `display: standalone` without one. Set to false to skip:
    // serviceWorker: false,
  },

  user: {
    name: 'Arik W.',
    github: 'YOUR_GITHUB_HANDLE',
    npm: '',                  // defaults to user.github when empty
    docker: '',               // defaults to user.github when empty
    // Optional author bio rendered at the bottom of the page. Markdown supported.
    // bio: 'Developer with a thing for tooling and CLI ergonomics.',
  },

  sources: {
    github: {
      enabled: true,
      includeForks: false,
      excludeRepos: [],
    },
    npm: {
      enabled: true,
      packages: [],           // empty = fetch all packages by maintainer
    },
    docker: {
      enabled: true,
      repositories: [],       // empty = fetch all repos owned by the user
    },
    chrome: {
      enabled: true,
      extensionIds: [],       // 32-char IDs — shared with the chromestats connector
    },
    gnome: {
      enabled: true,
      extensionIds: [],       // numeric pk from extensions.gnome.org/extension/<pk>/...
    },
    gplay: {
      packages: [],           // Android package names, shared by appbrain + apkpure
    },
    appbrain: { enabled: true },   // Google Play stats (rating, installs) via AppBrain
    apkpure: { enabled: true },    // Google Play listing presence via APKPure
    chromestats: { enabled: true },   // reads the shared sources.chrome.extensionIds
    playstore: {
      enabled: true,
      packages: [],          // Android package names to fetch live from play.google.com
    },
    stackoverflow: {
      enabled: true,
      userId: '',             // numeric SO user id from stackoverflow.com/users/<id>/...
    },
  },

  // Manual authoritative facts, keyed by ORIGIN resource id (find it in
  // generated/snapshot.json — e.g. "google-play:net.example.myapp", a GitHub
  // repo name, "npm:my-pkg"). Injected as an `origin` representation that wins
  // reconciliation over scraped mirrors — e.g. an exact Play Console install
  // total a connector can't reach.
  origins: {
    // Example:
    // 'google-play:net.example.myapp': {
    //   asOf: '2024-01-01',
    //   stats: { installs: { value: 16522, exact: true } },
    // },
  },

  // Project slugs to pin at the top of the page. Works for any source:
  // match by GitHub repo name, npm package name, docker image, chrome slug,
  // or manual entry slug.
  featured: [],

  // Projects without an online source (closed-source, retired, etc.).
  // Personal manual entries (including retired addons surfaced via Wayback
  // snapshots, etc.) belong in projects.config.local.ts — the loader shallow-
  // merges that file's `manual` array over this one at build time. See
  // docs/skills/add-manual-entry.md for the schema and the strict
  // "default to projects.config.local.ts" rule.
  // Optional matching MDX in src/content/projects/<slug>.mdx generates a
  // detail page at /projects/<slug>/.
  manual: [
    // Example only — real entries go in projects.config.local.ts:
    // {
    //   slug: 'internal-workflow-tool',
    //   title: 'Internal Workflow Tool',
    //   description: 'Custom internal tool for batch operations.',
    //   url: 'https://example.com',
    //   tags: ['internal', 'closed-source'],
    //   year: 2023,
    // },
  ],

  ui: {
    pageSize: 12,
    hero: {
      showDownloads: true,
      showUsers: true,
    },
  },
};

export default config;
