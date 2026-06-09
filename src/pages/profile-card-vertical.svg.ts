import type { APIRoute } from 'astro';
import { loadProjects, getProfiles } from '../lib/load-projects';
import { aggregateStats, formatStat } from '../lib/aggregate-stats';
import config from '../lib/load-config';

// Vertical-stack profile card variant. Mounted at
// `<base>profile-card-vertical.svg`. Same data shape and theming as
// the horizontal flavour at profile-card.svg, but each stat sits on
// its own row inside a 400px-wide card. Labels stay on a single line
// (no <tspan> wrapping); numbers are right-aligned to a fixed column.
//
// Drops the headline + tagline section — the vertical variant is
// meant for tighter README slots (sidebar-style placement) where the
// "who is this" context is supplied by the surrounding page.
//
// Card height adapts to the number of non-zero cells: 1-cell render
// is 160px, 4-cell is 280px. Avoids the awkward "0+ Active users"
// row when the dashboard hasn't yet picked up a chrome-extension
// audience or similar.
export const GET: APIRoute = async () => {
  const projects = await loadProjects();
  const stats = aggregateStats(projects);
  const profiles = getProfiles();

  const githubFact = profiles.find((p) => p.source === 'github');
  const stackoverflowFact = profiles.find((p) => p.source === 'stackoverflow');

  const githubRepos = typeof githubFact?.headline.value === 'number' ? githubFact.headline.value : null;
  const stackoverflowRep = typeof stackoverflowFact?.headline.value === 'number' ? stackoverflowFact.headline.value : null;

  const dashboardUrl = `${config.deployment.site}${config.deployment.base}`;
  const templateRepoUrl = 'https://github.com/arikw/live-dev-portfolio';

  // Icon paths lifted verbatim from src/components/Stat.astro — same
  // glyphs the horizontal card and the dashboard hero use.
  const ICONS = {
    star:     'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
    users:    'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    projects: 'M3 5h7l2 2h9v12H3V5zm2 2v10h14V9h-7.83l-2-2H5z',
  };
  const icon = (kind: keyof typeof ICONS, x: number, y: number) =>
    `<svg x="${x}" y="${y}" width="14" height="14" viewBox="0 0 24 24"><path class="muted" d="${ICONS[kind]}"/></svg>`;

  type Cell = { value: number; suffix: string; label: string; iconKey: keyof typeof ICONS };
  const allCells: Cell[] = [
    { value: stats.starsAndLikes,      suffix: '+', label: 'Stars & likes',     iconKey: 'star' },
    { value: stats.downloadsAndPulls,  suffix: '+', label: 'Downloads & pulls', iconKey: 'download' },
    { value: stats.activeUsers,        suffix: '+', label: 'Active users',      iconKey: 'users' },
    { value: stats.totalProjects,      suffix: '',  label: 'Projects shipped',  iconKey: 'projects' },
  ];
  const cells = allCells.filter((c) => c.value > 0);

  // Vertical row geometry:
  //   first row baseline at y=80 (under the eyebrow)
  //   row pitch 40px so the icon-label-number line has breathing room
  //   number right-aligned to x=456 (24px right padding from card edge)
  const startY = 80;
  const rowH = 40;
  const cellsMarkup = cells.map((c, i) => {
    const y = startY + i * rowH;
    return `<g>
        ${icon(c.iconKey, 24, y - 14)}
        <text class="sans label muted" x="46" y="${y - 2}">${c.label.replace(/&/g, '&amp;')}</text>
        <text class="serif num fg" font-size="26" x="376" y="${y}" text-anchor="end">${formatStat(c.value)}${c.suffix}</text>
      </g>`;
  }).join('\n      ');

  // Card adapts to the non-zero cell count. The +36 at the end leaves
  // room for the two-line footer (side stats + dashboard URL on its
  // own row) with a comfortable gap above. +60 left a visibly empty
  // band, +20 read as cramped; +36 lands in the readable middle.
  const cardH = startY + rowH * cells.length + 36;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 ${cardH}" width="400" height="${cardH}" role="img" aria-label="Live project stats">
  <title>Live project stats</title>
  <style>
    :root {
      --card: #ffffff;
      --fg: #1a1a1a;
      --muted: #6a6a6a;
      --border: #e8e3da;
      --live: #16a34a;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --card: #1e2024;
        --fg: #ecebe5;
        --muted: #a8a39a;
        --border: #3a3c41;
        --live: #4ade80;
      }
    }
    .card { fill: var(--card); stroke: var(--border); }
    .fg { fill: var(--fg); }
    .muted { fill: var(--muted); }
    .live-dot { fill: var(--live); }

    .serif { font-family: 'Fraunces', 'Source Serif Pro', ui-serif, Georgia, 'Times New Roman', serif; }
    .sans { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-feature-settings: 'tnum'; }
    .num { font-weight: 700; letter-spacing: -0.02em; }
    .label { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }

    @keyframes fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .content { animation: fade-in 700ms ease-out backwards; }
  </style>

  <rect class="card" width="400" height="${cardH}" rx="14" stroke-width="1"/>

  <g class="content">
    <!-- Top row: live-dot kicker on the left, template attribution on the right. -->
    <g transform="translate(24 32)">
      <circle class="live-dot" cx="0" cy="-2" r="3.5"/>
      <text class="sans label muted" x="11" y="2">LIVE STATS · ${stats.totalProjects} PROJECTS</text>
    </g>
    <a href="${templateRepoUrl}" target="_blank">
      <text class="sans label muted" x="376" y="34" text-anchor="end">MAKE YOURS ↗</text>
    </a>

    <!-- Stat rows: icon + single-line label on the left, big number right-aligned -->
    ${cellsMarkup}

    <!-- Footer block: side stats on the first line, clickable dashboard
         URL on its own line below. Separate <text> elements rather than
         a <tspan dy=...> because GitHub's SVG renderer is more
         consistent with explicit y-positions across browsers. -->
    <text class="sans muted" x="24" y="${cardH - 38}" font-size="11">${
      [
        githubRepos != null ? `GitHub: <tspan class="fg" font-weight="600">${githubRepos}</tspan> repos` : '',
        stackoverflowRep != null ? `Stack Overflow: <tspan class="fg" font-weight="600">${formatStat(stackoverflowRep)}</tspan> rep` : '',
      ].filter(Boolean).join('  ·  ')
    }</text>
    <a href="${dashboardUrl}" target="_blank">
      <text class="sans" x="24" y="${cardH - 18}" font-size="11"><tspan class="fg" font-weight="600" text-decoration="underline">${dashboardUrl.replace(/^https?:\/\//, '')}</tspan> <tspan class="fg" font-weight="600">↗</tspan></text>
    </a>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
