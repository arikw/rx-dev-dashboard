import sharp from 'sharp';
import { readJsonCache, writeJsonCache } from './json-cache';

/** Per-icon dominant colour, computed at build time via sharp's k-means
 *  quantisation. Used as the backplate tint for icon-only thumb layouts. */
const CACHE_PATH = 'generated/icon-colors.json';
type ColorCache = { version: 1; _generated: string; colors: Record<string, string | null> };
const NOTE =
  'Auto-generated dominant icon colors (sharp). Frozen-once. Delete the file to refresh.';
const empty = (): ColorCache => ({ version: 1, _generated: NOTE, colors: {} });

/** Decode `data:` URIs locally; fetch HTTP(S) URIs over the network. */
async function fetchBuffer(url: string): Promise<Buffer | null> {
  if (url.startsWith('data:')) {
    const idx = url.indexOf(',');
    if (idx < 0) return null;
    const meta = url.slice(5, idx);
    const data = url.slice(idx + 1);
    try {
      return /;base64\b/i.test(meta)
        ? Buffer.from(data, 'base64')
        : Buffer.from(decodeURIComponent(data), 'utf8');
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function dominantHex(buf: Buffer): Promise<string | null> {
  try {
    // Flatten transparent areas onto a neutral mid-gray so they don't bias
    // the dominant toward pure white or pure black.
    const { dominant } = await sharp(buf).flatten({ background: '#808080' }).stats();
    const hex = (n: number) =>
      Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  } catch {
    return null;
  }
}

/** Resolve dominant colours for a batch of icon URLs. Frozen-once cache;
 *  delete generated/icon-colors.json to refresh. */
export async function resolveIconColors(urls: string[]): Promise<Map<string, string>> {
  const cache = readJsonCache<ColorCache>(CACHE_PATH, empty());
  if (cache.version !== 1 || !cache.colors) Object.assign(cache, empty());
  cache._generated = NOTE;

  const toFetch = [...new Set(urls)].filter((u) => !(u in cache.colors));
  if (toFetch.length) {
    const results = await Promise.all(
      toFetch.map(async (u) => {
        const buf = await fetchBuffer(u);
        const color = buf ? await dominantHex(buf) : null;
        return [u, color] as const;
      }),
    );
    for (const [u, c] of results) cache.colors[u] = c;
    writeJsonCache(CACHE_PATH, cache);
  }

  const out = new Map<string, string>();
  for (const u of urls) {
    const c = cache.colors[u];
    if (c) out.set(u, c);
  }
  return out;
}
