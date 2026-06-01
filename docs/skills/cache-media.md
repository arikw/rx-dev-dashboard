---
name: cache-media
description: Pre-download external images / videos a connector references, store them under the local media cache, and update the url-map so the builder serves the local copy instead of hitting the upstream CDN. Use when the user says things like "cache every screenshot locally", "download and compress all YouTube trailers", "convert avatars to webp", or wants to scrub upstream link rot.
audience: AI assistants (Claude, Cursor, Cline, GitHub Copilot Chat, …) and humans
---

# Caching media into the dashboard

The dashboard has a built-in **media cache** for connector-referenced
images and MP4 videos: bytes live under `public/_cache/<connector>/`, a
map of `original URL → local served path` lives at
`generated/.cache/<connector>/url-map.json`, and the builder rewrites
Project / ProfileFact image URLs to the local path at build time.

This skill is about *extending* that cache — typical asks:

- *"Pre-fetch every screenshot for every connector so the dashboard never
  hits an upstream CDN at render time."* (already happens automatically
  via `cacheMediaBatch` in `load-projects.ts` — but the user may want to
  warm a stale cache or refetch one source.)
- *"Download and compress every YouTube trailer to MP4, then point the
  dashboard at the local copy."* (YouTube embed URLs are HTML pages, not
  MP4 — the built-in cache skips them. You need an out-of-band script
  that fetches via `yt-dlp`, transcodes, writes the file into the
  cache, and patches the url-map.)
- *"Re-encode all icons to WebP."* (mirror the file with a new
  extension, point the url-map at the new file.)
- *"Drop the giant 4K screenshots from APKPure — keep only the
  thumbnail versions."* (modify the connector's URL emission, or
  post-process the cache and remove the over-large entries from the
  url-map.)

## Layout — what to write where

```
generated/
└── .cache/
    └── <connector-key>/
        ├── data.json          # connector's raw scrape — DO NOT REWRITE URLs here
        └── url-map.json       # { "<original upstream URL>": "_cache/<key>/<hash>.<ext>" }

public/
└── _cache/
    └── <connector-key>/
        └── <hash>.<ext>       # the cached bytes
```

- `<connector-key>` matches a connector's manifest `key`
  (`apkpure`, `chromestats`, `github`, `npm`, `gnome`, …). For
  connectors that don't fit, pick a stable key and use it
  consistently in both paths.
- `<hash>` is conventionally a SHA-256 of the bytes truncated to 16
  hex chars. Hash on bytes (so identical content from different URLs
  dedupes) or on the URL (so re-fetching the same URL is stable across
  re-runs). The built-in cache hashes bytes — match it unless you have
  reason not to.
- `<ext>` follows the file's content type. Allowed extensions for the
  builder to rewrite: `png`, `jpg`, `gif`, `webp`, `svg`, `ico`, `avif`,
  `mp4`. Anything else (e.g. `webm`) won't be rejected by the cache
  but the dashboard UI may not render it.
- `_cache` is the path prefix the dashboard serves these files from.
  The builder prepends the deployment base — e.g. `/projects/` → final
  URL `/projects/_cache/<key>/<hash>.<ext>`. The url-map stores the
  base-less form (`_cache/<key>/<hash>.<ext>`) — the builder adds
  the prefix at rewrite time.

## url-map.json shape

```json
{
  "version": 1,
  "_generated": "Auto-generated media URL map. …",
  "map": {
    "https://image-eo.example.com/abc.jpg": "_cache/apkpure/4caa4579bd13a49d.jpg",
    "https://www.youtube.com/embed/w9882-wWfjA?…": "_cache/apkpure/9ec4288b08f50a56.mp4"
  }
}
```

`version: 1` is the current schema. `_generated` is a human note (no code
reads it). `map` is the lookup the builder uses — every key MUST be the
exact original URL emitted by the connector into `data.json`, otherwise
the rewrite step won't find it.

## How to add a new cached file from scratch

For one-off / out-of-band caching (e.g. running `yt-dlp` to convert a
YouTube embed URL into a local MP4):

1. **Identify the connector key and the original URL** the connector
   emits. Look in `generated/.cache/<key>/data.json` for the URL.
   This is the value you'll use as the map *key*.
2. **Fetch / convert the bytes** to your preferred local format. For
   videos this typically means `yt-dlp -f 'best[ext=mp4]' --output ...`
   or a similar transcode. For images, a `sharp`/`ffmpeg` pipeline.
3. **Hash the file bytes** with SHA-256, take the first 16 hex chars,
   pick the extension from the file's content type. Example name:
   `b7d2e0fc4a1b9c8d.mp4`.
4. **Write the file** to `public/_cache/<key>/<filename>`. Create the
   parent directory if it doesn't exist.
