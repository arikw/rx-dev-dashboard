type Direction = 'up' | 'down' | 'none';
type StatKey = 'star' | 'download' | 'users' | 'projects';
type Delta = { value: number; direction: Direction; label: string };
type Scenario = {
  relativeTime: string;
  heroDeltas: Record<StatKey, Delta>;
  profileDeltas: Record<string, Record<string, Delta>>;
  newProjectCount: number;
  removedProjectCount: number;
};

const SCENARIOS: Record<string, Scenario> = {
  growth: {
    relativeTime: 'since 5 days ago',
    heroDeltas: {
      star:     { value: 12,   direction: 'up', label: 'stars & likes' },
      download: { value: 1240, direction: 'up', label: 'downloads' },
      users:    { value: 8,    direction: 'up', label: 'active users' },
      projects: { value: 2,    direction: 'up', label: 'projects' },
    },
    profileDeltas: {
      github: {
        'public repos': { value: 4, direction: 'up', label: 'public repos' },
        'followers':    { value: 2, direction: 'up', label: 'followers' },
      },
      stackoverflow: {
        'reputation': { value: 320, direction: 'up', label: 'reputation' },
        '🥇':          { value: 1,   direction: 'up', label: 'gold badges' },
        '🥉':          { value: 3,   direction: 'up', label: 'bronze badges' },
      },
    },
    newProjectCount: 2,
    removedProjectCount: 0,
  },
  mixed: {
    relativeTime: 'since 12 days ago',
    heroDeltas: {
      star:     { value: 7,   direction: 'up',   label: 'stars & likes' },
      download: { value: 230, direction: 'up',   label: 'downloads' },
      users:    { value: 0,   direction: 'none', label: 'active users' },
      projects: { value: 2,   direction: 'down', label: 'projects' },
    },
    profileDeltas: {
      github: {
        'public repos': { value: 1, direction: 'up',   label: 'public repos' },
        'followers':    { value: 1, direction: 'down', label: 'followers' },
      },
      stackoverflow: {
        'reputation': { value: 50, direction: 'down', label: 'reputation' },
        '🥈':          { value: 2,  direction: 'up',   label: 'silver badges' },
      },
    },
    newProjectCount: 1,
    removedProjectCount: 3,
  },
  quiet: {
    relativeTime: '',
    heroDeltas: {
      star:     { value: 0, direction: 'none', label: 'stars & likes' },
      download: { value: 0, direction: 'none', label: 'downloads' },
      users:    { value: 0, direction: 'none', label: 'active users' },
      projects: { value: 0, direction: 'none', label: 'projects' },
    },
    profileDeltas: {},
    newProjectCount: 0,
    removedProjectCount: 0,
  },
};

function formatNumber(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(k < 10 ? 1 : 0).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

function injectDelta(slot: HTMLElement, delta: Delta, relativeTime: string): void {
  if (delta.direction === 'none' || delta.value === 0) return;
  const arrow = delta.direction === 'up' ? '▲' : '▼';
  const sign = delta.direction === 'up' ? '+' : '−';
  slot.classList.toggle('is-negative', delta.direction === 'down');
  slot.innerHTML = `<span class="stat-delta-arrow" aria-hidden="true">${arrow}</span>${sign}${formatNumber(delta.value)}`;
  const tooltipParts = [`${sign}${formatNumber(delta.value)} ${delta.label}`];
  if (relativeTime) tooltipParts.push(relativeTime);
  slot.dataset.tooltip = tooltipParts.join(' ');
  slot.removeAttribute('hidden');
}

function populateVisitSummary(scenario: Scenario): void {
  const el = document.querySelector<HTMLElement>('.visit-summary');
  if (!el) return;
  const parts: string[] = [];
  if (scenario.newProjectCount > 0) {
    const label = scenario.newProjectCount === 1 ? 'new project' : 'new projects';
    parts.push(`<span class="visit-summary-new">${scenario.newProjectCount} ${label}</span>`);
  }
  if (scenario.removedProjectCount > 0) {
    parts.push(`<span class="visit-summary-removed">${scenario.removedProjectCount} removed</span>`);
  }
  if (!parts.length) return;
  const time = scenario.relativeTime ? ` ${scenario.relativeTime}` : '';
  el.innerHTML = parts.join('<span class="visit-summary-sep">·</span>') + time;
  el.removeAttribute('hidden');
}

function activate(): void {
  const params = new URLSearchParams(location.search);
  const name = params.get('demo');
  if (!name) return;
  const scenario = SCENARIOS[name];
  if (!scenario) return;

  for (const [key, delta] of Object.entries(scenario.heroDeltas)) {
    const tile = document.querySelector(`.stat[data-stat-key="${key}"]`);
    const slot = tile?.querySelector<HTMLElement>('.stat-delta');
    if (slot) injectDelta(slot, delta, scenario.relativeTime);
  }

  for (const [source, deltas] of Object.entries(scenario.profileDeltas)) {
    const chip = document.querySelector(`.profile-chip[data-profile-source="${source}"]`);
    if (!chip) continue;
    for (const [factLabel, delta] of Object.entries(deltas)) {
      const slot = chip.querySelector<HTMLElement>(`.stat-delta[data-fact-label="${CSS.escape(factLabel)}"]`);
      if (slot) injectDelta(slot, delta, scenario.relativeTime);
    }
  }

  if (scenario.newProjectCount > 0) {
    const cards = document.querySelectorAll<HTMLElement>('.card');
    for (let i = 0; i < Math.min(scenario.newProjectCount, cards.length); i++) {
      const ribbon = cards[i].querySelector<HTMLElement>('.card-new-ribbon');
      if (ribbon) ribbon.removeAttribute('hidden');
    }
  }

  populateVisitSummary(scenario);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', activate);
} else {
  activate();
}
