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

/**
 * Conservative lower-bound on the number of raters who left a "positive"
 * rating — defined as the top 20% of the scale (≥4 on 5-star, ≥8 on
 * 10-point, etc.). Uses the histogram when available (exact); falls back
 * to a derivation from `average` and `count` when the listing doesn't
 * publish a per-step breakdown. `max` controls the scale (default 5).
 *
 * The derivation answers: "what's the SMALLEST k such that k positive
 * raters and (n − k) sub-positive raters can produce average a over n
 * raters on a 1..max scale?"
 *
 * Worst case for k is when every contributing rating skews to the top of
 * its bucket: each sub-positive rater gave (p − 1) (max within
 * sub-positive) and each positive rater gave `max` (max within positive)
 * — that way the positive side carries the most weight per rater and the
 * fewest of them are required to reach the target sum:
 *
 *   (p − 1)(n − k) + max · k  ≥  a · n
 *          k(max − p + 1)     ≥  n · (a − p + 1)
 *                          k  ≥  n · (a − p + 1) / (max − p + 1)
 *
 * On a 5-star scale this reduces to k ≥ n(a − 3) / 2. Ratings are
 * integer, so round up; a ≤ (p − 1) means the bound is 0 (every rating
 * could plausibly be sub-positive). Returns 0 for missing / malformed
 * input.
 */
export function conservativePositiveCount(
  rating: {
    average?: number;
    count?: number;
    histogram?: number[];
    /** Top of the rating scale (default 5 for star ratings). */
    max?: number;
  } | undefined,
): number {
  if (!rating) return 0;
  const max = rating.max ?? 5;
  if (!(max > 1)) return 0;
  // "Positive" tail: top 20% of the scale, rounded up so the cutoff is at
  // a whole step (4+ on a 5-star scale, 8+ on a 10-point scale, etc.).
  const positiveThreshold = Math.ceil(0.8 * max);
  const subPositiveCap = positiveThreshold - 1;

  // Histogram path — exact. Histogram length matches the scale: index i
  // is the count of raters who gave (i + 1) stars/points.
  const h = rating.histogram;
  if (h && h.length >= max) {
    let sum = 0;
    for (let i = subPositiveCap; i < max; i++) sum += num(h[i]);
    return sum;
  }

  // Estimate path — average + count fallback.
  const avg = rating.average;
  const n = rating.count;
  if (!Number.isFinite(avg) || !Number.isFinite(n) || (n as number) <= 0) return 0;
  if ((avg as number) <= subPositiveCap) return 0;
  // Subtract a small epsilon before ceiling so floating-point error doesn't
  // bump exact-integer results up an unnecessary step (e.g. n=15, a=4.2,
  // max=5 would compute as 9.0000000000000013 in IEEE-754 and ceil to 10
  // instead of the correct 9). 1e-9 is well above real FP error from
  // 1–2-decimal rating inputs, well below any meaningful gradient at this
  // precision.
  const exact =
    ((n as number) * ((avg as number) - subPositiveCap)) / (max - subPositiveCap);
  return Math.max(0, Math.ceil(exact - 1e-9));
}

export function aggregateStats(projects: Project[]): HeroStats {
  let starsAndLikes = 0;
  let downloadsAndPulls = 0;
  let activeUsers = 0;
  let openSourceCount = 0;

  for (const p of projects) {
    if (p.openSource) openSourceCount++;

    // "Likes" = genuinely positive ratings: only 4★ and 5★ count.
    starsAndLikes += num(p.stats.stars) + conservativePositiveCount(p.stats.rating);

    downloadsAndPulls += num(p.stats.downloads) + num(p.stats.installs?.value);

    // Every `users` count represents people who installed at some point,
    // so when the project has no other install signal (`downloads` /
    // `installs`) we promote `users` into the cumulative "Downloads &
    // pulls" bucket. Skip when downloads / installs is already tracked —
    // those users would be a subset and double-count. Applies to active
    // and retired projects alike.
    if (!num(p.stats.downloads) && !num(p.stats.installs?.value)) {
      downloadsAndPulls += num(p.stats.users);
    }

    // Active users — current headcount; only valid for non-retired
    // projects (a retired project's `users` is a historical snapshot).
    if (!p.retired) activeUsers += num(p.stats.users);
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
