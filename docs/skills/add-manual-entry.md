---
name: add-manual-entry
description: Add a manual project or authoritative origin fact to the dashboard config. Use when the user wants to surface a project that no connector covers (closed-source / retired / not-on-any-platform) OR override a number that a connector got from a mirror (exact Play Console install total, true first-release year, etc.).
audience: AI assistants (Claude, Cursor, Cline, GitHub Copilot Chat, …) and humans
---

# Adding a manual entry to the dashboard

> Use this when the user wants to add an entry the connectors can't produce
> automatically:
>
> - a **project** no connector covers (closed-source / retired /
>   not-on-any-platform), OR
> - an **authoritative override** of a number a connector scraped from a
>   mirror (exact Play Console install total, true first-release year, …).

There are **two** kinds of manual entries. Figure out which one the user needs before touching files.

| Kind | Where it goes | When to use |
|---|---|---|
| **Manual project** | `config.manual: ManualProject[]` | A project the dashboard should show as a card but no connector covers it (closed-source tool, retired app, work you can't link to a public repo). |
| **Manual origin** | `config.origins?: Record<string, ManualOrigin>` | A project that IS covered by a connector, but the connector's data is wrong / incomplete and you want an authoritative override (e.g. Play Console gives you the exact install count, scraped AppBrain only has the "10,000+" tier). |

If unsure, ask the user one clarifying question: *"Is this a brand-new project the dashboard has never heard of (manual project), or are you correcting / enriching a number on a project that's already there (manual origin)?"*

## Where the files live

Two config files exist:

- **`projects.config.ts`** — committed to git. Public. **Never put personal identifiers, real names, employer names, or anything sensitive here.** Many forks of this dashboard publish under a pseudonym; committed files should match whatever persona the user has established for the public site.
- **`projects.config.local.ts`** — `.gitignore`d. Safe for real handles, internal product names, sensitive context.

**Default to `projects.config.local.ts`** unless the user explicitly asks for the entry to be public. Both files merge at load time (local overrides committed; the registry's `mergeConfig` handles it).

If `projects.config.local.ts` doesn't exist yet, the user is editing the committed config — ask first: *"This will go into the public, committed `projects.config.ts`. Want me to put it in `projects.config.local.ts` (gitignored) instead?"*

## Schemas (canonical — match the TypeScript types)

### ManualProject

```ts
type ManualProject = {
  slug: string;            // REQUIRED. Stable id, used as the card id. kebab-case.
  title: string;           // REQUIRED. Display name.
  description: string;     // REQUIRED. One sentence. Used in the card body.
  url?: string;            // Outbound link (live demo, docs, marketing page).
  tags?: string[];         // Filter chips on the dashboard.
  year?: number;           // First-release year. Shown as 📅 YYYY in card stats.
  featured?: boolean;      // Pin to the Featured row. See "Featured pinning" below.
  language?: string;       // Primary language. Optional.
  kind?: string;           // Free-form. Recognised values: 'app' | 'library' | 'package' | 'cli' | 'extension' | 'mobile' | 'image' | 'other'.
  openSource?: boolean;    // When omitted, `sourceUrl` presence implies true.
  sourceUrl?: string;      // Canonical source-repo URL.
  // Media — when any of these are set, the card uses a richer thumb
  // layout instead of the brand-mark/initials fallback. See
  // "Media on manual projects" below for details + how the cache
  // interacts with each one.
  icon?: string;           // Square logo/app icon URL. Triggers the icon-frame layout.
  banner?: string;         // Wide promo / marketing tile URL. Triggers the banner layout.
  screenshots?: string[];  // Phone/screen captures. Paired with `icon` → screenshot+icon stack.
  videos?: string[];       // Trailer URLs (direct .mp4 — cached; YouTube embed — pass-through).
  // Where the project lived — drives the source-chip label on the card.
  // See "Picking the right `source`" below for guidance.
  source?: string;
  // Numeric stats scraped from a store listing — stars, downloads, users,
  // ratings, etc. SAME shape connector-emitted projects use, so the card
  // renders them identically. See "Capturing stats" below.
  stats?: {
    stars?: number;
    forks?: number;
    downloads?: number;            // cumulative
    downloadsMonthly?: number;     // last-30-days
    installs?: { value: number; exact: boolean };  // Google-Play-style tier
    users?: number;                // weekly active / daily users
    rating?: { average: number; count?: number; histogram?: number[] };
  };
  // User reviews (rating + body + ISO date + source). Surfaced in the
  // homepage review carousel if positive (≥4 stars or unrated) and English.
  // NEVER include author name / handle / email — PII rules apply.
  reviews?: Array<{ rating?: number; body: string; ts?: string; source?: string }>;
  // Project's own website (separate from `url` which is the outbound listing).
  homepage?: string;
  // ISO date the entry's data was last verified — drives reconcile (freshest
  // wins) and shows up as the "as of" date on the card. Use the snapshot
  // timestamp when scraping from a Wayback / archive page.
  asOf?: string;
  // Mark as archived. Archived projects are DROPPED from the grid.
  // Use this only when you want the card NOT to appear at all.
  archived?: boolean;
  // Mark as retired. Card stays in the grid; the hero's "Active users"
  // total excludes `stats.users` (historical snapshots don't get to
  // inflate the live-headcount headline). When the entry has NO
  // `downloads` / `installs` data, the user count is promoted to the
  // "Downloads & pulls" total instead — each historical user is one
  // past install event. Set retired:true for ANY project whose user
  // count is a past snapshot rather than a live signal: removed
  // Chrome / Firefox / Edge extensions, taken-down listings, archived
  // addon pages, etc.
  retired?: boolean;
};
```

Minimum viable entry: `{ slug, title, description }`. Everything else is optional. Without any of `icon`/`banner`/`screenshots`, the card falls back to a generic initials-on-gradient thumb.

## Picking the right `source`

The `source` field drives the **source-chip label** on the project card (the small pill under the title that reads "GITHUB ↗" / "CHROME ↗" / "PORTFOLIO" on existing cards). Set it from the project's actual host platform — NOT the platform that's hosting the screenshot you fetched (e.g. Wayback Machine, Imgur). Common values:

| The project lived on… | Use `source` value | Chip will read |
|---|---|---|
| GitHub repo only | `'github'` (or omit and set `sourceUrl`) | `GITHUB ↗` |
| npm | `'npm'` | `NPM` |
| Docker Hub | `'docker'` | `DOCKER` |
| Chrome Web Store | `'chrome'` | `CHROME` |
| Firefox Add-ons (AMO) | `'firefox'` | `FIREFOX` |
| Microsoft Edge Add-ons | `'edge'` | `EDGE` |
| Safari Extensions Gallery | `'safari'` | `SAFARI` |
| WordPress Plugin Directory | `'wordpress'` | `WORDPRESS` |
| GNOME Shell Extensions | `'gnome'` | `GNOME` |
| Google Play Store | `'google-play'` | `GOOGLE PLAY` |
| Apple App Store | `'app-store'` | `App-store` *(label-fallback — fine but you can rename in `src/lib/source-label.ts` if you want it prettier)* |
| Self-hosted website / personal project | omit | `PORTFOLIO` |
| Truly platform-less (e.g. a printed zine, a binary you handed out) | omit | `PORTFOLIO` |

Heuristics for the AI assistant adding the entry:

- **Read the URL.** A Wayback / archive snapshot of `addons.mozilla.org/...` ⇒ `source: 'firefox'`. A snapshot of `chromewebstore.google.com/...` ⇒ `source: 'chrome'`. A snapshot of `wordpress.org/plugins/...` ⇒ `source: 'wordpress'`. Do not let the archive domain mislead you — the source is the ORIGINAL host, not the archive host.
- **Match a connector key when one fits.** Anything in `src/connectors/<key>/` is a first-class source (`github`, `npm`, `docker`, `chrome`, `gnome`, `stackoverflow`, …). Use that exact key so the chip picks up the right label.
- **Lowercase, one-word keys for everything else.** No spaces, no plural-S, no version numbers. The label is auto-capitalised at the first letter (so `'firefox'` → `'Firefox'`).
- **Don't invent a key when the connector exists.** Use `'github'`, NOT `'gh'` or `'github-pages'`, when the project lived as a GitHub repo.

Acceptable to leave `source` omitted only if the project genuinely had no public host (closed-source internal tool, retired binary, conference talk, etc.) — those legitimately read as "PORTFOLIO".

## Picking `url` for a retired / removed project

The `url` field is the card's outbound link — what a visitor lands on if they click the title. For RETIRED projects (extension removed from the store, repo archived, addon page taken down) the live URL almost always 404s.

**Rule**: HEAD-check the live URL. If it returns 404 / 410 / a "this listing is no longer available" redirect, use the **archive URL you scraped from instead** (Wayback / Archive.today / etc.). A snapshot URL that loads is better UX than a dead canonical URL.

Examples:

- AMO removed addon → live `addons.mozilla.org/...` returns 404 → use `web.archive.org/web/<ts>/addons.mozilla.org/...`
- Chrome Web Store removed extension → live `chromewebstore.google.com/detail/<id>` redirects to `/detail/empty-title/<id>` → use a chrome-stats.com mirror page OR the Wayback snapshot.
- Archived GitHub repo → repo is still reachable but `archived: true` in metadata → still safe to use the live URL.

Verifying live-vs-dead is one `curl -sIL --max-time 10 <url>` away. Don't guess.

## Capturing stats

Manual entries are first-class — they accept the same `stats` shape connector-emitted projects do. When you scrape a project from a store listing, **look hard for numbers** and populate them. The card's stats row is what makes it feel like a real project tile instead of a description.

What to look for, by source:

| Source | Look for | Maps to |
|---|---|---|
| AMO (Firefox add-ons) | `<meta itemprop="interactionCount" content="UserDownloads:32239"/>` | `stats.downloads = 32239` |
| AMO | `<div id="daily-users">223 users</div>` *(or `weekly downloads`)* | `stats.users = 223` |
| AMO | `<meta itemprop="ratingValue" content="4.2"/>` *(may have `reviewCount` too)* | `stats.rating = { average: 4.2, count?: <reviewCount> }` |
| Chrome Web Store | `1,000,000+ users` text, or `<meta itemprop="ratingValue">` | `stats.users` (drop the `+`), `stats.rating` |
| Google Play | install tier `"10,000+"` | `stats.installs = { value: 10000, exact: false }` |
| GitHub repo (if scraping HTML) | star icon → number | `stats.stars` |
| npm | weekly downloads on the package page | `stats.downloadsMonthly` |

Generic markers to grep on ANY page:

- Schema.org microdata: `itemprop="ratingValue"`, `itemprop="reviewCount"`, `itemprop="interactionCount"` (with `UserDownloads:N` / `UserInstalls:N` payloads).
- JSON-LD `<script type="application/ld+json">` with `AggregateRating` → `ratingValue` / `ratingCount`.
- Inline text patterns: `\d+(?:,\d{3})*\s+(users|downloads|installs|reviews|ratings)\b`.
- Star markup: class names like `stars-4`, `rating-stars-N`, or `Rated N out of 5 stars`.

**Capture what you find**. The TYPE allows partial values — e.g. `stats.rating = { average: 4.2 }` without `count` is valid; the card renders "4.2★" without the "(N)" suffix. Don't fabricate counts or round averages. If the page only shows a 4-star icon visually but the schema markup says `ratingValue: 4.2`, use 4.2.

## Reviews

If the page has visible user review text, you may copy a handful into `reviews`. Rules:

- **No PII**: never include the reviewer's display name, handle, avatar, or email. Capture rating + body + date only.
- **Body must be substantive** — a single emoji or "Great!" is fine, but no truncated cut-off text.
- **English filter applied at render time** — non-Latin scripts get dropped from the homepage carousel automatically, so don't bother translating.
- **Date as ISO** (`YYYY-MM-DD`) if visible; omit `ts` if not.
- **Set `source` to the platform key** (`'firefox'`, `'chrome'`, etc.) so the carousel can show "via Firefox" / "via Chrome".

Skip the reviews bucket if the page has none, or all are non-English / single-emoji.

## `asOf`

If the data came from a snapshot (Wayback Machine, the Internet Archive, a cached crawl), set `asOf` to that snapshot's ISO date. It tells the reconcile path how fresh the entry is — and the card uses it as the "last updated" timestamp. Examples:

- `https://web.archive.org/web/20170912104531/…` → `asOf: '2017-09-12'`
- A current scrape on 2026-06-01 → `asOf: '2026-06-01'`

### ManualOrigin

```ts
type ManualOrigin = {
  url?: string;            // Override the project's outbound URL.
  asOf?: string;           // ISO date — when the manual data was measured. Wins reconcile if newer.
  firstReleased?: number;  // Override the first-release year.
  stats?: CanonicalStats;  // Override any stat: stars, downloads, installs, users, rating.
};
```

Keyed by **origin resource id** of the form `"<platform>:<id>"`. Find the right id by looking at `generated/snapshot.json` — the `origin.platform` + `origin.id` fields on the existing rep. Examples:

- `"google-play:net.example.myapp"` — Android app on Google Play.
- `"chrome:abcdefghijklmnopqrstuvwxyzabcdef"` — Chrome extension (32-char ID).
- `"github:my-repo"` — GitHub repo.
- `"npm:my-package"` — npm package.
- `"docker:owner/my-image"` — Docker Hub repo.

### Stats shape (for ManualOrigin.stats)

Subset of `CanonicalStats` you'd actually override manually:

```ts
{
  stars?: number;
  forks?: number;
  downloads?: number;
  downloadsMonthly?: number;
  installs?: { value: number; exact: boolean };  // For Google Play. Set exact:true when you have the Play Console total.
  users?: number;                                  // Chrome Web Store weekly users.
  rating?: { average: number; count: number; histogram?: number[] };
}
```

## Media on manual projects

A manual entry can supply `icon`, `banner`, `screenshots`, and/or `videos` — same buckets a real connector emits. The card layout adapts:

| Fields you set | Card layout |
|---|---|
| `banner` | full-width banner image |
| `screenshots` + `icon` | screenshot background with icon overlay |
| `icon` only | square icon on a coloured backplate (sampled from the icon) |
| `screenshots` only | first screenshot as banner |
| *(nothing)* | brand-mark or initials-on-gradient fallback |

**Where the images live**: any reachable URL. Three good choices, by preference:

1. **A URL hosted on a CDN you control** (your own GitHub Pages, an S3 bucket, etc.) — most robust. Goes through the build-time media cache (see README "Build-time media cache"): on first build the bytes are downloaded into `public/_cache/manual/<hash>.<ext>` and the dashboard rewrites the card URL to the local copy. Survives upstream link rot.
2. **A path under `public/` in this repo** — for projects whose images you'd rather check into the repo directly. E.g. drop `public/manual-media/<slug>.png`, then set `icon: '/manual-media/<slug>.png'`. The dashboard's `import.meta.env.BASE_URL` isn't prepended by the loader, so write the path with the deployment base included (e.g. `'/projects/manual-media/<slug>.png'` for a `/projects/` deployment). Skips the cache (already local).
3. **An upstream URL you don't control** (a project's marketing site, etc.) — works but at the mercy of the upstream. With caching on (the default) this is fine — first build snapshots it. With caching off, the dashboard hot-links and breaks if the URL goes away.

**Videos**: only direct `.mp4` URLs get cached. YouTube embed URLs (`https://www.youtube.com/embed/<id>?…`) are passed through to the dashboard as-is — the carousel / card UI knows what to do with them. To cache an actual YouTube video locally, see `docs/skills/cache-media.md` (yt-dlp recipe).

**Don't forget the rebuild**: media URLs are processed by `cacheMedia` at build time. After adding new image fields, run `npm run build` and confirm:

- The new entry's image fields in `dist/data.json` either start with `/<base>/_cache/manual/…` (when cached) or are the verbatim URL/path you wrote (when caching is off or for `/public/`-path entries).
- The corresponding files exist under `public/_cache/manual/` when the cache caught them.

## Featured pinning

`config.featured: string[]` is a separate top-level array of slugs/ids that pins matching projects to the Featured row. Works for any project, not just manual ones — match against:
- GitHub repo name
- npm package name
- Docker image name
- Chrome slug or extension ID
- Manual project's `slug`

If the user says "and feature it", add the entry's slug to `config.featured` too. If they don't say so, don't pin.

The `ManualProject.featured` field exists but is a per-entry shortcut; `config.featured: [...]` is the canonical list and survives the merge cleanly. Prefer adding to `config.featured`.

## How to add an entry — step by step

1. **Confirm which kind** (manual project vs manual origin) — ask if unclear.
2. **Confirm which file** (committed vs local) — default to local.
3. **Gather the data**:
   - For a manual project: `slug`, `title`, `description` minimum. Decide `source` from where the project *actually* lived (see "Picking the right `source`" above — the platform is what determines the chip; never confuse it with the page you're scraping from). Then **systematically check the page for every other field the schema supports** — manual entries are first-class and should carry the same data a connector-emitted card does:
     - **Media** — `icon`, `banner`, `screenshots` (otherwise the card renders as a plain initials tile);
     - **Stats** — `users`, `downloads`, `rating` etc. (see "Capturing stats" above; this is the difference between a real-looking card and a description sitting in a box);
     - **Reviews** — substantive English bodies + dates, no PII (see "Reviews" above);
     - **Dates** — `year` (first release), `asOf` (snapshot/scrape date);
     - **Identity / context** — `url`, `homepage`, `sourceUrl`, `tags`, `kind`, `language`.
     Don't stop at the minimum viable fields. Read the page top to bottom.
   - For a manual origin: the origin resource id (look in `generated/snapshot.json` if the user doesn't know it offhand), and which stat(s) to override with which values.
4. **Edit the file**. Insert into the right array/object. Match the surrounding indentation/style. The existing config files have commented-out examples — uncomment-style additions are fine.
5. **Verify** with `npm run build` and a quick inspection of `dist/data.json` for the new entry.

## Common pitfalls

- **Don't invent ids.** If the user asks for a manual origin, ask them or look in `generated/snapshot.json` for the exact origin resource id. Inventing `"google-play:foo"` when the snapshot has `"google-play:com.example.foo"` produces a silent no-op.
- **`projects.config.local.ts` may not exist.** If the user wants a local-only entry and the file is absent, create it by importing `baseConfig from './projects.config'` and spreading. There's a working pattern at the top of the file when it exists; if not, look at `README.md` ("Advanced: keep some values out of git").
- **Don't surface PII.** Even in `projects.config.local.ts`, scrub email addresses and real names from descriptions — those can leak through to `dist/data.json` which gets published.
- **Featured slugs are matched case-sensitively** against project ids. Match exactly what shows up on the existing card or what you used as `slug`.

## After the entry lands

Run `npm run build` and confirm:
- The new manual project appears in `dist/data.json` with the expected slug.
- For a manual origin: the corresponding project's stats reflect the override (the snapshot still has the connector's raw value — the override is applied at build time, not at fetch time).
