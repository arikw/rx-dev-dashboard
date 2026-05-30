import type { Connector, UrlIdExtractor } from './types';
import type { ConnectorResult, ProjectKind } from '../types/project';
import { loadFixture } from '../lib/fixtures';

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
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) rx-dev-dashboard/0.1',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
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
      stats: {
        ...(rating ? { rating } : {}),
      },
    },
  };
}

export const fetchPlaystoreProjects: Connector = async (config, options) => {
  const cfg = config.sources.playstore;
  if (!cfg.packages.length) return [];

  if (options?.fixtureMode) return loadFixture('playstore');

  const out: ConnectorResult[] = [];
  for (const pkg of cfg.packages) {
    const r = await scrapeOne(pkg);
    if (r) out.push(r);
  }
  return out;
};
