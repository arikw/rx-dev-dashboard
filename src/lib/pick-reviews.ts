import type { Project, Review } from '../types/project';
import { resolveTitleHref } from './title-href';

/** A review enriched with the project context the carousel needs to render. */
export type CarouselReview = Review & {
  projectId: string;
  projectTitle: string;
  projectUrl: string;
  projectIcon?: string;
  projectBanner?: string;
  projectIconColor?: string;
};

/** High-confidence positive-sentiment phrase patterns for the unrated case.
 *  Used to admit reviews that lack a star rating — e.g. AppBrain's
 *  commentInsights feed, which empirically misclassifies negatives
 *  ("Too slow…") as positive at the source. We can't trust upstream
 *  curation, so we look for our own positive markers instead.
 *
 *  Each pattern is a phrase, not a single word — phrases are far more
 *  predictive of sentiment than bare adjectives (which negate easily:
 *  "not great", "far from perfect"). Misses some genuine positives by
 *  design, in exchange for not leaking negatives. */
const POSITIVE_MARKERS: ReadonlyArray<RegExp> = [
  // Direct love/like statements ("loves this", "my son loves this")
  /\b(?:love|loved|loves)\s+(?:it|this|using|the\s+app|this\s+app|the\s+game|playing(?:\s+this)?)\b/i,
  /\b(?:i|we)\s+(?:really\s+)?(?:love|like|loved|liked)\s+(?:it|this|using|playing)\b/i,

  // "works X" — overwhelmingly positive
  /\bworks\s+(?:great|perfectly|well|flawlessly|like\s+a\s+charm|nicely|as\s+expected|excellently)\b/i,

  // Recommendations
  /\b(?:highly|definitely|absolutely|truly|gladly|strongly)\s+recommend(?:ed|ing)?\b/i,

  // Numeric ratings written in text
  /\b(?:5\/5|5\s*stars?|five\s+stars?|10\/10|10\s+out\s+of\s+10)\b/i,

  // Review opens with a strong positive adjective (very common in app reviews)
  /(?:^|[\t\n.!])\s*(?:excellent|amazing|awesome|fantastic|wonderful|brilliant|terrific|perfect|great|lovely|nice|cool|love|loved|love(?:s|d)?\s+it)\b/i,

  // Positive adjective + product/feature noun
  /\b(?:great|amazing|awesome|excellent|fantastic|wonderful|brilliant|terrific|nice|good|cool|lovely|cute|elegant)\s+(?:app|game|extension|tool|product|service|work|job|graphics?|design|interface|ux|ui|idea|feature)\b/i,

  // Best + noun (broad — catches "best UX", "best ever", "best for X")
  /\b(?:the\s+)?best\s+(?:app|game|extension|tool|product|service|ever|idea|ux|ui|way|thing|of|in|for|i(?:'ve)?\s+(?:used|tried|seen))\b/i,

  // "Very/really/so [positive adjective]"
  /\b(?:very|really|so|extremely|super|quite)\s+(?:useful|helpful|good|easy|nice|cool|comfortable|happy|pleased|impressed|simple|smooth|reliable)\b/i,

  // "Just/exactly what I needed"
  /\b(?:just|exactly)\s+what\s+(?:i|we)\s+(?:needed|wanted|was\s+looking\s+for)\b/i,

  // Gratitude (require modifier so "thanks for nothing" doesn't slip)
  /\bthank(?:s|\s+you)\s+(?:so\s+much|a\s+lot|very\s+much|for\s+\w)/i,

  // "user-friendly" almost never appears in negative context
  /\buser[-\s]friendly\b/i,

  // "easy to use/install/set up" is overwhelmingly positive
  /\beasy\s+to\s+(?:use|set\s+up|install|configure|understand|navigate)\b/i,

  // "[positive adj] for/at/way/to" — e.g. "great for keeping up", "perfect way to"
  /\b(?:great|excellent|amazing|awesome|terrific|wonderful|brilliant|perfect)\s+(?:for|at|way|to)\b/i,

  // Maintenance / care signals
  /\bconstantly\s+updated\b/i,
  /\bwell[-\s]maintained\b/i,

  // "Simple and [positive]"
  /\bsimple\s+and\s+(?:efficient|effective|easy|clean|elegant|powerful|straightforward|intuitive)\b/i,
];

function hasPositiveMarker(body: string | undefined): boolean {
  if (!body) return false;
  return POSITIVE_MARKERS.some((re) => re.test(body));
}

function isPositive(r: Review): boolean {
  if (typeof r.rating === 'number') return r.rating >= 4;
  return hasPositiveMarker(r.body);
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
        // Same priority as the card title: homepage → first non-github
        // source URL → github → primary origin URL. Keeps the carousel
        // link consistent with the card click destination.
        projectUrl: resolveTitleHref(project),
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
