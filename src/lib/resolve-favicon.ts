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

// Connector keys whose user avatars are rendered round on the source
// platform. When `config.meta.faviconShape` is unset / 'auto' and the
// favicon source is one of these, we default to applying a circular mask
// so the dashboard's favicon matches what the user sees on their profile.
const ROUND_AVATAR_SOURCES: ReadonlySet<string> = new Set(['github', 'stackoverflow']);

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

// Safe-zone percentage for rounded icons. W3C maskable-icon recommendation
// is 80% (10% padding on each side); Apple-touch and Material both sit in
// the 75–85% range. 80% lets a face-centered avatar survive the circular
// crop without losing the chin/forehead.
const ROUNDED_SAFE_ZONE = 0.8;

/** Resize the source into a PNG of the given pixel size, optionally
 *  applying a circular mask so the result reads as a round avatar.
 *  Idempotent — skips re-encoding when the output exists and is no older
 *  than the source. Shape is encoded in the filename so square and
 *  rounded variants don't fight for the same cache slot.
 *
 *  Rounded mode pads the avatar inside an 80% safe zone — matches the
 *  W3C maskable-icon convention so the inscribed avatar doesn't get its
 *  corners cropped by the circular mask. The padding ring colour comes
 *  from the source's corner pixels, so the ring blends with what was
 *  there before the crop. */
