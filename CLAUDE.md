# CLAUDE.md

Project context for Claude Code working in this repo.

## What this is

Personal dev dashboard + clonable starter. Aggregates public signals from **GitHub**, **npm**, **Docker Hub**, and **Chrome Web Store** at build time, merges them with manual entries you control, and renders an "impact dashboard" + project grid with tag filtering.

Built with **Astro 6**. Production hosting and routing specifics live in `CLAUDE.local.md`.

The project is designed to double as a starter: a cloner edits a single `projects.config.ts` and gets a working dashboard pointing at their own handles.

## Stack & layout

- Astro 6 with `@astrojs/mdx`, `@astrojs/sitemap`. Node ≥ 22.
- Single source of truth: **`projects.config.ts`** at the repo root. All user-tunable knobs live here.
- Local override pattern: `projects.config.local.ts` (gitignored) shallow-merges over the base config so real handles can be tested locally without committing them.
- Connectors: `src/connectors/{github,npm,docker,chrome}.ts` — each fetches at build time and returns a normalized `Project[]`. Failures are non-fatal; an unavailable source just contributes nothing.
- Loader: `src/lib/load-projects.ts` runs enabled connectors in parallel, merges with `config.manual[]`, dedupes by slug, applies the `featured` pin list.
- Optional detail pages: `src/content/projects/<slug>.mdx` auto-generates `/projects/<slug>/` when the slug matches a project's id (GitHub repo name, npm name, docker image, chrome slug, or manual slug).
- URL strategy: `astro.config.mjs` sources `site` and `base` from `projects.config.ts` (overridable via `projects.config.local.ts`). The `base` prefix carries through every internal href and canonical tag — **never hardcode the hosting platform's URL or strip the base**.

## Commands

```bash
npm run dev               # localhost:4321/projects/
npm run build             # → dist/
npm run preview           # serve dist/ locally
```

## Conventions

- Don't put project images in `public/`. Use `src/content/projects/<slug>/` for colocated detail-page media so `astro:assets` can optimize.
- The author for the site is `Arik W.`. Set as the `<meta name="author">` default in `BaseHead.astro`. Override per detail page via MDX frontmatter.
- Connectors must degrade gracefully — an empty handle returns `[]`, an API failure logs and returns `[]`. A broken source never breaks the build.
- Don't speculatively add features that haven't been asked for (no admin UI, no search, no comments). Public docs (`README.md`, `CLAUDE.md`, GitHub About panel) only describe what's actually shipped.

## Deployment

- `.github/workflows/deploy.yml` builds on push to `master` plus a daily cron and publishes `dist/` to the configured static host.
- Production routing topology lives in `docs/private/` (gitignored) — see `CLAUDE.local.md` for details.

## Media cache (mind the CI flow)

External images / MP4 videos referenced by connectors are downloaded into a local cache at build time and the dashboard rewrites Project / ProfileFact URLs to the local copies. Two paths are involved — they're easy to confuse:

- **`generated/.cache/<connector>/url-map.json`** — original-upstream-URL → local-served-path mapping. Gitignored locally; **force-committed by the CI cron** so the daily build doesn't re-fetch from upstream every time.
- **`public/_cache/<connector>/<hash>.<ext>`** — the actual cached bytes. Also gitignored, also force-committed by the CI cron. The `astro:build:done` hook in `astro.config.mjs` mirrors them into `dist/_cache/` so Pages can serve them.

**Why both must be committed by CI:** the workflow runs `actions/checkout` on a clean runner, so anything gitignored is absent. If only the url-map is committed, `cacheMedia` sees an entry but the bytes aren't on disk → `dist/_cache/` ends up empty → Pages 404s. The presence-check in `src/lib/media-cache.ts` is the safety net for fresh forks / new connectors / orphaned entries — it re-downloads when the disk file is missing. But the commit pattern keeps the cron fast and offline-resilient.

**Don't rewrite raw connector caches.** `generated/.cache/<connector>/data.json` stores ORIGINAL upstream URLs on purpose — the rewrite is a build-time step in `load-projects.ts`, not something the connector does. Rewriting `data.json` would break the url-map lookup.

For extending the cache (e.g. transcoding YouTube embeds to local MP4 via `yt-dlp`), see `docs/skills/cache-media.md`.

## Where things live that aren't in this file

- `CLAUDE.local.md` (gitignored) — deployment specifics, personal/sensitive context, working preferences.
- `docs/private/` (gitignored) — proxy snippet with real values.
- `projects.config.local.ts` (gitignored) — local override of `projects.config.ts` with real handles.
- `README.md` — public-facing project intro and cloner onboarding.
