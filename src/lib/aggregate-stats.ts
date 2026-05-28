import type { Project } from '../types/project';

export type HeroStats = {
  /** GitHub stars + Docker Hub stars + Chrome Web Store rating counts. */
  starsAndLikes: number;
  /**
   * Cumulative install/fetch events: npm all-time downloads + Docker pulls.
   * These are machine-driven event counts (CI inflates them), not unique
   * people — kept separate from a headcount on purpose.
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
    if (p.source !== 'manual') openSourceCount++;

    starsAndLikes +=
      num(p.stats.stars) + num(p.stats.dockerStars) + num(p.stats.ratingCount);

    downloadsAndPulls += num(p.stats.downloadsAllTime) + num(p.stats.pulls);

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
