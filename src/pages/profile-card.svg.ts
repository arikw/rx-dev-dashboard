import type { APIRoute } from 'astro';
import { loadProjects, getProfiles } from '../lib/load-projects';
import { aggregateStats, formatStat } from '../lib/aggregate-stats';
import config from '../lib/load-config';

// Animated SVG profile card meant for embedding in a GitHub README.
// Mounted at `<base>profile-card.svg` and built at the same cadence as
// the rest of the dashboard, so the numbers below stay in sync with what
// `/projects/` is showing.
//
// Layout (640×220, anchored at the top so it sits cleanly inline next
// to other README content):
//   - Header: small "LIVE PROJECT STATS · ARIKW" kicker + name + tagline
//   - Stats row: 4 evenly-spaced cells filling the card width
//   - Footer: single line with GitHub repos · Stack Overflow rep ·
//     dashboard link
//
// Why CSS animations instead of SMIL: GitHub's camo proxy serves SVGs
// fine and honours embedded `<style>`, but `<script>` is stripped.
// CSS keyframes are the cleanest way to express "fade in once on
// load" without writing per-element animate nodes. Transforms on
// SVG `<g>` elements behave unevenly across browsers though, so the
// animation here is a pure opacity fade — no translate, no scale.
// `prefers-color-scheme: dark` overrides inside the SVG let one URL
// adapt to either GitHub theme.
export const GET: APIRoute = async () => {
  const projects = await loadProjects();
  const stats = aggregateStats(projects);
  const profiles = getProfiles();

  const githubFact = profiles.find((p) => p.source === 'github');
  const stackoverflowFact = profiles.find((p) => p.source === 'stackoverflow');

  const githubRepos = typeof githubFact?.headline.value === 'number' ? githubFact.headline.value : null;
  const stackoverflowRep = typeof stackoverflowFact?.headline.value === 'number' ? stackoverflowFact.headline.value : null;

  const userName = config.user.name || 'Arik W.';
  const userHandle = config.user.github || 'arikw';
  const dashboardUrl = `${config.deployment.site}${config.deployment.base}`;
  // Template repo — what a viewer would clone/fork to spin up their
  // own version of this card + dashboard.
  const templateRepoUrl = 'https://github.com/arikw/live-dev-portfolio';
  const tagline = (config.user.bio ?? '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1') // strip markdown links
    .replace(/\.\s*Reach me on GitHub.*$/i, '')
    .replace(/\.\s*$/, '')
    .trim();

  // Hand-picked X positions for the 4 stat cells — evenly distributed
  // across a 580px usable width with 20px gap, so the column rhythm
  // is visible at a glance and the rightmost cell doesn't crowd the
  // card edge.
  const cellX = [0, 145, 290, 435];

  // Icon paths lifted verbatim from src/components/Stat.astro so the
  // glyphs in the README match what the hero on /projects/ uses.
  // Each is drawn in a 24×24 viewBox; the inline <svg> wrappers in
  // the markup scale them to ~11px next to the label text.
  const ICONS = {
    star:     'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
    users:    'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    projects: 'M3 5h7l2 2h9v12H3V5zm2 2v10h14V9h-7.83l-2-2H5z',
  };
  const icon = (kind: keyof typeof ICONS, x: number, y: number) =>
    `<svg x="${x}" y="${y}" width="11" height="11" viewBox="0 0 24 24"><path class="muted" d="${ICONS[kind]}"/></svg>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 220" width="640" height="220" role="img" aria-label="${userName} — live project stats">
  <title>${userName} — live project stats</title>
  <style>
    :root {
      --bg: #fafaf7;
      --card: #ffffff;
      --fg: #1a1a1a;
      --muted: #6a6a6a;
      --accent: #2e4f6f;
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
        --border: #3a3c41;
        --live: #4ade80;
      }
    }
    .bg { fill: var(--bg); }
    .card { fill: var(--card); stroke: var(--border); }
    .fg { fill: var(--fg); }
    .muted { fill: var(--muted); }
    .accent-rule { stroke: var(--accent); }
    .live-dot { fill: var(--live); }

    .serif { font-family: 'Fraunces', 'Source Serif Pro', ui-serif, Georgia, 'Times New Roman', serif; }
    .sans { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-feature-settings: 'tnum'; }
    .num { font-weight: 700; letter-spacing: -0.02em; }
    .label { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }

    /* Pure-opacity fade-in for the whole content layer. CSS transforms
       on SVG group elements render unevenly across browsers (the
       coordinate systems disagree on transform-origin), so the
       animation avoids translate/scale and stays subtle. */
    @keyframes fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .content { animation: fade-in 700ms ease-out backwards; }
  </style>

  <!-- Frame -->
  <rect class="bg" width="640" height="220" rx="14"/>
  <rect class="card" x="10" y="10" width="620" height="200" rx="10" stroke-width="1"/>

  <g class="content">
    <!-- Top row: live-dot kicker on the left, template attribution
         on the right. The "make yours" link doubles as both a
         credit and an invitation: visitors who land on the README
         and want a card like this get a one-click path to the
         template repo. -->
    <g transform="translate(30 32)">
      <circle class="live-dot" cx="0" cy="-2" r="3.5"/>
      <text class="sans label muted" x="11" y="2">LIVE STATS · AGGREGATED FROM ${stats.totalProjects} PROJECTS</text>
    </g>
    <a href="${templateRepoUrl}" target="_blank">
      <text class="sans label muted" x="610" y="34" text-anchor="end">MAKE YOURS ↗</text>
    </a>

    <!-- Title + tagline -->
    <text class="serif num fg" x="30" y="74" font-size="28">${userName}</text>
    ${tagline ? `<text class="sans muted" x="30" y="95" font-size="12">${tagline}</text>` : ''}
    <line class="accent-rule" x1="30" y1="106" x2="68" y2="106" stroke-width="2"/>

    <!-- Stats row. Each cell pairs the big number with a small icon
         (from the same set the hero on /projects/ uses) and a 2-line
         label. The second line is split out with a <tspan x= dy= …>
         which resets the X position and drops vertical baseline by
         the line height — gives the same wording the hero uses
         ("Stars & likes" / "Downloads & pulls") without the labels
         crowding their neighbour at 145px column width. -->
    <g transform="translate(30 144)">
      <g>
        <text class="serif num fg" font-size="30" x="${cellX[0]}" y="0">${formatStat(stats.starsAndLikes)}+</text>
        ${icon('star', cellX[0], 9)}
        <text class="sans label muted" x="${cellX[0] + 14}" y="18">Stars<tspan x="${cellX[0]}" dy="12">&amp; likes</tspan></text>
      </g>
      <g>
        <text class="serif num fg" font-size="30" x="${cellX[1]}" y="0">${formatStat(stats.downloadsAndPulls)}+</text>
        ${icon('download', cellX[1], 9)}
        <text class="sans label muted" x="${cellX[1] + 14}" y="18">Downloads<tspan x="${cellX[1]}" dy="12">&amp; pulls</tspan></text>
      </g>
      <g>
        <text class="serif num fg" font-size="30" x="${cellX[2]}" y="0">${formatStat(stats.activeUsers)}+</text>
        ${icon('users', cellX[2], 9)}
        <text class="sans label muted" x="${cellX[2] + 14}" y="18">Active<tspan x="${cellX[2]}" dy="12">users</tspan></text>
      </g>
      <g>
        <text class="serif num fg" font-size="30" x="${cellX[3]}" y="0">${stats.totalProjects}</text>
        ${icon('projects', cellX[3], 9)}
        <text class="sans label muted" x="${cellX[3] + 14}" y="18">Projects<tspan x="${cellX[3]}" dy="12">shipped</tspan></text>
      </g>
    </g>

    <!-- Footer: side stats + clickable dashboard link on one line. -->
    <text class="sans muted" x="30" y="200" font-size="11">${
      [
        githubRepos != null ? `GitHub: <tspan class="fg" font-weight="600">${githubRepos}</tspan> repos` : '',
        stackoverflowRep != null ? `Stack Overflow: <tspan class="fg" font-weight="600">${formatStat(stackoverflowRep)}</tspan> rep` : '',
      ].filter(Boolean).join('  ·  ')
    }${githubRepos != null || stackoverflowRep != null ? '  ·  ' : ''}<a href="${dashboardUrl}" target="_blank"><tspan class="fg" font-weight="600" text-decoration="underline">↗ ${dashboardUrl.replace(/^https?:\/\//, '')}</tspan></a></text>
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
