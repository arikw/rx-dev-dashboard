# rx-dev-dashboard

Config-driven dev dashboard and project showcase. Built with [Astro](https://astro.build/), publishable to GitHub Pages or any other static host.

Pulls public signals from **GitHub**, **npm**, **Docker Hub**, and **Chrome Web Store** at build time, merges them with manual entries you control, and renders an "impact dashboard" plus a project grid with tag filtering.

Designed to be cloned — edit one config file, push, and you have your own.

## Quick start

```bash
git clone https://github.com/<your-user>/rx-dev-dashboard.git
cd rx-dev-dashboard
npm install
npm run init       # scaffold projects.config.local.ts from your git remote
npm run dev
```

Open `projects.config.local.ts` and fill in any optional fields you care about (chrome extension IDs, featured slugs, manual entries), then refresh.

## Set up your own dashboard

The fastest path to a working dashboard on your domain:

### 1. Fork this repo

Click **Fork** on this repo's GitHub page.

### 2. Enable Actions on your fork

GitHub disables Actions on forks by default. Turn them on:

- **Web UI:** go to your fork's **Actions** tab → click **I understand my workflows, go ahead and enable them**.
- **CLI:** `gh api -X PUT repos/<your-user>/<your-fork>/actions/permissions -F enabled=true`

### 3. Scaffold `projects.config.local.ts` with `npm run init`

```bash
npm install
npm run init
```

The init script reads `git remote get-url origin`, extracts the GitHub user + repo, and writes `projects.config.local.ts` pre-filled with:

- `deployment.site: 'https://<user>.github.io'`
- `deployment.base: '/<repo>'`
- `user.github: '<user>'`

Plus commented stubs for `sources.chrome.extensionIds`, `featured`, and `manual` that you can fill in if relevant. The loader shallow-merges this local file over `projects.config.ts` at build time — anything you don't override falls through to the defaults. That keeps your fork from fighting upstream `projects.config.ts` updates when you pull bug fixes.

If your real deployment lives somewhere other than GitHub Pages (a custom domain, a sub-path on an existing site, etc.), edit `deployment.site` and `deployment.base` to match.

If you'd rather keep your handles out of git, add `projects.config.local.ts` to your fork's `.gitignore` or to `.git/info/exclude`. (Editing `projects.config.ts` directly works too, but you'll have merge conflicts on every upstream pull.)

### 4. Enable GitHub Pages

Settings → Pages → Source: **GitHub Actions**.

### 5. Push (or trigger manually)

Push to the default branch — the workflow builds and deploys. A daily cron at 08:00 UTC also rebuilds so source-fetched stats stay fresh without manual pushes.

To trigger a one-off build without pushing: Actions tab → **Deploy** → **Run workflow**.

> Prefer a standalone repo over a fork? **Use this template → Create a new repository** also works — that path skips step 2 (Actions are enabled by default on template-created repos).

### 6. (Optional) Verify the deploy with `npm run status`

After the deploy lands, run `npm run status` locally to confirm the dashboard built cleanly. See [Checking dashboard health](#checking-dashboard-health) below for what the output looks like and how to fix anything it flags.

## Inspecting connector data

Two views into what each connector returned and when:

- **`/data.json`** — emitted on every build at the site root (e.g. `https://yoursite.example/data.json`). Includes the merged project list plus a per-connector snapshot.
- **`generated/snapshot.json`** — the persisted snapshot. Gitignored locally; the scheduled workflow commits it back to the repo as a durable backup (visible in the repo browser).

Each connector's snapshot includes a `lastScrapedAt` timestamp. If a source fails on the next run (API outage, rate limit, scrape regression), the loader falls back to that connector's most recent successful scrape — only the affected source goes stale, never the whole dashboard.

## Checking dashboard health

```bash
npm run status
```

Auto-detects your dashboard URL from `projects.config.ts` (and `projects.config.local.ts` when present), hits `/status.json` with a cache-busting query string, and prints a human-readable summary. Exit code is 0 when everything's healthy, 1 when something needs attention — usable in CI / pre-deploy checks.

Example output when everything's clean:

```
✓ Status: HEALTHY https://yoursite.example/status.json
  All 10 connectors fully covered, no hidden projects.
```

Example output when something needs your attention:

```
✗ Status: NEEDS ATTENTION https://yoursite.example/status.json

  ↳ Partial coverage (1):
      • chromestats: 4/6 extension ids missing (likely Cloudflare block)
  ↳ Hidden projects (1):
      • jdmiahadpnljimfcnfaebjggbfkjkgan
        no friendly title — connector enrichment data missing

  Fix  (typically: a Cloudflare-gated source the runner can't reach):
    Run npm run seed — builds locally to fill the caches, commits the
    refresh, pushes, and dispatches the deploy. Re-run npm run status after.
```

When something needs attention, the single command:

```bash
npm run seed
```

…builds locally (residential IPs aren't blocked by Cloudflare like Azure-hosted runners are), commits the refreshed `generated/` + `public/_cache/`, pushes, and dispatches the deploy. Falls back to printed instructions for the GitHub web UI when `gh` isn't installed/authenticated.

The script reads `/status.json`, which sits under your configured `deployment.base`. Pass a URL explicitly to override auto-detection:

```bash
npm run status -- https://yoursite.example/projects
```

## Adding a new connector

See **[docs/connectors.md](docs/connectors.md)** for the connector manifest pattern, folder layout, brand-mark setup, URL extractors, mirror relationships, and per-connector config. Connectors are auto-discovered — adding one is a single new folder under `src/connectors/`.

## Adding a manual entry

See **[docs/skills/add-manual-entry.md](docs/skills/add-manual-entry.md)** for the two shapes of manual entry the config accepts — a `ManualProject` for projects no connector covers (closed-source / retired / not-on-any-platform) and a `ManualOrigin` for authoritative overrides of scraped numbers.

The file lives under [`docs/skills/`](docs/skills/) — a tool-agnostic home for short, action-oriented walkthroughs an AI assistant (Claude, Cursor, Cline, GitHub Copilot Chat, …) or a human contributor can follow. Each skill has YAML frontmatter for machine readability and a markdown body for the actual steps.

## Build-time media cache

Every image and MP4 video a connector references is downloaded into `public/_cache/<connector>/<hash>.<ext>` at build time, and the dashboard rewrites Project / ProfileFact URLs to those local copies. The raw scrape under `generated/.cache/<connector>/data.json` keeps the ORIGINAL upstream URLs so the snapshot stays diagnosable. The CI cron (`.github/workflows/deploy.yml`) commits both `generated/` and `public/_cache/` back to the repo so subsequent builds are fast and the deployed site survives upstream link rot.

**Config knob — `media.cache` in `projects.config.ts`** (default: `true`)

Set `media: { cache: false }` to disable the cache entirely. Connectors will emit upstream URLs and the dashboard will serve them directly. Faster builds and no local bytes get committed, but every page render hits the upstream CDNs and the site breaks if any upstream URL goes away. Useful when:

- the catalogue is large enough that the cache would noticeably bloat the repo,
- the CI runner can't reach the upstream CDNs (private network, etc.),
- or you'd rather rely on browser-side caching only.

See **[docs/skills/cache-media.md](docs/skills/cache-media.md)** for the cache layout, the `url-map.json` shape, and patterns for extending the cache (e.g. transcoding YouTube trailers to local MP4 via `yt-dlp` and pointing the map at the result).

## Advanced: higher GitHub API rate limit

Optional. The workflow uses the auto-injected `GITHUB_TOKEN` by default, which gives you 1000 requests/hour — enough for typical accounts (one paged request per build).

If you have a very large account or hit rate limits, create a personal access token with `public_repo` read access and add it as a repo secret named **`GH_API_TOKEN`**. The workflow prefers it over the auto-injected token when present (bumps the limit to 5000 req/hr).

## Commands

```bash
npm run dev               # local dev server
npm run build             # → dist/  +  generated/snapshot.json
npm run preview           # serve dist/ locally
```

## License

Source available under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

**Free** for personal projects, learning, evaluation, and any other noncommercial purpose. Clone it, modify it, deploy your own projects dashboard — go for it.

**Commercial use** requires a separate commercial license. That includes (non-exhaustively):

- Selling the software or a derivative product
- Offering it as a hosted / managed service to third parties
- Building paid products on top of it
- Using it for internal tooling at a for-profit company

Open an issue or [reach out](https://github.com/arikw) to discuss a commercial license.

Forks remain bound by the same license — keep the `LICENSE` file and the `Required Notice: Copyright Arik W.` line intact. The "Built with rx-dev-dashboard" footer attribution in `src/pages/index.astro` is good practice but not strictly required by the license itself.

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
