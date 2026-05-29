import type { Project } from '../types/project';

export type HeroStats = {
  /** Stars (GitHub + Docker, summed) + "likes" = positive (4–5★) app ratings. */
  starsAndLikes: number;
  /**
   * Cumulative acquisition: `downloads` (npm/Docker/GNOME/mirror fetch events) +
   * Google Play `installs`. Event counts (CI inflates npm/Docker), not a
   * current headcount — kept separate from active users on purpose.
   */
  downloadsAndPulls: number;
  /** Chrome Web Store current users — a point-in-time install headcount. */
  activeUsers: number;
  totalProjects: number;
  openSourceCount: number;
};

const num = (n: number | undefined): number => n ?? 0;

export function aggregateStats(projects: Project[]): HeroStats {
  let starsAndLikes = 0;
  let downloadsAndPulls = 0;
  let activeUsers = 0;
  let openSourceCount = 0;

  for (const p of projects) {
    if (p.openSource) openSourceCount++;

    // "Likes" = genuinely positive ratings: only 4★ and 5★ count.
    const h = p.stats.rating?.histogram;
    const likes = h && h.length >= 5 ? num(h[3]) + num(h[4]) : 0;
    starsAndLikes += num(p.stats.stars) + likes;

    downloadsAndPulls += num(p.stats.downloads) + num(p.stats.installs?.value);

    activeUsers += num(p.stats.users);
  }

  return {
    starsAndLikes,
    downloadsAndPulls,
    activeUsers,
    totalProjects: projects.length,
    openSourceCount,
  };
}

/** Format a count for display: 1234 → "1.2K", 1_234_567 → "1.2M". */
export function formatStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}
