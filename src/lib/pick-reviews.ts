import type { Project, Review } from '../types/project';

/** A review enriched with the project context the carousel needs to render. */
export type CarouselReview = Review & {
  projectId: string;
  projectTitle: string;
  projectUrl: string;
  projectIcon?: string;
  projectBanner?: string;
  projectIconColor?: string;
};

/** A review is "positive" if it's explicitly rated 4+ stars, OR if it carries
 *  no rating at all — AppBrain's commentInsights.positiveQuotes is the case
 *  in point: the upstream feed already filters to positive sentiment, but
 *  doesn't attach per-quote ratings. Treating those as positive is honest. */
function isPositive(r: Review): boolean {
  return typeof r.rating !== 'number' || r.rating >= 4;
}

/** Cheap "looks English" filter — reject reviews containing characters from
 *  non-Latin scripts (CJK, Hebrew, Arabic, Cyrillic, Devanagari, etc.). Catches
 *  the obvious foreign-language reviews. Latin-script non-English (Portuguese,
 *  Spanish, …) slips through; detecting *that* reliably needs a language
 *  classifier and isn't worth a dependency for a portfolio dashboard. */
function looksEnglish(r: Review): boolean {
  const body = r.body ?? '';
  return !/[Ѐ-ӿԀ-ԯ֐-׿؀-ۿ܀-ݏऀ-ॿ぀-ゟ゠-ヿ一-鿿가-힯]/.test(body);
}

/** Newest-positive-per-project, then round-robin a second pass, third pass, …
 *  until we hit the target. Keeps the carousel visually mixed when there are
 *  few projects with reviews (e.g. 2 projects × 5 picks each) without
 *  hammering one project with 10 in a row. */
export function pickCarouselReviews(projects: Project[], target = 10): CarouselReview[] {
  // Group positives per project, newest first.
  const byProject = new Map<string, { project: Project; reviews: Review[] }>();
  for (const p of projects) {
    const positives = (p.reviews ?? [])
      .filter((r) => r.body && r.body.trim().length > 0)
      .filter(isPositive)
      .filter(looksEnglish)
      .slice()
      .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
    if (positives.length > 0) byProject.set(p.id, { project: p, reviews: positives });
  }

  const out: CarouselReview[] = [];
  let round = 0;
  // Each round: take one more review per project that still has more,
  // in deterministic project-id order, until the target is reached.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let addedThisRound = 0;
    for (const [, { project, reviews }] of byProject) {
      if (round >= reviews.length) continue;
      const r = reviews[round];
      out.push({
        ...r,
        projectId: project.id,
        projectTitle: project.title,
        projectUrl: project.url,
        projectIcon: project.icon,
        projectBanner: project.banner,
        projectIconColor: project.iconColor,
      });
      addedThisRound += 1;
      if (out.length >= target) return out;
    }
    if (addedThisRound === 0) break;
    round += 1;
  }
  return out;
}
