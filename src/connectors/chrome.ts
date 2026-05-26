import type { Connector } from './types';
import type { Project } from '../types/project';
import { loadFixture } from '../lib/fixtures';

type ChromeExtension = {
  id: string;
  title: string;
  description: string;
  url: string;
  users?: number;
  rating?: number;
  ratingCount?: number;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function scrapeOne(id: string): Promise<ChromeExtension | null> {
  const url = `https://chromewebstore.google.com/detail/${encodeURIComponent(id)}`;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) rx-dev-dashboard/0.1',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Title: <title>Name - Chrome Web Store</title>
  const titleMatch = html.match(/<title>([^<]+?)(?:\s*-\s*Chrome Web Store)?<\/title>/);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : id;

  // Description: og:description or meta description
  const descMatch =
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/) ??
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/);
  const description = descMatch ? decodeEntities(descMatch[1]) : '';

  // Users: pattern like "1,000,000+ users" or "12,345 users"
  let users: number | undefined;
  const usersMatch = html.match(/([\d,]+)\+?\s*users?/i);
  if (usersMatch) {
    const n = parseInt(usersMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n)) users = n;
  }

  // Rating: aggregateRating in JSON-LD or inline
  let rating: number | undefined;
  let ratingCount: number | undefined;
  const ldBlocks = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]+?)<\/script>/g);
  if (ldBlocks) {
    for (const block of ldBlocks) {
      const inner = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      try {
        const data = JSON.parse(inner);
        const candidates = Array.isArray(data) ? data : [data];
        for (const item of candidates) {
          const agg = item?.aggregateRating;
          if (agg) {
            const r = parseFloat(agg.ratingValue);
            const c = parseInt(agg.ratingCount, 10);
            if (Number.isFinite(r)) rating = r;
            if (Number.isFinite(c)) ratingCount = c;
            break;
          }
        }
        if (rating !== undefined) break;
      } catch {
        // Skip non-JSON blocks; some pages embed templates.
      }
    }
  }

  return {
    id,
    title,
    description,
    url,
    users,
    rating,
    ratingCount,
  };
}

export const fetchChromeProjects: Connector = async (config, options) => {
  const ids = config.sources.chrome.extensionIds;
  if (!ids.length) return [];

  if (options?.fixtureMode) return loadFixture('chrome');

  const results = await Promise.all(ids.map((id) => scrapeOne(id)));
  const valid = results.filter((r): r is ChromeExtension => r !== null);

  return valid.map<Project>((ext) => ({
    id: `chrome:${ext.id}`,
    source: 'chrome',
    title: ext.title,
    description: ext.description,
    url: ext.url,
    tags: ['chrome-extension'],
    stats: {
      users: ext.users,
      rating: ext.rating,
      ratingCount: ext.ratingCount,
    },
    kind: 'extension',
    // openSource is set by the cross-source pass when a matching github
    // repo (by normalized name/title) exists.
    featured: false,
    hasDetail: false,
  }));
};
