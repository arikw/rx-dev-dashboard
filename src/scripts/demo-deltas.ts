import { injectDelta, populateVisitSummary, readHashParam, type DeltaInfo } from './delta-injection';

type Scenario = {
  relativeTime: string;
  heroDeltas: Record<'star' | 'download' | 'users' | 'projects', DeltaInfo & { direction: 'up' | 'down' | 'none' }>;
  profileDeltas: Record<string, Record<string, DeltaInfo & { direction: 'up' | 'down' | 'none' }>>;
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

function activate(): void {
  const name = readHashParam('stats-demo');
  if (!name) return;
  const scenario = SCENARIOS[name];
  if (!scenario) return;

  for (const [key, delta] of Object.entries(scenario.heroDeltas)) {
    if (delta.direction === 'none') continue;
    const tile = document.querySelector(`.stat[data-stat-key="${key}"]`);
    const slot = tile?.querySelector<HTMLElement>('.stat-delta');
    if (slot) injectDelta(slot, delta as DeltaInfo, scenario.relativeTime);
  }

  for (const [source, deltas] of Object.entries(scenario.profileDeltas)) {
    const chip = document.querySelector(`.profile-chip[data-profile-source="${source}"]`);
    if (!chip) continue;
    for (const [factLabel, delta] of Object.entries(deltas)) {
      if (delta.direction === 'none') continue;
      const slot = chip.querySelector<HTMLElement>(`.stat-delta[data-fact-label="${CSS.escape(factLabel)}"]`);
      if (slot) injectDelta(slot, delta as DeltaInfo, scenario.relativeTime);
    }
  }

  if (scenario.newProjectCount > 0) {
    const cards = document.querySelectorAll<HTMLElement>('.card');
    for (let i = 0; i < Math.min(scenario.newProjectCount, cards.length); i++) {
      const ribbon = cards[i].querySelector<HTMLElement>('.card-new-ribbon');
      if (ribbon) ribbon.removeAttribute('hidden');
    }
  }

  populateVisitSummary({
    newProjectCount: scenario.newProjectCount,
    removedProjectCount: scenario.removedProjectCount,
    relativeTime: scenario.relativeTime,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', activate);
} else {
  activate();
}
