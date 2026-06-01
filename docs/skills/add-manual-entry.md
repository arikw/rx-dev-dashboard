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
  slug: string;          // REQUIRED. Stable id, used as the card id. kebab-case.
  title: string;         // REQUIRED. Display name.
  description: string;   // REQUIRED. One sentence. Used in the card body.
  url?: string;          // Outbound link (live demo, docs, marketing page).
  tags?: string[];       // Filter chips on the dashboard.
  year?: number;         // First-release year. Shown as 📅 YYYY in card stats.
  featured?: boolean;    // Pin to the Featured row. See "Featured pinning" below.
  language?: string;     // Primary language. Optional.
  kind?: string;         // Free-form. Recognised values: 'app' | 'library' | 'package' | 'cli' | 'extension' | 'mobile' | 'image' | 'other'.
  openSource?: boolean;  // When omitted, `sourceUrl` presence implies true.
  sourceUrl?: string;    // Canonical source-repo URL.
};
```

Minimum viable entry: `{ slug, title, description }`. Everything else is optional.

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
   - For a manual project: `slug`, `title`, `description` minimum. Ask for anything else that makes sense (url, year, tags, kind).
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
