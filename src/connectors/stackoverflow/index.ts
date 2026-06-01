import { defineConnector, type UrlIdExtractor } from '../_define';
import { readJsonCache, writeJsonCache } from '../../lib/json-cache';
import iconSvg from './icon.svg?raw';

export const urlExtractors: UrlIdExtractor[] = [
  {
    hostnames: ['stackoverflow.com', 'www.stackoverflow.com'],
    extract: (url) => {
      const m = url.pathname.match(/\/users\/(\d+)/);
      return m ? { platform: 'stackoverflow', id: m[1] } : null;
    },
  },
];

const CACHE_PATH = 'generated/.cache/stackoverflow/data.json';
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// What we keep from the SE API response. PII is deliberately *not* cached:
// display_name is the canonical identifying field and the dashboard publishes
// under the pseudonymous "Arik W." persona. profile_image *is* captured
// because the user.profileImage config can opt in to using it as the
// dashboard's portrait; if config.user.profileImage doesn't reach it, it just
// rides along on the ProfileFact and never renders.
type SOUser = {
  user_id: number;
  reputation: number;
  answer_count?: number;
  question_count?: number;
  badge_counts: { gold: number; silver: number; bronze: number };
  link: string;
  profile_image?: string;
};
type SOCache = { version: 1; _generated: string; scrapedAt?: string; user?: SOUser };

const NOTE =
  'Auto-generated Stack Overflow profile snapshot. Refreshed when older than 7 days. PII (display_name, profile_image) is intentionally omitted.';
const empty = (): SOCache => ({ version: 1, _generated: NOTE });

async function fetchSOUser(userId: string): Promise<SOUser | null> {
  // Stack Exchange API: 300 requests/day per IP without auth — fine for one
  // user fetched at most once a week.
  const url = `https://api.stackexchange.com/2.3/users/${encodeURIComponent(userId)}?site=stackoverflow`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'rx-dev-dashboard/0.1' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: SOUser[] };
    const u = data.items?.[0];
    if (!u || typeof u.user_id !== 'number') return null;
    return {
      user_id: u.user_id,
      reputation: u.reputation,
      answer_count: u.answer_count,
      question_count: u.question_count,
      badge_counts: u.badge_counts ?? { gold: 0, silver: 0, bronze: 0 },
      link: u.link,
      profile_image: u.profile_image,
    };
  } catch {
    return null;
  }
}

/** Manifest — data-only connector. Returns a ProfileFact (rendered in the
 *  ProfilePresence strip below the hero), not a Project. The reputation
 *  number deliberately does NOT slot into the hero "Stars & likes" total;
 *  it's a different kind of signal (helping vs shipping) on a different
 *  scale, and merging them would inflate the headline misleadingly. */
export default defineConnector({
  key: 'stackoverflow',
  label: 'Stack Overflow',
  brandMark: {
    svg: iconSvg,
    tint: '#f48024',
    fg: '#ffffff',
  },
  urlExtractors,
  defaultConfig: {
    enabled: true,
    userId: '',
  },
  fetch: async (config) => {
    const cfg = config.sources.stackoverflow;
    if (!cfg.enabled || !cfg.userId) return {};

    const cache = readJsonCache<SOCache>(CACHE_PATH, empty());
    if (cache.version !== 1) Object.assign(cache, empty());
    cache._generated = NOTE;

    const stale =
      !cache.scrapedAt || Date.now() - new Date(cache.scrapedAt).getTime() > REFRESH_MS;
    if (stale) {
      const u = await fetchSOUser(cfg.userId);
      if (u) {
        cache.user = u;
        cache.scrapedAt = new Date().toISOString();
        writeJsonCache(CACHE_PATH, cache);
      }
    }

    const u = cache.user;
    if (!u) return {};

    return {
      profile: {
        source: 'stackoverflow',
        url: u.link,
        label: 'Stack Overflow',
        headline: { value: u.reputation, label: 'reputation' },
        details: [
          { label: '🥇', value: u.badge_counts.gold },
          { label: '🥈', value: u.badge_counts.silver },
          { label: '🥉', value: u.badge_counts.bronze },
        ].filter((d) => typeof d.value === 'number' && d.value > 0),
        avatar: u.profile_image,
      },
    };
  },
});
