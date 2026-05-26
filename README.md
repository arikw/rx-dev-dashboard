# rx-dev-dashboard

Config-driven dev dashboard and project showcase. Built with [Astro](https://astro.build/), publishable to GitHub Pages or any other static host.

Pulls public signals from **GitHub**, **npm**, **Docker Hub**, and **Chrome Web Store** at build time, merges them with manual entries you control, and renders an "impact dashboard" plus a project grid with tag filtering.

Designed to be cloned — edit one config file, set one repo secret, push, and you have your own.

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

### 4. Add a `GH_API_TOKEN` repo secret

Settings → Secrets and variables → Actions → New repository secret. Create one named **`GH_API_TOKEN`** containing a [personal access token](https://github.com/settings/tokens) with `public_repo` read access.

This bumps the GitHub connector from 60 to 5000 requests/hour. Builds still work without it but may rate-limit on larger accounts.

### 5. Enable GitHub Pages

Settings → Pages → Source: **GitHub Actions**.

### 6. Push (or trigger manually)

Push to the default branch — the workflow builds and deploys. A daily cron at 08:00 UTC also rebuilds so source-fetched stats stay fresh without manual pushes.

To trigger a one-off build without pushing: Actions tab → **Deploy** → **Run workflow**.

> Prefer a standalone repo over a fork? **Use this template → Create a new repository** also works — that path skips step 2 (Actions are enabled by default on template-created repos).

## Inspecting connector data

Every build emits `data.json` at the site root (e.g. `https://yoursite.example/data.json`) with the merged project list and a per-connector snapshot of what each source returned and when. Useful for debugging connector output and verifying tags/stats.

Each connector's snapshot is persisted across builds. If a source fails on the next run (API outage, rate limit, regex regression), the loader falls back to the most recent successful scrape for that source — only the affected connector goes stale, never the whole dashboard.

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

## Commands

```bash
npm run dev               # local dev server
npm run build             # → dist/
npm run preview           # serve dist/ locally
```

## Layout

```
.
├── astro.config.mjs                reads deployment.site/base from projects.config.ts
├── projects.config.ts              single source of truth (config-driven)
├── data/snapshot.json              persisted per-connector results (gitignored)
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
└── .github/workflows/deploy.yml    build + Pages deploy with snapshot cache
```
