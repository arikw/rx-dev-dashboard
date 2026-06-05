import type { Connector } from '../types';
import { defineConnector, type UrlIdExtractor } from '../_define';
import { fetchGithubRepoProjects } from './projects';
import { fetchGithubProfile } from './profile';
import iconSvg from './icon.svg?raw';

export const urlExtractors: UrlIdExtractor[] = [
  {
    hostnames: ['github.com', 'www.github.com'],
    extract: (url) => {
      const m = url.pathname.match(/^\/[^/]+\/([^/#?]+)/);
      return m ? { platform: 'github', id: m[1].replace(/\.git$/, '') } : null;
    },
  },
];

/** Manifest — picked up by `_registry.ts` via auto-discovery. */
export default defineConnector({
  key: 'github',
  label: 'GitHub',
  emits: ['stars', 'forks'],
  brandMark: {
    svg: iconSvg,
    tint: '#0a0c12',
    fg: '#ffffff',
    // Light tile + dark Octocat in dark mode so the brand stays visible
    // (near-black tile blends into the page background otherwise).
    darkTint: '#e8e6e1',
    darkFg: '#1a1a1a',
  },
  urlExtractors,
  defaultConfig: {
    enabled: true,
    includeForks: false,
    excludeRepos: [] as string[],
  },
  fetch: async (config, opts) => {
    const cfg = config.sources.github;
    const handle = config.user.github;
    const token = process.env.GITHUB_TOKEN;
    // Repos + profile fetch in parallel — they're independent and the profile
    // call is cheap (one REST GET against /users/<handle>).
    const [projects, profile] = await Promise.all([
      fetchGithubRepoProjects({
        handle,
        includeForks: cfg.includeForks,
        excludeRepos: cfg.excludeRepos,
        fixtureMode: opts?.fixtureMode,
      }),
      fetchGithubProfile(handle, token),
    ]);
    // Surface total stars across all listed repos on the profile card. The
    // sum is derived from the same `projects` array the dashboard already
    // builds — no extra API call. Excluded / forked repos that weren't
    // returned by fetchGithubRepoProjects also don't count, which matches
    // the dashboard's own "stars & likes" hero figure.
    if (profile) {
      const totalStars = projects.reduce(
        (acc, r) => acc + (r.origin?.stats?.stars ?? 0),
        0,
      );
      if (totalStars > 0) {
        // Render the label as a star glyph so the chip stays compact
        // and matches the Stack Overflow row's icon-style labels
        // (🥇/🥈/🥉). iconBefore puts the star before the count
        // ("★ 440") to match the card-stats style.
        profile.details = [
          { label: '★', value: totalStars, iconBefore: true },
          ...(profile.details ?? []),
        ];
      }
    }
    return { projects, profile: profile ?? undefined };
  },
});

/** Legacy named export — kept while consumers haven't switched to the registry. */
export const fetchGithubProjects: Connector = async (config, options) => {
  const cfg = config.sources.github;
  return fetchGithubRepoProjects({
    handle: config.user.github,
    includeForks: cfg.includeForks,
    excludeRepos: cfg.excludeRepos,
    fixtureMode: options?.fixtureMode,
  });
};
