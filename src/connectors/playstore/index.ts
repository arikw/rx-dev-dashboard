import type { Connector } from '../types';
import type { ConnectorResult, ProjectKind } from '../../types/project';
import { defineConnector, type UrlIdExtractor } from '../_define';
import { loadFixture } from '../../lib/fixtures';
import { detectContentLanguage } from '../../lib/content-language';

export const urlExtractors: UrlIdExtractor[] = [
  {
    hostnames: ['play.google.com'],
    extract: (url) => {
      if (!url.pathname.includes('/store/apps/details')) return null;
      const id = url.searchParams.get('id');
      return id ? { platform: 'google-play', id } : null;
    },
  },
];

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function meta(doc: string, prop: string): string | undefined {
  const m = doc.match(new RegExp(`property="${prop}"[^>]+content="([^"]+)"`, 'i'));
  return m ? decodeEntities(m[1]) : undefined;
}

async function scrapeOne(pkg: string): Promise<ConnectorResult | null> {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`;
  let doc: string;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) live-dev-portfolio/0.1',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    // 404 = the listing has been removed from the store. Surface a minimal
    // origin rep with `retired: true` so the dashboard's reconciler picks
    // it up (Project.retired = allReps.some(r => r.retired)). Mirrors
    // still contribute their cached pre-removal stats; the URL is omitted
    // because the live page no longer exists.
    if (res.status === 404) {
      return { origin: { platform: 'google-play', id: pkg, retired: true } };
    }
    if (!res.ok) return null;
    doc = await res.text();
  } catch {
    return null;
  }

  // Take title and description from og:* (clean, stable). Strip the trailing
  // " - Apps on Google Play" suffix the Play Store appends to og:title.
  const rawTitle = meta(doc, 'og:title');
  const title = rawTitle ? rawTitle.replace(/\s*-\s*Apps on Google Play\s*$/i, '').trim() : undefined;
  const description = meta(doc, 'og:description');
  const image = meta(doc, 'og:image');

  // The SoftwareApplication ld+json carries the aggregate rating + category.
  let rating: { average: number; count: number } | undefined;
  let category: string | undefined;
  for (const m of doc.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]+?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]) as Record<string, unknown>;
      if (d['@type'] === 'SoftwareApplication') {
        const ar = d.aggregateRating as { ratingValue?: string | number; ratingCount?: string | number } | undefined;
        if (ar) {
          const avg = parseFloat(String(ar.ratingValue ?? ''));
          const cnt = parseInt(String(ar.ratingCount ?? ''), 10);
          if (Number.isFinite(avg) && Number.isFinite(cnt)) rating = { average: avg, count: cnt };
        }
        if (typeof d.applicationCategory === 'string') category = d.applicationCategory;
        break;
      }
    } catch {
      // skip non-JSON blocks
    }
  }

  return {
    origin: {
      platform: 'google-play',
      id: pkg,
      url,
      title,
      description,
      image,
      tags: ['android', ...(category ? [category.toLowerCase().replace(/_/g, '-')] : [])],
      kind: 'mobile' as ProjectKind,
      openSource: false,
      contentLanguage: detectContentLanguage(title) ?? undefined,
      // Play Store's og:image is the 512×512 app icon, not a banner.
      icon: image,
      stats: {
        ...(rating ? { rating } : {}),
      },
    },
  };
}

export const fetchPlaystoreProjects: Connector = async (config, options) => {
  // The canonical Android-package list lives on `sources.gplay.packages`
  // (shared with the appbrain + apkpure mirrors). Union with the
  // legacy `sources.playstore.packages` for back-compat.
  const packages = Array.from(
    new Set([
      ...(config.sources.playstore?.packages ?? []),
      ...(config.sources.gplay?.packages ?? []),
    ]),
  );
  if (!packages.length) return [];

  if (options?.fixtureMode) return loadFixture('playstore');

  const out: ConnectorResult[] = [];
  for (const pkg of packages) {
    const r = await scrapeOne(pkg);
    if (r) out.push(r);
  }
  return out;
};

/** Manifest — picked up by `_registry.ts` via auto-discovery.
 *  playstore is the ORIGIN for the "android" source-group. Mirrors (appbrain,
 *  apkpure) inherit this label via mirrorOf and the source-group via
 *  sourceGroup. The chip label rendered to users is "Android app". */
export default defineConnector({
  key: 'playstore',
  label: 'Android app',
  sourceGroup: 'android',
  // Canonical origin for Google Play — mirrors (appbrain/apkpure) inherit
  // the source-group, and the android group is what gets credited for
  // installs / rating in the hero sublabels.
  emits: ['installs', 'rating'],
  // playstore reps use platform: 'google-play' (the canonical Play resource
  // identifier, also used in manual `origins` config). Alias it so the
  // platform→source-group lookup still resolves.
  platformAliases: ['google-play'],
  urlExtractors,
  defaultConfig: {
    enabled: true,
    packages: [] as string[],
  },
  fetch: async (config, opts) => {
    const projects = await fetchPlaystoreProjects(config, opts);
    return { projects };
  },
});
