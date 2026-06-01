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
  // Optional matching MDX in src/content/projects/<slug>.mdx generates a
  // detail page at /projects/<slug>/.
  manual: [
    {
      slug: 'back-to-google',
      title: 'Back to Google',
      description:
        "Go back to your last Google results page from your current tab's history list.",
      // Live AMO URL 404s (addon was removed); use the Wayback snapshot
      // so the card's outbound link actually leads somewhere.
      url: 'https://web.archive.org/web/20170912104531/https://addons.mozilla.org/en-US/firefox/addon/back-to-google/',
      source: 'firefox',
      kind: 'extension',
      language: 'JavaScript',
      tags: ['firefox', 'extension', 'browser', 'search', 'productivity'],
      year: 2008,
      asOf: '2017-09-12',
      retired: true,
      icon: 'https://web.archive.org/web/20170909200644im_/https://addons.cdn.mozilla.net/user-media/addon_icons/7/7206-64.png?modified=1281033339',
      screenshots: [
        'https://web.archive.org/web/20170909200644im_/https://addons.cdn.mozilla.net/user-media/previews/full/22/22335.png?modified=1331218902',
      ],
      stats: {
        users: 223,
        downloads: 32239,
        rating: { average: 4.2, count: 15 },
      },
      reviews: [
        {
          rating: 5,
          body: 'Works very well. It even works when you delve into the page you branched off to, [I think because it uses the last search history page.] This saves much time normally taken to find the results tab or reopen the thing. Thank you for this Add-on.',
          ts: '2013-11-05',
          source: 'firefox',
        },
        {
          rating: 4,
          body: 'Great idea, but instead of getting one more icon placed in navigation bar, I would like if right-clicking on home button would do the thing!',
          ts: '2010-12-01',
          source: 'firefox',
        },
        {
          rating: 5,
          body: 'I find this a really useful little add on that I use all the time',
          ts: '2010-10-31',
          source: 'firefox',
        },
        {
          rating: 4,
          body: 'Excellent, use it all the time. Would be even better though if when searching Google images it ignored the frame and went all the way back to the results.',
          ts: '2010-02-02',
          source: 'firefox',
        },
        {
          rating: 5,
          body: 'I downloaded this thinking it could be of use in certain situations. Instead, it became a regular part of viewing google results, like the Search and Back buttons. Good thinking.',
          ts: '2009-07-25',
          source: 'firefox',
        },
        {
          rating: 5,
          body: 'One of the handiest addons I have used. :)',
          ts: '2009-04-20',
          source: 'firefox',
        },
      ],
    },
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
