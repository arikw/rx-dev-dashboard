// Resolve the set of <link rel="icon"> tags BaseHead emits at build time.
//
// Honours `config.meta.favicon` (same shape as `config.user.profileImage`):
//
//   undefined  → auto: first available profile avatar, fall back to the
//                  static `public/favicon.svg` "P" tile.
//   false      → no favicon link at all.
//   '<key>'    → that connector's avatar (`'github'` / `'stackoverflow'` / …).
//   '/path' or 'http(s)://…' → use verbatim.
//
// When the resolved source is a non-vector image (i.e. a profile avatar),
// sharp pre-resizes it to a set of standard favicon sizes (32 / 64 / 128
// PNGs + a 180-px Apple touch-icon). Each size becomes its own `<link>`
// element so browsers can pick the best match for their tab / shortcut /
// home-screen icon slot without on-the-fly downscaling. Generated files
// land under `public/_cache/favicon/<srchash>-<size>.png` and pass through
// the existing `astro:build:done` mirror to `dist/_cache/favicon/`.
//
// Idempotent: if an output file already exists and is no older than its
// source, sharp is skipped. So a second page-render in the same build is
// effectively free.

import sharp from 'sharp';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ProfileFact } from '../types/project';
import config from './load-config';

const base = import.meta.env.BASE_URL;
const STATIC_SVG: FaviconLink = {
  rel: 'icon',
  type: 'image/svg+xml',
  href: `${base}favicon.svg`,
};

// Sizes to pre-resize a profile-avatar favicon into. Standard PNG favicon
// sizes for the tab icon + shortcut / home-screen slots.
const FAVICON_SIZES = [32, 64, 128] as const;
const APPLE_TOUCH_SIZE = 180;
// PWA manifest sizes — Chrome's installable criteria require at least one
// 192 and one 512 icon entry.
const MANIFEST_SIZES = [192, 512] as const;

export type FaviconLink = {
  rel: 'icon' | 'apple-touch-icon';
  type?: string;
  sizes?: string;
  href: string;
};

export type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: 'any' | 'maskable' | 'monochrome';
};

function typeFromUrl(url: string): string | undefined {
  const m = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  if (!m) return undefined;
  const ext = m[1].toLowerCase();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'ico') return 'image/x-icon';
  return undefined;
}

/** Convert a build-output URL like `/<base>/_cache/.../foo.png` to its
 *  on-disk path under `public/`. Returns null when the URL isn't a local
 *  cached media path (e.g. a remote `https://…` URL or the static SVG). */
function urlToDiskPath(url: string): string | null {
  if (!url.startsWith('/')) return null;
  let path = url;
  if (base !== '/' && path.startsWith(base)) path = path.slice(base.length - 1);
  if (!path.startsWith('/_cache/')) return null;
  return resolve(process.cwd(), 'public', path.slice(1));
}

/** Resolve a source URL to its on-disk source buffer + hash. Returns null
 *  when the URL isn't a locally cached path (remote / static / missing). */
function loadSource(sourceUrl: string): { buf: Buffer; hash: string; mtime: number } | null {
  const disk = urlToDiskPath(sourceUrl);
  if (!disk || !existsSync(disk)) return null;
  const buf = readFileSync(disk);
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  return { buf, hash, mtime: statSync(disk).mtimeMs };
}

/** Resize the source into a PNG of the given pixel size. Idempotent — skips
 *  re-encoding when the output exists and is not older than the source. */
async function ensureResized(
  srcBuf: Buffer,
  hash: string,
  srcMtime: number,
  size: number,
): Promise<string> {
  const outDir = resolve(process.cwd(), 'public/_cache/favicon');
  mkdirSync(outDir, { recursive: true });
  const filename = `${hash}-${size}.png`;
  const outPath = resolve(outDir, filename);
  if (!existsSync(outPath) || statSync(outPath).mtimeMs < srcMtime) {
    const out = await sharp(srcBuf)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(outPath, out);
  }
  return `${base}_cache/favicon/${filename}`;
}

/** Pre-resize a single source PNG/JPEG into the standard favicon size set.
 *  Returns the link list (resized PNGs + apple-touch). Falls back to a
 *  single verbatim link when the source can't be resized (remote URL,
 *  unreachable, etc.). */
