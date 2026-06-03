import type { Project } from '../types/project';
import { resolveHomepageChip } from './homepage-chip';

/** Featured-sort tiebreaker for projects NOT pinned in `config.featured`.
 *  A weighted "quality" score, mostly 0–~250. Higher = earlier in the
 *  default grid. The sort itself uses this score directly (highest first,
 *  title alphabetic as a final deterministic break) — no bucketing or
 *  group-key tricks, so popularity is allowed to clearly dominate when
 *  there's a meaningful gap, even between same-source-and-year projects.
 *
 *  Weight philosophy:
 *  - Big binary signals (installable, visual richness) carry the most
 *    weight because they're effort + intent signals.
 *  - Popularity is log-scaled but with a higher multiplier than the
 *    other signals — at 1K downloads it's already worth more than a
 *    homepage, by 100K it's worth more than the whole visual stack.
 *  - Recency is intentionally a small bonus (max 15) so a 2026 project
 *    doesn't out-score a 2018 project on age alone.
 *  - Retired projects get a 15% discount, not a 100% one — substantial
 *    retired work (lots of downloads + real visuals) still beats plain
 *    live-but-empty repos.
 *
 *  The formula is intentionally simple — it's a default for the
 *  "Featured" sort, not a ranking system. Cloners who want different
 *  weights edit this file. */
export function featuredScore(p: Project, nowYear = new Date().getUTCFullYear()): number {
  let q = 0;

  // Installable from a non-github source — npm, chrome, docker, gnome,
  // android, firefox, math4mobile, … The presence of any non-source-code
  // source means the project ships somewhere users can install it.
  const installable = p.sources.some((s) => s !== 'github' && s !== 'manual');
  if (installable) q += 50;

  // Has the project's own EXTERNAL website — defined as "would the
  // homepage chip actually render on the card?". resolveHomepageChip
  // is the single source of truth, so this stays in lockstep with
  // ProjectCard's rendering (no duplicated PLATFORM_HOSTS list, no
  // separately-implemented dedup logic that could drift). The bonus
  // is conditional on whether the project ALREADY has another
  // distribution channel:
  //   - When NOT installable elsewhere (e.g. a github-only repo with a
  //     deployed GitHub Pages site), the homepage IS the project's
  //     external presence → +20.
  //   - When already installable elsewhere (e.g. an npm package with
  //     a homepage chip), the homepage is supplementary marketing →
  //     +5 (token bonus).
  const hasExternalHomepage = resolveHomepageChip(p) !== null;
  if (hasExternalHomepage) q += installable ? 5 : 20;

  // Visual richness — cards with art (icon / banner / screenshots) look
  // better in the grid, so default them higher when popularity ties.
  if (p.icon) q += 25;
  if (p.banner) q += 20;
  if (p.screenshots && p.screenshots.length > 0) q += 15;

  // Recency. Uses the MORE RECENT of first-release year and last-
  // update timestamp, so a 2012 project that's still being maintained
  // reads as "current" rather than "14 years old". Cap is small (10
  // points) — other quality signals should dominate, not age.
  // Retired projects skip `updatedAt` entirely: for those, the
  // timestamp often represents data-verification date (`asOf`), not
  // actual maintenance. A retired 2005 J2ME app with `asOf: 2026`
  // should read as "21 years old", not "0 years old".
  let recentYear: number | undefined;
  if (typeof p.year === 'number') recentYear = p.year;
  if (p.updatedAt && !p.retired) {
    const u = new Date(p.updatedAt).getUTCFullYear();
    if (!Number.isNaN(u)) {
      recentYear = recentYear !== undefined ? Math.max(recentYear, u) : u;
    }
  }
  if (recentYear !== undefined) {
    const age = nowYear - recentYear;
    q += Math.max(0, 10 - age);
  }

  // Popularity. Split into LIVE signals (current usage indicators —
  // active users, monthly downloads) and LIFETIME accumulators (stars,
  // total downloads, total installs). Live signals weigh more per
  // unit (×18 vs ×10) because they evidence TODAY's value, not
  // historical engagement.
  //
  // For retired projects, the "live" signals are DEMOTED to lifetime:
  // a retired Firefox addon's `users` count is a historical snapshot,
  // not currently-using-it people. Without this demotion, a retired
  // project with a historical user count could out-score a live
  // project with the same number of actually-present users.
  const userCount = p.stats.users ?? 0;
  const monthlyDownloads = p.stats.downloadsMonthly ?? 0;
  const liveSignal = p.retired ? 0 : userCount + monthlyDownloads;
  const lifetimeSignal =
    (p.stats.stars ?? 0) +
    (p.stats.downloads ?? 0) +
    (p.stats.installs?.value ?? 0) +
    (p.retired ? userCount + monthlyDownloads : 0);
  if (liveSignal > 0) q += Math.log10(1 + liveSignal) * 18;
  if (lifetimeSignal > 0) q += Math.log10(1 + lifetimeSignal) * 10;

  // Retired discount — multiply by 0.85 instead of 0.7, so substantial
  // retired work (the Firefox addon with 87K downloads + visuals)
  // still beats lame live competitors.
  let score = p.retired ? q * 0.85 : q;

  // Floor-cap rule. Github-only repos that have BOTH no engagement
  // (zero stars) AND no effort signals (no homepage / icon / banner /
  // screenshots) sit at the very bottom of the grid regardless of
  // recency. The "and no effort" guard means a 0-star repo that ships
  // a deployed GitHub Pages site (with a favicon picked up by the
  // pages-meta fetch) is exempt — that's a deployed site, not junk.
  const isGithubOnly = p.sources.length === 1 && p.sources[0] === 'github';
  const zeroStars = !p.stats.stars;
  const noEffort =
    !hasExternalHomepage &&
    !p.icon &&
    !p.banner &&
    (!p.screenshots || p.screenshots.length === 0);
  if (isGithubOnly && zeroStars && noEffort) score = Math.min(score, 5);

  return score;
}
