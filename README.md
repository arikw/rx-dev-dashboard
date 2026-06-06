# RX Portfolio — A live aggregative developer profile

A self-updating portfolio for developers who ship across more than one platform.

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-blue.svg)](./LICENSE)
[![Built with Astro 6](https://img.shields.io/badge/Built%20with-Astro%206-FF5D01?logo=astro&logoColor=white)](https://astro.build/)
[![Node ≥ 22](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

Drop in your handles. Get a dashboard with live stats from every platform your projects live on — refreshed automatically, deployed free on GitHub Pages, no backend.

**Live demo:** <https://wzmn.net/projects> · [diff-layer preview](https://wzmn.net/projects/#stats-demo=mixed)

## Why this exists

When you ship across more than one platform, no single page tells the whole story. Your GitHub profile only shows your repos. Your Chrome Web Store listing only shows one extension. Your npm page only shows your packages. None of them update themselves when the numbers shift.

This pulls every project — wherever it lives — onto one page that updates itself, so the impact numbers stay honest without you having to maintain anything.

## Features

- ✅ **All your projects in one place** — live, retired, paid closed-source, and Wayback-archived entries for projects you've sold
- ✅ **Live numbers** — stars, downloads, weekly active users, install counts, ratings, refreshed nightly by a GitHub Actions cron
- ✅ **Real banner art** — actual icons, screenshots, and marquees from each project's store listing
- ✅ **Filterable gallery** — filter by source, tag, content language, status (Live / Retired / Updated since last visit); sort by Featured / Popularity / Year
- ✅ **Deep-linkable filter state** — `#source=chrome&tag=blocker&sort=year` is shareable and survives a refresh
- ✅ **"Since last visit" diff layer** — NEW ribbons, per-card stat-move chips (`▲ +250 downloads`), hero summary, one-click hide. State in `localStorage`, no backend
- ✅ **Profile cards** — GitHub (public repos · ★ total · followers) and Stack Overflow (reputation · 🥇🥈🥉 badges)
- ✅ **Hero stat tiles** — sublabels enumerate only the sources that actually contributed (`cumulative install events across npm and Docker`)
- ✅ **Reviews carousel** — auto-rotating testimonials from CWS, AppBrain, and manual entries
- ✅ **Mobile-first responsive** — tooltips clamp to viewport, dark + light mode (system + manual toggle), sticky scroll-aware header
- ✅ **PWA-installable** — sitemap, robots.txt, manifest, service worker
- ✅ **Built-in media cache** — every banner / icon / MP4 downloaded at build time so your dashboard survives upstream link rot
- ✅ **Resilient** — connectors degrade gracefully; a hiccup on one source never blanks the dashboard; `/status.json` surfaces what's broken
- ✅ **Auto-detected retirement** — Play Store 404s and Chrome Web Store `isDeleted` flags surface as retired-project state automatically

## Setup

After you've forked (see [Deploy](#deploy) below for the GitHub Pages flow):

```bash
git clone https://github.com/<your-user>/rx-dev-dashboard.git
cd rx-dev-dashboard
npm install
npm run init       # auto-detects your GitHub handle from your git remote
npm run dev        # → http://localhost:4321/
```

`init` reads your git remote and pre-fills `projects.config.local.ts` with sensible defaults. **The first `dev` view is empty by design** — drop your real handles (npm, Docker, Chrome extension IDs, Play package names) into the generated file and refresh. The first full build with real handles takes a few minutes (every connector fetches fresh + every banner/icon gets cached); subsequent builds reuse the on-disk cache and run in seconds.

## Deploy

The fast path — fork this repo:

1. Click **Fork** at the top of this page.
2. Enable GitHub Actions on your fork (forks have Actions disabled by default):
   - **Web UI:** your fork's **Actions** tab → click "I understand my workflows, go ahead and enable them"
   - **CLI:** `gh api -X PUT repos/<your-user>/rx-dev-dashboard/actions/permissions -F enabled=true`
3. Settings → **Pages → Source: GitHub Actions**.
4. Clone your fork locally, `npm install`, `npm run init`, fill in handles, commit + push.

The workflow builds and publishes on every push, and on a daily cron at 08:00 UTC so stats stay fresh without manual touches.

**Custom domain or sub-path?** Edit `deployment.site` and `deployment.base` in `projects.config.local.ts` — the `base` prefix carries through every internal link and canonical tag, so you can also proxy GitHub Pages from a sub-path on an existing site.

## Built-in sources

| Origin platform     | Mirror sources                | Adds to                                       |
|---------------------|-------------------------------|-----------------------------------------------|
| GitHub              | _(self)_                      | stars, forks, archived flag, repo metadata, Pages favicon, profile card (public repos · followers · ★ total) |
| npm                 | _(self)_                      | weekly + lifetime downloads, README, version  |
| Docker Hub          | _(self)_                      | pulls, stars                                  |
| Chrome Web Store    | `chromestats`, `extpose`      | banner / icon, weekly active users, rating, reviews, delisted detection |
| Google Play         | `appbrain`, `apkpure`         | install tier, rating + histogram, banner / screenshots, 404-detected retirement |
| GNOME Extensions    | _(self)_                      | downloads, version compatibility              |
| Stack Overflow      | _(self)_                      | profile card (reputation · 🥇🥈🥉 badges)       |

Each source with a mirror has a fallback chain, so an API hiccup or an anti-bot gate on one source never blanks the dashboard. A `manual` connector handles closed-source projects, retired listings, Wayback snapshots, and authoritative overrides — see [`docs/skills/add-manual-entry.md`](docs/skills/add-manual-entry.md).

**Want to add a new source?** Connectors auto-discover — one new folder under `src/connectors/` is all it takes. See [`docs/connectors.md`](docs/connectors.md) for the manifest pattern.

## Customising

- **`projects.config.ts`** — committed defaults. Edit when changes should ship to upstream cloners.
- **`projects.config.local.ts`** — your private overrides (real handles, manual entries, featured pins, language preference). Shallow-merged over the base config at build time. Not in the committed `.gitignore`, so you can choose to commit yours or keep it untracked via `.git/info/exclude`.
- **`src/content/projects/<slug>.mdx`** — optional rich detail page per project. Slug matches the project id. A "Details →" link surfaces on the matching card.
- **`thumbFit: 'contain'` + `thumbBg: '<colour>'`** on a manual entry letterboxes screenshots that don't crop nicely (J2ME phone art, retro-resolution captures, anything with built-in padding).
- **Media cache is on by default** — every banner, icon and MP4 a connector references is downloaded into `public/_cache/<connector>/<hash>.<ext>` so the deployed dashboard survives upstream link rot. Toggle off via `media: { cache: false }`.

## Health check

```bash
npm run status
```

Hits your deployed `/status.json` and prints a human-readable summary. Exit 0 when clean, exit 1 when something needs attention — usable in CI / pre-deploy hooks.

Example output when something's off:

```
✗ Status: NEEDS ATTENTION  https://yoursite.example/status.json
  ↳ Partial coverage (1):
      • chromestats: 4/6 extension ids missing
  ↳ Hidden projects (1):
      • jdmiahadpnljimfcnfaebjggbfkjkgan
        no friendly title — connector enrichment data missing
  Fix: npm run seed
```

When it flags trouble, one command takes care of it:

```bash
npm run seed
```

Builds locally (residential IPs aren't gated the way some hosted CI runners are), commits the refreshed caches, pushes, and dispatches the deploy. Falls back to printed manual instructions when `gh` isn't installed or authenticated.

## FAQ

<details>
<summary><strong>What if I don't have projects on a particular platform?</strong></summary>

Leave it empty. Connectors with no configured input return nothing and just don't contribute to the dashboard — no errors, no broken UI. A platform with no projects gets no chip, no badge, no source filter entry.
</details>

<details>
<summary><strong>Can I add my own data source?</strong></summary>

Yes. Create a new folder under `src/connectors/<your-key>/` with an `index.ts` that `export default defineConnector(…)`. The registry auto-discovers it at build time — no central list to update. See [`docs/connectors.md`](docs/connectors.md) for the manifest pattern.
</details>

<details>
<summary><strong>Why is my deploy showing partial data?</strong></summary>

Some sources (chrome-stats.com, AppBrain) sit behind Cloudflare and gate datacenter IPs (which includes GitHub Actions runners). Run `npm run status` from anywhere to diagnose. If it reports partial coverage, run `npm run seed` from your own machine — residential IPs pass cleanly, the populated cache gets committed, and the next deploy serves the fresh data.
</details>

<details>
<summary><strong>How do I add a project I've sold or that's been retired?</strong></summary>

Use a manual entry in `projects.config.local.ts`. For retired projects, you can point the entry at a Wayback snapshot of the original listing — see [`docs/skills/add-manual-entry.md`](docs/skills/add-manual-entry.md). The dashboard preserves historical numbers (peak users, lifetime downloads, ratings) and surfaces them in the Retired filter with a clock+user icon for the past-users badge.
</details>

<details>
<summary><strong>Does it work with a custom domain?</strong></summary>

Yes. Set `deployment.site` to your custom domain and `deployment.base` to your sub-path (or `/`). The base carries through every internal link and canonical tag, so you can also proxy GitHub Pages from a sub-path on an existing site (e.g. `https://yourdomain.com/projects/`).
</details>

<details>
<summary><strong>Can I use this commercially?</strong></summary>

No, not under the bundled license. PolyForm Noncommercial 1.0.0 covers personal projects, learning, and evaluation — anything noncommercial. Commercial use (selling, hosted services, paid products, for-profit internal tooling) requires a separate license. [Open an issue](https://github.com/arikw) to discuss.
</details>

<details>
<summary><strong>What's the difference between <code>projects.config.ts</code> and <code>projects.config.local.ts</code>?</strong></summary>

`projects.config.ts` ships the committed defaults — what every cloner sees. `projects.config.local.ts` shallow-merges your private overrides on top of it at build time (your real handles, manual entries, featured pins, language preference). The local file is excluded from your clone via `.git/info/exclude` so it stays untracked without polluting the committed `.gitignore`.
</details>

## AI-friendly by design

The [`docs/skills/`](docs/skills/) folder ships short, agent-readable walkthroughs (each with YAML frontmatter) — a prompt like *"add my new Chrome extension as a manual entry"* drops the assistant straight into the right file.

## Docs

- [`docs/connectors.md`](docs/connectors.md) — adding a new connector
- [`docs/skills/add-manual-entry.md`](docs/skills/add-manual-entry.md) — manual entry shapes (`ManualProject`, `ManualOrigin`)
- [`docs/skills/cache-media.md`](docs/skills/cache-media.md) — build-time media cache, URL map shape, YouTube→MP4 transcoding

<details>
<summary><strong>Architecture</strong></summary>

[Astro 6](https://astro.build/) static site generator. Connectors live in `src/connectors/<key>/index.ts`, each `export default defineConnector(…)`. Auto-discovered by the registry at build time — no central list to update. Connectors fetch in parallel, normalise into `ConnectorResult`s, then `src/lib/build-projects.ts` merges + dedupes + reconciles them into final `Project`s (origin-wins → freshest-asOf → greatest-magnitude). Render is pure SSR; the only client-side JS is filter wiring + the "since last visit" diff layer (localStorage-backed, no backend).
</details>

<details>
<summary><strong>Higher GitHub API rate limit (optional)</strong></summary>

The workflow uses the auto-injected `GITHUB_TOKEN` by default — 1,000 requests/hour, enough for typical accounts. If you have a large account or hit rate limits, create a personal access token with `public_repo` read access and add it as a repo secret named `GH_API_TOKEN`. The workflow prefers it over the auto-injected token when present (bumps to 5,000 req/hr).
</details>

## Commands

```bash
npm run dev               # local dev server → http://localhost:4321/
npm run build             # → dist/  +  generated/snapshot.json
npm run preview           # serve dist/ locally
npm run init              # scaffold projects.config.local.ts from your git remote
npm run status            # health-check the deployed dashboard
npm run seed              # local-scrape → commit caches → push → dispatch deploy
```

## Credits

Built with [Astro](https://astro.build/). Stat icons are Material Icons. Brand marks (Chrome / npm / Docker / GitHub / GNOME / Stack Overflow / Play / AppBrain) are the trademarks of their respective owners.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free for personal projects, learning, evaluation, and any other noncommercial purpose. Commercial use (selling, hosted services, paid products, for-profit internal tooling) requires a separate license — [open an issue](https://github.com/arikw) to discuss. Forks must keep the `LICENSE` file and the `Required Notice: Copyright Arik W.` line intact.