async function ensureResized(
  srcBuf: Buffer,
  hash: string,
  srcMtime: number,
  size: number,
  shape: 'rounded' | 'square' = 'square',
): Promise<string> {
  const outDir = resolve(process.cwd(), 'public/_cache/favicon');
  mkdirSync(outDir, { recursive: true });
  const shapeKey = shape === 'rounded' ? 'r' : 's';
  const filename = `${hash}-${size}-${shapeKey}.png`;
  const outPath = resolve(outDir, filename);
  if (existsSync(outPath) && statSync(outPath).mtimeMs >= srcMtime) {
    return `${base}_cache/favicon/${filename}`;
  }

  let out: Buffer;
  if (shape === 'rounded') {
    const innerSize = Math.round(size * ROUNDED_SAFE_ZONE);
    const pad = Math.round((size - innerSize) / 2);
    const sampled = await sampleCornerColor(srcBuf, size, 16);
    const ringBg = sampled ?? { r: 255, g: 255, b: 255, alpha: 0 };
    const avatarBuf = await sharp(srcBuf)
      .resize(innerSize, innerSize, { fit: 'cover' })
      .png()
      .toBuffer();
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`,
    );
    out = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: ringBg,
      },
    })
      .composite([
        { input: avatarBuf, top: pad, left: pad },
        { input: mask, blend: 'dest-in' },
      ])
      .png({ compressionLevel: 9 })
      .toBuffer();
  } else {
    out = await sharp(srcBuf)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  writeFileSync(outPath, out);
  return `${base}_cache/favicon/${filename}`;
}

/** Resolve the favicon source URL plus its originating connector key
 *  (when the source IS a profile avatar — null when it's a verbatim URL
 *  or path). Used by both the favicon and manifest pipelines, and by the
 *  shape resolver below. */
function resolveSourceWithInfo(profiles: ProfileFact[]): { url: string; sourceConnector: string | null } | null {
  const pref = config.meta.favicon;
  if (pref === false) return null;
  if (typeof pref === 'string' && pref.length > 0) {
    if (/^https?:\/\//.test(pref) || pref.startsWith('/')) return { url: pref, sourceConnector: null };
    const profile = profiles.find((p) => p.source === pref);
    return profile?.avatar ? { url: profile.avatar, sourceConnector: profile.source } : null;
  }
  const first = profiles.find((p) => p.avatar);
  return first?.avatar ? { url: first.avatar, sourceConnector: first.source } : null;
}

/** Decide whether to mask the favicon round. Explicit `faviconShape`
 *  config always wins; `'auto'` (or unset) defaults to rounded when the
 *  source is a profile avatar from a platform that renders avatars
 *  round on its own site, square otherwise. */
function resolveShape(sourceConnector: string | null): 'rounded' | 'square' {
  const pref = config.meta.faviconShape;
  if (pref === 'rounded') return 'rounded';
  if (pref === 'square') return 'square';
  if (sourceConnector && ROUND_AVATAR_SOURCES.has(sourceConnector)) return 'rounded';
  return 'square';
}

/** Pre-resize a single source PNG/JPEG into the standard favicon size set.
 *  Returns the link list (resized PNGs + apple-touch). Falls back to a
 *  single verbatim link when the source can't be resized (remote URL,
 *  unreachable, etc.). */
async function buildResizedLinks(sourceUrl: string, shape: 'rounded' | 'square'): Promise<FaviconLink[]> {
  const src = loadSource(sourceUrl);
  if (!src) {
    return [{ rel: 'icon', type: typeFromUrl(sourceUrl), href: sourceUrl }];
  }
  const links: FaviconLink[] = [];
  for (const size of [...FAVICON_SIZES, APPLE_TOUCH_SIZE]) {
    const href = await ensureResized(src.buf, src.hash, src.mtime, size, shape);
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
  const info = resolveSourceWithInfo(profiles);
  if (config.meta.favicon === false) return [];

  // No usable profile avatar → fall back to the static SVG.
  if (!info) return [STATIC_SVG];

  // SVG sources are vector — emit one link, no resize / mask needed.
  // (Designed SVGs are typically already the shape the user wants.)
  if (info.url.toLowerCase().endsWith('.svg') || typeFromUrl(info.url) === 'image/svg+xml') {
    return [{ rel: 'icon', type: 'image/svg+xml', href: info.url }];
  }

  // Raster source → pre-resize + maybe round.
  const shape = resolveShape(info.sourceConnector);
  return buildResizedLinks(info.url, shape);
}

/** Pick the PWA manifest icon set (192 + 512 PNGs, `purpose: "any"`).
 *  Reuses the favicon source-resolution + sharp resize pipeline. Falls
 *  back to the static `public/favicon.svg` as a single any-size SVG
 *  entry when no profile avatar is reachable — installable browsers
 *  accept SVG icons even though Chrome's strict criteria prefer raster
 *  192/512 PNGs. */
export async function resolveManifestIcons(profiles: ProfileFact[]): Promise<ManifestIcon[]> {
  const info = resolveSourceWithInfo(profiles);
  if (!info) {
    return [
      { src: STATIC_SVG.href, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ];
  }

  // SVG source — emit verbatim as a single any-size entry.
  if (info.url.toLowerCase().endsWith('.svg') || typeFromUrl(info.url) === 'image/svg+xml') {
    return [{ src: info.url, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
  }

  const src = loadSource(info.url);
  if (!src) {
    return [{ src: info.url, sizes: 'any', type: typeFromUrl(info.url) ?? 'image/png', purpose: 'any' }];
  }
  const shape = resolveShape(info.sourceConnector);
  const icons: ManifestIcon[] = [];
  for (const size of MANIFEST_SIZES) {
    const href = await ensureResized(src.buf, src.hash, src.mtime, size, shape);
    icons.push({ src: href, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' });
  }
  return icons;
}

/** Sample the corner colour of the favicon source, for use as the PWA
 *  manifest `background_color` default. Averages the RGB of opaque pixels
 *  in 16×16 patches at each of the four corners of the 192×192 resized
 *  source. Returns null when the source is SVG (no raster corners to
 *  sample) or otherwise unreadable — caller falls back to a static
 *  default in that case.
 *
 *  Sampling happens BEFORE any circular mask is applied, so a rounded
 *  favicon still surfaces the original avatar's corner tone — that's
 *  exactly the colour the splash screen should fill the space around
 *  the round icon with. */
export async function resolveManifestBackground(profiles: ProfileFact[]): Promise<string | null> {
  const info = resolveSourceWithInfo(profiles);
  if (!info) return null;
  if (info.url.toLowerCase().endsWith('.svg') || typeFromUrl(info.url) === 'image/svg+xml') return null;
  const src = loadSource(info.url);
  if (!src) return null;
  return sampleCornerColor(src.buf, 192, 16);
}

async function sampleCornerColor(srcBuf: Buffer, size: number, patch: number): Promise<string | null> {
  try {
    const { data, info } = await sharp(srcBuf)
      .resize(size, size, { fit: 'cover' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    if (channels < 3) return null;
    const corners = [
      { x0: 0, y0: 0 },
      { x0: info.width - patch, y0: 0 },
      { x0: 0, y0: info.height - patch },
      { x0: info.width - patch, y0: info.height - patch },
    ];
    let r = 0, g = 0, b = 0, n = 0;
    for (const { x0, y0 } of corners) {
      for (let dy = 0; dy < patch; dy++) {
        for (let dx = 0; dx < patch; dx++) {
          const idx = ((y0 + dy) * info.width + (x0 + dx)) * channels;
          const a = data[idx + 3];
          if (a < 128) continue;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          n++;
        }
      }
    }
    if (n === 0) return null;
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}