5. **Update `generated/.cache/<key>/url-map.json`**: read it, add
   `map["<original URL>"] = "_cache/<key>/<filename>"`, write it back.
   Preserve `version: 1` and `_generated`.
6. **Run `npm run build`** and check `dist/data.json` — every Project
   field that referenced the original URL should now show the
   rewritten `<base>_cache/<key>/<filename>` path.

## How to write a helper script

If the user wants this batched (every YouTube trailer at once, every
icon re-encoded as WebP, etc.), drop a script under `scripts/` and call
it from npm. Pattern:

```ts
// scripts/cache-youtube-trailers.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const CONNECTOR = 'apkpure';
const MAP_PATH = `generated/.cache/${CONNECTOR}/url-map.json`;
const PUBLIC_ROOT = `public/_cache/${CONNECTOR}`;

const data = JSON.parse(readFileSync(`generated/.cache/${CONNECTOR}/data.json`, 'utf8'));
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));

mkdirSync(PUBLIC_ROOT, { recursive: true });

for (const app of Object.values<any>(data.apps)) {
  for (const url of app.videos ?? []) {
    if (map.map[url]) continue;                      // already cached
    if (!/youtube(-nocookie)?\.com/.test(url)) continue;
    const tmp = `/tmp/yt-${Date.now()}.mp4`;
    execFileSync('yt-dlp', ['-f', 'best[ext=mp4]', '-o', tmp, url], { stdio: 'inherit' });
    const buf = readFileSync(tmp);
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const filename = `${hash}.mp4`;
    writeFileSync(`${PUBLIC_ROOT}/${filename}`, buf);
    map.map[url] = `_cache/${CONNECTOR}/${filename}`;
  }
}

writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n');
```

Run with `npx tsx scripts/cache-youtube-trailers.ts` (or `node`,
depending on tooling). After it finishes, `npm run build` and the
dashboard serves the local MP4s.

## Refreshing a cached file

The cache is fetch-once by URL. To refresh:

- **Per-URL**: delete the entry from
  `generated/.cache/<key>/url-map.json` and re-run the build (the
  built-in `cacheMedia` re-fetches when no map entry exists), OR
  delete the underlying file from `public/_cache/<key>/` AND remove
  the map entry.
- **Per-connector**: `rm -r generated/.cache/<key>/url-map.json
  public/_cache/<key>/` then re-build.
- **Everything**: `rm -r generated/.cache/*/url-map.json public/_cache/`
  then re-build.

## Pitfalls

- **Don't rewrite `data.json`.** The raw scrape file is the source of
  truth and stays diagnosable only if its URLs match what the upstream
  actually returned. The dashboard separates *raw* from *served* on
  purpose. If you change `data.json`, the url-map rewrite step won't
  find the original URL and the dashboard will hit the (now-stale)
  upstream link.
- **Match the URL string exactly.** APKPure for example sometimes
  emits URLs with `&amp;` literal entities still in them — those
  entities count as part of the key. Whatever string lives in
  `data.json` is what must be the map key.
- **Hash on bytes for dedupe, or on URL for stability across
  refetches.** Pick one and stick with it across a connector. Mixing
  produces orphan files in `public/_cache/`.
- **Both `public/_cache/` and `generated/.cache/` are gitignored
  locally but force-committed by the CI cron** (see
  `.github/workflows/deploy.yml`). The url-map and the bytes ship
  together — if only the url-map were committed, the CI runner would
  see "cached" entries with no files on disk, and the deployed site
  would 404 on every rewritten URL. The presence-check in
  `cacheMedia` (`existsSync` against `public/_cache/<key>/<hash>`)
  is the safety net that re-fetches when the disk file is missing.
  If you add a new bytes-producing helper outside of `cacheMedia`,
  make sure it writes into `public/_cache/<key>/` (so the CI commit
  picks it up) AND updates the url-map.
- **Only `png/jpg/gif/webp/svg/ico/avif/mp4` are recognised.** Other
  extensions are written fine but the dashboard's renderers may not
  display them. If you cache a `.webm` video, expect to also update
  the component that renders videos.
- **Re-encoding to a different extension is fine** — the hash is on
  bytes, the extension comes from the content type. Just make sure the
  map points at the new file.

## After the change

Run `npm run build` and verify:

- `dist/data.json` contains the rewritten URLs (grep for `_cache/`).
- `dist/_cache/<key>/<filename>` exists (the Astro integration in
  `astro.config.mjs` mirrors `public/_cache/` into `dist/_cache/` at
  `astro:build:done`).
- The dashboard renders the images / videos by browsing
  `npm run preview` and visiting the relevant cards.