async function buildResizedLinks(sourceUrl: string): Promise<FaviconLink[]> {
  const src = loadSource(sourceUrl);
  if (!src) {
    return [{ rel: 'icon', type: typeFromUrl(sourceUrl), href: sourceUrl }];
  }
  const links: FaviconLink[] = [];
  for (const size of [...FAVICON_SIZES, APPLE_TOUCH_SIZE]) {
    const href = await ensureResized(src.buf, src.hash, src.mtime, size);
    if (size === APPLE_TOUCH_SIZE) {
      links.push({ rel: 'apple-touch-icon', sizes: `${size}x${size}`, href });
    } else {
      links.push({
        rel: 'icon',
        type: 'image/png',
        sizes: `${size}x${size}`,
        href,
      });
    }
  }
  return links;
}

/** Pick the favicon link set BaseHead renders. `profiles` is the same
 *  array `getProfiles()` exposes after the loader runs. */
export async function resolveFavicon(profiles: ProfileFact[]): Promise<FaviconLink[]> {
  const pref = config.meta.favicon;
  if (pref === false) return [];

  let source: string | null = null;

  if (typeof pref === 'string' && pref.length > 0) {
    if (/^https?:\/\//.test(pref) || pref.startsWith('/')) {
      source = pref;
    } else {
      // Treat as a connector key.
      source = profiles.find((p) => p.source === pref)?.avatar ?? null;
    }
  } else {
    // Auto-default: first available profile avatar.
    source = profiles.find((p) => p.avatar)?.avatar ?? null;
  }

  // No usable profile avatar → fall back to the static SVG.
  if (!source) return [STATIC_SVG];

  // SVG sources are vector — emit one link, no resize needed.
  if (source.toLowerCase().endsWith('.svg') || typeFromUrl(source) === 'image/svg+xml') {
    return [{ rel: 'icon', type: 'image/svg+xml', href: source }];
  }

  // Raster source → pre-resize to standard sizes + apple-touch.
  return buildResizedLinks(source);
}

/** Resolve the source the favicon pipeline would use, without resizing.
 *  Used by callers that need to derive other artefacts (PWA manifest
 *  icons, OG images, …) from the same source. */
function resolveSource(profiles: ProfileFact[]): string | null {
  const pref = config.meta.favicon;
  if (pref === false) return null;
  if (typeof pref === 'string' && pref.length > 0) {
    if (/^https?:\/\//.test(pref) || pref.startsWith('/')) return pref;
    return profiles.find((p) => p.source === pref)?.avatar ?? null;
  }
  return profiles.find((p) => p.avatar)?.avatar ?? null;
}

/** Pick the PWA manifest icon set (192 + 512 PNGs, `purpose: "any"`).
 *  Reuses the favicon source-resolution + sharp resize pipeline. Falls
 *  back to the static `public/favicon.svg` as a single any-size SVG
 *  entry when no profile avatar is reachable — installable browsers
 *  accept SVG icons even though Chrome's strict criteria prefer raster
 *  192/512 PNGs. */
export async function resolveManifestIcons(profiles: ProfileFact[]): Promise<ManifestIcon[]> {
  const source = resolveSource(profiles);

  // No source at all → static SVG (vector, scales any size).
  if (!source) {
    return [
      { src: STATIC_SVG.href, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ];
  }

  // SVG source — emit verbatim as a single any-size entry.
  if (source.toLowerCase().endsWith('.svg') || typeFromUrl(source) === 'image/svg+xml') {
    return [{ src: source, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
  }

  // Raster source: resize through sharp into the manifest size set.
  // When the source isn't locally on disk (remote URL we can't reach,
  // or fresh fork pre-caching), fall back to a single verbatim entry.
  const src = loadSource(source);
  if (!src) {
    return [{ src: source, sizes: 'any', type: typeFromUrl(source) ?? 'image/png', purpose: 'any' }];
  }
  const icons: ManifestIcon[] = [];
  for (const size of MANIFEST_SIZES) {
    const href = await ensureResized(src.buf, src.hash, src.mtime, size);
    icons.push({ src: href, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' });
  }
  return icons;
}
