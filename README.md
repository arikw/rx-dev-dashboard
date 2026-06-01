# rx-dev-dashboard

Config-driven dev dashboard and project showcase. Built with [Astro](https://astro.build/), publishable to GitHub Pages or any other static host.

Pulls public signals from **GitHub**, **npm**, **Docker Hub**, and **Chrome Web Store** at build time, merges them with manual entries you control, and renders an "impact dashboard" plus a project grid with tag filtering.

Designed to be cloned — edit one config file, push, and you have your own.

## Quick start

```bash
git clone https://github.com/<your-user>/rx-dev-dashboard.git
cd rx-dev-dashboard
npm install
npm run dev
```

Edit `projects.config.ts` to point at your own handles, then refresh.

## Set up your own dashboard

The fastest path to a working dashboard on your domain:

### 1. Fork this repo

Click **Fork** on this repo's GitHub page.

### 2. Enable Actions on your fork

GitHub disables Actions on forks by default. Turn them on:

- **Web UI:** go to your fork's **Actions** tab → click **I understand my workflows, go ahead and enable them**.
- **CLI:** `gh api -X PUT repos/<your-user>/<your-fork>/actions/permissions -F enabled=true`

### 3. Edit `projects.config.ts`

The whole dashboard is driven from this one file:

- `deployment.site` — the public origin where your site lives (e.g. `https://yourname.dev`)
- `deployment.base` — the path prefix (`'/'` for root deployments, `'/projects'` for sub-path)
- `user.github`, `user.npm`, `user.docker` — your handles for each source (`npm` and `docker` default to `github` when left empty)
- `sources.chrome.extensionIds` — 32-char IDs from your Chrome Web Store listing URLs
- `featured` — slugs to pin at the top of the page
- `manual` — projects without an online source (closed-source, retired, etc.)

Any source you leave empty or disable just contributes nothing — connectors degrade gracefully.

### 4. Enable GitHub Pages

Settings → Pages → Source: **GitHub Actions**.

### 5. Push (or trigger manually)

Push to the default branch — the workflow builds and deploys. A daily cron at 08:00 UTC also rebuilds so source-fetched stats stay fresh without manual pushes.

To trigger a one-off build without pushing: Actions tab → **Deploy** → **Run workflow**.

> Prefer a standalone repo over a fork? **Use this template → Create a new repository** also works — that path skips step 2 (Actions are enabled by default on template-created repos).

## Inspecting connector data

Two views into what each connector returned and when:

- **`/data.json`** — emitted on every build at the site root (e.g. `https://yoursite.example/data.json`). Includes the merged project list plus a per-connector snapshot.
- **`generated/snapshot.json`** — the persisted snapshot. Gitignored locally; the scheduled workflow commits it back to the repo as a durable backup (visible in the repo browser).

Each connector's snapshot includes a `lastScrapedAt` timestamp. If a source fails on the next run (API outage, rate limit, scrape regression), the loader falls back to that connector's most recent successful scrape — only the affected source goes stale, never the whole dashboard.

## Adding a new connector

See **[docs/connectors.md](docs/connectors.md)** for the connector manifest pattern, folder layout, brand-mark setup, URL extractors, mirror relationships, and per-connector config. Connectors are auto-discovered — adding one is a single new folder under `src/connectors/`.

## Adding a manual entry

See **[docs/skills/add-manual-entry.md](docs/skills/add-manual-entry.md)** for the two shapes of manual entry the config accepts — a `ManualProject` for projects no connector covers (closed-source / retired / not-on-any-platform) and a `ManualOrigin` for authoritative overrides of scraped numbers.

The file lives under [`docs/skills/`](docs/skills/) — a tool-agnostic home for short, action-oriented walkthroughs an AI assistant (Claude, Cursor, Cline, GitHub Copilot Chat, …) or a human contributor can follow. Each skill has YAML frontmatter for machine readability and a markdown body for the actual steps.

## Caching external media

The build downloads connector-referenced images and MP4 videos into a local cache under `public/_cache/<connector>/` and rewrites Project / ProfileFact image URLs at build time to the local copies. The raw scrape under `generated/.cache/<connector>/data.json` keeps the original upstream URLs so the snapshot stays diagnosable. See **[docs/skills/cache-media.md](docs/skills/cache-media.md)** for the cache layout, the url-map shape, and patterns for extending the cache (e.g. downloading YouTube trailers via `yt-dlp` and pointing the map at the local MP4).

## Advanced: keep some values out of git

If you want some config values to live outside the committed file (e.g. handles you'd rather not put in a public repo, or a different deployment URL when testing locally), create `projects.config.local.ts` next to `projects.config.ts`:

```ts
import baseConfig from './projects.config';

export default {
  ...baseConfig,
  user: {
    ...baseConfig.user,
    github: 'your-handle',
  },
};
```

The file is `.gitignored`. The loader shallow-merges it over `projects.config.ts` at build time when present, so you can override any subtree.

Most cloners don't need this — editing `projects.config.ts` directly and committing is the normal path.

## Advanced: higher GitHub API rate limit

Optional. The workflow uses the auto-injected `GITHUB_TOKEN` by default, which gives you 1000 requests/hour — enough for typical accounts (one paged request per build).

If you have a very large account or hit rate limits, create a personal access token with `public_repo` read access and add it as a repo secret named **`GH_API_TOKEN`**. The workflow prefers it over the auto-injected token when present (bumps the limit to 5000 req/hr).

## Commands

```bash
npm run dev               # local dev server
npm run build             # → dist/  +  generated/snapshot.json
npm run preview           # serve dist/ locally
```

## Layout

```
.
├── astro.config.mjs                reads deployment.site/base from projects.config.ts
├── projects.config.ts              single source of truth (config-driven)
├── generated/snapshot.json         persisted per-connector results (gitignored locally;
│                                   workflow commits it back as a backup)
├── src/
│   ├── content.config.ts           Zod schema for optional detail pages
│   ├── content/projects/           optional detail .mdx files (one per project slug)
│   ├── connectors/                 github, npm, docker, chrome, manual + shared types
│   ├── lib/                        load-config, load-projects, snapshot-store, aggregate-stats, fixtures
│   ├── components/                 BaseHead, Hero, Stat, ProjectCard, ProjectGrid, FeaturedRow, TagFilter
│   ├── layouts/                    BaseLayout
│   ├── pages/
│   │   ├── index.astro             the showcase
│   │   └── data.json.ts            machine-readable snapshot + project list
│   ├── styles/                     global CSS
│   ├── types/                      Project, ProjectsConfig types
│   └── utils/
├── tests/fixtures/                 connector fixtures for offline builds
└── .github/workflows/deploy.yml    build + Pages deploy with snapshot cache and commit-back
```
