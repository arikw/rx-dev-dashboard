// Per-year npm download cache. npm's download API silently caps any single
// query at ~18 months, so "all-time" in one request is wrong. We fetch one
// calendar year at a time (each < 18 months) and sum.
//
// Each year maps to a number:
//   - >= 0  → captured downloads for that calendar year.
//   - -1    → last fetch failed; refetch needed (set on error).
// "Frozen" is derived, not stored: a year older than the current/just-ended
// year that holds a real value (>= 0) is complete and won't refetch. The
// current and just-ended year always refetch (the just-ended one so we capture
// its final days), so it's eventually correct without storing any flags.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const REFETCH = -1;

export type PackageDownloads = {
  /** ISO date of first publish (registry time.created). */
  created: string;
  /** year -> downloads (>= 0) or REFETCH (-1). */
  years: Record<string, number>;
};

export type NpmDownloadsCache = {
  version: 3;
  _generated: string;
  packages: Record<string, PackageDownloads>;
};

const CACHE_PATH = resolve(process.cwd(), 'generated/npm-downloads.json');
const NOTE =
  'Auto-generated download cache. Do not hand-edit. Per year: downloads, or -1 = refetch needed.';

function empty(): NpmDownloadsCache {
  return { version: 3, _generated: NOTE, packages: {} };
}

/** Coerce a year value from any past schema (number, or {downloads}) to a number. */
function coerceYear(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof (v as { downloads?: unknown }).downloads === 'number') {
    return (v as { downloads: number }).downloads;
  }
  return undefined;
}

export function readNpmCache(): NpmDownloadsCache {
  if (!existsSync(CACHE_PATH)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as { packages?: Record<string, { created?: string; years?: Record<string, unknown> }> };
    if (!parsed?.packages) return empty();
    const out = empty();
    for (const [name, p] of Object.entries(parsed.packages)) {
      if (!p?.created) continue;
      const years: Record<string, number> = {};
      for (const [y, v] of Object.entries(p.years ?? {})) {
        const n = coerceYear(v);
        if (n !== undefined) years[y] = n;
      }
      out.packages[name] = { created: p.created, years };
    }
    return out;
  } catch (err) {
    console.warn('[npm-cache] read failed, starting empty:', err);
    return empty();
  }
}

export function writeNpmCache(cache: NpmDownloadsCache): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  cache._generated = NOTE;
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

/** Sum captured years, skipping any still flagged for refetch (-1). */
export function sumAllTime(pkg: PackageDownloads | undefined): number {
  if (!pkg) return 0;
  return Object.values(pkg.years).reduce((a, v) => (v >= 0 ? a + v : a), 0);
}
