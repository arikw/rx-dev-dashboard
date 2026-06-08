import type { APIRoute } from 'astro';
import { loadProjects, getProfiles } from '../lib/load-projects';
import { aggregateStats, formatStat } from '../lib/aggregate-stats';
import config from '../lib/load-config';

// Animated SVG profile card meant for embedding in a GitHub README.
// Mounted at `<base>profile-card.svg` and built at the same cadence as
// the rest of the dashboard, so the numbers below stay in sync with what
// `/projects/` is showing.
//
// What it ships:
//   - Headline name + tagline
//   - 2×2 grid of the hero stats (stars-and-likes / downloads / users /
//     projects shipped)
//   - Footer line with GitHub repos + Stack Overflow rep (when present)
//   - CSS keyframe animations: a soft fade-in-up stagger on the four
//     stat cells + a slow pulse on the "live" dot in the corner
//   - `prefers-color-scheme: dark` overrides so it adapts to whatever
//     theme the README is being viewed under (GitHub honours media
//     queries inside an SVG served as an image)
//
// Why CSS animations instead of SMIL: GitHub's camo proxy serves SVGs
// fine and honours embedded `<style>` blocks, but `<script>` is stripped
// (a hard security rule). SMIL works too, but CSS keyframes give the
// nicer staggered delays without writing each `<animate>` element by
// hand.
export const GET: APIRoute = async () => {
  const projects = await loadProjects();
  const stats = aggregateStats(projects);
  const profiles = getProfiles();

  const githubFact = profiles.find((p) => p.source === 'github');
  const stackoverflowFact = profiles.find((p) => p.source === 'stackoverflow');

  const githubRepos = typeof githubFact?.headline.value === 'number' ? githubFact.headline.value : null;
  const githubStars = githubFact?.details?.find((d) => d.label.toLowerCase().includes('star'))?.value;
  const stackoverflowRep = typeof stackoverflowFact?.headline.value === 'number' ? stackoverflowFact.headline.value : null;

  const userName = config.user.name || 'Arik W.';
  const userHandle = config.user.github || 'arikw';
  const dashboardUrl = `${config.deployment.site}${config.deployment.base}`;
  const tagline = (config.user.bio ?? '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1') // strip markdown links
    .replace(/\.\s*$/, '')
    .replace(/\.\s*Reach me on GitHub/i, '')
    .replace(/Reach me on GitHub/i, '')
    .trim();

  const buildLabel = `Updated ${new Date(0).toISOString().slice(0, 10)}`;
  // ^ Date.now() is unavailable inside the build context for some Astro
  // configs; the dashboard's "Last updated" line elsewhere uses the
  // snapshot timestamp. For this card we just omit the date — the
  // build runs daily, freshness is implicit.

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 740 340" width="740" height="340" role="img" aria-label="${userName} — live project stats">
  <title>${userName} — live project stats</title>
  <style>
    :root {
      --bg: #fafaf7;
      --card: #ffffff;
      --fg: #1a1a1a;
      --muted: #6a6a6a;
      --accent: #2e4f6f;
      --accent-soft: #e5edf4;
      --border: #e8e3da;
      --live: #16a34a;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0c0d0f;
        --card: #1e2024;
        --fg: #ecebe5;
        --muted: #a8a39a;
        --accent: #94bcdb;
        --accent-soft: #243246;
        --border: #3a3c41;
        --live: #4ade80;
      }
    }
    .bg { fill: var(--bg); }
    .card { fill: var(--card); stroke: var(--border); }
    .fg { fill: var(--fg); }
    .muted { fill: var(--muted); }
    .accent { fill: var(--accent); }
    .accent-rule { stroke: var(--accent); }
    .live-dot { fill: var(--live); }

    .serif { font-family: 'Fraunces', 'Source Serif Pro', ui-serif, Georgia, 'Times New Roman', serif; }
    .sans { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-feature-settings: 'tnum'; }
    .num { font-weight: 700; letter-spacing: -0.02em; }
    .label { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }

    /* Subtle fade-in-up stagger on the four stat cells. Anchors at the
       baseline of each cell so the upward motion lands on the number
       rather than dragging the label with it. */
    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .cell {
      animation: rise 700ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
      transform-origin: center bottom;
    }
    .cell.c1 { animation-delay: 80ms; }
    .cell.c2 { animation-delay: 180ms; }
    .cell.c3 { animation-delay: 280ms; }
    .cell.c4 { animation-delay: 380ms; }

    /* Slow pulse on the live dot to communicate that the numbers are
       refreshed by the daily build. */
    @keyframes pulse {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }
    .live-dot { animation: pulse 2.4s ease-in-out infinite; }
  </style>

  <!-- Frame -->
  <rect class="bg" width="740" height="340" rx="16"/>
  <rect class="card" x="14" y="14" width="712" height="312" rx="12" stroke-width="1"/>

  <!-- Top kicker: live dot + label -->
  <g transform="translate(40 44)">
    <circle class="live-dot" cx="0" cy="-2" r="4"/>
    <text class="sans label muted" x="12" y="2">LIVE PROJECT STATS · ${userHandle.toUpperCase()}</text>
  </g>

  <!-- Title -->
  <text class="serif num fg" x="40" y="100" font-size="36">${userName}</text>
  ${tagline ? `<text class="sans muted" x="40" y="124" font-size="13">${tagline}</text>` : ''}
  <line class="accent-rule" x1="40" y1="138" x2="84" y2="138" stroke-width="2"/>

  <!-- 2×2 stat grid. Each cell carries a c1..c4 class for the stagger. -->
  <g transform="translate(40 178)">
    <g class="cell c1">
      <text class="serif num fg" font-size="42" x="0" y="0">${formatStat(stats.starsAndLikes)}+</text>
      <text class="sans label muted" x="2" y="22">★ Stars &amp; likes</text>
    </g>
    <g class="cell c2" transform="translate(165 0)">
      <text class="serif num fg" font-size="42" x="0" y="0">${formatStat(stats.downloadsAndPulls)}+</text>
      <text class="sans label muted" x="2" y="22">↓ Downloads &amp; pulls</text>
    </g>
    <g class="cell c3" transform="translate(360 0)">
      <text class="serif num fg" font-size="42" x="0" y="0">${formatStat(stats.activeUsers)}+</text>
      <text class="sans label muted" x="2" y="22">⏺ Active users</text>
    </g>
    <g class="cell c4" transform="translate(525 0)">
      <text class="serif num fg" font-size="42" x="0" y="0">${stats.totalProjects}</text>
      <text class="sans label muted" x="2" y="22">▢ Projects shipped</text>
    </g>
  </g>

  <!-- Footer: GitHub + Stack Overflow side stats + link back to dashboard. -->
  <g transform="translate(40 280)">
    ${githubRepos != null ? `<text class="sans muted" x="0" y="0" font-size="12">GitHub: <tspan class="fg" font-weight="600">${githubRepos}</tspan> repos${githubStars != null ? ` · <tspan class="fg" font-weight="600">★ ${githubStars}</tspan>` : ''}</text>` : ''}
    ${stackoverflowRep != null ? `<text class="sans muted" x="${githubRepos != null ? 220 : 0}" y="0" font-size="12">Stack Overflow: <tspan class="fg" font-weight="600">${formatStat(stackoverflowRep)}</tspan> rep</text>` : ''}
  </g>
  <g transform="translate(40 306)">
    <text class="sans muted" x="0" y="0" font-size="11" font-style="italic">Live dashboard ↗ ${dashboardUrl}</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // GitHub's camo proxy caches images aggressively — a short
      // Cache-Control isn't strictly enforced but signals intent.
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
